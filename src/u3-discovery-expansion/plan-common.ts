// Shared planning vocabulary (U3): the plan context and result types, the opaque-result builder,
// owner fields shared by every job of a source, and the Helm job builder used by both the Argo CD
// and the Flux planners.

import type { DataMap, DataValue, RenderedObject, RepoResolution } from "../u1-graph-model/extractor.js";
import { IN_CLUSTER, isDataMap } from "../u1-graph-model/extractor.js";
import { makeOpaqueMark, type NodeId, type OpaqueMark } from "../u1-graph-model/graph-model.js";
import { redactUrl } from "../u1-graph-model/safe-text.js";
import type { SourceKind } from "../u1-graph-model/status-model.js";
import type { HelmJob, HelmValues, RenderJob, ValuesInput } from "./render-job.js";

/** A source to plan: a node-backed source object, or a Kustomize root directory. */
export type PlanSource =
  | { readonly kind: Exclude<SourceKind, "KustomizeRoot">; readonly object: RenderedObject }
  | { readonly kind: "KustomizeRoot"; readonly dir: string };

export type DirectoryProbe =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly reasonWord: string };

/** An object of the scanned repo that a Flux source names (GitRepository, HelmRepository, OCIRepository, ConfigMap, Secret). */
export type RepoObject =
  | { readonly state: "found"; readonly value: DataMap; readonly file: string }
  | { readonly state: "absent" }
  | { readonly state: "conflict" };

export interface PlanContext {
  resolveRepo(url: string): RepoResolution;
  /** Entry names of a directory under a root label (no content), or the refusal word. */
  probeDirectory(root: string, dir: string): DirectoryProbe;
  /** An object defined in the scanned repo's files, by canonical id. */
  lookup(id: NodeId): RepoObject;
}

/** An edge a planned source keeps whatever its render does (FR4.2): to a ConfigMap or Secret it reads values from. */
export interface PlanReference {
  readonly kind: "needs-config" | "needs-secret";
  readonly to: NodeId;
  readonly field: string;
}

export interface PlanResult {
  readonly jobs: readonly RenderJob[];
  /** Null when every job was planned; else the one mark of the source (and `jobs` is empty). */
  readonly opaque: OpaqueMark | null;
  readonly references: readonly PlanReference[];
}

/** The in-cluster destination as Argo CD names it. */
export const IN_CLUSTER_SERVER = "https://kubernetes.default.svc";

export const RENDERS = "objects it renders";
export const UNDER_PATH = "objects under its source path";
export const LATER = {
  fetch: "repository fetch arrives in a later build",
  appset: "ApplicationSet generators are expanded in a later build",
} as const;

/** A Helm release name: a DNS-1123 subdomain of at most 53 characters (helm's own rule). */
export const RELEASE_NAME = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?(?:\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)*$/;
const RELEASE_MAX = 53;
export function opaque(
  reason: Parameters<typeof makeOpaqueMark>[0]["reason"],
  lost: string,
  extra: { detail?: string; field?: string; value?: string | null; suggestion?: OpaqueMark["suggestion"] } = {},
): PlanResult {
  return {
    jobs: [],
    opaque: makeOpaqueMark({
      reason,
      lostEdges: [lost],
      detail: extra.detail ?? null,
      field: extra.field ?? null,
      value: extra.value ?? null,
      suggestion: extra.suggestion ?? null,
    }),
    references: [],
  };
}

export function nonEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

export function isValidReleaseName(name: string): boolean {
  return name.length <= RELEASE_MAX && RELEASE_NAME.test(name);
}

/** The destination key: `in-cluster` for the in-cluster destination, else a key naming the other one. */
export function destinationKey(destination: DataValue | undefined): string {
  if (!isDataMap(destination)) return "unknown";
  const d = destination;
  const server = typeof d.server === "string" ? d.server.replace(/\/+$/, "") : undefined;
  if (server === IN_CLUSTER_SERVER || (server === undefined && d.name === "in-cluster")) return IN_CLUSTER;
  if (server !== undefined) return `server:${server}`;
  if (typeof d.name === "string") return `name:${d.name}`;
  return "unknown";
}

/** The opaque result for a repoURL RepoIdentity cannot read (with the suggestion, FR2.4). */
export function unreadableRepo(url: string, resolution: RepoResolution, field: string, lost: string): PlanResult {
  // A repoURL is shown only with its userinfo removed (FR8.9); one that does not parse is not shown.
  const shown = redactUrl(url) ?? null;
  if (resolution.via === "repos-fetch") {
    return opaque("not-in-this-build", lost, { field, value: shown, detail: LATER.fetch });
  }
  const detail =
    resolution.via === "not-comparable" ? "not a URL crankpath can compare" : "not this repository and not mapped";
  return opaque("unreadable-repo", lost, { field, value: shown, detail, suggestion: resolution.suggestion });
}

/** The fields every job of one owner shares. */
export interface Owner {
  readonly object: RenderedObject;
  readonly destination: string;
  readonly namespace: string | null;
}

export function ownerBase(o: Owner, index: number, ownerField: string): JobCommon {
  return {
    jobId: `${o.object.id}#${index}`,
    owner: o.object.id,
    ownerFile: o.object.origin.path ?? o.object.renderedPath,
    ownerField,
    ownerRenderedPath: o.object.renderedPath,
    destination: o.destination,
    namespace: o.namespace,
    namespaceOverride: null,
    generatedBy: o.object.generatedBy,
    substitute: null,
  };
}

export function summary(values: readonly HelmValues[]): ValuesInput[] {
  return values.map((v): ValuesInput => {
    switch (v.kind) {
      case "file":
        return { kind: "file", ref: `${v.root}:${v.path}` };
      case "chart-file":
        return { kind: "file", ref: `chart:${v.path}` };
      case "inline":
      case "object":
        return { kind: "inline", ref: v.field };
      default:
        return { kind: v.refKind === "Secret" ? "secret" : "configMap", ref: v.id };
    }
  });
}

/** A Helm job (a chart directory of a repo, or a chart from a repository). */
/** The fields every job shares, from its owner. */
export type JobCommon = Pick<
  HelmJob,
  | "jobId"
  | "owner"
  | "ownerFile"
  | "ownerField"
  | "ownerRenderedPath"
  | "destination"
  | "namespace"
  | "namespaceOverride"
  | "generatedBy"
  | "substitute"
>;

export function helmJob(
  base: JobCommon,
  parts: Pick<HelmJob, "chart" | "releaseName" | "values" | "includeCrds" | "skipSchemaValidation" | "floating"> & {
    readonly repo: RepoResolution | null;
  },
): HelmJob {
  const chart = parts.chart;
  return Object.freeze({
    ...base,
    kind: "helm",
    chart: Object.freeze({ ...chart }),
    releaseName: parts.releaseName,
    values: Object.freeze([...parts.values]),
    includeCrds: parts.includeCrds,
    skipSchemaValidation: parts.skipSchemaValidation,
    valuesInputs: Object.freeze(summary(parts.values)),
    source: Object.freeze({
      repo: parts.repo,
      path: chart.from === "repo" ? chart.dir : null,
      chart: chart.from === "repository" ? chart.name : null,
      version: chart.from === "repository" ? chart.version : null,
      floating: parts.floating.length > 0,
    }),
    floating: Object.freeze([...parts.floating]),
  });
}

/** A path relative to a directory of a root, staying inside the root, or null. */
export function insideRoot(dir: string, rel: string): string | null {
  if (rel.startsWith("/") || rel.includes("\0")) return null;
  const parts: string[] = dir === "" ? [] : dir.split("/");
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}
