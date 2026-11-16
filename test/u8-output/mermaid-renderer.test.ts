// MermaidRenderer (US8.3; AC8.3.1, AC8.3.2, BR8.7, BR8.8, OD-18): cycle edges marked, opaque nodes
// dashed, a legend, every label escaped, a text fallback; over the derived cap only cycle components
// are drawn and the document says so. Every document passes the strict structural check of the
// grammar crankpath emits (test/helpers/mermaid-grammar.ts), which is itself shown able to fail.

import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { renderMermaid } from "../../src/u8-output/mermaid-renderer.js";
import { edge, facts, graph, n, node } from "../helpers/graphs.js";
import { checkMermaid, fences } from "../helpers/mermaid-grammar.js";
import { fixtureReport, graphReport, SELF_MANAGED, vaultReport } from "../helpers/reports.js";
import { flat, unwrapText } from "../helpers/text.js";

function parts(doc: string) {
  const f = fences(doc);
  expect(f.map((x) => x.info)).toEqual(["text", "mermaid", "text"]);
  return { header: f[0]?.body ?? "", diagram: f[1]?.body ?? "", fallback: f[2]?.body ?? "" };
}

describe("the Mermaid document (AC8.3.1)", () => {
  it("passes the grammar check for the Vault and self-managed fixtures, with both Vault cycles marked", () => {
    for (const report of [
      vaultReport([]),
      fixtureReport(SELF_MANAGED, "http://gitea-http.gitea:3000/ops/self-managed"),
    ]) {
      const { diagram } = parts(renderMermaid(report));
      const check = checkMermaid(diagram);
      expect(check.errors).toEqual([]);
      expect(check.nodes).toBe(report.nodes.length);
      expect(check.edges).toBe(report.edges.length);
    }
    const vault = parts(renderMermaid(vaultReport([]))).diagram;
    expect(vault.match(/==>/g)?.length).toBe(3 + 5);
    expect(vault).toContain('on cycle c-35505771"');
  });
  it("draws declared edges dotted and says unverified; opaque nodes dashed and named opaque; a legend", () => {
    const g = graph({
      nodes: [node(n("a")), node(n("b"), { opaque: true }), node(n("c"))],
      edges: [
        edge(n("a"), n("b")),
        edge(n("b"), n("c"), { source: "declared" }),
        edge(n("c"), n("a"), { source: "declared" }),
      ],
    });
    const { diagram, fallback } = parts(renderMermaid(graphReport(g, facts())));
    expect(checkMermaid(diagram).errors).toEqual([]);
    expect(diagram).toContain('  n2["ConfigMap #34;ns/b#34;, opaque: unreadable-file"]:::opaque');
    expect(diagram).toMatch(/ {2}n2 -\.->\|"depends-on, declared, unverified, on cycle c-[0-9a-f]+"\| n3/);
    expect(diagram).toContain("classDef opaque stroke-dasharray: 5 5");
    expect(diagram).toContain('legend4["dashed border: an opaque node"]:::opaque');
    expect(flat(fallback)).toMatch(
      /ConfigMap "ns\/b" -> ConfigMap "ns\/c" depends-on declared \(unverified\) cycle: c-/,
    );
  });
  it("says no cycle honestly in its header: never a bare none", () => {
    const g = graph({ nodes: [node(n("a")), node(n("b"))], edges: [edge(n("a"), n("b"))] });
    const { header } = parts(renderMermaid(graphReport(g)));
    expect(unwrapText(header)).toContain(
      "Cycles: none found among 2 nodes and 1 edge read (0 nodes opaque; 0 unresolved items)",
    );
    expect(header).toContain("drawn: the whole graph read (2 nodes, 1 edge)");
  });
});

describe("the derived cap (AC8.3.2, OD-18)", () => {
  const maxEdges = LIMITS.mermaidMaxEdges.value;
  it("draws only the cycle components of a graph over the edge cap, and says so", () => {
    const chain = Array.from({ length: maxEdges + 10 }, (_, i) => edge(n(`c${i}`), n(`c${i + 1}`)));
    const nodes = [...Array.from({ length: maxEdges + 11 }, (_, i) => node(n(`c${i}`))), node(n("x")), node(n("y"))];
    const g = graph({ nodes, edges: [...chain, edge(n("x"), n("y")), edge(n("y"), n("x"))] });
    const report = graphReport(g);
    const { header, diagram, fallback } = parts(renderMermaid(report));
    const check = checkMermaid(diagram);
    expect(check.errors).toEqual([]);
    expect([check.nodes, check.edges]).toEqual([2, 2]);
    expect(unwrapText(header)).toContain(
      `drawn: only the cycle components, 1 of 1 (2 nodes of ${nodes.length} and 2 edges of ${maxEdges + 12}): the graph as read (${nodes.length} nodes, ${maxEdges + 12} edges) is over what Mermaid draws by default (500 edges or 50,000 characters); every node and edge is in the JSON output and the cycles in the text report`,
    );
    expect(fallback).toContain("the rest of the graph is in the JSON output (--format json)");
  });
  it("draws whole cycle components while they fit, and counts the ones left out", () => {
    const edges = [];
    const nodes = [];
    for (let i = 0; i < 300; i++) {
      nodes.push(node(n(`a${i}`)), node(n(`b${i}`)));
      edges.push(edge(n(`a${i}`), n(`b${i}`)), edge(n(`b${i}`), n(`a${i}`)));
    }
    const report = graphReport(graph({ nodes, edges }));
    expect(report.cycles).toHaveLength(300);
    const { header, diagram } = parts(renderMermaid(report));
    const check = checkMermaid(diagram);
    expect(check.errors).toEqual([]);
    expect(check.edges).toBe(maxEdges);
    expect(unwrapText(header)).toContain("only the cycle components, 250 of 300");
    expect(unwrapText(header)).toContain("50 cycle components are not drawn either");
  });
  it("applies the text cap too: long names push the whole diagram over 50,000 characters", () => {
    const long = (i: number) => n(`${"x".repeat(240)}-${i}`);
    const nodes = Array.from({ length: 220 }, (_, i) => node(long(i)));
    const edges = Array.from({ length: 219 }, (_, i) => edge(long(i), long(i + 1)));
    const report = graphReport(graph({ nodes, edges: [...edges, edge(long(219), long(218))] }));
    const { header, diagram } = parts(renderMermaid(report));
    expect(checkMermaid(diagram).errors).toEqual([]);
    expect(diagram.length).toBeLessThanOrEqual(LIMITS.mermaidMaxTextChars.value);
    expect(unwrapText(header)).toContain("only the cycle components, 1 of 1 (2 nodes of 220");
  });
});

describe("the grammar check can fail", () => {
  const good = parts(renderMermaid(vaultReport([]))).diagram;
  it("refuses a label with a raw quote, a raw bracket, an undeclared node, a stray line and an unclosed legend", () => {
    expect(checkMermaid(good).errors).toEqual([]);
    expect(checkMermaid(good.replace("#34;argocd/platform#34;", '"argocd/platform"')).errors.length).toBeGreaterThan(0);
    expect(checkMermaid(good.replace("#34;argocd/platform#34;", "[argocd/platform]")).errors.length).toBeGreaterThan(0);
    expect(checkMermaid(good.replace(/ n1$/m, " n999")).errors.join()).toContain("undeclared n999");
    expect(checkMermaid(`${good}\n  click n1 call alert()`).errors.length).toBeGreaterThan(0);
    expect(checkMermaid(good.replace("  end\n", "")).errors.length).toBeGreaterThan(0);
  });
  it("refuses text outside a fence and a line that could close a fence", () => {
    expect(() => fences("stray\n```text\nx\n```\n")).toThrow(/outside a fence/);
    expect(() => fences("```text\n  ``` x\n```\n")).toThrow(/could close it/);
  });
});
