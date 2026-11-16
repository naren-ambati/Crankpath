// Elementary cycles for --explain (BR8.10, OD-2): Johnson's algorithm, bounded, checked against a
// brute-force enumeration on random small graphs, on complete graphs whose cycle counts are known,
// at the exact bound, on self-loops and on a 100,000-node ring.

import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { elementaryCycles } from "../../src/u8-output/elementary-cycles.js";

const id = (i: number) => `ConfigMap/ns/n${String(i).padStart(6, "0")}`;
const ring = (n: number) => Array.from({ length: n }, (_, i) => ({ from: id(i), to: id((i + 1) % n) }));
function complete(n: number) {
  const edges: { from: string; to: string }[] = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) edges.push({ from: id(a), to: id(b) });
  return edges;
}
const nodesOf = (n: number) => Array.from({ length: n }, (_, i) => id(i));

/** Every elementary cycle by brute force: each simple path from its least node back to it. */
function bruteForce(n: number, edges: readonly { from: string; to: string }[]): string[] {
  const adj = new Map<number, Set<number>>();
  const index = (s: string) => Number(s.slice(-6));
  for (const e of edges) {
    const set = adj.get(index(e.from)) ?? new Set();
    set.add(index(e.to));
    adj.set(index(e.from), set);
  }
  const found: string[] = [];
  for (let s = 0; s < n; s++) {
    const walk = (v: number, path: number[]) => {
      for (const w of adj.get(v) ?? []) {
        if (w === s) found.push(path.join(","));
        else if (w > s && !path.includes(w)) walk(w, [...path, w]);
      }
    };
    walk(s, [s]);
  }
  return found.sort();
}

describe("elementaryCycles (bounded Johnson)", () => {
  it("lists the thin slice's four elementary cycles in a fixed order", () => {
    const [A, C, D, S, V] = [
      "Application/argocd/gitea",
      "ConfigMap/gitea/gitea-config",
      "Deployment/gitea/gitea",
      "Secret/gitea/gitea-admin",
      "Service/gitea/gitea-http",
    ];
    const edges = [
      { from: A, to: V },
      { from: C, to: A },
      { from: D, to: A },
      { from: D, to: C },
      { from: D, to: S },
      { from: S, to: A },
      { from: V, to: A },
      { from: V, to: D },
    ];
    const r = elementaryCycles([V, S, D, C, A] as string[], edges as never, 21);
    expect(r.nodes).toEqual([A, C, D, S, V]);
    expect(r.cycles).toEqual([
      [0, 4],
      [0, 4, 2],
      [0, 4, 2, 1],
      [0, 4, 2, 3],
    ]);
    expect(r.stopped).toBe(false);
  });
  it("matches a brute-force enumeration on 300 random small graphs", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let g = 0; g < 300; g++) {
      const n = 2 + Math.floor(rnd() * 6);
      const edges: { from: string; to: string }[] = [];
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (rnd() < 0.35) edges.push({ from: id(a), to: id(b) });
      const expected = bruteForce(n, edges);
      const r = elementaryCycles(nodesOf(n), edges, 10_000);
      expect(r.cycles.map((c) => c.join(",")).sort(), `graph ${g}`).toEqual(expected);
      expect(r.stopped).toBe(false);
    }
  });
  it("counts the complete graph on 4 nodes (20 cycles) and stops on 5 nodes (84) at the bound", () => {
    expect(elementaryCycles(nodesOf(4), complete(4), 21)).toMatchObject({ stopped: false });
    expect(elementaryCycles(nodesOf(4), complete(4), 21).cycles).toHaveLength(20);
    const five = elementaryCycles(nodesOf(5), complete(5), 21);
    expect(five.cycles).toHaveLength(21);
    expect(five.stopped).toBe(true);
    expect(elementaryCycles(nodesOf(5), complete(5), 1000).cycles).toHaveLength(84);
  });
  it("says stopped only when more cycles exist than the bound", () => {
    expect(elementaryCycles(nodesOf(4), complete(4), 20)).toMatchObject({ stopped: false });
    expect(elementaryCycles(nodesOf(4), complete(4), 19)).toMatchObject({ stopped: true });
    expect(elementaryCycles(nodesOf(4), complete(4), 19).cycles).toHaveLength(19);
  });
  it("lists a self-loop as a one-node cycle and ignores edges to nodes outside the list", () => {
    const r = elementaryCycles(
      [id(0)],
      [
        { from: id(0), to: id(0) },
        { from: id(0), to: id(9) },
      ],
      21,
    );
    expect(r.cycles).toEqual([[0]]);
  });
  it("walks a 100,000-node ring without recursion, quickly", () => {
    const t0 = performance.now();
    const r = elementaryCycles(nodesOf(100_000), ring(100_000), LIMITS.explainElementaryCycles.value);
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0]).toHaveLength(100_000);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
  it("stops early on a component with very many cycles (a chain of 2,000 two-node cycles)", () => {
    const edges: { from: string; to: string }[] = [];
    for (let i = 0; i < 2000; i++) edges.push({ from: id(i), to: id(i + 1) }, { from: id(i + 1), to: id(i) });
    const t0 = performance.now();
    const r = elementaryCycles(nodesOf(2001), edges, 21);
    expect(r.cycles).toHaveLength(21);
    expect(r.stopped).toBe(true);
    expect(performance.now() - t0).toBeLessThan(5_000);
  });
  it("refuses a bound that is not a positive integer (a bug)", () => {
    expect(() => elementaryCycles([], [], 0)).toThrow(/bound/);
  });
});
