// The text report's honesty wording (C8, BR8.4, BR8.5, BR8.13, FR4.4, FR8.2), each case built from a
// small estate and checked so that changing the input changes the words.

import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { claimWordsInOwnVoice } from "../../src/u1-graph-model/status-model.js";
import { nodeRef } from "../../src/u8-output/text-renderer.js";
import { app, estate, run, THIN_SLICE_URL } from "../helpers/scan.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function scan(files: Record<string, string>, extra: string[] = []): string {
  const d = estate(files);
  cleanup.push(d);
  const r = run([d, "--repo-url", THIN_SLICE_URL, ...extra], process.cwd());
  expect(r.code).toBe(0);
  return r.stdout;
}
function line(text: string, prefix: string): string {
  return text.split("\n").find((l) => l.startsWith(prefix)) ?? "";
}

const CM = "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\n";
// The cases that count edges and items scan a repo on a public host: an external precondition,
// declared available so the wording under test is not about it. (The thin-slice URL's host,
// `gitea-http.gitea`, may be in-cluster: with no Service it would be an unplaced item.)
const PUBLIC_URL = "https://git.example.org/ops/thin-slice";
const SELF_AVAILABLE = "external:\n  git.example.org: {cold_start: available}\n";
function scanPublic(files: Record<string, string>): string {
  const d = estate(files);
  cleanup.push(d);
  const r = run([d, "--repo-url", PUBLIC_URL], process.cwd());
  expect(r.code).toBe(0);
  return r.stdout;
}

describe("no-cycle wording (BR8.13, M9)", () => {
  it("says none found among N nodes and E edges read, with the opaque and unresolved counts, never a bare none", () => {
    const text = scanPublic({
      "apps/a.yaml": app("a", "cfg", PUBLIC_URL),
      "cfg/cm.yaml": CM,
      "crankpath.yaml": SELF_AVAILABLE,
    });
    expect(line(text, "Cycles:")).toBe(
      "Cycles: none found among 3 nodes and 2 edges read (0 nodes opaque; 0 unresolved items)",
    );
    expect(text).not.toMatch(/Cycles: (?:none|0)\s*$/m);
  });
  it("says no dependency edges were extracted when there are none, and the run has gaps", () => {
    // An in-cluster address that matches no Service: no edge and no external.
    const inCluster = "http://gitea-http.gitea.svc:3000/ops/thin-slice";
    const d = estate({ "apps/a.yaml": app("a", "empty", inCluster), "empty/README.md": "x\n" });
    cleanup.push(d);
    const r = run([d, "--repo-url", inCluster], process.cwd());
    expect(r.code).toBe(0);
    const text = r.stdout;
    expect(line(text, "Cycles:")).toBe("Cycles: none found among 1 node; no dependency edges were extracted.");
    expect(line(text, "  gaps:")).toContain("no dependency edges were extracted");
  });
});

describe("opacity statement (FR4.4, M3)", () => {
  it("says at least when an ApplicationSet is not expanded, and why", () => {
    const set =
      "apiVersion: argoproj.io/v1alpha1\nkind: ApplicationSet\nmetadata: {name: root, namespace: argocd}\nspec: {generators: []}\n";
    const text = scan({ "apps/a.yaml": app("a", "cfg"), "cfg/cm.yaml": CM, "apps/set.yaml": set });
    expect(line(text, "Opacity:")).toBe(
      "Opacity: at least 1 of 2 sources opaque (at least 50%); sources are Applications, ApplicationSets, Kustomizations, HelmReleases and Kustomize roots; 1 ApplicationSet is not expanded, so the Applications it would generate are not counted; 0 files unreadable.",
    );
    expect(text).toContain('  opaque 1 of 1  node: ApplicationSet "argocd/root"  reason: not-in-this-build');
  });
  it("says at least, and names the file, when a file is unreadable", () => {
    const text = scan({ "apps/a.yaml": app("a", "cfg"), "cfg/cm.yaml": CM, "apps/broken.yaml": "kind: [\n" });
    expect(line(text, "Opacity:")).toMatch(
      /^Opacity: at least 0 of 1 source opaque \(at least 0%\);.* 1 file unreadable\.$/,
    );
    expect(text).toContain('  unreadable 1 of 1  file: "apps/broken.yaml"  (not valid YAML)');
    expect(text).not.toContain("(nothing opaque, nothing skipped)");
  });
  it("says nothing opaque only when nothing was opaque or skipped", () => {
    const text = scanPublic({
      "apps/a.yaml": app("a", "cfg", PUBLIC_URL),
      "cfg/cm.yaml": CM,
      "crankpath.yaml": SELF_AVAILABLE,
    });
    expect(text).toContain("  (nothing opaque, nothing skipped)");
    expect(line(text, "Run status:")).toBe("Run status: ANALYSED WITH GAPS");
    expect(line(text, "  gaps:")).toBe("  gaps: node statuses and the restoration plan not computed in this build");
  });
  it("lists a Kustomize root as a source this build does not render", () => {
    const text = scan({
      "apps/a.yaml": app("a", "cfg"),
      "cfg/cm.yaml": CM,
      "base/kustomization.yaml": "resources: []\n",
    });
    expect(text).toContain('  opaque 1 of 1  Kustomize root: "base"  reason: not-in-this-build');
  });
  it("prints a suggestion for an unreadable repo as quoted text, marked not applied", () => {
    const text = scan({ "apps/a.yaml": app("a", "cfg", "https://user:pw@github.com/someone/thin-slice") });
    expect(text).toContain(
      '    suggested repos entry (not applied): "https://github.com/someone/thin-slice": {read_from: .}',
    );
    expect(text).not.toContain("pw@");
  });
});

describe("unresolved items, externals and declared edges", () => {
  it("lists an ambiguous selector with its candidates and no edge", () => {
    const dep = (n: string) =>
      `apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: ${n}}\nspec:\n  template:\n    metadata: {labels: {tier: web}}\n    spec: {containers: []}\n`;
    const svc = "apiVersion: v1\nkind: Service\nmetadata: {name: web}\nspec: {selector: {tier: web}}\n";
    const text = scanPublic({
      "apps/a.yaml": app("a", "cfg", PUBLIC_URL),
      "cfg/d1.yaml": dep("one"),
      "cfg/d2.yaml": dep("two"),
      "cfg/svc.yaml": svc,
      "crankpath.yaml": SELF_AVAILABLE,
    });
    expect(text).toContain('  unresolved 1 of 1  why: selector-ambiguous  subject: Service "a/web"');
    expect(text).toContain('    candidates: Deployment "a/one", Deployment "a/two"');
  });
  it("shows declared externals and an unspecified one as UNRESOLVED, and a declared cycle as unverified", () => {
    const config = [
      "external:",
      "  github.com: {cold_start: available}",
      "  git.example.org: {cold_start: available}",
      "  kms:",
      "edges:",
      '  - {from: "Application/argocd/a", to: "ConfigMap/a/c", why: "the runbook says the Application reads it"}',
    ].join("\n");
    const text = scanPublic({
      "apps/a.yaml": app("a", "cfg", PUBLIC_URL),
      "cfg/cm.yaml": CM,
      "crankpath.yaml": `${config}\n`,
    });
    expect(text).toContain('  external "github.com"  available (declared, not verified)');
    expect(text).toContain('  external "kms"  UNRESOLVED (not declared in crankpath.yaml)');
    expect(text).toMatch(/cycle c-[0-9a-f]{8} {2}label: declared \(unverified\)/);
    expect(text).toContain("(declared, unverified)");
    expect(line(text, "Not verified:")).toContain("1 external unspecified");
    expect(line(text, "Not verified:")).toContain("Declared edges: 1 (unverified when present).");
  });
  it("says cranks are declared and not applied in this build", () => {
    const config = 'cranks:\n  - {creates: "ConfigMap/a/c", by: "a person, runbook step 1"}\n';
    const text = scan({ "apps/a.yaml": app("a", "cfg"), "cfg/cm.yaml": CM, "crankpath.yaml": config });
    expect(line(text, "Not verified:")).toContain("1 crank declared and not applied in this build");
    expect(line(text, "  gaps:")).toContain(
      "cranks, node statuses and the restoration plan not computed in this build",
    );
  });
});

describe("node references (SafeText vocabulary)", () => {
  it("prints a known kind bare and any other kind inside a quoted id", () => {
    expect(nodeRef("Service/gitea/gitea-http")).toBe('Service "gitea/gitea-http"');
    expect(nodeRef("Namespace/gitea")).toBe('Namespace "gitea"');
    expect(nodeRef("Widget/a/b")).toBe('object "Widget/a/b"');
    expect(nodeRef("PASS/a/b")).toBe('object "PASS/a/b"');
    expect(nodeRef("external:github.com")).toBe('external "github.com"');
    expect(nodeRef("not an id\x1b")).toBe('object "not an id\\x1b"');
  });
  it("never uses a claim word in its own voice across these reports", () => {
    const text = scan({ "apps/a.yaml": app("a", "cfg"), "cfg/cm.yaml": CM });
    expect(claimWordsInOwnVoice(text)).toEqual([]);
  });
});

describe("pass 2: an in-cluster repo host that matches no Service is named (m5)", () => {
  it("prints the host after a fixed label on the item's line, quoted, and keeps it in the JSON", () => {
    const text = scan({ "apps/a.yaml": app("a", "cfg"), "cfg/cm.yaml": CM });
    expect(text).toContain('  unresolved 1 of 1  why: host-unplaced  subject: Application "argocd/a"');
    expect(text).toContain('    where: "apps/a.yaml#1"  field: "spec.source.repoURL"  host: "gitea-http.gitea"');
    const json = JSON.parse(scan({ "apps/a.yaml": app("a", "cfg"), "cfg/cm.yaml": CM }, ["--format", "json"]));
    expect(json.unresolved.map((u: { why: string; value: string | null }) => [u.why, u.value])).toEqual([
      ["host-unplaced", "gitea-http.gitea"],
    ]);
  });
});
