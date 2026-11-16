// WorkloadRefExtractor (U6; BR6.7 to BR6.9, FR5.6): the Pod-template references of Deployments,
// StatefulSets, DaemonSets, Jobs and CronJobs (init containers included) become `needs-secret`,
// `needs-config` and `runs-as` edges; a Service depends on the one workload its selector matches
// (`selects`), and a selector matching more than one creates no edge and an unresolved ambiguity.
// A reference marked `optional: true` is no edge (the Pod starts without it). Pure (C3).

import {
  asArray,
  asString,
  type DataValue,
  type ExtractContext,
  type Extractor,
  type ExtractResult,
  emptyResult,
  getPath,
  IN_CLUSTER,
  isDataMap,
  type RenderedObject,
} from "../u1-graph-model/extractor.js";
import { type EdgeKind, makeEdge, type NodeId, objectId } from "../u1-graph-model/graph-model.js";
import { unresolvedItem } from "../u1-graph-model/status-model.js";

/** Workload kinds and where their Pod template is. */
export const WORKLOAD_TEMPLATES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Deployment: ["spec", "template"],
  StatefulSet: ["spec", "template"],
  DaemonSet: ["spec", "template"],
  Job: ["spec", "template"],
  CronJob: ["spec", "jobTemplate", "spec", "template"],
});

function bucketOf(object: RenderedObject, ctx: ExtractContext): string {
  const job = object.origin.renderJob === null ? undefined : ctx.jobs.get(object.origin.renderJob);
  return job === undefined ? IN_CLUSTER : job.destination;
}

function stringLabels(value: DataValue | undefined): Record<string, string> | undefined {
  if (!isDataMap(value)) return undefined;
  const out: Record<string, string> = {};
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (typeof v !== "string") return undefined;
    Object.defineProperty(out, k, { value: v, enumerable: true });
  }
  return out;
}

function podLabels(object: RenderedObject): Readonly<Record<string, string>> {
  const path = WORKLOAD_TEMPLATES[object.kind] as readonly string[];
  const labels = getPath(object.body, [...path, "metadata", "labels"]);
  const out: Record<string, string> = {};
  if (!isDataMap(labels)) return out;
  for (const k of Object.keys(labels)) {
    const v = labels[k];
    if (typeof v === "string") Object.defineProperty(out, k, { value: v, enumerable: true });
  }
  return out;
}

export const workloadRefExtractor: Extractor = Object.freeze({
  name: "workload-refs",
  extract(objects: readonly RenderedObject[], ctx: ExtractContext): ExtractResult {
    const out = emptyResult();
    const workloads = objects.filter((o) => Object.hasOwn(WORKLOAD_TEMPLATES, o.kind));

    const ref = (
      from: RenderedObject,
      kind: EdgeKind,
      targetKind: string,
      name: DataValue | undefined,
      field: string,
    ) => {
      const raw = asString(name);
      if (raw === undefined) return;
      const id = objectId(targetKind, from.namespace, raw);
      if (!id.ok) {
        out.unresolved.push(unresolvedItem(raw, "invalid-reference", from.renderedPath, field));
        return;
      }
      out.edges.push(
        makeEdge({
          from: from.id,
          to: id.id,
          kind,
          source: "extracted",
          evidence: { file: from.origin.path ?? from.renderedPath, field, renderedPath: from.renderedPath, line: null },
        }),
      );
    };
    const optional = (v: DataValue | undefined) => isDataMap(v) && v.optional === true;

    for (const w of workloads) {
      const tpl = WORKLOAD_TEMPLATES[w.kind] as readonly string[];
      const base = `${tpl.join(".")}.spec`;
      const pod = getPath(w.body, [...tpl, "spec"]);
      if (!isDataMap(pod)) continue;
      for (const list of ["initContainers", "containers"] as const) {
        asArray(pod[list]).forEach((c, i) => {
          const at = `${base}.${list}[${i}]`;
          asArray(getPath(c, ["envFrom"])).forEach((e, j) => {
            const s = getPath(e, ["secretRef"]);
            if (s !== undefined && !optional(s))
              ref(w, "needs-secret", "Secret", getPath(s, ["name"]), `${at}.envFrom[${j}].secretRef.name`);
            const m = getPath(e, ["configMapRef"]);
            if (m !== undefined && !optional(m))
              ref(w, "needs-config", "ConfigMap", getPath(m, ["name"]), `${at}.envFrom[${j}].configMapRef.name`);
          });
          asArray(getPath(c, ["env"])).forEach((e, j) => {
            const s = getPath(e, ["valueFrom", "secretKeyRef"]);
            if (s !== undefined && !optional(s)) {
              ref(w, "needs-secret", "Secret", getPath(s, ["name"]), `${at}.env[${j}].valueFrom.secretKeyRef.name`);
            }
            const m = getPath(e, ["valueFrom", "configMapKeyRef"]);
            if (m !== undefined && !optional(m)) {
              ref(
                w,
                "needs-config",
                "ConfigMap",
                getPath(m, ["name"]),
                `${at}.env[${j}].valueFrom.configMapKeyRef.name`,
              );
            }
          });
        });
      }
      asArray(pod.volumes).forEach((v, k) => {
        const at = `${base}.volumes[${k}]`;
        const secret = getPath(v, ["secret"]);
        if (secret !== undefined && !optional(secret))
          ref(w, "needs-secret", "Secret", getPath(secret, ["secretName"]), `${at}.secret.secretName`);
        const cm = getPath(v, ["configMap"]);
        if (cm !== undefined && !optional(cm))
          ref(w, "needs-config", "ConfigMap", getPath(cm, ["name"]), `${at}.configMap.name`);
        asArray(getPath(v, ["projected", "sources"])).forEach((p, m) => {
          const ps = getPath(p, ["secret"]);
          if (ps !== undefined && !optional(ps))
            ref(w, "needs-secret", "Secret", getPath(ps, ["name"]), `${at}.projected.sources[${m}].secret.name`);
          const pc = getPath(p, ["configMap"]);
          if (pc !== undefined && !optional(pc))
            ref(w, "needs-config", "ConfigMap", getPath(pc, ["name"]), `${at}.projected.sources[${m}].configMap.name`);
        });
      });
      asArray(pod.imagePullSecrets).forEach((s, k) => {
        ref(w, "needs-secret", "Secret", getPath(s, ["name"]), `${base}.imagePullSecrets[${k}].name`);
      });
      if (typeof pod.serviceAccountName === "string")
        ref(w, "runs-as", "ServiceAccount", pod.serviceAccountName, `${base}.serviceAccountName`);
      else if (typeof pod.serviceAccount === "string")
        ref(w, "runs-as", "ServiceAccount", pod.serviceAccount, `${base}.serviceAccount`);
    }

    // Index workloads by (namespace, destination, one label pair), so a Service's selector looks at
    // the workloads holding its rarest pair, not at every workload (B1 review m3).
    const byPair = new Map<string, { w: RenderedObject; labels: Readonly<Record<string, string>> }[]>();
    for (const w of workloads) {
      const labels = podLabels(w);
      const scope = `${w.namespace}\n${bucketOf(w, ctx)}`;
      for (const k of Object.keys(labels)) {
        const key = `${scope}\n${k}\n${labels[k]}`;
        const list = byPair.get(key) ?? [];
        list.push({ w, labels });
        byPair.set(key, list);
      }
    }
    let read = workloads.length;
    for (const svc of objects) {
      if (svc.kind !== "Service" || svc.apiVersion !== "v1") continue;
      read += 1;
      const raw = getPath(svc.body, ["spec", "selector"]);
      if (raw === undefined || raw === null || (isDataMap(raw) && Object.keys(raw).length === 0)) continue;
      const selector = stringLabels(raw);
      if (selector === undefined) {
        out.unresolved.push(unresolvedItem(svc.id, "selector-invalid", svc.renderedPath, "spec.selector"));
        continue;
      }
      const scope = `${svc.namespace}\n${bucketOf(svc, ctx)}`;
      const keys = Object.keys(selector);
      let candidates: { w: RenderedObject; labels: Readonly<Record<string, string>> }[] | undefined;
      for (const k of keys) {
        const list = byPair.get(`${scope}\n${k}\n${selector[k]}`) ?? [];
        if (candidates === undefined || list.length < candidates.length) candidates = list;
      }
      // Two matches already make the selector ambiguous: the first two in id order are listed, and
      // the search stops at a third, which only shows that the list is not the whole set.
      const unique: NodeId[] = [];
      let truncated = false;
      for (const x of candidates ?? []) {
        if (!keys.every((k) => x.labels[k] === selector[k]) || unique.includes(x.w.id)) continue;
        if (unique.length === 2) {
          truncated = true;
          break;
        }
        unique.push(x.w.id);
      }
      if (unique.length === 1) {
        out.edges.push(
          makeEdge({
            from: svc.id,
            to: unique[0] as NodeId,
            kind: "selects",
            source: "extracted",
            evidence: {
              file: svc.origin.path ?? svc.renderedPath,
              field: "spec.selector",
              renderedPath: svc.renderedPath,
              line: null,
            },
          }),
        );
      } else if (unique.length > 1) {
        out.unresolved.push(
          unresolvedItem(svc.id, "selector-ambiguous", svc.renderedPath, "spec.selector", unique, truncated),
        );
      }
    }
    out.ignoredKinds = objects.length - read;
    return out;
  },
});
