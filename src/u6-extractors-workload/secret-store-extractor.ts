// SecretStoreExtractor (U6; BR6.1 to BR6.3, FR5.4): the secrets-bootstrap chain of the External
// Secrets Operator. The Secret an ExternalSecret writes depends on it (`produced-by`; the Secret
// node is made here when no source defines it, unless `creationPolicy` is `Merge`, where the
// Secret must exist already, or `None`, where nothing is written); the ExternalSecret depends on
// each store it names (`uses-store`, the default kind SecretStore). A SecretStore or
// ClusterSecretStore depends on the host of its provider's server URL (a Service, or an external
// precondition when the name cannot be in-cluster; otherwise no edge and an item; a bare name
// states no namespace, because the operator's controller dials it from a namespace the estate
// does not show) and on every Secret, ServiceAccount and CA reference in its provider's `auth` block and
// `caProvider` (`needs-secret`, `runs-as`, `needs-config`). A SecretStore's references are in its
// own namespace; a ClusterSecretStore's must name one, else the namespace is unknown (it would be
// each ExternalSecret's) and listed. A provider outside the closed list keeps its node, makes no
// provider edge and is listed as `unsupported-provider`. Pure (C3).

import {
  asArray,
  asString,
  type DataValue,
  type ExtractContext,
  type Extractor,
  type ExtractResult,
  emptyResult,
  getPath,
  isDataMap,
  type RenderedObject,
} from "../u1-graph-model/extractor.js";
import { type IdResult, makeEdge, objectId } from "../u1-graph-model/graph-model.js";
import { unresolvedItem } from "../u1-graph-model/status-model.js";
import { placeUrl } from "./external-host.js";
import { authReferences, evidenceOf, kindOfReference, producedNode, referTo } from "./references.js";

const GROUP = "external-secrets.io/";

export function isExternalSecret(o: RenderedObject): boolean {
  return o.kind === "ExternalSecret" && o.apiVersion.startsWith(GROUP);
}

function isStore(o: RenderedObject): boolean {
  return (o.kind === "SecretStore" || o.kind === "ClusterSecretStore") && o.apiVersion.startsWith(GROUP);
}

/**
 * The providers whose dependency fields crankpath reads, with the path of their server URL inside
 * the provider block (null: the provider names no server, a cloud API reached by its SDK).
 */
export const STORE_PROVIDERS: Readonly<Record<string, readonly string[] | null>> = Object.freeze({
  akeyless: ["akeylessGWApiURL"],
  aws: null,
  azurekv: ["vaultUrl"],
  conjur: ["url"],
  fake: null,
  gcpsm: null,
  gitlab: ["url"],
  kubernetes: ["server", "url"],
  onepassword: ["connectHost"],
  vault: ["server"],
  webhook: ["url"],
});

export type CreationPolicy = "Owner" | "Orphan" | "Merge" | "None";

/** The Secret an ExternalSecret writes (`spec.target.name`, default its own name), or null for an invalid name. */
export function externalSecretTarget(es: RenderedObject): (IdResult & { ok: true; policy: CreationPolicy }) | null {
  const raw = getPath(es.body, ["spec", "target", "name"]);
  const name = typeof raw === "string" && raw !== "" ? raw : es.name;
  const id = objectId("Secret", es.namespace, name);
  if (!id.ok) return null;
  const p = asString(getPath(es.body, ["spec", "target", "creationPolicy"]));
  const policy: CreationPolicy = p === "Orphan" || p === "Merge" || p === "None" ? p : "Owner";
  return { ...id, policy };
}

function storeKind(value: DataValue | undefined): string | null {
  if (value === undefined || value === null) return "SecretStore";
  return value === "SecretStore" || value === "ClusterSecretStore" ? value : null;
}

export const secretStoreExtractor: Extractor = Object.freeze({
  name: "secret-stores",
  extract(objects: readonly RenderedObject[], ctx: ExtractContext): ExtractResult {
    const out = emptyResult();
    let read = 0;

    for (const es of objects) {
      if (!isExternalSecret(es)) continue;
      read += 1;
      const target = externalSecretTarget(es);
      if (target === null) {
        const raw = getPath(es.body, ["spec", "target", "name"]);
        out.unresolved.push(
          unresolvedItem(
            typeof raw === "string" ? raw : es.name,
            "invalid-reference",
            es.renderedPath,
            "spec.target.name",
            [],
            { owner: es.id },
          ),
        );
      } else if (target.policy !== "None") {
        if (target.policy !== "Merge") {
          const node = producedNode(es, "Secret", target.name);
          if (node !== null) out.nodes.push(node);
        }
        out.edges.push(
          makeEdge({
            from: target.id,
            to: es.id,
            kind: "produced-by",
            source: "extracted",
            evidence: evidenceOf(es, "spec.target.name"),
          }),
        );
      }
      const refs: { ref: DataValue | undefined; field: string }[] = [
        { ref: getPath(es.body, ["spec", "secretStoreRef"]), field: "spec.secretStoreRef" },
      ];
      for (const list of ["data", "dataFrom"] as const) {
        asArray(getPath(es.body, ["spec", list])).forEach((d, i) => {
          refs.push({ ref: getPath(d, ["sourceRef", "storeRef"]), field: `spec.${list}[${i}].sourceRef.storeRef` });
        });
      }
      for (const { ref, field } of refs) {
        if (!isDataMap(ref)) continue;
        const kind = storeKind(ref.kind);
        if (kind === null) {
          out.unresolved.push(unresolvedItem(es.id, "invalid-reference", es.renderedPath, `${field}.kind`));
          continue;
        }
        referTo(out, es, "uses-store", kind, es.namespace, ref.name, `${field}.name`);
      }
    }

    for (const store of objects) {
      if (!isStore(store)) continue;
      read += 1;
      const provider = getPath(store.body, ["spec", "provider"]);
      const names = isDataMap(provider) ? Object.keys(provider) : [];
      const name = names[0];
      if (names.length !== 1 || name === undefined || !Object.hasOwn(STORE_PROVIDERS, name)) {
        out.unresolved.push(unresolvedItem(store.id, "unsupported-provider", store.renderedPath, "spec.provider"));
        continue;
      }
      const block = getPath(provider, [name]);
      const at = `spec.provider.${name}`;
      const serverPath = STORE_PROVIDERS[name];
      if (serverPath !== null && serverPath !== undefined) {
        const field = `${at}.${serverPath.join(".")}`;
        // The operator's controller dials the server, so a bare name resolves in the controller's
        // namespace, which the estate does not show: no namespace is stated.
        placeUrl(
          out,
          ctx,
          { from: store.id, evidence: store, field, kind: "depends-on", bareNamespace: null },
          getPath(block, serverPath),
        );
      }
      const cluster = store.kind === "ClusterSecretStore";
      const refs = authReferences(getPath(block, ["auth"]), `${at}.auth`).concat(
        authReferences(isDataMap(block) ? { caProvider: block.caProvider ?? null } : undefined, at),
      );
      for (const r of refs) {
        if (r.name === undefined || r.name === null) continue;
        let namespace: string | null = store.namespace;
        if (cluster) {
          if (typeof r.namespace !== "string") {
            out.unresolved.push(unresolvedItem(store.id, "namespace-unknown", store.renderedPath, r.field));
            continue;
          }
          namespace = r.namespace;
        }
        referTo(out, store, kindOfReference(r.targetKind), r.targetKind, namespace, r.name, r.field);
      }
    }
    out.ignoredKinds = objects.length - read;
    return out;
  },
});
