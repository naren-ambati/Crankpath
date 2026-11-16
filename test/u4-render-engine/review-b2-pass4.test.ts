// B2 review, fourth pass: a kustomization or configuration file with any YAML tag, or with a
// quoted or plain scalar whose decoding could differ (an escape, a line break), is refused whole
// before kustomize runs (M1); every document of a multi-document configuration file is judged
// (m1); the configuration scan's refusal says what it is: conservative, not a claim that the
// literal is fetched (m2).

import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { KustomizeJob } from "../../src/u3-discovery-expansion/render-job.js";
import { renderKustomize } from "../../src/u4-render-engine/kustomize-renderer.js";
import { yamlShapeProblem } from "../../src/u4-render-engine/yaml-shape.js";
import { harness, type RenderHarness } from "../helpers/render.js";
import { estate } from "../helpers/scan.js";

const made: RenderHarness[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const h of made.splice(0)) h.cleanup();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function setup(files: Record<string, string>) {
  const root = estate(files);
  roots.push(root);
  const h = harness(root);
  made.push(h);
  return h;
}

const kz = (dir = "k"): KustomizeJob => ({
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
  kind: "kustomize",
  releaseName: null,
  root: ".",
  dir,
});
const CM = "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: a}\n";
const BIN = "aHR0cDovLzEyNy4wLjAuMToxODA4MS9iaW4="; // the text of a loopback URL
const TAG = "a YAML tag (kustomize may decode the value otherwise than crankpath reads it)";
const STYLE =
  "a quoted or plain scalar with an escape or a line break (kustomize may decode it otherwise than crankpath reads it)";

describe("M1: a YAML tag or a scalar that may decode otherwise is refused before kustomize runs", () => {
  it.each([
    // the review's h5src and h6src
    ["a-main: !!binary on a patch path", `resources: [cm.yaml]\npatches:\n- path: !!binary ${BIN}\n`],
    ["e-set: !!set", "resources: [cm.yaml]\npatches:\n- path: !!set {a: b}\n"],
    ["c-str: !!str", "resources: [cm.yaml]\npatches:\n- path: !!str http://127.0.0.1:1/c\n"],
    [
      "d-cmg: !!binary in a generator",
      `resources: [cm.yaml]\nconfigMapGenerator:\n- name: x\n  files: [!!binary ${BIN}]\n`,
    ],
    ["h6 a: a tagged key", "resources: [cm.yaml]\npatches:\n- !!binary cGF0aA==: http://127.0.0.1:1/keytag\n"],
    // siblings
    ["!!str on a key", "resources: [cm.yaml]\npatches:\n- !!str path: p.yaml\n"],
    ["a custom tag", "resources: [cm.yaml]\nnamePrefix: !mine x-\n"],
    ["a verbatim tag", "resources: [cm.yaml]\nnamePrefix: !<tag:yaml.org,2002:str> x-\n"],
    ["an anchor with a tag", "resources: [cm.yaml]\nnamePrefix: &p !!str x-\nnameSuffix: *p\n"],
    ["a tag on a sequence", "resources: !!seq [cm.yaml]\n"],
    ["a %TAG directive", "%TAG !k! tag:example.org,2026:\n---\nresources: [cm.yaml]\n"],
  ])("refuses %s", (_name, text) => {
    const h = setup({ "k/kustomization.yaml": text, "k/cm.yaml": CM, "k/p.yaml": CM });
    const set = renderKustomize(kz(), h.io);
    expect(set.opaque).toMatchObject({ reason: "unsupported-field", detail: TAG, field: "k/kustomization.yaml" });
    expect(h.commands).toEqual([]);
  });
  it.each([
    ["an escape in a double-quoted path", 'resources: [cm.yaml]\npatches:\n- path: "p\\x2eyaml"\n'],
    ["a double-quoted scalar over two lines", 'resources: [cm.yaml]\npatches:\n- path: "p.\n    yaml"\n'],
    ["a single-quoted scalar over two lines", "resources: [cm.yaml]\npatches:\n- path: 'p.\n    yaml'\n"],
    ["a plain scalar over two lines", "resources: [cm.yaml]\npatches:\n- path: p.\n    yaml\n"],
  ])("refuses %s", (_name, text) => {
    const h = setup({ "k/kustomization.yaml": text, "k/cm.yaml": CM });
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({ reason: "unsupported-field", detail: STYLE });
    expect(h.commands).toEqual([]);
  });
  it("refuses a tag in a configuration file (h5src b-cfg), and a tagged key in one", () => {
    for (const t of [
      `apiVersion: builtin\nkind: PatchTransformer\nmetadata: {name: t}\ntarget: {kind: ConfigMap}\npath: !!binary ${BIN}\n`,
      "apiVersion: builtin\nkind: PatchTransformer\nmetadata: {name: t}\n!!binary cGF0aA==: http://127.0.0.1:1/x\n",
    ]) {
      const h = setup({
        "k/kustomization.yaml": "resources: [cm.yaml]\ntransformers: [t.yaml]\n",
        "k/cm.yaml": CM,
        "k/t.yaml": t,
      });
      expect(renderKustomize(kz(), h.io).opaque).toMatchObject({
        reason: "unsupported-field",
        detail: TAG,
        field: "k/t.yaml",
      });
      expect(h.commands).toEqual([]);
    }
  });
  it("refuses a tag in a base's kustomization too", () => {
    const h = setup({
      "k/kustomization.yaml": "resources: [../b]\n",
      "b/kustomization.yaml": `resources: [cm.yaml]\npatches:\n- path: !!binary ${BIN}\n`,
      "b/cm.yaml": CM,
    });
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({ detail: TAG, field: "b/kustomization.yaml" });
  });
  it("keeps block scalars, plain one-line and quoted one-line scalars, comments and the characters ! and & inside values", () => {
    const h = setup({
      "k/kustomization.yaml":
        "# a comment with !tag and &anchor\nresources: [cm.yaml, 'p.yaml']\nnamePrefix: \"x-\"\ncommonAnnotations: {note: a!b&c}\npatchesStrategicMerge:\n- |\n  apiVersion: v1\n  kind: ConfigMap\n  metadata: {name: a}\n",
      "k/cm.yaml": CM,
      "k/p.yaml": CM,
    });
    expect(renderKustomize(kz(), h.io).outcome).toBe("ok");
  });
  it("reads the tokens, so a tag is found wherever it is", () => {
    expect(yamlShapeProblem("a: [1, !!int 2]\n")).toEqual({ kind: "tag", token: "!!int" });
    expect(yamlShapeProblem("a: b\n---\nc: !x d\n")).toEqual({ kind: "tag", token: "!x" });
    expect(yamlShapeProblem("a: |\n  two\n  lines\n")).toBeNull();
    expect(yamlShapeProblem("a: >-\n  folded\n  text\n")).toBeNull();
    // a top-level block scalar's lines start at column 0: still its lines, never a tag or a plain scalar
    expect(yamlShapeProblem("--- |\nline one\n!line two\n")).toBeNull();
    expect(yamlShapeProblem("a: \"plain\"\nb: 'one'\n")).toBeNull();
  });
});

describe("m1: every document of a configuration file is judged", () => {
  it("refuses a URL in the second document of a transformer file", () => {
    const h = setup({
      "k/kustomization.yaml": "resources: [cm.yaml]\ntransformers: [t.yaml]\n",
      "k/cm.yaml": CM,
      "k/t.yaml":
        "apiVersion: builtin\nkind: PrefixSuffixTransformer\nmetadata: {name: p}\nprefix: x-\n---\napiVersion: builtin\nkind: PatchTransformer\nmetadata: {name: t}\npath: http://127.0.0.1:1/second\n",
    });
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({
      reason: "unsupported-field",
      field: "transformers[0] path",
    });
    expect(h.commands).toEqual([]);
  });
});

describe("m2: the configuration scan's refusal says it is conservative", () => {
  it("names a literal holding :// as refused, without claiming kustomize would fetch it", () => {
    const h = setup({
      "k/kustomization.yaml": "resources: [cm.yaml]\ngenerators: [g.yaml]\n",
      "k/cm.yaml": CM,
      "k/g.yaml":
        "apiVersion: builtin\nkind: ConfigMapGenerator\nmetadata: {name: g}\nliterals: [HOMEPAGE=https://example.org/docs]\n",
    });
    expect(renderKustomize(kz(), h.io).opaque).toMatchObject({
      reason: "unsupported-field",
      detail:
        "a kustomize configuration file names a URL or a non-plain path that kustomize may load; crankpath does not tell a literal from a path here",
    });
  });
});
