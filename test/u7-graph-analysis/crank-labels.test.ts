import { describe, expect, it } from "vitest";
import { analyse } from "../../src/u7-graph-analysis/analysis.js";
import { crank, edge, externalDecl, external, facts, graph, n, node } from "../helpers/graphs.js";

// One component of two 2-cycles sharing b: {a, b, c}.
const shared = graph({
  nodes: [node(n("a")), node(n("b")), node(n("c"))],
  edges: [edge(n("a"), n("b")), edge(n("b"), n("a")), edge(n("b"), n("c")), edge(n("c"), n("b"))],
});

describe("cranked only when the crank really breaks the cycle (BR7.10, BR7.11, US7.4)", () => {
  it("labels a cycle `cranked` when no node of it is still on a cycle after the cranks, naming the cranks", () => {
    const r = analyse(shared, facts({ cranks: [crank(1, [n("b")])] }));
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0]).toMatchObject({
      label: "cranked",
      labelBeforeCranks: "extracted",
      crankedBy: ["crank:1"],
      residual: null,
      touchedBy: [],
    });
    expect(r.verdicts.every((v) => v.status === "startable")).toBe(true);
  });
  it("keeps a cycle a crank only shrinks uncranked, naming the residual and the crank", () => {
    const r = analyse(shared, facts({ cranks: [crank(1, [n("a")])] }));
    expect(r.cycles[0]).toMatchObject({
      label: "extracted",
      residual: [n("b"), n("c")],
      residualLabel: "extracted",
      touchedBy: ["crank:1"],
      crankedBy: [],
    });
    const status = Object.fromEntries(r.verdicts.map((v) => [v.node, [v.status, v.reason, v.via]]));
    expect(status[n("b")]).toEqual(["blocked", "cycle", null]);
    // a is created, but it needs nothing now; what needs b is still blocked
    expect(status[n("a")]).toEqual(["startable", null, null]);
  });
  it("leaves a cycle no crank touches unchanged, whatever a crank does elsewhere", () => {
    const g = graph({
      nodes: [node(n("a")), node(n("b")), node(n("x"))],
      edges: [edge(n("a"), n("b")), edge(n("b"), n("a")), edge(n("x"), n("a"))],
    });
    const r = analyse(g, facts({ cranks: [crank(1, [n("x")])] }));
    expect(r.cycles[0]).toMatchObject({ label: "extracted", residual: null, touchedBy: [], crankedBy: [] });
  });
  it("never lets a crank naming a node outside the cycle, or matching nothing, crank it", () => {
    const r = analyse(shared, facts({ cranks: [crank(1, [n("missing")])] }));
    expect(r.cycles[0]?.label).toBe("extracted");
    expect(r.unresolved.map((u) => u.why)).toEqual(["crank-unused"]);
  });
  it("relabels a declared (unverified) cycle the same way, and a declared edge never makes a cycle extracted", () => {
    const g = graph({
      nodes: [node(n("a")), node(n("b"))],
      edges: [edge(n("a"), n("b")), edge(n("b"), n("a"), { source: "declared" })],
    });
    const before = analyse(g, facts());
    expect(before.cycles.map((c) => c.label)).toEqual(["declared (unverified)"]);
    const after = analyse(g, facts({ cranks: [crank(1, [n("b")])] }));
    expect(after.cycles[0]).toMatchObject({ label: "cranked", labelBeforeCranks: "declared (unverified)" });
  });
  it("reports a cycle that exists only once a reroute is applied, declared (unverified), and blocks by it", () => {
    // root reroutes to `mirror`, which is served by gitea; gitea needs root: a new cycle.
    const g = graph({
      nodes: [node(n("root")), node(n("gitea")), node(n("seed"))],
      externals: [external("mirror", "unspecified", n("gitea"))],
      edges: [
        edge(n("root"), n("seed"), { kind: "reads-source" }),
        edge(n("gitea"), n("root"), { kind: "deployed-by" }),
        edge("external:mirror", n("gitea"), { source: "declared" }),
      ],
    });
    const before = analyse(g, facts({ externals: [externalDecl("mirror", "unspecified", n("gitea"))] }));
    expect(before.cycles).toEqual([]);
    const r = analyse(
      g,
      facts({
        externals: [externalDecl("mirror", "unspecified", n("gitea"))],
        cranks: [crank(1, [], [{ node: n("root"), to: "mirror" }])],
      }),
    );
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0]).toMatchObject({
      label: "declared (unverified)",
      introducedBy: ["crank:1"],
      nodes: [n("gitea"), n("root"), "external:mirror"],
    });
    const root = r.verdicts.find((v) => v.node === n("root"));
    expect(root).toMatchObject({ status: "blocked", reason: "cycle", blockers: [r.cycles[0]?.id] });
  });
  it("is deterministic: the same graph given in another order gives the same analysis", () => {
    const g1 = shared;
    const g2 = graph({ nodes: [...shared.nodes].reverse(), edges: [...shared.edges].reverse() });
    const f = facts({ cranks: [crank(1, [n("a")])] });
    expect(JSON.stringify(analyse(g2, f))).toBe(JSON.stringify(analyse(g1, f)));
  });
});
