// Regression tests for the second B6 review (reviews/bolt-6-review-pass-2.md) through the real CLI,
// written to fail before their fixes: M1 (a repo could plant hundreds of controller-shaped objects
// or unresolved items and decide which of a cycle's own lines the reader got, and the stop line
// pointed at a JSON output that does not carry the observations), m1 (the disclaimer covers the
// name too, and says when the object is not on the cycle).

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { copyThinSlice, FIXTURE, run, THIN_SLICE_URL } from "../helpers/scan.js";
import { flat } from "../helpers/text.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
const K = LIMITS.explainListEntries.value;

function thin(files: Record<string, string>): string {
  const repo = copyThinSlice();
  cleanup.push(path.dirname(repo));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(repo, rel), text);
  return repo;
}

const planted = (count: number) =>
  Array.from(
    { length: count },
    (_, i) =>
      `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: argocd-repo-server\n  namespace: ns${i}\n  labels: {app.kubernetes.io/part-of: argocd, app.kubernetes.io/component: repo-server}\nspec:\n  template:\n    spec:\n      containers: [{name: c, image: x}]\n`,
  ).join("---\n");

describe("M1: a planted flood of matches is capped, counted, and never cuts the cycle's own lines", () => {
  const repo = thin({ "platform/gitea/evil.yaml": planted(300) });
  const r = run([repo, "--repo-url", THIN_SLICE_URL, "--explain"], process.cwd());
  const lines = r.stdout.split("\n");
  const text = flat(r.stdout);
  it("prints at most one screenful of pattern notes and counts the rest as not printed", () => {
    expect(r.code).toBe(0);
    expect(lines.filter((l) => l.startsWith("  self-management: pattern:"))).toHaveLength(K);
    expect(text).toContain(
      `and ${300 - K} more objects match a controller signature; not printed (the JSON output does not carry these observations)`,
    );
  });
  it("keeps the cycle's closing line and the close of the explanation, and never sends the reader to the JSON for them", () => {
    expect(text).toContain("nodes blocked by this cycle:");
    expect(text).toContain("Assumed, not verified by crankpath:");
    expect(text).toContain("Not modelled (5 items):");
    expect(text).not.toContain("the rest is in the JSON output");
    expect(lines.length).toBeLessThanOrEqual(LIMITS.explainOutputLines.value);
  });
  it("m1: says the name and labels are set by the repo, and that the object is not on the cycle", () => {
    expect(text).toContain(
      'Deployment "ns0/argocd-repo-server", carries the name and labels Argo CD\'s repo server uses (name and labels set by the repo, not verified; this object is not on the cycle)',
    );
  });
});

describe("M1: a node's unresolved items are a capped list", () => {
  const refs = Array.from({ length: 800 }, (_, i) => `            - configMapRef: {name: "$(X${i})"}`).join("\n");
  const deployment = fs
    .readFileSync(path.join(FIXTURE, "repo", "platform", "gitea", "deployment.yaml"), "utf8")
    .replace("          envFrom:\n", `          envFrom:\n${refs}\n`);
  const repo = thin({ "platform/gitea/deployment.yaml": deployment });
  it("lists the first 21 and points to the JSON, which holds every unresolved item", () => {
    const r = run([repo, "--repo-url", THIN_SLICE_URL, "--explain", "Deployment/gitea/gitea"], process.cwd());
    expect(r.code).toBe(0);
    const text = flat(r.stdout);
    expect(text).toMatch(
      new RegExp(`unresolved items on it: (\\d+); the first ${K}; the other \\d+ are in the JSON output`),
    );
    expect(r.stdout.split("\n").filter((l) => l.startsWith("    unresolved: "))).toHaveLength(K);
    expect(r.stdout.split("\n").length).toBeLessThan(200);
  });
});
