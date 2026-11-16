// B2 review, third pass: a file kustomize loads as plugin or transformer configuration is read and
// refused when it names a URL or a path that is not plain (M1); `helm template` and `kustomize
// build` run behind a closed proxy (M1, defence in depth); the template scan is back as a flag next
// to the double render (m1); a second render that does not finish keeps the first (m4); the cache
// `.gitignore` goes into an existing `.crankpath` (m3); a tool that cannot run under the empty PATH
// is named (m6); a file outside a kustomization's directory and a symlink are named (m7); and one
// test per list and key the pre-read judges (m5).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import type { HelmJob, KustomizeJob } from "../../src/u3-discovery-expansion/render-job.js";
import {
  ALLOWED_COMMANDS,
  CLOSED_PROXY,
  createCommandRunner,
  RUNNER_LIMITS,
  type SpawnOptions,
} from "../../src/u4-render-engine/command-runner.js";
import { renderHelm } from "../../src/u4-render-engine/helm-renderer.js";
import { preReadKustomization, renderKustomize } from "../../src/u4-render-engine/kustomize-renderer.js";
import { detectToolchain, findTool } from "../../src/u4-render-engine/toolchain.js";
import { createWorkDir } from "../../src/u4-render-engine/work-dir.js";
import { RunBudget } from "../../src/u9-cli-package/run-budget.js";
import { DEFAULT_BUDGET, runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { fakeDir, fakePath, harness, NODE_DIR, type RenderHarness } from "../helpers/render.js";
import { estate, run } from "../helpers/scan.js";
import { unwrapText } from "../helpers/text.js";
import { withValue } from "../support/limits.js";

const RENDER_FIXTURE = fileURLToPath(new URL("../fixtures/render/repo/", import.meta.url));
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
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(d);
  return d;
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
const helm = (dir = "c"): HelmJob => ({
  ...base,
  kind: "helm",
  releaseName: "a",
  chart: { from: "repo", root: ".", dir },
  values: [],
  includeCrds: true,
  skipSchemaValidation: false,
});
const CM = "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: top}\n";
const chart = (extra: Record<string, string> = {}) => ({
  "c/Chart.yaml": "apiVersion: v2\nname: c\nversion: 0.1.0\n",
  "c/templates/cm.yaml": CM,
  "c/fake-render.yaml": CM,
  ...extra,
});
const kustomization = (text: string, extra: Record<string, string> = {}) => ({
  "k/kustomization.yaml": `resources: [cm.yaml]\n${text}`,
  "k/cm.yaml": CM,
  ...extra,
});
// one conservative wording for both since pass 4 (m2)
const URL_DETAIL =
  "a kustomize configuration file names a URL or a non-plain path that kustomize may load; crankpath does not tell a literal from a path here";
const PATH_DETAIL = URL_DETAIL;

describe("M1: a file kustomize loads as configuration never names a URL", () => {
  it.each([
    [
      "transformers",
      "t.yaml",
      "apiVersion: builtin\nkind: PatchTransformer\nmetadata: {name: t}\npath: http://127.0.0.1:1/p3\n",
    ],
    [
      "generators",
      "g.yaml",
      "apiVersion: builtin\nkind: ConfigMapGenerator\nmetadata: {name: g}\nfiles: [http://127.0.0.1:1/p4]\n",
    ],
    [
      "generators",
      "g.yaml",
      "apiVersion: builtin\nkind: ConfigMapGenerator\nmetadata: {name: g}\nenvs: [http://127.0.0.1:1/p7]\n",
    ],
    [
      "generators",
      "g.yaml",
      "apiVersion: builtin\nkind: ConfigMapGenerator\nmetadata: {name: g}\nfiles: [k=https://127.0.0.1:1/x]\n",
    ],
    [
      "validators",
      "v.yaml",
      "apiVersion: builtin\nkind: X\nmetadata: {name: v}\nspec:\n  deep: [{x: '//127.0.0.1/p'}]\n",
    ],
    [
      "transformers",
      "t.yaml",
      "apiVersion: builtin\nkind: PatchTransformer\nmetadata: {name: t}\npatch: |\n  metadata: {annotations: {a: 'https://example.org'}}\n",
    ],
    ["configurations", "c.yaml", "nameReference:\n  - kind: X\n    fieldSpecs: [{path: 'https://example.org/x'}]\n"],
  ])("refuses a %s file naming a URL before kustomize runs (%#)", (field, file, text) => {
    const h = setup(kustomization(`${field}: [${file}]\n`, { [`k/${file}`]: text }));
    const set = renderKustomize(kz(), h.io);
    expect(set.opaque).toMatchObject({ reason: "unsupported-field", detail: URL_DETAIL });
    expect(set.opaque?.field).toMatch(new RegExp(`^${field}\\[0\\]`));
    expect(h.commands).toEqual([]);
  });
  it("refuses a replacements file naming a URL", () => {
    const h = setup(
      kustomization("replacements:\n  - path: r.yaml\n", {
        "k/r.yaml": "- source: {kind: X, name: y}\n  targets: [{select: {kind: 'https://example.org'}}]\n",
      }),
    );
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({ reason: "unsupported-field", detail: URL_DETAIL });
  });
  it.each([
    ["path: /etc/hosts\n"],
    ["path: ../../outside.yaml\n"],
    ["path: [a.yaml]\n"],
    ["path: a\tb\n"],
    ["path: ''\n"],
    ["PATH: /etc/hosts\n"],
    ["files: [k=/etc/hosts]\n"],
    ["envs: [git@example.org:org/repo]\n"],
    ["env: /etc/hosts\n"],
    ["paths: [/etc]\n"],
    ["path: ../shared/p.yaml\n"],
  ])("refuses a configuration path key that is not a plain relative path: %s", (line) => {
    const h = setup(
      kustomization("transformers: [t.yaml]\n", {
        "k/t.yaml": `apiVersion: builtin\nkind: PatchTransformer\nmetadata: {name: t}\n${line}`,
        "shared/p.yaml": CM,
      }),
    );
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({ reason: "unsupported-field", detail: PATH_DETAIL });
    expect(h.commands).toEqual([]);
  });
  it("keeps a configuration file with plain in-directory paths and no URL", () => {
    const h = setup(
      kustomization("transformers: [t.yaml]\ngenerators: [g.yaml]\n", {
        "k/t.yaml": "apiVersion: builtin\nkind: PatchTransformer\nmetadata: {name: t}\npath: p.yaml\n",
        "k/p.yaml": CM,
        "k/g.yaml": "apiVersion: builtin\nkind: ConfigMapGenerator\nmetadata: {name: g}\nfiles: [k=d.txt, d.txt]\n",
        "k/d.txt": "x\n",
      }),
    );
    expect(renderKustomize(kz(), h.io).outcome).toBe("ok");
  });
  it("leaves data files alone: a URL in a resource or a patch is the object's content", () => {
    const h = setup(
      kustomization("patches:\n  - path: p.yaml\n", {
        "k/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: top}\ndata: {u: 'https://example.org'}\n",
        "k/p.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: top, annotations: {a: 'https://example.org'}}\n",
      }),
    );
    expect(renderKustomize(kz(), h.io).outcome).toBe("ok");
  });
});

describe("M1, defence in depth: helm template and kustomize build run behind a closed proxy", () => {
  function envOf(tool: "helm" | "kustomize", subcommand: string[], args: string[]): Readonly<Record<string, string>> {
    let seen: Readonly<Record<string, string>> = {};
    const runner = createCommandRunner({
      binaries: { helm: "/x/helm", kustomize: "/x/kustomize" },
      env: { PATH: "/empty" },
      spawn: (_f: string, _a: readonly string[], o: SpawnOptions) => {
        seen = o.env;
        return { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
    });
    runner.run({ tool, subcommand, args, cwd: "/" });
    return seen;
  }
  const PROXY = { HTTP_PROXY: CLOSED_PROXY, HTTPS_PROXY: CLOSED_PROXY, ALL_PROXY: CLOSED_PROXY, NO_PROXY: "" };
  it("is a loopback port nothing listens on", () => {
    expect(CLOSED_PROXY).toBe("http://127.0.0.1:1");
  });
  it("sets the proxy for the two render commands", () => {
    expect(envOf("helm", ["template"], ["--", "a", "/c"])).toEqual({ PATH: "/empty", ...PROXY });
    expect(envOf("kustomize", ["build"], ["--", "/k"])).toEqual({ PATH: "/empty", ...PROXY });
  });
  it("sets none for the commands that fetch or only print a version", () => {
    expect(envOf("helm", ["pull"], ["--repo", "https://example.org/charts", "--", "c"])).toEqual({ PATH: "/empty" });
    expect(envOf("helm", ["dependency", "build"], ["--", "/c"])).toEqual({ PATH: "/empty" });
    expect(envOf("helm", ["version"], ["--template", "{{.Version}}"])).toEqual({ PATH: "/empty" });
    expect(envOf("kustomize", ["version"], [])).toEqual({ PATH: "/empty" });
  });
  it("marks exactly the two render commands in the allowlist", () => {
    expect(
      ALLOWED_COMMANDS.filter((c) => c.closedProxy === true).map((c) => `${c.tool} ${c.subcommand.join(" ")}`),
    ).toEqual(["helm template", "kustomize build"]);
  });
  it("reaches a real child", () => {
    const h = setup({ "k/kustomization.yaml": "resources: []\n", "k/fake.json": '{"mode":"proxy-env"}' });
    expect(renderKustomize(kz(), h.io).objects[0]?.body.data).toEqual({ ...PROXY, NO_PROXY: "(empty)" });
  });
});

describe("m1: the template scan is a flag beside the double render, never the guard", () => {
  it("names random and time functions as a floating entry, the render kept", () => {
    const h = setup(chart({ "c/templates/cm.yaml": "{{ randAlphaNum 5 }} {{ now }}\n" }));
    const set = renderHelm(helm(), h.io);
    expect(set.outcome).toBe("ok");
    expect(set.notes).toEqual([
      { field: "chart templates", value: "now, randAlphaNum (a value that changes between renders)" },
    ]);
  });
  it("names a host lookup as a floating entry and still renders under --no-network", () => {
    const h = setup(chart({ "c/templates/cm.yaml": '{{ getHostByName "example.org" }}\n' }), { network: false });
    const set = renderHelm(helm(), h.io);
    expect(set.outcome).toBe("ok");
    expect(set.notes).toEqual([{ field: "chart templates", value: "getHostByName (a lookup made at render time)" }]);
  });
  it("still finds non-determinism the scan cannot see", () => {
    const h = setup(chart({ "c/fake.json": '{"mode":"random"}' }));
    expect(renderHelm(helm(), h.io).opaque?.detail).toBe(
      "its output is not deterministic: object names differ between two renders",
    );
  });
});

describe("m4: a second render that does not finish keeps the first", () => {
  it("keeps the first render when the second fails", () => {
    const h = setup(chart({ "c/fake.json": '{"mode":"second-fails"}' }));
    const set = renderHelm(helm(), h.io);
    expect(set).toMatchObject({ outcome: "ok", opaque: null, timedOut: false });
    expect(set.objects.map((o) => o.id)).toEqual(["ConfigMap/a/top"]);
    expect(set.notes).toEqual([
      { field: "helm template", value: "determinism not checked: second render exited with an error" },
    ]);
  });
  it("keeps the first render when the second times out", () => {
    const h = setup(chart({ "c/fake.json": '{"mode":"second-sleeps","ms":20000}' }), {
      limits: { ...RUNNER_LIMITS, wallClock: withValue(LIMITS.renderWallClock, 1500, "test") },
    });
    const set = renderHelm(helm(), h.io);
    expect(set).toMatchObject({ outcome: "ok", opaque: null });
    expect(set.notes).toEqual([{ field: "helm template", value: "determinism not checked: second render timed out" }]);
  });
  it("asks for the second parse as a comparison (its refusal is not a refused job)", () => {
    const h = setup(chart());
    const asked: (boolean | undefined)[] = [];
    const io = {
      ...h.io,
      runtime: {
        ...h.io.runtime,
        admitOutput: (_l: number, _b: number, comparison?: boolean) => {
          asked.push(comparison);
          return true;
        },
      },
    };
    expect(renderHelm(helm(), io).outcome).toBe("ok");
    expect(asked).toEqual([false, true]);
  });
  it("keeps a Helm source whose second parse the run's budget cannot take, counting no refused job (pipeline)", () => {
    // 1,100,000 bytes: the budget that holds the render fixture's first renders but not the last
    // comparison parse (found by trying budgets in steps of 100,000; asserted below, not assumed)
    const dir = tmp("crankpath-m4-");
    const r = runPipeline({
      path: RENDER_FIXTURE,
      cwd: "/",
      repoUrl: "https://example.org/ops/render-demo",
      toolPath: fakePath(),
      cacheDir: path.join(dir, "cache"),
      budget: { ...DEFAULT_BUDGET, bytes: 1_100_000 },
    });
    if (r.kind !== "report") throw new Error("expected a report");
    expect(r.report.floating.filter((f) => f.value.startsWith("determinism not checked")).map((f) => f.node)).toEqual([
      "HelmRelease/flux-system/web",
    ]);
    expect(r.report.opaque.map((o) => o.node)).not.toContain("HelmRelease/flux-system/web");
    expect((r.report.runStatus.counts as unknown as Record<string, number>).runLimitJobs).toBe(0);
  });
  it("keeps the first render when the run's budget cannot take the second parse, without counting a refused job", () => {
    const h = setup(chart());
    let n = 0;
    const io = { ...h.io, runtime: { ...h.io.runtime, admitOutput: () => n++ === 0 } };
    const set = renderHelm(helm(), io);
    expect(set).toMatchObject({ outcome: "ok", opaque: null });
    expect(set.notes).toEqual([
      {
        field: "helm template",
        value: "determinism not checked: second render not read (the run's memory budget was reached)",
      },
    ]);
    const b = new RunBudget({ ...DEFAULT_BUDGET, bytes: 1000 });
    expect(b.fitsRenderTransient(1001, false)).toBe(false);
    expect(b.use().refusedJobs).toBe(0);
  });
  it("returns the first render's objects when content differs (m5)", () => {
    const h = setup(chart({ "c/fake.json": '{"mode":"count-content"}' }));
    const set = renderHelm(helm(), h.io);
    expect(set.objects[0]?.body.data).toEqual({ render: "0" });
    expect(set.notes).toEqual([{ field: "helm template", value: "content differs between two renders" }]);
  });
});

describe("m3: an existing .crankpath without a .gitignore gets one", () => {
  it("writes it into a directory named .crankpath, keeps one already there, and leaves another name alone", () => {
    const parent = tmp("crankpath-m3-");
    const own = path.join(parent, ".crankpath");
    fs.mkdirSync(own);
    fs.writeFileSync(path.join(own, "keep"), "");
    const w1 = createWorkDir(own, false);
    expect(w1.ensureRun()).toBe(true);
    w1.cleanup();
    expect(fs.readFileSync(path.join(own, ".gitignore"), "utf8")).toBe("*\n");
    const theirs = path.join(parent, "b", ".crankpath");
    fs.mkdirSync(theirs, { recursive: true });
    fs.writeFileSync(path.join(theirs, ".gitignore"), "mine\n");
    const w2 = createWorkDir(theirs, true);
    expect(w2.ensureRun()).toBe(true);
    w2.cleanup();
    expect(fs.readFileSync(path.join(theirs, ".gitignore"), "utf8")).toBe("mine\n");
    const other = path.join(parent, "cache");
    fs.mkdirSync(other);
    const w3 = createWorkDir(other, true);
    expect(w3.ensureRun()).toBe(true);
    w3.cleanup();
    expect(fs.existsSync(path.join(other, ".gitignore"))).toBe(false);
  });
});

describe("m6: a tool that cannot run under the empty PATH is named", () => {
  function tools(helmFile: (dir: string) => void): string {
    const dir = tmp("crankpath-shim-");
    helmFile(dir);
    return [dir, fakeDir("tested"), NODE_DIR].join(path.delimiter);
  }
  const shim = (dir: string) =>
    fs.writeFileSync(path.join(dir, "helm"), '#!/usr/bin/env bash\nexec helm "$@"\n', { mode: 0o755 });
  const failing = (dir: string) => fs.copyFileSync("/usr/bin/false", path.join(dir, "helm"));
  it("says a script did not run, and a binary's version command failed", () => {
    const work = createWorkDir(tmp("crankpath-m6-"), true);
    expect(work.ensureRun()).toBe(true);
    try {
      for (const [make, problem] of [
        [shim, "script"],
        [failing, "failed"],
      ] as const) {
        const toolPath = tools(make);
        const runner = createCommandRunner({
          binaries: { helm: findTool("helm", toolPath) },
          env: { PATH: work.homes.empty },
        });
        expect(detectToolchain(runner, work.runDir).helm).toMatchObject({ present: true, version: null, problem });
      }
    } finally {
      work.cleanup();
    }
  });
  it("prints the cause in --version and in the report's toolchain line", () => {
    const toolPath = tools(shim);
    const v = run(["--version"], process.cwd(), toolPath).stdout;
    expect(v).toContain(
      "helm: version not recognised (a script that did not run: tools run with an empty PATH, so a wrapper that looks a program up on PATH fails; give crankpath the real binary)\n",
    );
    const repo = estate({
      "apps/a.yaml":
        "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata: {name: a, namespace: argocd}\nspec:\n  source: {repoURL: https://example.org/ops/x, path: m, targetRevision: 0123456789abcdef0123456789abcdef01234567}\n  destination: {server: https://kubernetes.default.svc, namespace: a}\n",
      "m/cm.yaml": CM,
    });
    roots.push(repo);
    const t0 = run(
      [repo, "--repo-url", "https://example.org/ops/x", "--cache-dir", path.join(tmp("crankpath-m6c-"), "c")],
      path.dirname(repo),
      toolPath,
    ).stdout;
    const t = unwrapText(t0);
    expect(t).toContain(
      "toolchain: helm (version not recognised: a script that did not run: tools run with an empty PATH, so a wrapper that looks a program up on PATH fails; give crankpath the real binary), kustomize v5.8.1",
    );
    const f = run(["--version"], process.cwd(), tools(failing)).stdout;
    expect(f).toContain("helm: version not recognised (its version command failed; tools run with an empty PATH)\n");
  });
  it("says nothing more for a tool that ran and printed something else", () => {
    expect(run(["--version"], process.cwd(), [fakeDir("garbled"), NODE_DIR].join(path.delimiter)).stdout).toContain(
      "helm: version not recognised\n",
    );
  });
});

describe("m7: the cause of a kustomization kustomize could not build is named", () => {
  it.each([
    ["resources: [cm.yaml, ../shared/extra.yaml]\n", "resources[1]"],
    ["resources: [cm.yaml]\npatches:\n  - path: ../shared/patch.yaml\n", "patches[0].path"],
    [
      "resources: [cm.yaml]\nconfigMapGenerator:\n  - name: x\n    files: [k=../shared/extra.yaml]\n",
      "configMapGenerator[0].files[0]",
    ],
  ])("refuses a file outside the kustomization's directory before kustomize runs: %s", (text, field) => {
    const h = setup({
      "k/kustomization.yaml": text,
      "k/cm.yaml": CM,
      "shared/extra.yaml": CM,
      "shared/patch.yaml": CM,
    });
    const set = renderKustomize(kz(), h.io);
    expect(set.opaque).toMatchObject({
      reason: "render-failed",
      detail: "an entry names a file outside its kustomization's directory (kustomize loads files only in or below it)",
      field,
    });
    expect(h.commands).toEqual([]);
  });
  it("keeps a base directory outside (a kustomization of its own)", () => {
    const h = setup({
      "k/kustomization.yaml": "resources: [../shared]\n",
      "shared/kustomization.yaml": "resources: [cm.yaml]\n",
      "shared/cm.yaml": CM,
    });
    expect(renderKustomize(kz(), h.io).outcome).toBe("ok");
  });
  it("names a symlink in a copied directory", () => {
    const h = setup({ "kustomization.yaml": "resources: [cm.yaml]\n", "cm.yaml": CM, "other/real.yaml": CM });
    fs.symlinkSync(path.join(h.root, "other", "real.yaml"), path.join(h.root, "other", "link.yaml"));
    expect(renderKustomize(kz(""), h.io).opaque).toMatchObject({
      reason: "render-failed",
      detail: "a symlink in its directory is never followed (the directory is copied whole), so kustomize was not run",
      value: "other/link.yaml",
    });
  });
});

describe("m5: every list and key the pre-read judges", () => {
  const remote = "http://127.0.0.1:1/x";
  it.each([
    ["replacements[0].path", `replacements:\n  - path: ${remote}\n`],
    ["openapi.path", `openapi:\n  path: ${remote}\n`],
    ["patchesJson6902[0].path", `patchesJson6902:\n  - target: {kind: X, name: y}\n    path: ${remote}\n`],
    ["patches[0].path", `patches:\n  - path: ${remote}\n`],
    ["secretGenerator[0].files[0]", `secretGenerator:\n  - name: s\n    files: [${remote}]\n`],
    ["configMapGenerator[0].files[0]", `configMapGenerator:\n  - name: s\n    files: [${remote}]\n`],
    ["configMapGenerator[0].envs[0]", `configMapGenerator:\n  - name: s\n    envs: [${remote}]\n`],
    ["configMapGenerator[0].env", `configMapGenerator:\n  - name: s\n    env: ${remote}\n`],
  ])("refuses a URL in %s", (field, text) => {
    const h = setup(kustomization(text));
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({ reason: "remote-base", field });
  });
  it("refuses a case-variant key under openapi", () => {
    const h = setup(kustomization(`openapi:\n  PATH: ${remote}\n`));
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({ reason: "unsupported-field", field: "openapi.PATH" });
  });
  it("judges the path after the key in a key=path entry", () => {
    const h = setup({
      "a/kustomization.yaml": "configMapGenerator:\n  - name: s\n    files: [k=../b/d.txt]\n",
      "b/d.txt": "x\n",
    });
    expect(renderKustomize(kz("a"), h.io).opaque).toMatchObject({
      reason: "render-failed",
      field: "configMapGenerator[0].files[0]",
    });
  });
  it("lets a missing patch or strategic-merge file reach kustomize (only a missing base is remote)", () => {
    const h = setup(kustomization("patches:\n  - path: none.yaml\npatchesStrategicMerge: [gone.yaml]\n"));
    expect(preReadKustomization(h.io, ".", "k").ok).toBe(true);
  });
  it("never queues a strategic-merge patch directory as a base", () => {
    const h = setup(kustomization("patchesStrategicMerge: [p]\n", { "k/p/x.yaml": CM }));
    const pre = preReadKustomization(h.io, ".", "k");
    expect(pre).toMatchObject({ ok: true, dirs: ["k"] });
  });
  it("refuses an empty entry", () => {
    const h = setup({ "k/kustomization.yaml": 'resources: [""]\n' });
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({
      reason: "unsupported-field",
      detail: "an entry that is not a plain relative path",
    });
  });
});
