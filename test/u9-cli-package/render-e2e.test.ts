// The render engine end to end through the command line (B2's expected demo): an in-repo chart, a
// Kustomize overlay and Flux objects render with the fake helm and kustomize (real processes,
// recorded output), their objects appear in the graph, a hostile or failing job is opaque with a
// named reason and never changes another job's result, writes stay inside `.crankpath`, and the
// toolchain, a missing tool and a timeout are reported as the design says.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { claimWordsInOwnVoice } from "../../src/u1-graph-model/status-model.js";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { withValue } from "../support/limits.js";
import { RUNNER_LIMITS } from "../../src/u4-render-engine/command-runner.js";
import { renderJson } from "../../src/u8-output/json-renderer.js";
import { HELM_NOT_MODELLED } from "../../src/u8-output/report-assembler.js";
import { renderText } from "../../src/u8-output/text-renderer.js";
import { runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { fakePath, listTree, snapshot } from "../helpers/render.js";
import { run, tempDir } from "../helpers/scan.js";
import { flat, unwrapText } from "../helpers/text.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/render/repo/", import.meta.url));
const URL_ = "https://example.org/ops/render-demo";
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

function copy(): string {
  const dir = tempDir("render");
  cleanup.push(dir);
  fs.cpSync(FIXTURE, path.join(dir, "repo"), { recursive: true });
  return path.join(dir, "repo");
}

interface Json {
  nodes: { id: string; opaque: { reason: string } | null }[];
  edges: { from: string; to: string; kind: string }[];
  opaque: { node: string | null; kustomizeRoot: string | null; reason: string; detail: string | null }[];
  runStatus: { state: string; counts: Record<string, number>; reasons: string[] };
  toolchain: Record<string, unknown>;
  floating: { node: string; field: string; value: string }[];
  undeployedKustomizeRoots: string[];
}

function scan(
  repo: string,
  extra: string[] = [],
  toolPath = fakePath(),
): { code: number; json: Json; text: string; stderr: string } {
  const j = run([repo, "--repo-url", URL_, "--format", "json", ...extra], path.dirname(repo), toolPath);
  const t = run([repo, "--repo-url", URL_, ...extra], path.dirname(repo), toolPath);
  // the text with each wrapped statement on one line again (B6's 80-column layout, merged into B2)
  return { code: j.code, json: JSON.parse(j.stdout) as Json, text: unwrapText(t.stdout), stderr: j.stderr + t.stderr };
}

const edge = (e: { from: string; kind: string; to: string }) => `${e.from} ${e.kind} ${e.to}`;

describe("an in-repo chart, a Kustomize overlay and Flux objects render into the graph", () => {
  const repo = copy();
  const r = scan(repo, ["--cache-dir", path.join(path.dirname(repo), "cache")]);
  it("exits 0 with the rendered objects as nodes, test hooks dropped", () => {
    expect(r.code).toBe(0);
    const ids = r.json.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "Deployment/web/web",
        "Service/web/web",
        "ConfigMap/web/web-config",
        "Secret/web/web-credentials",
        "ConfigMap/platform/platform-settings",
        "Deployment/platform/platform-agent",
        "Deployment/edge/edge-web",
        "Service/edge/edge-web",
      ]),
    );
    expect(ids.some((id) => id.endsWith("-test"))).toBe(false);
  });
  it("extracts edges over the rendered objects, with deployed-by to each owner", () => {
    const keys = r.json.edges.map(edge);
    expect(keys).toEqual(
      expect.arrayContaining([
        "Deployment/web/web deployed-by Application/argocd/web",
        "Service/web/web selects Deployment/web/web",
        "Deployment/web/web needs-config ConfigMap/web/web-config",
        "Deployment/web/web needs-secret Secret/web/web-credentials",
        "Deployment/platform/platform-agent deployed-by Application/argocd/platform",
        "Deployment/platform/platform-agent needs-config ConfigMap/platform/platform-settings",
        "Deployment/edge/edge-web deployed-by HelmRelease/flux-system/web",
        "HelmRelease/flux-system/web needs-config ConfigMap/flux-system/web-values",
      ]),
    );
  });
  it("makes a HelmRelease whose values Secret is not in the repo opaque, keeping its reference edge (FR4.2)", () => {
    expect(r.json.opaque).toEqual([
      expect.objectContaining({ node: "HelmRelease/flux-system/vaulted", reason: "cluster-created-values" }),
    ]);
    expect(r.json.edges.map(edge)).toContain(
      "HelmRelease/flux-system/vaulted needs-secret Secret/flux-system/vaulted-values",
    );
    // the statement wraps at a double space: compared with whitespace runs as one space
    expect(flat(r.text)).toContain(
      flat('  opaque 1 of 1  node: HelmRelease "flux-system/vaulted"  reason: cluster-created-values'),
    );
  });
  it("counts the two Kustomize roots once each, read by the overlay's render (not opaque, not undeployed)", () => {
    expect(r.json.runStatus.counts.sourcesFound).toBe(6);
    // a chart's templates are rendered, never read as manifests (they are not valid YAML)
    expect(r.json.runStatus.counts.unreadableFiles).toBe(0);
    expect(r.json.undeployedKustomizeRoots).toEqual([]);
  });
  it("records the toolchain and flags floating revisions (OD-12, BR4.14)", () => {
    expect(r.json.toolchain).toMatchObject({ helm: "v4.3.2", kustomize: "v5.8.1", tested: true, missing: [] });
    expect(r.text).toContain("toolchain: helm v4.3.2, kustomize v5.8.1\n");
    expect(r.text).not.toContain("note: not the tested pair");
    expect(r.text).toContain(HELM_NOT_MODELLED);
    expect(r.json.floating.map((f) => `${f.node} ${f.value}`)).toEqual([
      "Application/argocd/web main",
      "HelmRelease/flux-system/web main",
    ]);
  });
  it("never prints a Secret value, and uses no claim word in its own voice", () => {
    for (const out of [JSON.stringify(r.json), r.text, r.stderr]) {
      expect(out).not.toContain("fixture-render-secret-not-printed");
    }
    expect(claimWordsInOwnVoice(r.text)).toEqual([]);
  });
});

describe("writes confined to stdout, --out and .crankpath (US9.4, BR9.8)", () => {
  it("leaves the scanned tree unchanged with --cache-dir outside it, and removes its private directory", () => {
    const repo = copy();
    const cache = path.join(path.dirname(repo), "cache");
    const before = snapshot(repo);
    expect(scan(repo, ["--cache-dir", cache]).code).toBe(0);
    expect(snapshot(repo)).toEqual(before);
    expect(listTree(path.join(cache, "tmp"))).toEqual([]);
  });
  it("by default writes only the tree's own .crankpath, and leaves nothing in it after the run", () => {
    const repo = copy();
    const before = snapshot(repo);
    const cwd = repo;
    expect(run([".", "--repo-url", URL_], cwd, fakePath()).code).toBe(0);
    const after = snapshot(repo);
    expect(Object.keys(after).filter((k) => !k.startsWith(".crankpath/"))).toEqual(Object.keys(before));
    // only the .gitignore of * that keeps the cache out of any commit (B2 review m3)
    expect(listTree(path.join(repo, ".crankpath"))).toEqual([".gitignore"]);
    // and a second run does not read its own .crankpath as input
    expect(run([".", "--repo-url", URL_, "--format", "json"], cwd, fakePath()).stdout).toBe(
      run([".", "--repo-url", URL_, "--format", "json"], cwd, fakePath()).stdout,
    );
  });
  it("refuses a cache directory inside the scanned tree other than its .crankpath, and a symlinked one", () => {
    const repo = copy();
    const r = run([repo, "--cache-dir", path.join(repo, "charts", "cache")], path.dirname(repo), fakePath());
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^error: the cache directory ".*" is inside the scanned tree/);
    fs.symlinkSync(path.dirname(repo), path.join(repo, ".crankpath"));
    const linked = run([repo, "--cache-dir", path.join(repo, ".crankpath")], path.dirname(repo), fakePath());
    expect(linked.code).toBe(1);
    expect(linked.stderr).toContain("is not a directory (a symlink is never followed)");
  });
});

describe("tools, failures and limits", () => {
  it("names a missing tool and makes every source that needs it opaque tool-missing (M5, BR4.15)", () => {
    const repo = copy();
    const r = scan(repo, ["--cache-dir", path.join(path.dirname(repo), "cache")], "");
    expect(r.text).toContain(
      'tool missing: "helm" (not found on PATH)  affected: 2 Helm sources opaque, reason tool-missing\n',
    );
    expect(r.text).toContain(
      'tool missing: "kustomize" (not found on PATH)  affected: 3 Kustomize sources opaque, reason tool-missing\n',
    );
    expect(r.text).toContain("toolchain: helm not found on PATH, kustomize not found on PATH\n");
    expect(r.json.runStatus.state).toBe("ANALYSED WITH GAPS");
  });
  it("prints a note naming the tested pair for another version (BR4.16)", () => {
    const repo = copy();
    const r = scan(repo, ["--cache-dir", path.join(path.dirname(repo), "cache")], fakePath("untested"));
    expect(r.text).toContain(
      "toolchain: helm v4.0.0, kustomize v5.8.1\n  note: not the tested pair (helm v4.3.2, kustomize v5.8.1); rendering may differ\n",
    );
    expect(r.json.toolchain).toMatchObject({ tested: false, helm: "v4.0.0" });
  });
  it("isolates a failing job: it is opaque render-failed and every other result is unchanged (US9.3)", () => {
    const repo = copy();
    const cache = path.join(path.dirname(repo), "cache");
    const base = scan(repo, ["--cache-dir", cache]);
    fs.cpSync(path.join(repo, "charts", "web"), path.join(repo, "charts", "broken"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "charts", "broken", "fake.json"),
      '{"mode":"fail","stderr":"panic: SECRET-STDERR\\n"}',
    );
    fs.writeFileSync(
      path.join(repo, "apps", "broken.yaml"),
      fs
        .readFileSync(path.join(repo, "apps", "web.yaml"), "utf8")
        .replace("name: web\n", "name: broken\n")
        .replace("charts/web", "charts/broken")
        .replace("namespace: web", "namespace: broken"),
    );
    const r = scan(repo, ["--cache-dir", cache]);
    expect(r.json.opaque.find((o) => o.node === "Application/argocd/broken")).toMatchObject({
      reason: "render-failed",
      detail: "helm template exited with an error",
    });
    const without = (j: Json) => j.edges.map(edge).filter((k) => !k.includes("broken"));
    expect(without(r.json)).toEqual(without(base.json));
    expect(r.text + JSON.stringify(r.json)).not.toContain("SECRET-STDERR");
  });
  it("reports a timeout as limit (timeout), counts it, and says the output may differ on a rerun (OD-30, BR9.11)", () => {
    const repo = copy();
    fs.writeFileSync(path.join(repo, "charts", "web", "fake.json"), '{"mode":"sleep","ms":20000}');
    const outcome = runPipeline({
      path: repo,
      cwd: path.dirname(repo),
      repoUrl: URL_,
      toolPath: fakePath(),
      cacheDir: path.join(path.dirname(repo), "cache"),
      // 8 s: the jobs that do not sleep (a fake tool each) must end inside it on a busy host too, and the 20 s sleep must outlast it
      runnerLimits: { ...RUNNER_LIMITS, wallClock: withValue(LIMITS.renderWallClock, 8000, "test") },
    });
    if (outcome.kind !== "report") throw new Error("expected a report");
    const json = JSON.parse(renderJson(outcome.report)) as Json;
    expect(json.runStatus.counts.timeouts).toBe(2);
    expect(json.opaque.find((o) => o.node === "Application/argocd/web")).toMatchObject({
      reason: "limit",
      detail: "timeout",
    });
    expect(unwrapText(renderText(outcome.report))).toMatch(
      /gaps: .*2 jobs stopped by a time limit \(the output may differ on a rerun\)/,
    );
  });
  it("is byte-identical across runs and across cache locations (NFR2)", () => {
    const repo = copy();
    const a = run(
      [repo, "--repo-url", URL_, "--format", "json", "--cache-dir", path.join(path.dirname(repo), "c1")],
      "/",
      fakePath(),
    );
    const b = run(
      [repo, "--repo-url", URL_, "--format", "json", "--cache-dir", path.join(path.dirname(repo), "c2")],
      "/",
      fakePath(),
    );
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout).not.toContain(path.dirname(repo));
  });
  it("--verbose prints fixed words and counts only: no token, no Secret value, no path", () => {
    const repo = copy();
    process.env.CRANKPATH_TOKEN_EXAMPLE_ORG = "planted-token-value";
    try {
      const r = run(
        [repo, "--repo-url", URL_, "--verbose", "--cache-dir", path.join(path.dirname(repo), "c")],
        "/",
        fakePath(),
      );
      expect(r.stderr).toContain("crankpath:   ran helm template: ok: 4\n");
      for (const s of ["planted-token-value", "fixture-render-secret-not-printed", path.dirname(repo)]) {
        expect(r.stderr + r.stdout).not.toContain(s);
      }
    } finally {
      delete process.env.CRANKPATH_TOKEN_EXAMPLE_ORG;
    }
  });
  it("--no-network fetches nothing: a chart from a repository is opaque offline", () => {
    const repo = copy();
    fs.writeFileSync(
      path.join(repo, "apps", "remote.yaml"),
      "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata: {name: remote, namespace: argocd}\nspec:\n  source: {repoURL: 'https://charts.example.org', chart: demo, targetRevision: 2.0.0}\n  destination: {server: 'https://kubernetes.default.svc', namespace: remote}\n",
    );
    const cache = path.join(path.dirname(repo), "cache");
    const offline = run([repo, "--repo-url", URL_, "--no-network", "--verbose", "--cache-dir", cache], "/", fakePath());
    expect(offline.stdout).toContain('node: Application "argocd/remote"  reason: offline');
    expect(offline.stderr).not.toContain("ran helm pull");
    const online = run([repo, "--repo-url", URL_, "--verbose", "--cache-dir", cache], "/", fakePath());
    expect(online.stderr).toContain("ran helm pull: ok: 1");
    const cached = run(
      [repo, "--repo-url", URL_, "--no-network", "--format", "json", "--cache-dir", cache],
      "/",
      fakePath(),
    );
    expect((JSON.parse(cached.stdout) as Json).nodes.map((n) => n.id)).toContain("ConfigMap/remote/remote-demo");
  });
});

describe("hostile charts and kustomizations fail closed with a named reason (B2 demo, B2 review M1 to M3, m2, m6)", () => {
  const HOSTILE = fileURLToPath(new URL("../fixtures/render/hostile/", import.meta.url));
  /** The reason each hostile Application gets with the fake tools (`none`: rendered). */
  const EXPECTED: Record<string, string> = {
    "outside-dep": "unsupported-field",
    "url-resource": "remote-base",
    escape: "render-failed",
    linked: "unreadable-file",
    bomb: "limit",
    lookup: "none",
    "case-repo": "unsupported-field",
    "req-http": "unsupported-field",
    "req-lock": "unsupported-field",
    "schema-ref": "none",
    random: "render-failed",
    // getHostByName is a stated limit now (helm may resolve it even under --no-network)
    "lookup-host": "none",
    "anchor-chart": "unsupported-field",
    "case-resources": "unsupported-field",
    "upper-resources": "unsupported-field",
    "unknown-key": "unsupported-field",
    "ssh-resources": "unsupported-field",
    "exec-generator": "none",
    "helmcharts-case": "unsupported-field",
    // its anchor's own key is not a kustomize field: refused before the merge key matters
    "anchor-kz": "unsupported-field",
    // a block-scalar generator entry (B2 review pass 2, M1)
    "block-generator": "unsupported-field",
    // configuration files naming a URL (B2 review pass 3, M1)
    "plugin-transformer": "unsupported-field",
    "plugin-generator": "unsupported-field",
    // a `!!binary` tag on a path, a configuration file's path and a key (B2 review pass 4, M1)
    "tag-binary-patch": "unsupported-field",
    "tag-binary-config": "unsupported-field",
    "tag-key": "unsupported-field",
  };
  it("makes each hostile source opaque, runs nothing for the refused ones, and finishes the run", () => {
    const dir = tempDir("hostile");
    cleanup.push(dir);
    const repo = path.join(dir, "repo");
    fs.cpSync(HOSTILE, repo, { recursive: true });
    fs.symlinkSync("/etc/hosts", path.join(repo, "charts", "linked", "templates", "hosts.yaml"));
    const args = [
      repo,
      "--repo-url",
      "https://example.org/ops/hostile",
      "--no-network",
      "--cache-dir",
      path.join(dir, "cache"),
    ];
    const j = run([...args, "--format", "json", "--verbose"], dir, fakePath());
    expect(j.code).toBe(0);
    const json = JSON.parse(j.stdout) as Json;
    const got = Object.fromEntries(
      Object.keys(EXPECTED).map((n) => [
        n,
        json.opaque.find((o) => o.node === `Application/argocd/${n}`)?.reason ?? "none",
      ]),
    );
    expect(got).toEqual(EXPECTED);
    expect(json.opaque.find((o) => o.node === "Application/argocd/outside-dep")?.detail).toBe(
      "a file:// dependency outside the scanned root is never read",
    );
    expect(json.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining([
        "ConfigMap/lookup/lookup",
        "ConfigMap/bomb/after-bomb",
        "ConfigMap/schema-ref/schema-ref",
      ]),
    );
    // helm ran twice (the comparison render) for bomb, lookup, schema-ref, random and lookup-host only
    expect(j.stderr).toContain("crankpath:   ran helm template: ok: 10\n");
    expect(j.stderr).not.toContain("dependency build");
    expect(j.stderr).not.toContain("helm pull");
    expect(j.stderr).toContain("crankpath:   ran kustomize build: ok: 1\n");
    const text = run(args, dir, fakePath()).stdout;
    expect(text).toContain('value: "file://../../../../outside-the-root"');
    expect(text).toContain('value: "https://example.org/remote/base.yaml"');
    expect(claimWordsInOwnVoice(text)).toEqual([]);
    expect(fs.existsSync(path.join(repo, "kustomize", "exec-generator", "EXEC-FUNCTION-RAN"))).toBe(false);
  });
});
