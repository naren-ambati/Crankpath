import { describe, expect, it } from "vitest";
import type { ReadResult } from "../../src/u2-intake-config/bounded-reader.js";
import { discover, sourceKindOf } from "../../src/u3-discovery-expansion/source-discovery.js";

function io(files: Record<string, ReadResult | "text">) {
  return {
    walk: () => ({ ok: true as const, files: Object.keys(files).sort(), refusals: [] }),
    read: (p: string): ReadResult => {
      const r = files[p];
      if (r === undefined || r === "text") throw new Error(`unexpected read of ${p}`);
      return r;
    },
  };
}

const ok = (path: string, documents: unknown[]): ReadResult => ({
  outcome: "ok",
  path,
  size: 1,
  documents: documents as never,
});

describe("source discovery (BR3.1, BR3.2)", () => {
  it("classifies by apiVersion group and kind only", () => {
    expect(sourceKindOf("argoproj.io/v1alpha1", "Application")).toBe("Application");
    expect(sourceKindOf("argoproj.io/v1alpha1", "ApplicationSet")).toBe("ApplicationSet");
    expect(sourceKindOf("kustomize.toolkit.fluxcd.io/v1", "Kustomization")).toBe("Kustomization");
    expect(sourceKindOf("helm.toolkit.fluxcd.io/v2", "HelmRelease")).toBe("HelmRelease");
    expect(sourceKindOf("kustomize.config.k8s.io/v1beta1", "Kustomization")).toBeNull();
    expect(sourceKindOf("example.org/v1", "Application")).toBeNull();
    expect(sourceKindOf("Application", "Application")).toBeNull();
  });
  it("finds sources in multi-document files and List items, counts the rest as ignored", () => {
    const app = { apiVersion: "argoproj.io/v1alpha1", kind: "Application", metadata: { name: "a" } };
    const d = discover(
      io({
        "README.md": "text",
        "apps/a.yaml": ok("apps/a.yaml", [null, { kind: "ConfigMap", apiVersion: "v1" }, app]),
        "apps/list.yaml": ok("apps/list.yaml", [{ apiVersion: "v1", kind: "List", items: [{ kind: "x" }, app] }]),
        "plain/cm.yml": ok("plain/cm.yml", [{ apiVersion: "v1", kind: "ConfigMap" }]),
        "base/kustomization.yaml": "text",
        "base/Kustomization": "text",
        "bad.yaml": { outcome: "parse-error", path: "bad.yaml", reasonWord: "not valid YAML" },
      }),
    );
    if ("failed" in d) throw new Error("walk");
    expect(d.sourceFiles.map((f) => f.path)).toEqual(["apps/a.yaml", "apps/list.yaml"]);
    expect(d.kustomizeRoots).toEqual(["base"]);
    expect(d.ignoredFiles).toBe(2);
    expect(d.unreadable).toEqual([
      { path: "bad.yaml", outcome: "parse-error", reasonWord: "not valid YAML", detail: null },
    ]);
  });
  it("reports a walk that cannot start", () => {
    expect(
      discover({
        walk: () => ({ ok: false, refusal: { outcome: "not-found", path: "", reasonWord: "not found" } }),
        read: () => {
          throw new Error("no");
        },
      }),
    ).toEqual({ failed: true });
  });
});
