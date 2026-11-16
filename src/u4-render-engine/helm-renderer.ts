// HelmRenderer (U4; BR4.1 to BR4.3, BR4.20, FR3.1, FR3.6, FR3.8): renders a chart with `helm
// template` and never with anything that reaches a cluster. The argv is fixed: `template`, the
// namespace, `--include-crds` (unless the source skips CRDs), the values files in the order the
// controller applies them, then `--` and the release name and the chart directory. helm only ever
// reads crankpath's own copies: a chart of the repo is copied (with its in-root `file://`
// dependencies) into the private directory first, a chart from a repository comes from the chart
// cache. Every values input is written to a mode-0600 file in a private directory, never on the
// command line, and removed in every outcome (BR4.3).
//
// Before anything runs, the chart's `Chart.yaml` and `Chart.lock` are pre-read (BR4.20): a
// dependency whose `file://` path leaves the scanned root, or whose repository is not https or
// `oci://` or names an IP literal, loopback or link-local host, makes the node opaque
// `unsupported-field` naming the dependency, and `helm dependency build` is not run. helm is given
// no credential; helm follows redirects itself, which crankpath cannot stop (OD-29).

import path from "node:path";
import type { DataValue } from "../u1-graph-model/extractor.js";
import { asArray, isDataMap } from "../u1-graph-model/extractor.js";
import { makeOpaqueMark, type OpaqueMark, type UnreadableFile } from "../u1-graph-model/graph-model.js";
import { openRoot, parseYamlBounded } from "../u2-intake-config/bounded-reader.js";
import { entryKind } from "../u2-intake-config/tree-walk.js";
import type { FloatingRef, HelmJob, HelmValues, RenderedSet } from "../u3-discovery-expansion/render-job.js";
import { getChart } from "./chart-cache.js";
import { OUTCOME_WORDS } from "./command-runner.js";
import { caseVariantKey } from "./go-keys.js";
import { createPrivateTree, type PrivateTree } from "./private-copy.js";
import { commandMark, finishOutput, opaqueSet, type RenderIo } from "./render-io.js";
import { scanTemplates } from "./template-scan.js";
import { guardChartUrl, URL_PROBLEM_WORDS } from "./url-guard.js";

const RENDERS = "objects it renders";
const VALUES_LOST = "objects it renders with these values";
const LIMIT_OUTCOMES: ReadonlySet<string> = new Set(["too-large", "too-deep", "too-many-documents", "alias-limit"]);

type ChartPreRead =
  | { readonly ok: true; readonly dirs: readonly string[]; readonly needsBuild: boolean; readonly remote: boolean }
  | { readonly ok: false; readonly mark: OpaqueMark; readonly unreadable: readonly UnreadableFile[] };

function mark(
  reason: OpaqueMark["reason"],
  detail: string,
  extra: { field?: string | null; value?: string | null; lost?: string } = {},
): OpaqueMark {
  return makeOpaqueMark({
    reason,
    lostEdges: [extra.lost ?? RENDERS],
    detail,
    field: extra.field ?? null,
    value: extra.value ?? null,
  });
}

function joinInside(dir: string, rel: string): string | null {
  if (rel.startsWith("/") || rel.includes("\0")) return null;
  const joined = path.posix.normalize(dir === "" ? rel : `${dir}/${rel}`);
  if (joined === ".." || joined.startsWith("../") || path.posix.isAbsolute(joined)) return null;
  return joined === "." ? "" : joined.replace(/\/+$/, "");
}

/** Chart.yaml's fields (helm's chart.Metadata) and a dependency's (chart.Dependency), as helm decodes them. */
const CHART_KEYS: readonly string[] = Object.freeze([
  "apiVersion",
  "name",
  "version",
  "kubeVersion",
  "description",
  "type",
  "keywords",
  "home",
  "sources",
  "dependencies",
  "maintainers",
  "icon",
  "appVersion",
  "deprecated",
  "annotations",
  "condition",
  "tags",
]);
const LOCK_KEYS: readonly string[] = Object.freeze(["generated", "digest", "dependencies"]);
const DEPENDENCY_KEYS: readonly string[] = Object.freeze([
  "name",
  "version",
  "repository",
  "condition",
  "tags",
  "enabled",
  "import-values",
  "alias",
]);
/** Every file helm reads dependencies from (v2 charts: Chart.yaml and Chart.lock; v1: requirements.*). */
const DEPENDENCY_FILES = [
  { file: "Chart.yaml", keys: CHART_KEYS, required: true, declares: true },
  { file: "Chart.lock", keys: LOCK_KEYS, required: false, declares: false },
  { file: "requirements.yaml", keys: LOCK_KEYS, required: false, declares: true },
  { file: "requirements.lock", keys: LOCK_KEYS, required: false, declares: false },
] as const;
const CASE_DETAIL = "a key spelled otherwise than a helm field (helm matches keys without regard to case)";

function refuse(m: OpaqueMark, unreadable: readonly UnreadableFile[] = []): ChartPreRead {
  return { ok: false, mark: m, unreadable };
}

/**
 * Pre-reads a repo chart and its in-root `file://` dependencies, transitively (BR4.20; B2 review
 * M1, M2, m4): each chart directory is copied first and Chart.yaml, Chart.lock, requirements.yaml
 * and requirements.lock are read from the copy, with every key as helm matches it; every
 * dependency repository goes through the URL guard or must be an in-root `file://` directory.
 */
export function preReadChart(io: RenderIo, root: string, dir: string, tree: PrivateTree): ChartPreRead {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const queue = [dir];
  let needsBuild = false;
  let remote = false;
  for (let head = 0; head < queue.length; head++) {
    const d = queue[head] as string;
    if (seen.has(d)) continue;
    seen.add(d);
    dirs.push(d);
    const at = (f: string) => (d === "" ? f : `${d}/${f}`);
    const copied = tree.copy(d);
    if (!copied.ok) {
      return refuse(
        copied.writeFailed
          ? mark("render-failed", "crankpath could not write its private copy")
          : mark(
              "unreadable-file",
              "a file of the chart could not be read (symlinks are never followed); helm was not run",
            ),
        copied.unreadable,
      );
    }
    const vendored = tree.kind(at("charts")) === "dir" ? tree.walk(at("charts")) : null;
    const vendoredNames = new Set<string>();
    if (vendored?.ok) for (const f of vendored.files) vendoredNames.add(f.slice(f.lastIndexOf("/") + 1));
    for (const spec of DEPENDENCY_FILES) {
      const file = at(spec.file);
      if (tree.kind(file) !== "file") {
        if (spec.required) return refuse(mark("unreadable-file", "its Chart.yaml could not be read"));
        continue;
      }
      const read = tree.read(file);
      if (read.outcome !== "ok") {
        const u: UnreadableFile = {
          path: io.display(root, file),
          outcome: read.outcome,
          reasonWord: read.reasonWord,
          detail: read.detail ?? null,
        };
        return refuse(
          mark(LIMIT_OUTCOMES.has(read.outcome) ? "limit" : "unreadable-file", `its ${spec.file} could not be read`),
          [u],
        );
      }
      const doc = read.documents.length === 1 ? read.documents[0] : undefined;
      if (!isDataMap(doc)) return refuse(mark("render-failed", `its ${spec.file} is not one mapping`));
      const top = caseVariantKey(doc, spec.keys);
      if (top !== null) return refuse(mark("unsupported-field", CASE_DETAIL, { field: `${file}: ${top}` }));
      const list = doc.dependencies;
      if (list !== undefined && list !== null && !Array.isArray(list)) {
        return refuse(mark("unsupported-field", "dependencies is not a list", { field: `${file}: dependencies` }));
      }
      const deps = asArray(list);
      for (let i = 0; i < deps.length; i++) {
        const dep = deps[i];
        const field = `${file}: dependencies[${i}].repository`;
        if (!isDataMap(dep)) return refuse(mark("unsupported-field", "a dependency that is not a mapping", { field }));
        const variant = caseVariantKey(dep, DEPENDENCY_KEYS);
        if (variant !== null) {
          return refuse(mark("unsupported-field", CASE_DETAIL, { field: `${file}: dependencies[${i}].${variant}` }));
        }
        if (typeof dep.name !== "string")
          return refuse(mark("unsupported-field", "a dependency without a name", { field }));
        if (dep.repository !== undefined && dep.repository !== null && typeof dep.repository !== "string") {
          return refuse(mark("unsupported-field", "a repository that is not a string", { field }));
        }
        const repo = typeof dep.repository === "string" ? dep.repository : "";
        if (spec.declares) {
          const name = dep.name;
          const present =
            vendoredNames.has(name) ||
            [...vendoredNames].some((n) => n.startsWith(`${name}-`) && n.endsWith(".tgz")) ||
            tree.kind(at(`charts/${name}`)) === "dir";
          if (!present) needsBuild = true;
        }
        if (repo === "") continue;
        if (repo.startsWith("file://")) {
          const target = joinInside(d, repo.slice("file://".length));
          if (target === null) {
            return refuse(
              mark("unsupported-field", "a file:// dependency outside the scanned root is never read", {
                field,
                value: repo,
              }),
            );
          }
          const kind = io.kind(root, target);
          if (kind !== "dir") {
            return refuse(
              mark(
                kind === "symlink" ? "unreadable-file" : "render-failed",
                kind === "symlink"
                  ? "a file:// dependency is a symlink, never followed"
                  : "a file:// dependency is not a directory",
                { field, value: repo },
              ),
            );
          }
          queue.push(target);
          continue;
        }
        const guarded = guardChartUrl(repo);
        if (!guarded.ok) {
          const detail = repo.includes("://")
            ? URL_PROBLEM_WORDS[guarded.problem]
            : "only https, oci:// and file:// dependencies are read";
          return refuse(mark("unsupported-field", detail, { field, value: repo }));
        }
        if (spec.declares) remote = true;
      }
    }
  }
  return { ok: true, dirs, needsBuild, remote };
}

/** A values text for helm: parsed under the reader's limits first, and a mapping (or empty). */
function checkValuesText(text: string): "ok" | "limit" | "not-a-mapping" {
  const parsed = parseYamlBounded(text);
  if (!parsed.ok) return LIMIT_OUTCOMES.has(parsed.refusal) ? "limit" : "not-a-mapping";
  return parsed.documents.every((d) => d === null || isDataMap(d)) ? "ok" : "not-a-mapping";
}

function valuesProblem(
  check: "limit" | "not-a-mapping",
  what: string,
  extra: { field: string; value?: string },
): OpaqueMark {
  return check === "limit"
    ? mark("limit", `${what} is over a reader limit`, { ...extra, lost: VALUES_LOST })
    : mark("render-failed", `${what} is not a YAML mapping`, { ...extra, lost: VALUES_LOST });
}

function nested(pathParts: readonly string[], value: string): DataValue {
  let out: DataValue = value;
  for (let i = pathParts.length - 1; i >= 0; i--) {
    const o: { [key: string]: DataValue } = {};
    Object.defineProperty(o, pathParts[i] as string, { value: out, enumerable: true });
    out = o;
  }
  return out;
}

type ValuesFiles =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly mark: OpaqueMark; readonly unreadable: readonly UnreadableFile[] };

/** Writes every values input to its own mode-0600 file, in order (BR4.3, BR3.6). */
function writeValues(job: HelmJob, io: RenderIo, valuesDir: string, chartDir: string): ValuesFiles {
  const files: string[] = [];
  const write = (text: string): boolean => {
    const w = io.runtime.work.writeFile(valuesDir, `values-${files.length + 1}.yaml`, text);
    if (w.ok) files.push(w.path);
    return w.ok;
  };
  const writeFailed: ValuesFiles = {
    ok: false,
    mark: mark("render-failed", "crankpath could not write a private values file"),
    unreadable: [],
  };
  for (const v of job.values as readonly HelmValues[]) {
    switch (v.kind) {
      case "file": {
        const read = io.readText(v.root, v.path);
        if (read.outcome !== "ok") {
          if (read.outcome === "not-found" && v.optional) continue;
          const u: UnreadableFile = {
            path: io.display(v.root, v.path),
            outcome: read.outcome,
            reasonWord: read.reasonWord,
            detail: read.detail ?? null,
          };
          const reason = LIMIT_OUTCOMES.has(read.outcome) ? "limit" : "unreadable-file";
          return {
            ok: false,
            mark: mark(reason, "a values file could not be read", { field: v.field, value: v.path, lost: VALUES_LOST }),
            unreadable: [u],
          };
        }
        const check = checkValuesText(read.text);
        if (check !== "ok") {
          return {
            ok: false,
            mark: valuesProblem(check, "a values file", { field: v.field, value: v.path }),
            unreadable: [],
          };
        }
        if (!write(read.text)) return writeFailed;
        break;
      }
      case "chart-file": {
        // a values file inside a chart from a repository: crankpath's own cached copy
        const root = openRoot(chartDir);
        const kind = root.ok ? entryKind(root.root, v.path) : "missing";
        if (kind !== "file") {
          if (kind === "missing" && v.optional) continue;
          return {
            ok: false,
            mark: mark("unreadable-file", "a values file is not in the chart", {
              field: v.field,
              value: v.path,
              lost: VALUES_LOST,
            }),
            unreadable: [],
          };
        }
        files.push(path.join(chartDir, ...v.path.split("/")));
        break;
      }
      case "inline": {
        const check = checkValuesText(v.text);
        if (check !== "ok") {
          return { ok: false, mark: valuesProblem(check, "inline values", { field: v.field }), unreadable: [] };
        }
        if (!write(v.text)) return writeFailed;
        break;
      }
      case "object": {
        if (!write(`${JSON.stringify(v.value)}\n`)) return writeFailed;
        break;
      }
      case "ref": {
        const data = io.runtime.valuesData(v.id);
        const text = data === null ? undefined : Object.hasOwn(data, v.key) ? data[v.key] : undefined;
        if (text === undefined) {
          return {
            ok: false,
            mark: mark("render-failed", "the referenced values key is not in the object", {
              field: v.field,
              lost: VALUES_LOST,
            }),
            unreadable: [],
          };
        }
        if (v.targetPath !== null) {
          if (!write(`${JSON.stringify(nested(v.targetPath, text))}\n`)) return writeFailed;
        } else {
          const check = checkValuesText(text);
          if (check !== "ok") {
            return {
              ok: false,
              mark: valuesProblem(check, "the referenced values", { field: v.field }),
              unreadable: [],
            };
          }
          if (!write(text)) return writeFailed;
        }
        break;
      }
    }
  }
  return { ok: true, files };
}

export function renderHelm(job: HelmJob, io: RenderIo): RenderedSet {
  const rt = io.runtime;
  if (!rt.toolchain.helm.present) {
    return opaqueSet(job, mark("tool-missing", "helm not found on PATH"));
  }
  const jobDir = rt.work.makeDir("helm");
  if (!jobDir.ok) return opaqueSet(job, mark("render-failed", "crankpath could not create its private directory"));
  try {
    let chartDir: string;
    let resolvedVersion: string | null = null;
    if (job.chart.from === "repo") {
      const tree = createPrivateTree(io, job.chart.root, path.join(jobDir.path, "tree"));
      if (tree === null)
        return opaqueSet(job, mark("render-failed", "crankpath could not create its private directory"));
      const pre = preReadChart(io, job.chart.root, job.chart.dir, tree);
      if (!pre.ok) return opaqueSet(job, pre.mark, { unreadable: pre.unreadable });
      if (pre.needsBuild && pre.remote && !rt.network) {
        return opaqueSet(job, mark("offline", "a chart dependency must be fetched, and --no-network fetches nothing"));
      }
      chartDir = tree.abs(job.chart.dir);
      if (pre.needsBuild) {
        const built = rt.runner.run({
          tool: "helm",
          subcommand: ["dependency", "build"],
          args: ["--", chartDir],
          cwd: chartDir,
        });
        rt.record(built);
        if (built.outcome !== "ok") {
          return opaqueSet(job, commandMark("helm dependency build", built, RENDERS), { timedOut: built.timedOut });
        }
      }
    } else {
      const got = getChart(job.chart, rt);
      if (!got.ok) return opaqueSet(job, got.mark, { timedOut: got.timedOut });
      chartDir = got.dir;
      resolvedVersion = got.version;
    }
    const valuesDir = rt.work.makeDir("values");
    if (!valuesDir.ok) return opaqueSet(job, mark("render-failed", "crankpath could not create its private directory"));
    try {
      const values = writeValues(job, io, valuesDir.path, chartDir);
      if (!values.ok) return opaqueSet(job, values.mark, { unreadable: values.unreadable });
      const args = [
        ...(job.namespace === null ? [] : ["--namespace", job.namespace]),
        ...(job.includeCrds ? ["--include-crds"] : []),
        // always (B2 review M3): helm resolves a values.schema.json `$ref` itself, over the network
        // or from local files, with no guard; the graph needs no schema validation
        "--skip-schema-validation",
        ...values.files.flatMap((f) => ["--values", f]),
        "--",
        job.releaseName,
        chartDir,
      ];
      const template = () => {
        const r = rt.runner.run({ tool: "helm", subcommand: ["template"], args, cwd: jobDir.path });
        rt.record(r);
        return r;
      };
      const result = template();
      if (result.outcome !== "ok") {
        return opaqueSet(job, commandMark("helm template", result, RENDERS), { timedOut: result.timedOut });
      }
      const set = finishOutput(job, io, result.stdout, { kustomizeDirs: [], resolvedVersion });
      if (set.opaque !== null && set.objects.length === 0) return set;
      // Every Helm render is compared with a second one (B2 review pass 2, M3): a template function,
      // a value passed through `tpl` or a subchart can make the output change between runs, and no
      // reading of the templates can tell. Names that differ make the graph itself differ, so the
      // source is opaque; the same names with other content keep the first render, flagged. Two
      // renders cannot prove determinism: output that varies rarely can agree twice (pass 3, m1).
      // The second render's parse transient is asked of the run's budget, never counted as a
      // refused job; its output is not held. A second render that does not finish keeps the first
      // render and says the check was not made (pass 3, m4).
      const scan = scanTemplates(chartDir);
      const flags: FloatingRef[] = [
        ...(scan.random.length > 0
          ? [{ field: "chart templates", value: `${scan.random.join(", ")} (a value that changes between renders)` }]
          : []),
        ...(scan.network.length > 0
          ? [{ field: "chart templates", value: `${scan.network.join(", ")} (a lookup made at render time)` }]
          : []),
      ];
      const kept = (note: string | null): RenderedSet => ({
        ...set,
        notes: [...set.notes, ...flags, ...(note === null ? [] : [{ field: "helm template", value: note }])],
      });
      const again = template();
      if (again.outcome !== "ok") return kept(`determinism not checked: second render ${OUTCOME_WORDS[again.outcome]}`);
      const second = finishOutput(job, io, again.stdout, { kustomizeDirs: [], resolvedVersion, hold: false });
      if (second.opaque !== null && second.objects.length === 0) {
        return kept(`determinism not checked: second render not read (${second.opaque.detail})`);
      }
      const ids = (x: RenderedSet) => x.objects.map((o) => o.id).join("\n");
      if (ids(second) !== ids(set)) {
        return opaqueSet(
          job,
          mark("render-failed", "its output is not deterministic: object names differ between two renders"),
        );
      }
      const digests = (x: RenderedSet) => x.objects.map((o) => o.digest).join("\n");
      return kept(digests(second) !== digests(set) ? "content differs between two renders" : null);
    } finally {
      rt.work.remove(valuesDir.path);
    }
  } finally {
    rt.work.remove(jobDir.path);
  }
}
