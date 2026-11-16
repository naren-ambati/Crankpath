import { describe, expect, it } from "vitest";
import { type Edge, type EdgeSource, makeEdge } from "../../src/u1-graph-model/graph-model.js";
import { cycleIds, findCycles, stronglyConnected } from "../../src/u7-graph-analysis/cycle-finder.js";

const id = (n: number | string) => `ConfigMap/ns/n${n}`;

function edge(
  from: number | string,
  to: number | string,
  source: EdgeSource = "extracted",
  kind: Edge["kind"] = "depends-on",
): Edge {
  return makeEdge({
    from: id(from),
    to: id(to),
    kind,
    source,
    evidence: { file: "f.yaml", field: "spec.x", renderedPath: "f.yaml#1", line: null },
  });
}

function nodes(...ns: (number | string)[]): string[] {
  return ns.map(id);
}

describe("strongly connected components (BR7.3, AC7.2.1)", () => {
  const N = 100_000;
  it("finishes a 100,000-node chain without overflowing a stack: no cycle", () => {
    const adjacency = Array.from({ length: N }, (_, i) => (i + 1 < N ? [i + 1] : []));
    const comps = stronglyConnected(N, adjacency);
    expect(comps).toHaveLength(N);
    const ids = Array.from({ length: N }, (_, i) => id(String(i).padStart(6, "0")));
    const chain = ids.slice(1).map((to, i) =>
      makeEdge({
        from: ids[i] as string,
        to,
        kind: "depends-on",
        source: "extracted",
        evidence: { file: "f", field: "x", renderedPath: "f#1", line: null },
      }),
    );
    expect(findCycles(ids, chain)).toEqual([]);
  });
  it("finds a 100,000-node ring as one component with one 100,000-step representative", () => {
    const ids = Array.from({ length: N }, (_, i) => id(String(i).padStart(6, "0")));
    const ring = ids.map((from, i) =>
      makeEdge({
        from,
        to: ids[(i + 1) % N] as string,
        kind: "depends-on",
        source: "extracted",
        evidence: { file: "f", field: "x", renderedPath: "f#1", line: null },
      }),
    );
    const cycles = findCycles(ids, ring);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.nodes).toHaveLength(N);
    expect(cycles[0]?.edges).toHaveLength(N);
    expect(cycles[0]?.representative).toHaveLength(N);
    expect(cycles[0]?.representative[0]).toBe(ids[0]);
  });
});

describe("cycles (BR7.4 to BR7.6)", () => {
  it("reports a self-loop as a cycle of one node", () => {
    const c = findCycles(nodes(1, 2), [edge(1, 1), edge(1, 2)]);
    expect(c.map((x) => [x.nodes, x.representative, x.edges.length])).toEqual([[[id(1)], [id(1)], 1]]);
  });
  it("gives a component with several cycles its full node and edge set and one shortest representative from its smallest id", () => {
    // 1 -> 2 -> 3 -> 1 (length 3) and 1 -> 4 -> 1 (length 2) and 3 -> 5 -> 3; plus an edge into 6 (no cycle).
    const es = [edge(1, 2), edge(2, 3), edge(3, 1), edge(1, 4), edge(4, 1), edge(3, 5), edge(5, 3), edge(5, 6)];
    const [c] = findCycles(nodes(1, 2, 3, 4, 5, 6), es);
    expect(c?.nodes).toEqual(nodes(1, 2, 3, 4, 5));
    expect(c?.edges).toHaveLength(7);
    expect(c?.representative).toEqual(nodes(1, 4));
    expect(c?.representativeEdges.map((e) => [e.from, e.to])).toEqual([
      [id(1), id(4)],
      [id(4), id(1)],
    ]);
  });
  it("breaks representative ties by sorted ids", () => {
    const [c] = findCycles(nodes(1, 2, 3), [edge(1, 3), edge(3, 1), edge(1, 2), edge(2, 1)]);
    expect(c?.representative).toEqual(nodes(1, 2));
  });
  it("finds separate components as separate cycles, sorted by stable id", () => {
    const es = [edge(1, 2), edge(2, 1), edge(3, 4), edge(4, 3)];
    const a = findCycles(nodes(1, 2, 3, 4), es);
    const b = findCycles(nodes(4, 3, 2, 1), [...es].reverse());
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toHaveLength(2);
    expect(a.every((c) => /^c-[0-9a-f]{8}$/.test(c.id))).toBe(true);
  });
  it("never counts an ordering-only edge in a cycle", () => {
    const ordering = makeEdge({ ...edge(2, 1), orderingOnly: true });
    expect(findCycles(nodes(1, 2), [edge(1, 2), ordering])).toEqual([]);
  });
});

describe("labels (BR7.5, AC7.2.3, OD-22)", () => {
  it("labels a cycle on extracted edges extracted, and one that needs a declared edge declared (unverified)", () => {
    const extractedOnly = findCycles(nodes(1, 2), [edge(1, 2), edge(2, 1)]);
    expect(extractedOnly.map((c) => c.label)).toEqual(["extracted"]);
    const needsDeclared = findCycles(nodes(1, 2), [edge(1, 2), edge(2, 1, "declared")]);
    expect(needsDeclared.map((c) => c.label)).toEqual(["declared (unverified)"]);
    expect(needsDeclared[0]?.edges.map((e) => e.source).sort()).toEqual(["declared", "extracted"]);
  });
  it("keeps an extracted cycle extracted when a declared edge joins it to more nodes, and reports the larger one separately", () => {
    const es = [edge(1, 2), edge(2, 1), edge(2, 3), edge(3, 1, "declared")];
    const cycles = findCycles(nodes(1, 2, 3), es);
    expect(cycles.map((c) => [c.label, c.nodes.length]).sort()).toEqual([
      ["declared (unverified)", 3],
      ["extracted", 2],
    ]);
  });
  it("does not label the same node set twice", () => {
    const cycles = findCycles(nodes(1, 2), [edge(1, 2), edge(2, 1), edge(2, 1, "declared", "needs-config")]);
    expect(cycles.map((c) => c.label)).toEqual(["extracted"]);
    expect(cycles[0]?.representativeEdges.every((e) => e.source === "extracted")).toBe(true);
  });
});

describe("cycle ids (BR7.6)", () => {
  it("is the digest of the sorted node set, lengthened only for a collision", () => {
    const [a, b] = cycleIds([nodes(1, 2), nodes(3, 4)]);
    expect(a).not.toBe(b);
    expect(cycleIds([nodes(1, 2)])).toEqual([a]);
    expect(a).toMatch(/^c-[0-9a-f]{8}$/);
  });
});
