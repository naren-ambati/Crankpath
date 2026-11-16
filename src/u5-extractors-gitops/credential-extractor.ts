// Argo CD repository credentials (U5; BR5.5 to BR5.8, BR5.14, FR5.2): an Application (and an
// ApplicationSet, through its git generators) depends on the credential Secret whose `url` matches
// a repoURL it reads (`needs-credential`). A credential is a Secret labelled
// `argocd.argoproj.io/secret-type: repository | repo-creds`, or the Secret an ExternalSecret makes
// when its `spec.target.template.metadata.labels` carry that label (the Secret node and its
// `produced-by` edge are the secret-store extractor's).
//
// Matching uses RepoIdentity's normal form with exact equality: `repository` when equal,
// `repo-creds` when the credential is a prefix of the repoURL at a `/` boundary (never a
// substring). The URL's transport must agree too (ssh and scp-style are one; https; http): Argo CD
// does not offer an ssh key to an https URL. An exact `repository` match wins; otherwise the
// longest `repo-creds` prefix; two credentials at the winning level are an ambiguity (no edge, an
// item). Argo CD takes the first matching `repo-creds` in its own order; crankpath does not model
// that order, so it takes the most specific and calls a same-length tie ambiguous. The `url` is
// the plain Secret's kept `url` key (userinfo already removed) or a literal
// `spec.target.template.data.url` (a `{{` anywhere is a template, even where the URL would still
// normalise); a templated, absent or uncomparable `url` is no edge and an item. A credential that
// matches nothing makes no edge. A credential counts only in Argo CD's control-plane namespace,
// derived from the estate (see `argoNamespace`; Applications in any namespace are not modelled):
// a labelled Secret elsewhere makes no edge, cannot tie, and is listed once per Secret
// (`credential-outside-argocd`); how the namespace was found is always listed
// (`argocd-namespace-derived` from install objects, `argocd-namespace-assumed` from the
// Applications); an unknown one makes no credential edge at all and one item
// (`argocd-namespace-unknown`). Objects
// of a foreign destination are not offered (BR5.4).
// Pure (C3).

import {
  asString,
  type ExtractContext,
  type Extractor,
  type ExtractResult,
  emptyResult,
  getPath,
  IN_CLUSTER,
  isDataMap,
  type RenderedObject,
} from "../u1-graph-model/extractor.js";
import { makeEdge, type NodeId } from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import { unresolvedItem } from "../u1-graph-model/status-model.js";
import { normaliseRepoUrl } from "../u2-intake-config/repo-identity.js";
import { ARGO_SECRET_TYPE_LABEL } from "../u4-render-engine/rendered-set-builder.js";
import { externalSecretTarget, isExternalSecret } from "../u6-extractors-workload/secret-store-extractor.js";
import { repoUrlFields } from "./argo-extractor.js";

export type CredentialType = "repository" | "repo-creds";

export interface Credential {
  /** The credential Secret's id. */
  readonly secret: NodeId;
  /** Its namespace: Argo CD reads credentials from its own namespace only. */
  readonly namespace?: string | null;
  readonly type: CredentialType;
  readonly normalised: string;
  readonly transport: string;
}

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;

/** `ssh` for ssh:// and scp-style URLs, else the lower-cased scheme; null when it has none. */
export function transportOf(raw: string): string | null {
  const m = SCHEME.exec(raw);
  if (m !== null) return (m[1] as string).toLowerCase();
  return raw.includes(":") ? "ssh" : null;
}

function credentialType(value: string | undefined): CredentialType | null {
  return value === "repository" || value === "repo-creds" ? value : null;
}

/** True when the credential applies to the repoURL by its own rule (exact, or `/`-boundary prefix). */
export function credentialMatches(credential: Credential, normalised: string, transport: string): boolean {
  if (credential.transport !== transport) return false;
  if (credential.type === "repository") return normalised === credential.normalised;
  return normalised === credential.normalised || normalised.startsWith(`${credential.normalised}/`);
}

/** The credential an Argo CD repoURL uses: exact `repository` first, then the longest `repo-creds` prefix. */
export function chooseCredential(
  credentials: readonly Credential[],
  normalised: string,
  transport: string,
): { readonly chosen: NodeId | null; readonly tied: readonly NodeId[] } {
  const matching = credentials.filter((c) => credentialMatches(c, normalised, transport));
  let level = matching.filter((c) => c.type === "repository");
  if (level.length === 0) {
    let longest = -1;
    for (const c of matching)
      if (c.type === "repo-creds" && c.normalised.length > longest) longest = c.normalised.length;
    level = matching.filter((c) => c.type === "repo-creds" && c.normalised.length === longest);
  }
  const ids = Array.from(new Set(level.map((c) => c.secret))).sort(compareCodePoints);
  if (ids.length === 1) return { chosen: ids[0] as NodeId, tied: [] };
  return { chosen: null, tied: ids };
}

function bucketOf(object: RenderedObject, ctx: ExtractContext): string {
  const job = object.origin.renderJob === null ? undefined : ctx.jobs.get(object.origin.renderJob);
  return job === undefined ? IN_CLUSTER : job.destination;
}

/** Argo CD's upstream workload names; a Helm release may prefix them (`<release>-argocd-server`). */
export const ARGO_WORKLOADS = Object.freeze(["argocd-application-controller", "argocd-repo-server", "argocd-server"]);
export const PART_OF_LABEL = "app.kubernetes.io/part-of";

/**
 * An object of an Argo CD install, by Argo CD's exact upstream names: the ConfigMap `argocd-cm`,
 * or a Deployment or StatefulSet named `argocd-repo-server`, `argocd-application-controller` or
 * `argocd-server`; the Helm release form `<release>-argocd-...` counts only when the object also
 * carries `app.kubernetes.io/part-of: argocd`. Names are repo text, so the namespace an install
 * gives is used only when the Applications agree with it (see `argoNamespace`).
 */
export function isArgoInstallObject(o: RenderedObject): boolean {
  if (o.kind === "ConfigMap" && o.apiVersion === "v1") return o.name === "argocd-cm";
  if ((o.kind === "Deployment" || o.kind === "StatefulSet") && o.apiVersion === "apps/v1") {
    if (ARGO_WORKLOADS.includes(o.name)) return true;
    const prefixed = ARGO_WORKLOADS.some((w) => o.name.endsWith(`-${w}`) && o.name.length > w.length + 1);
    return prefixed && o.labels[PART_OF_LABEL] === "argocd";
  }
  return false;
}

export type ArgoNamespace =
  | {
      readonly how: "install" | "assumed";
      readonly namespace: string;
      readonly where: string;
      /** The install objects it was derived from (empty when assumed). */
      readonly from: readonly string[];
    }
  | { readonly how: "unknown"; readonly candidates: readonly string[] };

/**
 * Argo CD's control-plane namespace, from the estate, never silent (the caller lists how it was
 * found): (1) the one namespace where the estate renders Argo CD's install, when every
 * Application and ApplicationSet sits in that namespace too (the install corroborated); (2) with no
 * install, the one namespace every Application and ApplicationSet sits in, as an assumption (Argo
 * CD's default mode keeps them in its own namespace); (3) else unknown: installs in several
 * namespaces, an install the Applications disagree with, Applications in several namespaces, or no
 * Application. Objects of a foreign destination are another cluster's and are not read.
 */
export function argoNamespace(objects: readonly RenderedObject[], ctx: ExtractContext): ArgoNamespace {
  const installs = new Map<string, { where: string; ids: string[] }>();
  const apps = new Map<string, string>();
  for (const o of objects) {
    if (o.namespace === null || bucketOf(o, ctx) !== IN_CLUSTER) continue;
    if (isArgoInstallObject(o)) {
      const at = installs.get(o.namespace);
      if (at === undefined) installs.set(o.namespace, { where: o.renderedPath, ids: [o.id] });
      else at.ids.push(o.id);
    } else if ((o.kind === "Application" || o.kind === "ApplicationSet") && o.apiVersion.startsWith("argoproj.io/")) {
      if (!apps.has(o.namespace)) apps.set(o.namespace, o.renderedPath);
    }
  }
  const sorted = (keys: Iterable<string>) => Array.from(keys).sort(compareCodePoints);
  if (installs.size > 1) return { how: "unknown", candidates: sorted(installs.keys()) };
  const appNs = apps.size === 1 ? (Array.from(apps.entries())[0] as [string, string]) : null;
  if (installs.size === 1) {
    const [namespace, install] = Array.from(installs.entries())[0] as [string, { where: string; ids: string[] }];
    if (appNs === null || appNs[0] !== namespace) {
      const seen = new Set(apps.keys());
      seen.add(namespace);
      return { how: "unknown", candidates: sorted(seen) };
    }
    return { how: "install", namespace, where: install.where, from: sorted(install.ids) };
  }
  if (appNs !== null) return { how: "assumed", namespace: appNs[0], where: appNs[1], from: [] };
  return { how: "unknown", candidates: sorted(apps.keys()) };
}

/** The subject of the one item that says Argo CD's namespace could not be derived. */
export const ARGO_NAMESPACE_SUBJECT = "argocd-namespace";

export const credentialExtractor: Extractor = Object.freeze({
  name: "argo-credentials",
  extract(objects: readonly RenderedObject[], ctx: ExtractContext): ExtractResult {
    const out = emptyResult();
    let read = 0;

    // Every labelled credential, before deciding where Argo CD reads them.
    const found: { secret: NodeId; type: CredentialType; url: string | null; where: RenderedObject; field: string }[] =
      [];
    for (const o of objects) {
      if (o.kind === "Secret" && o.apiVersion === "v1") {
        read += 1;
        const type = credentialType(o.labels[ARGO_SECRET_TYPE_LABEL]);
        if (type === null || bucketOf(o, ctx) !== IN_CLUSTER) continue;
        found.push({ secret: o.id, type, url: o.credentialUrl, where: o, field: "data.url" });
      } else if (isExternalSecret(o)) {
        read += 1;
        const labels = getPath(o.body, ["spec", "target", "template", "metadata", "labels"]);
        const type = credentialType(isDataMap(labels) ? asString(labels[ARGO_SECRET_TYPE_LABEL]) : undefined);
        if (type === null || bucketOf(o, ctx) !== IN_CLUSTER) continue;
        const target = externalSecretTarget(o);
        if (target === null) continue;
        const raw = asString(getPath(o.body, ["spec", "target", "template", "data", "url"]));
        const literal = raw !== undefined && !raw.includes("{{") ? raw : null;
        found.push({ secret: target.id, type, url: literal, where: o, field: "spec.target.template.data.url" });
      }
    }
    const apps = objects.filter(
      (o) => (o.kind === "Application" || o.kind === "ApplicationSet") && o.apiVersion.startsWith("argoproj.io/"),
    );
    read += apps.length;
    out.ignoredKinds = objects.length - read;
    if (found.length === 0) return out;

    const ns = argoNamespace(objects, ctx);
    if (ns.how === "unknown") {
      const first = found[0] as (typeof found)[number];
      out.unresolved.push(
        unresolvedItem(
          ARGO_NAMESPACE_SUBJECT,
          "argocd-namespace-unknown",
          first.where.renderedPath,
          null,
          ns.candidates.map((n) => `Namespace/${n}`),
        ),
      );
      return out;
    }
    // Never silent: how the namespace was found is always listed.
    out.unresolved.push(
      ns.how === "assumed"
        ? // an assumption about the estate, not a gap of one node: listed, owned by no node (B5)
          unresolvedItem(`Namespace/${ns.namespace}`, "argocd-namespace-assumed", ns.where, null, [], { owner: null })
        : unresolvedItem(`Namespace/${ns.namespace}`, "argocd-namespace-derived", ns.where, null, ns.from, {
            owner: null,
          }),
    );

    const credentials: Credential[] = [];
    const outside = new Set<NodeId>();
    const unreadable = new Set<NodeId>();
    for (const f of found) {
      if (f.where.namespace !== ns.namespace) {
        // Listed once per Secret, however many objects define it.
        if (!outside.has(f.secret)) {
          outside.add(f.secret);
          out.unresolved.push(unresolvedItem(f.secret, "credential-outside-argocd", f.where.renderedPath, f.field));
        }
        continue;
      }
      const normalised = f.url === null ? null : normaliseRepoUrl(f.url);
      const transport = f.url === null ? null : transportOf(f.url);
      if (normalised === null || transport === null) {
        out.unresolved.push(unresolvedItem(f.secret, "credential-url-unresolved", f.where.renderedPath, f.field));
        unreadable.add(f.secret);
        continue;
      }
      credentials.push({ secret: f.secret, namespace: ns.namespace, type: f.type, normalised, transport });
    }

    // A credential whose url cannot be read (templated, absent, unparseable) may be the one any
    // Application in Argo CD's namespace needs for a repository other than the scanned one: each
    // such Application owns an item naming those credentials, so it is never startable (B5 review).
    if (unreadable.size > 0) {
      const candidates = [...unreadable].sort(compareCodePoints);
      for (const o of apps) {
        if (o.namespace !== ns.namespace) continue;
        const foreign = repoUrlFields(o).find(
          ({ field, url }) =>
            !(o.kind === "ApplicationSet" && field.startsWith("spec.template.")) &&
            ctx.resolveRepo(url).outcome !== "self",
        );
        if (foreign !== undefined)
          out.unresolved.push(unresolvedItem(o.id, "credential-unreadable", o.renderedPath, foreign.field, candidates));
      }
    }

    for (const o of apps) {
      for (const { field, url } of repoUrlFields(o)) {
        // An ApplicationSet's template repoURL is read by the Applications it generates, not by it.
        if (o.kind === "ApplicationSet" && field.startsWith("spec.template.")) continue;
        const normalised = normaliseRepoUrl(url);
        const transport = transportOf(url);
        if (normalised === null || transport === null) continue;
        const { chosen, tied } = chooseCredential(credentials, normalised, transport);
        if (chosen !== null) {
          out.edges.push(
            makeEdge({
              from: o.id,
              to: chosen,
              kind: "needs-credential",
              source: "extracted",
              evidence: { file: o.origin.path ?? o.renderedPath, field, renderedPath: o.renderedPath, line: null },
            }),
          );
        } else if (tied.length > 1) {
          out.unresolved.push(unresolvedItem(o.id, "credential-ambiguous", o.renderedPath, field, tied));
        }
      }
    }
    return out;
  },
});
