// BaseHeadDiffer (U10): which head cycles are new (BR10.1 to BR10.3, BR10.9, OD-24, OD-27), the
// NOT CHECKED cases a report shows (OD-27 c, OD-30) and the declared facts a pull request adds
// (BR10.10). Reports are the thin slice's committed JSON with fields replaced, so every input has
// the shape the CLI writes. Each rule's test has a twin that breaks the input and sees it change.

import { describe, expect, it } from "vitest";
import { diffReports, edgeKey, notCheckedResult, readReport } from "../../action/base-head-differ.mjs";
import {
  A,
  D,
  type E,
  edge,
  type Json,
  RING,
  RING_REPORT,
  read,
  report,
  S,
  THIN,
  cycle,
} from "../helpers/action-reports.js";

describe("readReport", () => {
  it("reads the thin slice's committed JSON", () => {
    const r = readReport(THIN);
    expect(r?.run.state).toBe("ANALYSED WITH GAPS");
    expect(r?.cycles.map((c) => c.id)).toEqual(["c-d8197e7d"]);
    expect(r?.edges.length).toBe(9);
  });
  it("refuses another schema version, a missing field, a wrong type and an unknown state", () => {
    expect(readReport({ ...THIN, schemaVersion: 2 })).toBeUndefined();
    const noEdges = structuredClone(THIN) as Json;
    delete noEdges.edges;
    expect(readReport(noEdges)).toBeUndefined();
    const badCount = report({}, { opaque: "1" });
    expect(readReport(badCount)).toBeUndefined();
    expect(readReport(report({}, {}, { state: "PASSED" }))).toBeUndefined();
    expect(readReport(null)).toBeUndefined();
    expect(readReport([THIN])).toBeUndefined();
    expect(readReport(report({ cycles: [cycle("c-x", RING, "green")] }))).toBeUndefined();
  });
});

describe("new uncranked cycles (BR10.1, OD-24)", () => {
  it("a head cycle with an edge absent from the base is new and fails", () => {
    const base = read(report({ edges: RING.slice(0, 2).map((e) => edge(e)) }));
    const d = diffReports(base, read(RING_REPORT()));
    expect(d.result).toBe("FAILED");
    expect(d.newCycles.map((n) => [n.cycle.id, n.why, n.baseEdgesPresent])).toEqual([["c-ring", "new-edges", 2]]);
    expect(d.newCycles[0]?.newEdges.map(edgeKey)).toEqual([edgeKey(RING[2] as E)]);
    // twin: the base holds that edge too, so nothing is new
    const full = read(report({ edges: RING.map((e) => edge(e)), cycles: [cycle("c-ring", RING)] }));
    expect(diffReports(full, read(RING_REPORT())).result).toBe("NO_NEW_CYCLES_FOUND");
  });
  it("edge identity is (from, to, kind): another kind between the same nodes is a new edge", () => {
    const other = RING.map((e, i) => (i === 2 ? { ...e, kind: "depends-on" } : e));
    const base = read(report({ edges: other.map((e) => edge(e)), cycles: [cycle("c-ring", other)] }));
    expect(diffReports(base, read(RING_REPORT())).result).toBe("FAILED");
  });
  it("a new edge inside a cycle the base already had is not missed", () => {
    const head = read(
      report({
        edges: [...RING, { from: S, to: A, kind: "depends-on" }].map((e) => edge(e)),
        cycles: [cycle("c-ring", [...RING, { from: S, to: A, kind: "depends-on" }])],
      }),
    );
    const d = diffReports(read(RING_REPORT()), head);
    expect(d.result).toBe("FAILED");
    expect(d.newCycles[0]?.newEdges.map((e) => e.kind)).toEqual(["depends-on"]);
  });
  it("a renamed node makes its cycle new (documented, OD-24)", () => {
    const renamed = RING.map((e) => ({
      ...e,
      from: e.from.replace("gitea-http", "gitea-web"),
      to: e.to.replace("gitea-http", "gitea-web"),
    }));
    const head = read(report({ edges: renamed.map((e) => edge(e)), cycles: [cycle("c-renamed", renamed)] }));
    expect(diffReports(read(RING_REPORT()), head).result).toBe("FAILED");
  });
  it("a cycle that appears only because a source became readable counts as new (OD-27 d)", () => {
    // base: the Application was opaque, so its reads-source edge was never extracted
    const base = read(
      report(
        { edges: RING.slice(1).map((e) => edge(e)) },
        { opaque: 1 },
        { state: "ANALYSED WITH GAPS", reasons: ["opaque-sources"] },
      ),
    );
    const d = diffReports(base, read(RING_REPORT()));
    expect(d.result).toBe("FAILED");
    expect(d.newCycles[0]?.baseEdgesPresent).toBe(2);
  });
  it("an ordering-only base edge does not count as present", () => {
    const ordering = { ...edge(RING[2] as E), orderingOnly: true };
    const base = read(report({ edges: [...RING.slice(0, 2).map((e) => edge(e)), ordering] }));
    const d = diffReports(base, read(RING_REPORT()));
    expect(d.result).toBe("FAILED");
    expect(d.newCycles.map((n) => [n.why, n.newEdges.map(edgeKey)])).toEqual([["new-edges", [edgeKey(RING[2] as E)]]]);
  });
  it("a head cycle with every edge in the base but no base component is still new, never old", () => {
    const d = diffReports(read(report({ edges: RING.map((e) => edge(e)) })), read(RING_REPORT()));
    expect(d.newCycles.map((n) => n.why)).toEqual(["no-base-component"]);
  });
  it("a declared-edge cycle that is new fails too, and keeps its declared label", () => {
    const declared = RING.map((e, i) => (i === 2 ? { ...e, source: "declared" } : e));
    const head = read(
      report({ edges: declared.map((e) => edge(e)), cycles: [cycle("c-ring", declared, "declared (unverified)")] }),
    );
    const d = diffReports(read(report({ edges: RING.slice(0, 2).map((e) => edge(e)) })), head);
    expect(d.result).toBe("FAILED");
    expect(d.newCycles[0]?.cycle.label).toBe("declared (unverified)");
    expect(d.declared.declaredEdges.map(edgeKey)).toEqual([edgeKey(RING[2] as E)]);
  });
  it("new edges carry the head's evidence", () => {
    const head = read(report({ edges: RING.map((e) => edge(e, "platform/x.yaml")), cycles: [cycle("c-ring", RING)] }));
    const d = diffReports(read(report()), head);
    expect(d.newCycles[0]?.newEdges.map((e) => e.evidence.file)).toEqual([
      "platform/x.yaml",
      "platform/x.yaml",
      "platform/x.yaml",
    ]);
  });
});

describe("old and cranked cycles (BR10.2, BR10.3)", () => {
  it("a head cycle whose edges all exist in the base and was uncranked there never fails", () => {
    const d = diffReports(read(RING_REPORT()), read(RING_REPORT()));
    expect(d.result).toBe("NO_NEW_CYCLES_FOUND");
    expect(d.unchangedCycles.map((c) => c.id)).toEqual(["c-ring"]);
  });
  it("a cycle cranked in the head never fails, even when it is new (a crank the PR adds)", () => {
    const crank = {
      alreadyCreated: 0,
      by: "apply by hand",
      createdNodes: [S],
      id: "crank:1",
      keyPath: "cranks[0]",
      matched: true,
      ref: null,
      removedEdges: 2,
      reroutedEdges: [],
    };
    const head = read(RING_REPORT("cranked", { crankedBy: ["crank:1"] }, { cranks: [crank] }));
    const d = diffReports(read(report()), head);
    expect(d.result).toBe("NO_NEW_CYCLES_FOUND");
    expect(d.crankedInHead.map((c) => c.cycle.id)).toEqual(["c-ring"]);
    expect(d.declared.cranks.map((k) => k.by)).toEqual(["apply by hand"]);
    // twin: the same head without its crank fails
    expect(diffReports(read(report()), read(RING_REPORT())).result).toBe("FAILED");
  });
});

describe("a removed crank (BR10.9, OD-27 a)", () => {
  const crank = {
    alreadyCreated: 0,
    by: "apply by hand",
    createdNodes: [S],
    id: "crank:1",
    keyPath: "cranks[0]",
    matched: true,
    ref: "runbooks/a.md",
    removedEdges: 2,
    reroutedEdges: [],
  };
  it("a cycle cranked in the base and uncranked in the head is new and fails", () => {
    const base = read(RING_REPORT("cranked", { crankedBy: ["crank:1"] }, { cranks: [crank] }));
    const d = diffReports(base, read(RING_REPORT()));
    expect(d.result).toBe("FAILED");
    expect(d.newCycles.map((n) => n.why)).toEqual(["crank-removed"]);
    expect(d.newCycles[0]?.baseCranks.map((k) => k.ref)).toEqual(["runbooks/a.md"]);
    // twin: uncranked in the base too, so it is old
    expect(diffReports(read(RING_REPORT()), read(RING_REPORT())).result).toBe("NO_NEW_CYCLES_FOUND");
  });
  it("finds the base component through any node of the head cycle (a larger base component)", () => {
    const bigger = [
      ...RING,
      { from: S, to: "ConfigMap/gitea/c", kind: "needs-config" },
      { from: "ConfigMap/gitea/c", to: A, kind: "deployed-by" },
    ];
    const base = read(
      report({
        edges: bigger.map((e) => edge(e)),
        cycles: [cycle("c-big", bigger, "cranked", { crankedBy: ["crank:1"] })],
        cranks: [crank],
      }),
    );
    expect(diffReports(base, read(RING_REPORT())).newCycles.map((n) => n.why)).toEqual(["crank-removed"]);
  });
  it("an edge a base reroute added counts as a base edge", () => {
    const rerouted: E[] = [
      { from: A, to: "external:mirror", kind: "rerouted", source: "declared" },
      { from: "external:mirror", to: D, kind: "depends-on", source: "declared" },
      { from: D, to: A, kind: "deployed-by" },
    ];
    const r = report({
      edges: [edge(RING[2] as E)],
      cycles: [cycle("c-rr", rerouted, "declared (unverified)", { introducedBy: ["crank:1"] })],
    });
    expect(diffReports(read(r), read(r)).result).toBe("NO_NEW_CYCLES_FOUND");
  });
});

describe("NOT CHECKED from a report (OD-27 c, OD-30)", () => {
  it("NOTHING ANALYSED on either side", () => {
    const nothing = read(report({}, {}, { state: "NOTHING ANALYSED", reasons: ["no-sources"] }));
    expect(diffReports(nothing, read(RING_REPORT())).notChecked).toEqual([{ side: "base", code: "nothing-analysed" }]);
    expect(diffReports(read(RING_REPORT()), nothing).notChecked).toEqual([{ side: "head", code: "nothing-analysed" }]);
    expect(diffReports(read(RING_REPORT()), nothing).result).toBe("NOT_CHECKED");
  });
  it("a timeout on either side, even with a new cycle in view", () => {
    const timed = read(report({}, { timeouts: 2 }, { state: "ANALYSED WITH GAPS", reasons: ["timeouts"] }));
    const d = diffReports(read(report()), { ...read(RING_REPORT()), run: timed.run });
    expect(d.result).toBe("NOT_CHECKED");
    expect(d.notChecked).toEqual([{ side: "head", code: "timeout", count: 2 }]);
    expect(d.newCycles).toEqual([]);
    expect(diffReports(timed, read(RING_REPORT())).notChecked[0]?.side).toBe("base");
  });
  it("a NOT CHECKED result needs a reason", () => {
    expect(() => notCheckedResult([])).toThrow(/needs a reason/);
  });
  it("gaps the base has too are not NOT CHECKED: they are stated beside the result (BR10.8)", () => {
    const gaps = read(RING_REPORT("extracted", {}, {}));
    const withGaps = {
      ...gaps,
      run: { ...gaps.run, state: "ANALYSED WITH GAPS", opaque: 3, reasons: ["opaque-sources"] },
    };
    const d = diffReports(withGaps, withGaps);
    expect(d.result).toBe("NO_NEW_CYCLES_FOUND");
    expect(d.head?.opaque).toBe(3);
    // a gap item the base did not have is NOT CHECKED (B8 review pass 2 m1, review-b8-pass2.test.ts)
    const item = {
      ...withGaps,
      opaque: [{ node: "Application/argocd/x", kustomizeRoot: null, reason: "render-failed", key: "x" }],
    };
    expect(diffReports(read(RING_REPORT()), item).result).toBe("NOT_CHECKED");
  });
});

describe("declared facts the pull request adds or changes (BR10.10, OD-27 b)", () => {
  const crank = (by: string, created: string[]) => ({
    alreadyCreated: 0,
    by,
    createdNodes: created,
    id: "crank:1",
    keyPath: "cranks[0]",
    matched: true,
    ref: null,
    removedEdges: 0,
    reroutedEdges: [],
  });
  it("lists a crank the head adds or changes, not one the base already had", () => {
    const base = read(report({ cranks: [crank("a", [S])] }));
    expect(
      diffReports(base, read(report({ cranks: [{ ...crank("a", [S]), id: "crank:2", keyPath: "cranks[1]" }] })))
        .declared.cranks,
    ).toEqual([]);
    expect(diffReports(base, read(report({ cranks: [crank("b", [S])] }))).declared.cranks.map((k) => k.by)).toEqual([
      "b",
    ]);
    expect(diffReports(base, read(report({ cranks: [crank("a", [S, D])] }))).declared.cranks.length).toBe(1);
  });
  it("lists externals declared or changed in the head, never an unspecified one", () => {
    const ext = (coldStart: string, servedBy: string | null = null) => ({
      coldStart,
      id: "external:github.com",
      servedBy,
    });
    const base = read(report({ externals: [ext("unspecified")] }));
    expect(diffReports(base, read(report({ externals: [ext("available")] }))).declared.externals.length).toBe(1);
    expect(diffReports(base, read(report({ externals: [ext("unspecified")] }))).declared.externals.length).toBe(0);
    expect(
      diffReports(read(report({ externals: [ext("available")] })), read(report({ externals: [ext("available")] })))
        .declared.externals.length,
    ).toBe(0);
    expect(diffReports(base, read(report({ externals: [ext("unspecified", S)] }))).declared.externals.length).toBe(1);
  });
  it("lists match overrides and crankpath.yaml repos: mappings the head adds, never --repo-alias ones", () => {
    const m = {
      declared: S,
      extracted: { candidates: [], node: null, outcome: "none" },
      host: "git.example.org",
      keyPath: "match[0]",
    };
    const map = (from: string) => ({ from, root: "vendor/x", url: "https://example.org/x", used: true });
    const d = diffReports(
      read(report()),
      read(report({ matchOverrides: [m], repoMappings: [map("crankpath.yaml"), map("--repo-alias")] })),
    );
    expect(d.declared.matchOverrides.map((x) => x.host)).toEqual(["git.example.org"]);
    expect(d.declared.repoMappings.map((x) => x.from)).toEqual(["crankpath.yaml"]);
  });
  it("lists cycles hidden by match entries in the head that the base did not hold", () => {
    const hidden = {
      edges: 3,
      hiddenBy: ["match[0]"],
      id: "c-hidden",
      label: "extracted",
      nodeIds: [A, S, D],
      nodes: 3,
    };
    const d = diffReports(read(report()), read(report({ hiddenCycles: [hidden] })));
    expect(d.hiddenNew.map((h) => h.id)).toEqual(["c-hidden"]);
    expect(
      diffReports(read(report({ hiddenCycles: [hidden] })), read(report({ hiddenCycles: [hidden] }))).hiddenNew,
    ).toEqual([]);
  });
});

describe("determinism", () => {
  it("the same reports in another order give the same result", () => {
    const two: E[] = [
      { from: "Secret/a/s", to: "Deployment/a/d", kind: "produced-by" },
      { from: "Deployment/a/d", to: "Secret/a/s", kind: "needs-secret" },
    ];
    const head = report({
      edges: [...RING, ...two].map((e) => edge(e)),
      cycles: [cycle("c-ring", RING), cycle("c-two", two)],
    });
    const reversed = structuredClone(head);
    (reversed.edges as unknown[]).reverse();
    (reversed.cycles as unknown[]).reverse();
    const a = diffReports(read(report()), read(head));
    const b = diffReports(read(report()), read(reversed));
    expect(a.newCycles.map((n) => n.cycle.id)).toEqual(["c-ring", "c-two"]);
    expect(b.newCycles.map((n) => n.cycle.id)).toEqual(a.newCycles.map((n) => n.cycle.id));
  });
});
