// RenderPlanner (U3; BR3.5, BR3.7, BR3.15 to BR3.19, FR3.11): turns each source into a render job
// or an opaque mark with exactly one reason and what could not be seen. This build plans plain
// directory sources only; every other source kind or shape is opaque with a named reason (the
// supported fields are a closed list: anything else is `unsupported-field` naming the field), so
// nothing is silently left out. It reads no file content: it asks RepoIdentity whether a repoURL
// is readable, and the tree for a directory's entry names (to tell a plain directory from a Helm
// chart or a Kustomize root, as Argo CD does).

import type { DataValue, RenderedObject, RepoResolution } from "../u1-graph-model/extractor.js";
import { asString, getPath, IN_CLUSTER, isDataMap } from "../u1-graph-model/extractor.js";
import { makeOpaqueMark, type OpaqueMark } from "../u1-graph-model/graph-model.js";
import { redactUrl } from "../u1-graph-model/safe-text.js";
import type { SourceKind } from "../u1-graph-model/status-model.js";
import { canonicalDir } from "../u2-intake-config/tree-walk.js";
import type { PlainJob, RenderJob } from "./render-job.js";
import { KUSTOMIZATION_FILES } from "./source-discovery.js";

/** A source to plan: a node-backed source object, or a Kustomize root directory. */
export type PlanSource =
  | { readonly kind: Exclude<SourceKind, "KustomizeRoot">; readonly object: RenderedObject }
  | { readonly kind: "KustomizeRoot"; readonly dir: string };

export type DirectoryProbe =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly reasonWord: string };

export interface PlanContext {
  resolveRepo(url: string): RepoResolution;
  /** Entry names of a directory under a root label (no content), or the refusal word. */
  probeDirectory(root: string, dir: string): DirectoryProbe;
}

export type PlanResult =
  | { readonly job: RenderJob; readonly opaque: null }
  | { readonly job: null; readonly opaque: OpaqueMark };

/** The in-cluster destination as Argo CD names it. */
export const IN_CLUSTER_SERVER = "https://kubernetes.default.svc";

const RENDERS = "objects it renders";
const UNDER_PATH = "objects under its source path";
const LATER = {
  helm: "Helm rendering arrives in a later build",
  kustomize: "Kustomize rendering arrives in a later build",
  sources: "multi-source Applications are rendered in a later build",
  fetch: "repository fetch arrives in a later build",
  appset: "ApplicationSet generators are expanded in a later build",
  flux: "Flux Kustomizations are read in a later build",
  helmRelease: "Flux HelmReleases are rendered in a later build",
  kustomizeRoot: "Kustomize rendering arrives in a later build",
} as const;

const SOURCE_FIELDS = new Set([
  "repoURL",
  "path",
  "targetRevision",
  "chart",
  "helm",
  "kustomize",
  "directory",
  "plugin",
  "ref",
  "name",
]);
const DIRECTORY_FIELDS = new Set(["recurse", "include", "exclude", "jsonnet"]);

function opaque(
  reason: Parameters<typeof makeOpaqueMark>[0]["reason"],
  lost: string,
  extra: { detail?: string; field?: string; value?: string | null; suggestion?: OpaqueMark["suggestion"] } = {},
): PlanResult {
  return {
    job: null,
    opaque: makeOpaqueMark({
      reason,
      lostEdges: [lost],
      detail: extra.detail ?? null,
      field: extra.field ?? null,
      value: extra.value ?? null,
      suggestion: extra.suggestion ?? null,
    }),
  };
}

function nonEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
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

function planApplication(object: RenderedObject, ctx: PlanContext): PlanResult {
  const spec = getPath(object.body, ["spec"]);
  if (!isDataMap(spec))
    return opaque("unsupported-field", RENDERS, { field: "spec", detail: "missing or not a mapping" });
  if (spec.sources !== undefined)
    return opaque("not-in-this-build", RENDERS, { field: "spec.sources", detail: LATER.sources });
  const source = spec.source;
  if (!isDataMap(source))
    return opaque("unsupported-field", RENDERS, { field: "spec.source", detail: "missing or not a mapping" });
  for (const key of Object.keys(source).sort()) {
    if (!SOURCE_FIELDS.has(key))
      return opaque("unsupported-field", RENDERS, { field: `spec.source.${key}`, detail: "not a supported field" });
  }
  if (source.plugin !== undefined)
    return opaque("unsupported-field", RENDERS, { field: "spec.source.plugin", detail: "plugins are never run" });
  if (source.chart !== undefined)
    return opaque("not-in-this-build", RENDERS, { field: "spec.source.chart", detail: LATER.helm });
  if (source.helm !== undefined)
    return opaque("not-in-this-build", RENDERS, { field: "spec.source.helm", detail: LATER.helm });
  if (source.kustomize !== undefined) {
    return opaque("not-in-this-build", RENDERS, { field: "spec.source.kustomize", detail: LATER.kustomize });
  }
  let recurse = false;
  const directory = source.directory;
  if (directory !== undefined && directory !== null) {
    if (!isDataMap(directory))
      return opaque("unsupported-field", RENDERS, { field: "spec.source.directory", detail: "not a mapping" });
    for (const key of Object.keys(directory).sort()) {
      if (!DIRECTORY_FIELDS.has(key)) {
        return opaque("unsupported-field", RENDERS, {
          field: `spec.source.directory.${key}`,
          detail: "not a supported field",
        });
      }
    }
    for (const key of ["include", "exclude", "jsonnet"] as const) {
      if (nonEmpty(directory[key])) {
        return opaque("unsupported-field", RENDERS, { field: `spec.source.directory.${key}`, detail: "not supported" });
      }
    }
    if (directory.recurse !== undefined) {
      if (typeof directory.recurse !== "boolean") {
        return opaque("unsupported-field", RENDERS, {
          field: "spec.source.directory.recurse",
          detail: "not a boolean",
        });
      }
      recurse = directory.recurse;
    }
  }
  const repoURL = asString(source.repoURL);
  if (repoURL === undefined || repoURL === "") {
    return opaque("unsupported-field", RENDERS, { field: "spec.source.repoURL", detail: "missing or not a string" });
  }
  const rawPath = source.path === undefined || source.path === null ? "" : source.path;
  if (typeof rawPath !== "string")
    return opaque("unsupported-field", RENDERS, { field: "spec.source.path", detail: "not a string" });
  const resolution = ctx.resolveRepo(repoURL);
  if (resolution.outcome === "unreadable") {
    // A repoURL is shown only with its userinfo removed (FR8.9); one that does not parse is not shown.
    const shown = redactUrl(repoURL) ?? null;
    if (resolution.via === "repos-fetch") {
      return opaque("not-in-this-build", UNDER_PATH, {
        field: "spec.source.repoURL",
        value: shown,
        detail: LATER.fetch,
      });
    }
    const detail =
      resolution.via === "not-comparable" ? "not a URL crankpath can compare" : "not this repository and not mapped";
    return opaque("unreadable-repo", UNDER_PATH, {
      field: "spec.source.repoURL",
      value: shown,
      detail,
      suggestion: resolution.suggestion,
    });
  }
  const root = resolution.root ?? ".";
  const canon = canonicalDir(rawPath);
  if (!canon.ok) {
    return opaque("unreadable-file", UNDER_PATH, {
      field: "spec.source.path",
      value: rawPath,
      detail: canon.refusal.reasonWord,
    });
  }
  const probe = ctx.probeDirectory(root, canon.path);
  if (!probe.ok)
    return opaque("unreadable-file", UNDER_PATH, {
      field: "spec.source.path",
      value: rawPath,
      detail: probe.reasonWord,
    });
  if (probe.names.includes("Chart.yaml"))
    return opaque("not-in-this-build", RENDERS, { field: "spec.source.path", detail: LATER.helm });
  if (probe.names.some((n) => KUSTOMIZATION_FILES.has(n))) {
    return opaque("not-in-this-build", RENDERS, { field: "spec.source.path", detail: LATER.kustomize });
  }
  const destination = spec.destination;
  const ns = getPath(destination, ["namespace"]);
  const job: PlainJob = Object.freeze({
    kind: "plain",
    jobId: `${object.id}#0`,
    owner: object.id,
    ownerFile: object.origin.path ?? object.renderedPath,
    ownerField: "spec.source.path",
    ownerRenderedPath: object.renderedPath,
    destination: destinationKey(destination),
    namespace: typeof ns === "string" && ns !== "" ? ns : null,
    releaseName: null,
    valuesInputs: Object.freeze([]),
    source: Object.freeze({ repo: resolution, path: canon.path, chart: null, version: null, floating: false }),
    generatedBy: object.generatedBy,
    root,
    dir: canon.path,
    recurse,
  });
  return { job, opaque: null };
}

/** Plans one source: a job, or one opaque mark naming what could not be seen. */
export function planSource(source: PlanSource, ctx: PlanContext): PlanResult {
  switch (source.kind) {
    case "Application":
      return planApplication(source.object, ctx);
    case "ApplicationSet":
      return opaque("not-in-this-build", "Applications generated from its generators", {
        field: "spec.generators",
        detail: LATER.appset,
      });
    case "Kustomization":
      return opaque("not-in-this-build", "objects it applies", { detail: LATER.flux });
    case "HelmRelease":
      return opaque("not-in-this-build", "objects it installs", { detail: LATER.helmRelease });
    case "KustomizeRoot":
      return opaque("not-in-this-build", "objects it builds", { detail: LATER.kustomizeRoot });
  }
}
