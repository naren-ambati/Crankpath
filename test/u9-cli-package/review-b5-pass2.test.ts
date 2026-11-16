// Regression tests for the second review of B5 through the real CLI, each written to fail before its
// fix: M2 (a repos: mapping from the scanned repo's crankpath.yaml is a declared fact that changes
// what is read: listed and a gap; a --repo-alias is listed as the user's own assumption), m1 (nodes
// on a cycle a match entry hides are unverified, and the headline says so), m3 (cluster-provided
// objects named in the text), m4 (out-of-estate credentials named as not modelled).

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { app, copyThinSlice, run, THIN_SLICE_URL } from "../helpers/scan.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
const line = (text: string, prefix: string) => text.split("\n").find((l) => l.startsWith(prefix)) ?? "";

function thin(files: Record<string, string>, extra: string[] = []) {
  const repo = copyThinSlice();
  cleanup.push(path.dirname(repo));
  fs.rmSync(path.join(repo, "apps", "notes.yaml"));
  fs.rmSync(path.join(repo, "platform", "gitea", "hostile.yaml"));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  }
  const t = run([repo, "--repo-url", THIN_SLICE_URL, ...extra], repo);
  const j = run([repo, "--repo-url", THIN_SLICE_URL, "--format", "json", ...extra], repo);
  expect(t.code, t.stderr).toBe(0);
  return { text: t.stdout, json: JSON.parse(j.stdout), repo };
}
const OTHER = "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: other, namespace: other}\ndata: {k: v}\n";

describe("M2: repository mappings", () => {
  it("lists a repos: mapping from crankpath.yaml, and counts it in the declared-facts gap", () => {
    const r = thin({
      "apps/other.yaml": app("other", "o", "https://github.com/acme/y"),
      "vendor/o/cm.yaml": OTHER,
      "crankpath.yaml": 'repos:\n  "https://github.com/acme/y": {read_from: vendor}\n',
    });
    expect(r.text).toContain(
      '  read through a mapping: repo "https://github.com/acme/y"  root: "vendor"  (crankpath.yaml repos:, declared, not verified)\n',
    );
    expect(line(r.text, "Run status:")).toBe("Run status: ANALYSED WITH GAPS");
    expect(line(r.text, "  gaps:")).toContain("1 declared fact changes the graph read");
    expect(r.json.repoMappings).toEqual([
      { from: "crankpath.yaml", root: "vendor", url: "https://github.com/acme/y", used: true },
    ]);
  });
  it("lists a --repo-alias as the user's own assumption, never a gap", () => {
    const alias = copyThinSlice();
    cleanup.push(path.dirname(alias));
    const r = thin({ "apps/other.yaml": app("other", ".", "https://github.com/acme/z") }, [
      "--repo-alias",
      `https://github.com/acme/z=${alias}`,
    ]);
    expect(r.text).toContain(
      '  read through a mapping: repo "https://github.com/acme/z"  root: "alias:1"  (--repo-alias, your input)\n',
    );
    expect(r.json.runStatus.reasons).not.toContain("declared-facts");
    expect(line(r.text, "  Assumed,")).toContain("1 repository read through --repo-alias");
    expect(r.json.repoMappings).toEqual([
      { from: "--repo-alias", root: "alias:1", url: "https://github.com/acme/z", used: true },
    ]);
  });
});

describe("m1: a cycle hidden by a match entry", () => {
  const r = thin({ "crankpath.yaml": 'match:\n  - {host: "gitea-http.gitea", node: "Namespace/default"}\n' });
  it("says none found only with the overrides applied, and how many cycles they hide", () => {
    expect(line(r.text, "Cycles:")).toBe(
      "Cycles: none found in the graph read with 1 match override applied; 1 cycle hidden by the overrides (listed below)",
    );
  });
  it("makes the nodes of the hidden cycle unverified, never a start step", () => {
    const gitea = r.json.statuses.find((s: { node: string }) => s.node === "Application/argocd/gitea");
    expect(gitea).toMatchObject({ status: "unverified", reason: "match-override", blockers: ["c-d8197e7d"] });
    expect(r.json.plan.steps.flatMap((s: { nodes: string[] }) => s.nodes)).not.toContain("Application/argocd/gitea");
    expect(r.text).toContain("  unverified, on cycle c-d8197e7d, which a match entry hides: 5 nodes\n");
  });
});

describe("m3, m4: assumptions named in the text", () => {
  it("names the objects every cluster provides that the estate relies on", () => {
    const sa = [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata: {name: web, namespace: kube-system}",
      "spec:",
      "  template:",
      "    spec:",
      "      serviceAccountName: default",
      "      containers: [{name: c}]",
      "",
    ].join("\n");
    const r = thin({ "platform/gitea/sa-user.yaml": sa });
    expect(r.text).toContain(
      '  provided by every cluster (assumed, dated list): ServiceAccount "kube-system/default"\n',
    );
  });
  it("names credentials that are not in the estate among the not-modelled items", () => {
    const r = thin({});
    expect(line(r.text, "Not modelled")).toContain("repository credentials not defined in the estate are not seen");
  });
});
