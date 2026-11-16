import { describe, expect, it } from "vitest";
import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import { workloadRefExtractor } from "../../src/u6-extractors-workload/workload-refs.js";
import { context, job, meta, obj } from "../helpers/objects.js";

function deployment(
  name: string,
  labels: Record<string, string>,
  podSpec: Record<string, DataValue>,
  kind = "Deployment",
) {
  const template = { metadata: { labels }, spec: podSpec };
  const spec: DataValue =
    kind === "CronJob" ? { jobTemplate: { spec: { template } } } : { selector: { matchLabels: labels }, template };
  return obj(meta(kind, "apps", name, { spec }), { file: `${name}.yaml` });
}

function service(name: string, selector: DataValue, ns = "apps", renderJob: string | null = null) {
  return obj(meta("Service", ns, name, { spec: { selector } }), { file: `${name}-svc.yaml`, renderJob });
}

function edges(objects: ReturnType<typeof obj>[], jobs = [job("Application/argocd/a")]) {
  const r = workloadRefExtractor.extract(objects, context(objects, jobs));
  return { r, list: r.edges.map((e) => `${e.from} ${e.kind} ${e.to} @${e.evidence.field}`).sort() };
}

describe("workload references (BR6.7, AC6.3.1)", () => {
  it("extracts every Pod-template reference, init containers included", () => {
    const d = deployment(
      "web",
      { app: "web" },
      {
        initContainers: [
          { name: "i", envFrom: [{ configMapRef: { name: "init-cm" } }, { secretRef: { name: "init-s" } }] },
        ],
        containers: [
          {
            name: "c",
            env: [
              { name: "A", valueFrom: { secretKeyRef: { name: "s-a", key: "k" } } },
              { name: "B", valueFrom: { configMapKeyRef: { name: "cm-b", key: "k" } } },
              { name: "C", value: "free text gitea-http.gitea.svc is never read" },
            ],
          },
        ],
        volumes: [
          { name: "v1", secret: { secretName: "vol-s" } },
          { name: "v2", configMap: { name: "vol-cm" } },
          { name: "v3", projected: { sources: [{ secret: { name: "proj-s" } }, { configMap: { name: "proj-cm" } }] } },
        ],
        imagePullSecrets: [{ name: "pull" }],
        serviceAccountName: "web-sa",
      },
    );
    expect(edges([d]).list).toEqual([
      "Deployment/apps/web needs-config ConfigMap/apps/cm-b @spec.template.spec.containers[0].env[1].valueFrom.configMapKeyRef.name",
      "Deployment/apps/web needs-config ConfigMap/apps/init-cm @spec.template.spec.initContainers[0].envFrom[0].configMapRef.name",
      "Deployment/apps/web needs-config ConfigMap/apps/proj-cm @spec.template.spec.volumes[2].projected.sources[1].configMap.name",
      "Deployment/apps/web needs-config ConfigMap/apps/vol-cm @spec.template.spec.volumes[1].configMap.name",
      "Deployment/apps/web needs-secret Secret/apps/init-s @spec.template.spec.initContainers[0].envFrom[1].secretRef.name",
      "Deployment/apps/web needs-secret Secret/apps/proj-s @spec.template.spec.volumes[2].projected.sources[0].secret.name",
      "Deployment/apps/web needs-secret Secret/apps/pull @spec.template.spec.imagePullSecrets[0].name",
      "Deployment/apps/web needs-secret Secret/apps/s-a @spec.template.spec.containers[0].env[0].valueFrom.secretKeyRef.name",
      "Deployment/apps/web needs-secret Secret/apps/vol-s @spec.template.spec.volumes[0].secret.secretName",
      "Deployment/apps/web runs-as ServiceAccount/apps/web-sa @spec.template.spec.serviceAccountName",
    ]);
  });
  it("reads CronJob templates, skips optional references and lists an invalid reference name", () => {
    const c = deployment(
      "nightly",
      {},
      {
        containers: [
          { name: "c", envFrom: [{ secretRef: { name: "opt", optional: true } }, { secretRef: { name: "Bad/Name" } }] },
        ],
      },
      "CronJob",
    );
    const { r, list } = edges([c]);
    expect(list).toEqual([]);
    expect(r.unresolved.map((u) => [u.subject, u.why])).toEqual([["Bad/Name", "invalid-reference"]]);
  });
});

describe("Service selectors (BR6.8, BR6.9)", () => {
  const web = deployment("web", { app: "web", tier: "front" }, { containers: [] });
  const api = deployment("api", { app: "api", tier: "front" }, { containers: [] });
  it("selects the one workload whose Pod labels hold the selector, in the same namespace", () => {
    expect(edges([web, api, service("web", { app: "web" })]).list).toEqual([
      "Service/apps/web selects Deployment/apps/web @spec.selector",
    ]);
    expect(edges([web, service("web", { app: "web" }, "elsewhere")]).list).toEqual([]);
    expect(edges([web, service("web", { app: "nope" })]).list).toEqual([]);
  });
  it("creates no edge and lists an ambiguity when the selector matches more than one", () => {
    const { r, list } = edges([web, api, service("front", { tier: "front" })]);
    expect(list).toEqual([]);
    expect(r.unresolved.map((u) => [u.why, u.candidates])).toEqual([
      ["selector-ambiguous", ["Deployment/apps/api", "Deployment/apps/web"]],
    ]);
  });
  it("lists a selector that is not a string map, and ignores a Service with no selector", () => {
    const { r } = edges([web, service("odd", { app: 1 }), service("none", {})]);
    expect(r.unresolved.map((u) => u.why)).toEqual(["selector-invalid"]);
  });
  it("never matches across destinations", () => {
    const foreignJob = job("Application/argocd/far", "server:https://far");
    const svc = service("web", { app: "web" }, "apps", foreignJob.jobId);
    expect(edges([web, svc], [foreignJob]).list).toEqual([]);
  });
});
