// GeneratorExpander (U3; FR3.3, FR3.4, BR3.10 to BR3.14, AC2.4.5, OD-19): expands an Argo CD
// ApplicationSet into the Applications its generators would generate, as Argo CD v3.6.1 does
// (applicationset/generators, applicationset/controllers/template), or names exactly why it
// cannot:
//
// - `list`: one parameter set per element.
// - `git`: only through a repository RepoIdentity makes readable (the scanned repo, a
//   `--repo-alias`, a `repos:` mapping or a fetched `repos:` entry); `directories` from the
//   directories of its checkout (hidden ones skipped, as the repo-server does), `files` from the
//   files matching the patterns, each read through BoundedReader. An unreadable repository makes
//   the ApplicationSet opaque `unreadable-repo` with the URL quoted and the suggested `repos:`
//   entry; its host-match edge is the Argo extractor's and does not depend on this (AC2.4.5).
// - `clusters`, `matrix`, `merge`: from the `clusters:` block of crankpath.yaml, which stands in
//   for the cluster Secrets; without it `cluster-inputs-missing`. A cluster's server URL is not in
//   the block (except the in-cluster one), so a template that uses it is `cluster-inputs-missing`.
//
// A generator crankpath cannot expand makes the ApplicationSet opaque with one reason (the first,
// in generator order); Applications from its other generators are still generated, so the counts
// are a floor. Every generated Application is counted against `generatedApplicationsPerApplicationSet`;
// at the limit the expansion stops and the ApplicationSet is opaque `limit`. Path matching is
// counted against `generatorPatternSteps`. Pure apart from the injected listing and reading; the
// documents it returns are plain data for the RenderedSetBuilder.

import type { ClusterDecl } from "../u1-graph-model/declared-facts.js";
import type { DataMap, DataValue, RenderedObject, RepoResolution } from "../u1-graph-model/extractor.js";
import { getPath, isDataMap } from "../u1-graph-model/extractor.js";
import {
  makeOpaqueMark,
  type OpaqueMark,
  type OpaqueReason,
  type UnreadableFile,
} from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import { redactUrl } from "../u1-graph-model/safe-text.js";
import type { ReadResult } from "../u2-intake-config/bounded-reader.js";
import type { WalkOptions, WalkOutcome } from "../u2-intake-config/tree-walk.js";
import { checkPattern, DirectoryIndex, matchPath, type PatternKind, StepBudget } from "./generator-paths.js";
import {
  flattenParams,
  holdsTemplate,
  type ParamGap,
  type ParamSet,
  renderString,
  renderValue,
  sanitizeName,
  type TemplateMode,
  WorkBudget,
} from "./generator-template.js";

export interface ExpanderIo {
  resolveRepo(url: string): RepoResolution;
  /** Lists files under a root label (the same confined walk the renderers use). */
  walk(root: string, dir: string, options: WalkOptions): WalkOutcome;
  read(root: string, path: string): ReadResult;
  display(root: string, path: string): string;
}

export interface ExpanderLimits {
  /** generatedApplicationsPerApplicationSet. */
  readonly applications: number;
  /** generatorPatternSteps. */
  readonly patternSteps: number;
  /** generatorRenderSteps: the template rendering work of the whole set (B3 review M1). */
  readonly renderSteps?: number;
  /**
   * Charges one generated Application, with its string values, to the run budget before it is
   * built (B3 review M1); false when the budget does not hold it: the generation stops there.
   */
  readonly admit?: (stringLeaves: number) => boolean;
}

/** String values of a value (iterative), to charge a generated Application before it is built. */
function stringLeaves(value: DataValue): number {
  let n = 0;
  const stack: DataValue[] = [value];
  while (stack.length > 0) {
    const v = stack.pop() as DataValue;
    if (typeof v === "string") n += 1;
    else if (Array.isArray(v)) for (const x of v) stack.push(x);
    else if (isDataMap(v)) for (const k of Object.keys(v)) stack.push(v[k] as DataValue);
  }
  return n;
}
/** The strings a generated Application has beyond its template's: apiVersion, kind, namespace. */
const ADDED_STRINGS = 3;

export interface Expansion {
  /** The generated Application documents, in generation order (generators, then parameter sets). */
  readonly documents: readonly DataMap[];
  /** The ApplicationSet's one opaque mark, or null when every generator was expanded. */
  readonly mark: OpaqueMark | null;
  /** Files of a generator repository that could not be read (named and counted). */
  readonly unreadable: readonly UnreadableFile[];
  /** Names of the `clusters:` entries a clusters generator used (declared facts the graph rests on). */
  readonly clustersUsed: readonly string[];
}

/** The in-cluster destination as Argo CD names it (common.KubernetesInClusterName and InternalAPIServerAddr). */
const IN_CLUSTER_NAME = "in-cluster";
const IN_CLUSTER_SERVER = "https://kubernetes.default.svc";
const LOST = {
  generators: "Applications generated from its generators",
  git: "Applications generated from its git generator",
  clusters: "Applications generated from its clusters generator",
  template: "Applications generated from its template",
  limit: "Applications its generators would generate over the limit",
} as const;
const SPEC_KEYS = new Set([
  "generators",
  "template",
  "goTemplate",
  "goTemplateOptions",
  "syncPolicy",
  "strategy",
  "preservedFields",
  "ignoreApplicationDifferences",
  "applyNestedSelectors",
  "templatePatch",
]);
const LIVE_GENERATORS = new Set(["scmProvider", "pullRequest", "clusterDecisionResource", "plugin", "oci"]);
const TEMPLATE_META_KEYS = new Set(["name", "namespace", "labels", "annotations", "finalizers"]);
/** Annotations Argo CD never exposes as cluster parameters (applicationset/generators/cluster.go). */
const EXCLUDED_CLUSTER_ANNOTATIONS = new Set([
  "argocd.argoproj.io/refresh",
  "argocd.argoproj.io/refresh-timestamp",
  "argocd.argoproj.io/hydrate",
  "argocd.argoproj.io/hydrate-timestamp",
  "argocd.argoproj.io/instance",
  "argocd.argoproj.io/installation-id",
  "kubectl.kubernetes.io/last-applied-configuration",
]);

/** A failure of one generator or parameter set: becomes the ApplicationSet's mark if it is the first. */
interface Failure {
  readonly reason: OpaqueReason;
  readonly lost: string;
  readonly field: string;
  readonly detail: string;
  readonly value?: string | null;
  readonly suggestion?: OpaqueMark["suggestion"];
}

class Stop extends Error {}

interface Run {
  readonly io: ExpanderIo;
  readonly clusters: readonly ClusterDecl[] | null;
  mode: TemplateMode;
  missingKeyError: boolean;
  readonly steps: StepBudget;
  readonly unreadable: UnreadableFile[];
  readonly clustersUsed: Set<string>;
  /** The most parameter sets a combination builds: one more than the Applications that may be generated. */
  readonly cap: number;
  failure: Failure | null;
}

type Params = readonly ParamSet[] | Failure;

function fail(run: Run, f: Failure): Failure {
  if (run.failure === null) run.failure = f;
  return f;
}

function unsupported(field: string, detail: string): Failure {
  return { reason: "unsupported-field", lost: LOST.generators, field, detail };
}

function stringMap(v: DataValue | undefined): Record<string, string> | null {
  if (v === undefined || v === null) return {};
  if (!isDataMap(v)) return null;
  const out: Record<string, string> = {};
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (typeof x !== "string") return null;
    Object.defineProperty(out, k, { value: x, enumerable: true });
  }
  return out;
}

function onlyKeys(v: DataMap, allowed: readonly string[], at: string): Failure | null {
  for (const k of Object.keys(v).sort(compareCodePoints)) {
    if (!allowed.includes(k)) return unsupported(`${at}.${k}`, "not a supported field");
  }
  return null;
}

function set(values: DataMap, gaps?: ReadonlyMap<string, ParamGap>): ParamSet {
  return { values, gaps: gaps ?? new Map() };
}

/** Appends a generator's `values` (templated with the set itself), as Argo CD's appendTemplatedValues. */
function withValues(run: Run, sets: readonly ParamSet[], values: Record<string, string>, at: string): Params {
  const keys = Object.keys(values);
  if (keys.length === 0) return sets;
  const out: ParamSet[] = [];
  for (const s of sets) {
    const rendered: Record<string, string> = {};
    for (const k of keys) {
      const r = renderString(values[k] as string, s, run.mode, run.missingKeyError);
      if (!r.ok)
        return {
          reason: r.reason,
          lost: LOST.generators,
          field: `${at}.values.${k}`,
          detail: r.detail,
          value: values[k],
        };
      Object.defineProperty(rendered, k, { value: r.text, enumerable: true });
    }
    if (run.mode === "fast") {
      const flat: { [key: string]: DataValue } = { ...s.values };
      for (const k of keys)
        Object.defineProperty(flat, `values.${k}`, { value: rendered[k], enumerable: true, writable: true });
      out.push(set(flat, s.gaps));
    } else {
      const nested: { [key: string]: DataValue } = { ...s.values };
      Object.defineProperty(nested, "values", { value: rendered, enumerable: true, writable: true });
      out.push(set(nested, s.gaps));
    }
  }
  return out;
}

function listParams(run: Run, g: DataMap, at: string): Params {
  const bad = onlyKeys(g, ["elements", "elementsYaml", "template"], at);
  if (bad !== null) return bad;
  if (g.template !== undefined) return unsupported(`${at}.template`, "a generator's own template is not supported");
  if (g.elementsYaml !== undefined && g.elementsYaml !== "") {
    return unsupported(`${at}.elementsYaml`, "elementsYaml is not supported");
  }
  const elements = g.elements ?? [];
  if (!Array.isArray(elements)) return unsupported(`${at}.elements`, "not a list");
  const out: ParamSet[] = [];
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    if (!isDataMap(e)) return unsupported(`${at}.elements[${i}]`, "not a mapping (Argo CD refuses it)");
    if (run.mode === "go") {
      out.push(set(e));
      continue;
    }
    // fasttemplate: every value a string, `values` a map of strings (Argo CD refuses anything else)
    const flat: { [key: string]: DataValue } = {};
    for (const k of Object.keys(e)) {
      const v = e[k];
      if (k === "values") {
        const m = stringMap(v);
        if (m === null || !isDataMap(v)) {
          return unsupported(`${at}.elements[${i}].values`, "values that are not strings (Argo CD refuses them)");
        }
        for (const vk of Object.keys(m)) {
          Object.defineProperty(flat, `values.${vk}`, { value: m[vk], enumerable: true, writable: true });
        }
      } else if (typeof v === "string") Object.defineProperty(flat, k, { value: v, enumerable: true, writable: true });
      else
        return unsupported(
          `${at}.elements[${i}].${k}`,
          "a value that is not a string (Argo CD refuses it without goTemplate)",
        );
    }
    out.push(set(flat));
  }
  return out;
}

function pathParams(run: Run, dir: string, file: string | null, prefix: string): ParamSet {
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const segments = dir.split("/");
  if (run.mode === "go") {
    const p: { [key: string]: DataValue } = {
      path: dir,
      basename: base(dir),
      basenameNormalized: sanitizeName(base(dir)),
      segments,
    };
    if (file !== null) {
      p.filename = base(file);
      p.filenameNormalized = sanitizeName(base(file));
    }
    return set(prefix === "" ? { path: p } : { [prefix]: { path: p } });
  }
  const name = prefix === "" ? "path" : `${prefix}.path`;
  const flat: { [key: string]: DataValue } = {
    [name]: dir,
    [`${name}.basename`]: base(dir),
    [`${name}.basenameNormalized`]: sanitizeName(base(dir)),
  };
  if (file !== null) {
    flat[`${name}.filename`] = base(file);
    flat[`${name}.filenameNormalized`] = sanitizeName(base(file));
  }
  segments.forEach((s, i) => {
    if (s !== "") flat[`${name}[${i}]`] = s;
  });
  return set(flat);
}

/** Directories of a checkout as the repo-server lists them: ancestors of what git holds, hidden ones skipped. */
function directoriesOf(files: readonly string[], refused: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const f of [...files, ...refused]) {
    const parts = f.split("/");
    for (let n = 1; n < parts.length; n++) {
      if ((parts[n - 1] as string).startsWith(".")) break;
      dirs.add(parts.slice(0, n).join("/"));
    }
  }
  return [...dirs].sort(compareCodePoints);
}

function gitParams(run: Run, g: DataMap, at: string): Params {
  const bad = onlyKeys(
    g,
    ["repoURL", "revision", "directories", "files", "pathParamPrefix", "values", "requeueAfterSeconds", "template"],
    at,
  );
  if (bad !== null) return bad;
  if (g.template !== undefined) return unsupported(`${at}.template`, "a generator's own template is not supported");
  const url = typeof g.repoURL === "string" ? g.repoURL : "";
  if (url === "") return unsupported(`${at}.repoURL`, "missing or not a string");
  const prefix = g.pathParamPrefix === undefined ? "" : g.pathParamPrefix;
  if (typeof prefix !== "string") return unsupported(`${at}.pathParamPrefix`, "not a string");
  const values = stringMap(g.values);
  if (values === null) return unsupported(`${at}.values`, "values that are not strings");
  const dirs = Array.isArray(g.directories) ? g.directories : [];
  const files = Array.isArray(g.files) ? g.files : [];
  if (g.directories !== undefined && !Array.isArray(g.directories))
    return unsupported(`${at}.directories`, "not a list");
  if (g.files !== undefined && !Array.isArray(g.files)) return unsupported(`${at}.files`, "not a list");
  if (dirs.length === 0 && files.length === 0) {
    return unsupported(at, "neither directories nor files (Argo CD refuses it)");
  }
  const kind: PatternKind = dirs.length > 0 ? "directory" : "file";
  const entries = kind === "directory" ? dirs : files;
  const listField = `${at}.${kind === "directory" ? "directories" : "files"}`;
  const patterns: { path: string; exclude: boolean }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!isDataMap(e) || typeof e.path !== "string") return unsupported(`${listField}[${i}]`, "not a {path} mapping");
    const extra = onlyKeys(e, ["path", "exclude"], `${listField}[${i}]`);
    if (extra !== null) return extra;
    if (e.exclude !== undefined && typeof e.exclude !== "boolean")
      return unsupported(`${listField}[${i}].exclude`, "not a boolean");
    let p = e.path;
    if (kind === "file" && p.startsWith("./")) p = p.slice(2);
    const checked = checkPattern(p);
    if (!checked.ok || (kind === "file" && p.startsWith(":"))) {
      return {
        reason: "unsupported-field",
        lost: LOST.git,
        field: `${listField}[${i}].path`,
        detail: checked.ok ? "a git pathspec with magic (not matched by crankpath)" : checked.detail,
        value: e.path,
      };
    }
    patterns.push({ path: p, exclude: e.exclude === true });
  }
  // the repository: readable only through RepoIdentity (BR3.11); never guessed
  const resolution = run.io.resolveRepo(url);
  if (resolution.outcome === "unreadable") {
    const failure = resolution.failure ?? null;
    return {
      reason: failure?.reason ?? "unreadable-repo",
      lost: LOST.git,
      field: `${at}.repoURL`,
      value: redactUrl(url) ?? null,
      detail:
        failure?.detail ??
        (resolution.via === "not-comparable"
          ? "not a URL crankpath can compare"
          : "not this repository and not mapped"),
      suggestion: resolution.suggestion,
    };
  }
  const root = resolution.root ?? ".";
  const walked = run.io.walk(root, "", {
    recurse: true,
    skipNames: new Set([".git"]),
    skipAtStart: new Set([".crankpath"]),
  });
  if (!walked.ok) {
    run.unreadable.push({
      path: run.io.display(root, walked.refusal.path === "" ? "." : walked.refusal.path),
      outcome: walked.refusal.outcome,
      reasonWord: walked.refusal.reasonWord,
      detail: walked.refusal.detail ?? null,
    });
    return {
      reason: "unreadable-file",
      lost: LOST.git,
      field: `${at}.repoURL`,
      detail: "its repository could not be listed",
    };
  }
  // a listing that stopped (a limit) or could not see a directory is incomplete: named and opaque
  const stopping = walked.refusals.filter((r) => r.outcome !== "symlink" && r.outcome !== "not-regular-file");
  for (const r of stopping) {
    run.unreadable.push({
      path: run.io.display(root, r.path),
      outcome: r.outcome,
      reasonWord: r.reasonWord,
      detail: r.detail ?? null,
    });
  }
  if (stopping.length > 0) {
    const limited = stopping.some((r) => r.outcome === "too-large");
    return {
      reason: limited ? "limit" : "unreadable-file",
      lost: LOST.git,
      field: listField,
      detail: limited ? "the listing of its repository reached a limit" : "part of its repository could not be listed",
    };
  }
  const tooMuch: Failure = {
    reason: "limit",
    lost: LOST.git,
    field: listField,
    detail: "path matching over the limit (generatorPatternSteps)",
  };
  let out: ParamSet[] = [];
  if (kind === "directory") {
    const index = new DirectoryIndex(
      directoriesOf(
        walked.files,
        walked.refusals.map((r) => r.path),
      ),
    );
    const include = new Set<string>();
    const exclude = new Set<string>();
    for (const pat of patterns) {
      for (const d of index.candidates(pat.path)) {
        const m = matchPath("directory", pat.path, d, run.steps);
        if (m === null) return tooMuch;
        if (m) (pat.exclude ? exclude : include).add(d);
      }
    }
    for (const d of [...include].sort(compareCodePoints))
      if (!exclude.has(d)) out.push(pathParams(run, d, null, prefix));
  } else {
    const chosen = new Set<string>();
    for (const pat of patterns) {
      if (pat.exclude) continue;
      for (const f of walked.files) {
        const m = matchPath("file", pat.path, f, run.steps);
        if (m === null) return tooMuch;
        if (m) chosen.add(f);
      }
    }
    for (const pat of patterns) {
      if (!pat.exclude) continue;
      for (const f of [...chosen]) {
        const m = matchPath("file", pat.path, f, run.steps);
        if (m === null) return tooMuch;
        if (m) chosen.delete(f);
      }
    }
    for (const f of [...chosen].sort(compareCodePoints)) {
      const read = run.io.read(root, f);
      if (read.outcome !== "ok") {
        run.unreadable.push({
          path: run.io.display(root, f),
          outcome: read.outcome,
          reasonWord: read.reasonWord,
          detail: read.detail ?? null,
        });
        return {
          reason:
            read.outcome === "too-large" ||
            read.outcome === "too-deep" ||
            read.outcome === "too-many-documents" ||
            read.outcome === "alias-limit"
              ? "limit"
              : "unreadable-file",
          lost: LOST.git,
          field: listField,
          detail: "a file its pattern names could not be read",
        };
      }
      const docs = read.documents.filter((d) => d !== null);
      if (read.documents.length > 1) {
        return {
          reason: "unsupported-field",
          lost: LOST.git,
          field: listField,
          detail: "a generator file with more than one YAML document",
          value: f,
        };
      }
      const doc: DataValue = docs[0] ?? {};
      const objects = Array.isArray(doc) ? doc : [doc];
      const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".";
      for (const o of objects) {
        if (!isDataMap(o)) {
          return {
            reason: "unsupported-field",
            lost: LOST.git,
            field: listField,
            detail: "a generator file that is not a mapping or a list of mappings",
            value: f,
          };
        }
        const pathSet = pathParams(run, dir, f, prefix);
        if (run.mode === "go") out.push(set({ ...o, ...pathSet.values }));
        else {
          const flat = flattenParams(o);
          out.push(set({ ...flat.values, ...pathSet.values }, flat.gaps));
        }
      }
    }
  }
  const v = withValues(run, out, values, at);
  if (!Array.isArray(v)) return v as Failure;
  out = [...v];
  return out;
}

function labelMatches(
  selector: DataValue | undefined,
  labels: Readonly<Record<string, string>>,
  at: string,
): boolean | Failure {
  if (selector === undefined || selector === null) return true;
  if (!isDataMap(selector)) return unsupported(at, "not a label selector");
  const bad = onlyKeys(selector, ["matchLabels", "matchExpressions"], at);
  if (bad !== null) return bad;
  const ml = stringMap(selector.matchLabels);
  if (ml === null) return unsupported(`${at}.matchLabels`, "not a map of strings");
  for (const k of Object.keys(ml)) if (labels[k] !== ml[k]) return false;
  const exprs = selector.matchExpressions ?? [];
  if (!Array.isArray(exprs)) return unsupported(`${at}.matchExpressions`, "not a list");
  for (let i = 0; i < exprs.length; i++) {
    const e = exprs[i];
    const ef = `${at}.matchExpressions[${i}]`;
    if (!isDataMap(e) || typeof e.key !== "string" || typeof e.operator !== "string")
      return unsupported(ef, "not a requirement");
    const vals =
      Array.isArray(e.values) && e.values.every((x) => typeof x === "string") ? (e.values as string[]) : null;
    const has = Object.hasOwn(labels, e.key);
    switch (e.operator) {
      case "In":
        if (vals === null || !has || !vals.includes(labels[e.key] as string)) return false;
        break;
      case "NotIn":
        if (vals === null) return unsupported(ef, "NotIn without values");
        if (has && vals.includes(labels[e.key] as string)) return false;
        break;
      case "Exists":
        if (!has) return false;
        break;
      case "DoesNotExist":
        if (has) return false;
        break;
      default:
        return unsupported(`${ef}.operator`, "not a label selector operator");
    }
  }
  return true;
}

function selectorEmpty(selector: DataValue | undefined): boolean {
  if (!isDataMap(selector)) return true;
  const ml = selector.matchLabels;
  const me = selector.matchExpressions;
  return !(isDataMap(ml) && Object.keys(ml).length > 0) && !(Array.isArray(me) && me.length > 0);
}

function clusterParams(run: Run, g: DataMap, at: string): Params {
  const bad = onlyKeys(g, ["selector", "values", "flatList", "template"], at);
  if (bad !== null) return bad;
  if (g.template !== undefined) return unsupported(`${at}.template`, "a generator's own template is not supported");
  if (g.flatList === true) return unsupported(`${at}.flatList`, "flatList is not supported");
  if (run.clusters === null) {
    return {
      reason: "cluster-inputs-missing",
      lost: LOST.clusters,
      field: at,
      detail: "cluster Secrets live outside the repository and crankpath.yaml has no clusters: block",
    };
  }
  const values = stringMap(g.values);
  if (values === null) return unsupported(`${at}.values`, "values that are not strings");
  const serverGap: ParamGap = {
    reason: "cluster-inputs-missing",
    detail: "the clusters: block gives no server URL or project for a cluster other than in-cluster",
  };
  const out: ParamSet[] = [];
  const mk = (
    name: string,
    labels: Readonly<Record<string, string>>,
    annotations: Readonly<Record<string, string>>,
  ) => {
    const local = name === IN_CLUSTER_NAME;
    const gaps = new Map<string, ParamGap>();
    const ann: Record<string, string> = {};
    for (const k of Object.keys(annotations)) {
      if (!EXCLUDED_CLUSTER_ANNOTATIONS.has(k))
        Object.defineProperty(ann, k, { value: annotations[k], enumerable: true });
    }
    if (run.mode === "go") {
      const meta: { [key: string]: DataValue } = {};
      if (Object.keys(annotations).length > 0) meta.annotations = ann;
      if (Object.keys(labels).length > 0) meta.labels = { ...labels };
      const values: { [key: string]: DataValue } = { name, nameNormalized: sanitizeName(name), metadata: meta };
      if (local) {
        values.server = IN_CLUSTER_SERVER;
        values.project = "";
      } else {
        gaps.set("server", serverGap);
        gaps.set("project", serverGap);
      }
      return set(values, gaps);
    }
    const flat: { [key: string]: DataValue } = { name, nameNormalized: sanitizeName(name) };
    if (local) {
      flat.server = IN_CLUSTER_SERVER;
      flat.project = "";
    } else {
      gaps.set("server", serverGap);
      gaps.set("project", serverGap);
    }
    for (const k of Object.keys(ann))
      Object.defineProperty(flat, `metadata.annotations.${k}`, { value: ann[k], enumerable: true, writable: true });
    for (const k of Object.keys(labels))
      Object.defineProperty(flat, `metadata.labels.${k}`, { value: labels[k], enumerable: true, writable: true });
    return set(flat, gaps);
  };
  for (const c of run.clusters) {
    const m = labelMatches(g.selector, c.labels, `${at}.selector`);
    if (typeof m !== "boolean") return m;
    if (!m) continue;
    run.clustersUsed.add(c.name);
    out.push(mk(c.name, c.labels, c.annotations));
  }
  // the local cluster, last, when no selector and no entry stands for it (Argo CD's rule)
  if (selectorEmpty(g.selector) && !run.clusters.some((c) => c.name === IN_CLUSTER_NAME)) {
    out.push(mk(IN_CLUSTER_NAME, {}, {}));
  }
  const v = withValues(run, out, values, at);
  return v;
}

function childParams(run: Run, child: DataValue, at: string, topLevel: boolean): Params {
  if (!isDataMap(child)) return unsupported(at, "not a generator");
  const kinds = Object.keys(child).filter((k) => k !== "selector");
  if (child.selector !== undefined) return unsupported(`${at}.selector`, "a generator selector is not supported");
  if (kinds.length !== 1) return unsupported(at, "not exactly one generator");
  const kind = kinds[0] as string;
  const g = child[kind];
  const gat = `${at}.${kind}`;
  if (LIVE_GENERATORS.has(kind)) return unsupported(gat, "a generator that reads a live service is not expanded");
  if (!isDataMap(g)) return unsupported(gat, "not a mapping");
  switch (kind) {
    case "list":
      return listParams(run, g, gat);
    case "git":
      return gitParams(run, g, gat);
    case "clusters":
      return clusterParams(run, g, gat);
    case "matrix":
    case "merge":
      return topLevel
        ? combineParams(run, kind, g, gat)
        : unsupported(gat, "a nested matrix or merge generator is not supported");
    default:
      return unsupported(gat, "not a generator crankpath knows");
  }
}

function deepMerge(base: DataValue, over: DataValue): DataValue {
  if (!isDataMap(base) || !isDataMap(over)) return over;
  const out: { [key: string]: DataValue } = { ...base };
  for (const k of Object.keys(over)) {
    Object.defineProperty(out, k, {
      value: Object.hasOwn(base, k) ? deepMerge(base[k] as DataValue, over[k] as DataValue) : over[k],
      enumerable: true,
      writable: true,
    });
  }
  return out;
}

function mergeGaps(a: ReadonlyMap<string, ParamGap>, b: ReadonlyMap<string, ParamGap>): Map<string, ParamGap> {
  const m = new Map(b);
  for (const [k, v] of a) m.set(k, v);
  return m;
}

function combineParams(run: Run, kind: "matrix" | "merge", g: DataMap, at: string): Params {
  const allowed = kind === "matrix" ? ["generators", "template"] : ["generators", "mergeKeys", "template"];
  const bad = onlyKeys(g, allowed, at);
  if (bad !== null) return bad;
  if (g.template !== undefined) return unsupported(`${at}.template`, "a generator's own template is not supported");
  const children = Array.isArray(g.generators) ? g.generators : null;
  if (children === null) return unsupported(`${at}.generators`, "not a list");
  if (kind === "matrix" && children.length !== 2)
    return unsupported(`${at}.generators`, "a matrix needs exactly two generators (Argo CD refuses it)");
  if (kind === "merge" && children.length < 2)
    return unsupported(`${at}.generators`, "a merge needs at least two generators (Argo CD refuses it)");
  if (kind === "matrix" && holdsTemplate(children[1] as DataValue)) {
    return {
      reason: "unsupported-template",
      lost: LOST.generators,
      field: `${at}.generators[1]`,
      detail: "a matrix child that uses the other child's parameters is not expanded",
    };
  }
  const sets: (readonly ParamSet[])[] = [];
  for (let i = 0; i < children.length; i++) {
    const p = childParams(run, children[i] as DataValue, `${at}.generators[${i}]`, false);
    if (!Array.isArray(p)) return p as Failure;
    if (kind === "matrix" && p.length === 0) {
      return unsupported(
        `${at}.generators[${i}]`,
        "a matrix child that generates no parameters (Argo CD reports an error)",
      );
    }
    sets.push(p);
  }
  if (kind === "matrix") {
    const [a, b] = sets as [readonly ParamSet[], readonly ParamSet[]];
    const out: ParamSet[] = [];
    for (const x of a) {
      for (const y of b) {
        if (out.length >= run.cap) return out;
        if (run.mode === "go") {
          out.push(set(deepMerge(y.values, x.values) as DataMap, mergeGaps(x.gaps, y.gaps)));
          continue;
        }
        const merged: { [key: string]: DataValue } = { ...x.values };
        for (const k of Object.keys(y.values)) {
          if (Object.hasOwn(merged, k) && merged[k] !== y.values[k]) {
            return unsupported(
              `${at}.generators`,
              "two matrix children give one parameter different values (Argo CD refuses it)",
            );
          }
          Object.defineProperty(merged, k, { value: y.values[k], enumerable: true, writable: true });
        }
        out.push(set(merged, mergeGaps(x.gaps, y.gaps)));
      }
    }
    return out;
  }
  const keys =
    Array.isArray(g.mergeKeys) && g.mergeKeys.length > 0 && g.mergeKeys.every((k) => typeof k === "string")
      ? (g.mergeKeys as string[])
      : null;
  if (keys === null)
    return unsupported(`${at}.mergeKeys`, "missing, empty or not a list of strings (Argo CD refuses it)");
  const uniqueKeys = [...new Set(keys)].sort(compareCodePoints);
  const keyOf = (s: ParamSet): string =>
    JSON.stringify(uniqueKeys.map((k) => (Object.hasOwn(s.values, k) ? s.values[k] : null)));
  const index = (list: readonly ParamSet[], i: number): Map<string, ParamSet> | Failure => {
    const m = new Map<string, ParamSet>();
    for (const s of list) {
      const k = keyOf(s);
      if (m.has(k))
        return unsupported(
          `${at}.generators[${i}]`,
          "two parameter sets with the same merge keys (Argo CD refuses it)",
        );
      m.set(k, s);
    }
    return m;
  };
  const base = index(sets[0] as readonly ParamSet[], 0);
  if (!(base instanceof Map)) return base;
  for (let i = 1; i < sets.length; i++) {
    const over = index(sets[i] as readonly ParamSet[], i);
    if (!(over instanceof Map)) return over;
    for (const [k, b] of base) {
      const o = over.get(k);
      if (o === undefined) continue;
      const merged = run.mode === "go" ? (deepMerge(b.values, o.values) as DataMap) : { ...b.values, ...o.values };
      base.set(k, set(merged, mergeGaps(o.gaps, b.gaps)));
    }
  }
  return [...base.values()];
}

/** Expands one ApplicationSet. Never throws on hostile input. */
export function expandApplicationSet(
  object: RenderedObject,
  io: ExpanderIo,
  clusters: readonly ClusterDecl[] | null,
  limits: ExpanderLimits,
): Expansion {
  const run: Run = {
    io,
    clusters,
    mode: "fast",
    missingKeyError: false,
    steps: new StepBudget(limits.patternSteps),
    unreadable: [],
    clustersUsed: new Set(),
    cap: limits.applications + 1,
    failure: null,
  };
  const documents: DataMap[] = [];
  const finish = (): Expansion => {
    const f = run.failure;
    return {
      documents,
      mark:
        f === null
          ? null
          : makeOpaqueMark({
              reason: f.reason,
              lostEdges: [f.lost],
              field: f.field,
              detail: f.detail,
              value: f.value ?? null,
              suggestion: f.suggestion ?? null,
            }),
      unreadable: run.unreadable,
      clustersUsed: [...run.clustersUsed].sort(compareCodePoints),
    };
  };
  const spec = getPath(object.body, ["spec"]);
  if (!isDataMap(spec)) {
    fail(run, unsupported("spec", "missing or not a mapping"));
    return finish();
  }
  for (const k of Object.keys(spec).sort(compareCodePoints)) {
    if (!SPEC_KEYS.has(k)) {
      fail(run, unsupported(`spec.${k}`, "not a supported field"));
      return finish();
    }
  }
  if (spec.templatePatch !== undefined && spec.templatePatch !== "") {
    fail(run, {
      reason: "unsupported-template",
      lost: LOST.template,
      field: "spec.templatePatch",
      detail: "templatePatch is not supported",
    });
    return finish();
  }
  if (spec.goTemplate !== undefined && typeof spec.goTemplate !== "boolean") {
    fail(run, unsupported("spec.goTemplate", "not a boolean"));
    return finish();
  }
  run.mode = spec.goTemplate === true ? "go" : "fast";
  const options = spec.goTemplateOptions ?? [];
  if (!Array.isArray(options) || !options.every((o) => typeof o === "string")) {
    fail(run, unsupported("spec.goTemplateOptions", "not a list of strings"));
    return finish();
  }
  run.missingKeyError = (options as string[]).some((o) => o === "missingkey=error");
  const template = spec.template;
  if (!isDataMap(template) || !isDataMap(template.spec)) {
    fail(run, unsupported("spec.template", "missing, or without a spec"));
    return finish();
  }
  const meta = template.metadata ?? {};
  if (!isDataMap(meta)) {
    fail(run, unsupported("spec.template.metadata", "not a mapping"));
    return finish();
  }
  for (const k of Object.keys(meta).sort(compareCodePoints)) {
    if (!TEMPLATE_META_KEYS.has(k)) {
      fail(run, unsupported(`spec.template.metadata.${k}`, "not a supported field"));
      return finish();
    }
  }
  const generators = spec.generators;
  if (!Array.isArray(generators) || generators.length === 0) {
    fail(run, unsupported("spec.generators", "missing, empty or not a list"));
    return finish();
  }
  const namespace = object.namespace;
  const names = new Set<string>();
  const leaves = stringLeaves({ metadata: meta, spec: template.spec }) + ADDED_STRINGS;
  const work = new WorkBudget(limits.renderSteps ?? Number.POSITIVE_INFINITY);
  try {
    for (let i = 0; i < generators.length; i++) {
      const params = childParams(run, generators[i] as DataValue, `spec.generators[${i}]`, true);
      if (!Array.isArray(params)) {
        fail(run, params as Failure);
        continue;
      }
      for (const p of params as readonly ParamSet[]) {
        if (limits.admit !== undefined && !limits.admit(leaves)) {
          fail(run, {
            reason: "limit",
            lost: LOST.limit,
            field: "spec.generators",
            detail: "the run's memory budget was reached while its Applications were generated",
          });
          throw new Stop();
        }
        if (documents.length >= limits.applications) {
          fail(run, {
            reason: "limit",
            lost: LOST.limit,
            field: "spec.generators",
            detail: "generated Applications over the limit (generatedApplicationsPerApplicationSet)",
          });
          throw new Stop();
        }
        const r = renderValue(
          { metadata: meta, spec: template.spec },
          p,
          run.mode,
          run.missingKeyError,
          "spec.template",
          work,
        );
        if (!r.ok && r.reason === "limit") {
          fail(run, { reason: "limit", lost: LOST.limit, field: r.field, detail: r.detail });
          throw new Stop();
        }
        if (!r.ok) {
          fail(run, {
            reason: r.reason,
            lost: r.reason === "cluster-inputs-missing" ? LOST.clusters : LOST.template,
            field: r.field,
            detail: r.detail,
            value: r.text,
          });
          continue;
        }
        const rendered = r.value as { metadata: DataMap; spec: DataMap };
        const name = rendered.metadata.name;
        if (typeof name === "string") {
          if (names.has(name)) {
            // Argo CD refuses a set with two Applications of one name and applies none of them
            documents.length = 0;
            fail(run, {
              reason: "render-failed",
              lost: LOST.generators,
              field: "spec.template.metadata.name",
              detail: "two generated Applications have the same name; Argo CD applies none of them",
              value: name,
            });
            throw new Stop();
          }
          names.add(name);
        }
        const md: { [key: string]: DataValue } = {};
        for (const k of ["name", "labels", "annotations", "finalizers"] as const) {
          if (rendered.metadata[k] !== undefined) md[k] = rendered.metadata[k] as DataValue;
        }
        // the Application lives in the ApplicationSet's namespace, whatever the template says
        md.namespace = namespace;
        documents.push({ apiVersion: "argoproj.io/v1alpha1", kind: "Application", metadata: md, spec: rendered.spec });
      }
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  }
  return finish();
}
