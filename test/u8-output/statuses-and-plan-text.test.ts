// The statuses, externals and plan sections of the text report (M1, M2, BR8.4, BR7.17, BR7.18),
// rendered from synthetic graphs through the real analysis and ReportAssembler.

import { describe, expect, it } from "vitest";
import type { ConfigDocument } from "../../src/u1-graph-model/declared-facts.js";
import { claimWordsInOwnVoice, unresolvedItem } from "../../src/u1-graph-model/status-model.js";
import { analyse } from "../../src/u7-graph-analysis/analysis.js";
import type { EstateGraph } from "../../src/u7-graph-analysis/graph-builder.js";
import { assembleReport } from "../../src/u8-output/report-assembler.js";
import { renderJson } from "../../src/u8-output/json-renderer.js";
import { textLogicalLines } from "../../src/u8-output/text-renderer.js";
import { crank, edge, external, externalDecl, facts, graph, n, node } from "../helpers/graphs.js";

function report(g: EstateGraph, f: ConfigDocument = facts(), unusedMatches: ConfigDocument["matches"] = []) {
  return assembleReport({
    scanned: { url: null, normalised: null, name: null, from: null },
    scannedPath: ".",
    graph: g,
    analysis: analyse(g, f),
    config: f,
    sources: [{ kind: "Application", node: n("a"), kustomizeRoot: null, mark: null }],
    skipped: [],
    unreadable: [],
    ignoredFiles: 0,
    timeouts: 0,
    droppedHooks: 0,
    limits: { refusedFiles: 0, refusedJobs: 0, droppedEdges: 0 },
    unusedMatches,
  });
}
const text = (g: EstateGraph, f?: ConfigDocument) => `${textLogicalLines(report(g, f)).join("\n")}\n`;

describe("not startable from a cold start (M1)", () => {
  it("groups nodes by their named blocker, blockers first, each node with the dependency it is blocked through", () => {
    const g = graph({
      nodes: [
        node(n("a")),
        node(n("b"), { opaque: true }),
        node(n("c")),
        node("Secret/ns/missing", { flags: ["not-defined"] }),
        node(n("d")),
        node(n("e")),
      ],
      externals: [external("kms", "unavailable")],
      edges: [edge(n("a"), "external:kms"), edge(n("c"), n("b")), edge(n("d"), "Secret/ns/missing")],
      unresolved: [
        unresolvedItem("Secret/ns/missing", "not-defined", "f.yaml#1", "spec.x"),
        unresolvedItem(n("e"), "selector-ambiguous", "f.yaml#2", "spec.selector", [n("x"), n("y")]),
      ],
    });
    const t = text(g, facts({ externals: [externalDecl("kms", "unavailable")] }));
    expect(t).toContain(
      [
        "Not startable from a cold start: 6 of 6 nodes (1 blocked, 5 unverified); 0 startable",
        '  blocked by external "kms" (declared unavailable): 1 node',
        '    ConfigMap "ns/a"  via external "kms"',
        '  unverified, opaque or behind opaque ConfigMap "ns/b": 2 nodes',
        '    ConfigMap "ns/b"',
        '    ConfigMap "ns/c"  via ConfigMap "ns/b"',
        '  unverified, behind Secret "ns/missing", which no readable source defines: 2 nodes',
        '    ConfigMap "ns/d"  via Secret "ns/missing"',
        '    Secret "ns/missing"',
        '  unverified, behind an unresolved item on ConfigMap "ns/e": 1 node',
        '    ConfigMap "ns/e"',
      ].join("\n"),
    );
    expect(t).toContain('  external "kms"  unavailable (declared)\n');
    expect(t).toContain(
      "Plan (an order, not a schedule; cold-load pickup is not modelled): no steps, because no node is startable;",
    );
    expect(claimWordsInOwnVoice(t)).toEqual([]);
  });
  it("says what startable rests on when every node is startable", () => {
    const t = text(graph({ nodes: [node(n("a"))] }));
    expect(t).toContain(
      "Not startable from a cold start: 0 of 1 node; 1 startable, relative to the assumptions under the plan\n",
    );
    expect(t).toContain('  step 1  start   ConfigMap "ns/a"\n');
  });
  it("names a failed extractor as the reason every node is unverified", () => {
    const g = graph({
      nodes: [node(n("a"))],
      unresolved: [unresolvedItem("extractor:argo", "extractor-failed", "(extractor)", null)],
    });
    expect(text(g)).toContain('  unverified, because extractor "argo" failed: 1 node\n');
  });
});

describe("cycles after cranks and the plan's dropped constraints (M2, BR7.11, BR7.16)", () => {
  it("names a residual cycle the crank did not break, and a cycle the cranks introduce", () => {
    const shared = graph({
      nodes: [node(n("a")), node(n("b")), node(n("c"))],
      edges: [edge(n("a"), n("b")), edge(n("b"), n("a")), edge(n("b"), n("c")), edge(n("c"), n("b"))],
    });
    const t = text(shared, facts({ cranks: [crank(1, [n("a")], [], "apply a by hand")] }));
    expect(t).toContain(
      '    touched by: crank 1 by: "apply a by hand"  (documented, not verified); not broken: 2 nodes are still on a cycle (residual label: extracted)\n',
    );
    const intro = graph({
      nodes: [node(n("root")), node(n("gitea")), node(n("seed"))],
      externals: [external("mirror", "unspecified", n("gitea"))],
      edges: [
        edge(n("root"), n("seed"), { kind: "reads-source" }),
        edge(n("gitea"), n("root"), { kind: "deployed-by" }),
        edge("external:mirror", n("gitea"), { source: "declared" }),
      ],
    });
    const t2 = text(
      intro,
      facts({
        externals: [externalDecl("mirror", "unspecified", n("gitea"))],
        cranks: [crank(1, [], [{ node: n("root"), to: "mirror" }], "seed")],
      }),
    );
    expect(t2).toContain('    exists only once the cranks are applied; closed by: crank 1 by: "seed"\n');
    expect(t2).toContain('  external "mirror"  served by ConfigMap "ns/gitea" (declared, not verified)\n');
  });
  it("lists a dropped sync-wave and ordering constraint in crankpath's words, the owner quoted", () => {
    const job = "Application/argocd/app#0";
    const g = graph({
      nodes: [node(n("early"), { job, wave: -1 }), node(n("late"), { job, wave: 0 }), node(n("p")), node(n("q"))],
      edges: [edge(n("early"), n("late")), edge(n("q"), n("p"), { orderingOnly: true }), edge(n("p"), n("q"))],
    });
    const t = text(g);
    expect(t).toContain(
      [
        "  ordering constraints dropped: 2",
        '    sync waves -1 to 0 in what Application "argocd/app" renders: on a cycle with hard dependencies (it or another dropped constraint of that cycle runs against one)',
        '    ordering edge ConfigMap "ns/q" after ConfigMap "ns/p": on a cycle with hard dependencies (it or another dropped constraint of that cycle runs against one)',
      ].join("\n"),
    );
    expect(t).toContain('  step 1  start   ConfigMap "ns/late" (wave 0), ConfigMap "ns/q"\n');
    expect(t).toContain('  step 2  start   ConfigMap "ns/early" (wave -1), ConfigMap "ns/p"\n');
  });
  it("puts the same facts in the JSON: conflicts, statuses with reasons, cranks and their effects", () => {
    const g = graph({ nodes: [node(n("a")), node(n("b"))], edges: [edge(n("a"), n("b")), edge(n("b"), n("a"))] });
    const json = JSON.parse(renderJson(report(g, facts({ cranks: [crank(1, [n("a")])] }))));
    expect(json.cranks).toEqual([
      {
        by: "step 1",
        alreadyCreated: 0,
        createdNodes: [n("a")],
        id: "crank:1",
        keyPath: "cranks[0]",
        matched: true,
        ref: null,
        removedEdges: 1,
        reroutedEdges: [],
      },
    ]);
    expect(json.statusCounts).toEqual({ blocked: 0, startable: 2, unverified: 0 });
    expect(json.plan.steps.map((s: { kind: string }) => s.kind)).toEqual(["crank", "start"]);
  });
});
