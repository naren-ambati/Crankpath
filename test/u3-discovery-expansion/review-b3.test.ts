// Regression tests for the B3 review: M1 (a hostile ApplicationSet cannot exhaust memory or time:
// every generated Application is charged before it is built, and the rendering work of the set is
// bounded), m6 (the in-cluster server in Go mode).

import { describe, expect, it } from "vitest";
import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import { type ExpanderIo, expandApplicationSet } from "../../src/u3-discovery-expansion/generator-expander.js";
import { meta, obj } from "../helpers/objects.js";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

const io: ExpanderIo = {
  resolveRepo: () => ({ outcome: "unreadable", root: null, via: "none", suggestion: null }),
  walk: () => ({ ok: true, files: [], refusals: [] }),
  read: (_l, p) => ({ outcome: "not-found", path: p, reasonWord: "not found" }),
  display: (_l, p) => p,
};
function appSet(spec: object) {
  return obj(meta("ApplicationSet", "argocd", "set", { spec: spec as Record<string, DataValue> }), {
    file: "set.yaml",
  });
}
/** The review's shape: a list generator and a template with many templated annotations. */
function fat(elements: number, annotations: number) {
  const ann: Record<string, string> = {};
  for (let j = 0; j < annotations; j++) ann[`k${j}`] = "v{{env}}x";
  return appSet({
    generators: [{ list: { elements: Array.from({ length: elements }, (_, i) => ({ env: `a${i}` })) } }],
    template: { metadata: { name: "{{env}}", annotations: ann }, spec: { project: "default" } },
  });
}

describe("M1: generated Applications are charged before they are built", () => {
  it("asks the budget for each Application with its string values, and stops at the first refusal", () => {
    const asked: number[] = [];
    let room = 10;
    const e = expandApplicationSet(fat(5000, 1000), io, null, {
      applications: 96_638,
      patternSteps: 1_000_000,
      admit: (leaves) => {
        asked.push(leaves);
        return room-- > 0;
      },
    });
    expect(e.documents).toHaveLength(10);
    expect(asked).toHaveLength(11);
    // 1,000 annotations, the name and the project, plus apiVersion, kind and namespace
    expect(asked[0]).toBe(1000 + 2 + 3);
    expect(e.mark).toMatchObject({
      reason: "limit",
      detail: "the run's memory budget was reached while its Applications were generated",
      lostEdges: ["Applications its generators would generate over the limit"],
    });
  });
  it("bounds the set's rendering work (generatorRenderSteps), elements times template size", () => {
    const t0 = cpuStart();
    const e = expandApplicationSet(fat(90_000, 1000), io, null, {
      applications: 96_638,
      patternSteps: 1_000_000,
      renderSteps: 2_000_000,
    });
    expect(e.mark).toMatchObject({
      reason: "limit",
      detail: "template rendering work over the limit (generatorRenderSteps)",
    });
    expect(e.documents.length).toBeLessThan(2000);
    expect(cpuSince(t0)).toBeLessThan(10_000);
  });
  it("stops one huge substitution while it is being built, not after", () => {
    const big = "x".repeat(1_000_000);
    const tags = "{{v}}".repeat(1000);
    const t0 = cpuStart();
    const e = expandApplicationSet(
      appSet({
        generators: [{ list: { elements: [{ v: big }] } }],
        template: { metadata: { name: "a" }, spec: { s: tags } },
      }),
      io,
      null,
      { applications: 10, patternSteps: 10, renderSteps: 5_000_000 },
    );
    expect(e.documents).toEqual([]);
    expect(e.mark?.reason).toBe("limit");
    expect(cpuSince(t0)).toBeLessThan(5000);
  });
});

describe("m6: the in-cluster cluster's server in Go mode", () => {
  it("is Argo CD's in-cluster address", () => {
    const e = expandApplicationSet(
      appSet({
        goTemplate: true,
        generators: [{ clusters: {} }],
        template: { metadata: { name: "{{.name}}" }, spec: { destination: { server: "{{.server}}" } } },
      }),
      io,
      [{ name: "in-cluster", labels: {}, annotations: {}, keyPath: "clusters.in-cluster" }],
      { applications: 10, patternSteps: 10 },
    );
    expect(e.documents[0]).toMatchObject({ spec: { destination: { server: "https://kubernetes.default.svc" } } });
  });
});
