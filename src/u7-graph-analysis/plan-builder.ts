// PlanBuilder (U7; BR7.15 to BR7.18, BR7.20, FR7.6, FR8.5, OD-15, OD-16, ADR-009): the restoration
// plan, an order and not a schedule. Crank steps come first, in file order, marked manual (OD-15:
// their prerequisites are not modelled). Then layers of startable nodes in dependency order: a
// node's layer is the longest chain of plan nodes it needs, ordered within the layer by sync wave
// then id. Sync waves (within one render job: Argo CD orders waves inside one sync) and
// ordering-only edges (Flux `dependsOn` when an extractor emits it so) are ordering constraints,
// never dependencies: one that a hard dependency contradicts is dropped and listed. Blocked and
// unverified nodes follow the plan, unordered, with their reasons; a `start` step never holds a
// node that is not startable (checked: a bug otherwise). The plan states what it assumes:
// externals declared available, the documented cranks, objects every cluster provides, and the
// fixed not-modelled items (BR7.20). Waves are encoded with one barrier per pair of consecutive
// waves of a job, so a job with thousands of objects per wave costs linear, not quadratic, work.

import type { Edge, ExternalNode, GraphNode, NodeId } from "../u1-graph-model/graph-model.js";
import { compareCodePoints, compareTuples } from "../u1-graph-model/order.js";
import { compareCrankIds, stronglyConnected } from "./cycle-finder.js";
import type { CrankEffect } from "./crank-applier.js";
import type { NodeVerdict, ReasonClass } from "./reachability.js";

/** The plan's required disclaimer (FR8.5, BR7.18, BR8.12). */
export const PLAN_DISCLAIMER = "an order, not a schedule; cold-load pickup is not modelled";

/** The fixed not-modelled list (OD-16, BR7.20): every plan, and every report, is relative to these. */
export const NOT_MODELLED = Object.freeze([
  "a running Argo CD or Flux controller is assumed",
  "dependencies only visible at runtime are not seen",
  "the content of opaque nodes is not seen",
  "the revision each Application names is taken to be the files as read",
  "repository credentials not defined in the estate are not seen",
] as const);

/** Why a start step's nodes may start: fixed words. */
export const START_WHY = "every dependency it has is met before this step";

export interface PlanStep {
  readonly no: number;
  readonly kind: "crank" | "start";
  /** A start step: sorted by sync wave then id. A crank step: the nodes it creates, sorted (its reroutes are in the crank's effect). */
  readonly nodes: readonly NodeId[];
  readonly manual: boolean;
  /** A crank step: the crank's `by` (repo text, quoted on output); a start step: START_WHY. */
  readonly why: string;
  /** The crank id of a crank step, else null. */
  readonly crank: string | null;
  /** The crank's `ref` (repo text), else null. */
  readonly ref: string | null;
}

export type PlanConflict =
  | {
      readonly kind: "sync-wave";
      /** The render job whose waves were dropped (`<owner id>#<n>`). */
      readonly job: string;
      readonly fromWave: number;
      readonly toWave: number;
    }
  | { readonly kind: "ordering-edge"; readonly from: NodeId; readonly to: NodeId };

export interface Plan {
  readonly assumes: {
    /** Externals declared available. */
    readonly externals: readonly NodeId[];
    /** The cranks the plan relies on (matched): documented, not verified. */
    readonly cranks: readonly string[];
    /** Objects every cluster provides (the dated list), referenced in the estate. */
    readonly clusterProvided: readonly NodeId[];
    /** Externals `served_by` an in-estate node (declared, not verified). */
    readonly servedBy: readonly NodeId[];
    /** `match:` entries the graph relies on (they overrode a host), in file order. */
    readonly matchEntries: readonly string[];
    /** The namespace taken to be Argo CD's (assumed or derived by the credential extractor), sorted. */
    readonly argocdNamespace: readonly NodeId[];
    readonly notModelled: readonly string[];
  };
  readonly steps: readonly PlanStep[];
  /** Ordering constraints dropped because a hard dependency contradicts them (BR7.16). */
  readonly conflicts: readonly PlanConflict[];
  readonly disclaimer: typeof PLAN_DISCLAIMER;
  /** Blocked and unverified nodes, after the plan, unordered, with a reason (BR7.17). */
  readonly listedUnordered: readonly {
    readonly node: NodeId;
    readonly status: "blocked" | "unverified";
    readonly reason: ReasonClass;
    readonly blockers: readonly string[];
  }[];
}

export interface PlanInput {
  /** Sorted by id. */
  readonly nodes: readonly GraphNode[];
  readonly externals: readonly ExternalNode[];
  /** The crank-applied graph's edges (hard and ordering-only). */
  readonly edges: readonly Edge[];
  readonly verdicts: readonly NodeVerdict[];
  readonly created: ReadonlySet<NodeId>;
  /** In file order. */
  readonly effects: readonly CrankEffect[];
  readonly matchEntries: readonly string[];
  /** The namespaces the credential extractor took to be Argo CD's (from its assumed or derived items). */
  readonly argocdNamespace?: readonly NodeId[];
}

export class PlanConstructionError extends Error {}

function compareConflicts(a: PlanConflict, b: PlanConflict): number {
  if (a.kind === "sync-wave" && b.kind === "sync-wave")
    return compareCodePoints(a.job, b.job) || a.fromWave - b.fromWave || a.toWave - b.toWave;
  if (a.kind === "ordering-edge" && b.kind === "ordering-edge") return compareTuples([a.from, a.to], [b.from, b.to]);
  return a.kind === "sync-wave" ? -1 : 1;
}

export function buildPlan(input: PlanInput): Plan {
  const verdictOf = new Map(input.verdicts.map((v) => [v.node, v]));
  const inPlan = input.nodes.filter(
    (n) =>
      verdictOf.get(n.id)?.status === "startable" &&
      n.kind !== "External" &&
      !input.created.has(n.id) &&
      !n.flags.includes("cluster-provided"),
  );
  const index = new Map(inPlan.map((n, i) => [n.id, i]));
  const real = inPlan.length;

  // Combined graph: plan nodes, then one barrier per pair of consecutive waves of a job.
  // deps[v] lists what v must follow; `soft` marks an ordering constraint.
  const deps: { to: number; soft: boolean; ordering?: { from: NodeId; to: NodeId } }[][] = inPlan.map(() => []);
  for (const e of input.edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    (deps[a] as (typeof deps)[number]).push(
      e.orderingOnly ? { to: b, soft: true, ordering: { from: e.from, to: e.to } } : { to: b, soft: false },
    );
  }
  const barriers: { job: string; fromWave: number; toWave: number }[] = [];
  const byJob = new Map<string, number[]>();
  inPlan.forEach((n, i) => {
    if (n.origin.renderJob === null) return;
    const list = byJob.get(n.origin.renderJob) ?? [];
    list.push(i);
    byJob.set(n.origin.renderJob, list);
  });
  const waveOf = (i: number) => (inPlan[i] as GraphNode).syncWave ?? 0;
  for (const job of [...byJob.keys()].sort(compareCodePoints)) {
    const members = byJob.get(job) as number[];
    const byWave = new Map<number, number[]>();
    for (const i of members) {
      const list = byWave.get(waveOf(i));
      if (list === undefined) byWave.set(waveOf(i), [i]);
      else list.push(i);
    }
    const waves = [...byWave.keys()].sort((x, y) => x - y);
    for (let w = 0; w + 1 < waves.length; w++) {
      const b = real + barriers.length;
      barriers.push({ job, fromWave: waves[w] as number, toWave: waves[w + 1] as number });
      deps.push((byWave.get(waves[w] as number) as number[]).map((i) => ({ to: i, soft: true })));
      for (const i of byWave.get(waves[w + 1] as number) as number[])
        (deps[i] as (typeof deps)[number]).push({ to: b, soft: true });
    }
  }
  const total = deps.length;

  // A soft constraint on a cycle of the combined graph contradicts a hard dependency (hard edges
  // among startable nodes form no cycle): drop every soft constraint inside such a component.
  const comps = stronglyConnected(
    total,
    deps.map((d) => [...new Set(d.map((x) => x.to))].sort((x, y) => x - y)),
  );
  const compOf = new Int32Array(total);
  comps.forEach((c, i) => {
    for (const v of c) compOf[v] = i;
  });
  const cyclic = new Uint8Array(comps.length);
  comps.forEach((c, i) => {
    if (c.length > 1) cyclic[i] = 1;
  });
  const conflicts: PlanConflict[] = [];
  const droppedBarrier = new Uint8Array(barriers.length);
  barriers.forEach((b, k) => {
    if (cyclic[compOf[real + k] as number] === 1) {
      droppedBarrier[k] = 1;
      conflicts.push(Object.freeze({ kind: "sync-wave", job: b.job, fromWave: b.fromWave, toWave: b.toWave }));
    }
  });
  const kept: number[][] = deps.map((list, v) =>
    list
      .filter((d) => {
        if (v >= real && droppedBarrier[v - real] === 1) return false;
        if (d.to >= real && droppedBarrier[d.to - real] === 1) return false;
        if (d.soft && d.ordering !== undefined && compOf[v] === compOf[d.to] && cyclic[compOf[v] as number] === 1) {
          conflicts.push(Object.freeze({ kind: "ordering-edge", from: d.ordering.from, to: d.ordering.to }));
          return false;
        }
        return true;
      })
      .map((d) => d.to),
  );

  // Earliest start by Kahn's order over what remains (acyclic): a real dependency adds a layer, a
  // barrier none.
  const dependents: number[][] = kept.map(() => []);
  const waiting = new Int32Array(total);
  kept.forEach((list, v) => {
    const uniq = [...new Set(list)];
    waiting[v] = uniq.length;
    for (const d of uniq) (dependents[d] as number[]).push(v);
  });
  const start = new Int32Array(total);
  const queue: number[] = [];
  for (let v = 0; v < total; v++) if (waiting[v] === 0) queue.push(v);
  for (let head = 0; head < queue.length; head++) {
    const d = queue[head] as number;
    const ready = (start[d] as number) + (d < real ? 1 : 0);
    for (const v of dependents[d] as number[]) {
      if (ready > (start[v] as number)) start[v] = ready;
      waiting[v] = (waiting[v] as number) - 1;
      if (waiting[v] === 0) queue.push(v);
    }
  }
  if (queue.length !== total) throw new PlanConstructionError("ordering constraints left a cycle (a bug)");

  const layers = new Map<number, number[]>();
  for (let v = 0; v < real; v++) {
    const l = start[v] as number;
    const list = layers.get(l);
    if (list === undefined) layers.set(l, [v]);
    else list.push(v);
  }
  const steps: PlanStep[] = [];
  for (const e of [...input.effects].filter((x) => x.matched).sort((a, b) => compareCrankIds(a.crank, b.crank))) {
    steps.push(
      Object.freeze({
        no: steps.length + 1,
        kind: "crank",
        nodes: e.createdNodes,
        manual: true,
        why: e.by,
        crank: e.crank,
        ref: e.ref,
      }),
    );
  }
  for (const l of [...layers.keys()].sort((x, y) => x - y)) {
    const members = (layers.get(l) as number[]).map((i) => inPlan[i] as GraphNode);
    members.sort((a, b) => (a.syncWave ?? 0) - (b.syncWave ?? 0) || compareCodePoints(a.id, b.id));
    for (const m of members) {
      if (verdictOf.get(m.id)?.status !== "startable")
        throw new PlanConstructionError("a start step holds a node that is not startable");
    }
    steps.push(
      Object.freeze({
        no: steps.length + 1,
        kind: "start",
        nodes: Object.freeze(members.map((m) => m.id)),
        manual: false,
        why: START_WHY,
        crank: null,
        ref: null,
      }),
    );
  }

  const listedUnordered = input.verdicts
    .filter((v) => v.status !== "startable" && !v.node.startsWith("external:"))
    .map((v) =>
      Object.freeze({
        node: v.node,
        status: v.status as "blocked" | "unverified",
        reason: v.reason as ReasonClass,
        blockers: v.blockers,
      }),
    )
    .sort((a, b) => compareCodePoints(a.node, b.node));

  return Object.freeze({
    assumes: Object.freeze({
      externals: Object.freeze(
        input.externals
          .filter((e) => e.coldStart === "available")
          .map((e) => e.id)
          .sort(compareCodePoints),
      ),
      cranks: Object.freeze(
        input.effects
          .filter((e) => e.matched)
          .map((e) => e.crank)
          .sort(compareCrankIds),
      ),
      clusterProvided: Object.freeze(
        input.nodes
          .filter((n) => n.flags.includes("cluster-provided"))
          .map((n) => n.id)
          .sort(compareCodePoints),
      ),
      servedBy: Object.freeze(
        input.externals
          .filter((e) => e.servedBy !== null)
          .map((e) => e.id)
          .sort(compareCodePoints),
      ),
      matchEntries: Object.freeze([...input.matchEntries]),
      argocdNamespace: Object.freeze([...(input.argocdNamespace ?? [])].sort(compareCodePoints)),
      notModelled: NOT_MODELLED,
    }),
    steps: Object.freeze(steps),
    conflicts: Object.freeze(dedupeConflicts(conflicts.sort(compareConflicts))),
    disclaimer: PLAN_DISCLAIMER,
    listedUnordered: Object.freeze(listedUnordered),
  });
}

function dedupeConflicts(sorted: PlanConflict[]): PlanConflict[] {
  const out: PlanConflict[] = [];
  for (const c of sorted) {
    const prior = out[out.length - 1];
    if (prior !== undefined && compareConflicts(prior, c) === 0) continue;
    out.push(c);
  }
  return out;
}
