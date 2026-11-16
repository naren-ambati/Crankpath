// The analysis interface (contract C9): `analyse(graph, facts)` is pure and deterministic. This
// build computes cycles; node statuses, the plan and crank effects are B5's (CrankApplier,
// ReachabilityAnalyzer, PlanBuilder in this folder). Until then each is null and named in
// `notComputed`, so the report says so in fixed words and the run never reads as fully analysed.

import type { ConfigDocument } from "../u1-graph-model/declared-facts.js";
import type { NodeId } from "../u1-graph-model/graph-model.js";
import type { NodeStatus, UnresolvedItem } from "../u1-graph-model/status-model.js";
import { type Cycle, findCycles } from "./cycle-finder.js";
import type { EstateGraph } from "./graph-builder.js";

/** The plan's required disclaimer (FR8.5, BR7.18, BR8.12). */
export const PLAN_DISCLAIMER = "an order, not a schedule; cold-load pickup is not modelled";

/** The fixed not-modelled list (OD-16, BR7.20): every plan, and every report, is relative to these. */
export const NOT_MODELLED = Object.freeze([
  "a running Argo CD or Flux controller is assumed",
  "dependencies only visible at runtime are not seen",
  "the content of opaque nodes is not seen",
  "the revision each Application names is taken to be the files as read",
] as const);

export interface PlanStep {
  readonly no: number;
  readonly kind: "crank" | "start";
  readonly nodes: readonly NodeId[];
  readonly manual: boolean;
  readonly why: string;
}

export interface Plan {
  readonly assumes: {
    /** Externals declared available. */
    readonly externals: readonly NodeId[];
    /** Cranks the plan relies on: documented, not verified. */
    readonly cranks: readonly string[];
    readonly notModelled: readonly string[];
  };
  readonly steps: readonly PlanStep[];
  /** Wave constraints dropped because a hard dependency contradicts them. */
  readonly conflicts: readonly string[];
  readonly disclaimer: typeof PLAN_DISCLAIMER;
  /** Blocked and unverified nodes, after the plan, unordered, with a reason. */
  readonly listedUnordered: readonly { readonly node: NodeId; readonly reason: string }[];
}

export interface CrankEffect {
  readonly crank: string;
  readonly createdNodes: readonly NodeId[];
  readonly reroutedEdges: readonly { readonly from: NodeId; readonly to: NodeId }[];
  readonly matched: boolean;
}

/** Parts of the analysis a build may not compute yet, as fixed words. */
export type NotComputed = "cranks" | "plan" | "statuses";

export interface AnalysisResult {
  readonly cycles: readonly Cycle[];
  /** Null when not computed in this build. */
  readonly verdicts: readonly NodeStatus[] | null;
  readonly plan: Plan | null;
  readonly crankEffects: readonly CrankEffect[] | null;
  readonly unresolved: readonly UnresolvedItem[];
  /** Sorted. */
  readonly notComputed: readonly NotComputed[];
}

export function analyse(graph: EstateGraph, facts: ConfigDocument): AnalysisResult {
  const cycles = findCycles(
    graph.nodes.map((n) => n.id),
    graph.edges,
  );
  const notComputed: NotComputed[] = ["plan", "statuses"];
  if (facts.cranks.length > 0) notComputed.unshift("cranks");
  return Object.freeze({
    cycles: Object.freeze(cycles),
    verdicts: null,
    plan: null,
    crankEffects: null,
    unresolved: Object.freeze([]),
    notComputed: Object.freeze(notComputed),
  });
}
