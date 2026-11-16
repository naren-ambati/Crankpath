// The extractor interface (contract C3, ADR-002): an extractor is a pure function from the rendered
// objects and a context to nodes, edges, opaque marks and unresolved items. No I/O; every edge
// carries evidence; objects of a kind it does not read are ignored and counted; output is sorted
// by the caller (GraphBuilder), so an extractor's order never reaches the report.
//
// The shapes extractors read from other units (RepoResolution of C5, HostMatch of HostMatcher) are
// plain data, defined here so this unit depends on no other.

import type { ConfigDocument } from "./declared-facts.js";
import type {
  Edge,
  ExternalNode,
  GraphNode,
  NodeFlag,
  NodeId,
  OpaqueMark,
  Origin,
  RepoSuggestion,
} from "./graph-model.js";
import type { UnresolvedItem } from "./status-model.js";

/** A value of a parsed document (structurally the BoundedReader's YamlValue). */
export type DataValue = null | boolean | number | string | DataValue[] | { [key: string]: DataValue };
export type DataMap = { readonly [key: string]: DataValue };

/**
 * One Kubernetes object from a render or read directly by discovery. Its id is already canonical
 * (objects whose names are not Kubernetes names never get here). Secret `data` and `stringData`
 * are gone, except an Argo credential Secret's `url` (userinfo removed) in `credentialUrl` (FR1.7).
 */
export interface RenderedObject {
  readonly id: NodeId;
  readonly apiVersion: string;
  readonly kind: string;
  /** The effective namespace (its own, else the render's default); null when cluster-scoped. */
  readonly namespace: string | null;
  readonly name: string;
  /** String-valued labels and annotations only (Kubernetes accepts no other). */
  readonly labels: Readonly<Record<string, string>>;
  readonly annotations: Readonly<Record<string, string>>;
  /** The whole object as read, Secret values removed. Shared structure: never mutate. */
  readonly body: DataMap;
  readonly origin: Origin;
  readonly renderedPath: string;
  /** The ApplicationSet that generated this Application (set by generator expansion), or null. */
  readonly generatedBy: NodeId | null;
  readonly credentialUrl: string | null;
  /** A digest of the object's content and destination, to tell one object from a same-id conflict. */
  readonly digest: string;
}

/** How a repoURL resolves (contract C5). `root` is a label (`.`, `alias:N`, a `read_from` path), never a disk path. */
export interface RepoResolution {
  readonly outcome: "self" | "alias" | "unreadable";
  readonly root: string | null;
  readonly via: "scanned-url" | "repo-alias" | "repos-read-from" | "repos-fetch" | "none" | "not-comparable";
  readonly suggestion: RepoSuggestion | null;
}

export interface HostQuery {
  /** The host as found in a named field (never from free text, BR6.16). */
  readonly host: string;
  /** The named field, for evidence. */
  readonly field: string;
  /** The namespace a bare `svc` host resolves in, when the field's rules state one; else null. */
  readonly bareNamespace: string | null;
}

export interface HostMatch {
  readonly outcome: "unique" | "none" | "ambiguous";
  readonly node: NodeId | null;
  /** Every candidate the host matches, sorted (more than one when ambiguous); HostMatcher lists them all. */
  readonly candidates: readonly NodeId[];
}

/** What a render job is, for the extractors that relate objects to the source that rendered them. */
export interface JobInfo {
  readonly jobId: string;
  /** The source that owns the job (an Application now; a Flux object later). */
  readonly owner: NodeId;
  /** Evidence of the ownership: the owner's file and the field that names the rendered path. */
  readonly ownerFile: string;
  readonly ownerField: string;
  readonly ownerRenderedPath: string;
  /** `in-cluster`, or a key naming the foreign destination (OD-4). */
  readonly destination: string;
}

export const IN_CLUSTER = "in-cluster";

export interface ExtractContext {
  resolveRepo(url: string): RepoResolution;
  matchHost(query: HostQuery): HostMatch;
  readonly config: ConfigDocument;
  readonly jobs: ReadonlyMap<string, JobInfo>;
}

export interface ExtractResult {
  /** Nodes not backed by a rendered object (for example a stub an extractor must name). */
  readonly nodes: readonly GraphNode[];
  readonly externals: readonly ExternalNode[];
  readonly edges: readonly Edge[];
  readonly opaque: readonly { readonly node: NodeId; readonly mark: OpaqueMark }[];
  readonly unresolved: readonly UnresolvedItem[];
  readonly flags: readonly { readonly node: NodeId; readonly flag: NodeFlag }[];
  /** Sync waves: ordering attributes, never edges (BR5.3). */
  readonly syncWaves: readonly { readonly node: NodeId; readonly wave: number }[];
  /** Objects of a kind this extractor does not read. */
  readonly ignoredKinds: number;
}

export interface Extractor {
  /** A fixed name, for a failure item when the extractor throws. */
  readonly name: string;
  readonly extract: (objects: readonly RenderedObject[], ctx: ExtractContext) => ExtractResult;
}

/** An empty result to build on. */
export function emptyResult(): {
  nodes: GraphNode[];
  externals: ExternalNode[];
  edges: Edge[];
  opaque: { node: NodeId; mark: OpaqueMark }[];
  unresolved: UnresolvedItem[];
  flags: { node: NodeId; flag: NodeFlag }[];
  syncWaves: { node: NodeId; wave: number }[];
  ignoredKinds: number;
} {
  return { nodes: [], externals: [], edges: [], opaque: [], unresolved: [], flags: [], syncWaves: [], ignoredKinds: 0 };
}

/** Reads `obj.a.b[2].c`-style paths without throwing: undefined when any step is missing. */
export function getPath(value: DataValue | undefined, path: readonly (string | number)[]): DataValue | undefined {
  let current: DataValue | undefined = value;
  for (const step of path) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (typeof step === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[step];
    } else {
      if (Array.isArray(current)) return undefined;
      current = Object.hasOwn(current, step) ? current[step] : undefined;
    }
  }
  return current;
}

export function isDataMap(value: DataValue | undefined): value is { [key: string]: DataValue } {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

export function asArray(value: DataValue | undefined): readonly DataValue[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: DataValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
