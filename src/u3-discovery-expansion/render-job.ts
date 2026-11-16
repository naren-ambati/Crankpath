// Render jobs and rendered sets (contract C4, owned here). The job kinds form one closed union:
// `plain`, `helm` and `kustomize`, each with exactly one renderer (registered in
// src/u4-render-engine/renderers.ts, the one dispatch point).

import type { DataValue, RenderedObject, RepoResolution } from "../u1-graph-model/extractor.js";
import type { NodeId, OpaqueMark, SkippedObject, UnreadableFile } from "../u1-graph-model/graph-model.js";

export interface ValuesInput {
  readonly kind: "file" | "inline" | "ref" | "configMap" | "secret";
  readonly ref: string;
}

export interface JobSource {
  /** How the source repo resolved; null for a chart repository source (no repo identity, FR3.12). */
  readonly repo: RepoResolution | null;
  /** The source path inside that repo (canonical), or null. */
  readonly path: string | null;
  readonly chart: string | null;
  readonly version: string | null;
  readonly floating: boolean;
}

/** A floating revision or version (OD-12): the field and its value (repo text), to be flagged. */
export interface FloatingRef {
  readonly field: string;
  readonly value: string;
}

interface JobBase {
  /** `<owner id>#<source index>`, or `KustomizeRoot:<dir>` for a Kustomize root nothing deploys. */
  readonly jobId: string;
  /** The source that owns the job: every object it renders is `deployed-by` it. Null for a Kustomize root nothing deploys. */
  readonly owner: NodeId | null;
  readonly ownerFile: string;
  /** The owner's field that names what is rendered (evidence of `deployed-by`). */
  readonly ownerField: string;
  readonly ownerRenderedPath: string;
  /** `in-cluster`, or a key of the foreign destination (OD-4). */
  readonly destination: string;
  /** The namespace objects without their own get (destination namespace), or null. */
  readonly namespace: string | null;
  /** A namespace that replaces every namespaced object's own (Flux `targetNamespace`), or null. */
  readonly namespaceOverride: string | null;
  readonly releaseName: string | null;
  /** C4's ordered summary of the value inputs (kind and a reference, no content). */
  readonly valuesInputs: readonly ValuesInput[];
  readonly source: JobSource;
  /** The ApplicationSet that generated the owner (set by generator expansion, B3), or null. */
  readonly generatedBy: NodeId | null;
  /** Flux post-build substitution variables (may hold Secret values: memory only, never printed), or null. */
  readonly substitute: ReadonlyMap<string, string> | null;
  readonly floating: readonly FloatingRef[];
}

/** A plain directory of manifests read through BoundedReader with no subprocess (FR3.11). */
export interface PlainJob extends JobBase {
  readonly kind: "plain";
  /** The root label the directory is in (`.`, `alias:N`, a `read_from` path). */
  readonly root: string;
  /** The canonical directory inside that root (`""` is the root). */
  readonly dir: string;
  readonly recurse: boolean;
}

/** Where a chart is: a directory of a readable repo, or a chart repository or OCI registry. */
export type ChartLocation =
  | { readonly from: "repo"; readonly root: string; readonly dir: string }
  | {
      readonly from: "repository";
      /** The guarded URL (https or oci://, no credential). */
      readonly url: string;
      readonly oci: boolean;
      readonly name: string;
      /** The version as written (exact or a range), or null for the latest. */
      readonly version: string | null;
    };

/** One Helm values input in the order helm receives it (`--values` files, later ones win). */
export type HelmValues =
  | {
      readonly kind: "file";
      readonly root: string;
      readonly path: string;
      readonly field: string;
      readonly optional: boolean;
    }
  | { readonly kind: "chart-file"; readonly path: string; readonly field: string; readonly optional: boolean }
  | { readonly kind: "inline"; readonly text: string; readonly field: string }
  | { readonly kind: "object"; readonly value: DataValue; readonly field: string }
  | {
      readonly kind: "ref";
      readonly refKind: "ConfigMap" | "Secret";
      readonly id: NodeId;
      readonly key: string;
      /** A dotted path to place the value at (Flux `targetPath`), or null to merge it whole. */
      readonly targetPath: readonly string[] | null;
      readonly field: string;
    };

/** A Helm chart rendered with `helm template` (FR3.1, FR3.6). */
export interface HelmJob extends JobBase {
  readonly kind: "helm";
  readonly chart: ChartLocation;
  readonly releaseName: string;
  readonly values: readonly HelmValues[];
  readonly includeCrds: boolean;
  readonly skipSchemaValidation: boolean;
}

/** A Kustomize directory rendered with `kustomize build` under the root-only restrictor (FR3.5). */
export interface KustomizeJob extends JobBase {
  readonly kind: "kustomize";
  readonly root: string;
  readonly dir: string;
}

/** Every render job kind. */
export type RenderJob = PlainJob | HelmJob | KustomizeJob;

export type RenderOutcome = "ok" | "render-failed" | "limit" | "tool-missing" | "offline" | "unreadable-file";

export interface RenderedSet {
  readonly jobId: string;
  readonly objects: readonly RenderedObject[];
  readonly droppedHooks: number;
  readonly outcome: RenderOutcome;
  readonly skipped: readonly SkippedObject[];
  readonly unreadable: readonly UnreadableFile[];
  /** The mark for the owner when the render could not see everything, else null. */
  readonly opaque: OpaqueMark | null;
  /** True when a wall-clock backstop stopped the job (OD-30). */
  readonly timedOut: boolean;
  /** The chart version helm rendered, for a chart from a repository (BR4.10), else null. */
  readonly resolvedVersion: string | null;
  /** Kustomize directories (canonical, in the job's root) this render read: the Kustomize roots it covers. */
  readonly kustomizeDirs: readonly string[];
  /** What makes this render's output vary between runs (template functions; B2 review m2), flagged like a floating revision. */
  readonly notes: readonly FloatingRef[];
  /** String values in the objects (BuiltObjects.stringLeaves), for the run budget; counted when absent. */
  readonly stringLeaves?: number;
}
