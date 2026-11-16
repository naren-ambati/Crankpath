// The composition root (U9, ADR-006, BR9.6, BR9.7): sources found in rendered output are planned
// in turn (app of apps), a namespace-less source is skipped only when no render gives it one,
// a failing extractor or render is isolated and counted, `repos:` read_from roots are honoured,
// and a symlink in the scanned tree is named and counted.

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Extractor } from "../../src/u1-graph-model/extractor.js";
import { renderJson } from "../../src/u8-output/json-renderer.js";
import { EXTRACTORS, runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { app, estate, THIN_SLICE_URL, tempDir } from "../helpers/scan.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function make(files: Record<string, string>): string {
  const d = estate(files);
  cleanup.push(d);
  return d;
}
function report(root: string, extra: Partial<Parameters<typeof runPipeline>[0]> = {}) {
  const r = runPipeline({ path: root, cwd: process.cwd(), repoUrl: THIN_SLICE_URL, ...extra });
  if (r.kind !== "report") throw new Error(r.message);
  return r.report;
}
const CM = (name: string) => `apiVersion: v1\nkind: ConfigMap\nmetadata: {name: ${name}}\n`;

describe("pipeline composition", () => {
  it("plans an Application found inside another Application's render (app of apps)", () => {
    const child = app("child", "child-cfg").replace("  namespace: argocd\n", "");
    const root = make({
      "root.yaml": app("root", "apps"),
      "apps/child.yaml": child,
      "child-cfg/cm.yaml": CM("c"),
    });
    const r = report(root);
    // The child has no namespace of its own: the root's destination namespace (`root`) gives it one.
    expect(r.nodes.map((n) => n.id)).toEqual([
      "Application/argocd/root",
      "Application/root/child",
      "ConfigMap/child/c",
    ]);
    expect(r.edges.map((e) => `${e.from} ${e.kind} ${e.to}`)).toEqual([
      "Application/root/child deployed-by Application/argocd/root",
      "ConfigMap/child/c deployed-by Application/root/child",
    ]);
    // The repo's host may be in-cluster (`<svc>.<ns>`) and matches no Service: listed, no edge.
    expect(r.unresolved.map((u) => `${u.why} ${u.subject}`)).toEqual([
      "host-unplaced Application/argocd/root",
      "host-unplaced Application/root/child",
    ]);
    expect(r.skipped).toEqual([]);
    expect(r.runStatus.counts.sourcesFound).toBe(2);
  });
  it("skips and counts a source with no namespace that nothing renders, making the count a floor", () => {
    const loose = app("loose", "cfg").replace("  namespace: argocd\n", "");
    const r = report(make({ "a.yaml": app("a", "cfg"), "loose.yaml": loose, "cfg/cm.yaml": CM("c") }));
    expect(r.skipped.map((s) => [s.name, s.reason, s.source])).toEqual([["loose", "no-namespace", true]]);
    expect(r.runStatus.floor).toBe(true);
  });
  it("isolates a failing extractor: counted and listed, the run goes on", () => {
    const boom: Extractor = {
      name: "boom",
      extract: () => {
        throw new Error("boom");
      },
    };
    const r = report(make({ "a.yaml": app("a", "cfg"), "cfg/cm.yaml": CM("c") }), {
      extractors: [...EXTRACTORS, boom],
    });
    expect(r.unresolved.map((u) => [u.subject, u.why])).toEqual([
      ["Application/argocd/a", "host-unplaced"],
      ["extractor:boom", "extractor-failed"],
    ]);
    expect(r.runStatus.state).toBe("ANALYSED WITH GAPS");
    expect(r.edges).toHaveLength(1);
  });
  it("reads a repos: read_from mapping inside the root, under its own path", () => {
    const config = 'repos:\n  "https://example.org/ops/vendor": {read_from: vendor}\n';
    const r = report(
      make({
        "crankpath.yaml": config,
        "a.yaml": app("a", "deploy", "https://example.org/ops/vendor.git"),
        "vendor/deploy/cm.yaml": CM("v"),
      }),
    );
    expect(r.nodes.find((n) => n.id === "ConfigMap/a/v")?.origin.path).toBe("vendor/deploy/cm.yaml");
  });
  it("names and counts a symlink in the scanned tree, and never reads through it", () => {
    const outside = tempDir("outside");
    cleanup.push(outside);
    fs.writeFileSync(path.join(outside, "leak.yaml"), app("leak", "x"));
    const root = make({ "a.yaml": app("a", "cfg"), "cfg/cm.yaml": CM("c") });
    fs.symlinkSync(path.join(outside, "leak.yaml"), path.join(root, "leak.yaml"));
    fs.symlinkSync(outside, path.join(root, "cfg", "linked"));
    const r = report(root);
    expect(r.unreadable.map((u) => [u.path, u.outcome])).toEqual([
      ["cfg/linked", "symlink"],
      ["leak.yaml", "symlink"],
    ]);
    expect(r.nodes.map((n) => n.name)).not.toContain("leak");
    expect(r.runStatus.floor).toBe(true);
    expect(r.opaque.map((o) => [o.node, o.reason])).toEqual([["Application/argocd/a", "unreadable-file"]]);
  });
  it("never reads .git or the cache directory as input", () => {
    const r = report(
      make({
        "a.yaml": app("a", "cfg"),
        "cfg/cm.yaml": CM("c"),
        ".git/x.yaml": app("hidden", "cfg"),
        ".crankpath/y.yaml": app("cached", "cfg"),
      }),
    );
    expect(r.nodes.map((n) => n.name).sort()).toEqual(["a", "c"]);
    expect(r.runStatus.counts.ignoredFiles).toBe(1);
  });
  it("orders and dedupes the same way whatever the file order on disk", () => {
    const files = { "b.yaml": app("b", "cfg"), "a.yaml": app("a", "cfg"), "cfg/cm.yaml": CM("c") };
    const one = renderJson(report(make(files)));
    const two = renderJson(report(make(Object.fromEntries(Object.entries(files).reverse()))));
    expect(one).toBe(two);
  });
});
