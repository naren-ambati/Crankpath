// CycleFinder (U7; BR7.3 to BR7.6, FR7.2, FR7.3, ADR-011, OD-2, OD-22): cycles are the strongly
// connected components of size above one, and self-loops, found by an iterative Tarjan pass (an
// explicit stack: a 100,000-node chain cannot overflow it). Each cycle has its full node and edge
// set, one shortest representative cycle (breadth-first from its smallest id, ties by sorted ids),
// and a stable id from its sorted node set. Ordering-only edges are never part of a cycle.
//
// Labels: components on extracted edges alone are `extracted`; a component of the full graph
// (extracted plus declared) whose node set is not one of those needs a declared edge and is
// `declared (unverified)`. A cycle never has two labels. `cranked` is B5's (CrankApplier).

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
  /** For a cranked cycle, the uncranked residual component (B5), else null. */
  readonly residual: readonly NodeId[] | null;
  /** The cranks that break it (B5). */
  readonly crankedBy: readonly string[];
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

function cyclicComponents(ids: readonly NodeId[], edges: readonly Edge[]): NodeId[][] {
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
        crankedBy: Object.freeze([] as string[]),
      });
    })
    .sort((a, b) => compareCodePoints(a.id, b.id));
}
