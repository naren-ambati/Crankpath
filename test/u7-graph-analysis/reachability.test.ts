import { describe, expect, it } from "vitest";
import type { Edge, ExternalNode, GraphNode } from "../../src/u1-graph-model/graph-model.js";
import { unresolvedItem } from "../../src/u1-graph-model/status-model.js";
import { analyse } from "../../src/u7-graph-analysis/analysis.js";
import { crank, edge, external, externalDecl, facts, graph, n, node } from "../helpers/graphs.js";

function statuses(g: ReturnType<typeof graph>, f = facts()) {
  return Object.fromEntries(
    analyse(g, f).verdicts.map((v) => [
      v.node,
      `${v.status} ${v.reason ?? "-"} ${v.blockers.join(",") || "-"} ${v.via ?? "-"}`,
    ]),
  );
}

describe("cold-start statuses (BR7.12 to BR7.14, AC1.3.1 to AC1.3.3)", () => {
  it("makes a chain from a dependency-free node startable, and nothing else", () => {
    const g = graph({ nodes: [node(n("a")), node(n("b"))], edges: [edge(n("b"), n("a"))] });
    expect(statuses(g)).toEqual({ [n("a")]: "startable - - -", [n("b")]: "startable - - -" });
  });
  it("refuses startable to an opaque node and everything behind it (and only to them)", () => {
    const g = graph({
      nodes: [node(n("a"), { opaque: true }), node(n("b")), node(n("c")), node(n("free"))],
      edges: [edge(n("b"), n("a")), edge(n("c"), n("b"))],
    });
    expect(statuses(g)).toEqual({
      [n("a")]: `unverified opaque ${n("a")} -`,
      [n("b")]: `unverified opaque ${n("a")} ${n("a")}`,
      [n("c")]: `unverified opaque ${n("a")} ${n("b")}`,
      [n("free")]: "startable - - -",
    });
    // break the input: the same graph without the opacity is startable throughout
    const clear = graph({ nodes: [node(n("a")), node(n("b")), node(n("c"))], edges: g.edges });
    expect(Object.values(statuses(clear)).every((s) => s.startsWith("startable"))).toBe(true);
  });
  it("blocks what needs an external whose cold start is unspecified (UNRESOLVED, never available) or unavailable", () => {
    const g = graph({
      nodes: [node(n("a")), node(n("b")), node(n("c"))],
      externals: [external("gh", "unspecified"), external("kms", "unavailable"), external("sts", "available")],
      edges: [edge(n("a"), "external:gh"), edge(n("b"), "external:kms"), edge(n("c"), "external:sts")],
    });
    expect(statuses(g)).toEqual({
      [n("a")]: "blocked external-unspecified external:gh external:gh",
      [n("b")]: "blocked external-unavailable external:kms external:kms",
      [n("c")]: "startable - - -",
      "external:gh": "blocked external-unspecified external:gh -",
      "external:kms": "blocked external-unavailable external:kms -",
      "external:sts": "startable - - -",
    });
  });
  it("blocks every node on an uncranked cycle and behind it, naming the cycle", () => {
    const g = graph({
      nodes: [node(n("a")), node(n("b")), node(n("c"))],
      edges: [edge(n("a"), n("b")), edge(n("b"), n("a")), edge(n("c"), n("a"))],
    });
    const r = analyse(g, facts());
    const id = r.cycles[0]?.id as string;
    expect(statuses(g)).toEqual({
      [n("a")]: `blocked cycle ${id} -`,
      [n("b")]: `blocked cycle ${id} -`,
      [n("c")]: `blocked cycle ${id} ${n("a")}`,
    });
  });
  it("lets a blocker outrank a gap, and names the nearest root cause", () => {
    const g = graph({
      nodes: [node(n("x"), { opaque: true }), node(n("far")), node(n("mid")), node(n("top"))],
      externals: [external("gh", "unspecified")],
      edges: [
        edge(n("x"), "external:gh"),
        edge(n("top"), n("mid")),
        edge(n("mid"), n("far")),
        edge(n("far"), n("x")),
        edge(n("top"), "external:gh"),
      ],
    });
    const s = statuses(g);
    expect(s[n("x")]).toBe("blocked external-unspecified external:gh external:gh");
    expect(s[n("top")]).toBe("blocked external-unspecified external:gh external:gh");
    expect(s[n("mid")]).toBe(`blocked external-unspecified external:gh ${n("far")}`);
  });
  it("makes a not-defined stub and what needs it unverified, unless a crank creates it or every cluster provides it", () => {
    const parts = {
      nodes: [
        node(n("d")),
        node("Secret/ns/missing", { flags: ["not-defined"] }),
        node("ServiceAccount/ns/default", { flags: ["cluster-provided"] }),
      ],
      edges: [edge(n("d"), "Secret/ns/missing"), edge(n("d"), "ServiceAccount/ns/default")],
      unresolved: [unresolvedItem("Secret/ns/missing", "not-defined", "f.yaml#1", "spec.x")],
    };
    const s = statuses(graph(parts));
    expect(s[n("d")]).toBe("unverified undefined-reference Secret/ns/missing Secret/ns/missing");
    expect(s["ServiceAccount/ns/default"]).toBe("startable - - -");
    const created = analyse(graph(parts), facts({ cranks: [crank(1, ["Secret/ns/missing"])] }));
    expect(created.verdicts.map((v) => v.status)).toEqual(["startable", "startable", "startable"]);
    expect(created.unresolved).toEqual([]);
  });
  it("makes the subject of an unresolved item (an ambiguity, a conflict) unverified, and what needs it", () => {
    const g = graph({
      nodes: [node(n("app")), node(n("user"))],
      edges: [edge(n("user"), n("app"))],
      unresolved: [unresolvedItem(n("app"), "host-ambiguous", "f.yaml#1", "spec.source.repoURL", [n("x"), n("y")])],
    });
    expect(statuses(g)[n("user")]).toBe(`unverified unresolved ${n("app")} ${n("app")}`);
  });
  it("makes the end of a declared edge to nothing that exists unverified (it owns the item)", () => {
    const g = graph({
      nodes: [node(n("a"))],
      unresolved: [
        unresolvedItem(n("ghost"), "declared-edge-endpoint-missing", "crankpath.yaml", "edges[0]", [], {
          owner: n("a"),
        }),
      ],
    });
    expect(statuses(g)[n("a")]).toBe(`unverified unresolved ${n("a")} -`);
  });
  it("makes every node unverified when an extractor failed (its edges were not read)", () => {
    const g = graph({
      nodes: [node(n("a"))],
      unresolved: [unresolvedItem("extractor:argo", "extractor-failed", "(extractor)", null)],
    });
    expect(statuses(g)[n("a")]).toBe("unverified unresolved extractor:argo -");
  });
  it("follows a served_by external to the node serving it", () => {
    const g = graph({
      nodes: [node(n("harbor"), { opaque: true }), node(n("app"))],
      externals: [external("registry", "unspecified", n("harbor"))],
      edges: [edge(n("app"), "external:registry"), edge("external:registry", n("harbor"), { source: "declared" })],
    });
    const s = statuses(g, facts({ externals: [externalDecl("registry", "unspecified", n("harbor"))] }));
    expect(s[n("app")]).toBe(`unverified opaque ${n("harbor")} external:registry`);
  });
});

// A brute-force reading of the rules, checked against the analysis on random graphs: a node is
// blocked when its closure holds a cycle node or an unavailable/unspecified external, unverified
// when it holds (only) an opaque node, and startable otherwise.
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

describe("statuses are the least fixed point (property, NFR3.1, NFR8.1)", () => {
  it("agrees with a brute-force closure on 300 random graphs and never says startable over a gap", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const size = 2 + Math.floor(r() * 12);
      const nodes: GraphNode[] = [];
      for (let i = 0; i < size; i++) nodes.push(node(n(i), { opaque: r() < 0.12 }));
      const externals: ExternalNode[] = [
        external("e0", "available"),
        external("e1", "unspecified"),
        external("e2", "unavailable"),
      ];
      const all = [...nodes.map((x) => x.id), ...externals.map((e) => e.id)];
      const edges: Edge[] = [];
      for (let i = 0; i < size; i++) {
        for (let k = 0; k < 2; k++) {
          if (r() < 0.5) continue;
          const to = all[Math.floor(r() * all.length)] as string;
          if (to !== nodes[i]?.id) edges.push(edge(nodes[i]?.id as string, to));
        }
      }
      const g = graph({ nodes, edges, externals });
      const out = new Map<string, string[]>();
      for (const e of g.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
      const closure = (start: string) => {
        const seen = new Set([start]);
        const stack = [start];
        while (stack.length > 0) {
          for (const w of out.get(stack.pop() as string) ?? []) {
            if (seen.has(w)) continue;
            seen.add(w);
            stack.push(w);
          }
        }
        return seen;
      };
      const onCycle = (v: string) => (out.get(v) ?? []).some((w) => closure(w).has(v));
      const verdicts = analyse(g, facts()).verdicts;
      for (const v of verdicts) {
        const c = [...closure(v.node)];
        const blocking = c.some((x) => onCycle(x) || x === "external:e1" || x === "external:e2");
        const gap = c.some((x) => g.nodes.find((y) => y.id === x)?.opaque !== null);
        const expected = blocking ? "blocked" : gap ? "unverified" : "startable";
        expect(v.status, `seed ${seed} node ${v.node}`).toBe(expected);
      }
    }
  });
});
