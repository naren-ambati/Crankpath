// ControllerSignatures (U5; US5.4, FR7.7, BR5.12, BR5.13, OD-16): the table of GitOps controller
// workloads used to name the self-management pattern in --explain. A source (an Application, or a
// Flux Kustomization or HelmRelease) that renders its own controller's workload is a black-start
// unit: only a `creates:` crank naming its first install cranks it.
//
// A match needs the workload kind, `apps/v1`, the upstream workload name (exactly, or with a Helm
// release prefix `<release>-<name>`) and both upstream labels (B6 review M1: labels alone matched
// any workload). Even so, every one of these is set by the repo: a match is an observation that
// --explain words as such ("carries the name and labels ..."), never a conclusion.
//
// Explanatory only. The match reads names and labels, which the scanned repo controls, so its result is never
// an edge, a node, a label, a status or a verdict: this module has no path into the graph, and the
// Report carries its matches for the --explain text alone (the JSON, text and Mermaid outputs are
// byte-identical with the table emptied; a test shows it).
//
// The labels are the upstream install's own (read-only lookups of 2026-11-15, docs/lookups.md):
// Argo CD v3.6.1 `manifests/base` and the argo-cd Helm chart (both set `app.kubernetes.io/part-of:
// argocd` and the component label), and Flux v2.9.6 `install.yaml` (`app.kubernetes.io/part-of:
// flux` and the component label).

import type { JobInfo, RenderedObject } from "../u1-graph-model/extractor.js";
import { IN_CLUSTER } from "../u1-graph-model/extractor.js";
import type { NodeId } from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";

export interface ControllerSignature {
  readonly signatureId: string;
  /** The workload kind the controller runs as. */
  readonly kind: string;
  /** The upstream workload name; a Helm release may prefix it (`<release>-<name>`). */
  readonly name: string;
  /** Labels the object must carry, every one with exactly this value. */
  readonly labels: Readonly<Record<string, string>>;
  /** crankpath's fixed name for the controller (printed bare: it is crankpath's text). */
  readonly controller: string;
  /** The GitOps tool whose self-management the match names. */
  readonly tool: "Argo CD" | "Flux";
}

function argo(id: string, kind: string, name: string, component: string, controller: string): ControllerSignature {
  return Object.freeze({
    signatureId: id,
    kind,
    name,
    labels: Object.freeze({ "app.kubernetes.io/component": component, "app.kubernetes.io/part-of": "argocd" }),
    controller,
    tool: "Argo CD",
  });
}

function flux(component: string): ControllerSignature {
  return Object.freeze({
    signatureId: `flux-${component}`,
    kind: "Deployment",
    name: component,
    labels: Object.freeze({ "app.kubernetes.io/component": component, "app.kubernetes.io/part-of": "flux" }),
    controller: `Flux's ${component}`,
    tool: "Flux",
  });
}

/** The signature table, sorted by id. */
export const CONTROLLER_SIGNATURES: readonly ControllerSignature[] = Object.freeze([
  // the upstream install runs the application controller as a StatefulSet; the argo-cd chart runs it
  // as a Deployment when `controller.dynamicClusterDistribution` is set
  argo(
    "argocd-application-controller",
    "StatefulSet",
    "argocd-application-controller",
    "application-controller",
    "Argo CD's application controller",
  ),
  argo(
    "argocd-application-controller-deployment",
    "Deployment",
    "argocd-application-controller",
    "application-controller",
    "Argo CD's application controller",
  ),
  argo(
    "argocd-applicationset-controller",
    "Deployment",
    "argocd-applicationset-controller",
    "applicationset-controller",
    "Argo CD's ApplicationSet controller",
  ),
  argo("argocd-repo-server", "Deployment", "argocd-repo-server", "repo-server", "Argo CD's repo server"),
  flux("helm-controller"),
  flux("kustomize-controller"),
  flux("source-controller"),
]);

export interface ControllerMatch {
  /** The source whose render holds the object (the render job's owner). */
  readonly owner: NodeId;
  /** The rendered object that matched. */
  readonly object: NodeId;
  readonly signatureId: string;
  readonly controller: string;
  readonly tool: ControllerSignature["tool"];
}

function matches(o: RenderedObject, s: ControllerSignature): boolean {
  if (o.kind !== s.kind || o.apiVersion !== "apps/v1") return false;
  if (o.name !== s.name && !o.name.endsWith(`-${s.name}`)) return false;
  for (const [k, v] of Object.entries(s.labels)) if (o.labels[k] !== v) return false;
  return true;
}

/**
 * Every rendered object that matches a signature, with the source that rendered it. Objects read
 * directly by discovery (no render job) and objects of a foreign destination have no owner here.
 * Sorted by owner, object and signature; one pass over the objects.
 */
export function matchControllerSignatures(
  objects: readonly RenderedObject[],
  jobs: readonly JobInfo[],
  table: readonly ControllerSignature[] = CONTROLLER_SIGNATURES,
): ControllerMatch[] {
  const jobById = new Map(jobs.map((j) => [j.jobId, j]));
  const byKind = new Map<string, ControllerSignature[]>();
  for (const s of table) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
  const out: ControllerMatch[] = [];
  for (const o of objects) {
    const candidates = byKind.get(o.kind);
    if (candidates === undefined || o.origin.renderJob === null) continue;
    const job = jobById.get(o.origin.renderJob);
    if (job === undefined || job.destination !== IN_CLUSTER) continue;
    for (const s of candidates) {
      if (!matches(o, s)) continue;
      out.push(
        Object.freeze({
          owner: job.owner,
          object: o.id,
          signatureId: s.signatureId,
          controller: s.controller,
          tool: s.tool,
        }),
      );
    }
  }
  return out.sort(
    (a, b) =>
      compareCodePoints(a.owner, b.owner) ||
      compareCodePoints(a.object, b.object) ||
      compareCodePoints(a.signatureId, b.signatureId),
  );
}
