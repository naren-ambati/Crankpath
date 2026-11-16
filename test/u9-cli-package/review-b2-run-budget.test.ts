// B2's merge of main: a render's output is charged to B1's per-run budget like a file read (its
// parse transient checked against what the run has not yet held before it is parsed, then its bytes
// held), its objects and their string values charged as B1 charges them, and a refusal is a counted
// `limit` on the owner. Helm test hooks are dropped from Helm renders only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { HelmJob } from "../../src/u3-discovery-expansion/render-job.js";
import { renderHelm } from "../../src/u4-render-engine/helm-renderer.js";
import { renderKustomize } from "../../src/u4-render-engine/kustomize-renderer.js";
import { DEFAULT_BUDGET, runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { fakePath, harness } from "../helpers/render.js";
import { estate, tempDir } from "../helpers/scan.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/render/repo/", import.meta.url));
const URL_ = "https://example.org/ops/render-demo";
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

const job: HelmJob = {
  kind: "helm",
  jobId: "Application/argocd/web#0",
  owner: "Application/argocd/web",
  ownerFile: "apps/web.yaml",
  ownerField: "spec.source.path",
  ownerRenderedPath: "apps/web.yaml#1",
  destination: "in-cluster",
  namespace: "web",
  namespaceOverride: null,
  releaseName: "web",
  valuesInputs: [],
  source: { repo: null, path: null, chart: null, version: null, floating: false },
  generatedBy: null,
  substitute: null,
  floating: [],
  chart: { from: "repo", root: ".", dir: "charts/web" },
  values: [],
  includeCrds: true,
  skipSchemaValidation: false,
};

function chartHarness() {
  const h = harness(FIXTURE);
  cleanup.push(h.cacheRoot);
  return h;
}

describe("a render's output against the run's budget", () => {
  it("asks the budget before parsing, with the output's lexemes and bytes, then holds its bytes", () => {
    const h = chartHarness();
    const asked: [number, number][] = [];
    const held: number[] = [];
    const io = {
      ...h.io,
      runtime: {
        ...h.io.runtime,
        admitOutput: (l: number, b: number) => {
          asked.push([l, b]);
          return true;
        },
        holdOutput: (b: number) => {
          held.push(b);
          return true;
        },
      },
    };
    const set = renderHelm(job, io);
    expect(set.outcome).toBe("ok");
    // the comparison render (B2 review pass 2) asks for its transient too; only one output is held
    expect(asked).toHaveLength(2);
    expect(asked[0]?.[0]).toBeGreaterThan(50);
    expect(held).toEqual([asked[0]?.[1]]);
    expect(set.stringLeaves).toBeGreaterThan(0);
  });
  it("is a `limit` with no object when the parse would not fit, and when the bytes cannot be held", () => {
    const h = chartHarness();
    for (const runtime of [
      { ...h.io.runtime, admitOutput: () => false },
      { ...h.io.runtime, holdOutput: () => false },
    ]) {
      const set = renderHelm(job, { ...h.io, runtime });
      expect(set).toMatchObject({
        outcome: "limit",
        objects: [],
        opaque: { detail: "the run's memory budget was reached" },
      });
    }
  });
  it("refuses the renders that do not fit, counted, and keeps the ones that do (pipeline)", () => {
    const dir = tempDir("budget");
    cleanup.push(dir);
    const r = runPipeline({
      path: FIXTURE,
      cwd: "/",
      repoUrl: URL_,
      toolPath: fakePath(),
      cacheDir: path.join(dir, "cache"),
      budget: { ...DEFAULT_BUDGET, bytes: 800_000 },
    });
    if (r.kind !== "report") throw new Error("expected a report");
    const counts = r.report.runStatus.counts as unknown as Record<string, number>;
    expect(counts.runLimitFiles).toBe(0);
    expect(counts.runLimitJobs).toBe(2);
    const byNode = Object.fromEntries(r.report.opaque.map((o) => [o.node, o.detail]));
    expect(byNode["Application/argocd/web"]).toBe("the run's memory budget was reached");
    expect(byNode["HelmRelease/flux-system/web"]).toBe("the run's memory budget was reached");
    expect(r.report.nodes.map((n) => n.id)).toContain("Deployment/platform/platform-agent");
    // with the derived budget nothing is refused
    const full = runPipeline({
      path: FIXTURE,
      cwd: "/",
      repoUrl: URL_,
      toolPath: fakePath(),
      cacheDir: path.join(dir, "c2"),
    });
    if (full.kind !== "report") throw new Error("expected a report");
    expect((full.report.runStatus.counts as unknown as Record<string, number>).runLimitJobs).toBe(0);
  });
});

describe("Helm test hooks are dropped from Helm renders only", () => {
  it("keeps an object annotated as a Helm test in a kustomize render", () => {
    const root = estate({
      "k/kustomization.yaml": "resources: [pod.yaml]\n",
      "k/pod.yaml": 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\n  annotations: {"helm.sh/hook": test}\n',
    });
    cleanup.push(root);
    const h = harness(root);
    cleanup.push(h.cacheRoot);
    const set = renderKustomize({ ...job, kind: "kustomize", releaseName: null, root: ".", dir: "k" } as never, h.io);
    expect(set.objects.map((o) => o.name)).toEqual(["p"]);
    expect(set.droppedHooks).toBe(0);
    expect(renderHelm(job, chartHarness().io).droppedHooks).toBe(1);
  });
});
