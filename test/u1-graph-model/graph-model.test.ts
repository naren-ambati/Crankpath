import { describe, expect, it } from "vitest";
import {
  externalId,
  GraphConstructionError,
  isNodeId,
  makeEdge,
  makeOpaqueMark,
  objectId,
  parseNodeId,
} from "../../src/u1-graph-model/graph-model.js";

const EVIDENCE = { file: "a.yaml", field: "spec.x", renderedPath: "a.yaml#1", line: null };

describe("canonical ids (BR1.3, AC1.1.3)", () => {
  it("builds Kind/namespace/name, cluster-scoped Kind/name and external:<name>", () => {
    expect(objectId("Service", "gitea", "gitea-http")).toMatchObject({ ok: true, id: "Service/gitea/gitea-http" });
    expect(objectId("Namespace", "ignored", "gitea")).toMatchObject({
      ok: true,
      id: "Namespace/gitea",
      namespace: null,
    });
    expect(externalId("aws-kms/us-east-1")).toBe("external:aws-kms/us-east-1");
  });
  it("refuses a `/` or `:` in any part, so no name can forge another node's id", () => {
    // Without the check, a Service with no namespace named "gitea/gitea-http" would print as the
    // id of the real Service "gitea/gitea-http"; a cluster-scoped name with a slash would read as a
    // namespaced id.
    expect(objectId("Service", null, "gitea/gitea-http")).toEqual({ ok: false, refusal: "invalid-name" });
    expect(objectId("Namespace", null, "gitea/gitea-http")).toEqual({ ok: false, refusal: "invalid-name" });
    expect(objectId("Service", "gitea/x", "y")).toEqual({ ok: false, refusal: "invalid-namespace" });
    expect(objectId("Service/x", "gitea", "y")).toEqual({ ok: false, refusal: "invalid-kind" });
    expect(objectId("Service", "gitea", "a:b")).toEqual({ ok: false, refusal: "invalid-name" });
    expect(objectId("external:x", "gitea", "y")).toEqual({ ok: false, refusal: "invalid-kind" });
  });
  it("refuses control characters, upper case, over-long names and non-strings", () => {
    expect(objectId("ConfigMap", "gitea", "gitea\x1b[2J")).toMatchObject({ ok: false, refusal: "invalid-name" });
    expect(objectId("ConfigMap", "gitea", "Gitea")).toMatchObject({ ok: false });
    expect(objectId("ConfigMap", "gitea", "a".repeat(254))).toMatchObject({ ok: false, refusal: "invalid-name" });
    expect(objectId("ConfigMap", "gitea", "a".repeat(253))).toMatchObject({ ok: true });
    expect(objectId("ConfigMap", "gitea", 5)).toMatchObject({ ok: false, refusal: "invalid-name" });
    expect(objectId(undefined, "gitea", "a")).toMatchObject({ ok: false, refusal: "invalid-kind" });
  });
  it("needs a namespace for a namespaced kind", () => {
    expect(objectId("ConfigMap", null, "a")).toEqual({ ok: false, refusal: "no-namespace" });
    expect(objectId("ConfigMap", undefined, "a")).toEqual({ ok: false, refusal: "no-namespace" });
  });
  it("parses only exact canonical ids", () => {
    expect(parseNodeId("Service/gitea/gitea-http")).toEqual({
      external: false,
      kind: "Service",
      namespace: "gitea",
      name: "gitea-http",
    });
    expect(parseNodeId("Namespace/gitea")).toEqual({
      external: false,
      kind: "Namespace",
      namespace: null,
      name: "gitea",
    });
    expect(parseNodeId("external:github.com")).toEqual({ external: true, name: "github.com" });
    for (const bad of ["Service/gitea", "Namespace/a/b", "Service/a/b/c", "external:", "external:a//b", "", 3]) {
      expect(isNodeId(bad)).toBe(false);
    }
  });
});

describe("edges (BR1.1, BR1.2, AC1.1.1, AC1.1.2)", () => {
  it("cannot be built without each part of the evidence", () => {
    for (const missing of ["file", "field", "renderedPath"] as const) {
      const evidence = { ...EVIDENCE, [missing]: "" };
      expect(() =>
        makeEdge({ from: "Service/a/b", to: "Deployment/a/c", kind: "selects", source: "extracted", evidence }),
      ).toThrow(GraphConstructionError);
    }
    expect(() =>
      makeEdge({
        from: "Service/a/b",
        to: "Deployment/a/c",
        kind: "selects",
        source: "extracted",
        evidence: undefined as never,
      }),
    ).toThrow(GraphConstructionError);
  });
  it("has exactly two sources and canonical ends", () => {
    const e = makeEdge({
      from: "Service/a/b",
      to: "Deployment/a/c",
      kind: "selects",
      source: "declared",
      evidence: EVIDENCE,
    });
    expect(e.source).toBe("declared");
    expect(e.orderingOnly).toBe(false);
    expect(Object.isFrozen(e)).toBe(true);
    expect(() => makeEdge({ ...e, source: "guessed" as never })).toThrow(GraphConstructionError);
    expect(() => makeEdge({ ...e, from: "Service/a/b/c" })).toThrow(GraphConstructionError);
    expect(() => makeEdge({ ...e, kind: "likes" as never })).toThrow(GraphConstructionError);
    expect(() => makeEdge({ ...e, evidence: { ...EVIDENCE, line: 0 } })).toThrow(GraphConstructionError);
    expect(makeEdge({ ...e, evidence: { ...EVIDENCE, line: 3 } }).evidence.line).toBe(3);
  });
});

describe("opaque marks (BR3.15, BR3.16)", () => {
  it("has one reason from the fixed list and says what could not be seen", () => {
    const m = makeOpaqueMark({ reason: "unreadable-repo", lostEdges: ["objects under its source path"] });
    expect(m).toMatchObject({ reason: "unreadable-repo", detail: null, suggestion: null });
    expect(() => makeOpaqueMark({ reason: "unreadable-repo", lostEdges: [] })).toThrow(GraphConstructionError);
    expect(() => makeOpaqueMark({ reason: "fine" as never, lostEdges: ["x"] })).toThrow(GraphConstructionError);
  });
});
