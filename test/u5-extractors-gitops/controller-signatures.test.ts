// ControllerSignatures (US5.4; AC5.4.1, AC5.4.2, BR5.12, BR5.13, FR7.7): a source that renders its
// GitOps controller's own workload is named in --explain; the match is explanatory only, so every
// other output is byte-identical with the signature table emptied.

import { describe, expect, it } from "vitest";
import type { JobInfo } from "../../src/u1-graph-model/extractor.js";
import {
  CONTROLLER_SIGNATURES,
  matchControllerSignatures,
} from "../../src/u5-extractors-gitops/controller-signatures.js";
import { renderExplain, explainTarget } from "../../src/u8-output/explain-renderer.js";
import { renderJson } from "../../src/u8-output/json-renderer.js";
import { renderMermaid } from "../../src/u8-output/mermaid-renderer.js";
import { renderText } from "../../src/u8-output/text-renderer.js";
import { obj } from "../helpers/objects.js";
import { unwrapText } from "../helpers/text.js";
import { fixtureReport, SELF_MANAGED } from "../helpers/reports.js";

const JOB: JobInfo = {
  jobId: "Application/argocd/root#0",
  owner: "Application/argocd/root",
  ownerFile: "bootstrap/root.yaml",
  ownerField: "spec.source.path",
  ownerRenderedPath: "bootstrap/root.yaml#1",
  destination: "in-cluster",
};
const FOREIGN: JobInfo = {
  ...JOB,
  jobId: "Application/argocd/far#0",
  owner: "Application/argocd/far",
  destination: "https://far.example.org",
};

function workload(
  kind: string,
  name: string,
  labels: Record<string, string>,
  job: string | null = JOB.jobId,
  ns = "argocd",
) {
  return obj({ apiVersion: "apps/v1", kind, metadata: { name, namespace: ns, labels } }, { renderJob: job });
}
const ARGO = { "app.kubernetes.io/part-of": "argocd", "app.kubernetes.io/component": "application-controller" };
const FLUX = { "app.kubernetes.io/part-of": "flux", "app.kubernetes.io/component": "kustomize-controller" };

describe("matchControllerSignatures", () => {
  it("matches Argo CD's application controller (StatefulSet or Deployment), repo server and ApplicationSet controller, and Flux's controllers", () => {
    const objects = [
      workload("StatefulSet", "argocd-application-controller", ARGO),
      workload("Deployment", "argocd-argocd-application-controller", ARGO),
      workload("Deployment", "argocd-repo-server", { ...ARGO, "app.kubernetes.io/component": "repo-server" }),
      workload("Deployment", "kustomize-controller", FLUX, JOB.jobId, "flux-system"),
      workload(
        "Deployment",
        "helm-controller",
        { ...FLUX, "app.kubernetes.io/component": "helm-controller" },
        JOB.jobId,
        "flux-system",
      ),
    ];
    const m = matchControllerSignatures(objects, [JOB]);
    expect(m.map((x) => [x.owner, x.object, x.controller, x.tool])).toEqual([
      [
        "Application/argocd/root",
        "Deployment/argocd/argocd-argocd-application-controller",
        "Argo CD's application controller",
        "Argo CD",
      ],
      ["Application/argocd/root", "Deployment/argocd/argocd-repo-server", "Argo CD's repo server", "Argo CD"],
      ["Application/argocd/root", "Deployment/flux-system/helm-controller", "Flux's helm-controller", "Flux"],
      ["Application/argocd/root", "Deployment/flux-system/kustomize-controller", "Flux's kustomize-controller", "Flux"],
      [
        "Application/argocd/root",
        "StatefulSet/argocd/argocd-application-controller",
        "Argo CD's application controller",
        "Argo CD",
      ],
    ]);
  });
  it("needs the upstream name (or a release-prefixed one), every label, the workload kind and apps/v1", () => {
    const objects = [
      // the labels alone, on another workload, match nothing (review M1)
      workload("Deployment", "my-controller", ARGO),
      workload("Deployment", "gitea", { ...ARGO, "app.kubernetes.io/component": "repo-server" }),
      workload("Deployment", "argocd-repo-server-x", { ...ARGO, "app.kubernetes.io/component": "repo-server" }),
      workload("StatefulSet", "argocd-application-controller", { "app.kubernetes.io/part-of": "argocd" }),
      workload("StatefulSet", "argocd-application-controller-2", {
        "app.kubernetes.io/component": "application-controller",
      }),
      workload("DaemonSet", "x", ARGO),
      obj(
        { apiVersion: "apps/v1beta2", kind: "StatefulSet", metadata: { name: "y", namespace: "argocd", labels: ARGO } },
        { renderJob: JOB.jobId },
      ),
      workload("StatefulSet", "z", { ...ARGO, "app.kubernetes.io/part-of": "argocd-lookalike" }),
    ];
    expect(matchControllerSignatures(objects, [JOB])).toEqual([]);
  });
  it("names no owner for an object read directly by discovery or deployed to another cluster", () => {
    const objects = [workload("StatefulSet", "a", ARGO, null), workload("StatefulSet", "b", ARGO, FOREIGN.jobId)];
    expect(matchControllerSignatures(objects, [JOB, FOREIGN])).toEqual([]);
  });
  it("is a fixed table of Argo CD and Flux signatures, sorted by id", () => {
    const ids = CONTROLLER_SIGNATURES.map((s) => s.signatureId);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(CONTROLLER_SIGNATURES.map((s) => s.tool))).toEqual(new Set(["Argo CD", "Flux"]));
    expect(Object.isFrozen(CONTROLLER_SIGNATURES)).toBe(true);
  });
});

describe("the self-managed Argo CD fixture (AC5.4.1)", () => {
  const report = fixtureReport(SELF_MANAGED, "http://gitea-http.gitea:3000/ops/self-managed");
  const cycle = report.cycles.find((c) => c.nodes.includes("Application/argocd/root"));
  it("has a cycle through the root Application, which renders Argo CD's controller", () => {
    expect(cycle?.label).toBe("extracted");
    expect(report.controllerMatches.map((m) => [m.owner, m.object])).toEqual([
      ["Application/argocd/root", "Deployment/argocd/argocd-repo-server"],
      ["Application/argocd/root", "StatefulSet/argocd/argocd-application-controller"],
    ]);
  });
  it("names the self-management pattern in --explain for the cycle and for the root Application", () => {
    const target = explainTarget(report, cycle?.id);
    expect(target?.kind).toBe("cycle");
    const text = unwrapText(renderExplain(report, target as never));
    expect(text).toContain(
      '  self-management: pattern: an object this cycle\'s Application "argocd/root" renders, StatefulSet "argocd/argocd-application-controller", carries the name and labels Argo CD\'s application controller uses (name and labels set by the repo, not verified; this object is not on the cycle); if this is the controller\'s own install, a first-install crank breaks it',
    );
    const node = unwrapText(renderExplain(report, explainTarget(report, "Application/argocd/root") as never));
    expect(node).toContain(
      'self-management: pattern: an object this Application renders, Deployment "argocd/argocd-repo-server", carries the name and labels Argo CD\'s repo server uses',
    );
  });
  it("changes nothing else with the table emptied: labels, statuses, verdicts and the JSON, text and Mermaid bytes (AC5.4.2, BR5.13)", () => {
    const empty = fixtureReport(SELF_MANAGED, "http://gitea-http.gitea:3000/ops/self-managed", undefined, []);
    expect(empty.controllerMatches).toEqual([]);
    expect(empty.cycles).toEqual(report.cycles);
    expect(empty.statuses).toEqual(report.statuses);
    expect(empty.runStatus).toEqual(report.runStatus);
    expect(renderJson(empty)).toBe(renderJson(report));
    expect(renderText(empty)).toBe(renderText(report));
    expect(renderMermaid(empty)).toBe(renderMermaid(report));
    // only the explanation differs, and only in its self-management lines
    const target = explainTarget(report, cycle?.id) as never;
    const a = renderExplain(report, target).split("\n");
    const b = renderExplain(empty, target).split("\n");
    expect(a).not.toEqual(b);
    const strip = (lines: string[]) => {
      const out: string[] = [];
      let skipping = false;
      for (const l of lines) {
        if (l.startsWith("  self-management:")) skipping = true;
        else if (!l.startsWith("      ") && !l.startsWith("    a self-managed") && !/^ {4}\S/.test(l)) skipping = false;
        if (!skipping) out.push(l);
      }
      return out;
    };
    expect(strip(a)).toEqual(strip(b));
  });
});
