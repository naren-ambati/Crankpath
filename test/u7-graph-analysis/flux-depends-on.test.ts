// Flux `dependsOn` end to end (B5 review m6): B4's FluxExtractor makes each entry a hard
// `depends-on` edge, so the plan starts a Kustomization or HelmRelease only after what it depends
// on, and a dependsOn loop is a cycle that blocks its members (no ordering constraint is dropped).

import { describe, expect, it } from "vitest";
import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import { analyseFixture } from "../helpers/fixture-kit.js";
import { obj } from "../helpers/objects.js";

const ks = (name: string, dependsOn: string[]): ReturnType<typeof obj> =>
  obj(
    {
      apiVersion: "kustomize.toolkit.fluxcd.io/v1",
      kind: "Kustomization",
      metadata: { name, namespace: "flux-system" },
      spec: { dependsOn: dependsOn.map((d) => ({ name: d })) } as DataValue,
    },
    { file: `clusters/${name}.yaml` },
  );

describe("Flux dependsOn through extraction, the graph and the plan (m6)", () => {
  it("starts each Kustomization after the ones it depends on", () => {
    const objects = [ks("apps", ["infra", "crds"]), ks("infra", ["crds"]), ks("crds", [])];
    const { analysis } = analyseFixture({ objects, jobs: [] });
    expect(analysis.plan.steps.map((s) => s.nodes)).toEqual([
      ["Kustomization/flux-system/crds"],
      ["Kustomization/flux-system/infra"],
      ["Kustomization/flux-system/apps"],
    ]);
    expect(analysis.cycles).toEqual([]);
  });
  it("makes a dependsOn loop an extracted cycle that blocks its members and what depends on them", () => {
    const objects = [ks("a", ["b"]), ks("b", ["a"]), ks("c", ["a"])];
    const { analysis } = analyseFixture({ objects, jobs: [] });
    expect(analysis.cycles.map((c) => [c.label, c.nodes])).toEqual([
      ["extracted", ["Kustomization/flux-system/a", "Kustomization/flux-system/b"]],
    ]);
    const status = Object.fromEntries(analysis.verdicts.map((v) => [v.node, [v.status, v.reason, v.via]]));
    expect(status["Kustomization/flux-system/c"]).toEqual(["blocked", "cycle", "Kustomization/flux-system/a"]);
    expect(analysis.plan.steps).toEqual([]);
    expect(analysis.plan.conflicts).toEqual([]);
  });
});
