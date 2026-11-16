// RenderPlanner (U3; BR3.4 to BR3.9, BR3.15 to BR3.19, FR3.1, FR3.2, FR3.5, FR3.6, FR3.11, FR3.12):
// turns each source into render jobs or one opaque mark with exactly one reason and what could not
// be seen. Argo CD Applications (one source or several), Flux Kustomizations and HelmReleases, and
// Kustomize roots are planned here; the supported fields are closed lists (anything else is
// `unsupported-field` naming the field), so nothing is silently left out. The planner reads no
// file content: it asks RepoIdentity whether a repoURL is readable, the tree for a directory's
// entry names (to tell a plain directory from a Helm chart or a Kustomize root, as Argo CD does),
// and the repo's own objects for what a Flux source names. A chart source names a chart repository
// or registry and carries no repo identity (FR3.12); a path source is a Git repo and does.

import type { DataMap, DataValue, RenderedObject, RepoResolution } from "../u1-graph-model/extractor.js";
import { asArray, asString, getPath, IN_CLUSTER, isDataMap } from "../u1-graph-model/extractor.js";
import { redactUrl } from "../u1-graph-model/safe-text.js";
import { canonicalPath } from "../u2-intake-config/bounded-reader.js";
import { canonicalDir } from "../u2-intake-config/tree-walk.js";
import { CHART_NAME, isFloatingVersion, isUsableVersion } from "../u4-render-engine/chart-cache.js";
import { guardChartUrl, URL_PROBLEM_WORDS } from "../u4-render-engine/url-guard.js";
import { planHelmRelease, planKustomization } from "./flux-planner.js";
import {
  destinationKey,
  helmJob,
  insideRoot,
  isValidReleaseName,
  nonEmpty,
  type Owner,
  opaque,
  ownerBase,
  type PlanContext,
  type PlanResult,
  type PlanSource,
  RENDERS,
  UNDER_PATH,
  unreadableRepo,
} from "./plan-common.js";
import type { FloatingRef, HelmValues, KustomizeJob, PlainJob, RenderJob } from "./render-job.js";

export {
  type DirectoryProbe,
  destinationKey,
  IN_CLUSTER_SERVER,
  type PlanContext,
  type PlanReference,
  type PlanResult,
  type PlanSource,
  type RepoObject,
} from "./plan-common.js";
import { KUSTOMIZATION_FILES } from "./source-discovery.js";

const SOURCE_FIELDS = new Set([
  "repoURL",
  "path",
  "targetRevision",
  "chart",
  "helm",
  "kustomize",
  "directory",
  "plugin",
  "ref",
  "name",
]);
const DIRECTORY_FIELDS = new Set(["recurse", "include", "exclude", "jsonnet"]);
/** Argo CD `helm` fields crankpath applies (or that cannot change what helm renders here). */
const HELM_FIELDS = new Set([
  "releaseName",
  "valueFiles",
  "values",
  "valuesObject",
  "namespace",
  "ignoreMissingValueFiles",
  "skipCrds",
  "skipTests",
  "skipSchemaValidation",
  "passCredentials",
  "version",
  "parameters",
  "fileParameters",
  "kubeVersion",
  "apiVersions",
]);
/** Argo CD `helm` fields that change the render and are not applied: named when non-empty. */
const HELM_UNSUPPORTED = ["parameters", "fileParameters", "kubeVersion", "apiVersions"] as const;
const FULL_SHA = /^[0-9a-f]{40}$/;

/** A path inside a chart (a values file of a chart from a repository): canonical, never `..`. */
function chartRelative(rel: string): string | null {
  const c = canonicalPath(rel);
  return c.ok ? c.path : null;
}

interface ArgoSource {
  readonly index: number;
  /** `spec.source` or `spec.sources[i]`. */
  readonly base: string;
  readonly value: { [key: string]: DataValue };
}

type Planned =
  | { readonly ok: true; readonly job: RenderJob | null }
  | { readonly ok: false; readonly result: PlanResult };

function failed(result: PlanResult): Planned {
  return { ok: false, result };
}

function floatingRevision(src: ArgoSource): FloatingRef[] {
  const tr = asString(src.value.targetRevision);
  if (tr !== undefined && FULL_SHA.test(tr)) return [];
  return [{ field: `${src.base}.targetRevision`, value: tr === undefined || tr === "" ? "HEAD" : tr }];
}

/** Plans the Argo CD `helm` options of one source into values, release name and flags. */
function helmOptions(
  o: Owner,
  src: ArgoSource,
  chartRoot: { root: string; dir: string } | null,
  refs: ReadonlyMap<string, { readonly resolution: RepoResolution; readonly url: string; readonly base: string }>,
):
  | {
      ok: true;
      releaseName: string;
      namespace: string | null;
      values: HelmValues[];
      includeCrds: boolean;
      skip: boolean;
    }
  | { ok: false; result: PlanResult } {
  const helm = src.value.helm;
  const f = (k: string) => `${src.base}.helm.${k}`;
  if (helm !== undefined && helm !== null && !isDataMap(helm)) {
    return {
      ok: false,
      result: opaque("unsupported-field", RENDERS, { field: `${src.base}.helm`, detail: "not a mapping" }),
    };
  }
  const h: { [key: string]: DataValue } = isDataMap(helm) ? helm : {};
  for (const key of Object.keys(h).sort()) {
    if (!HELM_FIELDS.has(key)) {
      return {
        ok: false,
        result: opaque("unsupported-field", RENDERS, { field: f(key), detail: "not a supported field" }),
      };
    }
  }
  for (const key of HELM_UNSUPPORTED) {
    if (nonEmpty(h[key])) {
      return {
        ok: false,
        result: opaque("unsupported-field", RENDERS, { field: f(key), detail: "not applied by crankpath" }),
      };
    }
  }
  const version = asString(h.version);
  if (h.version !== undefined && version !== "" && version !== "v3" && version !== "3") {
    return {
      ok: false,
      result: opaque("unsupported-field", RENDERS, { field: f("version"), detail: "only Helm 3 rendering is read" }),
    };
  }
  const release = asString(h.releaseName);
  const releaseName = release === undefined || release === "" ? o.object.name : release;
  if (!isValidReleaseName(releaseName)) {
    return {
      ok: false,
      result: opaque("unsupported-field", RENDERS, {
        field: release === undefined || release === "" ? "metadata.name" : f("releaseName"),
        value: releaseName,
        detail: "not a Helm release name (at most 53 characters of a DNS subdomain)",
      }),
    };
  }
  const ns = asString(h.namespace);
  const namespace = ns !== undefined && ns !== "" ? ns : o.namespace;
  const optional = h.ignoreMissingValueFiles === true;
  const values: HelmValues[] = [];
  const valueFiles = asArray(h.valueFiles);
  for (let j = 0; j < valueFiles.length; j++) {
    const vf = valueFiles[j];
    const field = `${f("valueFiles")}[${j}]`;
    if (typeof vf !== "string" || vf === "") {
      return { ok: false, result: opaque("unsupported-field", RENDERS, { field, detail: "not a string" }) };
    }
    if (vf.includes("://")) {
      return {
        ok: false,
        result: opaque("unsupported-field", RENDERS, {
          field,
          value: redactUrl(vf) ?? null,
          detail: "a values file at a URL is never fetched",
        }),
      };
    }
    if (/[*?[]/.test(vf)) {
      return {
        ok: false,
        result: opaque("unsupported-field", RENDERS, {
          field,
          value: vf,
          detail: "a values file glob is not expanded",
        }),
      };
    }
    if (vf.startsWith("$")) {
      const slash = vf.indexOf("/");
      const refName = slash === -1 ? vf.slice(1) : vf.slice(1, slash);
      const ref = refs.get(refName);
      if (ref === undefined) {
        return {
          ok: false,
          result: opaque("unsupported-field", RENDERS, {
            field,
            value: vf,
            detail: "names no ref source of this Application",
          }),
        };
      }
      if (ref.resolution.outcome === "unreadable")
        return {
          ok: false,
          result: unreadableRepo(ref.url, ref.resolution, `${ref.base}.repoURL`, "edges from inside values"),
        };
      const p = slash === -1 ? null : chartRelative(vf.slice(slash + 1));
      if (p === null) {
        return {
          ok: false,
          result: opaque("unreadable-file", "edges from inside values", {
            field,
            value: vf,
            detail: "outside the scanned root",
          }),
        };
      }
      values.push({ kind: "file", root: ref.resolution.root ?? ".", path: p, field, optional });
      continue;
    }
    if (vf.includes("$")) {
      return {
        ok: false,
        result: opaque("unsupported-field", RENDERS, {
          field,
          value: vf,
          detail: "build environment variables are not substituted",
        }),
      };
    }
    if (chartRoot === null) {
      const p = chartRelative(vf);
      if (p === null) {
        return {
          ok: false,
          result: opaque("unreadable-file", "edges from inside values", {
            field,
            value: vf,
            detail: "outside the chart",
          }),
        };
      }
      values.push({ kind: "chart-file", path: p, field, optional });
    } else {
      const p = insideRoot(chartRoot.dir, vf);
      if (p === null || p === "") {
        return {
          ok: false,
          result: opaque("unreadable-file", "edges from inside values", {
            field,
            value: vf,
            detail: "outside the scanned root",
          }),
        };
      }
      values.push({ kind: "file", root: chartRoot.root, path: p, field, optional });
    }
  }
  // Argo CD: valuesObject replaces values when both are set, and both come after the value files.
  if (h.valuesObject !== undefined && h.valuesObject !== null) {
    if (!isDataMap(h.valuesObject)) {
      return {
        ok: false,
        result: opaque("unsupported-field", RENDERS, { field: f("valuesObject"), detail: "not a mapping" }),
      };
    }
    values.push({ kind: "object", value: h.valuesObject, field: f("valuesObject") });
  } else if (h.values !== undefined && h.values !== null && h.values !== "") {
    if (typeof h.values !== "string") {
      return {
        ok: false,
        result: opaque("unsupported-field", RENDERS, { field: f("values"), detail: "not a string" }),
      };
    }
    values.push({ kind: "inline", text: h.values, field: f("values") });
  }
  return {
    ok: true,
    releaseName,
    namespace,
    values,
    includeCrds: h.skipCrds !== true,
    skip: h.skipSchemaValidation === true,
  };
}

function checkFields(src: ArgoSource): PlanResult | null {
  for (const key of Object.keys(src.value).sort()) {
    if (!SOURCE_FIELDS.has(key)) {
      return opaque("unsupported-field", RENDERS, { field: `${src.base}.${key}`, detail: "not a supported field" });
    }
  }
  if (src.value.plugin !== undefined) {
    return opaque("unsupported-field", RENDERS, { field: `${src.base}.plugin`, detail: "plugins are never run" });
  }
  return null;
}

/** Plans one Argo CD source (`spec.source` or one of `spec.sources`). */
function planArgoSource(
  o: Owner,
  src: ArgoSource,
  ctx: PlanContext,
  refs: ReadonlyMap<string, { readonly resolution: RepoResolution; readonly url: string; readonly base: string }>,
  multi: boolean,
): Planned {
  const v = src.value;
  const fieldError = checkFields(src);
  if (fieldError !== null) return failed(fieldError);
  const repoURL = asString(v.repoURL);
  if (repoURL === undefined || repoURL === "") {
    return failed(
      opaque("unsupported-field", RENDERS, { field: `${src.base}.repoURL`, detail: "missing or not a string" }),
    );
  }
  if (v.chart !== undefined) {
    const chart = asString(v.chart);
    if (chart === undefined || !CHART_NAME.test(chart)) {
      return failed(
        opaque("unsupported-field", RENDERS, {
          field: `${src.base}.chart`,
          value: chart ?? null,
          detail: "not a chart name crankpath can use",
        }),
      );
    }
    const guarded = guardChartUrl(repoURL);
    if (!guarded.ok) {
      const detail = repoURL.includes("://")
        ? URL_PROBLEM_WORDS[guarded.problem]
        : "a chart repository URL without https:// or oci:// (OCI per repository settings crankpath cannot see)";
      return failed(
        opaque("unsupported-field", RENDERS, {
          field: `${src.base}.repoURL`,
          value: redactUrl(repoURL) ?? null,
          detail,
        }),
      );
    }
    for (const k of ["kustomize", "directory", "path"] as const) {
      if (nonEmpty(v[k]))
        return failed(
          opaque("unsupported-field", RENDERS, { field: `${src.base}.${k}`, detail: "not read with a chart" }),
        );
    }
    const tr = asString(v.targetRevision) ?? "";
    if (tr !== "" && !isUsableVersion(tr)) {
      return failed(
        opaque("unsupported-field", RENDERS, {
          field: `${src.base}.targetRevision`,
          value: tr,
          detail: "not a version or version range crankpath can use",
        }),
      );
    }
    const options = helmOptions(o, src, null, refs);
    if (!options.ok) return failed(options.result);
    const floating: FloatingRef[] = isFloatingVersion(tr === "" ? null : tr)
      ? [{ field: `${src.base}.targetRevision`, value: tr === "" ? "*" : tr }]
      : [];
    return {
      ok: true,
      job: helmJob(ownerBase({ ...o, namespace: options.namespace }, src.index, `${src.base}.chart`), {
        chart: {
          from: "repository",
          url: guarded.url,
          oci: guarded.scheme === "oci",
          name: chart,
          version: tr === "" ? null : tr,
        },
        releaseName: options.releaseName,
        values: options.values,
        includeCrds: options.includeCrds,
        skipSchemaValidation: options.skip,
        floating,
        repo: null,
      }),
    };
  }
  const rawPath = v.path === undefined || v.path === null ? "" : v.path;
  if (typeof rawPath !== "string") {
    return failed(opaque("unsupported-field", RENDERS, { field: `${src.base}.path`, detail: "not a string" }));
  }
  // A source with only `ref` (and no path) gives values to the others and renders nothing (Argo CD).
  if (multi && asString(v.ref) !== undefined && rawPath === "") return { ok: true, job: null };
  const resolution = ctx.resolveRepo(repoURL);
  if (resolution.outcome === "unreadable")
    return failed(unreadableRepo(repoURL, resolution, `${src.base}.repoURL`, UNDER_PATH));
  const root = resolution.root ?? ".";
  const canon = canonicalDir(rawPath);
  if (!canon.ok) {
    return failed(
      opaque("unreadable-file", UNDER_PATH, {
        field: `${src.base}.path`,
        value: rawPath,
        detail: canon.refusal.reasonWord,
      }),
    );
  }
  const probe = ctx.probeDirectory(root, canon.path);
  if (!probe.ok) {
    return failed(
      opaque("unreadable-file", UNDER_PATH, { field: `${src.base}.path`, value: rawPath, detail: probe.reasonWord }),
    );
  }
  const floating = floatingRevision(src);
  const explicit = ["helm", "kustomize", "directory"].filter((k) => v[k] !== undefined && v[k] !== null);
  if (explicit.length > 1) {
    return failed(
      opaque("unsupported-field", RENDERS, {
        field: `${src.base}.${explicit[1]}`,
        detail: "more than one source type",
      }),
    );
  }
  const type =
    explicit[0] ??
    (probe.names.includes("Chart.yaml")
      ? "helm"
      : probe.names.some((n) => KUSTOMIZATION_FILES.has(n))
        ? "kustomize"
        : "directory");
  const base = ownerBase(o, src.index, `${src.base}.path`);
  const source = Object.freeze({
    repo: resolution,
    path: canon.path,
    chart: null,
    version: null,
    floating: floating.length > 0,
  });
  if (type === "helm") {
    const options = helmOptions(o, src, { root, dir: canon.path }, refs);
    if (!options.ok) return failed(options.result);
    return {
      ok: true,
      job: helmJob(ownerBase({ ...o, namespace: options.namespace }, src.index, `${src.base}.path`), {
        chart: { from: "repo", root, dir: canon.path },
        releaseName: options.releaseName,
        values: options.values,
        includeCrds: options.includeCrds,
        skipSchemaValidation: options.skip,
        floating,
        repo: resolution,
      }),
    };
  }
  if (type === "kustomize") {
    const k = v.kustomize;
    if (k !== undefined && k !== null && !isDataMap(k)) {
      return failed(opaque("unsupported-field", RENDERS, { field: `${src.base}.kustomize`, detail: "not a mapping" }));
    }
    for (const key of Object.keys(isDataMap(k) ? k : {}).sort()) {
      if (nonEmpty((k as DataMap)[key])) {
        return failed(
          opaque("unsupported-field", RENDERS, {
            field: `${src.base}.kustomize.${key}`,
            detail: "not applied by crankpath",
          }),
        );
      }
    }
    const job: KustomizeJob = Object.freeze({
      ...base,
      kind: "kustomize",
      releaseName: null,
      valuesInputs: Object.freeze([]),
      source,
      floating: Object.freeze(floating),
      root,
      dir: canon.path,
    });
    return { ok: true, job };
  }
  let recurse = false;
  const directory = v.directory;
  if (directory !== undefined && directory !== null) {
    if (!isDataMap(directory)) {
      return failed(opaque("unsupported-field", RENDERS, { field: `${src.base}.directory`, detail: "not a mapping" }));
    }
    for (const key of Object.keys(directory).sort()) {
      if (!DIRECTORY_FIELDS.has(key)) {
        return failed(
          opaque("unsupported-field", RENDERS, {
            field: `${src.base}.directory.${key}`,
            detail: "not a supported field",
          }),
        );
      }
    }
    for (const key of ["include", "exclude", "jsonnet"] as const) {
      if (nonEmpty(directory[key])) {
        return failed(
          opaque("unsupported-field", RENDERS, { field: `${src.base}.directory.${key}`, detail: "not supported" }),
        );
      }
    }
    if (directory.recurse !== undefined) {
      if (typeof directory.recurse !== "boolean") {
        return failed(
          opaque("unsupported-field", RENDERS, { field: `${src.base}.directory.recurse`, detail: "not a boolean" }),
        );
      }
      recurse = directory.recurse;
    }
  }
  const job: PlainJob = Object.freeze({
    ...base,
    kind: "plain",
    releaseName: null,
    valuesInputs: Object.freeze([]),
    source,
    floating: Object.freeze(floating),
    root,
    dir: canon.path,
    recurse,
  });
  return { ok: true, job };
}

function planApplication(object: RenderedObject, ctx: PlanContext): PlanResult {
  const spec = getPath(object.body, ["spec"]);
  if (!isDataMap(spec))
    return opaque("unsupported-field", RENDERS, { field: "spec", detail: "missing or not a mapping" });
  const destination = spec.destination;
  const ns = getPath(destination, ["namespace"]);
  const o: Owner = {
    object,
    destination: destinationKey(destination),
    namespace: typeof ns === "string" && ns !== "" ? ns : null,
  };
  const multi = Array.isArray(spec.sources) && spec.sources.length > 0;
  if (spec.sources !== undefined && spec.sources !== null && !Array.isArray(spec.sources)) {
    return opaque("unsupported-field", RENDERS, { field: "spec.sources", detail: "not a list" });
  }
  const sources: ArgoSource[] = [];
  if (multi) {
    const list = spec.sources as DataValue[];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!isDataMap(s))
        return opaque("unsupported-field", RENDERS, { field: `spec.sources[${i}]`, detail: "not a mapping" });
      sources.push({ index: i, base: `spec.sources[${i}]`, value: s });
    }
  } else {
    if (!isDataMap(spec.source)) {
      return opaque("unsupported-field", RENDERS, { field: "spec.source", detail: "missing or not a mapping" });
    }
    sources.push({ index: 0, base: "spec.source", value: spec.source });
  }
  // `ref` sources (FR3.2): their files are readable for `$ref/...` values only under the repo-identity rule.
  const refs = new Map<string, { resolution: RepoResolution; url: string; base: string }>();
  if (multi) {
    for (const s of sources) {
      const ref = asString(s.value.ref);
      if (ref === undefined || ref === "") continue;
      const url = asString(s.value.repoURL) ?? "";
      if (refs.has(ref))
        return opaque("unsupported-field", RENDERS, {
          field: `${s.base}.ref`,
          value: ref,
          detail: "two sources with one ref",
        });
      refs.set(ref, { resolution: ctx.resolveRepo(url), url, base: s.base });
    }
  }
  const jobs: RenderJob[] = [];
  for (const s of sources) {
    const planned = planArgoSource(o, s, ctx, refs, multi);
    if (!planned.ok) return planned.result;
    if (planned.job !== null) jobs.push(planned.job);
  }
  if (jobs.length === 0)
    return opaque("unsupported-field", RENDERS, { field: "spec.sources", detail: "no source renders anything" });
  return { jobs, opaque: null, references: [] };
}

/** A Kustomize root that no other source renders: built on its own; nothing in the repo deploys its objects. */
function planKustomizeRoot(dir: string): PlanResult {
  const display = dir === "" ? "." : dir;
  const job: KustomizeJob = Object.freeze({
    kind: "kustomize",
    jobId: `KustomizeRoot:${display}`,
    owner: null,
    ownerFile: display,
    ownerField: "resources",
    ownerRenderedPath: display,
    destination: IN_CLUSTER,
    namespace: null,
    namespaceOverride: null,
    releaseName: null,
    valuesInputs: Object.freeze([]),
    source: Object.freeze({ repo: null, path: dir, chart: null, version: null, floating: false }),
    generatedBy: null,
    substitute: null,
    floating: Object.freeze([]),
    root: ".",
    dir,
  });
  return { jobs: [job], opaque: null, references: [] };
}

/** Plans one source: its jobs, or one opaque mark naming what could not be seen. */
export function planSource(source: PlanSource, ctx: PlanContext): PlanResult {
  switch (source.kind) {
    case "Application":
      return planApplication(source.object, ctx);
    case "ApplicationSet":
      // ApplicationSets are expanded by the GeneratorExpander (B3), never planned as a render.
      throw new Error("RenderPlanner: an ApplicationSet is expanded, not planned (a bug)");
    case "Kustomization":
      return planKustomization(source.object, ctx);
    case "HelmRelease":
      return planHelmRelease(source.object, ctx);
    case "KustomizeRoot":
      return planKustomizeRoot(source.dir);
  }
}
