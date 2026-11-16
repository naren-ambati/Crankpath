import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { withValue } from "../support/limits.js";
import type { HelmJob, HelmValues } from "../../src/u3-discovery-expansion/render-job.js";
import { repoKey } from "../../src/u4-render-engine/chart-cache.js";
import { RUNNER_LIMITS } from "../../src/u4-render-engine/command-runner.js";
import { OUTPUT_LIMITS } from "../../src/u4-render-engine/rendered-output.js";
import { renderHelm } from "../../src/u4-render-engine/helm-renderer.js";
import { harness, listTree, type RenderHarness, snapshot } from "../helpers/render.js";
import { estate } from "../helpers/scan.js";

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

function job(chart: HelmJob["chart"], values: HelmValues[] = [], extra: Partial<HelmJob> = {}): HelmJob {
  return {
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
    chart,
    values,
    includeCrds: true,
    skipSchemaValidation: false,
    ...extra,
  };
}

const RENDER = [
  "---",
  "# Source: web/templates/cm.yaml",
  "apiVersion: v1",
  "kind: ConfigMap",
  "metadata:",
  "  name: RELEASE-config",
  "---",
  "# Source: web/templates/secret.yaml",
  "apiVersion: v1",
  "kind: Secret",
  "metadata:",
  "  name: RELEASE-secret",
  "stringData:",
  "  password: RENDERED-SECRET-VALUE",
  "---",
  "# Source: web/templates/tests/t.yaml",
  "apiVersion: v1",
  "kind: Pod",
  "metadata:",
  "  name: RELEASE-test",
  "  annotations:",
  '    "helm.sh/hook": test',
  "---",
  "apiVersion: batch/v1",
  "kind: Job",
  "metadata:",
  "  name: RELEASE-migrate",
  "  annotations:",
  '    "helm.sh/hook": pre-install,post-upgrade',
  "",
].join("\n");

const CHART = {
  "charts/web/Chart.yaml": "apiVersion: v2\nname: web\nversion: 0.1.0\n",
  "charts/web/values.yaml": "image: nginx\n",
  "charts/web/templates/cm.yaml": "{{ .Values.image }}\n",
  "charts/web/fake-render.yaml": RENDER,
};
const repoChart = { from: "repo", root: ".", dir: "charts/web" } as const;

describe("helm template of a chart in the repo (BR4.1, BR4.6, BR4.7)", () => {
  it("renders the private copy; test hooks dropped and counted, other hooks kept; Secret values discarded", () => {
    const h = setup(CHART);
    const before = snapshot(h.root);
    const set = renderHelm(job(repoChart), h.io);
    expect(set.outcome).toBe("ok");
    expect(set.objects.map((o) => o.id)).toEqual([
      "ConfigMap/web/web-config",
      "Secret/web/web-secret",
      "Job/web/web-migrate",
    ]);
    expect(set.droppedHooks).toBe(1);
    expect(JSON.stringify(set)).not.toContain("RENDERED-SECRET-VALUE");
    expect(set.objects[0]?.renderedPath).toBe("render:Application/argocd/web#0#1");
    expect(snapshot(h.root)).toEqual(before);
    expect(h.commands.map((c) => `${c.subcommand.join(" ")} ${c.outcome}`)).toEqual(["template ok", "template ok"]);
  });
  it("gives helm a fixed argv: namespace, include-crds, values in order, then release and chart; values 0600, private, removed", () => {
    const h = setup({
      ...CHART,
      "charts/web/fake.json": '{"mode":"echo"}',
      "values/a.yaml": "a: 1\n",
      "values/b.yaml": "b: 2\n",
    });
    const values: HelmValues[] = [
      { kind: "file", root: ".", path: "values/a.yaml", field: "f0", optional: false },
      { kind: "file", root: ".", path: "values/missing.yaml", field: "f1", optional: true },
      { kind: "file", root: ".", path: "values/b.yaml", field: "f2", optional: false },
      { kind: "inline", text: "c: 3\n", field: "v" },
      { kind: "object", value: { d: { e: 4 } }, field: "vo" },
    ];
    const set = renderHelm(job(repoChart, values, { skipSchemaValidation: true }), h.io);
    const echo = set.objects[0]?.body.data as Record<string, string>;
    expect(echo).toMatchObject({
      release: "web",
      namespace: "web",
      chart: "private",
      includeCrds: "true",
      skipSchemaValidation: "true",
      kubeconfig: "/dev/null",
      valuesCount: "4",
      "values-1": "a: 1\n",
      "values-2": "b: 2\n",
      "values-3": "c: 3\n",
      "values-4": '{"d":{"e":4}}\n',
      "mode-1": "600",
      "mode-4": "600",
      "where-1": "private",
    });
    expect(listTree(h.work.runDir).filter((f) => f.startsWith("values-") || f.includes("/values-"))).toEqual([]);
  });
  it("is unreadable-file naming a required values file that is missing; helm is not run", () => {
    const h = setup(CHART);
    const set = renderHelm(
      job(repoChart, [{ kind: "file", root: ".", path: "values/x.yaml", field: "f", optional: false }]),
      h.io,
    );
    expect(set.opaque).toMatchObject({ reason: "unreadable-file", field: "f", value: "values/x.yaml" });
    expect(h.commands).toEqual([]);
  });
  it("refuses a values file that is a YAML bomb before helm reads it", () => {
    const bomb = `a: &a [x,x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]\ne: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]\nf: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e,*e]\ng: &g [*f,*f,*f,*f,*f,*f,*f,*f,*f,*f]\n`;
    const h = setup({ ...CHART, "values/bomb.yaml": bomb });
    const set = renderHelm(
      job(repoChart, [{ kind: "file", root: ".", path: "values/bomb.yaml", field: "f", optional: false }]),
      h.io,
    );
    expect(set.opaque?.reason).toBe("limit");
    expect(h.commands).toEqual([]);
  });
  it("is opaque tool-missing naming helm when helm is not on PATH (BR4.15)", () => {
    const h = setup(CHART, { toolPath: "" });
    expect(renderHelm(job(repoChart), h.io).opaque).toMatchObject({
      reason: "tool-missing",
      detail: "helm not found on PATH",
    });
  });
});

describe("Chart.yaml and Chart.lock pre-read (BR4.20)", () => {
  const withDeps = (deps: string, lock?: string): Record<string, string> => ({
    ...CHART,
    "charts/web/Chart.yaml": `apiVersion: v2\nname: web\nversion: 0.1.0\ndependencies:\n${deps}`,
    ...(lock === undefined ? {} : { "charts/web/Chart.lock": lock }),
  });
  it.each([
    [
      "  - {name: x, version: 1.0.0, repository: 'file://../../../outside'}\n",
      "a file:// dependency outside the scanned root is never read",
    ],
    [
      "  - {name: x, version: 1.0.0, repository: 'http://charts.example.org'}\n",
      "only https and oci:// repositories are fetched",
    ],
    [
      "  - {name: x, version: 1.0.0, repository: 'https://127.0.0.1/charts'}\n",
      "an IP address is never fetched from (a host name is required)",
    ],
    [
      "  - {name: x, version: 1.0.0, repository: 'https://localhost/charts'}\n",
      "a loopback or link-local host is never fetched from",
    ],
    [
      "  - {name: x, version: 1.0.0, repository: 'https://u:p@charts.example.org'}\n",
      "a URL holding a credential is never used",
    ],
    ["  - {name: x, version: 1.0.0, repository: '@stable'}\n", "only https, oci:// and file:// dependencies are read"],
  ])("refuses %j as unsupported-field naming the dependency; helm dependency build is not run", (deps, detail) => {
    const h = setup(withDeps(deps));
    const set = renderHelm(job(repoChart), h.io);
    expect(set.opaque).toMatchObject({
      reason: "unsupported-field",
      field: "charts/web/Chart.yaml: dependencies[0].repository",
      detail,
    });
    expect(set.opaque?.value).not.toBeNull();
    expect(h.commands).toEqual([]);
  });
  it("checks Chart.lock's repositories too", () => {
    const h = setup(
      withDeps(
        "  - {name: x, version: 1.0.0, repository: 'https://charts.example.org'}\n",
        "dependencies:\n  - {name: x, version: 1.0.0, repository: 'http://evil.example.org'}\n",
      ),
    );
    expect(renderHelm(job(repoChart), h.io).opaque).toMatchObject({
      reason: "unsupported-field",
      field: "charts/web/Chart.lock: dependencies[0].repository",
    });
  });
  it("copies an in-root file:// dependency and runs helm dependency build on the copy only", () => {
    const h = setup({
      ...withDeps("  - {name: lib, version: 0.1.0, repository: 'file://../lib'}\n"),
      "charts/web/fake.json": '{"mode":"echo"}',
      "charts/lib/Chart.yaml": "apiVersion: v2\nname: lib\nversion: 0.1.0\n",
    });
    const before = snapshot(h.root);
    const set = renderHelm(job(repoChart), h.io);
    expect(h.commands.map((c) => c.subcommand.join(" "))).toEqual(["dependency build", "template", "template"]);
    expect((set.objects[0]?.body.data as Record<string, string> | undefined)?.vendored).toBe("built.tgz");
    expect(snapshot(h.root)).toEqual(before);
  });
  it("does not build dependencies already vendored in charts/", () => {
    const h = setup({
      ...withDeps("  - {name: lib, version: 0.1.0, repository: 'https://charts.example.org'}\n"),
      "charts/web/charts/lib-0.1.0.tgz": "archive",
    });
    renderHelm(job(repoChart), h.io);
    expect(h.commands.map((c) => c.subcommand.join(" "))).toEqual(["template", "template"]);
  });
  it("is offline under --no-network when a dependency must be fetched (BR4.9)", () => {
    const h = setup(withDeps("  - {name: lib, version: 0.1.0, repository: 'https://charts.example.org'}\n"), {
      network: false,
    });
    expect(renderHelm(job(repoChart), h.io).opaque?.reason).toBe("offline");
    expect(h.commands).toEqual([]);
  });
  it("fails closed on a symlink in the chart: unreadable-file, named, helm not run", () => {
    const h = setup(CHART);
    fs.symlinkSync("/etc/hosts", path.join(h.root, "charts", "web", "templates", "hosts.yaml"));
    const set = renderHelm(job(repoChart), h.io);
    expect(set.opaque?.reason).toBe("unreadable-file");
    expect(set.unreadable.map((u) => [u.path, u.outcome])).toEqual([["charts/web/templates/hosts.yaml", "symlink"]]);
    expect(h.commands).toEqual([]);
  });
});

describe("hostile render output and limits (BR4.2, FR1.4)", () => {
  it("a render that emits a YAML bomb is limit for the owner; the bomb document is named, the next kept", () => {
    const h = setup({ ...CHART, "charts/web/fake.json": '{"mode":"bomb"}' });
    const set = renderHelm(job(repoChart), h.io);
    expect(set.opaque).toMatchObject({ reason: "limit" });
    expect(set.unreadable).toEqual([
      {
        path: "render:Application/argocd/web#0#1",
        outcome: "alias-limit",
        reasonWord: "alias expansion over the limit",
        detail: null,
      },
    ]);
    expect(set.objects.map((o) => o.id)).toEqual(["ConfigMap/web/after-bomb"]);
  });
  it("huge output is limit (over cap); a timeout is limit with the detail timeout and timedOut set", () => {
    const capped = { ...RUNNER_LIMITS, stdoutBytes: withValue(LIMITS.renderStdoutBytes, 4096, "test") };
    const h = setup({ ...CHART, "charts/web/fake.json": '{"mode":"flood","kib":64}' }, { limits: capped });
    expect(renderHelm(job(repoChart), h.io).opaque).toMatchObject({
      reason: "limit",
      detail: "helm template output over the cap (standard output)",
    });
    const timed = { ...RUNNER_LIMITS, wallClock: withValue(LIMITS.renderWallClock, 1000, "test") };
    const t = setup({ ...CHART, "charts/web/fake.json": '{"mode":"sleep","ms":20000}' }, { limits: timed });
    expect(renderHelm(job(repoChart), t.io)).toMatchObject({
      timedOut: true,
      opaque: { reason: "limit", detail: "timeout" },
    });
  });
  it("more objects than the limit is limit, with no objects kept", () => {
    const h = setup(CHART, { output: { ...OUTPUT_LIMITS, objects: withValue(LIMITS.renderedObjects, 2, "test") } });
    const set = renderHelm(job(repoChart), h.io);
    expect(set).toMatchObject({
      outcome: "limit",
      objects: [],
      opaque: { detail: "more rendered objects than the limit" },
    });
  });
});

describe("charts from a repository: the chart cache (BR4.8 to BR4.10, FR1.8)", () => {
  const remote = (host: string, version: string | null, name = "demo") =>
    ({ from: "repository", url: `https://${host}`, oci: false, name, version }) as const;
  it("pulls once into .crankpath/charts/<repo-key>/<chart>/<version>/ and then renders from the cache, offline too", () => {
    const h = setup({});
    const first = renderHelm(job(remote("charts.example.org", "2.0.0")), h.io);
    expect(first).toMatchObject({ outcome: "ok", resolvedVersion: "2.0.0" });
    expect(first.objects.map((o) => o.id)).toEqual(["ConfigMap/web/web-demo"]);
    const key = repoKey("https://charts.example.org");
    expect(fs.existsSync(path.join(h.cacheRoot, "charts", key, "demo", "2.0.0", "Chart.yaml"))).toBe(true);
    const offline = { ...h.io, runtime: { ...h.io.runtime, network: false } };
    const before = h.commands.length;
    const second = renderHelm(job(remote("charts.example.org", "2.0.0")), offline);
    expect(second.outcome).toBe("ok");
    expect(h.commands.slice(before).map((c) => c.subcommand.join(" "))).toEqual(["template", "template"]);
  });
  it("records the resolved version of a floating range (BR4.10)", () => {
    const h = setup({});
    expect(renderHelm(job(remote("charts.example.org", "^1.0.0")), h.io).resolvedVersion).toBe("1.2.3");
  });
  it("is offline, fetching nothing, on a cache miss under --no-network (BR4.9)", () => {
    const h = setup({}, { network: false });
    expect(renderHelm(job(remote("charts.example.org", "2.0.0")), h.io).opaque).toMatchObject({
      reason: "offline",
      detail: "not in the chart cache, and --no-network fetches nothing",
    });
    expect(renderHelm(job(remote("charts.example.org", "^2")), h.io).opaque?.reason).toBe("offline");
    expect(h.commands).toEqual([]);
  });
  it("never reads a cache inside the scanned tree (the scanned repo could have committed it)", () => {
    const h = setup({}, { trusted: false, network: false });
    // a "cached" chart planted where a committed .crankpath would put it
    const planted = path.join(h.cacheRoot, "charts", repoKey("https://charts.example.org"), "demo", "2.0.0");
    fs.mkdirSync(planted, { recursive: true });
    fs.writeFileSync(path.join(planted, "Chart.yaml"), "apiVersion: v2\nname: demo\nversion: 2.0.0\n");
    fs.writeFileSync(
      path.join(planted, "fake-render.yaml"),
      "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: planted}\n",
    );
    expect(renderHelm(job(remote("charts.example.org", "2.0.0")), h.io).opaque?.detail).toBe(
      "the chart cache is inside the scanned tree, so crankpath does not read it; use --cache-dir",
    );
  });
  it("reports 403 as private-chart, and 404, unreachable and timeout as what they are, never as absent", () => {
    const h = setup({});
    expect(renderHelm(job(remote("forbidden.example.org", "1.0.0")), h.io).opaque).toMatchObject({
      reason: "private-chart",
      detail: "the repository refused the request (crankpath sends no credential)",
    });
    expect(renderHelm(job(remote("missing.example.org", "1.0.0")), h.io).opaque?.detail).toContain(
      "unknown whether the chart exists",
    );
    expect(renderHelm(job(remote("unreachable.example.org", "1.0.0")), h.io).opaque?.detail).toContain(
      "could not be reached",
    );
    const timed = setup(
      {},
      { limits: { ...RUNNER_LIMITS, wallClock: withValue(LIMITS.renderWallClock, 1000, "test") } },
    );
    expect(renderHelm(job(remote("slow.example.org", "1.0.0")), timed.io)).toMatchObject({
      timedOut: true,
      opaque: { reason: "limit", detail: "timeout" },
    });
  });
  it("refuses a fetched chart with a symlink or another name, and a URL the guard refuses", () => {
    const h = setup({});
    expect(renderHelm(job(remote("symlink.example.org", "1.0.0")), h.io).opaque?.reason).toBe("render-failed");
    expect(renderHelm(job(remote("renamed.example.org", "1.0.0")), h.io).opaque?.reason).toBe("render-failed");
    const before = h.commands.length;
    expect(renderHelm(job(remote("127.0.0.1", "1.0.0")), h.io).opaque?.reason).toBe("unsupported-field");
    expect(renderHelm(job(remote("charts.example.org", "--set=x")), h.io).opaque?.reason).toBe("unsupported-field");
    expect(h.commands.length).toBe(before);
  });
  it("reads a values file inside the fetched chart only", () => {
    const h = setup({});
    const set = renderHelm(
      job(remote("charts.example.org", "2.0.0"), [
        { kind: "chart-file", path: "values-extra.yaml", field: "f", optional: false },
      ]),
      h.io,
    );
    expect(set.outcome).toBe("ok");
    const missing = renderHelm(
      job(remote("charts.example.org", "2.0.0"), [
        { kind: "chart-file", path: "nope.yaml", field: "f", optional: false },
      ]),
      h.io,
    );
    expect(missing.opaque).toMatchObject({ reason: "unreadable-file", value: "nope.yaml" });
  });
});
