// CertManagerExtractor (U6; BR6.4 to BR6.6, FR5.5): a Certificate depends on its issuer
// (`issued-by`; `issuerRef.kind` defaults to Issuer) and the Secret named by `secretName` depends on
// it (`produced-by`; the Secret node is made here when no source defines it). An issuer depends
// on what its one issuer type needs: `ca` its `secretName` Secret; `vault` the host of
// `spec.vault.server`, its CA bundle Secret and every Secret and ServiceAccount reference of its
// `auth`; `acme` the host of `spec.acme.server` and the Secret references of its solvers and
// external account binding (the account key `privateKeySecretRef` is created by cert-manager, so
// it is no dependency); `selfSigned` nothing. A host goes through HostMatcher: a Service, an
// external precondition when the name cannot be in-cluster, else no edge and an item (ambiguous
// or unplaced; a bare name states no namespace, because the cert-manager controller dials it).
// An Issuer's references are in its namespace; a ClusterIssuer's in cert-manager's
// cluster resource namespace, `cert-manager` unless the controller is started otherwise (a flag
// outside the estate). An issuerRef of another API group (an external issuer) and any other issuer
// type are listed as `unsupported-provider`, with no edge. Pure (C3).

import {
  asArray,
  type DataValue,
  type ExtractContext,
  type Extractor,
  type ExtractResult,
  emptyResult,
  getPath,
  isDataMap,
  type RenderedObject,
} from "../u1-graph-model/extractor.js";
import { makeEdge, objectId } from "../u1-graph-model/graph-model.js";
import { unresolvedItem } from "../u1-graph-model/status-model.js";
import { placeUrl } from "./external-host.js";
import { authReferences, evidenceOf, kindOfReference, producedNode, referTo } from "./references.js";

const GROUP = "cert-manager.io";

/** cert-manager's default `--cluster-resource-namespace`: where a ClusterIssuer's Secrets live. */
export const CLUSTER_RESOURCE_NAMESPACE = "cert-manager";

/** The issuer types crankpath reads. */
export const ISSUER_TYPES = Object.freeze(["acme", "ca", "selfSigned", "vault"] as const);

function isCertManager(o: RenderedObject, kind: string): boolean {
  return o.kind === kind && o.apiVersion.startsWith(`${GROUP}/`);
}

export const certManagerExtractor: Extractor = Object.freeze({
  name: "cert-manager",
  extract(objects: readonly RenderedObject[], ctx: ExtractContext): ExtractResult {
    const out = emptyResult();
    let read = 0;

    for (const cert of objects) {
      if (!isCertManager(cert, "Certificate")) continue;
      read += 1;
      const ref = getPath(cert.body, ["spec", "issuerRef"]);
      if (isDataMap(ref)) {
        const group = ref.group;
        if (group !== undefined && group !== null && group !== GROUP) {
          out.unresolved.push(
            unresolvedItem(cert.id, "unsupported-provider", cert.renderedPath, "spec.issuerRef.group"),
          );
        } else {
          const kind = ref.kind === undefined || ref.kind === null ? "Issuer" : ref.kind;
          if (kind === "Issuer" || kind === "ClusterIssuer") {
            referTo(out, cert, "issued-by", kind, cert.namespace, ref.name, "spec.issuerRef.name");
          } else {
            out.unresolved.push(unresolvedItem(cert.id, "invalid-reference", cert.renderedPath, "spec.issuerRef.kind"));
          }
        }
      }
      const secretName = getPath(cert.body, ["spec", "secretName"]);
      if (typeof secretName === "string") {
        const id = objectId("Secret", cert.namespace, secretName);
        if (!id.ok) {
          out.unresolved.push(
            unresolvedItem(secretName, "invalid-reference", cert.renderedPath, "spec.secretName", [], {
              owner: cert.id,
            }),
          );
        } else {
          const node = producedNode(cert, "Secret", secretName);
          if (node !== null) out.nodes.push(node);
          out.edges.push(
            makeEdge({
              from: id.id,
              to: cert.id,
              kind: "produced-by",
              source: "extracted",
              evidence: evidenceOf(cert, "spec.secretName"),
            }),
          );
        }
      }
    }

    for (const issuer of objects) {
      const cluster = isCertManager(issuer, "ClusterIssuer");
      if (!cluster && !isCertManager(issuer, "Issuer")) continue;
      read += 1;
      const namespace = cluster ? CLUSTER_RESOURCE_NAMESPACE : issuer.namespace;
      const spec = getPath(issuer.body, ["spec"]);
      const types = isDataMap(spec) ? Object.keys(spec) : [];
      const known = types.filter((t) => (ISSUER_TYPES as readonly string[]).includes(t));
      const type = known[0];
      if (known.length !== 1 || types.length !== 1 || type === undefined) {
        out.unresolved.push(unresolvedItem(issuer.id, "unsupported-provider", issuer.renderedPath, "spec"));
        continue;
      }
      const block = getPath(spec, [type]);
      const host = (field: string, url: DataValue | undefined) => {
        placeUrl(out, ctx, { from: issuer.id, evidence: issuer, field, kind: "depends-on", bareNamespace: null }, url);
      };
      const refs = (block: DataValue | undefined, at: string) => {
        for (const r of authReferences(block, at)) {
          referTo(out, issuer, kindOfReference(r.targetKind), r.targetKind, namespace, r.name, r.field);
        }
      };
      if (type === "ca") {
        referTo(out, issuer, "needs-secret", "Secret", namespace, getPath(block, ["secretName"]), "spec.ca.secretName");
      } else if (type === "vault") {
        host("spec.vault.server", getPath(block, ["server"]));
        refs(isDataMap(block) ? { caBundleSecretRef: block.caBundleSecretRef ?? null } : undefined, "spec.vault");
        refs(getPath(block, ["auth"]), "spec.vault.auth");
      } else if (type === "acme") {
        host("spec.acme.server", getPath(block, ["server"]));
        refs(getPath(block, ["externalAccountBinding"]), "spec.acme.externalAccountBinding");
        asArray(getPath(block, ["solvers"])).forEach((s, i) => {
          refs(s, `spec.acme.solvers[${i}]`);
        });
      }
    }
    out.ignoredKinds = objects.length - read;
    return out;
  },
});
