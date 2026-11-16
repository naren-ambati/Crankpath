import { describe, expect, it } from "vitest";
import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import { createRepoIdentity, normaliseRepoUrl } from "../../src/u2-intake-config/repo-identity.js";
import { destinationKey, type PlanContext, planSource } from "../../src/u3-discovery-expansion/render-planner.js";
import { obj } from "../helpers/objects.js";

const SELF = "http://gitea-http.gitea:3000/ops/thin-slice";

function ctx(
  dirs: Record<string, string[]> = { "platform/gitea": ["service.yaml"] },
  objects: Record<string, DataValue> = {},
): PlanContext {
  const identity = createRepoIdentity({
    scannedUrl: SELF,
    scannedFrom: "flag",
    aliases: [
      {
        url: "https://example.org/ops/other",
        normalised: normaliseRepoUrl("https://example.org/ops/other") as string,
        label: "alias:1",
      },
    ],
    mappings: [],
  });
  return {
    resolveRepo: identity.resolve,
    probeDirectory: (root, dir) => {
      const names = dirs[`${root === "." ? "" : `${root}:`}${dir}`];
      return names === undefined ? { ok: false, reasonWord: "not found" } : { ok: true, names };
    },
    lookup: (id) => {
      const v = objects[id];
      if (v === "conflict") return { state: "conflict" };
      return v === undefined
        ? { state: "absent" }
        : { state: "found", value: v as Record<string, DataValue>, file: "repo.yaml" };
    },
  };
}

function app(source: DataValue, extraSpec: Record<string, DataValue> = {}) {
  return obj(
    {
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name: "gitea", namespace: "argocd" },
      spec: { source, destination: { server: "https://kubernetes.default.svc", namespace: "gitea" }, ...extraSpec },
    },
    { file: "apps/gitea.yaml" },
  );
}

const plain = { repoURL: SELF, path: "platform/gitea", targetRevision: "main" };

describe("render planning: plain directories (BR3.18, BR3.19)", () => {
  it("plans a plain job for a self-repo directory, with the destination namespace and recurse", () => {
    const r = planSource({ kind: "Application", object: app({ ...plain, directory: { recurse: true } }) }, ctx());
    expect(r.opaque).toBeNull();
    expect(r.jobs[0]).toMatchObject({
      kind: "plain",
      jobId: "Application/argocd/gitea#0",
      owner: "Application/argocd/gitea",
      ownerFile: "apps/gitea.yaml",
      root: ".",
      dir: "platform/gitea",
      recurse: true,
      namespace: "gitea",
      destination: "in-cluster",
    });
  });
  it.each(["include", "exclude", "jsonnet"])("is opaque unsupported-field for a non-empty directory.%s", (key) => {
    const value = key === "jsonnet" ? { tlas: [{ name: "a", value: "b" }] } : "*.yaml";
    const r = planSource({ kind: "Application", object: app({ ...plain, directory: { [key]: value } }) }, ctx());
    expect(r.opaque).toMatchObject({ reason: "unsupported-field", field: `spec.source.directory.${key}` });
    const empty = planSource(
      { kind: "Application", object: app({ ...plain, directory: { [key]: key === "jsonnet" ? {} : "" } }) },
      ctx(),
    );
    expect(empty.opaque).toBeNull();
  });
  it("names an unknown source field and never runs a plugin", () => {
    expect(planSource({ kind: "Application", object: app({ ...plain, weird: 1 }) }, ctx()).opaque).toMatchObject({
      reason: "unsupported-field",
      field: "spec.source.weird",
    });
    expect(
      planSource({ kind: "Application", object: app({ ...plain, plugin: { name: "x" } }) }, ctx()).opaque,
    ).toMatchObject({
      reason: "unsupported-field",
      field: "spec.source.plugin",
    });
  });
  it("is unreadable-repo for another repo, with a suggestion only when the name matches, userinfo removed", () => {
    const other = planSource(
      { kind: "Application", object: app({ ...plain, repoURL: "https://u:p@github.com/x/thin-slice" }) },
      ctx(),
    );
    expect(other.opaque).toMatchObject({
      reason: "unreadable-repo",
      value: "https://github.com/x/thin-slice",
      suggestion: { url: "https://github.com/x/thin-slice", readFrom: "." },
    });
    expect(
      planSource({ kind: "Application", object: app({ ...plain, repoURL: "https://github.com/x/y" }) }, ctx()).opaque,
    ).toMatchObject({
      reason: "unreadable-repo",
      suggestion: null,
    });
    expect(
      planSource({ kind: "Application", object: app({ ...plain, repoURL: "file:///etc" }) }, ctx()).opaque,
    ).toMatchObject({
      reason: "unreadable-repo",
      detail: "not a URL crankpath can compare",
    });
  });
  it("reads an aliased repo under its alias root", () => {
    const r = planSource(
      { kind: "Application", object: app({ ...plain, repoURL: "https://example.org/ops/other.git", path: "apps" }) },
      ctx({ "alias:1:apps": [] }),
    );
    expect(r.jobs[0]).toMatchObject({ root: "alias:1", dir: "apps" });
  });
  it("is unreadable-file for a path outside the root or missing, keeping the path as repo text", () => {
    expect(planSource({ kind: "Application", object: app({ ...plain, path: "../x" }) }, ctx()).opaque).toMatchObject({
      reason: "unreadable-file",
      value: "../x",
      detail: "outside the scanned root",
    });
    expect(planSource({ kind: "Application", object: app({ ...plain, path: "nope" }) }, ctx()).opaque).toMatchObject({
      reason: "unreadable-file",
      detail: "not found",
    });
  });
  it("never plans an ApplicationSet: the GeneratorExpander expands it (B3)", () => {
    expect(() => planSource({ kind: "ApplicationSet", object: app(plain) }, ctx())).toThrow(/expanded, not planned/);
  });
  it("plans a Kustomize root as a job no source owns", () => {
    expect(planSource({ kind: "KustomizeRoot", dir: "base" }, ctx()).jobs[0]).toMatchObject({
      kind: "kustomize",
      owner: null,
      jobId: "KustomizeRoot:base",
      dir: "base",
    });
  });
  it("calls only the exact in-cluster destination in-cluster", () => {
    expect(destinationKey({ server: "https://kubernetes.default.svc/" })).toBe("in-cluster");
    expect(destinationKey({ name: "in-cluster" })).toBe("in-cluster");
    expect(destinationKey({ server: "https://kubernetes.default.svc.evil.example.org" })).toBe(
      "server:https://kubernetes.default.svc.evil.example.org",
    );
    expect(destinationKey({ name: "prod" })).toBe("name:prod");
    expect(destinationKey(undefined)).toBe("unknown");
  });
});
