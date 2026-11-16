// VaultSealExtractor (U6; BR6.10, BR6.11, FR5.7): a Vault server that auto-unseals depends on its
// KMS from a cold start. The seal is read from the rendered `<fullname>-config` ConfigMap, key
// `extraconfig-from-values.hcl` (the name and key the Vault Helm chart renders, for any release
// name: `vault-config` for `vault`, `platform-secrets-vault-config` for `platform-secrets`), with
// the bounded HCL reader; no other key or object is read (BR6.16). The Vault StatefulSet is the one
// named `<fullname>` in the ConfigMap's namespace that also mounts the ConfigMap (names are repo
// text, so the mount corroborates); none or several is an item and no edge. StatefulSets are
// indexed once by namespace, destination and name, so pairing is linear.
//
// `seal "awskms"` gives `external:aws-kms/<region>` from its `region`; a region that is absent or
// not a region name is no edge and an item (OD-14). `gcpckms` gives `external:gcp-kms`;
// `azurekeyvault` `external:azure-keyvault`; `transit` its `address` host, matched to a Service (a
// bare name in the StatefulSet's own namespace), else `external:<host>` when the name cannot be
// in-cluster, else no edge and an item; an absent address is no edge and an item. A seal with
// `disabled = true` or `disabled = "true"` (the old seal of a migration) is no edge; `disabled`
// holding anything but those booleans and strings is refused as `seal-unreadable`. Another seal type is listed as
// `unsupported-provider`. Text the reader refuses is listed as `seal-unreadable`, never guessed
// at. Edges are `seals-with`, from the StatefulSet. Pure (C3).

import {
  asArray,
  type ExtractContext,
  type Extractor,
  type ExtractResult,
  emptyResult,
  getPath,
  IN_CLUSTER,
  isDataMap,
  type RenderedObject,
} from "../u1-graph-model/extractor.js";
import type { NodeId } from "../u1-graph-model/graph-model.js";
import { makeEdge } from "../u1-graph-model/graph-model.js";
import { unresolvedItem } from "../u1-graph-model/status-model.js";
import { estateNamespaces, externalNode, placeHost, urlHost } from "./external-host.js";
import { readSealStanzas, type SealStanza } from "./hcl-seal-reader.js";
import { evidenceOf } from "./references.js";

export const VAULT_CONFIG_KEY = "extraconfig-from-values.hcl";
const CONFIG_SUFFIX = "-config";
// An AWS region name: `us-east-1`, `ap-southeast-2`, `us-gov-west-1`, `cn-north-1`, `eu-isoe-west-1`.
const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;

function bucketOf(object: RenderedObject, ctx: ExtractContext): string {
  const job = object.origin.renderJob === null ? undefined : ctx.jobs.get(object.origin.renderJob);
  return job === undefined ? IN_CLUSTER : job.destination;
}

/** True when the StatefulSet's Pod template mounts the ConfigMap (a configMap or projected volume). */
export function mountsConfigMap(sts: RenderedObject, name: string): boolean {
  const volumes = asArray(getPath(sts.body, ["spec", "template", "spec", "volumes"]));
  return volumes.some(
    (v) =>
      getPath(v, ["configMap", "name"]) === name ||
      asArray(getPath(v, ["projected", "sources"])).some((p) => getPath(p, ["configMap", "name"]) === name),
  );
}

/**
 * A seal's `disabled` flag: the HCL booleans, or the strings "true" and "false" (the form Vault's
 * seal migration documentation writes); anything else is unreadable, never guessed, including
 * other spellings Vault's own boolean parsing accepts ("TRUE", "True", "t", "1"): listed, not read.
 */
export function disabledOf(seal: SealStanza): boolean | "unreadable" {
  const d = seal.attributes.get("disabled");
  if (d === undefined || d === false || d === "false") return false;
  if (d === true || d === "true") return true;
  return "unreadable";
}

export const vaultSealExtractor: Extractor = Object.freeze({
  name: "vault-seal",
  extract(objects: readonly RenderedObject[], ctx: ExtractContext): ExtractResult {
    const out = emptyResult();
    const namespaces = estateNamespaces(objects);
    let read = 0;
    const byName = new Map<string, RenderedObject[]>();
    for (const o of objects) {
      if (o.kind !== "StatefulSet" || o.apiVersion !== "apps/v1") continue;
      const key = `${o.namespace}\n${bucketOf(o, ctx)}\n${o.name}`;
      const list = byName.get(key);
      if (list === undefined) byName.set(key, [o]);
      else list.push(o);
    }
    for (const cm of objects) {
      if (cm.kind !== "ConfigMap" || cm.apiVersion !== "v1") continue;
      read += 1;
      if (!cm.name.endsWith(CONFIG_SUFFIX) || cm.name.length === CONFIG_SUFFIX.length) continue;
      const data = getPath(cm.body, ["data"]);
      if (!isDataMap(data) || !Object.hasOwn(data, VAULT_CONFIG_KEY)) continue;
      const field = `data.${VAULT_CONFIG_KEY}`;
      const text = data[VAULT_CONFIG_KEY];
      const fullname = cm.name.slice(0, -CONFIG_SUFFIX.length);
      const candidates = byName.get(`${cm.namespace}\n${bucketOf(cm, ctx)}\n${fullname}`) ?? [];
      const owners = Array.from(new Set(candidates.filter((s) => mountsConfigMap(s, cm.name)).map((s) => s.id)));
      if (typeof text !== "string") {
        out.unresolved.push(unresolvedItem(cm.id, "seal-unreadable", cm.renderedPath, field));
        continue;
      }
      const parsed = readSealStanzas(text);
      if (!parsed.ok) {
        const subject = owners.length === 1 ? (owners[0] as NodeId) : cm.id;
        out.unresolved.push(unresolvedItem(subject, "seal-unreadable", cm.renderedPath, field));
        continue;
      }
      if (parsed.seals.every((seal) => disabledOf(seal) === true)) continue;
      const owner = owners[0];
      if (owners.length !== 1 || owner === undefined) {
        out.unresolved.push(
          unresolvedItem(
            cm.id,
            "seal-workload-unidentified",
            cm.renderedPath,
            field,
            candidates.map((s) => s.id),
          ),
        );
        continue;
      }
      const edge = (to: NodeId, at: string) =>
        out.edges.push(
          makeEdge({ from: owner, to, kind: "seals-with", source: "extracted", evidence: evidenceOf(cm, at) }),
        );
      for (const seal of parsed.seals) {
        const at = `${field}.seal.${seal.type}`;
        const disabled = disabledOf(seal);
        if (disabled === "unreadable") {
          out.unresolved.push(unresolvedItem(owner, "seal-unreadable", cm.renderedPath, `${at}.disabled`));
          continue;
        }
        if (disabled) continue;
        const fixed = seal.type === "gcpckms" ? "gcp-kms" : seal.type === "azurekeyvault" ? "azure-keyvault" : null;
        if (seal.type === "awskms") {
          const region = seal.attributes.get("region");
          const ext = typeof region === "string" && AWS_REGION.test(region) ? externalNode(`aws-kms/${region}`) : null;
          if (ext === null) {
            out.unresolved.push(unresolvedItem(owner, "region-unresolved", cm.renderedPath, `${at}.region`));
            continue;
          }
          out.externals.push(ext);
          edge(ext.id, at);
        } else if (fixed !== null) {
          const ext = externalNode(fixed) as NonNullable<ReturnType<typeof externalNode>>;
          out.externals.push(ext);
          edge(ext.id, at);
        } else if (seal.type === "transit") {
          const address = seal.attributes.get("address");
          const host = typeof address === "string" ? urlHost(address) : null;
          if (host === null) {
            // Absent, or text that yields no host (quoted as the item's value).
            const text = typeof address === "string" && address !== "" ? address : null;
            out.unresolved.push(
              unresolvedItem(owner, "address-missing", cm.renderedPath, `${at}.address`, [], false, text),
            );
            continue;
          }
          const sts = candidates.find((s) => s.id === owner) as RenderedObject;
          placeHost(out, ctx, {
            from: owner,
            evidence: cm,
            host,
            field: `${at}.address`,
            kind: "seals-with",
            namespaces,
            bareNamespace: sts.namespace,
          });
        } else {
          out.unresolved.push(unresolvedItem(owner, "unsupported-provider", cm.renderedPath, at));
        }
      }
    }
    out.ignoredKinds = objects.length - read;
    return out;
  },
});
