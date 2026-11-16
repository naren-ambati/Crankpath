// Render jobs and rendered sets (contract C4, owned here). The job kinds form one closed union:
// `plain` now; B2 adds `helm` and `kustomize` members and their renderers (registered in
// src/u4-render-engine/renderers.ts, the one dispatch point).

import type { RenderedObject, RepoResolution } from "../u1-graph-model/extractor.js";
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

interface JobBase {
  /** `<owner id>#<source index>`. */
  readonly jobId: string;
  /** The source that owns the job: every object it renders is `deployed-by` it. */
  readonly owner: NodeId;
  readonly ownerFile: string;
  /** The owner's field that names what is rendered (evidence of `deployed-by`). */
  readonly ownerField: string;
  readonly ownerRenderedPath: string;
  /** `in-cluster`, or a key of the foreign destination (OD-4). */
  readonly destination: string;
  /** The namespace objects without their own get (destination namespace), or null. */
  readonly namespace: string | null;
  readonly releaseName: string | null;
  readonly valuesInputs: readonly ValuesInput[];
  readonly source: JobSource;
  /** The ApplicationSet that generated the owner (set by generator expansion, B3), or null. */
  readonly generatedBy: NodeId | null;
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

/** Every render job kind. B2 adds HelmJob and KustomizeJob here. */
export type RenderJob = PlainJob;

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
  /** True when a wall-clock backstop stopped the job (B2; OD-30). */
  readonly timedOut: boolean;
  /** String values in the objects (BuiltObjects.stringLeaves), for the run budget; counted when absent. */
  readonly stringLeaves?: number;
}
