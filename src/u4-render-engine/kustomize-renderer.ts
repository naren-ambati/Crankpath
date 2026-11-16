// KustomizeRenderer (U4; BR4.4, BR4.5, FR3.5): renders a Kustomize directory with `kustomize
// build --load-restrictor LoadRestrictionsRootOnly`, never with `--enable-helm`, plugins or exec
// functions. kustomize has no flag that disables remote bases, so every kustomization the build
// would read is pre-read first through BoundedReader:
// - a `resources`, `bases`, `components`, `patches`, `configurations` (or other path) entry that is
//   a URL, or that is not a file or directory of the repo (kustomize would fetch it as a remote
//   base), or a kustomization file or entry that is a symlink, makes the directory opaque
//   `remote-base` before kustomize runs;
// - an entry that leaves the scanned root fails closed as `render-failed` (BR4.5);
// - Helm inflation (`helmCharts`) is `unsupported-field`: it is never enabled.
// - a file entry outside its kustomization's directory is `render-failed`, named (kustomize, run
//   as Argo CD runs it, loads files only in or below that directory);
// - a file kustomize loads as configuration (a `generators`, `transformers`, `validators` or
//   `configurations` entry, a `replacements` path) is read from the private copy and is
//   `unsupported-field` when any string in it names a URL (`://`, or a leading `//`), or when a
//   path key in it (`path`, `paths`, `files`, `envs`, `env`, in any case) is not a plain relative
//   path in the directory: kustomize loads those through the loader that fetches URLs (B2 review
//   pass 3, M1). Data files (resources, patches, generator sources, CRDs, OpenAPI schemas) are
//   loaded as content and never name a file kustomize loads, so a URL in them is just content.
// The closure of kustomization directories is then copied into the private directory and kustomize
// builds the copy, so it reads exactly what was checked and nothing through a symlink.

import path from "node:path";
import type { DataValue } from "../u1-graph-model/extractor.js";
import { asArray, getPath, isDataMap } from "../u1-graph-model/extractor.js";
import { makeOpaqueMark, type OpaqueMark, type UnreadableFile } from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import type { KustomizeJob, RenderedSet } from "../u3-discovery-expansion/render-job.js";
import { KUSTOMIZATION_FILES } from "../u3-discovery-expansion/source-discovery.js";
import { caseVariantKey, foldKey } from "./go-keys.js";
import { createPrivateTree, type PrivateTree } from "./private-copy.js";
import { yamlShapeProblem } from "./yaml-shape.js";
import { commandMark, finishOutput, opaqueSet, type RenderIo } from "./render-io.js";

const RENDERS = "objects it renders";
const LIMIT_OUTCOMES: ReadonlySet<string> = new Set(["too-large", "too-deep", "too-many-documents", "alias-limit"]);

/** Fields whose entries are kustomizations or files kustomize would otherwise fetch remotely. */
const BASE_FIELDS = ["resources", "bases", "components"] as const;
/** Fields whose string entries are file (or directory) paths. */
const PATH_LIST_FIELDS = [
  "configurations",
  "crds",
  "generators",
  "transformers",
  "validators",
  "patchesStrategicMerge",
] as const;
// a control character (a newline above all) can never be part of a plain relative path
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find them
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const HELM_FIELDS = ["helmCharts", "helmChartInflationGenerator", "helmGlobals"] as const;

export type PreRead =
  | { readonly ok: true; readonly dirs: readonly string[]; readonly tree: PrivateTree }
  | {
      readonly ok: false;
      readonly mark: OpaqueMark;
      readonly unreadable: readonly UnreadableFile[];
      /** The directories read, when the failure came after the pre-read (the copy). */
      readonly dirs?: readonly string[];
    };

function fail(
  reason: "remote-base" | "render-failed" | "unsupported-field" | "unreadable-file" | "limit",
  detail: string,
  extra: { field?: string; value?: string | null; unreadable?: UnreadableFile[] } = {},
): PreRead {
  return {
    ok: false,
    mark: makeOpaqueMark({
      reason,
      lostEdges: [RENDERS],
      detail,
      field: extra.field ?? null,
      value: extra.value ?? null,
    }),
    unreadable: extra.unreadable ?? [],
  };
}

function join(dir: string, entry: string): string | null {
  if (entry.startsWith("/") || entry.includes("\0")) return null;
  const joined = path.posix.normalize(dir === "" ? entry : `${dir}/${entry}`);
  if (joined === ".." || joined.startsWith("../") || path.posix.isAbsolute(joined)) return null;
  return joined === "." ? "" : joined.replace(/\/+$/, "");
}

/**
 * A URL (`scheme://`) or an scp-style git address (`git@host:org/repo`). A base written as
 * `host.tld/org/repo//path` is caught below: it is not a file or directory of the repo.
 */
function looksRemote(entry: string): boolean {
  return entry.includes("://") || /^[^/]*@[^/]*:/.test(entry);
}

/**
 * Every entry of every list a kustomization names files or bases in, with its field (B2 review
 * pass 2, M1): kustomize loads `generators`, `transformers`, `validators`, `configurations` and
 * `crds` entries as files, then as directories or remote bases, like `resources`, `bases` and
 * `components`, so all of them are judged as bases. An entry that is not a plain one-line string
 * is refused (`plain: false`), whatever its YAML form (block or folded scalar, quoted multi-line,
 * flow, a mapping, a number). Only a strategic-merge patch may be inline YAML: kustomize never
 * fetches one.
 */
interface Entry {
  readonly field: string;
  readonly value: string;
  readonly base: boolean;
  readonly plain: boolean;
  /** A file kustomize loads as configuration, whose own path keys it loads in turn (pass 3, M1). */
  readonly config: boolean;
}

/** Fields whose files kustomize loads as configuration (plugin, transformer or validator configs). */
const CONFIG_FIELDS: ReadonlySet<string> = new Set(["generators", "transformers", "validators", "configurations"]);

function entries(doc: { [key: string]: DataValue }): Entry[] {
  const out: Entry[] = [];
  const push = (field: string, v: DataValue | undefined, base: boolean, config = false): void => {
    if (v === undefined || v === null) return;
    const plain = typeof v === "string" && v.length > 0 && !CONTROL.test(v);
    out.push({ field, value: typeof v === "string" ? v : JSON.stringify(v), base, plain, config });
  };
  for (const f of BASE_FIELDS)
    asArray(doc[f]).forEach((v, i) => {
      push(`${f}[${i}]`, v, true);
    });
  for (const f of PATH_LIST_FIELDS) {
    asArray(doc[f]).forEach((v, i) => {
      // a strategic-merge patch written inline is YAML text, not a path, and is never fetched
      if (f === "patchesStrategicMerge" && typeof v === "string" && v.includes("\n")) return;
      push(`${f}[${i}]`, v, f !== "patchesStrategicMerge", CONFIG_FIELDS.has(f));
    });
  }
  asArray(doc.patches).forEach((v, i) => {
    push(`patches[${i}].path`, getPath(v, ["path"]), false);
  });
  asArray(doc.patchesJson6902).forEach((v, i) => {
    push(`patchesJson6902[${i}].path`, getPath(v, ["path"]), false);
  });
  asArray(doc.replacements).forEach((v, i) => {
    push(`replacements[${i}].path`, getPath(v, ["path"]), false, true);
  });
  push("openapi.path", getPath(doc.openapi, ["path"]), false);
  for (const g of ["configMapGenerator", "secretGenerator"] as const) {
    asArray(doc[g]).forEach((v, i) => {
      for (const k of ["files", "envs"] as const) {
        asArray(getPath(v, [k])).forEach((f, j) => {
          push(
            `${g}[${i}].${k}[${j}]`,
            typeof f === "string" && f.includes("=") ? f.slice(f.indexOf("=") + 1) : f,
            false,
          );
        });
      }
      push(`${g}[${i}].env`, getPath(v, ["env"]), false);
    });
  }
  return out;
}

/** Every field of a kustomization (kustomize v5.8.1 `api/types/kustomization.go`, with TypeMeta's two). */
export const KUSTOMIZATION_KEYS: readonly string[] = Object.freeze([
  "apiVersion",
  "kind",
  "metadata",
  "openapi",
  "namePrefix",
  "nameSuffix",
  "namespace",
  "commonLabels",
  "labels",
  "commonAnnotations",
  "patchesStrategicMerge",
  "patchesJson6902",
  "patches",
  "images",
  "imageTags",
  "replacements",
  "replicas",
  "vars",
  "sortOptions",
  "resources",
  "components",
  "crds",
  "bases",
  "configMapGenerator",
  "secretGenerator",
  "helmGlobals",
  "helmCharts",
  "helmChartInflationGenerator",
  "generatorOptions",
  "configurations",
  "generators",
  "transformers",
  "validators",
  "buildMetadata",
]);
/** Entry fields that name files, checked for case-variant spellings (B2 review M1). */
const ENTRY_PATH_KEYS: readonly string[] = Object.freeze(["path", "files", "envs", "env"]);
const ENTRY_FIELDS = ["patches", "patchesJson6902", "replacements", "configMapGenerator", "secretGenerator"] as const;

/** A key kustomize would honour that the pre-read would not see by its exact name, or an unknown key. */
function keyProblem(doc: { [key: string]: DataValue }): { field: string; detail: string } | null {
  const variant = caseVariantKey(doc, KUSTOMIZATION_KEYS);
  if (variant !== null) {
    return {
      field: variant,
      detail: "a key spelled otherwise than a kustomize field (kustomize matches keys without regard to case)",
    };
  }
  for (const key of Object.keys(doc)) {
    if (!KUSTOMIZATION_KEYS.includes(key)) return { field: key, detail: "not a kustomize field" };
  }
  for (const f of ENTRY_FIELDS) {
    const list = asArray(doc[f]);
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!isDataMap(entry)) continue;
      const v = caseVariantKey(entry, ENTRY_PATH_KEYS);
      if (v !== null) {
        return {
          field: `${f}[${i}].${v}`,
          detail: "a key spelled otherwise than a kustomize field (kustomize matches keys without regard to case)",
        };
      }
    }
  }
  if (isDataMap(doc.openapi)) {
    const v = caseVariantKey(doc.openapi, ENTRY_PATH_KEYS);
    if (v !== null)
      return {
        field: `openapi.${v}`,
        detail: "a key spelled otherwise than a kustomize field (kustomize matches keys without regard to case)",
      };
  }
  return null;
}

const SHAPE_DETAIL = {
  tag: "a YAML tag (kustomize may decode the value otherwise than crankpath reads it)",
  style:
    "a quoted or plain scalar with an escape or a line break (kustomize may decode it otherwise than crankpath reads it)",
} as const;

/** A kustomization or configuration file whose text kustomize may decode otherwise (pass 4, M1), refused whole. */
function shapeFail(io: RenderIo, root: string, file: string, text: string): PreRead | null {
  const p = yamlShapeProblem(text);
  return p === null
    ? null
    : fail("unsupported-field", SHAPE_DETAIL[p.kind], { field: io.display(root, file), value: p.token });
}

/** True when `target` is `dir` or below it. */
function inDir(dir: string, target: string): boolean {
  return dir === "" || target === dir || target.startsWith(`${dir}/`);
}

/** Keys of a configuration file whose values kustomize loads as files (folded as Go folds keys). */
const CONFIG_PATH_KEYS: ReadonlySet<string> = new Set(["path", "paths", "files", "envs", "env"].map(foldKey));
const SINGLE_PATH_KEYS: ReadonlySet<string> = new Set(["path", "env"].map(foldKey));
// conservative (pass 4, m2): any string with `://` and any path key that is not plain is refused,
// a literal included (`literals: [URL=https://...]`), because the scan does not tell them apart
const CONFIG_DETAIL =
  "a kustomize configuration file names a URL or a non-plain path that kustomize may load; crankpath does not tell a literal from a path here";

/**
 * The first string of a configuration file that names a URL, or the first path-key value that is
 * not a plain relative path in or below `dir`, with where it is; null when there is none.
 */
function configProblem(
  dir: string,
  value: DataValue,
  at: string,
): { at: string; value: string; detail: string } | null {
  if (typeof value === "string") {
    return value.includes("://") || value.startsWith("//") ? { at, value, detail: CONFIG_DETAIL } : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const p = configProblem(dir, value[i] as DataValue, `${at}[${i}]`);
      if (p !== null) return p;
    }
    return null;
  }
  if (!isDataMap(value)) return null;
  for (const [key, v] of Object.entries(value)) {
    const here = at === "" ? key : `${at}.${key}`;
    const p = configProblem(dir, v, here);
    if (p !== null) return p;
    if (!CONFIG_PATH_KEYS.has(foldKey(key))) continue;
    // `path` and `env` hold one path, the plural keys a list of them
    const single = SINGLE_PATH_KEYS.has(foldKey(key));
    if (single === Array.isArray(v)) {
      return { at: here, value: typeof v === "string" ? v : JSON.stringify(v), detail: CONFIG_DETAIL };
    }
    const list = Array.isArray(v) ? v : [v];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const where = Array.isArray(v) ? `${here}[${i}]` : here;
      const raw =
        typeof item === "string" && foldKey(key) === foldKey("files") && item.includes("=")
          ? item.slice(item.indexOf("=") + 1)
          : item;
      const bad = {
        at: where,
        value: typeof item === "string" ? item : JSON.stringify(item),
        detail: CONFIG_DETAIL,
      };
      if (typeof raw !== "string" || raw.length === 0 || CONTROL.test(raw) || looksRemote(raw)) return bad;
      // in or below the directory, which is copied whole (a symlink there has already failed the copy)
      const target = join(dir, raw);
      if (target === null || !inDir(dir, target)) return bad;
    }
  }
  return null;
}

/**
 * Pre-reads every kustomization the build of `dir` would read (BR4.4, BR4.5), from crankpath's
 * private copy: each kustomization file is copied, then parsed from the copy, so the bytes checked
 * are the bytes kustomize reads (B2 review m4). Paths are judged on the original by lstat only.
 */
export function preReadKustomization(io: RenderIo, root: string, dir: string, given?: PrivateTree): PreRead {
  let tree = given ?? null;
  if (tree === null) {
    const made = io.runtime.work.makeDir("preread");
    tree = made.ok ? createPrivateTree(io, root, path.join(made.path, "tree")) : null;
    if (tree === null) return fail("render-failed", "crankpath could not create its private directory");
  }
  const seen = new Set<string>();
  const queue = [dir];
  const configs: { field: string; file: string; dir: string }[] = [];
  for (let head = 0; head < queue.length; head++) {
    const d = queue[head] as string;
    if (seen.has(d)) continue;
    seen.add(d);
    const names = [...KUSTOMIZATION_FILES];
    const kinds = names.map((n) => ({ name: n, kind: io.kind(root, d === "" ? n : `${d}/${n}`) }));
    const linked = kinds.find((k) => k.kind === "symlink");
    if (linked !== undefined) {
      return fail("remote-base", "a kustomization file is a symlink, never followed", {
        value: io.display(root, d === "" ? linked.name : `${d}/${linked.name}`),
      });
    }
    const present = kinds.filter((k) => k.kind === "file");
    if (present.length !== 1) {
      return fail(
        "render-failed",
        present.length === 0 ? "a base is not a kustomization" : "more than one kustomization file",
        { value: io.display(root, d === "" ? "." : d) },
      );
    }
    const file = d === "" ? (present[0] as { name: string }).name : `${d}/${(present[0] as { name: string }).name}`;
    const copied = tree.copyFile(file);
    if (!copied.ok) {
      return copied.writeFailed
        ? fail("render-failed", "crankpath could not write its private copy")
        : fail("unreadable-file", "its kustomization file could not be read", { unreadable: [...copied.unreadable] });
    }
    let text = "";
    const read = tree.read(file, (t) => {
      text = t;
    });
    // judged on the text before anything parsed from it, so a tag the reader refuses is named too
    const shape = shapeFail(io, root, file, text);
    if (shape !== null) return shape;
    if (read.outcome !== "ok") {
      const u: UnreadableFile = {
        path: io.display(root, file),
        outcome: read.outcome,
        reasonWord: read.reasonWord,
        detail: read.detail ?? null,
      };
      return fail(
        LIMIT_OUTCOMES.has(read.outcome) ? "limit" : "unreadable-file",
        "its kustomization file could not be read",
        {
          unreadable: [u],
        },
      );
    }
    const doc = read.documents.length === 1 ? read.documents[0] : undefined;
    if (!isDataMap(doc))
      return fail("render-failed", "a kustomization file is not one mapping", { value: io.display(root, file) });
    const problem = keyProblem(doc);
    if (problem !== null) return fail("unsupported-field", problem.detail, { field: problem.field });
    for (const f of HELM_FIELDS) {
      if (doc[f] !== undefined)
        return fail("unsupported-field", "Helm inflation in kustomize is never enabled", { field: f });
    }
    for (const e of entries(doc)) {
      if (!e.plain) {
        return fail("unsupported-field", "an entry that is not a plain relative path", {
          field: e.field,
          value: e.value,
        });
      }
      if (looksRemote(e.value)) {
        return fail("remote-base", "a remote base or URL entry is never fetched", { field: e.field, value: e.value });
      }
      const target = join(d, e.value);
      if (target === null) {
        return fail("render-failed", "an entry leaves the scanned root", { field: e.field, value: e.value });
      }
      const kind = io.kind(root, target);
      if (kind === "symlink") {
        return fail("remote-base", "an entry is a symlink, never followed", { field: e.field, value: e.value });
      }
      if (kind === "outside")
        return fail("render-failed", "an entry leaves the scanned root", { field: e.field, value: e.value });
      if (kind === "file" && !inDir(d, target)) {
        return fail(
          "render-failed",
          "an entry names a file outside its kustomization's directory (kustomize loads files only in or below it)",
          { field: e.field, value: e.value },
        );
      }
      if (kind === "file" && e.config) configs.push({ field: e.field, file: target, dir: d });
      if (kind === "missing" && e.base) {
        return fail("remote-base", "an entry that is not in the repository (kustomize would fetch it)", {
          field: e.field,
          value: e.value,
        });
      }
      if (kind === "dir" && e.base) queue.push(target);
    }
  }
  const dirs = [...seen].sort(compareCodePoints);
  for (const d of dirs) {
    const copied = tree.copy(d);
    if (!copied.ok) {
      const link = copied.unreadable.find((u) => u.outcome === "symlink");
      return {
        ok: false,
        mark: makeOpaqueMark({
          reason: "render-failed",
          lostEdges: [RENDERS],
          detail: copied.writeFailed
            ? "crankpath could not write its private copy"
            : link !== undefined
              ? "a symlink in its directory is never followed (the directory is copied whole), so kustomize was not run"
              : "a file under it could not be read; kustomize was not run",
          value: link?.path ?? null,
        }),
        unreadable: copied.unreadable,
        dirs,
      };
    }
  }
  // configuration files, read from the copy kustomize will read (pass 3, M1)
  for (const c of configs) {
    let text = "";
    const read = tree.read(c.file, (t) => {
      text = t;
    });
    const shape = shapeFail(io, root, c.file, text);
    if (shape !== null) return { ...shape, dirs } as PreRead;
    if (read.outcome !== "ok") {
      const u: UnreadableFile = {
        path: io.display(root, c.file),
        outcome: read.outcome,
        reasonWord: read.reasonWord,
        detail: read.detail ?? null,
      };
      return {
        ...fail(
          LIMIT_OUTCOMES.has(read.outcome) ? "limit" : "unreadable-file",
          "a kustomize configuration file could not be read",
          { field: c.field, unreadable: [u] },
        ),
        dirs,
      } as PreRead;
    }
    for (const doc of read.documents) {
      const p = configProblem(c.dir, doc, "");
      if (p !== null) {
        return {
          ...fail("unsupported-field", p.detail, {
            field: p.at === "" ? c.field : `${c.field} ${p.at}`,
            value: p.value,
          }),
          dirs,
        } as PreRead;
      }
    }
  }
  return { ok: true, dirs, tree };
}

/** True when the directory's kustomization is a `kind: Component`, which kustomize cannot build on its own. */
export function isKustomizeComponent(io: RenderIo, root: string, dir: string): boolean {
  for (const name of KUSTOMIZATION_FILES) {
    const file = dir === "" ? name : `${dir}/${name}`;
    if (io.kind(root, file) !== "file") continue;
    const read = io.read(root, file);
    return read.outcome === "ok" && read.documents.length === 1 && getPath(read.documents[0], ["kind"]) === "Component";
  }
  return false;
}

export function renderKustomize(job: KustomizeJob, io: RenderIo): RenderedSet {
  const rt = io.runtime;
  const jobDir = rt.work.makeDir("kustomize");
  if (!jobDir.ok) {
    return opaqueSet(
      job,
      makeOpaqueMark({
        reason: "render-failed",
        lostEdges: [RENDERS],
        detail: "crankpath could not create its private directory",
      }),
    );
  }
  try {
    const made = createPrivateTree(io, job.root, path.join(jobDir.path, "tree"));
    if (made === null) {
      return opaqueSet(
        job,
        makeOpaqueMark({
          reason: "render-failed",
          lostEdges: [RENDERS],
          detail: "crankpath could not create its private directory",
        }),
      );
    }
    const pre = preReadKustomization(io, job.root, job.dir, made);
    if (!pre.ok) return opaqueSet(job, pre.mark, { unreadable: pre.unreadable, kustomizeDirs: pre.dirs ?? [] });
    const dirs = pre.dirs;
    if (!rt.toolchain.kustomize.present) {
      // the directories it would build are known (pre-read), so the Kustomize roots they are take this mark
      return opaqueSet(
        job,
        makeOpaqueMark({ reason: "tool-missing", lostEdges: [RENDERS], detail: "kustomize not found on PATH" }),
        { kustomizeDirs: dirs },
      );
    }
    const tree = pre.tree.base;
    const target = job.dir === "" ? tree : path.join(tree, ...job.dir.split("/"));
    const result = rt.runner.run({
      tool: "kustomize",
      subcommand: ["build"],
      args: ["--load-restrictor", "LoadRestrictionsRootOnly", "--", target],
      cwd: jobDir.path,
    });
    rt.record(result);
    if (result.outcome !== "ok") {
      return opaqueSet(job, commandMark("kustomize build", result, RENDERS), {
        timedOut: result.timedOut,
        kustomizeDirs: dirs,
      });
    }
    return finishOutput(job, io, result.stdout, { kustomizeDirs: dirs, resolvedVersion: null });
  } finally {
    rt.work.remove(jobDir.path);
  }
}
