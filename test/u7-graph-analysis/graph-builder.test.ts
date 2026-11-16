import { describe, expect, it } from "vitest";
import { NO_DECLARED_FACTS } from "../../src/u1-graph-model/declared-facts.js";
import { emptyResult } from "../../src/u1-graph-model/extractor.js";
import { makeEdge, makeOpaqueMark } from "../../src/u1-graph-model/graph-model.js";
import { analyse, PLAN_DISCLAIMER } from "../../src/u7-graph-analysis/analysis.js";
import { buildGraph } from "../../src/u7-graph-analysis/graph-builder.js";
import { meta, obj } from "../helpers/objects.js";

const EV = { file: "f.yaml", field: "spec.x", renderedPath: "f.yaml#1", line: null };

function result(edges: Parameters<typeof makeEdge>[0][]) {
  const r = emptyResult();
  r.edges.push(...edges.map(makeEdge));
  return r;
}

describe("graph build (BR7.1, BR7.2, BR7.19, BR2.9)", () => {
  it("merges one object arriving twice into one node, and names a same-id conflict", () => {
    const a1 = obj(meta("ConfigMap", "ns", "a", { data: { k: "1" } }), { file: "one.yaml" });
    const a2 = obj(meta("ConfigMap", "ns", "a", { data: { k: "1" } }), { file: "two.yaml" });
    const merged = buildGraph({ objects: [a2, a1], extracted: [], config: NO_DECLARED_FACTS, opaque: [] });
    expect(merged.nodes.map((n) => [n.id, n.origin.path, n.flags])).toEqual([["ConfigMap/ns/a", "one.yaml", []]]);
    expect(merged.unresolved).toEqual([]);
    const other = obj(meta("ConfigMap", "ns", "a", { data: { k: "2" } }), { file: "three.yaml" });
    const conflict = buildGraph({ objects: [a1, other], extracted: [], config: NO_DECLARED_FACTS, opaque: [] });
    expect(conflict.nodes[0]?.flags).toEqual(["conflicting-definitions"]);
    expect(conflict.unresolved.map((u) => [u.subject, u.why])).toEqual([["ConfigMap/ns/a", "conflicting-definitions"]]);
  });
  it("keeps a reference to an undefined object as an edge to a not-defined stub, listed", () => {
    const d = obj(meta("Deployment", "ns", "d"));
    const g = buildGraph({
      objects: [d],
      extracted: [
        result([{ from: d.id, to: "Secret/ns/missing", kind: "needs-secret", source: "extracted", evidence: EV }]),
      ],
      config: NO_DECLARED_FACTS,
      opaque: [],
    });
    expect(g.nodes.find((n) => n.id === "Secret/ns/missing")?.flags).toEqual(["not-defined"]);
    expect(g.edges).toHaveLength(1);
    expect(g.unresolved.map((u) => [u.subject, u.why, u.where, u.field])).toEqual([
      ["Secret/ns/missing", "not-defined", "f.yaml#1", "spec.x"],
    ]);
  });
  it("tags declared edges declared, needs both ends, and makes externals nodes", () => {
    const a = obj(meta("ConfigMap", "ns", "a"));
    const config = {
      ...NO_DECLARED_FACTS,
      file: "crankpath.yaml",
      externals: [
        {
          name: "github.com",
          id: "external:github.com",
          coldStart: "available" as const,
          servedBy: null,
          keyPath: "external.github.com",
        },
        { name: "kms", id: "external:kms", coldStart: "unspecified" as const, servedBy: null, keyPath: "external.kms" },
        {
          name: "vault",
          id: "external:vault",
          coldStart: "unspecified" as const,
          servedBy: "Service/v/v",
          keyPath: "external.vault",
        },
      ],
      edges: [
        { from: "ConfigMap/ns/a", to: "external:github.com", why: "w", keyPath: "edges[0]" },
        { from: "ConfigMap/ns/a", to: "Secret/ns/ghost", why: "w", keyPath: "edges[1]" },
      ],
    };
    const g = buildGraph({ objects: [a], extracted: [], config, opaque: [] });
    expect(g.edges.map((e) => [e.from, e.to, e.source, e.evidence.file, e.evidence.field])).toEqual([
      ["ConfigMap/ns/a", "external:github.com", "declared", "crankpath.yaml", "edges[0]"],
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual([
      "ConfigMap/ns/a",
      "external:github.com",
      "external:kms",
      "external:vault",
    ]);
    expect(g.externals.map((e) => [e.id, e.coldStart])).toEqual([
      ["external:github.com", "available"],
      ["external:kms", "unspecified"],
      ["external:vault", "unspecified"],
    ]);
    expect(g.unresolved.map((u) => [u.subject, u.why])).toEqual([
      ["Secret/ns/ghost", "declared-edge-endpoint-missing"],
      ["external:kms", "external-unspecified"],
      ["external:vault", "served-by-missing"],
    ]);
  });
  it("gives a node its first opaque mark only, and sorts everything", () => {
    const a = obj(meta("ConfigMap", "ns", "a"));
    const m1 = makeOpaqueMark({ reason: "unreadable-repo", lostEdges: ["x"] });
    const m2 = makeOpaqueMark({ reason: "limit", lostEdges: ["y"] });
    const g = buildGraph({
      objects: [a],
      extracted: [],
      config: NO_DECLARED_FACTS,
      opaque: [
        { node: a.id, mark: m1 },
        { node: a.id, mark: m2 },
      ],
    });
    expect(g.nodes[0]?.opaque?.reason).toBe("unreadable-repo");
  });
});

describe("analysis interface (C9)", () => {
  it("computes cycles, statuses, the plan and crank effects (nothing is left uncomputed)", () => {
    const g = buildGraph({ objects: [], extracted: [], config: NO_DECLARED_FACTS, opaque: [] });
    const r = analyse(g, NO_DECLARED_FACTS);
    expect(r).toMatchObject({ cycles: [], verdicts: [], crankEffects: [], notComputed: [] });
    expect(r.plan.steps).toEqual([]);
    const withCranks = analyse(g, {
      ...NO_DECLARED_FACTS,
      cranks: [{ id: "crank:1", creates: [], reroutes: [], by: "x", ref: null, keyPath: "cranks[0]" }],
    });
    expect(withCranks.notComputed).toEqual([]);
    expect(withCranks.crankEffects[0]?.matched).toBe(false);
    expect(PLAN_DISCLAIMER).toContain("not a schedule");
  });
});

describe("graph build: declared facts of B5 (FR6.2, FR6.5, BR7.19)", () => {
  const d = obj(meta("Deployment", "ns", "d"));
  const ext = (name: string, coldStart: "available" | "unavailable" | "unspecified", servedBy: string | null) => ({
    name,
    id: `external:${name}`,
    coldStart,
    servedBy,
    keyPath: `external.${name}`,
  });
  it("joins an external `served_by` an in-estate node to that node by a declared edge", () => {
    const g = buildGraph({
      objects: [d],
      extracted: [],
      config: { ...NO_DECLARED_FACTS, file: "crankpath.yaml", externals: [ext("registry", "unspecified", d.id)] },
      opaque: [],
    });
    expect(g.edges.map((e) => [e.from, e.kind, e.to, e.source, e.evidence.field])).toEqual([
      ["external:registry", "depends-on", "Deployment/ns/d", "declared", "external.registry.served_by"],
    ]);
    expect(g.unresolved).toEqual([]);
    const missing = buildGraph({
      objects: [],
      extracted: [],
      config: { ...NO_DECLARED_FACTS, file: "crankpath.yaml", externals: [ext("registry", "unspecified", d.id)] },
      opaque: [],
    });
    expect(missing.edges).toEqual([]);
    expect(missing.unresolved.map((u) => u.why)).toEqual(["served-by-missing"]);
  });
  it("makes an external a crank reroutes to, and one an edge points at, a node with an unspecified cold start", () => {
    const config = {
      ...NO_DECLARED_FACTS,
      file: "crankpath.yaml",
      cranks: [
        {
          id: "crank:1",
          creates: [],
          reroutes: [{ node: d.id, to: "github.com" }],
          by: "seed",
          ref: null,
          keyPath: "cranks[0]",
        },
      ],
    };
    const g = buildGraph({
      objects: [d],
      extracted: [
        result([{ from: d.id, to: "external:registry", kind: "reads-source", source: "declared", evidence: EV }]),
      ],
      config,
      opaque: [],
    });
    expect(g.externals.map((e) => [e.id, e.coldStart])).toEqual([
      ["external:github.com", "unspecified"],
      ["external:registry", "unspecified"],
    ]);
    expect(g.nodes.filter((n) => n.kind === "External").map((n) => n.id)).toEqual([
      "external:github.com",
      "external:registry",
    ]);
    expect(g.unresolved.map((u) => [u.subject, u.why, u.field])).toEqual([
      ["external:github.com", "external-unspecified", "cranks[0].reroutes.to"],
      ["external:registry", "external-unspecified", "spec.x"],
    ]);
  });
  it("flags a reference to an object every cluster provides `cluster-provided`, not `not-defined`, and lists nothing", () => {
    const g = buildGraph({
      objects: [d, obj(meta("Namespace", null, "ns"))],
      extracted: [
        result([
          { from: d.id, to: "ServiceAccount/ns/default", kind: "runs-as", source: "extracted", evidence: EV },
          { from: d.id, to: "ConfigMap/ns/kube-root-ca.crt", kind: "needs-config", source: "extracted", evidence: EV },
          { from: d.id, to: "ServiceAccount/ns/builder", kind: "runs-as", source: "extracted", evidence: EV },
        ]),
      ],
      config: NO_DECLARED_FACTS,
      opaque: [],
    });
    expect(g.nodes.map((n) => [n.id, n.flags])).toEqual([
      ["ConfigMap/ns/kube-root-ca.crt", ["cluster-provided"]],
      ["Deployment/ns/d", []],
      ["Namespace/ns", []],
      ["ServiceAccount/ns/builder", ["not-defined"]],
      ["ServiceAccount/ns/default", ["cluster-provided"]],
    ]);
    expect(g.unresolved.map((u) => u.subject)).toEqual(["ServiceAccount/ns/builder"]);
  });
});
