// B2 review, second pass: every kustomization list entry is judged whatever its YAML form (M1),
// the tools run with an empty PATH so a missed entry still reaches no `git` (M1, defence in
// depth), every Helm render is compared with a second render (M3, m2), hosts are normalised
// before the URL guard (m1), the cache `.gitignore` is written only into a directory crankpath
// creates (m3), and the branches the review found unpinned (m3b).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import type { HelmJob, KustomizeJob } from "../../src/u3-discovery-expansion/render-job.js";
import { buildChildEnv, RUNNER_LIMITS } from "../../src/u4-render-engine/command-runner.js";
import { renderHelm } from "../../src/u4-render-engine/helm-renderer.js";
import { renderKustomize } from "../../src/u4-render-engine/kustomize-renderer.js";
import { guardChartUrl } from "../../src/u4-render-engine/url-guard.js";
import { createWorkDir } from "../../src/u4-render-engine/work-dir.js";
import { RunBudget } from "../../src/u9-cli-package/run-budget.js";
import { DEFAULT_BUDGET } from "../../src/u9-cli-package/pipeline-runner.js";
import { fakeDir, harness, NODE_DIR, type RenderHarness } from "../helpers/render.js";
import { estate } from "../helpers/scan.js";
import { withValue } from "../support/limits.js";

const made: RenderHarness[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const h of made.splice(0)) h.cleanup();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function setup(files: Record<string, string>, options: Parameters<typeof harness>[1] = {}) {
  const root = estate(files);
  roots.push(root);
  const h = harness(root, options);
  made.push(h);
  return h;
}

const base = {
  jobId: "Application/argocd/a#0",
  owner: "Application/argocd/a",
  ownerFile: "apps/a.yaml",
  ownerField: "spec.source.path",
  ownerRenderedPath: "apps/a.yaml#1",
  destination: "in-cluster",
  namespace: "a",
  namespaceOverride: null,
  valuesInputs: [],
  source: { repo: null, path: null, chart: null, version: null, floating: false },
  generatedBy: null,
  substitute: null,
  floating: [],
} as const;
const kz = (dir = "k"): KustomizeJob => ({ ...base, kind: "kustomize", releaseName: null, root: ".", dir });
const helm = (dir = "c", extra: Partial<HelmJob> = {}): HelmJob => ({
  ...base,
  kind: "helm",
  releaseName: "a",
  chart: { from: "repo", root: ".", dir },
  values: [],
  includeCrds: true,
  skipSchemaValidation: false,
  ...extra,
});
const CM = "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: top}\n";
const chart = (extra: Record<string, string> = {}) => ({
  "c/Chart.yaml": "apiVersion: v2\nname: c\nversion: 0.1.0\n",
  "c/templates/cm.yaml": CM,
  "c/fake-render.yaml": CM,
  ...extra,
});

describe("M1: every kustomization entry is judged whatever its YAML form", () => {
  it.each([
    ["generators", "generators:\n  - |\n    https://127.0.0.1:1/org/repo.git//base?ref=main\n"],
    ["transformers", "transformers:\n  - >-\n    https://127.0.0.1:1/org/repo.git//base\n"],
    ["validators", "validators:\n  - |-\n    git@127.0.0.1:org/repo.git\n"],
    ["configurations", "configurations:\n  - |\n    https://example.org/c.yaml\n"],
    ["resources", 'resources:\n  - "https://127.0.0.1:1/org/repo.git//base\n    ?ref=main"\n'],
    ["components", 'components: ["cm.yaml\\nhttps://example.org/x"]\n'],
    ["crds", "crds:\n  - |\n    https://example.org/crd.yaml\n"],
  ])("refuses a multi-line %s entry before kustomize runs", (_field, text) => {
    const h = setup({
      "k/kustomization.yaml": `resources: [cm.yaml]\n${text}`.replace(
        /^resources: \[cm.yaml\]\nresources:/,
        "resources:",
      ),
      "k/cm.yaml": CM,
    });
    const set = renderKustomize(kz(), h.io);
    expect(set.opaque?.reason, text).toMatch(/^(remote-base|unsupported-field)$/);
    expect(h.commands).toEqual([]);
  });
  it("refuses an inline transformer configuration (not a plain relative path), and an entry that is not a string", () => {
    for (const text of [
      "resources: [cm.yaml]\ntransformers:\n  - |\n    apiVersion: builtin\n    kind: PrefixTransformer\n",
      "resources:\n  - {path: cm.yaml}\n",
      "resources: [cm.yaml, 7]\n",
    ]) {
      const h = setup({ "k/kustomization.yaml": text, "k/cm.yaml": CM });
      expect(renderKustomize(kz(), h.io).opaque, text).toMatchObject({
        reason: "unsupported-field",
        detail: "an entry that is not a plain relative path",
      });
    }
  });
  it("keeps an inline strategic-merge patch (kustomize never fetches one)", () => {
    const h = setup({
      "k/kustomization.yaml":
        "resources: [cm.yaml]\npatchesStrategicMerge:\n  - |\n    apiVersion: v1\n    kind: ConfigMap\n",
      "k/cm.yaml": CM,
    });
    expect(renderKustomize(kz(), h.io).outcome).toBe("ok");
  });
  it("names a remote base by its form when it is scp-style (m3b)", () => {
    const h = setup({ "k/kustomization.yaml": "resources:\n  - git@github.com:org/repo.git\n" });
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({
      reason: "remote-base",
      detail: "a remote base or URL entry is never fetched",
    });
  });
});

describe("M1, defence in depth: the tools run with an empty PATH", () => {
  it("gives every child an empty private directory as its PATH, whatever crankpath's own PATH", () => {
    const work = createWorkDir(path.join(os.tmpdir(), "crankpath-never-made"), true);
    expect(buildChildEnv(work.homes).PATH).toBe(work.homes.empty);
  });
  it("a tool that shells out to git finds none, even with a logging git first on crankpath's PATH", () => {
    const gitBin = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-git-"));
    roots.push(gitBin);
    const log = path.join(gitBin, "git.log");
    fs.writeFileSync(path.join(gitBin, "git"), `#!/bin/sh\necho "GIT CALLED: $*" >> ${JSON.stringify(log)}\n`, {
      mode: 0o755,
    });
    const toolPath = [gitBin, fakeDir("tested"), NODE_DIR].join(path.delimiter);
    const h = setup({ "k/kustomization.yaml": "resources: []\n", "k/fake.json": '{"mode":"spawn-git"}' }, { toolPath });
    const set = renderKustomize(kz(), h.io);
    expect(set.objects[0]?.body.data).toMatchObject({ git: "not found", path: h.work.homes.empty });
    expect(fs.existsSync(log)).toBe(false);
  });
});

describe("M3, m2: every Helm render is compared with a second one", () => {
  it("is render-failed (not deterministic) when object names differ, whatever the templates say", () => {
    const h = setup(chart({ "c/fake.json": '{"mode":"random"}' }));
    const set = renderHelm(helm(), h.io);
    expect(set).toMatchObject({ objects: [], opaque: { reason: "render-failed" } });
    expect(set.opaque?.detail).toBe("its output is not deterministic: object names differ between two renders");
    expect(h.commands.filter((c) => c.subcommand[0] === "template")).toHaveLength(2);
  });
  it("keeps the first render and flags it when names agree and content differs", () => {
    const h = setup(chart({ "c/fake.json": '{"mode":"random-content"}' }));
    const set = renderHelm(helm(), h.io);
    expect(set.outcome).toBe("ok");
    expect(set.objects.map((o) => o.id)).toEqual(["ConfigMap/a/stable-name"]);
    expect(set.notes).toEqual([{ field: "helm template", value: "content differs between two renders" }]);
  });
  it("adds nothing when both renders agree", () => {
    const h = setup(chart());
    const set = renderHelm(helm(), h.io);
    expect(set).toMatchObject({ outcome: "ok", notes: [] });
    expect(h.commands.filter((c) => c.subcommand[0] === "template")).toHaveLength(2);
  });
  it("reports a failed or timed-out second render as what it is, never as not deterministic", () => {
    // since pass 3 (m4) the first render is kept and the note names the second render's outcome
    const failed = setup(chart({ "c/fake.json": '{"mode":"second-fails"}' }));
    expect(renderHelm(helm(), failed.io).notes).toEqual([
      { field: "helm template", value: "determinism not checked: second render exited with an error" },
    ]);
    const timed = setup(chart({ "c/fake.json": '{"mode":"second-sleeps","ms":20000}' }), {
      limits: { ...RUNNER_LIMITS, wallClock: withValue(LIMITS.renderWallClock, 1500, "test") },
    });
    expect(renderHelm(helm(), timed.io)).toMatchObject({
      timedOut: false,
      opaque: null,
      notes: [{ field: "helm template", value: "determinism not checked: second render timed out" }],
    });
  });
  it("asks the run's budget for the second parse's transient only, and holds the output once", () => {
    const h = setup(chart());
    const admitted: number[] = [];
    const held: number[] = [];
    const io = {
      ...h.io,
      runtime: {
        ...h.io.runtime,
        admitOutput: (l: number) => {
          admitted.push(l);
          return true;
        },
        holdOutput: (b: number) => {
          held.push(b);
          return true;
        },
      },
    };
    expect(renderHelm(helm(), io).outcome).toBe("ok");
    expect(admitted).toHaveLength(2);
    expect(held).toHaveLength(1);
    // a refused second parse keeps the first render since pass 3 (m4): review-b2-pass3.test.ts
  });
});

describe("m1: hosts are normalised before the URL guard", () => {
  it.each([
    ["https://localhost./charts", "loopback"],
    ["oci://localhost./charts", "loopback"],
    ["https://foo.localhost./x", "loopback"],
    ["https://LOCALHOST/x", "loopback"],
    ["oci://LOCALHOST./charts", "loopback"],
    ["https://ip6-localhost/x", "loopback"],
    ["https://127.0.0.1./x", "ip-literal"],
    ["https://localhost../x", "loopback"],
  ])("refuses %s", (raw, problem) => {
    expect(guardChartUrl(raw)).toEqual({ ok: false, problem });
  });
  it("gives helm a punycode host and no trailing dot", () => {
    expect(guardChartUrl("https://bücher.example.org./charts")).toMatchObject({
      ok: true,
      url: "https://xn--bcher-kva.example.org/charts",
    });
  });
});

describe("m3: the cache's .gitignore is written only into a directory crankpath creates", () => {
  it("leaves an existing directory untouched and ignores a new one", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-cacheparent-"));
    roots.push(parent);
    const existing = path.join(parent, "project");
    fs.mkdirSync(existing);
    const w1 = createWorkDir(existing, true);
    expect(w1.ensureRun()).toBe(true);
    w1.cleanup();
    expect(fs.existsSync(path.join(existing, ".gitignore"))).toBe(false);
    const fresh = path.join(parent, "fresh");
    const w2 = createWorkDir(fresh, true);
    expect(w2.ensureRun()).toBe(true);
    w2.cleanup();
    expect(fs.readFileSync(path.join(fresh, ".gitignore"), "utf8")).toBe("*\n");
  });
  it("keeps a run directory whose process it may not signal (EPERM: alive) (m3b)", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-eperm-"));
    roots.push(cache);
    const kept = path.join(cache, "tmp", "run-1-0123456789ab");
    fs.mkdirSync(kept, { recursive: true });
    const w = createWorkDir(cache, true);
    w.ensureRun();
    w.cleanup();
    expect(fs.existsSync(kept)).toBe(true);
  });
});

describe("m3b: branches the second review found unpinned", () => {
  it("refuses a dependency repository that is not a string, and a file:// dependency that is a symlink", () => {
    const h = setup(
      chart({
        "c/Chart.yaml":
          "apiVersion: v2\nname: c\nversion: 0.1.0\ndependencies:\n  - {name: s, version: 0.1.0, repository: 7}\n",
      }),
    );
    expect(renderHelm(helm(), h.io).opaque).toMatchObject({
      reason: "unsupported-field",
      detail: "a repository that is not a string",
    });
    const l = setup({
      ...chart({
        "c/Chart.yaml":
          "apiVersion: v2\nname: c\nversion: 0.1.0\ndependencies:\n  - {name: s, version: 0.1.0, repository: 'file://../linked'}\n",
      }),
      "real/Chart.yaml": "apiVersion: v2\nname: s\nversion: 0.1.0\n",
    });
    fs.symlinkSync(path.join(l.root, "real"), path.join(l.root, "linked"));
    expect(renderHelm(helm(), l.io).opaque).toMatchObject({
      reason: "unreadable-file",
      detail: "a file:// dependency is a symlink, never followed",
    });
  });
  it("counts a refused render transient and a refused render hold as refused jobs", () => {
    const b = new RunBudget({ ...DEFAULT_BUDGET, bytes: 1000 });
    expect(b.fitsRenderTransient(999)).toBe(true);
    expect(b.fitsRenderTransient(1001)).toBe(false);
    expect(b.render(1)).toBe(true);
    expect(b.render(1000)).toBe(false);
    expect(b.use()).toEqual({ refusedFiles: 0, refusedJobs: 2, droppedEdges: 0 });
  });
  it("counts a refused hold of rendered objects as a refused job", () => {
    const b = new RunBudget({ ...DEFAULT_BUDGET, bytes: 1000 });
    expect(b.objects(1_000_000, 0)).toBe(false);
    expect(b.use()).toEqual({ refusedFiles: 0, refusedJobs: 1, droppedEdges: 0 });
  });
});
