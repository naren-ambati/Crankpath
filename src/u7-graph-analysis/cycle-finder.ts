// CycleFinder (U7; BR7.3 to BR7.6, FR7.2, FR7.3, ADR-011, OD-2, OD-22): cycles are the strongly
// connected components of size above one, and self-loops, found by an iterative Tarjan pass (an
// explicit stack: a 100,000-node chain cannot overflow it). Each cycle has its full node and edge
// set, one shortest representative cycle (breadth-first from its smallest id, ties by sorted ids),
// and a stable id from its sorted node set. Ordering-only edges are never part of a cycle.
//
// Labels: components on extracted edges alone are `extracted`; a component of the full graph
// (extracted plus declared) whose node set is not one of those needs a declared edge and is
// `declared (unverified)`. A cycle never has two labels.
//
// Cranks (BR7.10, BR7.11, US7.4, ADR-012): after every crank is applied, the components are found
// again on the crank-applied graph. A cycle none of whose nodes is still on a cycle there is
// `cranked`, naming the cranks that touched it; one a crank touched but did not break keeps its
// label and names its residual (the nodes still on a cycle); a cycle that exists only on the
// crank-applied graph (a reroute to an external `served_by` an in-estate node can close one) is
// reported too, `declared (unverified)`, naming the cranks that introduced it.

import { createHash } from "node:crypto";
import type { Edge, EdgeKind, EdgeSource, NodeId } from "../u1-graph-model/graph-model.js";
import { EDGE_KINDS } from "../u1-graph-model/graph-model.js";
import { compareCodePoints, compareTuples } from "../u1-graph-model/order.js";
import type { CycleLabel } from "../u1-graph-model/status-model.js";

export interface EdgeRef {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly kind: EdgeKind;
  readonly source: EdgeSource;
}

export interface Cycle {
  readonly id: string;
  readonly label: CycleLabel;
  /** Sorted. */
  readonly nodes: readonly NodeId[];
  /** Every non-ordering edge between the cycle's nodes, sorted by (from, to, kind, source). */
  readonly edges: readonly EdgeRef[];
  /** A shortest cycle through the smallest id, as a path: the last node's edge returns to the first. */
  readonly representative: readonly NodeId[];
  /** The edge chosen for each step of the representative (extracted before declared, then by kind). */
  readonly representativeEdges: readonly EdgeRef[];
  /**
   * For a cycle a crank touched but did not break: its nodes still on a cycle of the
   * crank-applied graph (uncranked, BR7.11); else null.
   */
  readonly residual: readonly NodeId[] | null;
  /** The residual's own label: `extracted` when it stands on extracted edges alone; else null. */
  readonly residualLabel: CycleLabel | null;
  /** For a `cranked` cycle, the cranks that touched it (documented, not verified); else empty. */
  readonly crankedBy: readonly string[];
  /** For an uncranked cycle, the cranks that touched it without breaking it; else empty. */
  readonly touchedBy: readonly string[];
  /** For a cycle that exists only once cranks are applied, the cranks whose reroutes close it; else empty. */
  readonly introducedBy: readonly string[];
  /** The label the cycle had before cranks were applied (equal to `label` unless it is `cranked`). */
  readonly labelBeforeCranks: Exclude<CycleLabel, "cranked">;
}

/**
 * Strongly connected components by an iterative Tarjan pass. `adjacency[v]` lists successor
 * indices. Returns components as index lists, each sorted ascending.
 */
export function stronglyConnected(n: number, adjacency: readonly (readonly number[])[]): number[][] {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const frames: { v: number; i: number }[] = [];
  const components: number[][] = [];
  let next = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    index[root] = low[root] = next++;
    stack.push(root);
    onStack[root] = 1;
    frames.push({ v: root, i: 0 });
    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as { v: number; i: number };
      const v = frame.v;
      const succ = adjacency[v] as readonly number[];
      if (frame.i < succ.length) {
        const w = succ[frame.i] as number;
        frame.i += 1;
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = 1;
          frames.push({ v: w, i: 0 });
        } else if (onStack[w] === 1) {
          low[v] = Math.min(low[v] as number, index[w] as number);
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) low[parent.v] = Math.min(low[parent.v] as number, low[v] as number);
      if (low[v] === index[v]) {
        const component: number[] = [];
        for (;;) {
          const w = stack.pop() as number;
          onStack[w] = 0;
          component.push(w);
          if (w === v) break;
        }
        components.push(component.sort((a, b) => a - b));
      }
    }
  }
  return components;
}

const KIND_ORDER = new Map<string, number>(EDGE_KINDS.map((k, i) => [k, i]));

function preferEdge(a: EdgeRef, b: EdgeRef): number {
  if (a.source !== b.source) return a.source === "extracted" ? -1 : 1;
  return (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0);
}

export function cyclicComponents(ids: readonly NodeId[], edges: readonly Edge[]): NodeId[][] {
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const succ: Set<number>[] = ids.map(() => new Set<number>());
  const selfLoop = new Uint8Array(ids.length);
  for (const e of edges) {
    const a = indexOf.get(e.from);
    const b = indexOf.get(e.to);
    if (a === undefined || b === undefined) continue;
    (succ[a] as Set<number>).add(b);
    if (a === b) selfLoop[a] = 1;
  }
  const adjacency = succ.map((s) => [...s].sort((x, y) => x - y));
  return stronglyConnected(ids.length, adjacency)
    .filter((c) => c.length > 1 || selfLoop[c[0] as number] === 1)
    .map((c) => c.map((i) => ids[i] as NodeId));
}

/** The edges whose both ends are in the same component, bucketed by component index. */
function bucketEdges(components: readonly (readonly NodeId[])[], edges: readonly Edge[]): Edge[][] {
  const comp = new Map<NodeId, number>();
  components.forEach((c, i) => {
    for (const id of c) comp.set(id, i);
  });
  const buckets: Edge[][] = components.map(() => []);
  for (const e of edges) {
    const a = comp.get(e.from);
    if (a !== undefined && a === comp.get(e.to)) (buckets[a] as Edge[]).push(e);
  }
  return buckets;
}

/** Breadth-first from the smallest id over the component's own edges: a shortest cycle through it. */
function representativeOf(nodes: readonly NodeId[], edges: readonly Edge[]): { path: NodeId[]; steps: EdgeRef[] } {
  const out = new Map<NodeId, Map<NodeId, EdgeRef[]>>();
  for (const e of edges) {
    const m = out.get(e.from) ?? new Map<NodeId, EdgeRef[]>();
    const list = m.get(e.to) ?? [];
    list.push({ from: e.from, to: e.to, kind: e.kind, source: e.source });
    m.set(e.to, list);
    out.set(e.from, m);
  }
  const start = nodes[0] as NodeId;
  const parent = new Map<NodeId, NodeId | null>([[start, null]]);
  const queue: NodeId[] = [start];
  let closing: NodeId | undefined;
  for (let head = 0; head < queue.length && closing === undefined; head++) {
    const u = queue[head] as NodeId;
    const succ = [...(out.get(u)?.keys() ?? [])].sort(compareCodePoints);
    for (const w of succ) {
      if (w === start) {
        closing = u;
        break;
      }
      if (!parent.has(w)) {
        parent.set(w, u);
        queue.push(w);
      }
    }
  }
  if (closing === undefined) throw new Error("CycleFinder: a cyclic component without a cycle (a bug)");
  const path: NodeId[] = [];
  for (let at: NodeId | null = closing; at !== null; at = parent.get(at) ?? null) path.push(at);
  path.reverse();
  const steps = path.map((from, i) => {
    const to = path[(i + 1) % path.length] as NodeId;
    const choices = [...(out.get(from)?.get(to) ?? [])].sort(preferEdge);
    return choices[0] as EdgeRef;
  });
  return { path, steps };
}

function refsOf(edges: readonly Edge[]): EdgeRef[] {
  return edges
    .map((e) => ({ from: e.from, to: e.to, kind: e.kind, source: e.source }))
    .sort((a, b) => compareTuples([a.from, a.to, a.kind, a.source], [b.from, b.to, b.kind, b.source]));
}

function digestOf(nodes: readonly NodeId[]): string {
  return createHash("sha256").update(nodes.join("\n")).digest("hex");
}

/** Stable ids: `c-` and the first 8 hex digits of the node set's digest, lengthened only on a collision. */
export function cycleIds(nodeSets: readonly (readonly NodeId[])[]): string[] {
  const digests = nodeSets.map(digestOf);
  const result: string[] = new Array(digests.length);
  let pending = digests.map((_, i) => i);
  for (const length of [8, 16, 64]) {
    const groups = new Map<string, Set<string>>();
    for (const i of pending) {
      const d = digests[i] as string;
      const p = d.slice(0, length);
      const g = groups.get(p) ?? new Set<string>();
      g.add(d);
      groups.set(p, g);
    }
    const still: number[] = [];
    for (const i of pending) {
      const p = (digests[i] as string).slice(0, length);
      if ((groups.get(p) as Set<string>).size === 1 || length === 64) result[i] = `c-${p}`;
      else still.push(i);
    }
    pending = still;
  }
  return result;
}

/** Finds and labels every cycle of a graph's non-ordering edges. Deterministic: sorted by id. */
export function findCycles(nodeIds: readonly NodeId[], allEdges: readonly Edge[]): Cycle[] {
  const ids = [...nodeIds].sort(compareCodePoints);
  const hard = allEdges.filter((e) => !e.orderingOnly);
  const extractedOnly = hard.filter((e) => e.source === "extracted");
  const extracted = cyclicComponents(ids, extractedOnly);
  const extractedSets = new Set(extracted.map((c) => c.join("\n")));
  const full = cyclicComponents(ids, hard).filter((c) => !extractedSets.has(c.join("\n")));
  const extractedOwn = bucketEdges(extracted, extractedOnly);
  const extractedAll = bucketEdges(extracted, hard);
  const fullAll = bucketEdges(full, hard);
  const labelled = [
    ...extracted.map((nodes, i) => ({
      nodes,
      label: "extracted" as CycleLabel,
      own: extractedOwn[i] as Edge[],
      all: extractedAll[i] as Edge[],
    })),
    ...full.map((nodes, i) => ({
      nodes,
      label: "declared (unverified)" as CycleLabel,
      own: fullAll[i] as Edge[],
      all: fullAll[i] as Edge[],
    })),
  ];
  const ids8 = cycleIds(labelled.map((c) => c.nodes));
  return labelled
    .map((c, i) => {
      const rep = representativeOf(c.nodes, c.own);
      return Object.freeze({
        id: ids8[i] as string,
        label: c.label,
        nodes: Object.freeze([...c.nodes]),
        edges: Object.freeze(refsOf(c.all)),
        representative: Object.freeze(rep.path),
        representativeEdges: Object.freeze(rep.steps),
        residual: null,
        residualLabel: null,
        crankedBy: Object.freeze([] as string[]),
        touchedBy: Object.freeze([] as string[]),
        introducedBy: Object.freeze([] as string[]),
        labelBeforeCranks: c.label as Exclude<CycleLabel, "cranked">,
      });
    })
    .sort((a, b) => compareCodePoints(a.id, b.id));
}

export interface CrankRelabelInput {
  readonly nodeIds: readonly NodeId[];
  /** The graph as read (to find which reported cycle holds a node). */
  readonly edges: readonly Edge[];
  /** The crank-applied graph's edges. */
  readonly crankedEdges: readonly Edge[];
  /** For each edge of the graph as read a crank removed (by `from\nto\nkind\nsource`), the crank. */
  readonly removedBy: ReadonlyMap<string, string>;
  /** For each `rerouted` edge a crank added (same key), the crank. */
  readonly addedBy: ReadonlyMap<string, string>;
}

export interface CrankRelabelResult {
  /** Every cycle (as read, relabelled; then any the cranks introduce), sorted by id. */
  readonly cycles: readonly Cycle[];
  /** For each node still on a cycle of the crank-applied graph, the id of the reported cycle naming it. */
  readonly cycleOf: ReadonlyMap<NodeId, string>;
}

const keyOf = (e: { from: string; to: string; kind: string; source: string }) =>
  `${e.from}\n${e.to}\n${e.kind}\n${e.source}`;

/** The cranks that removed (or added) an edge of these: credit goes only to a crank that changed the cycle itself. */
function cranksOn(
  edges: readonly { from: string; to: string; kind: string; source: string }[],
  by: ReadonlyMap<string, string>,
): string[] {
  const out = new Set<string>();
  for (const e of edges) {
    const c = by.get(keyOf(e));
    if (c !== undefined) out.add(c);
  }
  return [...out].sort(compareCrankIds);
}

/** Crank ids `crank:<n>` in file order (numeric), other strings after, by code point. */
export function compareCrankIds(a: string, b: string): number {
  const na = /^crank:(\d+)$/.exec(a);
  const nb = /^crank:(\d+)$/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  return compareCodePoints(a, b);
}

/**
 * Applies the crank-applied graph to the cycles found on the graph as read (BR7.10, BR7.11). The
 * components are recomputed on the crank-applied graph; nothing is decided from which nodes a
 * crank names alone (ADR-012: a crank cannot hide a cycle it does not break).
 */
export function relabelAfterCranks(cycles: readonly Cycle[], input: CrankRelabelInput): CrankRelabelResult {
  const ids = [...input.nodeIds].sort(compareCodePoints);
  const hardAfter = input.crankedEdges.filter((e) => !e.orderingOnly);
  const after = cyclicComponents(ids, hardAfter);
  const afterExtracted = new Set(
    cyclicComponents(
      ids,
      hardAfter.filter((e) => e.source === "extracted"),
    ).flat(),
  );
  const onCycleAfter = new Set(after.flat());

  // Every node on a cycle of the graph as read lies in one component of the full graph, and that
  // component is one reported cycle (labelled extracted when it equals an extracted component).
  const before = cyclicComponents(
    ids,
    input.edges.filter((e) => !e.orderingOnly),
  );
  const reportedBySet = new Map(cycles.map((c) => [c.nodes.join("\n"), c.id]));
  const componentOf = new Map<NodeId, number>();
  before.forEach((c, i) => {
    for (const n of c) componentOf.set(n, i);
  });
  const reportedOfComponent = before.map((c) => reportedBySet.get(c.join("\n")));

  const cycleOf = new Map<NodeId, string>();
  const introduced: { nodes: NodeId[]; edges: Edge[] }[] = [];
  const afterBuckets = bucketEdges(after, hardAfter);
  after.forEach((comp, i) => {
    const first = componentOf.get(comp[0] as NodeId);
    const inOne = first !== undefined && comp.every((n) => componentOf.get(n) === first);
    // A reported cycle with exactly this node set names it best (an extracted cycle inside a
    // larger declared component); else the reported component that holds it.
    const reported = reportedBySet.get(comp.join("\n")) ?? (inOne ? reportedOfComponent[first as number] : undefined);
    if (reported !== undefined) {
      for (const n of comp) cycleOf.set(n, reported);
    } else {
      introduced.push({ nodes: comp, edges: afterBuckets[i] as Edge[] });
    }
  });

  const relabelled: Cycle[] = cycles.map((c) => {
    const still = c.nodes.filter((n) => onCycleAfter.has(n));
    const touched = cranksOn(c.edges, input.removedBy);
    if (still.length === 0) {
      return Object.freeze({
        ...c,
        label: "cranked" as CycleLabel,
        crankedBy: Object.freeze(touched),
        labelBeforeCranks: c.labelBeforeCranks,
      });
    }
    if (touched.length === 0) return c;
    return Object.freeze({
      ...c,
      residual: Object.freeze(still),
      residualLabel: (still.some((n) => afterExtracted.has(n)) ? "extracted" : "declared (unverified)") as CycleLabel,
      touchedBy: Object.freeze(touched),
    });
  });

  const newIds = cycleIds([...cycles.map((c) => c.nodes), ...introduced.map((x) => x.nodes)]).slice(cycles.length);
  const added: Cycle[] = introduced.map((x, i) => {
    const id = newIds[i] as string;
    for (const n of x.nodes) cycleOf.set(n, id);
    const rep = representativeOf(x.nodes, x.edges);
    return Object.freeze({
      id,
      label: "declared (unverified)" as CycleLabel,
      nodes: Object.freeze([...x.nodes]),
      edges: Object.freeze(refsOf(x.edges)),
      representative: Object.freeze(rep.path),
      representativeEdges: Object.freeze(rep.steps),
      residual: null,
      residualLabel: null,
      crankedBy: Object.freeze([] as string[]),
      touchedBy: Object.freeze([] as string[]),
      introducedBy: Object.freeze(cranksOn(x.edges, input.addedBy)),
      labelBeforeCranks: "declared (unverified)" as const,
    });
  });
  return {
    cycles: Object.freeze([...relabelled, ...added].sort((a, b) => compareCodePoints(a.id, b.id))),
    cycleOf,
  };
}
