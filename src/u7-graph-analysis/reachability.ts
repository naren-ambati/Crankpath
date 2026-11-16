// ReachabilityAnalyzer (U7; BR7.12 to BR7.14, BR7.19, FR7.5, FR4.5, AC1.3.1 to AC1.3.3, NFR3.1):
// the cold-start status of every node on the crank-applied graph. Three values only:
// - `startable`: the least fixed point from nodes with no dependency, externals declared available
//   and crank-created nodes. It means only that no dependency among the edges crankpath read is
//   unmet, given the declared externals and the documented cranks.
// - `blocked`, with a reason class: on (or behind) an uncranked cycle, or behind an external that
//   is declared unavailable or whose cold start is unspecified (UNRESOLVED, never available).
// - `unverified`, with a reason class: opaque or behind an opaque node; a `not-defined` stub (an
//   object no readable source defines and no crank creates) or behind one; the subject of an
//   unresolved item it owns (an ambiguity, a conflict, a dropped reference, a declared edge to
//   nothing) or behind one; or any node at all when an extractor failed or the match budget was
//   spent, since edges may be missing anywhere.
// A blocker outranks a gap (the node cannot start whatever the gap hides); each node names its
// nearest root cause (fewest edges, then the smallest id) and the dependency it comes through
// (`via`), so the chain can be followed node by node. One pass over the components of the graph
// in dependency order: linear in nodes plus edges, no recursion.

import type { Edge, ExternalNode, GraphNode, NodeId } from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import {
  blocked,
  type NodeStatus,
  startable,
  type UnresolvedItem,
  unverified,
} from "../u1-graph-model/status-model.js";
import { stronglyConnected } from "./cycle-finder.js";

export const BLOCKED_REASONS = Object.freeze(["cycle", "external-unavailable", "external-unspecified"] as const);
export const UNVERIFIED_REASONS = Object.freeze([
  "opaque",
  "undefined-reference",
  "unresolved",
  "match-override",
] as const);
export type BlockedReason = (typeof BLOCKED_REASONS)[number];
export type UnverifiedReason = (typeof UNVERIFIED_REASONS)[number];
export type ReasonClass = BlockedReason | UnverifiedReason;

export interface NodeVerdict extends NodeStatus {
  /** The reason class of the named blocker; null only for startable. */
  readonly reason: ReasonClass | null;
  /** The dependency the blocker comes through; null when the node is itself the root cause, or startable. */
  readonly via: NodeId | null;
}

export interface ReachabilityInput {
  /** Sorted by id. */
  readonly nodes: readonly GraphNode[];
  readonly externals: readonly ExternalNode[];
  /** The crank-applied graph's edges (ordering-only edges are ignored here). */
  readonly edges: readonly Edge[];
  readonly created: ReadonlySet<NodeId>;
  /** For each node on a cycle of the crank-applied graph, the reported cycle id. */
  readonly cycleOf: ReadonlyMap<NodeId, string>;
  /** The final unresolved items (after cranks). */
  readonly unresolved: readonly UnresolvedItem[];
  /** For each node on a cycle a `match:` entry hides (found without the entries), that cycle's id. */
  readonly hiddenCycleOf?: ReadonlyMap<NodeId, string>;
}

const RANK: Readonly<Record<ReasonClass, number>> = Object.freeze({
  cycle: 0,
  "external-unavailable": 1,
  "external-unspecified": 2,
  opaque: 3,
  "undefined-reference": 4,
  unresolved: 5,
  "match-override": 6,
});

interface Cause {
  readonly blocking: boolean;
  readonly reason: ReasonClass;
  readonly id: string;
  readonly dist: number;
  readonly via: NodeId | null;
}

function better(a: Cause, b: Cause): boolean {
  if (a.blocking !== b.blocking) return a.blocking;
  if (a.dist !== b.dist) return a.dist < b.dist;
  if (RANK[a.reason] !== RANK[b.reason]) return RANK[a.reason] < RANK[b.reason];
  const byId = compareCodePoints(a.id, b.id);
  if (byId !== 0) return byId < 0;
  return compareCodePoints(a.via ?? "", b.via ?? "") < 0;
}

/** Unresolved items whose owner has its own class (blocked by the external; a not-defined stub). */
const HANDLED_ELSEWHERE: ReadonlySet<string> = new Set(["external-unspecified", "not-defined"]);
/** Unresolved items that name no node of their own and leave every node unverified. */
const RUN_LEVEL: ReadonlySet<string> = new Set(["extractor-failed", "match-limit"]);
/**
 * Unresolved items that leave every node of some kinds unverified: with Argo CD's namespace unknown
 * no credential edge was made, so any Application or ApplicationSet may need a credential unseen.
 */
const KIND_LEVEL: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["argocd-namespace-unknown", new Set(["Application", "ApplicationSet"])],
]);

export function computeStatuses(input: ReachabilityInput): NodeVerdict[] {
  const ids = input.nodes.map((n) => n.id);
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const externals = new Map(input.externals.map((e) => [e.id, e]));
  const own: (Cause | null)[] = ids.map(() => null);
  const offer = (i: number, c: Cause) => {
    const prior = own[i];
    if (prior === null || prior === undefined || better(c, prior)) own[i] = c;
  };
  const local = (i: number, reason: ReasonClass, id: string) => {
    offer(i, { blocking: (BLOCKED_REASONS as readonly string[]).includes(reason), reason, id, dist: 0, via: null });
  };

  // Each item makes the node that owns it unverified (review M2: the owner, not the subject, which
  // may be repo text such as a dropped name). A run-level item (a failed extractor, a spent match
  // budget) names no node: it makes every node unverified, since edges may be missing anywhere.
  const owners = new Set<NodeId>();
  const runLevel: string[] = [];
  const kindLevel = new Map<string, string>();
  for (const u of input.unresolved) {
    const kinds = KIND_LEVEL.get(u.why);
    if (kinds !== undefined) {
      for (const k of kinds)
        if (!kindLevel.has(k) || compareCodePoints(u.subject, kindLevel.get(k) as string) < 0)
          kindLevel.set(k, u.subject);
    } else if (RUN_LEVEL.has(u.why)) runLevel.push(u.subject);
    else if (!HANDLED_ELSEWHERE.has(u.why) && u.owner !== null) owners.add(u.owner);
  }
  const firstFailure = [...runLevel].sort(compareCodePoints)[0];

  input.nodes.forEach((n, i) => {
    const cycle = input.cycleOf.get(n.id);
    if (cycle !== undefined) local(i, "cycle", cycle);
    const ext = externals.get(n.id);
    if (ext !== undefined) {
      if (ext.coldStart === "unavailable") local(i, "external-unavailable", n.id);
      else if (ext.coldStart === "unspecified" && ext.servedBy === null) local(i, "external-unspecified", n.id);
    }
    if (n.opaque !== null) local(i, "opaque", n.id);
    if (n.flags.includes("not-defined") && !input.created.has(n.id)) local(i, "undefined-reference", n.id);
    if (owners.has(n.id)) local(i, "unresolved", n.id);
    const hidden = input.hiddenCycleOf?.get(n.id);
    if (hidden !== undefined) local(i, "match-override", hidden);
    const byKind = kindLevel.get(n.kind);
    if (byKind !== undefined) local(i, "unresolved", byKind);
    if (firstFailure !== undefined) local(i, "unresolved", firstFailure);
  });

  const deps: number[][] = ids.map(() => []);
  for (const e of input.edges) {
    if (e.orderingOnly) continue;
    const a = indexOf.get(e.from);
    const b = indexOf.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    (deps[a] as number[]).push(b);
  }
  // Tarjan emits a component only after every component it depends on: dependencies first.
  const components = stronglyConnected(
    ids.length,
    deps.map((d) => [...new Set(d)].sort((x, y) => x - y)),
  );
  const best: (Cause | null)[] = ids.map(() => null);
  for (const comp of components) {
    const inComp = comp.length > 1 ? new Set(comp) : null;
    for (const v of comp) {
      let c = own[v] ?? null;
      for (const d of deps[v] as number[]) {
        if (inComp?.has(d)) continue; // a cyclic component: every member names its own cycle
        const dc = best[d];
        if (dc === null || dc === undefined) continue;
        const inherited: Cause = {
          blocking: dc.blocking,
          reason: dc.reason,
          id: dc.id,
          dist: dc.dist + 1,
          via: ids[d] as NodeId,
        };
        if (c === null || better(inherited, c)) c = inherited;
      }
      best[v] = c;
    }
  }

  return input.nodes.map((n, i) => {
    const c = best[i] ?? null;
    let status: NodeStatus;
    if (c === null) status = startable(n.id, false);
    else if (c.blocking) status = blocked(n.id, [c.id]);
    else status = unverified(n.id, [c.id]);
    return Object.freeze({ ...status, reason: c === null ? null : c.reason, via: c === null ? null : c.via });
  });
}
