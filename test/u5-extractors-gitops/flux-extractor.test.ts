// FluxExtractor (BR5.9 to BR5.11, Q2 of the unit's design questions): dependsOn, sourceRef,
// chart references, values and substitutions, source hosts, and the cycle a dependsOn loop makes.

import { describe, expect, it } from "vitest";
import type { DataValue, RenderedObject } from "../../src/u1-graph-model/extractor.js";
import { fluxExtractor } from "../../src/u5-extractors-gitops/flux-extractor.js";
import { analyseFixture, edgeLines, HOSTILE_STRINGS, setPath } from "../helpers/fixture-kit.js";
import { context, obj } from "../helpers/objects.js";

function flux(apiVersion: string, kind: string, ns: string, name: string, spec: DataValue): RenderedObject {
  return obj({ apiVersion, kind, metadata: { name, namespace: ns }, spec }, { file: `flux/${kind}-${name}.yaml` });
}
const ks = (name: string, spec: DataValue, ns = "flux-system") =>
  flux("kustomize.toolkit.fluxcd.io/v1", "Kustomization", ns, name, spec);
const hr = (name: string, spec: DataValue, ns = "apps") =>
  flux("helm.toolkit.fluxcd.io/v2", "HelmRelease", ns, name, spec);
const src = (kind: string, name: string, spec: DataValue, ns = "flux-system") =>
  flux("source.toolkit.fluxcd.io/v1", kind, ns, name, spec);

function extract(objects: RenderedObject[]) {
  const r = fluxExtractor.extract(objects, context(objects));
  return {
    r,
    edges: r.edges.map((e) => `${e.from} ${e.kind} ${e.to} @${e.evidence.field}`).sort(),
    items: r.unresolved.map((u) => `${u.why} ${u.subject} @${u.field ?? ""}`).sort(),
  };
}

describe("Kustomizations (BR5.9, BR5.10)", () => {
  it("dependsOn entries are hard depends-on edges, in the object's namespace unless one is named", () => {
    const x = extract([ks("apps", { dependsOn: [{ name: "infra" }, { name: "crds", namespace: "other" }] })]);
    expect(x.edges).toEqual([
      "Kustomization/flux-system/apps depends-on Kustomization/flux-system/infra @spec.dependsOn[0].name",
      "Kustomization/flux-system/apps depends-on Kustomization/other/crds @spec.dependsOn[1].name",
    ]);
  });
  it("sourceRef reads its source; substituteFrom needs its ConfigMap or Secret unless optional", () => {
    const x = extract([
      ks("apps", {
        sourceRef: { kind: "GitRepository", name: "flux-system" },
        postBuild: {
          substituteFrom: [
            { kind: "ConfigMap", name: "vars" },
            { kind: "Secret", name: "secret-vars" },
            { kind: "Secret", name: "maybe", optional: true },
          ],
        },
      }),
    ]);
    expect(x.edges).toEqual([
      "Kustomization/flux-system/apps needs-config ConfigMap/flux-system/vars @spec.postBuild.substituteFrom[0].name",
      "Kustomization/flux-system/apps needs-secret Secret/flux-system/secret-vars @spec.postBuild.substituteFrom[1].name",
      "Kustomization/flux-system/apps reads-source GitRepository/flux-system/flux-system @spec.sourceRef.name",
    ]);
  });
  it("lists a source kind the field does not allow, and a value kind it does not know, with no edge", () => {
    const x = extract([
      ks("apps", {
        sourceRef: { kind: "HelmRepository", name: "x" },
        postBuild: { substituteFrom: [{ kind: "Vault", name: "v" }] },
      }),
    ]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([
      "invalid-reference Kustomization/flux-system/apps @spec.postBuild.substituteFrom[0].kind",
      "invalid-reference Kustomization/flux-system/apps @spec.sourceRef.kind",
    ]);
  });
});

describe("HelmReleases (BR5.9, BR5.10)", () => {
  it("dependsOn HelmReleases; chart sourceRef, chartRef and valuesFrom", () => {
    const x = extract([
      hr("web", {
        dependsOn: [{ name: "db" }],
        chart: {
          spec: { chart: "web", sourceRef: { kind: "HelmRepository", name: "charts", namespace: "flux-system" } },
        },
        valuesFrom: [
          { kind: "ConfigMap", name: "web-values" },
          { kind: "Secret", name: "web-secrets", valuesKey: "v" },
        ],
      }),
      hr("db", { chartRef: { kind: "OCIRepository", name: "db-chart" } }),
    ]);
    expect(x.edges).toEqual([
      "HelmRelease/apps/db reads-source OCIRepository/apps/db-chart @spec.chartRef.name",
      "HelmRelease/apps/web depends-on HelmRelease/apps/db @spec.dependsOn[0].name",
      "HelmRelease/apps/web needs-config ConfigMap/apps/web-values @spec.valuesFrom[0].name",
      "HelmRelease/apps/web needs-secret Secret/apps/web-secrets @spec.valuesFrom[1].name",
      "HelmRelease/apps/web reads-source HelmRepository/flux-system/charts @spec.chart.spec.sourceRef.name",
    ]);
  });
  it("ignores an object of another API group with the same kind", () => {
    const other = flux("example.org/v1", "HelmRelease", "apps", "x", { dependsOn: [{ name: "y" }] });
    const x = extract([other]);
    expect(x.edges).toEqual([]);
    expect(x.r.ignoredKinds).toBe(1);
  });
});

describe("sources (BR5.11)", () => {
  const svc = obj(
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "gitea-http", namespace: "gitea" },
      spec: { selector: { a: "b" } },
    },
    { file: "svc.yaml" },
  );
  it("a GitRepository depends on the Service its url names, and on its credential Secret", () => {
    const x = extract([
      svc,
      src("GitRepository", "home", { url: "http://gitea-http.gitea:3000/ops/home", secretRef: { name: "home-auth" } }),
    ]);
    expect(x.edges).toEqual([
      "GitRepository/flux-system/home needs-secret Secret/flux-system/home-auth @spec.secretRef.name",
      "GitRepository/flux-system/home reads-source Service/gitea/gitea-http @spec.url",
    ]);
  });
  it("a HelmRepository or OCIRepository outside the cluster names an external precondition", () => {
    const x = extract([
      src("HelmRepository", "charts", { url: "https://charts.example.org" }),
      src("OCIRepository", "db", { url: "oci://ghcr.io/acme/db" }),
    ]);
    expect(x.edges).toEqual([
      "HelmRepository/flux-system/charts reads-source external:charts.example.org @spec.url",
      "OCIRepository/flux-system/db reads-source external:ghcr.io @spec.url",
    ]);
  });
  it("a Bucket's endpoint is its host; an in-cluster address with no Service and an ambiguous one make no edge", () => {
    const other = obj(
      { apiVersion: "v1", kind: "Service", metadata: { name: "gitea-http", namespace: "b" } },
      { file: "b.yaml" },
    );
    const x = extract([
      svc,
      other,
      src("Bucket", "b", { endpoint: "minio.minio.svc:9000", bucketName: "x" }),
      src("GitRepository", "g", { url: "http://gitea-http:3000/x" }),
    ]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.subject, u.candidates])).toEqual([
      ["host-unplaced", "Bucket/flux-system/b", []],
      ["host-ambiguous", "GitRepository/flux-system/g", ["Service/b/gitea-http", "Service/gitea/gitea-http"]],
    ]);
  });
});

describe("a dependsOn loop is a cycle; hostile names never forge an id", () => {
  it("two Kustomizations that depend on each other form a 2-edge cycle", () => {
    const objects = [ks("a", { dependsOn: [{ name: "b" }] }), ks("b", { dependsOn: [{ name: "a" }] })];
    const { analysis } = analyseFixture({ objects, jobs: [] });
    expect(analysis.cycles.map((c) => edgeLines(c.edges))).toEqual([
      [
        "Kustomization/flux-system/a depends-on Kustomization/flux-system/b",
        "Kustomization/flux-system/b depends-on Kustomization/flux-system/a",
      ],
    ]);
  });
  it("every hostile dependsOn name or namespace is an invalid reference, never an edge", () => {
    const base = ks("apps", { dependsOn: [{ name: "infra" }] });
    for (const h of HOSTILE_STRINGS) {
      for (const at of [
        ["spec", "dependsOn", 0, "name"],
        ["spec", "dependsOn", 0, "namespace"],
      ]) {
        const x = extract([obj(setPath(base.body as DataValue, at, h), { file: "h.yaml" })]);
        expect(x.edges).toEqual([]);
        expect(x.r.unresolved.map((u) => u.why)).toEqual(["invalid-reference"]);
      }
    }
  });
});

describe("review fixes: a Bucket's endpoint (n1)", () => {
  it("a Bucket reads from the Service its spec.endpoint names", () => {
    const minio = obj(
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "minio", namespace: "minio" },
        spec: { selector: { a: "b" } },
      },
      { file: "m.yaml" },
    );
    const x = extract([
      minio,
      src("Bucket", "b", { endpoint: "minio.minio:9000", bucketName: "x", url: "https://other.example.org" }),
    ]);
    expect(x.edges).toEqual(["Bucket/flux-system/b reads-source Service/minio/minio @spec.endpoint"]);
  });
});

describe("pass 3: a source url that is text but no host is listed (m2)", () => {
  it("an unparseable GitRepository url is an item", () => {
    const x = extract([src("GitRepository", "g", { url: "http://[fe80::1%25eth0]/x" })]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.value])).toEqual([["host-unplaced", "http://[fe80::1%25eth0]/x"]]);
  });
});
