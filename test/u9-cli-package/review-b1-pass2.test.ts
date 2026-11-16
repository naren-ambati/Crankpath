// Regression tests for the second B1 review (reviews/bolt-1-review-pass-2.md): each failed first.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { NO_DECLARED_FACTS } from "../../src/u1-graph-model/declared-facts.js";
import { buildObjects } from "../../src/u4-render-engine/rendered-set-builder.js";
import { analyse } from "../../src/u7-graph-analysis/analysis.js";
import { buildGraph } from "../../src/u7-graph-analysis/graph-builder.js";
import { renderJson } from "../../src/u8-output/json-renderer.js";
import { assembleReport } from "../../src/u8-output/report-assembler.js";
import { renderText } from "../../src/u8-output/text-renderer.js";
import { workloadRefExtractor } from "../../src/u6-extractors-workload/workload-refs.js";
import { main } from "../../src/u9-cli-package/cli-shell.js";
import { DEFAULT_BUDGET, runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { READER_PARSE_COST, RUN_BASELINE_BYTES, RUN_LIMITS, RUN_RATES } from "../../src/u1-graph-model/run-limits.js";
import { app, estate, FIXTURE, run, THIN_SLICE_URL, tempDir } from "../helpers/scan.js";
import { context, meta, obj } from "../helpers/objects.js";

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

describe("N1: two repos: entries naming one directory share one root", () => {
  it.each([
    ["sub", "sub"],
    ["sub", "./sub/"],
    ["sub", "sub/."],
  ])("reads read_from %s and %s as one root, never an internal error", (a, b) => {
    const config = `repos:\n  "https://example.org/a/b":\n    read_from: "${a}"\n  "https://example.org/c/d":\n    read_from: "${b}"\n`;
    const root = make({
      "crankpath.yaml": config,
      "apps/one.yaml": app("one", "p", "https://example.org/a/b"),
      "apps/two.yaml": app("two", "p", "https://example.org/c/d"),
      "sub/p/c.yaml": CM("c"),
    });
    const r = run([root, "--repo-url", THIN_SLICE_URL, "--format", "json"], process.cwd());
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const ids = JSON.parse(r.stdout).nodes.map((n: { id: string }) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["ConfigMap/one/c", "ConfigMap/two/c"]));
  });
});

function reportWith(droppedHooks: number) {
  const graph = buildGraph({ objects: [], extracted: [], config: NO_DECLARED_FACTS, opaque: [] });
  return assembleReport({
    scanned: { url: null, normalised: null, name: null, from: null },
    scannedPath: "x",
    graph,
    analysis: analyse(graph, NO_DECLARED_FACTS),
    config: NO_DECLARED_FACTS,
    sources: [{ kind: "Application", node: "Application/argocd/a", kustomizeRoot: null, mark: null }],
    skipped: [],
    unreadable: [],
    ignoredFiles: 0,
    droppedHooks,
    timeouts: 0,
    limits: { refusedJobs: 0, refusedFiles: 0, droppedEdges: 0 },
  });
}

describe("m1: dropped Helm test hooks are counted and shown; only Helm's own values drop", () => {
  it("shows the count in the text and the JSON", () => {
    const r = reportWith(2);
    expect(renderText(r)).toContain("  dropped: 2 Helm test hooks (not deployed by a GitOps controller)");
    expect(renderText(r)).not.toContain("(nothing opaque, nothing skipped)");
    expect(JSON.parse(renderJson(r)).runStatus.counts.droppedHooks).toBe(2);
    expect(renderText(reportWith(0))).not.toContain("dropped:");
  });
  it.each([
    ["test", 1],
    ["test-success", 1],
    ["test-failure", 1],
    ["pre-install, test-success", 1],
    ["tester", 0],
    ["test-other", 0],
    ["pre-install", 0],
  ])("drops helm.sh/hook %s: %i", (hook, dropped) => {
    const doc = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: "t", namespace: "n", annotations: { "helm.sh/hook": hook } },
    };
    const b = buildObjects([{ file: "f", document: 1, value: doc }], {
      renderJob: null,
      defaultNamespace: "n",
      destination: "in-cluster",
      dropTestHooks: true,
    });
    expect(b.droppedHooks).toBe(dropped);
  });
});

describe("m2: a closed output pipe ends quietly", () => {
  it("exits 1 with nothing on stderr when the reader closes standard output early", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i++) files[`apps/a${i}.yaml`] = app(`a${i}`, "p");
    for (let i = 0; i < 300; i++) files[`p/c${i}.yaml`] = CM(`c${i}`);
    const root = make(files);
    const child = spawn(
      process.execPath,
      [path.join(ROOT, "dist/u9-cli-package/cli.js"), root, "--repo-url", THIN_SLICE_URL, "--format", "json"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let err = "";
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.stdout.once("data", () => child.stdout.destroy());
    const code = await new Promise<number | null>((resolve) => child.on("close", (c) => resolve(c)));
    // one assertion over both, so a failure shows the exit code and what was written to stderr
    expect({ code, err }).toEqual({ code: 1, err: "" });
  });
});

describe("m3: --out is written only after the whole report exists", () => {
  it("leaves an earlier file unchanged when rendering the report fails", () => {
    const outDir = tempDir("out");
    cleanup.push(outDir);
    const target = path.join(outDir, "report.json");
    fs.writeFileSync(target, "earlier good report\n");
    let err = "";
    const exit = main([path.join(FIXTURE, "repo"), "--format", "json", "--out", target], {
      stdout: () => {},
      stderr: (t: string) => {
        err += t;
      },
      cwd: process.cwd(),
      // a report the renderer cannot render: the failure happens while producing the output
      run: () => ({ kind: "report", report: {} as never, exitCode: 0, rootReals: [], diagnostics: [] }),
    });
    expect(exit).toBe(1);
    expect(fs.readFileSync(target, "utf8")).toBe("earlier good report\n");
    expect(err).toContain("no --out file was written");
  });
});

describe("m4: a selector stops at its second match", () => {
  it("lists an ambiguity with the first two matches in id order", () => {
    const dep = (n: string) =>
      obj(
        meta("Deployment", "a", n, {
          spec: { template: { metadata: { labels: { app: "x" } }, spec: { containers: [] } } },
        }),
      );
    const deps = ["d1", "d2", "d3", "d4"].map(dep);
    const svc = obj(meta("Service", "a", "s", { spec: { selector: { app: "x" } } }));
    const r = workloadRefExtractor.extract([...deps, svc], context([...deps, svc]));
    expect(r.unresolved.map((u) => [u.why, u.candidates])).toEqual([
      ["selector-ambiguous", ["Deployment/a/d1", "Deployment/a/d2"]],
    ]);
  });
});

describe("n1, n3: wording", () => {
  it("calls an unparseable .json file not valid JSON", () => {
    const r = run(
      [
        make({ "apps/a.yaml": app("a", "p"), "p/c.yaml": CM("c"), "data.json": '{"a": 1, "a": 2}' }),
        "--repo-url",
        THIN_SLICE_URL,
      ],
      process.cwd(),
    );
    expect(r.stdout).toContain('  unreadable 1 of 1  file: "data.json"  (not valid JSON or YAML)');
  });
  it("never prints at least 0% when something is opaque", () => {
    const files: Record<string, string> = {
      "p/c.yaml": CM("c"),
      "broken.yaml": "a: [\n",
      "apps/bad.yaml": app("bad", "nope"),
    };
    for (let i = 0; i < 120; i++) files[`apps/a${i}.yaml`] = app(`a${i}`, "p");
    const r = run([make(files), "--repo-url", THIN_SLICE_URL], process.cwd());
    expect(r.stdout).toContain("Opacity: at least 1 of 121 sources opaque (at least 0.8%)");
    expect(r.stdout).not.toContain("(at least 0%)");
  });
});

describe("N2: the run's memory budget ends in counted limit outcomes, never a crash", () => {
  const rates = { perFileByte: 1, perObject: 100, perStringLeaf: 10, perEdge: 1 };
  const many = (apps: number) => {
    const files: Record<string, string> = { "p/c.yaml": `${CM("c")}---\n${CM("d")}` };
    for (let i = 0; i < apps; i++) files[`apps/a${i}.yaml`] = app(`a${i}`, "p");
    return make(files);
  };
  const pipe = (root: string, bytes: number, maxEdges = 1_000_000) => {
    const r = runPipeline({
      path: root,
      cwd: process.cwd(),
      repoUrl: THIN_SLICE_URL,
      budget: { bytes, rates, maxEdges, parse: { bytesPerLexeme: 0, textBytesPerByte: 0 } },
    });
    if (r.kind !== "report") throw new Error(r.message);
    return r.report;
  };
  it("takes jobs in while they fit, and makes an owner whose job does not fit opaque limit", () => {
    const root = many(5);
    const full = pipe(root, 1e12);
    expect(full.opaque).toEqual([]);
    // file bytes are small; each job is 2 objects (200) plus their string leaves
    const r = pipe(root, 3000);
    const limited = r.opaque.filter((o) => o.reason === "limit");
    expect(limited.length).toBeGreaterThan(0);
    expect(limited.length).toBeLessThan(5);
    expect(limited.every((o) => o.detail === "the run's memory budget was reached")).toBe(true);
    expect(r.runStatus.counts.runLimitJobs).toBe(limited.length);
    expect(r.runStatus.state).toBe("ANALYSED WITH GAPS");
    expect(r.runStatus.reasons).toContain("run-limit");
    const text = renderText(r);
    expect(text).toContain(`  run limit: the run's memory budget was reached: ${limited.length} render job`);
    expect(JSON.parse(renderJson(r)).runStatus.counts.runLimitJobs).toBe(limited.length);
  });
  it("charges string values, so an object with many of them costs more than its count", () => {
    const leafy = make({
      "apps/a.yaml": app("a", "p"),
      "p/c.yaml": `${CM("c")}data:\n${Array.from({ length: 200 }, (_, i) => `  k${i}: v`).join("\n")}\n`,
    });
    const plain = make({ "apps/a.yaml": app("a", "p"), "p/c.yaml": CM("c") });
    const budget = 2500;
    expect(pipe(plain, budget).runStatus.counts.runLimitJobs).toBe(0);
    expect(pipe(leafy, budget).runStatus.counts.runLimitJobs).toBe(1);
  });
  it("refuses a file over the budget as a counted unreadable file, so the counts are a floor", () => {
    const r = pipe(many(1), 10);
    expect(r.unreadable.some((u) => u.outcome === "too-large" && u.detail === "run budget")).toBe(true);
    expect(r.runStatus.counts.runLimitFiles).toBeGreaterThan(0);
    expect(r.runStatus.floor).toBe(true);
  });
  it("keeps at most edgesPerRun edges, the first in canonical order, and counts the rest", () => {
    const root = many(3);
    const all = pipe(root, 1e12).edges;
    const r = pipe(root, 1e12, 2);
    expect(r.edges).toEqual(all.slice(0, 2));
    expect(r.runStatus.counts.runLimitEdges).toBe(all.length - 2);
    expect(r.runStatus.floor).toBe(true);
    expect(renderText(r)).toContain("edges not kept");
  });
  it("derives the budget and bounds from the stated heap, baseline and measured rates (no reserve)", () => {
    expect(RUN_LIMITS.runMemory.value).toBe(2_500_000_000 - RUN_BASELINE_BYTES);
    // the parse transient uses lexemesPerFile's own terms (B0: heap, 45 MiB baseline, 3 x fileBytes text reserve)
    const { bytesPerLexeme, textBytesPerByte } = READER_PARSE_COST;
    expect(LIMITS.lexemesPerFile.value).toBe(
      Math.floor((2_500_000_000 - 45 * 1024 * 1024 - textBytesPerByte * LIMITS.fileBytes.value) / bytesPerLexeme),
    );
    expect(RUN_LIMITS.objectsPerRun.value).toBe(Math.floor(RUN_LIMITS.runMemory.value / RUN_RATES.perObject));
    expect(RUN_LIMITS.edgesPerRun.value).toBe(Math.floor(RUN_LIMITS.runMemory.value / RUN_RATES.perEdge));
    const doc = fs.readFileSync(path.join(ROOT, "docs", "limits.md"), "utf8");
    for (const l of Object.values(RUN_LIMITS)) expect(doc, l.unit).toContain(l.value.toLocaleString("en-US"));
    expect(DEFAULT_BUDGET).toMatchObject({
      bytes: RUN_LIMITS.runMemory.value,
      maxEdges: RUN_LIMITS.edgesPerRun.value,
      parse: { bytesPerLexeme: 937, textBytesPerByte: 3 },
    });
  });
});
