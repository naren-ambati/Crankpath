// GeneratorExpander on real files through the real tree walk and reader (FR3.3, FR3.4, BR3.10 to
// BR3.14): one test per generator form and per refusal, each with the input that makes it change.

import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type { ClusterDecl } from "../../src/u1-graph-model/declared-facts.js";
import type { DataValue, RepoResolution } from "../../src/u1-graph-model/extractor.js";
import { openRoot, READER_LIMITS, readYaml } from "../../src/u2-intake-config/bounded-reader.js";
import { walkFiles } from "../../src/u2-intake-config/tree-walk.js";
import { type ExpanderIo, expandApplicationSet } from "../../src/u3-discovery-expansion/generator-expander.js";
import { meta, obj } from "../helpers/objects.js";
import { estate } from "../helpers/scan.js";

const URL = "https://git.example.org/ops/estate";
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

function io(files: Record<string, string>, resolution?: RepoResolution): ExpanderIo {
  const dir = estate(files);
  cleanup.push(dir);
  const r = openRoot(dir);
  if (!r.ok) throw new Error("root");
  const root = r.root;
  return {
    resolveRepo: (url) =>
      resolution ??
      (url === URL
        ? { outcome: "self", root: ".", via: "scanned-url", suggestion: null }
        : { outcome: "unreadable", root: null, via: "none", suggestion: null }),
    walk: (_label, d, options) => walkFiles(root, d, options),
    read: (_label, p) => readYaml(root, p, READER_LIMITS),
    display: (_label, p) => p,
  };
}

function appSet(spec: object) {
  return obj(meta("ApplicationSet", "argocd", "root", { spec: spec as Record<string, DataValue> }), {
    file: "set.yaml",
  });
}
const TEMPLATE = {
  metadata: { name: "{{path.basename}}" },
  spec: {
    project: "default",
    source: { repoURL: URL, path: "{{path}}" },
    destination: { name: "in-cluster", namespace: "{{path.basename}}" },
  },
};
const LIMITS = { applications: 1000, patternSteps: 1_000_000 };
const TREE = {
  "apps/web/a.yaml": "x: 1\n",
  "apps/api/a.yaml": "x: 1\n",
  "apps/api/deep/b.yaml": "x: 1\n",
  "apps/.hidden/a.yaml": "x: 1\n",
  "system/argocd/a.yaml": "x: 1\n",
  ".github/w.yaml": "x: 1\n",
};
const gitDirs = (dirs: DataValue) => ({
  generators: [{ git: { repoURL: URL, revision: "main", directories: dirs } }],
  template: TEMPLATE,
});
const names = (docs: readonly DataValue[]) => docs.map((d) => (d as { metadata: { name: string } }).metadata.name);

describe("git directories generator (BR3.11)", () => {
  it("generates one Application per matching directory, hidden directories skipped, in the ApplicationSet's namespace", () => {
    const e = expandApplicationSet(appSet(gitDirs([{ path: "apps/*" }, { path: "system/*" }])), io(TREE), null, LIMITS);
    expect(e.mark).toBeNull();
    expect(names(e.documents)).toEqual(["api", "web", "argocd"]);
    expect(e.documents[0]).toEqual({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name: "api", namespace: "argocd" },
      spec: {
        project: "default",
        source: { repoURL: URL, path: "apps/api" },
        destination: { name: "in-cluster", namespace: "api" },
      },
    });
  });
  it("leaves out a directory any exclude entry matches, whatever the include entries", () => {
    const e = expandApplicationSet(
      appSet(gitDirs([{ path: "apps/*" }, { path: "apps/web", exclude: true }])),
      io(TREE),
      null,
      LIMITS,
    );
    expect(names(e.documents)).toEqual(["api"]);
  });
  it("gives path[n], basenameNormalized and pathParamPrefix as Argo CD does", () => {
    const spec = gitDirs([{ path: "apps/*" }]) as Record<string, DataValue>;
    spec.generators = [{ git: { repoURL: URL, directories: [{ path: "apps/*" }], pathParamPrefix: "p" } }];
    spec.template = { metadata: { name: "{{p.path.basenameNormalized}}-{{p.path[0]}}" }, spec: { x: "{{p.path}}" } };
    const e = expandApplicationSet(appSet(spec), io({ "apps/My_App/a.yaml": "x: 1\n" }), null, LIMITS);
    expect(e.documents[0]).toMatchObject({ metadata: { name: "my-app-apps" }, spec: { x: "apps/My_App" } });
  });
  it("is opaque unreadable-repo with the URL and the suggestion when the repository is not readable (AC3.3.2, M3)", () => {
    const suggestion = { url: "http://gitea-http.gitea:3000/ops/estate", readFrom: "." };
    const e = expandApplicationSet(
      appSet(gitDirs([{ path: "apps/*" }])),
      io(TREE, { outcome: "unreadable", root: null, via: "none", suggestion }),
      null,
      LIMITS,
    );
    expect(e.documents).toEqual([]);
    expect(e.mark).toMatchObject({
      reason: "unreadable-repo",
      field: "spec.generators[0].git.repoURL",
      value: URL,
      suggestion,
      lostEdges: ["Applications generated from its git generator"],
    });
  });
  it("names a fetch's own outcome: offline is offline, never absent", () => {
    const e = expandApplicationSet(
      appSet(gitDirs([{ path: "apps/*" }])),
      io(TREE, {
        outcome: "unreadable",
        root: null,
        via: "repos-fetch",
        suggestion: null,
        failure: { reason: "offline", detail: "not fetched under --no-network" },
      }),
      null,
      LIMITS,
    );
    expect(e.mark).toMatchObject({ reason: "offline", detail: "not fetched under --no-network" });
  });
  it("refuses character classes in a pattern by name (unsupported-field)", () => {
    const e = expandApplicationSet(appSet(gitDirs([{ path: "apps/[aw]*" }])), io(TREE), null, LIMITS);
    expect(e.mark).toMatchObject({ reason: "unsupported-field", field: "spec.generators[0].git.directories[0].path" });
  });
  it("stops at the pattern step budget with a counted limit", () => {
    const e = expandApplicationSet(appSet(gitDirs([{ path: "*/*" }])), io(TREE), null, {
      applications: 1000,
      patternSteps: 5,
    });
    expect(e.mark).toMatchObject({ reason: "limit", detail: "path matching over the limit (generatorPatternSteps)" });
  });
});

describe("git files generator", () => {
  const files = {
    "clusters/a/config.json": '{"cluster": {"name": "alpha", "zone": 1}}',
    "clusters/b/config.json": '[{"cluster": {"name": "beta"}}, {"cluster": {"name": "gamma"}}]',
    "clusters/c/config.yaml": "cluster: {name: delta}\n",
  };
  const spec = (pattern: string, mode: "fast" | "go" = "fast") => ({
    goTemplate: mode === "go",
    generators: [{ git: { repoURL: URL, files: [{ path: pattern }] } }],
    template:
      mode === "fast"
        ? {
            metadata: { name: "{{cluster.name}}" },
            spec: { dir: "{{path}}", file: "{{path.filename}}", z: "{{cluster.zone}}" },
          }
        : {
            metadata: { name: "{{.cluster.name}}" },
            spec: { dir: "{{.path.path}}", seg: "{{index .path.segments 1}}" },
          },
  });
  it("reads each matching file: an object is one set, a list one set per item, path params from its directory", () => {
    const e = expandApplicationSet(appSet(spec("clusters/*/config.json")), io(files), null, LIMITS);
    expect(e.mark).toBeNull();
    expect(names(e.documents)).toEqual(["alpha", "beta", "gamma"]);
    expect(e.documents[0]).toMatchObject({ spec: { dir: "clusters/a", file: "config.json", z: "1" } });
    // an unknown fasttemplate tag stays as written (Argo CD's own behaviour)
    expect(e.documents[1]).toMatchObject({ spec: { z: "{{cluster.zone}}" } });
  });
  it("matches with * across / and reads YAML too; Go templates see the nested object", () => {
    const e = expandApplicationSet(appSet(spec("clusters/*", "go")), io(files), null, LIMITS);
    expect(names(e.documents)).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(e.documents[3]).toMatchObject({ spec: { dir: "clusters/c", seg: "c" } });
  });
  it("is opaque when a matching file cannot be read, naming it", () => {
    const e = expandApplicationSet(
      appSet(spec("clusters/*")),
      io({ ...files, "clusters/d/x.json": "{" }),
      null,
      LIMITS,
    );
    expect(e.mark).toMatchObject({ reason: "unreadable-file", detail: "a file its pattern names could not be read" });
    expect(e.unreadable.map((u) => u.path)).toEqual(["clusters/d/x.json"]);
  });
});

describe("list generator (BR3.10)", () => {
  it("generates one Application per element with its parameters, values included", () => {
    const e = expandApplicationSet(
      appSet({
        generators: [{ list: { elements: [{ cluster: "a", values: { tier: "x" } }, { cluster: "b" }] } }],
        template: { metadata: { name: "app-{{cluster}}" }, spec: { t: "{{values.tier}}" } },
      }),
      io({}),
      null,
      LIMITS,
    );
    expect(names(e.documents)).toEqual(["app-a", "app-b"]);
    expect(e.documents[1]).toMatchObject({ spec: { t: "{{values.tier}}" } });
  });
  it("refuses a non-string element value without goTemplate (Argo CD refuses it too)", () => {
    const e = expandApplicationSet(
      appSet({ generators: [{ list: { elements: [{ n: 1 }] } }], template: TEMPLATE }),
      io({}),
      null,
      LIMITS,
    );
    expect(e.mark).toMatchObject({ reason: "unsupported-field", field: "spec.generators[0].list.elements[0].n" });
  });
  it("makes the ApplicationSet unsupported-template for a construct outside the supported list (BR3.12)", () => {
    const e = expandApplicationSet(
      appSet({
        goTemplate: true,
        generators: [{ list: { elements: [{ c: "a" }] } }],
        template: { metadata: { name: "{{ .c | upper }}" }, spec: {} },
      }),
      io({}),
      null,
      LIMITS,
    );
    expect(e.documents).toEqual([]);
    expect(e.mark).toMatchObject({
      reason: "unsupported-template",
      field: "spec.template.metadata.name",
      value: "{{ .c | upper }}",
    });
  });
  it("applies none when two Applications would share a name (Argo CD refuses the set)", () => {
    const e = expandApplicationSet(
      appSet({
        generators: [{ list: { elements: [{ c: "a" }, { c: "a" }] } }],
        template: { metadata: { name: "{{c}}" }, spec: {} },
      }),
      io({}),
      null,
      LIMITS,
    );
    expect(e.documents).toEqual([]);
    expect(e.mark).toMatchObject({ reason: "render-failed" });
  });
});

describe("clusters, matrix and merge (BR3.13)", () => {
  const clusters: ClusterDecl[] = [
    { name: "in-cluster", labels: { env: "prod" }, annotations: { base: "gitops/" }, keyPath: "clusters.in-cluster" },
    { name: "edge", labels: { env: "dev" }, annotations: {}, keyPath: "clusters.edge" },
  ];
  const set = (
    g: DataValue,
    template: DataValue = { metadata: { name: "{{name}}" }, spec: { p: "{{metadata.annotations.base}}" } },
  ) => appSet({ generators: [g], template });
  it("is cluster-inputs-missing without a clusters: block (AC3.3.4)", () => {
    const e = expandApplicationSet(set({ clusters: {} }), io({}), null, LIMITS);
    expect(e.mark).toMatchObject({ reason: "cluster-inputs-missing", field: "spec.generators[0].clusters" });
  });
  it("expands from the block with the selector, and names the entries it used", () => {
    const e = expandApplicationSet(
      set({ clusters: { selector: { matchLabels: { env: "prod" } } } }),
      io({}),
      clusters,
      LIMITS,
    );
    expect(names(e.documents)).toEqual(["in-cluster"]);
    expect(e.documents[0]).toMatchObject({ spec: { p: "gitops/" } });
    expect(e.clustersUsed).toEqual(["in-cluster"]);
  });
  it("is cluster-inputs-missing when the template needs a server URL the block does not give", () => {
    const e = expandApplicationSet(
      set(
        { clusters: { selector: { matchLabels: { env: "dev" } } } },
        { metadata: { name: "{{name}}" }, spec: { s: "{{server}}" } },
      ),
      io({}),
      clusters,
      LIMITS,
    );
    expect(e.documents).toEqual([]);
    expect(e.mark).toMatchObject({ reason: "cluster-inputs-missing", field: "spec.template.spec.s" });
  });
  it("crosses two children in a matrix, and refuses a second child that uses the first's parameters", () => {
    const m = expandApplicationSet(
      set(
        { matrix: { generators: [{ clusters: {} }, { list: { elements: [{ app: "x" }, { app: "y" }] } }] } },
        { metadata: { name: "{{name}}-{{app}}" }, spec: {} },
      ),
      io({}),
      clusters,
      LIMITS,
    );
    expect(names(m.documents)).toEqual(["in-cluster-x", "in-cluster-y", "edge-x", "edge-y"]);
    const t = expandApplicationSet(
      set({ matrix: { generators: [{ clusters: {} }, { list: { elements: [{ app: "{{name}}" }] } }] } }),
      io({}),
      clusters,
      LIMITS,
    );
    expect(t.mark).toMatchObject({ reason: "unsupported-template", field: "spec.generators[0].matrix.generators[1]" });
  });
  it("merges children on the merge keys, the later ones overriding", () => {
    const e = expandApplicationSet(
      set(
        {
          merge: {
            mergeKeys: ["name"],
            generators: [{ clusters: {} }, { list: { elements: [{ name: "edge", extra: "yes" }] } }],
          },
        },
        { metadata: { name: "{{name}}" }, spec: { extra: "{{extra}}" } },
      ),
      io({}),
      clusters,
      LIMITS,
    );
    expect(e.documents.map((d) => (d as { spec: { extra: string } }).spec.extra)).toEqual(["{{extra}}", "yes"]);
  });
  it("stops at the generated-Application limit, keeps the first ones and is opaque limit (AC3.3.5)", () => {
    const elements = Array.from({ length: 50 }, (_, i) => ({ n: `a${i}` }));
    const e = expandApplicationSet(
      appSet({ generators: [{ list: { elements } }], template: { metadata: { name: "{{n}}" }, spec: {} } }),
      io({}),
      null,
      { applications: 10, patternSteps: 1000 },
    );
    expect(e.documents).toHaveLength(10);
    expect(e.mark).toMatchObject({
      reason: "limit",
      lostEdges: ["Applications its generators would generate over the limit"],
    });
  });
  it("never builds a matrix product past the limit", () => {
    const big = Array.from({ length: 3000 }, (_, i) => ({ k: `v${i}` }));
    const big2 = Array.from({ length: 3000 }, (_, i) => ({ j: `w${i}` }));
    const t0 = performance.now();
    const e = expandApplicationSet(
      appSet({
        generators: [{ matrix: { generators: [{ list: { elements: big } }, { list: { elements: big2 } }] } }],
        template: { metadata: { name: "{{k}}-{{j}}" }, spec: {} },
      }),
      io({}),
      null,
      { applications: 100, patternSteps: 1000 },
    );
    expect(e.documents).toHaveLength(100);
    expect(e.mark?.reason).toBe("limit");
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe("what is never expanded", () => {
  it("names generators that read a live service, templatePatch, per-generator templates and unknown fields", () => {
    const cases: [DataValue, string, string][] = [
      [
        { generators: [{ pullRequest: {} }], template: TEMPLATE },
        "unsupported-field",
        "spec.generators[0].pullRequest",
      ],
      [{ generators: [{ plugin: {} }], template: TEMPLATE }, "unsupported-field", "spec.generators[0].plugin"],
      [
        { generators: [{ list: { elements: [] } }], template: TEMPLATE, templatePatch: "x" },
        "unsupported-template",
        "spec.templatePatch",
      ],
      [
        { generators: [{ list: { elements: [], template: {} } }], template: TEMPLATE },
        "unsupported-field",
        "spec.generators[0].list.template",
      ],
      [{ generators: [{ list: { elements: [] } }], template: TEMPLATE, other: 1 }, "unsupported-field", "spec.other"],
      [
        { generators: [{ list: { elements: [] }, selector: {} }], template: TEMPLATE },
        "unsupported-field",
        "spec.generators[0].selector",
      ],
    ];
    for (const [spec, reason, field] of cases) {
      const e = expandApplicationSet(appSet(spec as object), io({}), null, LIMITS);
      expect(e.mark, field).toMatchObject({ reason, field });
    }
  });
  it("keeps the Applications of the generators it could expand, with one mark for the first that it could not", () => {
    const e = expandApplicationSet(
      appSet({
        generators: [{ clusters: {} }, { list: { elements: [{ path: "x", "path.basename": "x" }] } }],
        template: TEMPLATE,
      }),
      io({}),
      null,
      LIMITS,
    );
    expect(names(e.documents)).toEqual(["x"]);
    expect(e.mark?.reason).toBe("cluster-inputs-missing");
  });
});

describe("each refusal names its field (a table: change the input, the mark changes)", () => {
  const git = (extra: Record<string, DataValue>) => ({
    generators: [{ git: { repoURL: URL, ...extra } }],
    template: TEMPLATE,
  });
  const cases: [string, object, string, string][] = [
    ["generators not a list", { generators: 1, template: TEMPLATE }, "unsupported-field", "spec.generators"],
    [
      "goTemplate not a boolean",
      { goTemplate: "yes", generators: [], template: TEMPLATE },
      "unsupported-field",
      "spec.goTemplate",
    ],
    [
      "goTemplateOptions",
      { goTemplateOptions: [1], generators: [], template: TEMPLATE },
      "unsupported-field",
      "spec.goTemplateOptions",
    ],
    [
      "template metadata key",
      { generators: [{ list: { elements: [] } }], template: { metadata: { owner: "x" }, spec: {} } },
      "unsupported-field",
      "spec.template.metadata.owner",
    ],
    [
      "template metadata not a map",
      { generators: [{ list: { elements: [] } }], template: { metadata: 1, spec: {} } },
      "unsupported-field",
      "spec.template.metadata",
    ],
    [
      "two generator kinds",
      { generators: [{ list: { elements: [] }, git: {} }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0]",
    ],
    [
      "unknown generator",
      { generators: [{ magic: {} }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].magic",
    ],
    [
      "generator not a map",
      { generators: [{ list: 1 }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].list",
    ],
    ["git field", git({ directories: [{ path: "a" }], depth: 1 }), "unsupported-field", "spec.generators[0].git.depth"],
    [
      "git no repoURL",
      { generators: [{ git: { directories: [{ path: "a" }] } }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].git.repoURL",
    ],
    [
      "git prefix",
      git({ directories: [{ path: "a" }], pathParamPrefix: 1 }),
      "unsupported-field",
      "spec.generators[0].git.pathParamPrefix",
    ],
    [
      "git values",
      git({ directories: [{ path: "a" }], values: { a: 1 } }),
      "unsupported-field",
      "spec.generators[0].git.values",
    ],
    ["git directories", git({ directories: "a" }), "unsupported-field", "spec.generators[0].git.directories"],
    ["git files", git({ files: "a" }), "unsupported-field", "spec.generators[0].git.files"],
    ["git neither", git({}), "unsupported-field", "spec.generators[0].git"],
    ["git entry", git({ directories: ["a"] }), "unsupported-field", "spec.generators[0].git.directories[0]"],
    [
      "git entry key",
      git({ directories: [{ path: "a", depth: 1 }] }),
      "unsupported-field",
      "spec.generators[0].git.directories[0].depth",
    ],
    [
      "git exclude",
      git({ directories: [{ path: "a", exclude: "yes" }] }),
      "unsupported-field",
      "spec.generators[0].git.directories[0].exclude",
    ],
    [
      "git pathspec magic",
      git({ files: [{ path: ":(glob)**" }] }),
      "unsupported-field",
      "spec.generators[0].git.files[0].path",
    ],
    [
      "list elements",
      { generators: [{ list: { elements: 1 } }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].list.elements",
    ],
    [
      "list element",
      { generators: [{ list: { elements: [1] } }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].list.elements[0]",
    ],
    [
      "list values",
      { generators: [{ list: { elements: [{ values: { a: 1 } }] } }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].list.elements[0].values",
    ],
    [
      "list elementsYaml",
      { generators: [{ list: { elementsYaml: "- a: b" } }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].list.elementsYaml",
    ],
    [
      "clusters flatList",
      { generators: [{ clusters: { flatList: true } }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].clusters.flatList",
    ],
    [
      "matrix one child",
      { generators: [{ matrix: { generators: [{ list: { elements: [] } }] } }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].matrix.generators",
    ],
    [
      "matrix nested",
      { generators: [{ matrix: { generators: [{ matrix: {} }, { list: { elements: [] } }] } }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].matrix.generators[0].matrix",
    ],
    [
      "matrix empty child",
      {
        generators: [{ matrix: { generators: [{ list: { elements: [] } }, { list: { elements: [] } }] } }],
        template: TEMPLATE,
      },
      "unsupported-field",
      "spec.generators[0].matrix.generators[0]",
    ],
    [
      "matrix conflict",
      {
        generators: [
          { matrix: { generators: [{ list: { elements: [{ a: "1" }] } }, { list: { elements: [{ a: "2" }] } }] } },
        ],
        template: TEMPLATE,
      },
      "unsupported-field",
      "spec.generators[0].matrix.generators",
    ],
    [
      "merge keys",
      {
        generators: [{ merge: { generators: [{ list: { elements: [] } }, { list: { elements: [] } }] } }],
        template: TEMPLATE,
      },
      "unsupported-field",
      "spec.generators[0].merge.mergeKeys",
    ],
    [
      "merge duplicate",
      {
        generators: [
          {
            merge: {
              mergeKeys: ["a"],
              generators: [{ list: { elements: [{ a: "1" }, { a: "1" }] } }, { list: { elements: [] } }],
            },
          },
        ],
        template: TEMPLATE,
      },
      "unsupported-field",
      "spec.generators[0].merge.generators[0]",
    ],
    [
      "merge one child",
      { generators: [{ merge: { mergeKeys: ["a"], generators: [{ list: { elements: [] } }] } }], template: TEMPLATE },
      "unsupported-field",
      "spec.generators[0].merge.generators",
    ],
    [
      "values unterminated",
      {
        generators: [{ git: { repoURL: URL, directories: [{ path: "apps/*" }], values: { v: "{{path}} {{x" } } }],
        template: TEMPLATE,
      },
      "unsupported-template",
      "spec.generators[0].git.values.v",
    ],
  ];
  for (const [name, spec, reason, field] of cases) {
    it(name, () => {
      const e = expandApplicationSet(appSet(spec), io(TREE), [], LIMITS);
      expect(e.mark).toMatchObject({ reason, field });
    });
  }
});

describe("selectors, values and Go-mode clusters", () => {
  const clusters: ClusterDecl[] = [
    {
      name: "a",
      labels: { env: "prod", tier: "1" },
      annotations: { "argocd.argoproj.io/refresh": "x", base: "b/" },
      keyPath: "clusters.a",
    },
    { name: "b", labels: { env: "dev" }, annotations: {}, keyPath: "clusters.b" },
  ];
  const run = (selector: DataValue, mode: "fast" | "go" = "fast", values?: Record<string, string>) =>
    expandApplicationSet(
      appSet({
        goTemplate: mode === "go",
        generators: [{ clusters: { selector, ...(values === undefined ? {} : { values }) } }],
        template:
          mode === "go"
            ? { metadata: { name: "{{.name}}" }, spec: { base: "{{.metadata.annotations.base}}", v: "{{.values.v}}" } }
            : {
                metadata: { name: "{{name}}" },
                spec: { v: "{{values.v}}", r: "{{metadata.annotations.argocd.argoproj.io/refresh}}" },
              },
      }),
      io({}),
      clusters,
      LIMITS,
    );
  it("applies In, NotIn, Exists and DoesNotExist", () => {
    expect(names(run({ matchExpressions: [{ key: "env", operator: "In", values: ["prod"] }] }).documents)).toEqual([
      "a",
    ]);
    expect(names(run({ matchExpressions: [{ key: "env", operator: "NotIn", values: ["prod"] }] }).documents)).toEqual([
      "b",
    ]);
    expect(names(run({ matchExpressions: [{ key: "tier", operator: "Exists" }] }).documents)).toEqual(["a"]);
    expect(names(run({ matchExpressions: [{ key: "tier", operator: "DoesNotExist" }] }).documents)).toEqual(["b"]);
    expect(run({ matchExpressions: [{ key: "x", operator: "Gt" }] }).mark?.field).toBe(
      "spec.generators[0].clusters.selector.matchExpressions[0].operator",
    );
    expect(run({ matchLabels: { env: 1 } }).mark?.field).toBe("spec.generators[0].clusters.selector.matchLabels");
    expect(run(1).mark?.field).toBe("spec.generators[0].clusters.selector");
  });
  it("adds the local cluster last only without a selector and without an entry for it", () => {
    expect(names(run({}).documents)).toEqual(["a", "b", "in-cluster"]);
  });
  it("templates values with the set's own parameters, and never exposes Argo CD's own annotations", () => {
    const fast = run({ matchLabels: { env: "prod" } }, "fast", { v: "{{name}}-x" });
    expect(fast.documents[0]).toMatchObject({
      spec: { v: "a-x", r: "{{metadata.annotations.argocd.argoproj.io/refresh}}" },
    });
    const go = run({ matchLabels: { env: "prod" } }, "go", { v: "{{.name}}-y" });
    expect(go.documents[0]).toMatchObject({ metadata: { name: "a" }, spec: { base: "b/", v: "a-y" } });
  });
  it("merges in Go mode deeply, the later generator winning", () => {
    const e = expandApplicationSet(
      appSet({
        goTemplate: true,
        generators: [
          {
            merge: {
              mergeKeys: ["name"],
              generators: [
                { list: { elements: [{ name: "a", m: { x: "1", y: "1" } }] } },
                { list: { elements: [{ name: "a", m: { y: "2" } }] } },
              ],
            },
          },
        ],
        template: { metadata: { name: "{{.name}}" }, spec: { x: "{{.m.x}}", y: "{{.m.y}}" } },
      }),
      io({}),
      null,
      LIMITS,
    );
    expect(e.documents[0]).toMatchObject({ spec: { x: "1", y: "2" } });
  });
  it("crosses in Go mode with the first child's parameters winning", () => {
    const e = expandApplicationSet(
      appSet({
        goTemplate: true,
        generators: [
          {
            matrix: {
              generators: [
                { list: { elements: [{ n: "a", k: "first" }] } },
                { list: { elements: [{ k: "second", j: "x" }] } },
              ],
            },
          },
        ],
        template: { metadata: { name: "{{.n}}" }, spec: { k: "{{.k}}", j: "{{.j}}" } },
      }),
      io({}),
      null,
      LIMITS,
    );
    expect(e.documents[0]).toMatchObject({ spec: { k: "first", j: "x" } });
  });
});
