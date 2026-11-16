// Regression tests for the second B6 review (reviews/bolt-6-review-pass-2.md) on Reports, written
// to fail before their fixes: M1 (every list --explain prints is capped and counted: cranks,
// blockers, matches), m2 (the node form names the owner's own kind), m3 (an elementary cycle names
// only listed node numbers, and an unlisted node by its id), m4 (edge entries are counted in lines
// against the screen basis), m5 (the single-explanation stop keeps the cycle's closing lines and
// points nowhere false), n1 (an over-cap diagram with nothing drawn says so).

import { describe, expect, it } from "vitest";
import type { NodeId } from "../../src/u1-graph-model/graph-model.js";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { explainLogicalLines, explainTarget, renderExplain } from "../../src/u8-output/explain-renderer.js";
import { renderMermaid } from "../../src/u8-output/mermaid-renderer.js";
import type { Report } from "../../src/u8-output/report-model.js";
import { wrapLines } from "../../src/u8-output/text-layout.js";
import { edge, graph, n, node } from "../helpers/graphs.js";
import { fences } from "../helpers/mermaid-grammar.js";
import { graphReport } from "../helpers/reports.js";
import { flat } from "../helpers/text.js";

const K = LIMITS.explainListEntries.value;
const explain = (r: Report, id?: string) => flat(renderExplain(r, explainTarget(r, id) as never));

function twoCycle(a: NodeId, b: NodeId): Report {
  return graphReport(graph({ nodes: [node(a), node(b)], edges: [edge(a, b), edge(b, a)] }));
}

describe("M1: cranks and blockers are capped lists too", () => {
  it("lists the first 21 cranks of a cycle and counts the rest, which the JSON carries", () => {
    const base = twoCycle(n("a"), n("b"));
    const ids = Array.from({ length: 30 }, (_, i) => `crank:${i + 1}`);
    const c = base.cycles[0];
    if (c === undefined) throw new Error("no cycle");
    const r: Report = { ...base, cycles: [{ ...c, label: "cranked", crankedBy: ids }] };
    const text = explain(r, c.id);
    expect((text.match(/crank \d+ by:/g) ?? []).length).toBe(K);
    expect(text).toContain(`and ${30 - K} more cranks (in the JSON output)`);
  });
  it("lists the first 21 blockers of a node and counts the rest", () => {
    const base = twoCycle(n("a"), n("b"));
    const blockers = Array.from({ length: 30 }, (_, i) => `c-${String(i).padStart(8, "0")}`);
    const r: Report = {
      ...base,
      statuses: base.statuses.map((s) => (s.node === n("a") ? { ...s, blockers } : s)),
    };
    const text = explain(r, n("a"));
    expect(text).toContain(`30 blockers: cycle c-00000000,`);
    expect(text).toContain(`and ${30 - K} more (in the JSON output)`);
    expect(text).not.toContain("cycle c-00000021");
  });
});

describe("m2: the node form names the owner's own kind", () => {
  it("says this Kustomization for a Kustomization on a cycle", () => {
    const k = "Kustomization/flux-system/apps";
    const base = twoCycle(k, n("b"));
    const r: Report = {
      ...base,
      controllerMatches: [
        {
          owner: k,
          object: "Deployment/flux-system/kustomize-controller",
          signatureId: "flux-kustomize-controller",
          controller: "Flux's kustomize-controller",
          tool: "Flux",
        },
      ],
    };
    expect(explain(r, k)).toContain(
      'pattern: an object this Kustomization renders, Deployment "flux-system/kustomize-controller"',
    );
  });
});

describe("m3: elementary cycles name only listed node numbers", () => {
  it("names an unlisted node by its id, never by a number the output does not list", () => {
    const spokes = Array.from({ length: 29 }, (_, i) => n(`a${String(i).padStart(2, "0")}`));
    const hub = n("z");
    const r = graphReport(
      graph({
        nodes: [...spokes, hub].map((x) => node(x)),
        edges: spokes.flatMap((s) => [edge(s, hub), edge(hub, s)]),
      }),
    );
    const text = explain(r, r.cycles[0]?.id);
    expect(text).toContain('path 1 node 1 -> ConfigMap "ns/z" -> node 1');
    expect(text).not.toMatch(/node (2[2-9]|30)\b/);
  });
});

describe("m4: edge entries count their lines against the screen basis", () => {
  it("caps a cycle's evidence list at the screenful of four-line entries", () => {
    expect(LIMITS.explainEdgeEntries.value).toBe(Math.floor((24 - 3) / 4));
    const ids = Array.from({ length: 12 }, (_, i) => n(`r${String(i).padStart(2, "0")}`));
    const r = graphReport(
      graph({ nodes: ids.map((x) => node(x)), edges: ids.map((x, i) => edge(x, ids[(i + 1) % ids.length] as string)) }),
    );
    const text = explain(r, r.cycles[0]?.id);
    const e = LIMITS.explainEdgeEntries.value;
    expect(text).toContain(
      `evidence for the first ${e} of 12 edges (file, field, rendered path, line); the other ${12 - e} are in the JSON output`,
    );
  });
});

describe("m5: the single-explanation stop", () => {
  it("cuts the body, keeps the cycle's closing lines and the close, and says the cut lines are not printed", () => {
    const ids = Array.from({ length: 40 }, (_, i) => n(`r${String(i).padStart(2, "0")}`));
    const r = graphReport(
      graph({ nodes: ids.map((x) => node(x)), edges: ids.map((x, i) => edge(x, ids[(i + 1) % ids.length] as string)) }),
    );
    const target = explainTarget(r, r.cycles[0]?.id) as never;
    const out = wrapLines(explainLogicalLines(r, target, { outputLines: 60 }));
    expect(out.length).toBeLessThanOrEqual(60);
    const text = flat(out.join("\n"));
    expect(text).toMatch(
      /stopped: the explanation reached its bound of 60 lines; \d+ more lines of this explanation are not printed here/,
    );
    expect(text).toContain("nodes blocked by this cycle:");
    expect(text).toContain("self-management: none named");
    expect(text).toContain("Assumed, not verified by crankpath:");
    expect(text).toContain("Not modelled (5 items):");
    expect(text).not.toContain("the rest is in the JSON output");
  });
});

describe("n1: an over-cap diagram that draws nothing says so", () => {
  it("says nothing is drawn when no cycle component fits", () => {
    const g = graph({
      nodes: [node(n("a")), node(n("b")), node(n("c"))],
      edges: [edge(n("a"), n("b")), edge(n("b"), n("c"))],
    });
    const header = fences(renderMermaid(graphReport(g), { maxEdges: 1, maxTextChars: 50_000 }))[0]?.body ?? "";
    expect(flat(header)).toContain(
      "drawn: nothing: the graph as read (3 nodes, 2 edges) is over what Mermaid draws by default",
    );
  });
});
