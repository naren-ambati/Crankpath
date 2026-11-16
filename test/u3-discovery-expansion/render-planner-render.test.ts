import { describe, expect, it } from "vitest";
import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import { planSource } from "../../src/u3-discovery-expansion/render-planner.js";
import { argoApp, flux, GIT_REPO, planCtx, SELF } from "../helpers/plan.js";

const chartDirs = {
  "charts/web": ["Chart.yaml", "values.yaml"],
  "k/overlay": ["kustomization.yaml"],
  plain: ["a.yaml"],
};
const plan = (spec: Record<string, DataValue>, dirs: Record<string, string[]> = chartDirs, objects = {}) =>
  planSource({ kind: "Application", object: argoApp(spec) }, planCtx(dirs, objects));

describe("Argo CD Helm sources (BR3.4, BR3.5, BR3.6, FR3.1)", () => {
  it("plans a repo chart with the Application name as release and the destination namespace", () => {
    const r = plan({ source: { repoURL: SELF, path: "charts/web", targetRevision: "main" } });
    expect(r.opaque).toBeNull();
    expect(r.jobs[0]).toMatchObject({
      kind: "helm",
      jobId: "Application/argocd/web#0",
      releaseName: "web",
      namespace: "web",
      chart: { from: "repo", root: ".", dir: "charts/web" },
      includeCrds: true,
      floating: [{ field: "spec.source.targetRevision", value: "main" }],
    });
  });
  it("uses helm.releaseName and helm.namespace, and applies values in Argo CD's order (files, then values or valuesObject)", () => {
    const r = plan({
      source: {
        repoURL: SELF,
        path: "charts/web",
        targetRevision: "0123456789abcdef0123456789abcdef01234567",
        helm: {
          releaseName: "front",
          namespace: "other",
          valueFiles: ["values-prod.yaml", "../../shared/common.yaml"],
          values: "a: 1\n",
          valuesObject: { b: 2 },
          ignoreMissingValueFiles: true,
          skipCrds: true,
        },
      },
    });
    expect(r.jobs[0]).toMatchObject({
      releaseName: "front",
      namespace: "other",
      includeCrds: false,
      floating: [],
      values: [
        { kind: "file", root: ".", path: "charts/web/values-prod.yaml", optional: true },
        { kind: "file", root: ".", path: "shared/common.yaml", optional: true },
        { kind: "object", value: { b: 2 } },
      ],
    });
  });
  it("plans a chart from a repository with no repo identity, flagging a range as floating", () => {
    const r = plan({ source: { repoURL: "https://charts.example.org/", chart: "demo", targetRevision: "^1.2" } });
    expect(r.jobs[0]).toMatchObject({
      kind: "helm",
      chart: { from: "repository", url: "https://charts.example.org", name: "demo", version: "^1.2", oci: false },
      source: { repo: null, chart: "demo", floating: true },
      floating: [{ field: "spec.source.targetRevision", value: "^1.2" }],
    });
    const exact = plan({
      source: { repoURL: "oci://registry.example.org/charts", chart: "demo", targetRevision: "1.2.3" },
    });
    expect(exact.jobs[0]).toMatchObject({ chart: { oci: true, version: "1.2.3" }, floating: [] });
  });
  it.each([
    [{ parameters: [{ name: "a", value: "b" }] }, "spec.source.helm.parameters"],
    [{ fileParameters: [{ name: "a", path: "b" }] }, "spec.source.helm.fileParameters"],
    [{ kubeVersion: "1.30" }, "spec.source.helm.kubeVersion"],
    [{ apiVersions: ["x/v1"] }, "spec.source.helm.apiVersions"],
    [{ version: "v2" }, "spec.source.helm.version"],
    [{ unknownKey: 1 }, "spec.source.helm.unknownKey"],
  ])("names an unsupported helm field %j (BR3.7)", (helm, field) => {
    expect(plan({ source: { repoURL: SELF, path: "charts/web", helm } }).opaque).toMatchObject({
      reason: "unsupported-field",
      field,
    });
  });
  it.each([
    ["https://example.org/values.yaml", "a values file at a URL is never fetched"],
    ["values-*.yaml", "a values file glob is not expanded"],
    ["$ARGOCD_APP_NAME.yaml", "names no ref source of this Application"],
    ["values-$ENV.yaml", "build environment variables are not substituted"],
  ])("refuses the value file %j", (vf, detail) => {
    expect(plan({ source: { repoURL: SELF, path: "charts/web", helm: { valueFiles: [vf] } } }).opaque).toMatchObject({
      detail,
    });
  });
  it("is unreadable-file for a value file outside the scanned root", () => {
    expect(
      plan({ source: { repoURL: SELF, path: "charts/web", helm: { valueFiles: ["../../../etc/passwd"] } } }).opaque,
    ).toMatchObject({ reason: "unreadable-file", value: "../../../etc/passwd" });
  });
  it("refuses a release name helm would refuse, a chart URL without a scheme, and a hostile chart URL", () => {
    expect(plan({ source: { repoURL: SELF, path: "charts/web", helm: { releaseName: "-x" } } }).opaque).toMatchObject({
      reason: "unsupported-field",
      field: "spec.source.helm.releaseName",
    });
    expect(plan({ source: { repoURL: "registry.example.org/charts", chart: "demo" } }).opaque).toMatchObject({
      reason: "unsupported-field",
      field: "spec.source.repoURL",
    });
    expect(plan({ source: { repoURL: "https://u:p@169.254.169.254/", chart: "demo" } }).opaque).toMatchObject({
      reason: "unsupported-field",
      value: "https://169.254.169.254/",
    });
    expect(plan({ source: { repoURL: "https://charts.example.org", chart: "../x" } }).opaque?.reason).toBe(
      "unsupported-field",
    );
  });
});

describe("Argo CD Kustomize and multi-source (FR3.2, FR3.5)", () => {
  it("plans a Kustomize directory by its file name, and names kustomize options it does not apply", () => {
    expect(plan({ source: { repoURL: SELF, path: "k/overlay" } }).jobs[0]).toMatchObject({
      kind: "kustomize",
      dir: "k/overlay",
    });
    expect(
      plan({ source: { repoURL: SELF, path: "k/overlay", kustomize: { namePrefix: "x-" } } }).opaque,
    ).toMatchObject({
      reason: "unsupported-field",
      field: "spec.source.kustomize.namePrefix",
    });
    expect(plan({ source: { repoURL: SELF, path: "plain", kustomize: {} } }).jobs[0]?.kind).toBe("kustomize");
  });
  it("plans every rendering source of a multi-source Application; a ref-only source renders nothing", () => {
    const r = plan({
      sources: [
        {
          repoURL: "https://charts.example.org",
          chart: "demo",
          targetRevision: "1.0.0",
          helm: { valueFiles: ["$values/env/prod.yaml"] },
        },
        { repoURL: SELF, ref: "values" },
        { repoURL: SELF, path: "plain" },
      ],
    });
    expect(r.opaque).toBeNull();
    expect(r.jobs.map((j) => [j.jobId, j.kind])).toEqual([
      ["Application/argocd/web#0", "helm"],
      ["Application/argocd/web#2", "plain"],
    ]);
    expect(r.jobs[0]).toMatchObject({
      values: [{ kind: "file", root: ".", path: "env/prod.yaml", field: "spec.sources[0].helm.valueFiles[0]" }],
    });
  });
  it("is unreadable-repo for $values when the ref source is not readable under the repo-identity rule", () => {
    const r = plan({
      sources: [
        {
          repoURL: "https://charts.example.org",
          chart: "demo",
          targetRevision: "1.0.0",
          helm: { valueFiles: ["$values/prod.yaml"] },
        },
        { repoURL: "https://example.org/other/estate", ref: "values" },
      ],
    });
    expect(r.opaque).toMatchObject({
      reason: "unreadable-repo",
      field: "spec.sources[1].repoURL",
      suggestion: { readFrom: "." },
    });
  });
});

const helmRepo = {
  apiVersion: "source.toolkit.fluxcd.io/v1",
  kind: "HelmRepository",
  metadata: { name: "charts", namespace: "flux-system" },
  spec: { url: "https://charts.example.org" },
};
const values = (kind: "ConfigMap" | "Secret", name: string, extra: Record<string, DataValue> = {}) => ({
  apiVersion: "v1",
  kind,
  metadata: { name, namespace: "flux-system" },
  ...extra,
});

describe("Flux Kustomizations (FR3.6, BR3.9)", () => {
  const ks = (
    spec: Record<string, DataValue>,
    objects: Record<string, DataValue> = { "GitRepository/flux-system/flux-system": GIT_REPO },
  ) =>
    planSource(
      { kind: "Kustomization", object: flux("Kustomization", spec) },
      planCtx({ "clusters/prod": ["kustomization.yaml"], apps: ["a.yaml"] }, objects),
    );
  it("plans a Kustomize job from its GitRepository under the repo-identity rule, with targetNamespace and the floating ref", () => {
    const r = ks({
      sourceRef: { kind: "GitRepository", name: "flux-system" },
      path: "./clusters/prod",
      targetNamespace: "apps",
    });
    expect(r.jobs[0]).toMatchObject({
      kind: "kustomize",
      dir: "clusters/prod",
      namespaceOverride: "apps",
      floating: [{ field: "spec.sourceRef: GitRepository spec.ref.branch", value: "main" }],
    });
  });
  it("reads a path with no kustomization file as Flux does: every manifest under it", () => {
    expect(ks({ sourceRef: { kind: "GitRepository", name: "flux-system" }, path: "apps" }).jobs[0]).toMatchObject({
      kind: "plain",
      recurse: true,
    });
  });
  it("merges substituteFrom in order, then substitute, from ConfigMaps and plain Secrets in the repo", () => {
    const r = ks(
      {
        sourceRef: { kind: "GitRepository", name: "flux-system" },
        path: "apps",
        postBuild: {
          substituteFrom: [
            { kind: "ConfigMap", name: "vars" },
            { kind: "Secret", name: "secret-vars" },
          ],
          substitute: { region: "eu" },
        },
      },
      {
        "GitRepository/flux-system/flux-system": GIT_REPO,
        "ConfigMap/flux-system/vars": values("ConfigMap", "vars", { data: { region: "us", env: "prod" } }),
        "Secret/flux-system/secret-vars": values("Secret", "secret-vars", {
          data: { env: Buffer.from("stage").toString("base64") },
        }),
      },
    );
    expect([...(r.jobs[0]?.substitute ?? new Map())]).toEqual([
      ["region", "eu"],
      ["env", "stage"],
    ]);
    expect(r.references.map((x) => [x.kind, x.to])).toEqual([
      ["needs-config", "ConfigMap/flux-system/vars"],
      ["needs-secret", "Secret/flux-system/secret-vars"],
    ]);
  });
  it("is cluster-created-values for a substituteFrom Secret not in the repo, keeping the reference edge", () => {
    const r = ks({
      sourceRef: { kind: "GitRepository", name: "flux-system" },
      path: "apps",
      postBuild: { substituteFrom: [{ kind: "Secret", name: "cluster-vars" }] },
    });
    expect(r.opaque).toMatchObject({ reason: "cluster-created-values", lostEdges: ["edges from inside values"] });
    expect(r.references).toEqual([
      { kind: "needs-secret", to: "Secret/flux-system/cluster-vars", field: "spec.postBuild.substituteFrom[0].name" },
    ]);
  });
  it("is encrypted-values for a sops Secret, never reading it", () => {
    const r = ks(
      {
        sourceRef: { kind: "GitRepository", name: "flux-system" },
        path: "apps",
        postBuild: { substituteFrom: [{ kind: "Secret", name: "enc" }] },
      },
      {
        "GitRepository/flux-system/flux-system": GIT_REPO,
        "Secret/flux-system/enc": values("Secret", "enc", { sops: { mac: "x" }, data: { a: "ENC[...]" } }),
      },
    );
    expect(r.opaque?.reason).toBe("encrypted-values");
    expect(r.references).toHaveLength(1);
  });
  it.each([
    [{ patches: [{ patch: "x" }] }, "spec.patches"],
    [{ images: [{ name: "x" }] }, "spec.images"],
    [{ components: ["x"] }, "spec.components"],
    [{ namePrefix: "x" }, "spec.namePrefix"],
  ])("names an unsupported field %j", (extra, field) => {
    expect(
      ks({ sourceRef: { kind: "GitRepository", name: "flux-system" }, path: "apps", ...extra }).opaque,
    ).toMatchObject({
      reason: "unsupported-field",
      field,
    });
  });
  it("is unreadable-repo when its GitRepository is absent or names another repo; OCIRepository sources are named", () => {
    expect(ks({ sourceRef: { kind: "GitRepository", name: "flux-system" }, path: "apps" }, {}).opaque).toMatchObject({
      reason: "unreadable-repo",
      detail: "its GitRepository is not defined in the repository",
    });
    const other = { ...GIT_REPO, spec: { url: "https://u:tok@example.org/other/estate" } };
    expect(
      ks(
        { sourceRef: { kind: "GitRepository", name: "flux-system" }, path: "apps" },
        { "GitRepository/flux-system/flux-system": other },
      ).opaque,
    ).toMatchObject({
      reason: "unreadable-repo",
      value: "https://example.org/other/estate",
    });
    expect(ks({ sourceRef: { kind: "OCIRepository", name: "x" }, path: "apps" }).opaque).toMatchObject({
      field: "spec.sourceRef.kind",
    });
    expect(
      ks(
        { sourceRef: { kind: "GitRepository", name: "flux-system" }, path: "apps" },
        { "GitRepository/flux-system/flux-system": "conflict" },
      ).opaque,
    ).toMatchObject({ reason: "unsupported-field" });
  });
});

describe("Flux HelmReleases (FR3.6, FR3.12, BR3.8)", () => {
  const objects = {
    "HelmRepository/flux-system/charts": helmRepo,
    "GitRepository/flux-system/flux-system": GIT_REPO,
    "ConfigMap/flux-system/base-values": values("ConfigMap", "base-values", {
      data: { "values.yaml": "a: 1\n", custom: "b: 2\n" },
    }),
  };
  const hr = (spec: Record<string, DataValue>, o: Record<string, DataValue> = objects) =>
    planSource({ kind: "HelmRelease", object: flux("HelmRelease", spec) }, planCtx({}, o));
  const chart = { spec: { chart: "demo", version: "1.2.3", sourceRef: { kind: "HelmRepository", name: "charts" } } };
  it("plans a chart from a HelmRepository with valuesFrom in order, then values; release name with targetNamespace", () => {
    const r = hr({
      chart,
      targetNamespace: "apps",
      valuesFrom: [
        { kind: "ConfigMap", name: "base-values" },
        { kind: "ConfigMap", name: "base-values", valuesKey: "custom", targetPath: "x.y" },
      ],
      values: { c: 3 },
    });
    expect(r.jobs[0]).toMatchObject({
      kind: "helm",
      releaseName: "apps-app",
      namespace: "apps",
      chart: { from: "repository", url: "https://charts.example.org", name: "demo", version: "1.2.3" },
      values: [
        { kind: "ref", id: "ConfigMap/flux-system/base-values", key: "values.yaml", targetPath: null },
        { kind: "ref", key: "custom", targetPath: ["x", "y"] },
        { kind: "object", value: { c: 3 } },
      ],
      floating: [],
    });
    expect(r.references).toHaveLength(2);
  });
  it("flags the default version `*` as floating; plans a chart in a GitRepository as a repo chart", () => {
    expect(
      hr({ chart: { spec: { chart: "demo", sourceRef: { kind: "HelmRepository", name: "charts" } } } }).jobs[0],
    ).toMatchObject({
      floating: [{ field: "spec.chart.spec.version", value: "*" }],
      chart: { version: null },
    });
    expect(
      hr({ chart: { spec: { chart: "./charts/web", sourceRef: { kind: "GitRepository", name: "flux-system" } } } })
        .jobs[0],
    ).toMatchObject({
      chart: { from: "repo", root: ".", dir: "charts/web" },
    });
  });
  it("plans an OCIRepository chartRef", () => {
    const oci = {
      apiVersion: "source.toolkit.fluxcd.io/v1",
      kind: "OCIRepository",
      metadata: { name: "demo", namespace: "flux-system" },
      spec: { url: "oci://registry.example.org/charts/demo", ref: { tag: "2.0.0" } },
    };
    expect(
      hr({ chartRef: { kind: "OCIRepository", name: "demo" } }, { "OCIRepository/flux-system/demo": oci }).jobs[0],
    ).toMatchObject({
      chart: {
        from: "repository",
        url: "oci://registry.example.org/charts",
        name: "demo",
        version: "2.0.0",
        oci: true,
      },
    });
  });
  it("is cluster-created-values for an absent valuesFrom object, keeping the edge; encrypted-values for sops", () => {
    const r = hr({ chart, valuesFrom: [{ kind: "Secret", name: "from-cluster" }] });
    expect(r.opaque?.reason).toBe("cluster-created-values");
    expect(r.references).toEqual([
      { kind: "needs-secret", to: "Secret/flux-system/from-cluster", field: "spec.valuesFrom[0].name" },
    ]);
    const sops = hr(
      { chart, valuesFrom: [{ kind: "Secret", name: "enc" }] },
      {
        ...objects,
        "Secret/flux-system/enc": values("Secret", "enc", { sops: {}, stringData: { "values.yaml": "x" } }),
      },
    );
    expect(sops.opaque?.reason).toBe("encrypted-values");
  });
  it("names postRenderers, chart valuesFiles and a release name it would have to shorten", () => {
    expect(hr({ chart, postRenderers: [{ kustomize: {} }] }).opaque).toMatchObject({ field: "spec.postRenderers" });
    expect(hr({ chart: { spec: { ...chart.spec, valuesFiles: ["a.yaml"] } } }).opaque).toMatchObject({
      field: "spec.chart.spec.valuesFiles",
    });
    expect(hr({ chart, releaseName: "x".repeat(60) }).opaque).toMatchObject({ field: "spec.releaseName" });
  });
  it("is unreadable-repo when its HelmRepository is absent; skips CRDs only when install.crds is Skip", () => {
    expect(hr({ chart }, {}).opaque).toMatchObject({
      reason: "unreadable-repo",
      detail: "its HelmRepository is not defined in the repository",
    });
    expect(hr({ chart, install: { crds: "Skip" } }).jobs[0]).toMatchObject({ includeCrds: false });
  });
  it("flags another cluster's kubeConfig as a foreign destination (OD-4)", () => {
    expect(hr({ chart, kubeConfig: { secretRef: { name: "prod" } } }).jobs[0]?.destination).toBe("kubeconfig:prod");
  });
});
