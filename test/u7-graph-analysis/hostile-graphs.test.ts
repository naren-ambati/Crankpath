// Hostile large graphs through the whole analysis (BR7.3, NFR5.2, C9 "does not throw on the
// 100,000-node test graphs"): an input-size test point, not a capacity claim.

import { describe, expect, it } from "vitest";
import type { Edge, GraphNode } from "../../src/u1-graph-model/graph-model.js";
import { analyse } from "../../src/u7-graph-analysis/analysis.js";
import { crank, edge, facts, graph, n, node } from "../helpers/graphs.js";

const N = 100_000;
const id = (i: number) => n(String(i).padStart(6, "0"));

function run(nodes: GraphNode[], edges: Edge[], f = facts()) {
  const t0 = Date.now();
  const r = analyse(graph({ nodes, edges }), f);
  return { r, ms: Date.now() - t0 };
}

describe("100,000-node hostile graphs finish (BR7.3, NFR5.2)", () => {
  it("a chain: one start step per node, every node startable", () => {
    const nodes = Array.from({ length: N }, (_, i) => node(id(i)));
    const edges = Array.from({ length: N - 1 }, (_, i) => edge(id(i + 1), id(i)));
    const { r } = run(nodes, edges);
    expect(r.cycles).toEqual([]);
    expect(r.plan.steps).toHaveLength(N);
    expect(r.verdicts.every((v) => v.status === "startable")).toBe(true);
  });
  it("a ring: one cycle, every node blocked by it; a crank on one node breaks it into a chain", () => {
    const nodes = Array.from({ length: N }, (_, i) => node(id(i)));
    const edges = Array.from({ length: N }, (_, i) => edge(id(i), id((i + 1) % N)));
    const { r } = run(nodes, edges);
    expect(r.cycles).toHaveLength(1);
    expect(r.verdicts.every((v) => v.status === "blocked" && v.blockers[0] === r.cycles[0]?.id)).toBe(true);
    const cranked = run(nodes, edges, facts({ cranks: [crank(1, [id(0)])] })).r;
    expect(cranked.cycles[0]?.label).toBe("cranked");
    expect(cranked.plan.steps).toHaveLength(N);
  });
  it("a dense graph (about 1,000,000 edges, acyclic): finishes and orders every node", () => {
    const nodes = Array.from({ length: N }, (_, i) => node(id(i)));
    const edges: Edge[] = [];
    for (let i = 1; i < N; i++) for (let k = 1; k <= 10 && k <= i; k++) edges.push(edge(id(i), id(i - k)));
    const { r } = run(nodes, edges);
    expect(edges.length).toBeGreaterThan(990_000);
    expect(r.cycles).toEqual([]);
    expect(r.plan.steps.reduce((s, x) => s + x.nodes.length, 0)).toBe(N);
  });
  it("many small cycles in a chain: 50,000 cycles, each node naming its own or the nearest", () => {
    const nodes = Array.from({ length: N }, (_, i) => node(id(i)));
    const edges: Edge[] = [];
    for (let i = 0; i < N; i += 2) {
      edges.push(edge(id(i), id(i + 1)), edge(id(i + 1), id(i)));
      if (i > 0) edges.push(edge(id(i), id(i - 1)));
    }
    const { r } = run(nodes, edges);
    expect(r.cycles).toHaveLength(N / 2);
    expect(r.verdicts.every((v) => v.status === "blocked" && v.via === null)).toBe(true);
  });
  it("one render job with two sync waves of 50,000 objects each: two steps, no quadratic constraint set", () => {
    const job = "Application/argocd/big#0";
    const nodes = Array.from({ length: N }, (_, i) => node(id(i), { job, wave: i < N / 2 ? 0 : 1 }));
    const { r } = run(nodes, []);
    expect(r.plan.steps.map((s) => s.nodes.length)).toEqual([N / 2, N / 2]);
  });
});
