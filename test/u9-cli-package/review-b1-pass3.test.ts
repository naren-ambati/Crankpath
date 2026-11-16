// Regression tests for the third B1 review (reviews/bolt-1-review-pass-3.md): each failed first.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { NO_DECLARED_FACTS } from "../../src/u1-graph-model/declared-facts.js";
import { makeOpaqueMark } from "../../src/u1-graph-model/graph-model.js";
import { RUN_RATES } from "../../src/u1-graph-model/run-limits.js";
import { countLexemes } from "../../src/u2-intake-config/bounded-reader.js";
import { deriveRunStatus, type RunCounts } from "../../src/u1-graph-model/status-model.js";
import { workloadRefExtractor } from "../../src/u6-extractors-workload/workload-refs.js";
import { analyse } from "../../src/u7-graph-analysis/analysis.js";
import { buildGraph } from "../../src/u7-graph-analysis/graph-builder.js";
import { renderJson } from "../../src/u8-output/json-renderer.js";
import { assembleReport, type SourceOutcome } from "../../src/u8-output/report-assembler.js";
import { renderText } from "../../src/u8-output/text-renderer.js";
import { main } from "../../src/u9-cli-package/cli-shell.js";
import { type RunOptions, runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { context, meta, obj } from "../helpers/objects.js";
import { app, estate, FIXTURE, THIN_SLICE_URL } from "../helpers/scan.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function make(files: Record<string, string>): string {
  const d = estate(files);
  cleanup.push(d);
  return d;
}
const CM = (name: string) => `apiVersion: v1\nkind: ConfigMap\nmetadata: {name: ${name}}\n`;
const RATES = { perFileByte: 1, perObject: 100, perStringLeaf: 10, perEdge: 1 };
function pipe(root: string, bytes: number, maxEdges = 1_000_000) {
  const r = runPipeline({
    path: root,
    cwd: process.cwd(),
    repoUrl: THIN_SLICE_URL,
    budget: { bytes, rates: RATES, maxEdges, parse: { bytesPerLexeme: 0, textBytesPerByte: 0 } },
  });
  if (r.kind !== "report") throw new Error(r.message);
  return r.report;
}
function cli(root: string, bytes: number, extra: string[] = [], maxEdges = 1_000_000) {
  let stdout = "";
  let stderr = "";
  const code = main([root, "--repo-url", THIN_SLICE_URL, ...extra], {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd: process.cwd(),
    run: (o: RunOptions) =>
      runPipeline({
        ...o,
        budget: { bytes, rates: RATES, maxEdges, parse: { bytesPerLexeme: 0, textBytesPerByte: 0 } },
      }),
  });
  return { code, stdout, stderr };
}
/** A big file of plain data named to sort before everything else. */
const BIG = { "0big.yaml": `${Array.from({ length: 2000 }, (_, i) => `k${i}: value-${i}`).join("\n")}\n` };

describe("M1: every run-limit refusal makes the counts a floor", () => {
  const base: RunCounts = {
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
  it.each(["runLimitFiles", "runLimitJobs", "runLimitEdges"] as const)("sets floor for %s", (k) => {
    expect(deriveRunStatus({ ...base, [k]: 1 }, []).floor).toBe(true);
  });
  it("says at least after a refused job, in text and JSON", () => {
    const files: Record<string, string> = { "p/c.yaml": `${CM("c")}---\n${CM("d")}` };
    for (let i = 0; i < 5; i++) files[`apps/a${i}.yaml`] = app(`a${i}`, "p");
    const r = pipe(make(files), 3000);
    expect(r.runStatus.counts.runLimitJobs).toBeGreaterThan(0);
    expect(renderText(r)).toMatch(/^Opacity: at least \d+ of 5 sources opaque/m);
    expect(JSON.parse(renderJson(r)).runStatus.floor).toBe(true);
  });
});

describe("m1: the budget is not sticky: a later item that fits is still taken in", () => {
  it("reads an honest file after a big one that does not fit", () => {
    const r = pipe(make({ ...BIG, "zz.yaml": app("zz", "p"), "p/c.yaml": CM("c") }), 3000);
    expect(r.runStatus.counts.runLimitFiles).toBe(1);
    expect(r.runStatus.counts.sourcesFound).toBe(1);
    expect(r.nodes.map((n) => n.id)).toContain("ConfigMap/zz/c");
  });
  it("takes in a small job after a big one that does not fit, and says the order decides", () => {
    const big = Array.from({ length: 40 }, (_, i) => CM(`b${i}`)).join("---\n");
    const r = pipe(
      make({
        "apps/a0.yaml": app("a0", "big"),
        "apps/a1.yaml": app("a1", "small"),
        "big/b.yaml": big,
        "small/s.yaml": CM("s"),
      }),
      5000,
    );
    expect(r.opaque.map((o) => [o.node, o.reason])).toEqual([["Application/argocd/a0", "limit"]]);
    expect(r.nodes.map((n) => n.id)).toContain("ConfigMap/a1/s");
    expect(renderText(r)).toContain("which items are refused follows the code-point order of file names and sources");
  });
});

describe("m2: a budget refusal is never NOTHING ANALYSED", () => {
  it("is ANALYSED WITH GAPS, exit 0, naming the refusal and its detail, when the only source was refused", () => {
    const only = app("a", "p").replace(
      "  namespace: argocd\n",
      `  namespace: argocd\n  annotations: {pad: "${"x".repeat(4000)}"}\n`,
    );
    const r = cli(make({ "a.yaml": only, "p/c.yaml": CM("c") }), 3000);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Run status: ANALYSED WITH GAPS");
    expect(r.stdout).toContain('  unreadable 1 of 1  file: "a.yaml"  (run budget reached)');
    expect(r.stdout).toContain("  run limit: the run's memory budget was reached: 1 file not read");
    expect(r.stdout).not.toContain("NOTHING ANALYSED");
  });
});

describe("m3: dropped edges never read as none found", () => {
  const repo = path.join(FIXTURE, "repo");
  it("says not determined when no cycle is left and edges were dropped", () => {
    const r = cli(repo, 1e12, [], 1);
    expect(r.stdout).toContain("Cycles: not determined (8 edges not kept over the run limit)");
    expect(r.stdout).not.toContain("none found");
  });
  it("adds that other cycles may exist when cycles remain", () => {
    const r = cli(repo, 1e12, [], 8);
    expect(r.stdout).toContain("Cycles: 1 uncranked");
    expect(r.stdout).toContain("  (1 edge not kept over the run limit: other cycles may exist)");
  });
  it("never prints nothing opaque, nothing skipped when only edges were dropped", () => {
    const r = cli(make({ "apps/a.yaml": app("a", "p"), "p/c.yaml": `${CM("c")}---\n${CM("d")}` }), 1e12, [], 1);
    expect(r.stdout).toContain("run limit:");
    expect(r.stdout).not.toContain("(nothing opaque, nothing skipped)");
  });
});

describe("m4: a truncated candidate list says so", () => {
  const dep = (n: string) =>
    obj(
      meta("Deployment", "a", n, {
        spec: { template: { metadata: { labels: { app: "x" } }, spec: { containers: [] } } },
      }),
    );
  const svc = obj(meta("Service", "a", "s", { spec: { selector: { app: "x" } } }));
  it("marks five matches as the first 2 of more than 2, and two matches as complete", () => {
    const five = ["d1", "d2", "d3", "d4", "d5"].map(dep);
    const r5 = workloadRefExtractor.extract([...five, svc], context([...five, svc])).unresolved[0];
    expect(r5).toMatchObject({ candidates: ["Deployment/a/d1", "Deployment/a/d2"], candidatesTruncated: true });
    const two = ["d1", "d2"].map(dep);
    expect(workloadRefExtractor.extract([...two, svc], context([...two, svc])).unresolved[0]).toMatchObject({
      candidatesTruncated: false,
    });
  });
  it("prints the truncation in the text", () => {
    const deps = (n: number) =>
      Array.from(
        { length: n },
        (_, i) =>
          `apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: d${i}}\nspec:\n  template:\n    metadata: {labels: {app: x}}\n    spec: {containers: []}\n`,
      ).join("---\n");
    const svcYaml = "apiVersion: v1\nkind: Service\nmetadata: {name: s}\nspec: {selector: {app: x}}\n";
    const r = cli(make({ "apps/a.yaml": app("a", "p"), "p/d.yaml": deps(5), "p/s.yaml": svcYaml }), 1e12);
    expect(r.stdout).toContain('    candidates: first 2 of more than 2: Deployment "a/d0", Deployment "a/d1"');
  });
});

describe("m5 and the surviving mutants: the doc says what the code charges, and pins the rates", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs", "limits.md"), "utf8");
  it("pins each rate to the measurement output recorded in docs/limits.md (rounded up, worst shape)", () => {
    const rate = (name: string) => Number(new RegExp(`^${name}: ([\\d.]+) bytes per unit`, "m").exec(doc)?.[1]);
    expect(RUN_RATES.perObject).toBe(Math.ceil(rate("objects")));
    expect(RUN_RATES.perEdge).toBe(Math.ceil(rate("edges")));
    expect(RUN_RATES.perStringLeaf).toBe(RUN_RATES.perEdge);
    expect(RUN_RATES.perFileByte).toBe(Math.ceil(Math.max(rate("files"), rate("files-flow"))));
  });
  it("does not claim more than the charge covers, and tells B2 to charge rendered bytes", () => {
    expect(doc).not.toContain("exact in the direction that matters");
    expect(doc).toContain("B2 must charge each render's output bytes");
  });
});

function report(sources: SourceOutcome[], unreadable = 0) {
  const graph = buildGraph({ objects: [], extracted: [], config: NO_DECLARED_FACTS, opaque: [] });
  return assembleReport({
    scanned: { url: null, normalised: null, name: null, from: null },
    scannedPath: "x",
    graph,
    analysis: analyse(graph, NO_DECLARED_FACTS),
    config: NO_DECLARED_FACTS,
    sources,
    skipped: [],
    unreadable: Array.from({ length: unreadable }, (_, i) => ({
      path: `u${i}.yaml`,
      outcome: "parse-error",
      reasonWord: "not valid YAML",
      detail: null,
    })),
    ignoredFiles: 0,
    droppedHooks: 0,
    timeouts: 0,
    limits: { refusedFiles: 0, refusedJobs: 0, droppedEdges: 0 },
  });
}

describe("nits", () => {
  it("n1: never doubles the qualifier, and gives no percentage over zero sources", () => {
    const mark = makeOpaqueMark({ reason: "limit", lostEdges: ["x"] });
    const sources: SourceOutcome[] = Array.from({ length: 1501 }, (_, i) => ({
      kind: "Application",
      node: `Application/argocd/a${i}`,
      kustomizeRoot: null,
      mark: i === 0 ? mark : null,
    }));
    const text = renderText(report(sources, 1));
    expect(text).toContain("Opacity: at least 1 of 1501 sources opaque (more than 0%)");
    expect(text).not.toContain("at least more than");
  });
  it("n3: tool output cites no repository file", () => {
    const files: Record<string, string> = { "p/c.yaml": `${CM("c")}---\n${CM("d")}` };
    for (let i = 0; i < 5; i++) files[`apps/a${i}.yaml`] = app(`a${i}`, "p");
    const r = cli(make(files), 3000, ["--format", "json"]);
    expect(r.stdout).not.toContain("docs/limits.md");
    expect(cli(make(files), 3000).stdout).not.toContain("docs/limits.md");
  });
});

describe("lead decision: a file's parse transient must fit in what the run has not yet held", () => {
  const PARSE = { bytesPerLexeme: 1, textBytesPerByte: 3 };
  const run = (root: string, bytes: number) => {
    const r = runPipeline({
      path: root,
      cwd: process.cwd(),
      repoUrl: THIN_SLICE_URL,
      budget: { bytes, rates: { ...RATES, perObject: 0, perStringLeaf: 0 }, maxEdges: 1_000_000, parse: PARSE },
    });
    if (r.kind !== "report") throw new Error(r.message);
    return r.report;
  };
  // An Application padded with one long annotation: a large text of few lexemes.
  const padded = (name: string) =>
    app(name, "p").replace(
      "  namespace: argocd\n",
      `  namespace: argocd\n  annotations: {pad: "${"x".repeat(20_000)}"}\n`,
    );
  const cost = (text: string) => {
    const bytes = Buffer.byteLength(text);
    return {
      held: bytes * RATES.perFileByte,
      transient: countLexemes(text, 1e9) * PARSE.bytesPerLexeme + bytes * PARSE.textBytesPerByte,
    };
  };
  const small = CM("c");
  const filler = `${Array.from({ length: 1500 }, (_, i) => `k${i}: value-${i}`).join("\n")}\n`;

  it("refuses a file whose transient does not fit beside what the run holds, and admits it in a fresh run", () => {
    const zz = cost(padded("zz"));
    const fill = cost(filler);
    const p = cost(small);
    // room for the filler's parse and for zz's parse alone, but not for zz's parse beside the filler held
    const budget = fill.held + p.held + zz.transient - 1;
    expect(budget).toBeGreaterThanOrEqual(fill.transient);
    const near = run(make({ "0data.yaml": filler, "p/c.yaml": small, "zz.yaml": padded("zz") }), budget);
    expect(near.unreadable).toContainEqual({
      path: "zz.yaml",
      outcome: "too-large",
      reasonWord: "run budget reached",
      detail: "run budget",
    });
    expect(near.runStatus.counts.runLimitFiles).toBe(1);
    expect(near.runStatus.floor).toBe(true);
    expect(near.runStatus.state).toBe("ANALYSED WITH GAPS");
    const fresh = run(make({ "p/c.yaml": small, "zz.yaml": padded("zz") }), budget);
    expect(fresh.runStatus.counts.runLimitFiles).toBe(0);
    expect(fresh.nodes.map((n) => n.id)).toContain("ConfigMap/zz/c");
  });
  it("releases the transient after the parse: only the held cost stays charged", () => {
    const one = cost(padded("aa"));
    const p = cost(small);
    // both files fit if only held costs accumulate; not if the first transient stayed charged
    const budget = p.held + one.held + one.transient;
    expect(budget).toBeLessThan(p.held + one.transient + one.transient);
    const r = run(make({ "aa.yaml": padded("aa"), "ab.yaml": padded("ab"), "p/c.yaml": small }), budget);
    expect(r.runStatus.counts.runLimitFiles).toBe(0);
    expect(r.runStatus.counts.sourcesFound).toBe(2);
  });
});
