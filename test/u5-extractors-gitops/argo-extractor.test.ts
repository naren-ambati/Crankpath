import { describe, expect, it } from "vitest";
import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import { argoExtractor } from "../../src/u5-extractors-gitops/argo-extractor.js";
import { context, job, meta, obj } from "../helpers/objects.js";

const SELF = "http://gitea-http.gitea:3000/ops/thin-slice";
const svc = obj(meta("Service", "gitea", "gitea-http", { spec: { selector: { a: "b" } } }), { file: "svc.yaml" });

function app(name: string, spec: Record<string, DataValue>, renderJob: string | null = null) {
  return obj(meta("Application", "argocd", name, { spec }), { file: `apps/${name}.yaml`, renderJob });
}

function run(
  objects: ReturnType<typeof obj>[],
  jobs = [job("Application/argocd/gitea", "in-cluster", "apps/gitea.yaml")],
) {
  const r = argoExtractor.extract(objects, context(objects, jobs));
  return { r, list: r.edges.map((e) => `${e.from} ${e.kind} ${e.to} @${e.evidence.file}:${e.evidence.field}`).sort() };
}

describe("Argo CD Applications (BR5.1, BR5.2)", () => {
  it("makes every rendered object depend on its Application, with the Application's field as evidence", () => {
    const rendered = obj(meta("ConfigMap", "gitea", "c"), {
      file: "platform/c.yaml",
      renderJob: "Application/argocd/gitea#0",
    });
    expect(run([rendered]).list).toEqual([
      "ConfigMap/gitea/c deployed-by Application/argocd/gitea @apps/gitea.yaml:spec.source.path",
    ]);
  });
  it("makes an Application read its source from the Service its repoURL host names, readable or not", () => {
    const a = app("gitea", { source: { repoURL: SELF, path: "x" } });
    const b = app("b", {
      sources: [
        { repoURL: "https://u:p@gitea-http.gitea.svc.cluster.local/ops/other" },
        { repoURL: "https://github.com/x/y" },
      ],
    });
    expect(run([svc, a, b]).list).toEqual([
      "Application/argocd/b reads-source Service/gitea/gitea-http @apps/b.yaml:spec.sources[0].repoURL",
      "Application/argocd/b reads-source external:github.com @apps/b.yaml:spec.sources[1].repoURL",
      "Application/argocd/gitea reads-source Service/gitea/gitea-http @apps/gitea.yaml:spec.source.repoURL",
    ]);
  });
  it("reads an ApplicationSet's git generator and template repoURL fields", () => {
    const set = obj(
      meta("ApplicationSet", "argocd", "root", {
        spec: {
          generators: [
            { git: { repoURL: SELF } },
            { matrix: { generators: [{ git: { repoURL: SELF } }, { list: {} }] } },
          ],
          template: { spec: { source: { repoURL: "{{ templated }}" } } },
        },
      }),
      { file: "apps/root.yaml" },
    );
    expect(run([svc, set]).list).toEqual([
      "ApplicationSet/argocd/root reads-source Service/gitea/gitea-http @apps/root.yaml:spec.generators[0].git.repoURL",
      "ApplicationSet/argocd/root reads-source Service/gitea/gitea-http @apps/root.yaml:spec.generators[1].matrix.generators[0].git.repoURL",
    ]);
  });
  it("never reads a host from free text (BR6.16)", () => {
    const cm = obj(
      meta("ConfigMap", "gitea", "notes", { data: { url: SELF, text: "repoURL: http://gitea-http.gitea:3000/x" } }),
      {
        file: "cm.yaml",
      },
    );
    expect(run([svc, cm]).list).toEqual([]);
  });
  it("lists a host it cannot place, and makes no edge", () => {
    const a = app("gitea", { source: { repoURL: "http://gitea-http:3000/ops/thin-slice" } });
    const { r, list } = run([svc, a]);
    expect(list).toEqual([]);
    // A bare name with no stated namespace and one same-named Service: unplaced, listing the Service
    // (pass 2, n1; it was an "ambiguity" of one candidate).
    expect(r.unresolved.map((u) => [u.why, u.candidates, u.value])).toEqual([
      ["host-unplaced", ["Service/gitea/gitea-http"], "gitea-http"],
    ]);
  });
});

describe("sync waves and destinations (BR5.3, BR5.4)", () => {
  it("records a sync wave as an attribute, never an edge, and lists a wave that is not an integer", () => {
    const a = obj(
      meta("ConfigMap", "gitea", "a", {
        metadata: { name: "a", namespace: "gitea", annotations: { "argocd.argoproj.io/sync-wave": "-2" } },
      }),
    );
    const b = obj(
      meta("ConfigMap", "gitea", "b", {
        metadata: { name: "b", namespace: "gitea", annotations: { "argocd.argoproj.io/sync-wave": "soon" } },
      }),
    );
    const { r } = run([a, b]);
    expect(r.edges).toEqual([]);
    expect(r.syncWaves).toEqual([{ node: "ConfigMap/gitea/a", wave: -2 }]);
    expect(r.unresolved.map((u) => [u.subject, u.why])).toEqual([["ConfigMap/gitea/b", "invalid-sync-wave"]]);
  });
  it("flags the objects of a foreign destination", () => {
    const far = job("Application/argocd/far", "server:https://far.example.org");
    const o = obj(meta("ConfigMap", "x", "y"), { renderJob: far.jobId });
    expect(run([o], [far]).r.flags).toEqual([{ node: "ConfigMap/x/y", flag: "foreign-destination" }]);
  });
  it("counts objects it has nothing to say about", () => {
    expect(run([obj(meta("ConfigMap", "x", "y"))]).r.ignoredKinds).toBe(1);
  });
});
