// The analysis interface (contract C9): `analyse(graph, facts)` is pure and deterministic. It finds
// and labels the cycles of the graph as read (CycleFinder), applies the documented cranks
// (CrankApplier), relabels the cycles on the crank-applied graph (`cranked` only when the crank
// really breaks them, US7.4), computes every node's cold-start status (ReachabilityAnalyzer) and
// orders the restoration plan (PlanBuilder). Its unresolved list is the final one: the graph's,
// less the `not-defined` stubs a crank creates (BR7.19), plus unmatched and unused cranks (BR7.9).

import type { ConfigDocument } from "../u1-graph-model/declared-facts.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import type { UnresolvedItem } from "../u1-graph-model/status-model.js";
import { applyCranks, type CrankEffect } from "./crank-applier.js";
import { type Cycle, findCycles, relabelAfterCranks } from "./cycle-finder.js";
import { compareUnresolved, type EstateGraph } from "./graph-builder.js";
import { buildPlan, NOT_MODELLED, PLAN_DISCLAIMER, type Plan } from "./plan-builder.js";
import { computeStatuses, type NodeVerdict } from "./reachability.js";

export type { CrankEffect } from "./crank-applier.js";
export type { HiddenCycle } from "./match-overrides.js";
export type { Plan, PlanConflict, PlanStep } from "./plan-builder.js";
export type { NodeVerdict, ReasonClass } from "./reachability.js";
export { NOT_MODELLED, PLAN_DISCLAIMER };

/** Parts of the analysis a build may not compute, as fixed words (none since B5; kept for the contract). */
export type NotComputed = "cranks" | "plan" | "statuses";

export interface AnalysisResult {
  /** Sorted by id. */
  readonly cycles: readonly Cycle[];
  /** One per node, sorted by node id. */
  readonly verdicts: readonly NodeVerdict[];
  readonly plan: Plan;
  /** In file order. */
  readonly crankEffects: readonly CrankEffect[];
  /** The final unresolved items, sorted. */
  readonly unresolved: readonly UnresolvedItem[];
  /** Sorted; empty in this build. */
  readonly notComputed: readonly NotComputed[];
}

export interface AnalyseOptions {
  /** Key paths of the `match:` entries the graph relies on (entries that overrode a host), in file order. */
  readonly matchEntries?: readonly string[];
  /** Cycles a `match:` entry hides: their nodes are unverified (B5 review pass 2, m1). */
  readonly hiddenCycles?: readonly { readonly id: string; readonly nodeIds: readonly string[] }[];
}

export function analyse(graph: EstateGraph, facts: ConfigDocument, options: AnalyseOptions = {}): AnalysisResult {
  const ids = graph.nodes.map((n) => n.id);
  const found = findCycles(ids, graph.edges);
  const cranked = applyCranks(graph.nodes, graph.edges, facts.cranks, facts.file ?? "crankpath.yaml");
  const relabelled = relabelAfterCranks(found, {
    nodeIds: ids,
    edges: graph.edges,
    crankedEdges: cranked.edges,
    removedBy: cranked.removedBy,
    addedBy: cranked.addedBy,
  });
  const seen = new Set<string>();
  const unresolved = [
    ...graph.unresolved.filter((u) => !(u.why === "not-defined" && cranked.created.has(u.subject))),
    ...cranked.unresolved,
  ]
    .sort(compareUnresolved)
    .filter((u) => {
      const key = `${u.subject}\n${u.why}\n${u.where}\n${u.field ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const verdicts = computeStatuses({
    nodes: graph.nodes,
    externals: graph.externals,
    edges: cranked.edges,
    created: cranked.created,
    cycleOf: relabelled.cycleOf,
    unresolved,
    hiddenCycleOf: new Map((options.hiddenCycles ?? []).flatMap((h) => h.nodeIds.map((n) => [n, h.id] as const))),
  }).sort((a, b) => compareCodePoints(a.node, b.node));
  const plan = buildPlan({
    nodes: graph.nodes,
    externals: graph.externals,
    edges: cranked.edges,
    verdicts,
    created: cranked.created,
    effects: cranked.effects,
    matchEntries: options.matchEntries ?? [],
    argocdNamespace: [
      ...new Set(
        unresolved
          .filter((u) => u.why === "argocd-namespace-assumed" || u.why === "argocd-namespace-derived")
          .map((u) => u.subject),
      ),
    ],
  });
  return Object.freeze({
    cycles: relabelled.cycles,
    verdicts: Object.freeze(verdicts),
    plan,
    crankEffects: cranked.effects,
    unresolved: Object.freeze(unresolved),
    notComputed: Object.freeze([] as NotComputed[]),
  });
}
