// Elementary cycles of one cycle component, for --explain only (BR8.10, OD-2, ADR-011): Johnson's
// algorithm, iterative (an explicit stack, so a 100,000-node ring cannot overflow the call stack),
// stopped after `bound` cycles. The report's cycles stay strongly connected components; this listing
// never feeds a count, label, status or verdict. Cycles are node sequences: two edges of different
// kinds between the same pair are one step. Order: by the least node (in code-point order of the
// ids), then depth first over successors in that order, so the listing is the same on every run.
//
// Cost: Johnson's blocking keeps the work between two cycles found to one pass over the component,
// and each start vertex chosen lies on a cycle, so stopping after `bound + 1` cycles bounds the work
// to about (bound + 2) passes over the component.

import type { NodeId } from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";

export interface ElementaryCycles {
  /** The component's nodes, sorted; each cycle below holds indices into this list. */
  readonly nodes: readonly NodeId[];
  /** At most `bound` cycles, each starting at its least node, the return to it implied. */
  readonly cycles: readonly (readonly number[])[];
  /** True when more than `bound` elementary cycles exist (the listing stopped). */
  readonly stopped: boolean;
  readonly bound: number;
}

/** Strongly connected components of the subgraph induced by the vertices >= from (iterative Tarjan). */
function componentsFrom(n: number, adj: readonly (readonly number[])[], from: number): number[][] {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const out: number[][] = [];
  let next = 0;
  for (let root = from; root < n; root++) {
    if (index[root] !== -1) continue;
    const frames: { v: number; i: number }[] = [{ v: root, i: 0 }];
    index[root] = low[root] = next++;
    stack.push(root);
    onStack[root] = 1;
    while (frames.length > 0) {
      const f = frames[frames.length - 1] as { v: number; i: number };
      const succ = adj[f.v] as readonly number[];
      if (f.i < succ.length) {
        const w = succ[f.i++] as number;
        if (w < from) continue;
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = 1;
          frames.push({ v: w, i: 0 });
        } else if (onStack[w] === 1) low[f.v] = Math.min(low[f.v] as number, index[w] as number);
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) low[parent.v] = Math.min(low[parent.v] as number, low[f.v] as number);
      if (low[f.v] === index[f.v]) {
        const comp: number[] = [];
        let w: number;
        do {
          w = stack.pop() as number;
          onStack[w] = 0;
          comp.push(w);
        } while (w !== f.v);
        out.push(comp);
      }
    }
  }
  return out;
}

/**
 * The elementary cycles among `nodes` over `edges` (only edges between listed nodes count), at most
 * `bound` of them, and whether more exist.
 */
export function elementaryCycles(
  nodes: readonly NodeId[],
  edges: readonly { readonly from: NodeId; readonly to: NodeId }[],
  bound: number,
): ElementaryCycles {
  if (!Number.isInteger(bound) || bound < 1) throw new Error("elementaryCycles: bound must be a positive integer");
  const sorted = [...new Set(nodes)].sort(compareCodePoints);
  const at = new Map(sorted.map((id, i) => [id, i]));
  const n = sorted.length;
  const sets: Set<number>[] = sorted.map(() => new Set<number>());
  for (const e of edges) {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (a !== undefined && b !== undefined) (sets[a] as Set<number>).add(b);
  }
  const adj = sets.map((s) => [...s].sort((x, y) => x - y));
  const cycles: number[][] = [];
  let stopped = false;
  const blocked = new Uint8Array(n);
  const blockedBy: Set<number>[] = sorted.map(() => new Set<number>());
  let s = 0;
  while (s < n && !stopped) {
    // the strongly connected component holding the least vertex >= s that lies on a cycle
    const comps = componentsFrom(n, adj, s);
    let best: number[] | undefined;
    let least = n;
    for (const c of comps) {
      let min = n;
      for (const v of c) if (v < min) min = v; // a loop: a component can be too large to spread
      const cyclic = c.length > 1 || (adj[c[0] as number] as number[]).includes(c[0] as number);
      if (cyclic && min < least) {
        least = min;
        best = c;
      }
    }
    if (best === undefined) break;
    s = least;
    const inComp = new Uint8Array(n);
    for (const v of best) {
      inComp[v] = 1;
      blocked[v] = 0;
      (blockedBy[v] as Set<number>).clear();
    }
    const succ = (v: number) => (adj[v] as number[]).filter((w) => inComp[w] === 1 && w >= s);
    const unblock = (u: number) => {
      const todo = [u];
      while (todo.length > 0) {
        const x = todo.pop() as number;
        if (blocked[x] === 0) continue;
        blocked[x] = 0;
        const b = blockedBy[x] as Set<number>;
        for (const w of b) todo.push(w);
        b.clear();
      }
    };
    const path: number[] = [s];
    blocked[s] = 1;
    const frames: { v: number; next: number[]; i: number; found: boolean }[] = [
      { v: s, next: succ(s), i: 0, found: false },
    ];
    while (frames.length > 0 && !stopped) {
      const f = frames[frames.length - 1] as { v: number; next: number[]; i: number; found: boolean };
      if (f.i < f.next.length) {
        const w = f.next[f.i++] as number;
        if (w === s) {
          if (cycles.length === bound) stopped = true;
          else cycles.push([...path]);
          f.found = true;
        } else if (blocked[w] === 0) {
          blocked[w] = 1;
          path.push(w);
          frames.push({ v: w, next: succ(w), i: 0, found: false });
        }
        continue;
      }
      frames.pop();
      path.pop();
      if (f.found) unblock(f.v);
      else for (const w of f.next) (blockedBy[w] as Set<number>).add(f.v);
      const parent = frames[frames.length - 1];
      if (parent !== undefined && f.found) parent.found = true;
    }
    s += 1;
  }
  return Object.freeze({
    nodes: Object.freeze(sorted),
    cycles: Object.freeze(cycles.map((c) => Object.freeze(c))),
    stopped,
    bound,
  });
}
