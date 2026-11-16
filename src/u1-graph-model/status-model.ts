// StatusModel (U1; BR1.7 to BR1.10): the honest vocabularies. A node status is exactly one of
// startable, blocked (with blockers) or unverified, and `startable` cannot be built over an opaque
// dependency closure; a run status is derived from counts, never assigned; an unspecified value is
// an UnresolvedItem with no conversion to a boolean; and the words that would claim a clean result
// are named here so one guard can look for them.

import type { NodeId } from "./graph-model.js";
import { sortedUnique } from "./order.js";

export type CycleLabel = "extracted" | "declared (unverified)" | "cranked";

export type NodeStatusKind = "startable" | "blocked" | "unverified";

export interface NodeStatus {
  readonly node: NodeId;
  readonly status: NodeStatusKind;
  /** Named blockers (cycle ids, external ids, opaque node ids, unresolved subjects); empty only for startable. */
  readonly blockers: readonly string[];
}

export class StatusConstructionError extends Error {}

/** `startable` only when nothing in the dependency closure is opaque or unresolved (BR1.8). */
export function startable(node: NodeId, closureHasGap: boolean): NodeStatus {
  if (closureHasGap) throw new StatusConstructionError("startable refused: the dependency closure has a gap");
  return Object.freeze({ node, status: "startable", blockers: Object.freeze([]) });
}

export function blocked(node: NodeId, blockers: readonly string[]): NodeStatus {
  if (blockers.length === 0) throw new StatusConstructionError("blocked needs at least one named blocker");
  return Object.freeze({ node, status: "blocked", blockers: Object.freeze([...blockers]) });
}

export function unverified(node: NodeId, blockers: readonly string[]): NodeStatus {
  if (blockers.length === 0) throw new StatusConstructionError("unverified needs at least one named reason");
  return Object.freeze({ node, status: "unverified", blockers: Object.freeze([...blockers]) });
}

/** Why an item is unresolved: fixed words, printed bare. */
export const UNRESOLVED_WHY = Object.freeze([
  "conflicting-definitions",
  "declared-edge-endpoint-missing",
  "external-unspecified",
  "extractor-failed",
  "host-ambiguous",
  "invalid-reference",
  "invalid-sync-wave",
  "not-defined",
  "selector-ambiguous",
  "selector-invalid",
  "served-by-missing",
] as const);
export type UnresolvedWhy = (typeof UNRESOLVED_WHY)[number];

export interface UnresolvedItem {
  /** What is unresolved: a node id, or repo text (quoted on output). */
  readonly subject: string;
  readonly why: UnresolvedWhy;
  /** Where it was found: a rendered path or `crankpath.yaml` (quoted on output). */
  readonly where: string;
  /** The field (crankpath's notation) or config key path, or null. */
  readonly field: string | null;
  /** Node ids involved (candidates of an ambiguity), sorted; possibly only the first ones (see below). */
  readonly candidates: readonly NodeId[];
  /** True when more candidates exist than are listed (a selector stops at its third match). */
  readonly candidatesTruncated: boolean;
}

export function unresolvedItem(
  subject: string,
  why: UnresolvedWhy,
  where: string,
  field: string | null,
  candidates: readonly NodeId[] = [],
  candidatesTruncated = false,
): UnresolvedItem {
  if (!(UNRESOLVED_WHY as readonly string[]).includes(why)) throw new StatusConstructionError("unresolved why");
  return Object.freeze({
    subject,
    why,
    where,
    field,
    candidates: Object.freeze(sortedUnique(candidates)),
    candidatesTruncated,
  });
}

export type RunState = "ANALYSED" | "ANALYSED WITH GAPS" | "NOTHING ANALYSED";

export const SOURCE_KINDS = Object.freeze([
  "Application",
  "ApplicationSet",
  "Kustomization",
  "HelmRelease",
  "KustomizeRoot",
] as const);
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface RunCounts {
  readonly sourcesFound: number;
  readonly sourcesByKind: Readonly<Record<SourceKind, number>>;
  readonly rendered: number;
  readonly opaque: number;
  readonly opaqueApplicationSets: number;
  readonly unresolved: number;
  /** Objects skipped (a name that is not Kubernetes syntax, a document that is not an object). */
  readonly skipped: number;
  /** Of those, source documents (they are missing from the opacity denominator). */
  readonly skippedSources: number;
  readonly unreadableFiles: number;
  /** Files that hold no source document (they may still be read by a render). */
  readonly ignoredFiles: number;
  /** Helm test hooks dropped from Helm renders (BR4.6): counted and shown, not a gap. */
  readonly droppedHooks: number;
  /** Objects of a foreign destination: left out of Service and host matching (BR5.4). */
  readonly foreignDestination: number;
  /** The run's memory budget (run-limits.ts): files not read, jobs not taken in, edges not kept. */
  readonly runLimitFiles: number;
  readonly runLimitJobs: number;
  readonly runLimitEdges: number;
  readonly timeouts: number;
  readonly edgesExtracted: number;
  readonly edgesDeclared: number;
  readonly nodes: number;
}

/** Why a run has gaps: fixed words, in this order. */
export const GAP_REASONS = Object.freeze([
  "opaque-sources",
  "unreadable-files",
  "skipped-objects",
  "unresolved-items",
  "timeouts",
  "no-dependency-edges",
  "run-limit",
  "not-computed",
] as const);
export type GapReason = (typeof GAP_REASONS)[number] | "no-sources";

export interface RunStatus {
  readonly state: RunState;
  /** Sorted gap reasons; empty only for ANALYSED. */
  readonly reasons: readonly GapReason[];
  readonly counts: RunCounts;
  /** True when the opaque count is a lower bound (FR4.4). */
  readonly floor: boolean;
}

/**
 * Derives the run status from counts (BR1.10): NOTHING ANALYSED with zero sources; ANALYSED only
 * when there is no gap of any kind (including a part of the analysis this build does not compute);
 * ANALYSED WITH GAPS otherwise. There is no other way to make a RunStatus.
 */
export function deriveRunStatus(counts: RunCounts, notComputed: readonly string[]): RunStatus {
  const floor =
    counts.unreadableFiles > 0 ||
    counts.opaqueApplicationSets > 0 ||
    counts.timeouts > 0 ||
    counts.skippedSources > 0 ||
    counts.runLimitFiles > 0 ||
    counts.runLimitJobs > 0 ||
    counts.runLimitEdges > 0;
  // A run where the budget refused something cannot say nothing was there: it has gaps.
  const limited = counts.runLimitFiles + counts.runLimitJobs + counts.runLimitEdges > 0;
  if (counts.sourcesFound === 0 && !limited) {
    const reasons: readonly GapReason[] = Object.freeze(["no-sources"]);
    return Object.freeze({ state: "NOTHING ANALYSED", reasons, counts, floor });
  }
  const has: Record<(typeof GAP_REASONS)[number], boolean> = {
    "opaque-sources": counts.opaque > 0,
    "unreadable-files": counts.unreadableFiles > 0,
    "skipped-objects": counts.skipped > 0,
    "unresolved-items": counts.unresolved > 0,
    timeouts: counts.timeouts > 0,
    "no-dependency-edges": counts.edgesExtracted === 0,
    "run-limit": counts.runLimitFiles + counts.runLimitJobs + counts.runLimitEdges > 0,
    "not-computed": notComputed.length > 0,
  };
  const reasons = GAP_REASONS.filter((r) => has[r]).sort();
  return Object.freeze({
    state: reasons.length === 0 ? "ANALYSED" : "ANALYSED WITH GAPS",
    reasons: Object.freeze(reasons),
    counts,
    floor,
  });
}

/**
 * Words that would claim a clean result (NFR3). crankpath's own text never uses them; repo text
 * may hold them, but only inside a quoted value.
 */
export const CLAIM_WORDS = Object.freeze(["OK", "GREEN", "PASSED", "PASS", "CLEAN", "SAFE", "COMPLETE"] as const);

/**
 * The claim words found in crankpath's own voice: the text with every quoted value (a `"` run with
 * `\"` and `\\` escapes) removed, matched as whole words in any case, plus a bare `no cycles`.
 */
export function claimWordsInOwnVoice(text: string): string[] {
  const own = text.replace(/"(?:[^"\\]|\\.)*"/gs, '""');
  const found = new Set<string>();
  for (const word of CLAIM_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(own)) found.add(word);
  }
  if (/\bno cycles\b/i.test(own)) found.add("no cycles");
  return [...found].sort();
}
