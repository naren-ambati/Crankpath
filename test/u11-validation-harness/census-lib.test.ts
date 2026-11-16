import { describe, expect, it } from "vitest";
import {
  againstOneThird,
  censusJson,
  classifyEstate,
  fraction,
  isOwnRepo,
  LABEL,
  normaliseRepoUrl,
  REASON_ORDER,
  substitute,
} from "../../scripts/census-lib.mjs";
import { parseYamlBounded } from "../../src/u2-intake-config/bounded-reader.js";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

const OWN = "https://github.com/acme/estate";

type Files = Record<string, string>;

function docs(text: string) {
  const r = parseYamlBounded(text);
  if (!r.ok) throw new Error(`fixture did not parse: ${r.refusal}`);
  return r.documents;
}

function run(files: Files, dirs: string[] = [], unreadable: string[] = []) {
  const list = Object.entries(files).map(([path, text]) => ({ path, documents: docs(text) }));
  const known = new Set([...dirs]);
  for (const p of [...Object.keys(files), ...unreadable]) {
    const parts = p.split("/").slice(0, -1);
    for (let i = 0; i <= parts.length; i++) known.add(parts.slice(0, i).join("/"));
  }
  return classifyEstate({ ownUrl: OWN, files: list, pathExists: (p: string) => known.has(p), unreadable });
}

function only(files: Files, dirs: string[] = [], unreadable: string[] = []) {
  const r = run(files, dirs, unreadable);
  expect(r.total).toBe(1);
  const s = r.sources[0];
  if (s === undefined) throw new Error("no source");
  return s.reason;
}

const app = (source: string) => `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata: {name: a, namespace: argocd}
spec:
  destination: {server: https://kubernetes.default.svc}
${source}`;

const ownSource = `  source: {repoURL: ${OWN}.git, path: apps/x, targetRevision: main}`;

const hr = (extra: string, ref = "{kind: HelmRepository, name: repo}") => `apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata: {name: r, namespace: apps}
spec:
  chart:
    spec: {chart: c, sourceRef: ${ref}}
${extra}`;

const helmRepo = (spec: string) => `apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata: {name: repo, namespace: apps}
spec: ${spec}`;

describe("census: repository identity (FR2.3)", () => {
  it.each([
    ["https://github.com/acme/estate", true],
    ["https://github.com/acme/estate.git", true],
    ["https://GitHub.com/acme/estate/", true],
    ["https://user:token@github.com/acme/estate", true],
    ["git@github.com:acme/estate.git", true],
    ["ssh://git@github.com:22/acme/estate", true],
    ["https://github.com:443/acme/estate", true],
    ["https://github.com/acme/Estate", false],
    ["https://github.com/acme/estate-fork", false],
    ["https://github.com/acme/estate/sub", false],
    ["https://github.com.evil.example/acme/estate", false],
    ["https://github.com:8443/acme/estate", false],
    ["http://gitea-http.gitea:3000/acme/estate", false],
    ["file:///acme/estate", false],
    ["", false],
  ])("%s is the estate's own repository: %s", (url, same) => {
    expect(isOwnRepo(url, OWN)).toBe(same);
  });

  it("refuses unparseable forms", () => {
    expect(normaliseRepoUrl("not a url")).toBeUndefined();
    expect(normaliseRepoUrl("https://github.com/")).toBeUndefined();
  });
});

describe("census: one table row per opacity rule, and each rule can fail", () => {
  const cases: { rule: string; opaque: Files; clear: Files; dirs?: string[] }[] = [
    {
      rule: "unsupported-template",
      opaque: { "a.yaml": app(`  source: {repoURL: "{{ .Values.repo }}", path: apps/x}`) },
      clear: { "a.yaml": app(ownSource) },
      dirs: ["apps/x"],
    },
    {
      rule: "unsupported-field",
      opaque: { "a.yaml": app(`  source: {repoURL: ${OWN}, path: apps/x, plugin: {name: p}}`) },
      clear: { "a.yaml": app(`  source: {repoURL: ${OWN}, path: apps/x}`) },
      dirs: ["apps/x"],
    },
    {
      rule: "unreadable-repo",
      opaque: { "a.yaml": app("  source: {repoURL: https://github.com/acme/other, path: apps/x}") },
      clear: { "a.yaml": app(ownSource) },
      dirs: ["apps/x"],
    },
    {
      rule: "private-chart",
      opaque: {
        "a.yaml": app("  source: {repoURL: https://charts.example.org/private, chart: c, targetRevision: 1.0.0}"),
        "s.yaml": `apiVersion: v1
kind: Secret
metadata: {name: s, labels: {argocd.argoproj.io/secret-type: repository}}
stringData: {url: https://charts.example.org/private, password: x}`,
      },
      clear: {
        "a.yaml": app("  source: {repoURL: https://charts.example.org/public, chart: c, targetRevision: 1.0.0}"),
        "s.yaml": `apiVersion: v1
kind: Secret
metadata: {name: s, labels: {argocd.argoproj.io/secret-type: repository}}
stringData: {url: https://charts.example.org/private, password: x}`,
      },
    },
    {
      rule: "remote-base",
      opaque: {
        "a.yaml": app(ownSource),
        "apps/x/kustomization.yaml": "resources: [https://github.com/acme/other//base?ref=v1]\n",
      },
      clear: {
        "a.yaml": app(ownSource),
        "apps/x/kustomization.yaml": "resources: [deploy.yaml]\n",
        "apps/x/deploy.yaml": "kind: ConfigMap\n",
      },
    },
    {
      rule: "encrypted-values",
      opaque: {
        "hr.yaml": hr("  valuesFrom: [{kind: Secret, name: vals}]"),
        "repo.yaml": helmRepo("{url: https://charts.example.org}"),
        "s.yaml":
          "apiVersion: v1\nkind: Secret\nmetadata: {name: vals, namespace: apps}\ndata: {v: ENC}\nsops: {version: 3}\n",
      },
      clear: {
        "hr.yaml": hr("  valuesFrom: [{kind: Secret, name: vals}]"),
        "repo.yaml": helmRepo("{url: https://charts.example.org}"),
        "s.yaml": "apiVersion: v1\nkind: Secret\nmetadata: {name: vals, namespace: apps}\nstringData: {v: plain}\n",
      },
    },
    {
      rule: "cluster-created-values",
      opaque: {
        "hr.yaml": hr("  valuesFrom: [{kind: ConfigMap, name: made-elsewhere}]"),
        "repo.yaml": helmRepo("{url: https://charts.example.org}"),
      },
      clear: {
        "hr.yaml": hr("  valuesFrom: [{kind: ConfigMap, name: made-elsewhere}]"),
        "repo.yaml": helmRepo("{url: https://charts.example.org}"),
        "k/kustomization.yaml": "configMapGenerator: [{name: made-elsewhere, files: [v.yaml]}]\n",
      },
    },
    {
      rule: "unreadable-file",
      opaque: { "a.yaml": app(ownSource) },
      clear: { "a.yaml": app(ownSource) },
      dirs: [],
    },
  ];

  for (const c of cases) {
    it(`${c.rule}: fires on its trigger and not without it`, () => {
      expect(only(c.opaque, c.rule === "unreadable-file" ? [] : (c.dirs ?? []))).toBe(c.rule);
      expect(only(c.clear, c.rule === "unreadable-file" ? ["apps/x"] : (c.dirs ?? ["apps/x"]))).toBeNull();
    });
  }

  it("cluster-inputs-missing: a clusters, matrix or merge generator, once each; a list does not fire it", () => {
    const set = (gens: string) => `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata: {name: s}
spec:
  generators: ${gens}
  template:
    spec:
      source: {repoURL: "{{metadata.annotations.addons_repo_url}}", path: "{{name}}"}
`;
    const r = run({ "s.yaml": set("[{clusters: {}}, {matrix: {generators: []}}, {merge: {}}]") });
    expect(r.sources.map((s) => s.reason)).toEqual([
      "cluster-inputs-missing",
      "cluster-inputs-missing",
      "cluster-inputs-missing",
    ]);
    expect(r.atLeast).toBe(true);
    const listed = run({ "s.yaml": set("[{list: {elements: [{name: apps/x}]}}]") });
    expect(listed.sources.map((s) => s.reason)).toEqual(["unsupported-template"]);
    expect(listed.atLeast).toBe(false);
  });

  it("the rule order picks exactly one reason, the first that applies", () => {
    const r = only(
      { "a.yaml": app("  source: {repoURL: https://github.com/acme/other, path: x, helm: {parameters: [{name: a}]}}") },
      ["x"],
    );
    expect(r).toBe("unsupported-field");
    expect(REASON_ORDER.indexOf("unsupported-field")).toBeLessThan(REASON_ORDER.indexOf("unreadable-repo"));
  });
});

describe("census: Argo CD details", () => {
  it("multi-source $values: readable when the ref source is the estate's own, opaque otherwise", () => {
    const multi = (refUrl: string) =>
      app(`  sources:
    - {repoURL: https://charts.example.org, chart: c, targetRevision: 1.0.0, helm: {valueFiles: [$values/v.yaml]}}
    - {repoURL: ${refUrl}, targetRevision: main, ref: values}`);
    expect(only({ "a.yaml": multi(OWN), "v.yaml": "a: 1\n" })).toBeNull();
    expect(only({ "a.yaml": multi(OWN) })).toBe("unreadable-file");
    expect(only({ "a.yaml": multi("https://github.com/acme/values") })).toBe("unreadable-repo");
    const noRef = app(`  sources:
    - {repoURL: https://charts.example.org, chart: c, helm: {valueFiles: [$other/v.yaml]}}`);
    expect(only({ "a.yaml": noRef })).toBe("unsupported-field");
  });

  it.each([
    "http://charts.example.org",
    "https://127.0.0.1/charts",
    "https://localhost/charts",
    "https://[::1]/charts",
    "https://169.254.169.254/x",
    "registry.example.org/charts",
  ])("refuses the chart repository %s", (url) => {
    expect(only({ "a.yaml": app(`  source: {repoURL: "${url}", chart: c, targetRevision: 1.0.0}`) })).toBe(
      "unsupported-field",
    );
  });

  it("accepts an oci:// chart repository without credentials", () => {
    expect(only({ "a.yaml": app("  source: {repoURL: oci://ghcr.io/acme/charts, chart: c}") })).toBeNull();
  });

  it("repo-creds match by path-segment prefix, not by string prefix", () => {
    const creds = (url: string) => `apiVersion: v1
kind: Secret
metadata: {name: s, labels: {argocd.argoproj.io/secret-type: repo-creds}}
data: {url: ${Buffer.from(url).toString("base64")}}`;
    const a = app("  source: {repoURL: https://charts.example.org/team/c, chart: c}");
    expect(only({ "a.yaml": a, "s.yaml": creds("https://charts.example.org/team") })).toBe("private-chart");
    expect(only({ "a.yaml": a, "s.yaml": creds("https://charts.example.org/te") })).toBeNull();
  });

  it("an ExternalSecret that templates a repository credential with a literal url counts", () => {
    const es = `apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata: {name: e}
spec:
  target:
    template:
      metadata: {labels: {argocd.argoproj.io/secret-type: repository}}
      data: {url: https://charts.example.org/p}`;
    expect(only({ "a.yaml": app("  source: {repoURL: https://charts.example.org/p, chart: c}"), "e.yaml": es })).toBe(
      "private-chart",
    );
  });

  it("SOPS documents in the source path and kustomize plugins are opaque", () => {
    expect(only({ "a.yaml": app(ownSource), "apps/x/s.yaml": "kind: Secret\nsops: {version: 3}\n" })).toBe(
      "encrypted-values",
    );
    expect(only({ "a.yaml": app(ownSource), "apps/x/kustomization.yaml": "generators: [ksops.yaml]\n" })).toBe(
      "unsupported-field",
    );
  });

  it("directory.jsonnet, include and exclude are unsupported fields", () => {
    for (const k of ["jsonnet: {}", "include: '*.yaml'", "exclude: x"]) {
      expect(only({ "a.yaml": app(`  source: {repoURL: ${OWN}, path: apps/x, directory: {${k}}}`) }, ["apps/x"])).toBe(
        "unsupported-field",
      );
    }
  });

  it("counts only argoproj.io Applications and an Application with no source is opaque", () => {
    expect(run({ "a.yaml": "apiVersion: app.k8s.io/v1beta1\nkind: Application\nmetadata: {name: x}\n" }).total).toBe(0);
    expect(only({ "a.yaml": app("") })).toBe("unsupported-field");
  });
});

describe("census: ApplicationSets", () => {
  const set = (gens: string, source: string) => `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata: {name: s}
spec:
  generators: ${gens}
  template:
    spec:
      source: ${source}
`;

  it("a list generator counts once per element and substitutes element values", () => {
    const r = run(
      {
        "s.yaml": set(
          "[{list: {elements: [{name: x, url: 'https://github.com/acme/estate'}, {name: y, url: 'https://github.com/acme/other'}]}}]",
          '{repoURL: "{{url}}", path: "apps/{{ .name }}"}',
        ),
      },
      ["apps/x", "apps/y"],
    );
    expect(r.total).toBe(2);
    expect(r.sources.map((s) => s.reason)).toEqual([null, "unreadable-repo"]);
    expect(r.atLeast).toBe(false);
  });

  it("elementsYaml is counted once as unsupported-template", () => {
    const r = run({ "s.yaml": set("[{list: {elementsYaml: '{{ .x }}'}}]", `{repoURL: ${OWN}, path: x}`) });
    expect(r.sources.map((s) => s.reason)).toEqual(["unsupported-template"]);
    expect(r.atLeast).toBe(true);
  });

  it("a git generator counts once; its own parameters resolve, a templated repoURL does not", () => {
    const gitGen = (url: string) => `[{git: {repoURL: ${url}, revision: HEAD, directories: [{path: apps/*}]}}]`;
    const ok = run({ "s.yaml": set(gitGen(OWN), `{repoURL: ${OWN}, path: "{{path}}", targetRevision: HEAD}`) });
    expect(ok.sources.map((s) => s.reason)).toEqual([null]);
    expect(ok.atLeast).toBe(true);
    const foreign = run({
      "s.yaml": set(gitGen("https://github.com/acme/other"), `{repoURL: ${OWN}, path: "{{path}}"}`),
    });
    expect(foreign.sources.map((s) => s.reason)).toEqual(["unreadable-repo"]);
    const tmplRepo = run({ "s.yaml": set(gitGen(OWN), '{repoURL: "{{path.basename}}", path: "{{path}}"}') });
    expect(tmplRepo.sources.map((s) => s.reason)).toEqual(["unsupported-template"]);
    const other = run({ "s.yaml": set(gitGen(OWN), `{repoURL: ${OWN}, path: "{{ .values.x }}"}`) });
    expect(other.sources.map((s) => s.reason)).toEqual(["unsupported-template"]);
  });

  it("scmProvider, pullRequest, plugin and unknown generators are unsupported fields", () => {
    const r = run({
      "s.yaml": set(
        "[{scmProvider: {}}, {pullRequest: {}}, {plugin: {}}, {clusterDecisionResource: {}}, {weird: {}}]",
        `{repoURL: ${OWN}, path: x}`,
      ),
    });
    expect(r.sources.map((s) => s.reason)).toEqual(Array(5).fill("unsupported-field"));
  });
});

describe("census: Flux HelmReleases", () => {
  const repo = helmRepo("{url: https://charts.example.org}");

  it("a HelmRelease whose HelmRepository is defined and public is not opaque", () => {
    expect(only({ "hr.yaml": hr(""), "repo.yaml": repo })).toBeNull();
  });

  it("an undefined chart source, a foreign GitRepository, a Bucket are opaque", () => {
    expect(only({ "hr.yaml": hr("") })).toBe("unreadable-repo");
    const git = (url: string) =>
      `apiVersion: source.toolkit.fluxcd.io/v1\nkind: GitRepository\nmetadata: {name: g, namespace: apps}\nspec: {url: ${url}}\n`;
    expect(only({ "hr.yaml": hr("", "{kind: GitRepository, name: g}"), "g.yaml": git(OWN) }, ["c"])).toBeNull();
    expect(only({ "hr.yaml": hr("", "{kind: GitRepository, name: g}"), "g.yaml": git(OWN) })).toBe("unreadable-file");
    expect(
      only({ "hr.yaml": hr("", "{kind: GitRepository, name: g}"), "g.yaml": git("https://github.com/acme/x") }),
    ).toBe("unreadable-repo");
    expect(only({ "hr.yaml": hr("", "{kind: Bucket, name: b}") })).toBe("unsupported-field");
  });

  it("a HelmRepository with a secretRef is a private chart; plain http is refused", () => {
    expect(
      only({ "hr.yaml": hr(""), "repo.yaml": helmRepo("{url: https://c.example.org, secretRef: {name: s}}") }),
    ).toBe("private-chart");
    expect(only({ "hr.yaml": hr(""), "repo.yaml": helmRepo("{url: http://c.example.org}") })).toBe("unsupported-field");
  });

  it("namespaces must agree when both are known", () => {
    const elsewhere = helmRepo("{url: https://charts.example.org}").replace("namespace: apps", "namespace: other");
    expect(only({ "hr.yaml": hr(""), "repo.yaml": elsewhere })).toBe("unreadable-repo");
  });

  it("chartRef to a HelmChart resolves one hop", () => {
    const chart = `apiVersion: source.toolkit.fluxcd.io/v1\nkind: HelmChart\nmetadata: {name: hc, namespace: apps}\nspec: {sourceRef: {kind: HelmRepository, name: repo}}\n`;
    const release = `apiVersion: helm.toolkit.fluxcd.io/v2\nkind: HelmRelease\nmetadata: {name: r, namespace: apps}\nspec: {chartRef: {kind: HelmChart, name: hc}}\n`;
    expect(only({ "hr.yaml": release, "c.yaml": chart, "repo.yaml": repo })).toBeNull();
    expect(only({ "hr.yaml": release, "c.yaml": chart })).toBe("unreadable-repo");
  });

  it("Flux variables under a Kustomization whose substituteFrom is a SOPS Secret are encrypted-values", () => {
    const ks = (from: string) => `apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata: {name: apps, namespace: flux-system}
spec:
  path: ./apps
  postBuild:
    substituteFrom: [${from}]
`;
    const sopsSecret =
      "apiVersion: v1\nkind: Secret\nmetadata: {name: cluster-secrets, namespace: flux-system}\nsops: {v: 3}\n";
    // a Flux variable, written with the dollar sign joined at run time
    const withVar = hr(`  values: {host: '${"$"}{DOMAIN}'}`);
    const base = {
      "repo.yaml": repo,
      "flux/ks.yaml": ks("{kind: Secret, name: cluster-secrets}"),
      "flux/s.yaml": sopsSecret,
    };
    expect(only({ ...base, "apps/hr.yaml": withVar })).toBe("encrypted-values");
    expect(only({ ...base, "apps/hr.yaml": hr("  values: {host: example.org}") })).toBeNull();
    expect(only({ ...base, "other/hr.yaml": withVar })).toBe("unsupported-template");
    const missing = { "repo.yaml": repo, "flux/ks.yaml": ks("{kind: ConfigMap, name: vars}") };
    expect(only({ ...missing, "apps/hr.yaml": withVar })).toBe("cluster-created-values");
  });

  it("an ExternalSecret-made values Secret is cluster-created", () => {
    const es =
      "apiVersion: external-secrets.io/v1\nkind: ExternalSecret\nmetadata: {name: vals}\nspec: {target: {name: vals}}\n";
    expect(only({ "hr.yaml": hr("  valuesFrom: [{kind: Secret, name: vals}]"), "repo.yaml": repo, "e.yaml": es })).toBe(
      "cluster-created-values",
    );
  });
});

describe("census: cases the B0 review reproduced, each now opaque (unknown is opaque)", () => {
  const repo = helmRepo("{url: https://charts.example.org}");
  const fluxKs = (spec: string) =>
    `apiVersion: kustomize.toolkit.fluxcd.io/v1\nkind: Kustomization\nmetadata: {name: k, namespace: flux-system}\nspec: ${spec}\n`;
  const withVar = hr(`  values: {host: '${"$"}{DOMAIN}'}`);

  it("(a) Flux variables with no Kustomization, or with one that has no postBuild", () => {
    expect(only({ "repo.yaml": repo, "hr.yaml": withVar })).toBe("unsupported-template");
    expect(only({ "repo.yaml": repo, "hr.yaml": withVar, "ks.yaml": fluxKs("{path: .}") })).toBe(
      "unsupported-template",
    );
    // a covering Kustomization substituting from a ConfigMap the repository defines makes it readable
    const cm =
      "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: vars, namespace: flux-system}\ndata: {DOMAIN: example.org}\n";
    const ks = fluxKs("{path: ., postBuild: {substituteFrom: [{kind: ConfigMap, name: vars}]}}");
    expect(only({ "repo.yaml": repo, "hr.yaml": withVar, "ks.yaml": ks, "cm.yaml": cm })).toBeNull();
  });

  it("(b) a remote base reached through a local base is found, to any depth", () => {
    const files = {
      "a.yaml": app(`  source: {repoURL: ${OWN}, path: app}`),
      "app/kustomization.yaml": "resources: [../base]\n",
      "base/kustomization.yaml": "resources: [../deeper]\n",
      "deeper/kustomization.yaml": "resources: ['github.com/x/y//z?ref=v1']\n",
    };
    expect(only(files)).toBe("remote-base");
    expect(
      only({ ...files, "deeper/kustomization.yaml": "resources: [cm.yaml]\n", "deeper/cm.yaml": "kind: X\n" }),
    ).toBeNull();
    expect(only({ ...files, "app/kustomization.yaml": "resources: [../../outside]\n" })).toBe("unreadable-file");
  });

  it("(c) a SOPS document in a sub-directory of the source path, and an unreadable file there", () => {
    const a = { "a.yaml": app(`  source: {repoURL: ${OWN}, path: app}`) };
    expect(only({ ...a, "app/sub/s.yaml": "kind: Secret\nsops: {version: 3}\n" })).toBe("encrypted-values");
    expect(only({ ...a, "app/ok.yaml": "kind: X\n" }, [], ["app/sub/broken.yaml"])).toBe("unreadable-file");
    expect(
      only({ ...a, "app/ok.yaml": "kind: X\n", "app/Chart.yaml": "name: c\n" }, [], ["app/templates/t.yaml"]),
    ).toBeNull();
  });

  it("(d) helm.valueFiles: missing, unreadable, SOPS-encrypted, a URL, or inside a remote chart", () => {
    const own = (vf: string) => app(`  source: {repoURL: ${OWN}, path: app, helm: {valueFiles: [${vf}]}}`);
    const chart = { "app/Chart.yaml": "name: c\n" };
    expect(only({ "a.yaml": own("secrets.enc.yaml"), ...chart })).toBe("unreadable-file");
    expect(only({ "a.yaml": own("v.yaml"), ...chart, "app/v.yaml": "a: 1\n" })).toBeNull();
    expect(only({ "a.yaml": own("../shared/v.yaml"), ...chart, "shared/v.yaml": "a: 1\n" })).toBeNull();
    expect(only({ "a.yaml": own("s.yaml"), ...chart, "app/s.yaml": "a: ENC\nsops: {v: 3}\n" })).toBe(
      "encrypted-values",
    );
    expect(only({ "a.yaml": own("v.yaml"), ...chart }, [], ["app/v.yaml"])).toBe("unreadable-file");
    expect(only({ "a.yaml": own("'https://example.org/v.yaml'"), ...chart })).toBe("unsupported-field");
    const remote = app(
      "  source: {repoURL: https://charts.example.org, chart: c, helm: {valueFiles: [values-prod.yaml]}}",
    );
    expect(only({ "a.yaml": remote })).toBe("unreadable-file");
  });

  it("(e) an ApplicationSet templatePatch or a generator-level template", () => {
    const set = (extra: string, gen: string) => `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata: {name: s}
spec:
  generators: [${gen}]
${extra}  template:
    spec:
      source: {repoURL: ${OWN}, path: "{{path}}"}
`;
    const git = `{git: {repoURL: ${OWN}, directories: [{path: 'x/*'}]}}`;
    expect(run({ "s.yaml": set("", git) }).sources.map((x) => x.reason)).toEqual([null]);
    expect(run({ "s.yaml": set("  templatePatch: 'spec: {}'\n", git) }).sources.map((x) => x.reason)).toEqual([
      "unsupported-template",
    ]);
    const genTemplate = `{git: {repoURL: ${OWN}, directories: [{path: 'x/*'}]}, template: {spec: {source: {repoURL: https://elsewhere.example.org/r}}}}`;
    expect(run({ "s.yaml": set("", genTemplate) }).sources.map((x) => x.reason)).toEqual(["unsupported-template"]);
  });

  it("(f) Applications inside a kind: List are counted", () => {
    const list = `apiVersion: v1\nkind: List\nitems:\n  - apiVersion: argoproj.io/v1alpha1\n    kind: Application\n    metadata: {name: x}\n    spec: {source: {repoURL: https://github.com/acme/other, path: .}}\n`;
    const r = run({ "l.yaml": list });
    expect(r.total).toBe(1);
    expect(r.sources[0]?.reason).toBe("unreadable-repo");
  });

  it("siblings: a vault-plugin placeholder, userinfo in a chart URL, a credential whose url cannot be read", () => {
    expect(
      only({
        "a.yaml": app(
          "  source: {repoURL: https://charts.example.org, chart: c, helm: {valuesObject: {pw: '<path:kv/x#pw>'}}}",
        ),
      }),
    ).toBe("unsupported-field");
    expect(only({ "a.yaml": app("  source: {repoURL: 'https://u:p@charts.example.org', chart: c}") })).toBe(
      "private-chart",
    );
    const sopsCred =
      "apiVersion: v1\nkind: Secret\nmetadata: {name: s, labels: {argocd.argoproj.io/secret-type: repository}}\nstringData: {url: 'ENC[x]'}\nsops: {v: 3}\n";
    expect(
      only({ "a.yaml": app("  source: {repoURL: https://charts.example.org, chart: c}"), "s.yaml": sopsCred }),
    ).toBe("private-chart");
  });

  it("siblings: a source document that is itself SOPS-encrypted or patched by a kustomization", () => {
    expect(only({ "a.yaml": `${app(ownSource)}\nsops: {v: 3}\n` }, ["apps/x"])).toBe("encrypted-values");
    const patched = {
      "o/a.yaml": app(ownSource),
      "o/kustomization.yaml": "resources: [a.yaml]\npatches: [{target: {kind: Application}, patch: x}]\n",
    };
    expect(only(patched, ["apps/x"])).toBe("unsupported-template");
    const otherKind = {
      ...patched,
      "o/kustomization.yaml": "resources: [a.yaml]\npatches: [{target: {kind: Deployment}, patch: x}]\n",
    };
    expect(only(otherKind, ["apps/x"])).toBeNull();
  });

  it("siblings: Flux sources defined twice are checked against every definition", () => {
    const dup = `${helmRepo("{url: https://charts.example.org}")}\n---\n${helmRepo("{url: https://charts.example.org, secretRef: {name: s}}").replace("namespace: apps", "namespace: apps")}`;
    const release = hr("").replace("metadata: {name: r, namespace: apps}", "metadata: {name: r}");
    expect(only({ "hr.yaml": release, "repo.yaml": dup })).toBe("private-chart");
  });

  it("M3: a malformed percent escape in a repoURL is not the estate's repository and never throws", () => {
    for (const url of [
      "https://github.com/acme/%E0%A4%A",
      "https://github.com/acme/%",
      "https://github.com/acme/%zz/x",
    ]) {
      expect(normaliseRepoUrl(url)).toBeUndefined();
      expect(only({ "a.yaml": app(`  source: {repoURL: "${url}", path: x}`) }, ["x"])).toBe("unreadable-repo");
    }
  });
});

describe("census: findings of the second review", () => {
  const repo = helmRepo("{url: https://charts.example.org}");

  it("m1: never says 'at most one third', even with nothing uncounted", () => {
    expect(againstOneThird(1, 10, false)).toBe("not established");
    expect(againstOneThird(1, 10, true)).toBe("not established");
    expect(againstOneThird(4, 10, false)).toBe("over one third");
    expect(againstOneThird(0, 0, false)).toBe("nothing counted");
  });

  it("m2: a patch aimed at a consulted kind (a HelmRepository, a Flux Kustomization, a Secret) makes the source opaque", () => {
    const base = { "repo.yaml": repo, "hr.yaml": hr("") };
    const patch = (kind: string) => `resources: [repo.yaml, hr.yaml]\npatches: [{target: {kind: ${kind}}, patch: x}]\n`;
    expect(only({ ...base, "kustomization.yaml": patch("Deployment") })).toBeNull();
    expect(only({ ...base, "kustomization.yaml": patch("HelmRepository") })).toBe("unsupported-template");
    const sec = "apiVersion: v1\nkind: Secret\nmetadata: {name: vals, namespace: apps}\nstringData: {v: x}\n";
    const vf = { "repo.yaml": repo, "hr.yaml": hr("  valuesFrom: [{kind: Secret, name: vals}]"), "s/s.yaml": sec };
    expect(only(vf)).toBeNull();
    expect(
      only({ ...vf, "s/kustomization.yaml": "resources: [s.yaml]\npatches: [{target: {kind: Secret}, patch: x}]\n" }),
    ).toBe("unsupported-template");
    const withVar = hr(`  values: {host: '${"$"}{DOMAIN}'}`);
    const cm = "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: vars, namespace: flux-system}\ndata: {DOMAIN: x}\n";
    const ks =
      "apiVersion: kustomize.toolkit.fluxcd.io/v1\nkind: Kustomization\nmetadata: {name: k, namespace: flux-system}\nspec: {path: ., postBuild: {substituteFrom: [{kind: ConfigMap, name: vars}]}}\n";
    const flux = { "repo.yaml": repo, "hr.yaml": withVar, "f/ks.yaml": ks, "cm.yaml": cm };
    expect(only(flux)).toBeNull();
    expect(
      only({
        ...flux,
        "f/kustomization.yaml": "resources: [ks.yaml]\npatches: [{target: {kind: Kustomization}, patch: x}]\n",
      }),
    ).toBe("unsupported-template");
  });

  it("m3: a kustomization cycle is unreadable-file; a diamond is not a cycle", () => {
    const a = { "x.yaml": app(`  source: {repoURL: ${OWN}, path: a}`) };
    expect(
      only({ ...a, "a/kustomization.yaml": "resources: [../b]\n", "b/kustomization.yaml": "resources: [../a]\n" }),
    ).toBe("unreadable-file");
    const diamond = {
      ...a,
      "a/kustomization.yaml": "resources: [../b, ../c]\n",
      "b/kustomization.yaml": "resources: [../d]\n",
      "c/kustomization.yaml": "resources: [../d]\n",
      "d/kustomization.yaml": "resources: [cm.yaml]\n",
      "d/cm.yaml": "kind: ConfigMap\n",
    };
    expect(only(diamond)).toBeNull();
  });

  it("m3: a long chain of kustomizations is classified in bounded time (closures are memoised)", () => {
    const files: Files = { "x.yaml": app(`  source: {repoURL: ${OWN}, path: k0}`) };
    for (let i = 0; i < 1500; i++)
      files[`k${i}/kustomization.yaml`] = i < 1499 ? `resources: [../k${i + 1}]\n` : "resources: []\n";
    const t0 = cpuStart();
    expect(only(files)).toBeNull();
    // CPU ms: a hang guard, about 1.3 s on an idle run (the pre-fix code also stayed under 10 s, so it never caught m3); 15 s is over ten times that
    expect(cpuSince(t0)).toBeLessThan(15_000);
  });

  it("n3: scp and https forms of one repository normalise alike, percent escapes included", () => {
    expect(normaliseRepoUrl("git@github.com:%7Eacme/estate.git")).toBe(
      normaliseRepoUrl("https://github.com/%7Eacme/estate"),
    );
    expect(normaliseRepoUrl("git@github.com:acme/%zz")).toBeUndefined();
  });

  it("n4: a kind ending in List keeps its own document as well as its items", () => {
    const list = `apiVersion: argoproj.io/v1alpha1\nkind: ApplicationList\nitems:\n  - apiVersion: argoproj.io/v1alpha1\n    kind: Application\n    metadata: {name: x}\n    spec: {source: {repoURL: https://github.com/acme/other, path: .}}\n`;
    expect(run({ "l.yaml": list }).total).toBe(1);
  });

  it("m9: the JSON names its unit", () => {
    expect(censusJson([]).unit).toContain("generators counted once");
  });
});

describe("census: the C11 output", () => {
  it("reports per estate and total fractions, names an estate over one third and labels the figure", () => {
    const a = run({ "a.yaml": app("  source: {repoURL: https://github.com/acme/other, path: x}") });
    const b = run({ "hr.yaml": hr(""), "repo.yaml": helmRepo("{url: https://charts.example.org}") });
    const json = censusJson([
      {
        url: "https://github.com/acme/a",
        sha: "a".repeat(40),
        count: a,
        filesRead: 1,
        unreadableFiles: {},
        chartTemplateFilesUnreadable: 0,
        symlinks: 0,
      },
      {
        url: "https://github.com/acme/b",
        sha: "b".repeat(40),
        count: b,
        filesRead: 2,
        unreadableFiles: { "parse-error": 1 },
        chartTemplateFilesUnreadable: 1,
        symlinks: 2,
      },
    ]);
    expect(json.label).toBe(LABEL);
    expect(json.label).toBe("static-estimate");
    expect(json.notSeen.length).toBeGreaterThan(0);
    expect(json.estates[0]).toMatchObject({
      total: 1,
      opaque: 1,
      fraction: 1,
      againstOneThird: "over one third",
      atLeast: false,
    });
    expect(json.estates[1]).toMatchObject({
      total: 1,
      opaque: 0,
      fraction: 0,
      againstOneThird: "not established",
      atLeast: true,
    });
    expect(json.total).toEqual({
      againstOneThird: "over one third of the counted units; not established for the estate",
      atLeast: true,
      byReason: { "unreadable-repo": 1 },
      fraction: 0.5,
      opaque: 1,
      total: 2,
    });
    expect(JSON.stringify(json)).not.toContain('"sources"');
  });

  it("a fraction is never computed over nothing", () => {
    expect(fraction(0, 0)).toBeNull();
    expect(fraction(1, 3)).toBe(0.3333);
    const empty = censusJson([
      {
        url: "u",
        sha: "s",
        count: run({}),
        filesRead: 0,
        unreadableFiles: {},
        chartTemplateFilesUnreadable: 0,
        symlinks: 0,
      },
    ]);
    expect(empty.total.fraction).toBeNull();
    expect(empty.total.againstOneThird).toBe("nothing counted");
  });

  it("substitute leaves unknown references and non-string values alone", () => {
    expect(substitute("{{a}}-{{b.c}}-{{z}}", { a: 1, b: { c: "x" } })).toBe("1-x-{{z}}");
    expect(substitute(["{{a}}", 2, null], { a: "q" })).toEqual(["q", 2, null]);
  });
});
