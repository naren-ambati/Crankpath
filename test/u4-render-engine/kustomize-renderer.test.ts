// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Flux substitution variables are written ${name} in the inputs under test
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { withValue } from "../support/limits.js";
import type { KustomizeJob } from "../../src/u3-discovery-expansion/render-job.js";
import { RUNNER_LIMITS } from "../../src/u4-render-engine/command-runner.js";
import { preReadKustomization, renderKustomize } from "../../src/u4-render-engine/kustomize-renderer.js";
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

function job(dir: string, extra: Partial<KustomizeJob> = {}): KustomizeJob {
  return {
    kind: "kustomize",
    jobId: "Application/argocd/k#0",
    owner: "Application/argocd/k",
    ownerFile: "apps/k.yaml",
    ownerField: "spec.source.path",
    ownerRenderedPath: "apps/k.yaml#1",
    destination: "in-cluster",
    namespace: "k",
    namespaceOverride: null,
    releaseName: null,
    valuesInputs: [],
    source: { repo: null, path: dir, chart: null, version: null, floating: false },
    generatedBy: null,
    substitute: null,
    floating: [],
    root: ".",
    dir,
    ...extra,
  };
}

const CM = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: base-cm\ndata: {a: b}\n";
const BASE = {
  "base/kustomization.yaml": "resources: [cm.yaml]\n",
  "base/cm.yaml": CM,
  "overlay/kustomization.yaml": "namespace: k\nresources: [../base, svc.yaml]\n",
  "overlay/svc.yaml": "apiVersion: v1\nkind: Service\nmetadata:\n  name: svc\n",
};

describe("kustomize pre-read (BR4.4, BR4.5)", () => {
  it("collects the closure of kustomization directories", () => {
    const h = setup(BASE);
    expect(preReadKustomization(h.io, ".", "overlay")).toMatchObject({ ok: true, dirs: ["base", "overlay"] });
  });
  it.each([
    ["https://github.com/org/repo//base?ref=main"],
    ["github.com/org/repo//base?ref=v1"],
    ["git@github.com:org/repo.git//base"],
    ["ssh://git@github.com/org/repo"],
    ["not-here"],
  ])("is remote-base for the resource %j, before kustomize runs", (entry) => {
    const h = setup({ ...BASE, "overlay/kustomization.yaml": `resources:\n  - ${JSON.stringify(entry)}\n` });
    const set = renderKustomize(job("overlay"), h.io);
    expect(set.opaque).toMatchObject({ reason: "remote-base", field: "resources[0]", value: entry });
    expect(h.commands).toEqual([]);
  });
  it.each(["bases", "components"])("is remote-base for a URL in %s", (field) => {
    const h = setup({ ...BASE, "overlay/kustomization.yaml": `${field}: [https://example.org/x]\n` });
    expect(renderKustomize(job("overlay"), h.io).opaque).toMatchObject({ reason: "remote-base", field: `${field}[0]` });
  });
  it("is remote-base for a URL in patches, configurations and generators", () => {
    for (const k of [
      "patches: [{path: 'https://example.org/p.yaml'}]",
      "configurations: [https://example.org/c.yaml]",
      "generators: [https://example.org/g.yaml]",
    ]) {
      const h = setup({ ...BASE, "overlay/kustomization.yaml": `resources: [svc.yaml]\n${k}\n` });
      expect(renderKustomize(job("overlay"), h.io).opaque?.reason, k).toBe("remote-base");
    }
  });
  it("is remote-base when the kustomization file or an entry is a symlink", () => {
    const h = setup(BASE);
    fs.symlinkSync(path.join(h.root, "base", "cm.yaml"), path.join(h.root, "overlay", "link.yaml"));
    fs.writeFileSync(path.join(h.root, "overlay", "kustomization.yaml"), "resources: [link.yaml]\n");
    expect(renderKustomize(job("overlay"), h.io).opaque).toMatchObject({ reason: "remote-base", value: "link.yaml" });
    fs.rmSync(path.join(h.root, "overlay", "kustomization.yaml"));
    fs.symlinkSync(path.join(h.root, "base", "kustomization.yaml"), path.join(h.root, "overlay", "kustomization.yaml"));
    expect(renderKustomize(job("overlay"), h.io).opaque).toMatchObject({ reason: "remote-base" });
    expect(h.commands).toEqual([]);
  });
  it("fails closed as render-failed for an entry outside the scanned root", () => {
    const h = setup({ ...BASE, "overlay/kustomization.yaml": "resources: [../../../etc]\n" });
    expect(renderKustomize(job("overlay"), h.io).opaque).toMatchObject({
      reason: "render-failed",
      value: "../../../etc",
    });
  });
  it("never enables Helm inflation: helmCharts is unsupported-field", () => {
    const h = setup({ ...BASE, "overlay/kustomization.yaml": "helmCharts: [{name: x, repo: https://example.org}]\n" });
    expect(renderKustomize(job("overlay"), h.io).opaque).toMatchObject({
      reason: "unsupported-field",
      field: "helmCharts",
    });
  });
  it("ignores inline patches (YAML text, not a path)", () => {
    const h = setup({
      ...BASE,
      "overlay/kustomization.yaml":
        "resources: [svc.yaml]\npatchesStrategicMerge:\n  - |\n    apiVersion: v1\n    kind: Service\n",
    });
    expect(preReadKustomization(h.io, ".", "overlay").ok).toBe(true);
  });
  it("is unreadable-file or limit when a kustomization file cannot be read", () => {
    const h = setup({ "k/kustomization.yaml": ": : [" });
    expect(renderKustomize(job("k"), h.io).opaque?.reason).toBe("unreadable-file");
  });
});

describe("kustomize build (FR3.5) through the runner", () => {
  it("builds crankpath's private copy, never the scanned tree, and writes nothing into the tree", () => {
    const h = setup(BASE);
    const before = snapshot(h.root);
    const set = renderKustomize(job("overlay"), h.io);
    expect(set.outcome).toBe("ok");
    expect(set.objects.map((o) => o.id)).toEqual(["ConfigMap/k/base-cm", "Service/k/svc"]);
    expect(set.objects.every((o) => o.annotations["fake/dir"] === "private")).toBe(true);
    expect(set.kustomizeDirs).toEqual(["base", "overlay"]);
    expect(h.commands.map((c) => `${c.tool} ${c.subcommand.join(" ")} ${c.outcome}`)).toEqual(["kustomize build ok"]);
    expect(snapshot(h.root)).toEqual(before);
    // the job's private copy is gone once the job ends
    expect(listTree(h.work.runDir).filter((f) => f.includes("kustomize-"))).toEqual([]);
  });
  it("is opaque tool-missing, naming kustomize, when it is not on PATH", () => {
    const h = setup(BASE, { toolPath: "" });
    expect(renderKustomize(job("overlay"), h.io).opaque).toMatchObject({
      reason: "tool-missing",
      detail: "kustomize not found on PATH",
    });
  });
  it("fails closed when a file under the copied tree is a symlink (kustomize not run)", () => {
    const h = setup(BASE);
    fs.symlinkSync("/etc/hosts", path.join(h.root, "base", "hosts.yaml"));
    const set = renderKustomize(job("overlay"), h.io);
    expect(set.opaque).toMatchObject({ reason: "render-failed" });
    expect(set.unreadable.map((u) => [u.path, u.outcome])).toEqual([["base/hosts.yaml", "symlink"]]);
    expect(h.commands).toEqual([]);
  });
  it("a timeout is opaque limit with the detail timeout (OD-30)", () => {
    const h = setup(
      { ...BASE, "overlay/fake.json": '{"mode":"sleep","ms":20000}' },
      { limits: { ...RUNNER_LIMITS, wallClock: withValue(LIMITS.renderWallClock, 1000, "test") } },
    );
    const set = renderKustomize(job("overlay"), h.io);
    expect(set).toMatchObject({ outcome: "limit", timedOut: true, opaque: { reason: "limit", detail: "timeout" } });
  });
  it("a failed build is render-failed in fixed words; standard error is never in the mark", () => {
    const h = setup({ ...BASE, "overlay/fake.json": '{"mode":"fail","stderr":"SECRET-ERROR-TEXT\\n"}' });
    const set = renderKustomize(job("overlay"), h.io);
    expect(set.opaque).toMatchObject({ reason: "render-failed", detail: "kustomize build exited with an error" });
    expect(JSON.stringify(set)).not.toContain("SECRET-ERROR-TEXT");
  });
  it("applies Flux targetNamespace and post-build substitution", () => {
    const h = setup({ ...BASE, "base/cm.yaml": CM.replace("base-cm", "cm-${env}") });
    const set = renderKustomize(
      job("base", { namespaceOverride: "flux-ns", substitute: new Map([["env", "prod"]]) }),
      h.io,
    );
    expect(set.objects.map((o) => o.id)).toEqual(["ConfigMap/flux-ns/cm-prod"]);
  });
});
