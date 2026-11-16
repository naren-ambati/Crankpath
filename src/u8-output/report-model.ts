// The Report (contract C7's model, BR8.11): one structure every renderer consumes; no renderer
// recomputes a count. Complete in its types now: sections a build does not compute are null and
// named in `notComputed` (statuses and plan until B5), so later bolts fill fields, not sections.
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
import type { NodeStatus, RunStatus, SourceKind, UnresolvedItem } from "../u1-graph-model/status-model.js";
import type { ScannedUrlFrom } from "../u2-intake-config/repo-identity.js";
import type { NotComputed, Plan } from "../u7-graph-analysis/analysis.js";
import type { Cycle } from "../u7-graph-analysis/cycle-finder.js";

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
  /** Null when not detected (this build runs neither tool). */
  readonly helm: string | null;
  readonly kustomize: string | null;
  /** True only when both versions are the tested pair. */
  readonly tested: boolean;
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
  "unspecified-externals",
  "cranks-not-applied",
  "match-not-used",
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
  /** Null when not computed in this build. */
  readonly statuses: readonly NodeStatus[] | null;
  readonly externals: readonly ExternalNode[];
  readonly plan: Plan | null;
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
  /** Cranks declared in crankpath.yaml (applied from B5). */
  readonly cranksDeclared: number;
}
