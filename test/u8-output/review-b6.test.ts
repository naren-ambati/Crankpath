// Regression tests for the B6 review (reviews/bolt-6-review.md) on Reports, written to fail before
// their fixes: M1 (the self-management note is a labelled observation, only for a match an
// Application on the cycle renders, by name and labels), m1 (the node form said the opposite of
// "none"), m3 (the text cap inside the component loop had no test), m4 and m5 (--explain is bounded
// by derived limits and says what it left out), m6 (Mermaid never says "the whole graph read" when
// the run has gaps).

import { describe, expect, it } from "vitest";
import type { Edge, GraphNode } from "../../src/u1-graph-model/graph-model.js";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { explainTarget, renderExplain, renderExplainLines } from "../../src/u8-output/explain-renderer.js";
import { renderMermaid } from "../../src/u8-output/mermaid-renderer.js";
import type { Report } from "../../src/u8-output/report-model.js";
import { edge, graph, n, node } from "../helpers/graphs.js";
import { checkMermaid, fences } from "../helpers/mermaid-grammar.js";
import { fixtureReport, graphReport, SELF_MANAGED, vaultReport } from "../helpers/reports.js";
import { flat } from "../helpers/text.js";

const selfManaged = () => fixtureReport(SELF_MANAGED, "http://gitea-http.gitea:3000/ops/self-managed");
const cycleOf = (r: Report, id: string) => r.cycles.find((c) => c.nodes.includes(id));

describe("M1: a labelled observation, never a reassurance", () => {
  const report = selfManaged();
  const cycle = cycleOf(report, "Application/argocd/root");
  const text = flat(renderExplain(report, explainTarget(report, cycle?.id) as never));
  it("words the pattern as an observation of repo-set labels and a conditional, in crankpath's voice only for the facts", () => {
    expect(text).toContain(
      'pattern: an object this cycle\'s Application "argocd/root" renders, StatefulSet "argocd/argocd-application-controller", carries the name and labels Argo CD\'s application controller uses (name and labels set by the repo, not verified; this object is not on the cycle); if this is the controller\'s own install, a first-install crank breaks it',
    );
    expect(text).not.toContain("not a defect");
    expect(text).not.toContain("black-start unit");
    expect(text).not.toContain("deploys itself");
  });
  it("names nothing for a match whose owner is not on the cycle", () => {
    const moved: Report = {
      ...report,
      controllerMatches: report.controllerMatches.map((m) => ({ ...m, owner: "Application/argocd/elsewhere" })),
    };
    const t = flat(renderExplain(moved, explainTarget(moved, cycle?.id) as never));
    expect(t).toContain("self-management: none named (no source on this cycle renders an object");
    expect(t).not.toContain("pattern:");
  });
});

describe("m1: the node form says none when there is none", () => {
  it("says the node renders no matching object, or is on no cycle", () => {
    const vault = vaultReport([]);
    const onCycle = flat(renderExplain(vault, explainTarget(vault, "Application/argocd/platform") as never));
    expect(onCycle).toContain(
      "self-management: none named (it renders no object matching the Argo CD or Flux controller signatures)",
    );
    const off = flat(renderExplain(vault, explainTarget(vault, "Application/argocd/root") as never));
    expect(off).toContain("self-management: none named (it is on no cycle)");
    const sm = selfManaged();
    const root = flat(renderExplain(sm, explainTarget(sm, "Application/argocd/root") as never));
    expect(root).toContain("pattern: an object this Application renders, StatefulSet");
  });
});

describe("m6: Mermaid says the whole graph read only when the run has no gap", () => {
  it("uses the gap wording on a run with gaps and the plain wording on an ANALYSED run", () => {
    const gaps = fences(renderMermaid(vaultReport([])))[0]?.body ?? "";
    expect(gaps).not.toContain("the whole graph read");
    expect(flat(gaps)).toContain(
      "drawn: every node and edge of the graph as read (27 nodes, 50 edges); the run has gaps, listed above, so the estate may hold more",
    );
    const clean = selfManaged();
    expect(clean.runStatus.state).toBe("ANALYSED");
    expect(fences(renderMermaid(clean))[0]?.body).toContain("drawn: the whole graph read (");
  });
});

describe("m3: the text cap applies inside the component loop", () => {
  it("draws fewer components when they fit the edge cap but not the text cap", () => {
    const nodes: GraphNode[] = [];
    const edges: Edge[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push(node(n(`a${i}`)), node(n(`b${i}`)));
      edges.push(edge(n(`a${i}`), n(`b${i}`)), edge(n(`b${i}`), n(`a${i}`)));
    }
    const report = graphReport(graph({ nodes, edges }));
    const whole = fences(renderMermaid(report))[1]?.body ?? "";
    const limits = { maxEdges: 1000, maxTextChars: whole.length - 1 };
    const capped = fences(renderMermaid(report, limits));
    const check = checkMermaid(capped[1]?.body ?? "");
    expect(check.errors).toEqual([]);
    expect((capped[1]?.body ?? "").length).toBeLessThanOrEqual(limits.maxTextChars);
    expect(check.edges).toBe(18);
    expect(flat(capped[0]?.body ?? "")).toContain("only the cycle components, 9 of 10");
  });
});

describe("m4, m5: --explain is bounded by derived limits and says what it left out", () => {
  const ring = (count: number) => {
    const ids = Array.from({ length: count }, (_, i) => n(`r${String(i).padStart(6, "0")}`));
    return graphReport(
      graph({ nodes: ids.map((x) => node(x)), edges: ids.map((x, i) => edge(x, ids[(i + 1) % count] as string)) }),
    );
  };
  it("lists at most one screenful of nodes, edges and path steps for a 20,000-node cycle, and counts the rest", () => {
    const report = ring(20_000);
    const lines = renderExplainLines(report, explainTarget(report, report.cycles[0]?.id) as never);
    expect(lines.length).toBeLessThanOrEqual(LIMITS.explainOutputLines.value);
    const text = flat(lines.join("\n"));
    const k = LIMITS.explainListEntries.value;
    const e = LIMITS.explainEdgeEntries.value;
    expect(text).toContain(`nodes, numbered in the order of the JSON's cycles[].nodes: the first ${k} of 20000 listed`);
    expect(text).toContain(
      `evidence for the first ${e} of 20000 edges (file, field, rendered path, line); the other ${20000 - e} are in the JSON output`,
    );
    expect(text).toContain(`path 1 node 1 -> node 2`);
    expect(text).toContain("... and 19979 more nodes back to node 1");
    expect(lines.filter((l) => /^ {4}edge \d+ of 20000 /.test(l))).toHaveLength(e);
  });
  it("stops an every-cycle explanation at the total line bound and says how many cycles it left out", () => {
    const nodes: GraphNode[] = [];
    const edges: Edge[] = [];
    for (let i = 0; i < 200; i++) {
      const ids = Array.from({ length: 30 }, (_, j) => n(`c${i}-${j}`));
      for (const x of ids) nodes.push(node(x));
      ids.forEach((x, j) => {
        edges.push(edge(x, ids[(j + 1) % ids.length] as string));
      });
    }
    const report = graphReport(graph({ nodes, edges }));
    const lines = renderExplainLines(report, { kind: "all" });
    expect(lines.length).toBeLessThanOrEqual(LIMITS.explainOutputLines.value);
    const text = flat(lines.join("\n"));
    expect(text).toMatch(
      /stopped: the explanation reached its bound of 1,024 lines; \d+ of 200 cycles are not explained here \(--explain <cycle id> explains one\)/,
    );
    expect(text).toContain("Not modelled (5 items):");
  });
  it("bounds a node's dependencies and dependents the same way", () => {
    const hub = n("hub");
    const leaves = Array.from({ length: 100 }, (_, i) => n(`l${String(i).padStart(3, "0")}`));
    const report = graphReport(
      graph({
        nodes: [node(hub), ...leaves.map((x) => node(x))],
        edges: [...leaves.map((x) => edge(hub, x)), ...leaves.map((x) => edge(x, hub, { kind: "needs-config" }))],
      }),
    );
    const text = flat(renderExplain(report, explainTarget(report, hub) as never));
    const k = LIMITS.explainListEntries.value;
    expect(text).toContain(
      `dependencies: 100 edges; the first ${LIMITS.explainEdgeEntries.value}, each with where it was read; the other ${100 - LIMITS.explainEdgeEntries.value} are in the JSON output`,
    );
    expect(text).toContain(`dependents: 100 edges; the first ${k}; the other ${100 - k} are in the JSON output`);
  });
  it("keeps the thin slice's explanation whole (8 edges, 5 nodes, 4 paths are under every bound)", () => {
    expect(LIMITS.explainListEntries.value).toBeGreaterThanOrEqual(8);
  });
});
