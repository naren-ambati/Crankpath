// The B5 definition of done on the Vault fixture (bolt plan B5; US11.3, AC11.3.1, AC11.3.2; BR7.10,
// BR7.12 to BR7.20): B4's hand-written rendered objects through the real extractors, GraphBuilder
// and the whole analysis (cranks, statuses, plan). Before the two documented edits, cycles A and B
// are uncranked and the three externals are UNRESOLVED; with the crank, A is `cranked` and plan
// step 1 is the crank; with the `ca` issuer, B is gone; with both edits and the three externals
// declared available, the plan orders every node with one marked manual step. Each state breaks
// when its input is taken away.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { ConfigDocument } from "../../src/u1-graph-model/declared-facts.js";
import { NO_DECLARED_FACTS } from "../../src/u1-graph-model/declared-facts.js";
import { analyseFixture, fixtureConfig, loadFixture, withOverlays } from "../helpers/fixture-kit.js";

const VAULT = fileURLToPath(new URL("../fixtures/vault/", import.meta.url));
const VARIANT = (name: string) => fileURLToPath(new URL(`../fixtures/vault/variants/${name}/`, import.meta.url));
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

const CYCLE_A = "Application/argocd/platform";
const CYCLE_B = "StatefulSet/vault/vault";
const EXTERNALS = ["external:aws-kms/us-east-1", "external:aws-sts", "external:github.com"];
const CRANK_BY = "kubectl create secret from the offline key backup, runbook DR-3";

function run(overlays: readonly string[], config?: (root: string) => ConfigDocument) {
  const root = withOverlays(VAULT, overlays.map(VARIANT));
  cleanup.push(root);
  const facts = config ? config(root) : fixtureConfig(`${root}/gitops`);
  const { graph, analysis } = analyseFixture(loadFixture(root), facts);
  const cycleWith = (node: string) => analysis.cycles.find((c) => c.nodes.includes(node));
  const status = new Map(analysis.verdicts.map((v) => [v.node, v]));
  return { graph, analysis, cycleWith, status };
}

describe("before the edits: A and B uncranked, three externals UNRESOLVED (AC11.3.1)", () => {
  const r = run([]);
  it("reports cycles A and B extracted and uncranked, and nothing startable", () => {
    expect(r.analysis.cycles.map((c) => [c.label, c.nodes.length])).toEqual([
      ["extracted", 3],
      ["extracted", 5],
    ]);
    expect(r.analysis.verdicts.filter((v) => v.status === "startable")).toEqual([]);
    expect(r.analysis.plan.steps).toEqual([]);
  });
  it("blocks what needs each external on that external, unspecified, never available", () => {
    for (const id of EXTERNALS)
      expect(r.status.get(id)).toMatchObject({ status: "blocked", reason: "external-unspecified" });
    expect(r.analysis.unresolved.filter((u) => u.why === "external-unspecified").map((u) => u.subject)).toEqual(
      EXTERNALS,
    );
    expect(r.status.get("Application/argocd/root")).toMatchObject({
      status: "blocked",
      reason: "external-unspecified",
      blockers: ["external:github.com"],
    });
  });
  it("blocks every node of each cycle by that cycle", () => {
    const a = r.cycleWith(CYCLE_A)?.id;
    const b = r.cycleWith(CYCLE_B)?.id;
    expect(r.status.get(CYCLE_A)).toMatchObject({ status: "blocked", reason: "cycle", blockers: [a] });
    expect(r.status.get(CYCLE_B)).toMatchObject({ status: "blocked", reason: "cycle", blockers: [b] });
  });
});

describe("the crank variant: A cranked, plan step 1 the crank (AC11.3.2, BR7.10, BR7.15)", () => {
  const r = run(["crank-a"]);
  it("labels A cranked by the documented step and leaves B uncranked", () => {
    expect(r.cycleWith(CYCLE_A)).toMatchObject({
      label: "cranked",
      labelBeforeCranks: "extracted",
      crankedBy: ["crank:1"],
    });
    expect(r.cycleWith(CYCLE_B)?.label).toBe("extracted");
  });
  it("makes the crank plan step 1, manual, creating the credential Secret", () => {
    expect(r.analysis.plan.steps[0]).toMatchObject({
      no: 1,
      kind: "crank",
      manual: true,
      nodes: ["Secret/argocd/repo-platform"],
      why: CRANK_BY,
      ref: "runbooks/dr-3.md",
    });
    expect(r.status.get("Secret/argocd/repo-platform")?.status).toBe("startable");
  });
  it("without the crank file, A is not cranked (the input decides)", () => {
    const plain = run(["crank-a"], () => NO_DECLARED_FACTS);
    expect(plain.cycleWith(CYCLE_A)?.label).toBe("extracted");
    expect(plain.analysis.plan.steps).toEqual([]);
  });
});

describe("the ca-issuer variant: B is gone (AC11.3.2)", () => {
  const r = run(["ca-issuer"]);
  it("reports only cycle A, and the Vault StatefulSet blocked by an external, no longer by a cycle", () => {
    expect(r.analysis.cycles.map((c) => c.nodes.includes(CYCLE_A))).toEqual([true]);
    expect(r.cycleWith(CYCLE_B)).toBeUndefined();
    expect(r.status.get(CYCLE_B)).toMatchObject({ status: "blocked", reason: "external-unspecified" });
  });
});

describe("both edits, the externals declared available: a fully ordered plan, one manual step (bolt plan B5)", () => {
  const r = run(["ca-issuer", "both-edits"]);
  it("leaves no uncranked cycle and every node startable", () => {
    expect(r.analysis.cycles.map((c) => c.label)).toEqual(["cranked"]);
    expect(r.analysis.verdicts.filter((v) => v.status !== "startable")).toEqual([]);
    expect(r.analysis.plan.listedUnordered).toEqual([]);
  });
  it("orders every object of the estate: one manual crank step first, then start steps only", () => {
    const steps = r.analysis.plan.steps;
    expect(steps.filter((s) => s.manual).map((s) => s.no)).toEqual([1]);
    expect(steps.slice(1).every((s) => s.kind === "start" && !s.manual)).toBe(true);
    const placed = steps.flatMap((s) => s.nodes);
    const objects = r.graph.nodes.filter((n) => n.kind !== "External").map((n) => n.id);
    expect([...placed].sort()).toEqual([...objects].sort());
    // every hard dependency inside the plan starts in an earlier step
    const at = new Map(steps.flatMap((s) => s.nodes.map((n) => [n, s.no] as const)));
    for (const e of r.graph.edges) {
      const from = at.get(e.from);
      const to = at.get(e.to);
      if (from !== undefined && to !== undefined && e.from !== "Secret/argocd/repo-platform")
        expect(to < from, `${e.from} -> ${e.to}`).toBe(true);
    }
    expect(steps[1]?.nodes).toEqual(["Application/argocd/root"]);
  });
  it("states what it rests on: three externals declared available, one crank, the assumed Argo CD namespace", () => {
    expect(r.analysis.plan.assumes).toMatchObject({
      externals: EXTERNALS,
      cranks: ["crank:1"],
      argocdNamespace: ["Namespace/argocd"],
    });
  });
  it("keeps B4's argocd-namespace-assumed item an assumption: listed, owned by no node, no status changed", () => {
    const item = r.analysis.unresolved.find((u) => u.why === "argocd-namespace-assumed");
    expect(item).toMatchObject({ subject: "Namespace/argocd", owner: null });
    expect(r.analysis.unresolved.map((u) => u.why)).toEqual(["argocd-namespace-assumed"]);
    // the credential edges it made still order the Applications after the Secret
    expect(r.status.get("Application/argocd/platform")?.status).toBe("startable");
  });
  it("with one external left unspecified, the plan stops at what needs it (break the input)", () => {
    const partial = run(["ca-issuer", "both-edits"], (root) => {
      const c = fixtureConfig(`${root}/gitops`);
      return { ...c, externals: c.externals.filter((e) => e.name !== "aws-sts") };
    });
    expect(partial.status.get("ServiceAccount/vault/vault")).toMatchObject({
      status: "blocked",
      reason: "external-unspecified",
      blockers: ["external:aws-sts"],
    });
    expect(partial.analysis.plan.listedUnordered.length).toBeGreaterThan(0);
  });
});
