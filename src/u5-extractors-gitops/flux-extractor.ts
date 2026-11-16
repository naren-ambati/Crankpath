// FluxExtractor (U5; BR5.9 to BR5.11, FR5.3): Flux's own dependency fields become edges.
// A Kustomization's `dependsOn` entries are hard `depends-on` edges to Kustomizations, a
// HelmRelease's to HelmReleases (namespace defaults to the object's own, as Flux does); a
// Kustomization's `sourceRef`, a HelmRelease's `chart.spec.sourceRef` and `chartRef` are
// `reads-source` edges to the named source; `valuesFrom` and `postBuild.substituteFrom` are
// `needs-config` or `needs-secret` edges by their `kind` (an entry marked `optional: true` is no
// edge: the object reconciles without it). A source object (GitRepository, HelmRepository,
// OCIRepository, Bucket) reads from the host of its `spec.url` (Bucket: `spec.endpoint`): a
// Service, an external precondition when the name cannot be in-cluster, else no edge and an item
// (ambiguous or unplaced; the source controller's own namespace is not in the estate, so a bare
// name states none); its `spec.secretRef` (the credential Flux uses to fetch it) is a
// `needs-secret` edge. A reference of a kind the field does not allow is `invalid-reference`.
// Pure (C3).

import {
  asArray,
  asString,
  type DataValue,
  type ExtractContext,
  type Extractor,
  type ExtractResult,
  emptyResult,
  getPath,
  isDataMap,
  type RenderedObject,
} from "../u1-graph-model/extractor.js";
import type { EdgeKind } from "../u1-graph-model/graph-model.js";
import { unresolvedItem } from "../u1-graph-model/status-model.js";
import { estateNamespaces, placeUrl } from "../u6-extractors-workload/external-host.js";
import { referTo } from "../u6-extractors-workload/references.js";

const KUSTOMIZE = "kustomize.toolkit.fluxcd.io/";
const HELM = "helm.toolkit.fluxcd.io/";
const SOURCE = "source.toolkit.fluxcd.io/";

export const SOURCE_KINDS: ReadonlySet<string> = new Set([
  "Bucket",
  "GitRepository",
  "HelmRepository",
  "OCIRepository",
]);
const KUSTOMIZATION_SOURCES: ReadonlySet<string> = new Set(["Bucket", "GitRepository", "OCIRepository"]);
const CHART_SOURCES: ReadonlySet<string> = new Set(["Bucket", "GitRepository", "HelmRepository"]);
const CHART_REFS: ReadonlySet<string> = new Set(["HelmChart", "OCIRepository"]);
const VALUE_KINDS: Readonly<Record<string, { kind: EdgeKind; target: string }>> = Object.freeze({
  ConfigMap: { kind: "needs-config", target: "ConfigMap" },
  Secret: { kind: "needs-secret", target: "Secret" },
});

function namespaceOf(ref: DataValue | undefined, object: RenderedObject): string | null {
  const ns = getPath(ref, ["namespace"]);
  return typeof ns === "string" ? ns : object.namespace;
}

export const fluxExtractor: Extractor = Object.freeze({
  name: "flux",
  extract(objects: readonly RenderedObject[], ctx: ExtractContext): ExtractResult {
    const out = emptyResult();
    const namespaces = estateNamespaces(objects);
    let read = 0;

    const sourceRef = (o: RenderedObject, ref: DataValue | undefined, field: string, allowed: ReadonlySet<string>) => {
      if (!isDataMap(ref)) return;
      const kind = asString(ref.kind);
      if (kind === undefined || !allowed.has(kind)) {
        out.unresolved.push(unresolvedItem(o.id, "invalid-reference", o.renderedPath, `${field}.kind`));
        return;
      }
      referTo(out, o, "reads-source", kind, namespaceOf(ref, o), ref.name, `${field}.name`);
    };
    const valueRefs = (o: RenderedObject, list: DataValue | undefined, field: string) => {
      asArray(list).forEach((entry, i) => {
        if (!isDataMap(entry) || entry.optional === true) return;
        const target = VALUE_KINDS[asString(entry.kind) ?? ""];
        if (target === undefined) {
          out.unresolved.push(unresolvedItem(o.id, "invalid-reference", o.renderedPath, `${field}[${i}].kind`));
          return;
        }
        referTo(out, o, target.kind, target.target, o.namespace, entry.name, `${field}[${i}].name`);
      });
    };
    const dependsOn = (o: RenderedObject, kind: string) => {
      asArray(getPath(o.body, ["spec", "dependsOn"])).forEach((d, i) => {
        if (!isDataMap(d)) return;
        referTo(out, o, "depends-on", kind, namespaceOf(d, o), d.name, `spec.dependsOn[${i}].name`);
      });
    };

    for (const o of objects) {
      if (o.kind === "Kustomization" && o.apiVersion.startsWith(KUSTOMIZE)) {
        read += 1;
        dependsOn(o, "Kustomization");
        sourceRef(o, getPath(o.body, ["spec", "sourceRef"]), "spec.sourceRef", KUSTOMIZATION_SOURCES);
        valueRefs(o, getPath(o.body, ["spec", "postBuild", "substituteFrom"]), "spec.postBuild.substituteFrom");
      } else if (o.kind === "HelmRelease" && o.apiVersion.startsWith(HELM)) {
        read += 1;
        dependsOn(o, "HelmRelease");
        sourceRef(
          o,
          getPath(o.body, ["spec", "chart", "spec", "sourceRef"]),
          "spec.chart.spec.sourceRef",
          CHART_SOURCES,
        );
        sourceRef(o, getPath(o.body, ["spec", "chartRef"]), "spec.chartRef", CHART_REFS);
        valueRefs(o, getPath(o.body, ["spec", "valuesFrom"]), "spec.valuesFrom");
      } else if (SOURCE_KINDS.has(o.kind) && o.apiVersion.startsWith(SOURCE)) {
        read += 1;
        const field = o.kind === "Bucket" ? "spec.endpoint" : "spec.url";
        placeUrl(
          out,
          ctx,
          { from: o.id, evidence: o, field, kind: "reads-source", namespaces, bareNamespace: null },
          getPath(o.body, field.split(".")),
        );
        const secret = getPath(o.body, ["spec", "secretRef"]);
        if (isDataMap(secret))
          referTo(out, o, "needs-secret", "Secret", o.namespace, secret.name, "spec.secretRef.name");
      }
    }
    out.ignoredKinds = objects.length - read;
    return out;
  },
});
