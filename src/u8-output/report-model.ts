// The Report (contract C7's model, BR8.11): one structure every renderer consumes; no renderer
// recomputes a count. Complete in its types now: sections a build does not compute are null and
// named in `notComputed` (statuses and plan until B5), so later bolts fill fields, not sections.
// Since B5 every section is computed: statuses, the plan and the crank effects are always present,
// with the counts the text needs (status counts, the not-startable groups) assembled here once.
// Every string from the scanned repo is held raw here and escaped by each renderer for its
// destination (SafeText), except URLs, which are held with their userinfo already removed.

import type {
  Edge,
  ExternalNode,
  GraphNode,
  NodeId,
  OpaqueMark,
  SkippedObject,
  UnreadableFile,
} from "../u1-graph-model/graph-model.js";
import type { MatchRule } from "../u1-graph-model/declared-facts.js";
import type { NodeStatusKind, RunStatus, SourceKind, UnresolvedItem } from "../u1-graph-model/status-model.js";
import type { ScannedUrlFrom } from "../u2-intake-config/repo-identity.js";
import type { MatchOverride } from "../u1-graph-model/extractor.js";
import type {
  CrankEffect,
  HiddenCycle,
  NodeVerdict,
  NotComputed,
  Plan,
  ReasonClass,
} from "../u7-graph-analysis/analysis.js";
import type { Cycle } from "../u7-graph-analysis/cycle-finder.js";
import type { ControllerMatch } from "../u5-extractors-gitops/controller-signatures.js";

export const SCHEMA_VERSION = 1;

export interface ReportRepo {
  /** The scanned repo's URL with userinfo removed; null when unknown or unparseable. */
  readonly url: string | null;
  readonly urlFrom: ScannedUrlFrom | null;
  /** False when the URL is known but cannot be compared (only explicit mappings apply). */
  readonly comparable: boolean;
  readonly commit: string | null;
  readonly floating: boolean;
}

export interface ReportToolchain {
  readonly crankpath: string;
  /** The version found (`vX.Y.Z`), or null when the tool is missing or its version could not be read. */
  readonly helm: string | null;
  readonly kustomize: string | null;
  /** True only when both versions are the tested pair. */
  readonly tested: boolean;
  /** The tested pair (OD-13), named in the note when another version is in use. */
  readonly testedPair: { readonly helm: string; readonly kustomize: string };
  /** Tools not found on PATH, sorted. */
  readonly missing: readonly ("helm" | "kustomize")[];
  /** Tools found whose version could not be read, sorted. */
  readonly unrecognised: readonly ("helm" | "kustomize")[];
  /** Why an unrecognised tool's version command did not succeed (text output only; B2 review pass 3, m6). */
  readonly problems?: Readonly<Partial<Record<"helm" | "kustomize", "script" | "failed">>>;
}

/** A floating revision or chart version (OD-12): flagged, with the chart version helm rendered. */
export interface FloatingRevision {
  readonly node: NodeId;
  readonly field: string;
  /** The value as written in the repo (repo text). */
  readonly value: string;
  /** The chart version rendered, for a chart from a repository; null for a Git revision (read as checked out). */
  readonly resolved: string | null;
}

export interface OpaqueEntry extends OpaqueMark {
  /** The opaque node, or null for a Kustomize root (which is a source but not an object). */
  readonly node: NodeId | null;
  readonly kustomizeRoot: string | null;
  readonly sourceKind: SourceKind;
}

/** What the closing line names as not verified: fixed codes in a fixed order, with counts. */
export const NOT_VERIFIED_ITEMS = Object.freeze([
  "opaque-sources",
  "unreadable-files",
  "skipped-objects",
  "foreign-destination-objects",
  "run-limit",
  "unresolved-items",
  "timeouts",
  "uncranked-cycles",
  "unverified-nodes",
  "unspecified-externals",
  "externals-declared",
  "cranks-documented",
  "match-entries-relied",
  "repo-mappings",
  "match-unused",
  "cluster-provided",
  "clusters-not-used",
  "fetch-not-used",
  "not-computed",
  "declared-edges",
] as const);
export type NotVerifiedItem = (typeof NOT_VERIFIED_ITEMS)[number];

export interface Report {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly repo: ReportRepo;
  readonly toolchain: ReportToolchain;
  readonly runStatus: RunStatus;
  /** Sorted by id. */
  readonly nodes: readonly GraphNode[];
  /** Sorted by (from, to, kind, source). */
  readonly edges: readonly Edge[];
  /** Sorted by node (or Kustomize root). */
  readonly opaque: readonly OpaqueEntry[];
  /** Sorted by id. */
  readonly cycles: readonly Cycle[];
  /** One verdict per node (externals included), sorted by node id. */
  readonly statuses: readonly NodeVerdict[];
  /** Status counts over the estate's nodes (externals are counted in their own section). */
  readonly statusCounts: Readonly<Record<NodeStatusKind, number>>;
  /** The nodes not startable, grouped by their named blocker, in a fixed order (text only). */
  readonly notStartable: readonly NotStartableGroup[];
  readonly externals: readonly ExternalNode[];
  readonly plan: Plan;
  /** Every crank of crankpath.yaml and what it did, in file order. */
  readonly cranks: readonly CrankEffect[];
  /** `match:` entries that matched no host, in file order (AC2.3.4). */
  readonly unusedMatches: readonly MatchRule[];
  /** Hosts a `match:` entry resolved otherwise than the extracted rules (review M1). */
  readonly matchOverrides: readonly MatchOverride[];
  /** Repository mappings (`repos:` of crankpath.yaml, `--repo-alias`), URL userinfo removed, sorted. */
  readonly repoMappings: readonly RepoMappingEntry[];
  /** Entries of crankpath.yaml's `clusters:` block a clusters generator used (declared facts, B3), sorted. */
  readonly clustersUsed: readonly string[];
  /** Cycles of the graph without the `match:` entries that the report does not hold (review M1). */
  readonly hiddenCycles: readonly HiddenCycle[];
  readonly unresolved: readonly UnresolvedItem[];
  /** Sorted by (file, document, item). */
  readonly skipped: readonly SkippedObject[];
  /** Sorted by path. */
  readonly unreadable: readonly UnreadableFile[];
  readonly notComputed: readonly NotComputed[];
  readonly notModelled: readonly string[];
  /** Items with a count above zero, in NOT_VERIFIED_ITEMS order; `declared-edges` always. */
  readonly notVerified: readonly { readonly item: NotVerifiedItem; readonly count: number }[];
  /**
   * For the text report only (never in JSON): the scanned path as given when relative, else only its
   * last segment (`scannedPathAbsolute`), so no output holds a machine path.
   */
  readonly scannedPath: string;
  readonly scannedPathAbsolute: boolean;
  /** Cranks declared in crankpath.yaml. */
  readonly cranksDeclared: number;
  /** Sorted by (node, field). */
  readonly floating: readonly FloatingRevision[];
  /** Kustomize roots no Application or Flux Kustomization renders: built on their own, objects not in the graph. Sorted. */
  readonly undeployedKustomizeRoots: readonly string[];
  /** Sources opaque `tool-missing`, by the tool they need. */
  readonly toolMissing: { readonly helm: number; readonly kustomize: number };
  /**
   * For --explain only (never in JSON, text or Mermaid): rendered objects that match a GitOps
   * controller signature, with the source that rendered them (US5.4). Explanatory: nothing else in
   * the Report depends on it (BR5.13).
   */
  readonly controllerMatches: readonly ControllerMatch[];
}

export interface RepoMappingEntry {
  readonly url: string;
  /** The root read: a path inside the scanned root, `fetch:N` (a fetched entry), `(fetch)` (not fetched), or an `alias:N` label. */
  readonly root: string;
  /** `crankpath.yaml`: a declared fact of the scanned repo; `--repo-alias`: the user's own input. */
  readonly from: "crankpath.yaml" | "--repo-alias";
  /** True when some source was read through it. */
  readonly used: boolean;
  /** A fetched entry's resolved commit (OD-12), else null. */
  readonly commit?: string | null;
  /** True when a fetched entry's revision is a branch, a tag or the default branch. */
  readonly floating?: boolean;
  /** Why a fetch entry could not be read (crankpath's fixed words), else null. */
  readonly failure?: string | null;
}

export interface NotStartableGroup {
  readonly status: Exclude<NodeStatusKind, "startable">;
  readonly reason: ReasonClass;
  /** The named blocker: a cycle id or a node id. */
  readonly blocker: string;
  /** For a cycle blocker, the cycle's label (and whether a reroute introduced it); else null. */
  readonly cycleLabel: string | null;
  /** Sorted by node id. */
  readonly nodes: readonly { readonly node: NodeId; readonly via: NodeId | null }[];
}
