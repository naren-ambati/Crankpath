import { describe, expect, it } from "vitest";
import { applyCranks } from "../../src/u7-graph-analysis/crank-applier.js";
import { crank, edge, external, graph, n, node } from "../helpers/graphs.js";

const list = (edges: readonly { from: string; to: string; kind: string; source: string }[]) =>
  edges.map((e) => `${e.from} ${e.kind} ${e.to} ${e.source}`).sort();

describe("cranks: creates (BR7.7, AC7.3.1)", () => {
  it("makes a created node's own dependencies satisfied: its outgoing edges go, its dependents stay", () => {
    const g = graph({
      nodes: [node(n("app")), node(n("secret")), node(n("es"))],
      edges: [
        edge(n("app"), n("secret"), { kind: "needs-credential" }),
        edge(n("secret"), n("es"), { kind: "produced-by" }),
        edge(n("es"), n("app"), { kind: "deployed-by" }),
      ],
    });
    const r = applyCranks(g.nodes, g.edges, [crank(1, [n("secret")])], "crankpath.yaml");
    expect(list(r.edges)).toEqual([
      `${n("app")} needs-credential ${n("secret")} extracted`,
      `${n("es")} deployed-by ${n("app")} extracted`,
    ]);
    expect([...r.created]).toEqual([n("secret")]);
    expect(r.effects[0]).toMatchObject({
      crank: "crank:1",
      createdNodes: [n("secret")],
      removedEdges: 1,
      matched: true,
    });
    expect(r.unresolved).toEqual([]);
    // the graph as read is untouched
    expect(g.edges).toHaveLength(3);
  });
  it("resolves render:<path> to every node whose origin file is the path or lies under it, in the scanned root only", () => {
    const g = graph({
      nodes: [
        node(n("a"), { path: "system/argocd/a.yaml" }),
        node(n("b"), { path: "system/argocd/deep/b.yaml" }),
        node(n("sibling"), { path: "system/argocd-extra/c.yaml" }),
        node(n("other-repo"), { path: "alias:1/system/argocd/a.yaml" }),
        node(n("stub")),
      ],
    });
    const r = applyCranks(g.nodes, g.edges, [crank(1, [{ render: "system/argocd" }])], "crankpath.yaml");
    expect(r.effects[0]?.createdNodes).toEqual([n("a"), n("b")]);
    const file = applyCranks(g.nodes, g.edges, [crank(1, [{ render: "system/argocd/a.yaml" }])], "crankpath.yaml");
    expect(file.effects[0]?.createdNodes).toEqual([n("a")]);
    // a path that names another repository's label matches nothing (fail closed)
    const alias = applyCranks(g.nodes, g.edges, [crank(1, [{ render: "alias:1/system" }])], "crankpath.yaml");
    expect(alias.effects[0]?.matched).toBe(false);
  });
  it("never creates an external (a crank cannot make an unspecified external available)", () => {
    const g = graph({ nodes: [], externals: [external("github.com", "unspecified")] });
    const r = applyCranks(g.nodes, g.edges, [crank(1, ["external:github.com"])], "crankpath.yaml");
    expect(r.effects[0]?.matched).toBe(false);
    expect(r.unresolved.map((u) => [u.subject, u.why])).toEqual([["crank:1", "crank-unused"]]);
  });
});

describe("cranks: reroutes (BR7.8, AC7.3.2)", () => {
  it("replaces only the node's reads-source edges to in-estate nodes with one declared rerouted edge", () => {
    const g = graph({
      nodes: [node(n("root")), node(n("gitea")), node(n("config"))],
      externals: [external("mirror", "available")],
      edges: [
        edge(n("root"), n("gitea"), { kind: "reads-source" }),
        edge(n("root"), "external:mirror", { kind: "reads-source" }),
        edge(n("root"), n("config"), { kind: "needs-config" }),
      ],
    });
    const r = applyCranks(g.nodes, g.edges, [crank(1, [], [{ node: n("root"), to: "github.com" }])], "crankpath.yaml");
    expect(list(r.edges)).toEqual([
      `${n("root")} needs-config ${n("config")} extracted`,
      `${n("root")} reads-source external:mirror extracted`,
      `${n("root")} rerouted external:github.com declared`,
    ]);
    const rerouted = r.edges.find((e) => e.kind === "rerouted");
    expect(rerouted?.evidence).toMatchObject({ file: "crankpath.yaml", field: "cranks[0].reroutes" });
    expect(r.effects[0]?.reroutedEdges).toEqual([{ from: n("root"), to: "external:github.com" }]);
    expect([...r.removedBy.values()]).toEqual(["crank:1"]);
    expect([...r.addedBy.values()]).toEqual(["crank:1"]);
  });
});

describe("cranks that match nothing (BR7.9, AC7.3.3)", () => {
  it("lists a crank none of whose targets matches as unused, and an unmatched target of a used crank", () => {
    const g = graph({ nodes: [node(n("a"))] });
    const r = applyCranks(
      g.nodes,
      g.edges,
      [crank(1, [n("missing")]), crank(2, [n("a"), n("gone")], [{ node: n("nowhere"), to: "x" }])],
      "crankpath.yaml",
    );
    expect(r.effects.map((e) => e.matched)).toEqual([false, true]);
    expect(r.unresolved.map((u) => [u.subject, u.why, u.field])).toEqual([
      ["crank:1", "crank-unused", "cranks[0]"],
      ["crank:2", "crank-target-unmatched", "cranks[1].creates[1]"],
      ["crank:2", "crank-target-unmatched", "cranks[1].reroutes"],
    ]);
  });
});
