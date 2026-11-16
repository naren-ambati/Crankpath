import { describe, expect, it } from "vitest";
import {
  blocked,
  claimWordsInOwnVoice,
  deriveRunStatus,
  type RunCounts,
  StatusConstructionError,
  startable,
  unresolvedItem,
  unverified,
} from "../../src/u1-graph-model/status-model.js";

const CLEAN: RunCounts = {
  sourcesFound: 2,
  sourcesByKind: { Application: 2, ApplicationSet: 0, Kustomization: 0, HelmRelease: 0, KustomizeRoot: 0 },
  rendered: 2,
  opaque: 0,
  opaqueApplicationSets: 0,
  unresolved: 0,
  skipped: 0,
  skippedSources: 0,
  unreadableFiles: 0,
  ignoredFiles: 0,
  droppedHooks: 0,
  foreignDestination: 0,
  runLimitFiles: 0,
  runLimitJobs: 0,
  runLimitEdges: 0,
  timeouts: 0,
  edgesExtracted: 3,
  edgesDeclared: 0,
  nodes: 4,
  declaredFacts: 0,
  declaredAssumptions: 0,
};

describe("node status (BR1.7, BR1.8)", () => {
  it("refuses startable over a gap in the dependency closure", () => {
    expect(startable("Service/a/b", false).status).toBe("startable");
    expect(() => startable("Service/a/b", true)).toThrow(StatusConstructionError);
  });
  it("needs a named blocker for blocked and unverified", () => {
    expect(blocked("Service/a/b", ["c-1"]).blockers).toEqual(["c-1"]);
    expect(() => blocked("Service/a/b", [])).toThrow(StatusConstructionError);
    expect(unverified("Service/a/b", ["opaque"]).status).toBe("unverified");
    expect(() => unverified("Service/a/b", [])).toThrow(StatusConstructionError);
  });
  it("keeps unresolved reasons to the fixed list", () => {
    expect(unresolvedItem("x", "not-defined", "a.yaml#1", null).why).toBe("not-defined");
    expect(() => unresolvedItem("x", "guess" as never, "a", null)).toThrow(StatusConstructionError);
  });
});

describe("run status (BR1.10, AC1.3.4)", () => {
  it("is ANALYSED only with no gap of any kind", () => {
    expect(deriveRunStatus(CLEAN, []).state).toBe("ANALYSED");
    // declared facts the plan only assumes (externals, served_by, cranks) are not a gap by themselves
    expect(deriveRunStatus({ ...CLEAN, declaredAssumptions: 3 }, []).state).toBe("ANALYSED");
    expect(deriveRunStatus(CLEAN, []).reasons).toEqual([]);
  });
  it.each([
    ["opaque", { opaque: 1 }, "opaque-sources"],
    ["unresolved", { unresolved: 1 }, "unresolved-items"],
    ["skipped", { skipped: 1 }, "skipped-objects"],
    ["unreadable", { unreadableFiles: 1 }, "unreadable-files"],
    ["timeouts", { timeouts: 1 }, "timeouts"],
    ["no edges", { edgesExtracted: 0 }, "no-dependency-edges"],
    ["relying on a declared fact", { declaredFacts: 1 }, "declared-facts"],
  ] as const)("has gaps when %s", (_name, change, reason) => {
    const s = deriveRunStatus({ ...CLEAN, ...change }, []);
    expect(s.state).toBe("ANALYSED WITH GAPS");
    expect(s.reasons).toContain(reason);
  });
  it("has gaps when a part of the analysis is not computed in this build", () => {
    expect(deriveRunStatus(CLEAN, ["plan"]).reasons).toEqual(["not-computed"]);
  });
  it("is NOTHING ANALYSED with zero sources, even with other counts", () => {
    expect(deriveRunStatus({ ...CLEAN, sourcesFound: 0, unreadableFiles: 3 }, []).state).toBe("NOTHING ANALYSED");
  });
  it("is a floor when files, ApplicationSets, timeouts or source documents were not counted", () => {
    expect(deriveRunStatus(CLEAN, []).floor).toBe(false);
    for (const change of [
      { unreadableFiles: 1 },
      { opaqueApplicationSets: 1 },
      { timeouts: 1 },
      { skippedSources: 1 },
    ]) {
      expect(deriveRunStatus({ ...CLEAN, ...change }, []).floor).toBe(true);
    }
  });
});

describe("claim guard (NFR3)", () => {
  it("finds claim words in crankpath's own voice and ignores them inside quoted repo text", () => {
    expect(claimWordsInOwnVoice('name: "PASS everything is OK"')).toEqual([]);
    expect(claimWordsInOwnVoice('Run status: OK  name: "x\\"PASS"')).toEqual(["OK"]);
    expect(claimWordsInOwnVoice("Cycles: no cycles")).toEqual(["no cycles"]);
    expect(claimWordsInOwnVoice("all checks passed, estate is safe and clean")).toEqual(["CLEAN", "PASSED", "SAFE"]);
    expect(claimWordsInOwnVoice("a booking is not a word match")).toEqual([]);
  });
});
