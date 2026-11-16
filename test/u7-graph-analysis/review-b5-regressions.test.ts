// Regression tests for the independent review of B5 at the analysis level, each written to fail
// before its fix: M2 (every unresolved item names the node that owns it, which is never startable),
// M3 (hostile declared-fact counts at 100,000 nodes finish, a spent budget is a counted limit), m1
// (credit only the cranks that remove an edge of the cycle; the first crank that creates a node).

import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { withValue } from "../support/limits.js";
import { UNRESOLVED_WHY, unresolvedItem } from "../../src/u1-graph-model/status-model.js";
import { createHostMatching } from "../../src/u6-extractors-workload/host-matcher.js";
import { analyse } from "../../src/u7-graph-analysis/analysis.js";
import { buildGraph } from "../../src/u7-graph-analysis/graph-builder.js";
import { crank, edge, external, externalDecl, facts, graph, n, node } from "../helpers/graphs.js";

const APP = "Application/argocd/app";

describe("M2: every unresolved item names its owner, and the owner is never startable", () => {
  it("defaults the owner to a subject that is a node id, and takes an explicit owner otherwise", () => {
    expect(unresolvedItem(n("a"), "host-ambiguous", "f#1", null).owner).toBe(n("a"));
    expect(unresolvedItem("Bad_Name", "invalid-reference", "f#1", null, [], { owner: n("a") }).owner).toBe(n("a"));
    expect(unresolvedItem("crank:1", "crank-unused", "crankpath.yaml", null).owner).toBeNull();
  });
  // One row per reason: the item as its producer files it, and the node that must not be startable
  // (null: a run-level item with no node of its own, which makes every node unverified or names a crank).
  const rows: [string, ReturnType<typeof unresolvedItem>, string | null][] = [
    ["address-missing", unresolvedItem(n("own"), "address-missing", "f#1", null, [], { value: "x" }), n("own")],
    // an assumption about where Argo CD reads credentials: listed and a gap, owned by no node
    [
      "argocd-namespace-assumed",
      unresolvedItem("Namespace/argocd", "argocd-namespace-assumed", "f#1", null, [], { owner: null }),
      null,
    ],
    [
      "argocd-namespace-derived",
      unresolvedItem("Namespace/argocd", "argocd-namespace-derived", "f#1", null, [], { owner: null }),
      null,
    ],
    // no credential edge was made at all: every Application may need one unseen
    ["argocd-namespace-unknown", unresolvedItem("argocd-namespace", "argocd-namespace-unknown", "f#1", null), APP],
    ["conflicting-definitions", unresolvedItem(n("own"), "conflicting-definitions", "f#1", null), n("own")],
    ["credential-ambiguous", unresolvedItem(n("own"), "credential-ambiguous", "f#1", null), n("own")],
    ["credential-outside-argocd", unresolvedItem(n("own"), "credential-outside-argocd", "f#1", null), n("own")],
    ["credential-url-unresolved", unresolvedItem(n("own"), "credential-url-unresolved", "f#1", null), n("own")],
    ["credential-unreadable", unresolvedItem(APP, "credential-unreadable", "f#1", null, [n("own")]), APP],
    ["host-unplaced", unresolvedItem(n("own"), "host-unplaced", "f#1", null, [], { value: "h" }), n("own")],
    ["namespace-unknown", unresolvedItem(n("own"), "namespace-unknown", "f#1", null), n("own")],
    ["region-unresolved", unresolvedItem(n("own"), "region-unresolved", "f#1", null), n("own")],
    ["seal-unreadable", unresolvedItem(n("own"), "seal-unreadable", "f#1", null), n("own")],
    ["seal-workload-unidentified", unresolvedItem(n("own"), "seal-workload-unidentified", "f#1", null), n("own")],
    ["unsupported-provider", unresolvedItem(n("own"), "unsupported-provider", "f#1", null), n("own")],
    ["crank-target-unmatched", unresolvedItem("crank:1", "crank-target-unmatched", "c", null), null],
    ["crank-unused", unresolvedItem("crank:1", "crank-unused", "c", null), null],
    [
      "declared-edge-endpoint-missing",
      unresolvedItem(n("ghost"), "declared-edge-endpoint-missing", "c", "edges[0]", [], { owner: n("own") }),
      n("own"),
    ],
    ["external-unspecified", unresolvedItem("external:x", "external-unspecified", "c", null), "external:x"],
    ["extractor-failed", unresolvedItem("extractor:e", "extractor-failed", "(extractor)", null), n("own")],
    ["host-ambiguous", unresolvedItem(n("own"), "host-ambiguous", "f#1", null), n("own")],
    [
      "invalid-reference",
      unresolvedItem("Bad_Name", "invalid-reference", "f#1", null, [], { owner: n("own") }),
      n("own"),
    ],
    ["invalid-sync-wave", unresolvedItem(n("own"), "invalid-sync-wave", "f#1", null), n("own")],
    ["match-limit", unresolvedItem("match", "match-limit", "crankpath.yaml", null), n("own")],
    ["not-defined", unresolvedItem(n("own"), "not-defined", "f#1", null), n("own")],
    ["selector-ambiguous", unresolvedItem(n("own"), "selector-ambiguous", "f#1", null), n("own")],
    ["selector-invalid", unresolvedItem(n("own"), "selector-invalid", "f#1", null), n("own")],
    ["served-by-missing", unresolvedItem("external:x", "served-by-missing", "c", null), "external:x"],
  ];
  it("covers every unresolved reason", () => {
    expect(rows.map((r) => r[0]).sort()).toEqual([...UNRESOLVED_WHY].sort());
  });
  it.each(rows)("%s", (_why, item, mustNotStart) => {
    const g = graph({
      nodes: [node(n("own"), { flags: item.why === "not-defined" ? ["not-defined"] : [] }), node(n("user")), node(APP)],
      externals: [external("x", "unspecified", item.why === "served-by-missing" ? n("gone") : null)],
      edges: [edge(n("user"), n("own"))],
      unresolved: [item],
    });
    const verdicts = new Map(analyse(g, facts()).verdicts.map((v) => [v.node, v]));
    if (mustNotStart === null) {
      expect(item.owner).toBeNull();
      // a run-level item names no node of its own; an assumption leaves every status as it was
      if (item.why.startsWith("argocd-namespace-")) expect(verdicts.get(APP)?.status).toBe("startable");
      return;
    }
    expect(verdicts.get(mustNotStart)?.status).not.toBe("startable");
    if (mustNotStart === n("own")) expect(verdicts.get(n("user"))?.status).not.toBe("startable");
  });
});

describe("m1: crank credit", () => {
  it("credits only the cranks that remove an edge of the cycle", () => {
    const g = graph({
      nodes: [node(n("a")), node(n("b")), node(n("x"))],
      edges: [edge(n("a"), n("b")), edge(n("b"), n("a")), edge(n("a"), n("x"), { kind: "reads-source" })],
    });
    const r = analyse(g, facts({ cranks: [crank(1, [], [{ node: n("a"), to: "gh" }]), crank(2, [n("b")])] }));
    expect(r.cycles[0]).toMatchObject({ label: "cranked", crankedBy: ["crank:2"] });
  });
  it("gives a node to the first crank that creates it; a later one creates nothing new", () => {
    const g = graph({ nodes: [node(n("a")), node(n("b"))], edges: [edge(n("a"), n("b")), edge(n("b"), n("a"))] });
    const r = analyse(g, facts({ cranks: [crank(1, [n("a")]), crank(2, [n("a")])] }));
    expect(r.crankEffects.map((e) => [e.crank, e.createdNodes, e.alreadyCreated])).toEqual([
      ["crank:1", [n("a")], 0],
      ["crank:2", [], 1],
    ]);
    expect(r.cycles[0]?.crankedBy).toEqual(["crank:1"]);
  });
});

const N = 100_000;
const pathed = (i: number) => node(n(String(i).padStart(6, "0")), { path: `d${i % 1000}/f${i}.yaml` });

describe("M3: hostile declared-fact counts at 100,000 nodes finish", () => {
  const nodes = Array.from({ length: N }, (_, i) => pathed(i));
  const ring = nodes.map((x, i) => edge(x.id, (nodes[(i + 1) % N] as (typeof nodes)[number]).id));
  const g = graph({ nodes, edges: ring });
  it("1,000 render cranks, and one crank with 10,000 render targets", () => {
    const t0 = Date.now();
    const many = Array.from({ length: 1000 }, (_, k) => crank(k + 1, [{ render: `d${k}` }]));
    const r = analyse(g, facts({ cranks: many }));
    expect(r.cycles[0]?.label).toBe("cranked");
    const wide = crank(
      1,
      Array.from({ length: 10_000 }, (_, k) => ({ render: `d${k % 1000}` })),
    );
    const r2 = analyse(g, facts({ cranks: [wide] }));
    expect(r2.crankEffects[0]?.createdNodes).toHaveLength(N);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
  it("50,000 declared externals and 100,000 declared edges", () => {
    const t0 = Date.now();
    const externals = Array.from({ length: 50_000 }, (_, i) => externalDecl(`h${i}.example.org`, "available"));
    const edges = nodes
      .slice(1)
      .map((x, i) => ({ from: x.id, to: (nodes[i] as (typeof nodes)[number]).id, why: "w", keyPath: `edges[${i}]` }));
    const built = buildGraph({ objects: [], extracted: [], config: facts({ externals, edges }), opaque: [] });
    expect(built.externals).toHaveLength(50_000);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
  it("20,000 wildcard match entries against 2,000 hosts: a spent comparison budget is a counted limit, never a hang", () => {
    const rules = Array.from({ length: 20_000 }, (_, i) => ({
      host: `*x${i}.ns.example.org`,
      node: "Namespace/default",
      order: i,
      keyPath: `match[${i}]`,
    }));
    const m = createHostMatching([], rules);
    const t0 = Date.now();
    for (let i = 0; i < 2000; i++) m.match({ host: `svc${i}.ns.example.org`, field: "f", bareNamespace: null });
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(m.limitHit()).toBe(true);
    // 20,000 literal entries cost one lookup each and never spend the budget
    const literal = createHostMatching(
      [],
      rules.map((r, i) => ({ ...r, host: `svc${i}.ns.example.org` })),
    );
    for (let i = 0; i < 2000; i++) {
      expect(literal.match({ host: `svc${i}.ns.example.org`, field: "f", bareNamespace: null }).rule).toBe(
        `match[${i}]`,
      );
    }
    expect(literal.limitHit()).toBe(false);
  });
  it("a spent budget makes every node unverified, named", () => {
    const g2 = graph({
      nodes: [node(n("a"))],
      unresolved: [unresolvedItem("match", "match-limit", "crankpath.yaml", null)],
    });
    expect(analyse(g2, facts()).verdicts[0]).toMatchObject({
      status: "unverified",
      reason: "unresolved",
      blockers: ["match"],
    });
  });
  it("records the declared-fact limits as derived limits", () => {
    expect(LIMITS.declaredEntries.status).toBe("derived");
    expect(LIMITS.hostPatternComparisons.status).toBe("derived");
    const small = withValue(LIMITS.hostPatternComparisons, 3, "test");
    const m = createHostMatching([], [{ host: "*.example.org", node: "x", order: 0, keyPath: "match[0]" }], small);
    for (let i = 0; i < 5; i++) m.match({ host: `h${i}.example.org`, field: "f", bareNamespace: null });
    expect(m.limitHit()).toBe(true);
  });
});

describe("M3: one render job with 50,000 sync waves", () => {
  it("orders them in linear work", () => {
    const job = "Application/argocd/big#0";
    const nodes = Array.from({ length: 50_000 }, (_, i) => node(n(String(i).padStart(6, "0")), { job, wave: i }));
    const t0 = Date.now();
    const r = analyse(graph({ nodes }), facts());
    expect(r.plan.steps).toHaveLength(50_000);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});
