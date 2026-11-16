// B2 review M1, M2, M3, m4, m5, m7, n1: the pre-reads decode as helm and kustomize do (Go's
// encoding/json matches keys case-insensitively), refuse any case-variant or unknown spelling of a
// field that names a dependency, read `requirements.yaml` and `requirements.lock` too, read the
// private copy the tool will read (not the original), helm never validates a values schema (it
// would fetch `$ref` URLs), and chart versions compare as helm compares them.

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import type { HelmJob, KustomizeJob } from "../../src/u3-discovery-expansion/render-job.js";
import { createCommandRunner, buildChildEnv, type Spawn } from "../../src/u4-render-engine/command-runner.js";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { renderHelm } from "../../src/u4-render-engine/helm-renderer.js";
import { renderKustomize } from "../../src/u4-render-engine/kustomize-renderer.js";
import type { RenderIo } from "../../src/u4-render-engine/renderers.js";
import { createWorkDir } from "../../src/u4-render-engine/work-dir.js";
import { harness, type RenderHarness } from "../helpers/render.js";
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

function helm(dir = "c", extra: Partial<HelmJob> = {}): HelmJob {
  return {
    ...base,
    kind: "helm",
    releaseName: "a",
    chart: { from: "repo", root: ".", dir },
    values: [],
    includeCrds: true,
    skipSchemaValidation: false,
    ...extra,
  };
}

function kz(dir = "k"): KustomizeJob {
  return { ...base, kind: "kustomize", releaseName: null, root: ".", dir };
}

const CM = "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: top}\n";
const chart = (chartYaml: string, extra: Record<string, string> = {}) => ({
  "c/Chart.yaml": chartYaml,
  "c/templates/cm.yaml": CM,
  "c/fake-render.yaml": CM,
  ...extra,
});

describe("M1: a kustomization is read as kustomize reads it", () => {
  it.each([
    ["Resources:\n  - https://127.0.0.1:1/org/repo.git//base?ref=main\n", "Resources"],
    ["RESOURCES:\n  - cm.yaml\n", "RESOURCES"],
    ["Bases: [https://example.org/x]\n", "Bases"],
    ["HelmCharts:\n  - {name: x, repo: 'https://127.0.0.1:1', releaseName: x}\n", "HelmCharts"],
    ["reſources: [https://example.org/x]\n", "reſources"],
    ["resources: [cm.yaml]\nResources: [https://example.org/x]\n", "Resources"],
  ])("refuses the case-variant key of %j as unsupported-field, before kustomize runs", (text, key) => {
    const h = setup({ "k/kustomization.yaml": text, "k/cm.yaml": CM });
    const set = renderKustomize(kz(), h.io);
    expect(set.opaque).toMatchObject({
      reason: "unsupported-field",
      field: key,
      detail: "a key spelled otherwise than a kustomize field (kustomize matches keys without regard to case)",
    });
    expect(h.commands).toEqual([]);
  });
  it("refuses an unknown top-level key (kustomize itself refuses it; crankpath never guesses what it means)", () => {
    const h = setup({ "k/kustomization.yaml": "Resourcesx: [cm.yaml]\n", "k/cm.yaml": CM });
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({ reason: "unsupported-field", field: "Resourcesx" });
  });
  it("refuses a case-variant key inside an entry (patches[0].Path, configMapGenerator[0].Files)", () => {
    for (const [text, field] of [
      ["resources: [cm.yaml]\npatches:\n  - {Path: 'https://example.org/p.yaml'}\n", "patches[0].Path"],
      ["configMapGenerator:\n  - {name: x, Files: ['https://example.org/f']}\n", "configMapGenerator[0].Files"],
    ] as const) {
      const h = setup({ "k/kustomization.yaml": text, "k/cm.yaml": CM });
      expect(renderKustomize(kz(), h.io).opaque, text).toMatchObject({ reason: "unsupported-field", field });
    }
  });
  it("still sees a base hidden behind a YAML anchor and merge key", () => {
    const h = setup({
      "k/kustomization.yaml":
        "x-anchor: &r\n  resources:\n    - https://127.0.0.1:1/org/repo.git//base?ref=main\n<<: *r\n",
    });
    expect(renderKustomize(kz(), h.io).opaque?.reason).toMatch(/remote-base|unsupported-field/);
    expect(h.commands).toEqual([]);
  });
});

describe("M1: Chart.yaml is read as helm reads it", () => {
  it.each([
    [
      "apiVersion: v2\nname: c\nversion: 0.1.0\ndependencies:\n  - {name: sub, version: 0.1.0, Repository: 'file:///outside-the-root/chart'}\n",
      "c/Chart.yaml: dependencies[0].Repository",
    ],
    [
      "apiVersion: v2\nname: c\nversion: 0.1.0\nDependencies:\n  - {name: sub, version: 0.1.0, repository: 'http://127.0.0.1:1/charts'}\n",
      "c/Chart.yaml: Dependencies",
    ],
    [
      "apiVersion: v2\nname: c\nversion: 0.1.0\ndependencies:\n  - {Name: sub, version: 0.1.0}\n",
      "c/Chart.yaml: dependencies[0].Name",
    ],
  ])("refuses the case-variant key %#, naming it; nothing runs", (text, field) => {
    const h = setup(chart(text));
    const set = renderHelm(helm(), h.io);
    expect(set.opaque).toMatchObject({ reason: "unsupported-field", field });
    expect(h.commands).toEqual([]);
  });
  it("refuses an absolute file:// dependency, and dependencies that are not a list", () => {
    const abs = setup(
      chart(
        "apiVersion: v2\nname: c\nversion: 0.1.0\ndependencies:\n  - {name: s, version: 0.1.0, repository: 'file:///outside-the-root/chart'}\n",
      ),
    );
    expect(renderHelm(helm(), abs.io).opaque).toMatchObject({
      reason: "unsupported-field",
      value: "file:///outside-the-root/chart",
    });
    const map = setup(chart("apiVersion: v2\nname: c\nversion: 0.1.0\ndependencies: {name: s}\n"));
    expect(renderHelm(helm(), map.io).opaque).toMatchObject({
      reason: "unsupported-field",
      field: "c/Chart.yaml: dependencies",
    });
  });
  it("still sees a repository hidden behind a YAML anchor and merge key", () => {
    const h = setup(
      chart(
        "apiVersion: v2\nname: c\nversion: 0.1.0\nx-anchor: &d\n  repository: 'file:///outside-the-root/chart'\ndependencies:\n  - name: sub\n    version: 0.1.0\n    <<: *d\n",
      ),
    );
    expect(renderHelm(helm(), h.io).opaque?.reason).toBe("unsupported-field");
    expect(h.commands).toEqual([]);
  });
});

describe("M2: requirements.yaml and requirements.lock are pre-read like Chart.yaml and Chart.lock", () => {
  it.each([
    [
      "c/requirements.yaml",
      "dependencies:\n  - {name: sub, version: 0.1.0, repository: 'http://127.0.0.1:18765/charts'}\n",
      "only https and oci:// repositories are fetched",
    ],
    [
      "c/requirements.yaml",
      "dependencies:\n  - {name: sub, version: 0.1.0, repository: 'file:///outside-the-root/chart'}\n",
      "a file:// dependency outside the scanned root is never read",
    ],
    [
      "c/requirements.lock",
      "dependencies:\n- {name: sub, version: 0.1.0, repository: 'file:///outside-the-root/chart'}\n",
      "a file:// dependency outside the scanned root is never read",
    ],
  ])("refuses %s naming a forbidden dependency; helm dependency build is not run", (file, text, detail) => {
    const h = setup(
      chart("apiVersion: v1\nname: c\nversion: 0.1.0\ndependencies:\n  - {name: sub, version: 0.1.0}\n", {
        [file]: text,
      }),
    );
    const set = renderHelm(helm(), h.io);
    expect(set.opaque).toMatchObject({
      reason: "unsupported-field",
      field: `${file}: dependencies[0].repository`,
      detail,
    });
    expect(h.commands).toEqual([]);
  });
  it("refuses a case-variant key in requirements.yaml", () => {
    const h = setup(
      chart("apiVersion: v1\nname: c\nversion: 0.1.0\n", { "c/requirements.yaml": "Dependencies:\n  - {name: sub}\n" }),
    );
    expect(renderHelm(helm(), h.io).opaque).toMatchObject({
      reason: "unsupported-field",
      field: "c/requirements.yaml: Dependencies",
    });
  });
  it("needs a dependency build for a requirements.yaml dependency that is not vendored", () => {
    const h = setup(
      chart("apiVersion: v1\nname: c\nversion: 0.1.0\n", {
        "c/requirements.yaml": "dependencies:\n  - {name: lib, version: 0.1.0, repository: 'file://../lib'}\n",
        "lib/Chart.yaml": "apiVersion: v1\nname: lib\nversion: 0.1.0\n",
      }),
    );
    renderHelm(helm(), h.io);
    expect(h.commands.map((c) => c.subcommand.join(" "))).toEqual(["dependency build", "template", "template"]);
  });
});

describe("M3: helm never validates a values schema (it would fetch $ref URLs)", () => {
  it("always passes --skip-schema-validation, whatever the source says", () => {
    const h = setup(
      chart("apiVersion: v2\nname: c\nversion: 0.1.0\n", {
        "c/fake.json": '{"mode":"echo"}',
        "c/values.schema.json": '{"$ref":"http://127.0.0.1:1/s.json"}',
      }),
    );
    const set = renderHelm(helm("c", { skipSchemaValidation: false }), h.io);
    expect((set.objects[0]?.body.data as Record<string, string> | undefined)?.skipSchemaValidation).toBe("true");
  });
});

describe("m4: the pre-read reads crankpath's private copy, the bytes the tool will read", () => {
  it("refuses a hostile Chart.yaml even when a second read of the original would look safe", () => {
    const h = setup(
      chart(
        "apiVersion: v2\nname: c\nversion: 0.1.0\ndependencies:\n  - {name: s, version: 0.1.0, repository: 'http://127.0.0.1:1/x'}\n",
      ),
    );
    // the parsed read (the discovery cache) shows a safe Chart.yaml; the bytes that are copied are hostile
    const safe = {
      outcome: "ok" as const,
      path: "c/Chart.yaml",
      size: 1,
      documents: [{ apiVersion: "v2", name: "c", version: "0.1.0" }],
    };
    const io: RenderIo = { ...h.io, read: (label, p) => (p === "c/Chart.yaml" ? safe : h.io.read(label, p)) };
    expect(renderHelm(helm(), io).opaque).toMatchObject({ reason: "unsupported-field" });
    expect(h.commands).toEqual([]);
  });
  it("does the same for a kustomization", () => {
    const h = setup({ "k/kustomization.yaml": "resources: [https://example.org/x]\n" });
    const safe = { outcome: "ok" as const, path: "k/kustomization.yaml", size: 1, documents: [{ resources: [] }] };
    const io: RenderIo = { ...h.io, read: (label, p) => (p === "k/kustomization.yaml" ? safe : h.io.read(label, p)) };
    expect(renderKustomize(kz(), io).opaque?.reason).toBe("remote-base");
  });
});

describe("m5: a symlinked Chart.lock", () => {
  it("is unreadable-file, naming the lock file; helm is not run", () => {
    const h = setup(chart("apiVersion: v2\nname: c\nversion: 0.1.0\n", { "real.lock": "dependencies: []\n" }));
    fs.symlinkSync(path.join(h.root, "real.lock"), path.join(h.root, "c", "Chart.lock"));
    const set = renderHelm(helm(), h.io);
    expect(set.opaque?.reason).toBe("unreadable-file");
    expect(set.unreadable.map((u) => [u.path, u.outcome])).toEqual([["c/Chart.lock", "symlink"]]);
    expect(h.commands).toEqual([]);
  });
});

describe("m7: chart versions compare as helm compares them", () => {
  const remote = (host: string, version: string | null, name = "demo") =>
    ({ from: "repository", url: `https://${host}`, oci: false, name, version }) as const;
  it("takes an exact targetRevision with a leading v for the chart's own version, and finds it in the cache again", () => {
    const h = setup({});
    const first = renderHelm(helm("c", { chart: remote("charts.example.org", "v2.0.0") }), h.io);
    expect(first).toMatchObject({ outcome: "ok", resolvedVersion: "2.0.0" });
    const offline = { ...h.io, runtime: { ...h.io.runtime, network: false } };
    expect(renderHelm(helm("c", { chart: remote("charts.example.org", "v2.0.0") }), offline).outcome).toBe("ok");
  });
  it("accepts the one chart directory helm made for an OCI reference whose chart has another name", () => {
    const h = setup({});
    const set = renderHelm(
      helm("c", {
        chart: {
          from: "repository",
          url: "oci://ocirename.example.org/charts",
          oci: true,
          name: "demo",
          version: "1.0.0",
        },
      }),
      h.io,
    );
    expect(set.outcome).toBe("ok");
  });
});

describe("n1: an output over its cap keeps neither stream", () => {
  it("clears standard error when standard output is over the cap", () => {
    const spawn: Spawn = () => ({
      status: 0,
      signal: null,
      stdout: Buffer.alloc(64),
      stderr: Buffer.from("secret"),
      error: undefined,
    });
    const work = createWorkDir("/nonexistent-crankpath-cache", true);
    const runner = createCommandRunner({
      binaries: { helm: "/x/helm" },
      env: buildChildEnv(work.homes),
      spawn,
      limits: {
        wallClock: LIMITS.renderWallClock,
        stdoutBytes: withValue(LIMITS.renderStdoutBytes, 10, "test"),
        stderrBytes: LIMITS.renderStderrBytes,
      },
    });
    const r = runner.run({ tool: "helm", subcommand: ["template"], args: ["--", "a", "/c"], cwd: "/" });
    expect(r).toMatchObject({ outcome: "over-cap", overCap: "stdout" });
    expect(r.stdout.length + r.stderr.length).toBe(0);
  });
});

describe("m1: Secret values are discarded whatever the spelling or the list kind", () => {
  it("strips SecretList items and case-variant data keys, keeping only a Secret's identity fields", async () => {
    const { buildObjects } = await import("../../src/u4-render-engine/rendered-set-builder.js");
    const docs = [
      {
        apiVersion: "v1",
        kind: "SecretList",
        items: [{ apiVersion: "v1", kind: "Secret", metadata: { name: "c" }, data: { k: "LEAK6" } }],
      },
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "d" },
        Data: { k: "LEAK7" },
        StringData: { k: "LEAK8" },
        extra: "LEAK9",
        type: "Opaque",
      },
      { apiVersion: "v1", kind: "Secret", metadata: { name: "e", Annotations: { x: "LEAK10" }, labels: { a: "b" } } },
    ].map((value, i) => ({ file: "f", document: i + 1, value: value as unknown as DataValue }));
    const r = buildObjects(docs, { renderJob: "j", defaultNamespace: "ns", destination: "in-cluster" });
    expect(r.objects.map((o) => o.id)).toEqual(["Secret/ns/c", "Secret/ns/d", "Secret/ns/e"]);
    expect(JSON.stringify(r.objects.map((o) => o.body))).not.toMatch(/LEAK/);
    expect(r.objects[1]?.body).toEqual({ apiVersion: "v1", kind: "Secret", metadata: { name: "d" }, type: "Opaque" });
    expect(r.objects[2]?.labels).toEqual({ a: "b" });
  });
});

// m2 (the first pass) is superseded by the second pass: every Helm render is compared with a second
// render (review-b2-pass2.test.ts); no reading of the templates decides it.
