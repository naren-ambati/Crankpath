// Flux planning (U3; BR3.5, BR3.6, BR3.8, BR3.9, FR3.6, FR3.12): a Flux Kustomization becomes a
// Kustomize job (or, for a path with no kustomization file, a recursive plain job: Flux builds such
// a directory from every manifest in it) with its `postBuild` substitution; a HelmRelease becomes a
// Helm job with its values in the order helm-controller merges them (`valuesFrom` in order, then
// inline `values`). What a Flux object names is looked up among the scanned repo's own objects:
// the GitRepository, HelmRepository or OCIRepository it reads, and the ConfigMaps and plain
// Secrets its values come from. A values source that is not in the repo (created in the cluster)
// makes the node opaque `cluster-created-values`, an encrypted one (`sops`) `encrypted-values`; in
// both cases the reference edge to the named object is kept (FR4.2). A GitRepository is a Git
// repo, so the repo-identity rule applies to its URL; a HelmRepository or OCIRepository is a chart
// source and it does not.

import type { DataMap, DataValue, RenderedObject } from "../u1-graph-model/extractor.js";
import { asArray, asString, getPath, IN_CLUSTER, isDataMap } from "../u1-graph-model/extractor.js";
import { objectId } from "../u1-graph-model/graph-model.js";
import { redactUrl } from "../u1-graph-model/safe-text.js";
import { canonicalPath } from "../u2-intake-config/bounded-reader.js";
import { canonicalDir } from "../u2-intake-config/tree-walk.js";
import { CHART_NAME, isFloatingVersion, isUsableVersion } from "../u4-render-engine/chart-cache.js";
import { guardChartUrl, URL_PROBLEM_WORDS } from "../u4-render-engine/url-guard.js";
import {
  helmJob,
  isValidReleaseName,
  nonEmpty,
  opaque,
  ownerBase,
  type PlanContext,
  type PlanReference,
  type PlanResult,
  RENDERS,
  UNDER_PATH,
  unreadableRepo,
} from "./plan-common.js";
import type { FloatingRef, HelmValues, KustomizeJob, PlainJob } from "./render-job.js";
import { KUSTOMIZATION_FILES } from "./source-discovery.js";

const FLUX_SOURCE_GROUP = "source.toolkit.fluxcd.io/";
const VALUES_LOST = "edges from inside values";

/** Flux Kustomization spec fields crankpath applies or that do not change what is built. */
const KUSTOMIZATION_FIELDS = new Set([
  "sourceRef",
  "path",
  "targetNamespace",
  "postBuild",
  "interval",
  "retryInterval",
  "timeout",
  "prune",
  "wait",
  "force",
  "suspend",
  "dependsOn",
  "healthChecks",
  "healthCheckExprs",
  "serviceAccountName",
  "deletionPolicy",
  "decryption",
  "kubeConfig",
]);
/** HelmRelease spec fields crankpath applies or that do not change what is rendered. */
const HELMRELEASE_FIELDS = new Set([
  "chart",
  "chartRef",
  "values",
  "valuesFrom",
  "releaseName",
  "targetNamespace",
  "storageNamespace",
  "interval",
  "timeout",
  "install",
  "upgrade",
  "test",
  "rollback",
  "uninstall",
  "driftDetection",
  "dependsOn",
  "suspend",
  "maxHistory",
  "serviceAccountName",
  "persistentClient",
  "kubeConfig",
]);
const CHART_SPEC_FIELDS = new Set([
  "chart",
  "version",
  "sourceRef",
  "reconcileStrategy",
  "interval",
  "verify",
  "valuesFiles",
  "valuesFile",
  "ignoreMissingValuesFiles",
]);
const GIT_REPOSITORY_UNSUPPORTED = ["include", "ignore", "sparseCheckout", "recurseSubmodules"] as const;

function ns(object: RenderedObject): string {
  return object.namespace ?? "";
}

/** A Flux source object the repo defines, by kind, namespace and name; or the opaque result. */
function fluxSource(
  ctx: PlanContext,
  kind: "GitRepository" | "HelmRepository" | "OCIRepository",
  namespace: string,
  name: DataValue | undefined,
  field: string,
  lost: string,
): { ok: true; spec: DataMap } | { ok: false; result: PlanResult } {
  const id = objectId(kind, namespace, name);
  if (!id.ok)
    return { ok: false, result: opaque("unsupported-field", lost, { field, detail: "not a valid object name" }) };
  const found = ctx.lookup(id.id);
  if (found.state === "absent") {
    return {
      ok: false,
      result: opaque("unreadable-repo", lost, {
        field,
        value: typeof name === "string" ? name : null,
        detail: `its ${kind} is not defined in the repository`,
      }),
    };
  }
  if (found.state === "conflict" || !String(found.value.apiVersion ?? "").startsWith(FLUX_SOURCE_GROUP)) {
    return {
      ok: false,
      result: opaque("unsupported-field", lost, {
        field,
        detail:
          found.state === "conflict"
            ? `its ${kind} is defined more than once with different content`
            : `not a Flux ${kind}`,
      }),
    };
  }
  const spec = found.value.spec;
  if (!isDataMap(spec))
    return { ok: false, result: opaque("unsupported-field", lost, { field, detail: `its ${kind} has no spec` }) };
  return { ok: true, spec };
}

/** The GitRepository's revision: floating unless it names a commit (OD-12). */
function gitFloating(spec: DataMap, field: string): FloatingRef[] {
  const ref = spec.ref;
  if (isDataMap(ref) && typeof ref.commit === "string" && /^[0-9a-f]{40}$/.test(ref.commit)) return [];
  if (isDataMap(ref)) {
    for (const k of ["name", "semver", "tag", "branch"] as const) {
      const v = asString(ref[k]);
      if (v !== undefined && v !== "") return [{ field: `${field}: GitRepository spec.ref.${k}`, value: v }];
    }
  }
  return [{ field: `${field}: GitRepository spec.ref`, value: "(default branch)" }];
}

/** The decoded string data of a ConfigMap or plain Secret (Secret values: memory only). */
export function stringData(kind: "ConfigMap" | "Secret", value: DataMap): Record<string, string> | null {
  const out: Record<string, string> = {};
  const data = value.data;
  if (isDataMap(data)) {
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (typeof v !== "string") continue;
      if (kind === "ConfigMap") out[k] = v;
      else {
        if (!/^[A-Za-z0-9+/\s]*={0,2}\s*$/.test(v)) return null;
        try {
          out[k] = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(v, "base64"));
        } catch {
          return null;
        }
      }
    }
  }
  if (kind === "Secret" && isDataMap(value.stringData)) {
    for (const k of Object.keys(value.stringData)) {
      const v = value.stringData[k];
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

type ValuesRef =
  | { ok: true; id: string; kind: "ConfigMap" | "Secret"; data: Record<string, string> }
  | { ok: false; result: PlanResult };

/** A ConfigMap or Secret a Flux object reads values from, checked (BR3.8, BR3.9). */
function valuesRef(
  ctx: PlanContext,
  entry: DataValue,
  namespace: string,
  field: string,
  references: PlanReference[],
): ValuesRef {
  const kind = getPath(entry, ["kind"]);
  const name = getPath(entry, ["name"]);
  if (kind !== "ConfigMap" && kind !== "Secret") {
    return {
      ok: false,
      result: opaque("unsupported-field", VALUES_LOST, {
        field: `${field}.kind`,
        detail: "only ConfigMap and Secret are read",
      }),
    };
  }
  const id = objectId(kind, namespace, name);
  if (!id.ok)
    return {
      ok: false,
      result: opaque("unsupported-field", VALUES_LOST, { field: `${field}.name`, detail: "not a valid object name" }),
    };
  references.push({ kind: kind === "Secret" ? "needs-secret" : "needs-config", to: id.id, field: `${field}.name` });
  const found = ctx.lookup(id.id);
  if (found.state === "absent") {
    return {
      ok: false,
      result: opaque("cluster-created-values", VALUES_LOST, {
        field: `${field}.name`,
        value: typeof name === "string" ? name : null,
        detail: `the ${kind} is not defined in the repository (created in the cluster, or missing)`,
      }),
    };
  }
  if (found.state === "conflict") {
    return {
      ok: false,
      result: opaque("unsupported-field", VALUES_LOST, {
        field: `${field}.name`,
        detail: `the ${kind} is defined more than once with different content`,
      }),
    };
  }
  if (found.value.sops !== undefined) {
    return {
      ok: false,
      result: opaque("encrypted-values", VALUES_LOST, {
        field: `${field}.name`,
        detail: `the ${kind} is encrypted (sops) and is not read`,
      }),
    };
  }
  const data = stringData(kind, found.value);
  if (data === null) {
    return {
      ok: false,
      result: opaque("unsupported-field", VALUES_LOST, {
        field: `${field}.name`,
        detail: `the ${kind}'s data is not text`,
      }),
    };
  }
  return { ok: true, id: id.id, kind, data };
}

function withReferences(result: PlanResult, references: readonly PlanReference[]): PlanResult {
  return { ...result, references: Object.freeze([...references]) };
}

/** A foreign destination for a Flux object that applies to another cluster (OD-4). */
function fluxDestination(spec: DataMap): string {
  const secret = asString(getPath(spec, ["kubeConfig", "secretRef", "name"]));
  if (spec.kubeConfig === undefined || spec.kubeConfig === null) return IN_CLUSTER;
  return `kubeconfig:${secret ?? "unknown"}`;
}

export function planKustomization(object: RenderedObject, ctx: PlanContext): PlanResult {
  const spec = getPath(object.body, ["spec"]);
  if (!isDataMap(spec))
    return opaque("unsupported-field", RENDERS, { field: "spec", detail: "missing or not a mapping" });
  for (const key of Object.keys(spec).sort()) {
    if (!KUSTOMIZATION_FIELDS.has(key)) {
      return opaque("unsupported-field", RENDERS, { field: `spec.${key}`, detail: "not applied by crankpath" });
    }
  }
  const references: PlanReference[] = [];
  const sourceKind = getPath(spec, ["sourceRef", "kind"]);
  if (sourceKind !== "GitRepository") {
    return opaque("unsupported-field", RENDERS, {
      field: "spec.sourceRef.kind",
      detail: "only GitRepository sources are read",
    });
  }
  const sourceNs = asString(getPath(spec, ["sourceRef", "namespace"])) ?? ns(object);
  const git = fluxSource(
    ctx,
    "GitRepository",
    sourceNs,
    getPath(spec, ["sourceRef", "name"]),
    "spec.sourceRef.name",
    UNDER_PATH,
  );
  if (!git.ok) return git.result;
  for (const k of GIT_REPOSITORY_UNSUPPORTED) {
    if (nonEmpty(git.spec[k])) {
      return opaque("unsupported-field", RENDERS, {
        field: `spec.sourceRef: GitRepository spec.${k}`,
        detail: "not applied by crankpath",
      });
    }
  }
  const url = asString(git.spec.url) ?? "";
  const resolution = ctx.resolveRepo(url);
  if (resolution.outcome === "unreadable")
    return unreadableRepo(url, resolution, "spec.sourceRef: GitRepository spec.url", UNDER_PATH);
  const root = resolution.root ?? ".";
  const rawPath = spec.path === undefined || spec.path === null ? "" : spec.path;
  if (typeof rawPath !== "string")
    return opaque("unsupported-field", RENDERS, { field: "spec.path", detail: "not a string" });
  const canon = canonicalDir(rawPath);
  if (!canon.ok)
    return opaque("unreadable-file", UNDER_PATH, {
      field: "spec.path",
      value: rawPath,
      detail: canon.refusal.reasonWord,
    });
  const probe = ctx.probeDirectory(root, canon.path);
  if (!probe.ok)
    return opaque("unreadable-file", UNDER_PATH, { field: "spec.path", value: rawPath, detail: probe.reasonWord });
  // post-build substitution: substituteFrom in order, then the inline substitute map (Flux's precedence)
  let substitute: Map<string, string> | null = null;
  const postBuild = spec.postBuild;
  if (postBuild !== undefined && postBuild !== null) {
    if (!isDataMap(postBuild))
      return opaque("unsupported-field", RENDERS, { field: "spec.postBuild", detail: "not a mapping" });
    substitute = new Map();
    const from = asArray(postBuild.substituteFrom);
    let first: PlanResult | null = null;
    for (let i = 0; i < from.length; i++) {
      const r = valuesRef(ctx, from[i] as DataValue, ns(object), `spec.postBuild.substituteFrom[${i}]`, references);
      if (!r.ok) {
        first ??= r.result;
        continue;
      }
      for (const [k, v] of Object.entries(r.data)) substitute.set(k, v);
    }
    if (first !== null) return withReferences(first, references);
    const inline = postBuild.substitute;
    if (isDataMap(inline)) {
      for (const k of Object.keys(inline)) {
        const v = inline[k];
        if (typeof v !== "string") {
          return withReferences(
            opaque("unsupported-field", RENDERS, { field: `spec.postBuild.substitute.${k}`, detail: "not a string" }),
            references,
          );
        }
        substitute.set(k, v);
      }
    }
  }
  const target = asString(spec.targetNamespace);
  const targetNamespace = target === undefined || target === "" ? null : target;
  const floating = gitFloating(git.spec, "spec.sourceRef");
  const base = {
    ...ownerBase({ object, destination: fluxDestination(spec), namespace: targetNamespace }, 0, "spec.path"),
    namespaceOverride: targetNamespace,
    substitute,
    releaseName: null,
    valuesInputs: Object.freeze(
      references.map((r) => ({
        kind: r.kind === "needs-secret" ? ("secret" as const) : ("configMap" as const),
        ref: r.to,
      })),
    ),
    source: Object.freeze({
      repo: resolution,
      path: canon.path,
      chart: null,
      version: null,
      floating: floating.length > 0,
    }),
    floating: Object.freeze(floating),
    root,
    dir: canon.path,
  };
  if (probe.names.some((n) => KUSTOMIZATION_FILES.has(n))) {
    const job: KustomizeJob = Object.freeze({ ...base, kind: "kustomize" });
    return { jobs: [job], opaque: null, references: Object.freeze(references) };
  }
  // no kustomization file: Flux generates one from every manifest under the path, recursively
  const job: PlainJob = Object.freeze({ ...base, kind: "plain", recurse: true });
  return { jobs: [job], opaque: null, references: Object.freeze(references) };
}

export function planHelmRelease(object: RenderedObject, ctx: PlanContext): PlanResult {
  const spec = getPath(object.body, ["spec"]);
  if (!isDataMap(spec))
    return opaque("unsupported-field", RENDERS, { field: "spec", detail: "missing or not a mapping" });
  for (const key of Object.keys(spec).sort()) {
    if (!HELMRELEASE_FIELDS.has(key)) {
      return opaque("unsupported-field", RENDERS, { field: `spec.${key}`, detail: "not applied by crankpath" });
    }
  }
  const references: PlanReference[] = [];
  const target = asString(spec.targetNamespace);
  const namespace = target !== undefined && target !== "" ? target : ns(object);
  const release = asString(spec.releaseName);
  const releaseName =
    release !== undefined && release !== ""
      ? release
      : target !== undefined && target !== ""
        ? `${target}-${object.name}`
        : object.name;
  if (!isValidReleaseName(releaseName)) {
    return opaque("unsupported-field", RENDERS, {
      field: release !== undefined && release !== "" ? "spec.releaseName" : "metadata.name",
      value: releaseName,
      detail:
        "not a Helm release name of at most 53 characters (helm-controller would shorten it; crankpath does not guess)",
    });
  }
  // values: valuesFrom in order, then inline values (helm-controller's merge order)
  const values: HelmValues[] = [];
  const from = asArray(spec.valuesFrom);
  let first: PlanResult | null = null;
  for (let i = 0; i < from.length; i++) {
    const field = `spec.valuesFrom[${i}]`;
    const entry = from[i] as DataValue;
    const r = valuesRef(ctx, entry, ns(object), field, references);
    if (!r.ok) {
      first ??= r.result;
      continue;
    }
    const key = asString(getPath(entry, ["valuesKey"])) ?? "values.yaml";
    const tp = asString(getPath(entry, ["targetPath"]));
    let targetPath: string[] | null = null;
    if (tp !== undefined && tp !== "") {
      if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(tp)) {
        first ??= opaque("unsupported-field", VALUES_LOST, {
          field: `${field}.targetPath`,
          value: tp,
          detail: "only a plain dotted path is read",
        });
        continue;
      }
      targetPath = tp.split(".");
    }
    values.push({ kind: "ref", refKind: r.kind, id: r.id, key, targetPath, field });
  }
  if (first !== null) return withReferences(first, references);
  if (spec.values !== undefined && spec.values !== null) {
    if (!isDataMap(spec.values))
      return withReferences(
        opaque("unsupported-field", RENDERS, { field: "spec.values", detail: "not a mapping" }),
        references,
      );
    values.push({ kind: "object", value: spec.values, field: "spec.values" });
  }
  const crds = asString(getPath(spec, ["install", "crds"]));
  const includeCrds = crds !== "Skip";
  const owner = { object, destination: fluxDestination(spec), namespace };
  const common = (ownerField: string) => ownerBase(owner, 0, ownerField);
  const done = (job: ReturnType<typeof helmJob>): PlanResult => ({
    jobs: [job],
    opaque: null,
    references: Object.freeze(references),
  });

  if (spec.chartRef !== undefined && spec.chartRef !== null) {
    const kind = getPath(spec, ["chartRef", "kind"]);
    if (kind !== "OCIRepository") {
      return withReferences(
        opaque("unsupported-field", RENDERS, {
          field: "spec.chartRef.kind",
          detail: "only OCIRepository chart references are read",
        }),
        references,
      );
    }
    const sourceNs = asString(getPath(spec, ["chartRef", "namespace"])) ?? ns(object);
    const oci = fluxSource(
      ctx,
      "OCIRepository",
      sourceNs,
      getPath(spec, ["chartRef", "name"]),
      "spec.chartRef.name",
      RENDERS,
    );
    if (!oci.ok) return withReferences(oci.result, references);
    const url = asString(oci.spec.url) ?? "";
    const guarded = guardChartUrl(url);
    if (!guarded.ok || guarded.scheme !== "oci") {
      return withReferences(
        opaque("unsupported-field", RENDERS, {
          field: "spec.chartRef: OCIRepository spec.url",
          value: redactUrl(url) ?? null,
          detail: guarded.ok ? "not an oci:// URL" : URL_PROBLEM_WORDS[guarded.problem],
        }),
        references,
      );
    }
    const slash = guarded.url.lastIndexOf("/");
    const name = guarded.url.slice(slash + 1);
    const ref = getPath(oci.spec, ["ref"]);
    const tag = asString(getPath(ref, ["tag"]));
    const semver = asString(getPath(ref, ["semver"]));
    if (nonEmpty(getPath(ref, ["digest"])) || !CHART_NAME.test(name) || slash <= "oci://".length) {
      return withReferences(
        opaque("unsupported-field", RENDERS, {
          field: "spec.chartRef: OCIRepository spec.ref",
          detail: "only a tag or semver reference to a named chart is read",
        }),
        references,
      );
    }
    const version = semver ?? tag ?? null;
    if (version !== null && !isUsableVersion(version)) {
      return withReferences(
        opaque("unsupported-field", RENDERS, {
          field: "spec.chartRef: OCIRepository spec.ref",
          value: version,
          detail: "not a version or version range crankpath can use",
        }),
        references,
      );
    }
    const floating = isFloatingVersion(version)
      ? [{ field: "spec.chartRef: OCIRepository spec.ref", value: version ?? "latest" }]
      : [];
    return done(
      helmJob(common("spec.chartRef"), {
        chart: { from: "repository", url: guarded.url.slice(0, slash), oci: true, name, version },
        releaseName,
        values,
        includeCrds,
        skipSchemaValidation: false,
        floating,
        repo: null,
      }),
    );
  }
  const chartSpec = getPath(spec, ["chart", "spec"]);
  if (!isDataMap(chartSpec)) {
    return withReferences(
      opaque("unsupported-field", RENDERS, { field: "spec.chart.spec", detail: "missing or not a mapping" }),
      references,
    );
  }
  for (const key of Object.keys(chartSpec).sort()) {
    if (!CHART_SPEC_FIELDS.has(key)) {
      return withReferences(
        opaque("unsupported-field", RENDERS, { field: `spec.chart.spec.${key}`, detail: "not applied by crankpath" }),
        references,
      );
    }
  }
  for (const key of ["valuesFiles", "valuesFile"] as const) {
    if (nonEmpty(chartSpec[key])) {
      return withReferences(
        opaque("unsupported-field", RENDERS, {
          field: `spec.chart.spec.${key}`,
          detail: "replacing the chart's own values is not applied by crankpath",
        }),
        references,
      );
    }
  }
  const chart = asString(chartSpec.chart) ?? "";
  const sourceKind = getPath(chartSpec, ["sourceRef", "kind"]);
  const sourceNs = asString(getPath(chartSpec, ["sourceRef", "namespace"])) ?? ns(object);
  const sourceName = getPath(chartSpec, ["sourceRef", "name"]);
  if (sourceKind === "HelmRepository") {
    const repo = fluxSource(ctx, "HelmRepository", sourceNs, sourceName, "spec.chart.spec.sourceRef.name", RENDERS);
    if (!repo.ok) return withReferences(repo.result, references);
    const rawUrl = asString(repo.spec.url) ?? "";
    const url = repo.spec.type === "oci" && !rawUrl.startsWith("oci://") ? `invalid:${rawUrl}` : rawUrl;
    const guarded = guardChartUrl(url);
    if (!guarded.ok) {
      return withReferences(
        opaque("unsupported-field", RENDERS, {
          field: "spec.chart.spec.sourceRef: HelmRepository spec.url",
          value: redactUrl(rawUrl) ?? null,
          detail: URL_PROBLEM_WORDS[guarded.problem],
        }),
        references,
      );
    }
    if (!CHART_NAME.test(chart)) {
      return withReferences(
        opaque("unsupported-field", RENDERS, {
          field: "spec.chart.spec.chart",
          value: chart,
          detail: "not a chart name crankpath can use",
        }),
        references,
      );
    }
    const rawVersion = asString(chartSpec.version);
    const version = rawVersion === undefined || rawVersion === "" ? "*" : rawVersion;
    if (!isUsableVersion(version)) {
      return withReferences(
        opaque("unsupported-field", RENDERS, {
          field: "spec.chart.spec.version",
          value: version,
          detail: "not a version or version range crankpath can use",
        }),
        references,
      );
    }
    const floating = isFloatingVersion(version) ? [{ field: "spec.chart.spec.version", value: version }] : [];
    return done(
      helmJob(common("spec.chart.spec.chart"), {
        chart: {
          from: "repository",
          url: guarded.url,
          oci: guarded.scheme === "oci",
          name: chart,
          version: version === "*" ? null : version,
        },
        releaseName,
        values,
        includeCrds,
        skipSchemaValidation: false,
        floating,
        repo: null,
      }),
    );
  }
  if (sourceKind === "GitRepository") {
    const git = fluxSource(ctx, "GitRepository", sourceNs, sourceName, "spec.chart.spec.sourceRef.name", UNDER_PATH);
    if (!git.ok) return withReferences(git.result, references);
    for (const k of GIT_REPOSITORY_UNSUPPORTED) {
      if (nonEmpty(git.spec[k])) {
        return withReferences(
          opaque("unsupported-field", RENDERS, {
            field: `spec.chart.spec.sourceRef: GitRepository spec.${k}`,
            detail: "not applied by crankpath",
          }),
          references,
        );
      }
    }
    const url = asString(git.spec.url) ?? "";
    const resolution = ctx.resolveRepo(url);
    if (resolution.outcome === "unreadable") {
      return withReferences(
        unreadableRepo(url, resolution, "spec.chart.spec.sourceRef: GitRepository spec.url", UNDER_PATH),
        references,
      );
    }
    const canon = canonicalPath(chart === "" ? "." : chart);
    const dir = canon.ok ? canon.path : canon.refusal.outcome === "not-regular-file" ? "" : null;
    if (dir === null) {
      return withReferences(
        opaque("unreadable-file", UNDER_PATH, {
          field: "spec.chart.spec.chart",
          value: chart,
          detail: "outside the scanned root",
        }),
        references,
      );
    }
    return done(
      helmJob(common("spec.chart.spec.chart"), {
        chart: { from: "repo", root: resolution.root ?? ".", dir },
        releaseName,
        values,
        includeCrds,
        skipSchemaValidation: false,
        floating: gitFloating(git.spec, "spec.chart.spec.sourceRef"),
        repo: resolution,
      }),
    );
  }
  return withReferences(
    opaque("unsupported-field", RENDERS, {
      field: "spec.chart.spec.sourceRef.kind",
      detail: "only HelmRepository and GitRepository chart sources are read",
    }),
    references,
  );
}
