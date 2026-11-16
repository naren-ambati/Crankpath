import { describe, expect, it } from "vitest";
import { analyse, NOT_MODELLED, PLAN_DISCLAIMER } from "../../src/u7-graph-analysis/analysis.js";
import { crank, edge, external, externalDecl, facts, graph, n, node } from "../helpers/graphs.js";

const steps = (g: ReturnType<typeof graph>, f = facts()) =>
  analyse(g, f).plan.steps.map((s) => `${s.no} ${s.kind}${s.manual ? " manual" : ""}: ${s.nodes.join(" ")}`);

describe("the restoration plan (BR7.15 to BR7.18, BR7.20)", () => {
  it("puts crank steps first, in file order and manual, then layers by the longest chain of dependencies", () => {
    const g = graph({
      nodes: [node(n("a")), node(n("b")), node(n("c")), node(n("d")), node(n("s1")), node(n("s2"))],
      edges: [
        edge(n("b"), n("a")),
        edge(n("c"), n("b")),
        edge(n("c"), n("a")),
        edge(n("d"), n("s2")),
        edge(n("s2"), n("s1")),
      ],
    });
    const f = facts({ cranks: [crank(2, [n("s2")], [], "second"), crank(1, [n("s1")], [], "first")] });
    expect(steps(g, f)).toEqual([
      `1 crank manual: ${n("s1")}`,
      `2 crank manual: ${n("s2")}`,
      `3 start: ${n("a")} ${n("d")}`,
      `4 start: ${n("b")}`,
      `5 start: ${n("c")}`,
    ]);
    const plan = analyse(g, f).plan;
    expect(plan.steps[0]).toMatchObject({ why: "first", crank: "crank:1" });
    expect(plan.assumes.cranks).toEqual(["crank:1", "crank:2"]);
  });
  it("orders a layer by sync wave then id, and keeps waves of one render job in order", () => {
    const job = "Application/argocd/app#0";
    const g = graph({
      nodes: [
        node(n("z-early"), { job, wave: -1 }),
        node(n("a-late"), { job, wave: 1 }),
        node(n("m-default"), { job }),
        node(n("other-job"), { job: "Application/argocd/other#0", wave: 5 }),
      ],
    });
    expect(steps(g)).toEqual([
      `1 start: ${n("z-early")} ${n("other-job")}`,
      `2 start: ${n("m-default")}`,
      `3 start: ${n("a-late")}`,
    ]);
  });
  it("drops a wave constraint that a hard dependency contradicts, and lists it", () => {
    const job = "Application/argocd/app#0";
    const g = graph({
      nodes: [node(n("early"), { job, wave: -1 }), node(n("late"), { job, wave: 0 })],
      // the wave says early first; the hard dependency says early needs late
      edges: [edge(n("early"), n("late"))],
    });
    const plan = analyse(g, facts()).plan;
    expect(plan.steps.map((s) => s.nodes)).toEqual([[n("late")], [n("early")]]);
    expect(plan.conflicts).toEqual([{ kind: "sync-wave", job, fromWave: -1, toWave: 0 }]);
    // break the input: without the hard dependency the wave holds and nothing is dropped
    const ok = analyse(graph({ nodes: g.nodes }), facts()).plan;
    expect(ok.steps.map((s) => s.nodes)).toEqual([[n("early")], [n("late")]]);
    expect(ok.conflicts).toEqual([]);
  });
  it("honours an ordering-only edge, never as a dependency, and drops one a hard dependency contradicts", () => {
    const g = graph({
      nodes: [node(n("a")), node(n("b"))],
      edges: [edge(n("b"), n("a"), { orderingOnly: true })],
    });
    expect(analyse(g, facts()).plan.steps.map((s) => s.nodes)).toEqual([[n("a")], [n("b")]]);
    expect(analyse(g, facts()).cycles).toEqual([]);
    const contra = graph({ nodes: g.nodes, edges: [...g.edges, edge(n("a"), n("b"))] });
    const plan = analyse(contra, facts()).plan;
    expect(plan.steps.map((s) => s.nodes)).toEqual([[n("b")], [n("a")]]);
    expect(plan.conflicts).toEqual([{ kind: "ordering-edge", from: n("b"), to: n("a") }]);
  });
  it("lists blocked and unverified nodes after the plan, unordered, with reasons, and never in a start step", () => {
    const g = graph({
      nodes: [node(n("ok")), node(n("blind"), { opaque: true }), node(n("needs-gh"))],
      externals: [external("gh", "unspecified")],
      edges: [edge(n("needs-gh"), "external:gh")],
    });
    const plan = analyse(g, facts()).plan;
    expect(plan.steps.flatMap((s) => s.nodes)).toEqual([n("ok")]);
    expect(plan.listedUnordered).toEqual([
      { node: n("blind"), status: "unverified", reason: "opaque", blockers: [n("blind")] },
      { node: n("needs-gh"), status: "blocked", reason: "external-unspecified", blockers: ["external:gh"] },
    ]);
  });
  it("states that it is an order and not a schedule, and what it assumes", () => {
    const g = graph({
      nodes: [node(n("a")), node("ServiceAccount/ns/default", { flags: ["cluster-provided"] })],
      externals: [external("gh", "available"), external("kms", "unspecified")],
      edges: [edge(n("a"), "external:gh"), edge(n("a"), "ServiceAccount/ns/default")],
    });
    const plan = analyse(g, facts({ externals: [externalDecl("gh", "available")] })).plan;
    expect(plan.disclaimer).toBe(PLAN_DISCLAIMER);
    expect(PLAN_DISCLAIMER).toContain("not a schedule");
    expect(PLAN_DISCLAIMER).toContain("cold-load pickup is not modelled");
    expect(plan.assumes).toEqual({
      externals: ["external:gh"],
      cranks: [],
      clusterProvided: ["ServiceAccount/ns/default"],
      servedBy: [],
      matchEntries: [],
      argocdNamespace: [],
      notModelled: NOT_MODELLED,
    });
    // neither an external nor an object the cluster provides is a start step
    expect(plan.steps.flatMap((s) => s.nodes)).toEqual([n("a")]);
  });
  it("never shows a start step for a node that is not startable (property over random graphs)", () => {
    let x = 7;
    const r = () => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x / 2147483648;
    };
    for (let round = 0; round < 200; round++) {
      const size = 2 + Math.floor(r() * 10);
      const nodes = Array.from({ length: size }, (_, i) =>
        node(n(i), {
          opaque: r() < 0.15,
          job: r() < 0.5 ? "Application/argocd/j#0" : null,
          wave: Math.floor(r() * 3) - 1,
        }),
      );
      const edges = [];
      for (let i = 0; i < size; i++)
        if (r() < 0.6) {
          const j = Math.floor(r() * size);
          if (j !== i) edges.push(edge(n(i), n(j), { orderingOnly: r() < 0.3 }));
        }
      const a = analyse(graph({ nodes, edges }), facts());
      const status = new Map(a.verdicts.map((v) => [v.node, v.status]));
      for (const s of a.plan.steps) for (const id of s.nodes) expect(status.get(id)).toBe("startable");
      const placed = new Set(a.plan.steps.flatMap((s) => s.nodes));
      const step = new Map(a.plan.steps.flatMap((s) => s.nodes.map((id) => [id, s.no] as const)));
      // every hard dependency inside the plan starts in an earlier step
      for (const e of edges)
        if (!e.orderingOnly && placed.has(e.from) && placed.has(e.to))
          expect((step.get(e.to) as number) < (step.get(e.from) as number)).toBe(true);
    }
  });
});
