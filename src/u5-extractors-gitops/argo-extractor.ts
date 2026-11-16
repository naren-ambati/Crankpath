// ArgoExtractor core (U5; BR5.1 to BR5.4, FR5.1): every rendered object depends on the source
// that rendered it (`deployed-by`); a generated Application depends on its ApplicationSet
// (`generated-by`, once generator expansion sets it); an Application's source `repoURL`, and an
// ApplicationSet's git generator and template `repoURL`, depend on the in-estate Service their host
// matches (`reads-source`, from the named field only, whether or not the repo is readable: FR2.5);
// a sync-wave annotation is an ordering attribute, never an edge; objects of a foreign destination
// are flagged. A repoURL host that matches no Service and cannot be in-cluster is an external
// precondition (`external:<host>`, for example `github.com`); one that may be in-cluster is an
// item, never silence (see external-host.ts). Credentials
// (`needs-credential`) are the credential extractor's. Pure (C3).

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
  type RenderedObject,
} from "../u1-graph-model/extractor.js";
import { makeEdge } from "../u1-graph-model/graph-model.js";
import { unresolvedItem } from "../u1-graph-model/status-model.js";
import { repoUrlHost } from "../u2-intake-config/repo-identity.js";
import { estateNamespaces, placeHost } from "../u6-extractors-workload/external-host.js";

export const SYNC_WAVE_ANNOTATION = "argocd.argoproj.io/sync-wave";
const WAVE = /^[+-]?\d{1,15}$/;

function isArgo(object: RenderedObject, kind: string): boolean {
  return object.kind === kind && object.apiVersion.startsWith("argoproj.io/");
}

/** The named repoURL fields of an Application or ApplicationSet, with their field paths. */
export function repoUrlFields(object: RenderedObject): { field: string; url: string }[] {
  const out: { field: string; url: string }[] = [];
  const add = (field: string, v: DataValue | undefined) => {
    const url = asString(v);
    if (url !== undefined && url !== "") out.push({ field, url });
  };
  const body = object.body;
  if (isArgo(object, "Application")) {
    add("spec.source.repoURL", getPath(body, ["spec", "source", "repoURL"]));
    asArray(getPath(body, ["spec", "sources"])).forEach((s, i) => {
      add(`spec.sources[${i}].repoURL`, getPath(s, ["repoURL"]));
    });
  } else if (isArgo(object, "ApplicationSet")) {
    asArray(getPath(body, ["spec", "generators"])).forEach((g, i) => {
      add(`spec.generators[${i}].git.repoURL`, getPath(g, ["git", "repoURL"]));
      for (const combine of ["matrix", "merge"] as const) {
        asArray(getPath(g, [combine, "generators"])).forEach((inner, j) => {
          add(`spec.generators[${i}].${combine}.generators[${j}].git.repoURL`, getPath(inner, ["git", "repoURL"]));
        });
      }
    });
    add("spec.template.spec.source.repoURL", getPath(body, ["spec", "template", "spec", "source", "repoURL"]));
    asArray(getPath(body, ["spec", "template", "spec", "sources"])).forEach((s, i) => {
      add(`spec.template.spec.sources[${i}].repoURL`, getPath(s, ["repoURL"]));
    });
  }
  return out;
}

export const argoExtractor: Extractor = Object.freeze({
  name: "argo",
  extract(objects: readonly RenderedObject[], ctx: ExtractContext): ExtractResult {
    const out = emptyResult();
    const namespaces = estateNamespaces(objects);
    for (const object of objects) {
      let used = false;
      const file = object.origin.path ?? object.renderedPath;
      if (object.origin.renderJob !== null) {
        const job = ctx.jobs.get(object.origin.renderJob);
        if (job !== undefined) {
          used = true;
          out.edges.push(
            makeEdge({
              from: object.id,
              to: job.owner,
              kind: "deployed-by",
              source: "extracted",
              evidence: { file: job.ownerFile, field: job.ownerField, renderedPath: object.renderedPath, line: null },
            }),
          );
          if (job.destination !== IN_CLUSTER) out.flags.push({ node: object.id, flag: "foreign-destination" });
        }
      }
      if (object.generatedBy !== null) {
        used = true;
        out.edges.push(
          makeEdge({
            from: object.id,
            to: object.generatedBy,
            kind: "generated-by",
            source: "extracted",
            evidence: { file, field: "spec.generators", renderedPath: object.renderedPath, line: null },
          }),
        );
      }
      const wave = object.annotations[SYNC_WAVE_ANNOTATION];
      if (wave !== undefined) {
        used = true;
        const w = wave.trim();
        if (WAVE.test(w) && Number.isSafeInteger(Number(w))) out.syncWaves.push({ node: object.id, wave: Number(w) });
        else
          out.unresolved.push(
            unresolvedItem(
              object.id,
              "invalid-sync-wave",
              object.renderedPath,
              `metadata.annotations.${SYNC_WAVE_ANNOTATION}`,
            ),
          );
      }
      for (const { field, url } of repoUrlFields(object)) {
        used = true;
        const host = repoUrlHost(url);
        if (host === null) continue;
        placeHost(out, ctx, {
          from: object.id,
          evidence: object,
          host,
          field,
          kind: "reads-source",
          namespaces,
          bareNamespace: null,
        });
      }
      if (!used) out.ignoredKinds += 1;
    }
    return out;
  },
});
