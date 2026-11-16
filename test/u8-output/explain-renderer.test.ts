// ExplainRenderer (US8.4; AC8.4.1, AC8.4.2, BR8.9, BR8.10): every edge of a cycle or a node's
// dependencies with its file, field, rendered path and line quoted after fixed labels; elementary
// cycles up to the derived bound with a stated stop; cranks documented, not verified; the plan's
// assumptions. On the Vault fixture's two cycles (the bolt's demo) and on synthetic graphs.

import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { claimWordsInOwnVoice } from "../../src/u1-graph-model/status-model.js";
import { explainTarget, renderExplain } from "../../src/u8-output/explain-renderer.js";
import { crank, edge, facts, graph, n, node } from "../helpers/graphs.js";
import { graphReport, vaultReport } from "../helpers/reports.js";
import { flat, unwrapText } from "../helpers/text.js";

const explain = (r: ReturnType<typeof vaultReport>, id?: string) => {
  const target = explainTarget(r, id);
  if (target === undefined) throw new Error(`no target ${id}`);
  return unwrapText(renderExplain(r, target));
};

describe("--explain on the Vault fixture's cycles (AC8.4.1)", () => {
  const report = vaultReport([]);
  const text = explain(report);
  it("explains both cycles with every edge's file, field and rendered path quoted after fixed labels", () => {
    expect(report.cycles).toHaveLength(2);
    const edgeBy = new Map(report.edges.map((e) => [`${e.from}\n${e.to}\n${e.kind}`, e]));
    for (const c of report.cycles) {
      expect(text).toContain(`cycle ${c.id}  label: extracted  nodes: ${c.nodes.length}  edges: ${c.edges.length}`);
      for (const e of c.edges) {
        const ev = edgeBy.get(`${e.from}\n${e.to}\n${e.kind}`)?.evidence;
        expect(ev).toBeDefined();
        expect(text).toContain(
          `      file: "${ev?.file}"  line: not recorded\n      field: "${ev?.field}"\n      rendered path: "${ev?.renderedPath}"`,
        );
      }
    }
    expect(text).toContain(
      '    edge 2 of 5  ClusterIssuer "vault-pki" depends on Service "vault/vault" (depends-on, extracted)',
    );
  });
  it("lists each cycle's one elementary cycle and names no self-management (Argo CD is installed outside)", () => {
    expect(text).toContain("    path 1  node 1 -> node 3 -> node 2 -> node 1");
    expect(text).toContain("    path 1  node 1 -> node 2 -> node 4 -> node 5 -> node 3 -> node 1");
    expect(text.match(/self-management: none named/g)).toHaveLength(2);
  });
  it("ends with the plan's assumptions and the not-modelled list, and says nothing clean in its own voice", () => {
    expect(text).toContain("Assumed, not verified by crankpath: 0 externals declared available;");
    expect(text).toContain('Argo CD\'s namespace taken to be Namespace "argocd"');
    expect(text).toContain("Not modelled (5 items): a running Argo CD or Flux controller is assumed;");
    expect(text).toContain("Run status: ANALYSED WITH GAPS");
    expect(claimWordsInOwnVoice(text)).toEqual([]);
  });
  it("names the crank that breaks cycle A, documented and not verified (variant crank-a)", () => {
    const cranked = vaultReport(["crank-a"]);
    const a = cranked.cycles.find((c) => c.label === "cranked");
    const t = explain(cranked, a?.id);
    expect(t).toContain(`cycle ${a?.id}  label: cranked (was extracted)`);
    expect(flat(t)).toMatch(/ cranked by: crank 1 by: "[^"]+" \(documented, not verified\)/);
    expect(t).toContain("nodes blocked by this cycle: 0 (it is cranked: documented, not verified)");
    expect(t).toContain("1 crank (documented)");
  });
});

describe("elementary cycles are bounded and the output says when it stopped (AC8.4.2)", () => {
  it("lists the first 21 of a five-node complete component and states the stop", () => {
    const ids = ["a", "b", "c", "d", "e"].map((x) => n(x));
    const edges = ids.flatMap((x) => ids.filter((y) => y !== x).map((y) => edge(x, y)));
    const report = graphReport(graph({ nodes: ids.map((x) => node(x)), edges }));
    const t = explain(report, report.cycles[0]?.id);
    const bound = LIMITS.explainElementaryCycles.value;
    expect(t).toContain(
      `  elementary cycles: the first ${bound} found (as node sequences); stopped at the bound of ${bound}`,
    );
    expect(t.match(/^ {4}path \d+ {2}/gm)).toHaveLength(bound);
    expect(t).toContain(
      "    stopped: more elementary cycles exist; every node and edge on any of them is in this cycle's node and edge sets (the JSON output lists them all)",
    );
    expect(t).toContain("evidence for the first 5 of 20 edges");
  });
  it("labels a declared edge declared, unverified", () => {
    const g = graph({
      nodes: [node(n("a")), node(n("b"))],
      edges: [edge(n("a"), n("b")), edge(n("b"), n("a"), { source: "declared" })],
    });
    const report = graphReport(g, facts());
    const t = explain(report, report.cycles[0]?.id);
    expect(flat(t)).toContain(
      flat('edge 2 of 2  ConfigMap "ns/b" depends on ConfigMap "ns/a" (depends-on, declared, unverified)'),
    );
    expect(t).toContain("label: declared (unverified)");
  });
});

describe("--explain for a node, and the targets", () => {
  const g = graph({
    nodes: [node(n("a"), { path: "a.yaml" }), node(n("b"), { flags: ["not-defined"] })],
    edges: [edge(n("a"), n("b"), { kind: "needs-config" })],
  });
  const report = graphReport(g, facts({ cranks: [crank(1, [n("zzz")])] }));
  it("shows where a node was read, its status and reason, its dependencies with evidence and its dependents", () => {
    const t = explain(report, n("a"));
    expect(t).toContain('node ConfigMap "ns/a"');
    expect(t).toContain('  read from: file: "a.yaml"  document: 1  read directly from the repository');
    expect(t).toMatch(/ {2}status: unverified {2}reason: undefined-reference/);
    expect(flat(t)).toContain(
      flat('    edge 1 of 1  ConfigMap "ns/a" needs ConfigMap "ns/b" (needs-config, extracted)'),
    );
    expect(t).toContain(
      '      file: "f.yaml"  line: not recorded\n      field: "spec.x"\n      rendered path: "f.yaml#1"',
    );
    expect(t).toContain("  dependents: 0 edges");
    const b = explain(report, n("b"));
    expect(b).toContain("  read from: no file (a node crankpath made: a reference target or an external)");
    expect(b).toContain("  flags: not-defined");
    expect(b).toContain('    ConfigMap "ns/a" needs it  (needs-config, extracted)');
  });
  it("finds a cycle id or a node id, and nothing else; without an id, explains every cycle", () => {
    expect(explainTarget(report, n("a"))).toEqual({ kind: "node", node: n("a") });
    expect(explainTarget(report, "c-00000000")).toBeUndefined();
    expect(explainTarget(report, "ConfigMap/ns/none")).toBeUndefined();
    expect(explainTarget(report, undefined)).toEqual({ kind: "all" });
  });
  it("with no cycle at all, says so with the cycles line, never a bare none", () => {
    const t = explain(report);
    expect(t).toContain("Cycles: none found among 2 nodes and 1 edge read (0 nodes opaque;");
    expect(t).toContain("no cycle to explain; name a node id to see its evidence (--explain <node id>)");
  });
});
