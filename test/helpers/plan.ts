// Test helpers for the render planner: a plan context over in-memory directory listings and repo
// objects, with the real RepoIdentity.

import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import { createRepoIdentity } from "../../src/u2-intake-config/repo-identity.js";
import type { PlanContext } from "../../src/u3-discovery-expansion/render-planner.js";
import { obj } from "./objects.js";

export const SELF = "https://example.org/ops/estate";

/** Directory listings keyed `dir` (scanned root) or `label:dir`; objects by canonical id (`"conflict"` for a conflict). */
export function planCtx(dirs: Record<string, string[]>, objects: Record<string, DataValue> = {}): PlanContext {
  const identity = createRepoIdentity({ scannedUrl: SELF, scannedFrom: "flag", aliases: [], mappings: [] });
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

export function argoApp(spec: Record<string, DataValue>, name = "web") {
  return obj(
    {
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name, namespace: "argocd" },
      spec: { destination: { server: "https://kubernetes.default.svc", namespace: "web" }, ...spec },
    },
    { file: "apps/web.yaml" },
  );
}

export function flux(kind: "Kustomization" | "HelmRelease", spec: Record<string, DataValue>, name = "app") {
  return obj(
    {
      apiVersion: kind === "Kustomization" ? "kustomize.toolkit.fluxcd.io/v1" : "helm.toolkit.fluxcd.io/v2",
      kind,
      metadata: { name, namespace: "flux-system" },
      spec,
    },
    { file: "clusters/prod/app.yaml" },
  );
}

export const GIT_REPO = {
  apiVersion: "source.toolkit.fluxcd.io/v1",
  kind: "GitRepository",
  metadata: { name: "flux-system", namespace: "flux-system" },
  spec: { url: SELF, ref: { branch: "main" } },
};
