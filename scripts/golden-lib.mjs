// GoldenHarness and MutationChecker (U11; US11.2, US11.3, US11.6; contract C11): the library behind
// `npm run verify:golden` (scripts/golden.mjs) and the offline golden test
// (test/u11-validation-harness/golden-harness.test.ts).
//
// A golden case is a folder `test/golden/<case>/` holding:
//   input.json   the input manifest: a committed fixture (with overlays) or a pinned fetch
//                (url + full sha), the crankpath arguments, what the case needs (helm, the
//                network), the tool versions its expected output was reviewed with, and its
//                declared mutations;
//   expected.json, expected.txt   the reviewed output of a real run (`form: full`: crankpath's own
//                JSON and text; `form: reduced`: the reduced form below, for estates whose text
//                may not be committed);
//   reviewed.md  who reviewed the real-run output, when, what was checked, every edit and why.
//
// The reduced form holds node ids and counts only: cycle ids, labels, node-id sets and edges as
// (from, kind, to) node ids, counts of edges by kind, opaque items by reason, unresolved items by
// reason, statuses, plan step kinds and node ids, externals by id and cold start. It carries no
// other string from the scanned repository (no values, fields, files, annotations, URLs).
//
// Nothing here writes inside the repository: fetched sources, work trees and observed outputs go
// to the golden cache (`CRANKPATH_GOLDEN_CACHE`, default `<home>/.cache/crankpath-golden`), which
// must lie outside the checkout. Fetches are read-only `git clone` and `git checkout` of public
// repositories at a pinned full sha.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GOLDEN_DIR = path.join(ROOT, "test", "golden");
export const BIN = path.join(ROOT, "dist", "u9-cli-package", "cli.js");
export const REDUCED_FORM = "crankpath-golden-reduced/1";

/** The needs a case may declare: each one missing makes the case SKIPPED with its reason. */
export const NEEDS = Object.freeze(["helm", "kustomize", "git", "network"]);
const FULL_SHA = /^[0-9a-f]{40}$/;
const CASE_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * @typedef {{ id: string, url: string, rev: string, sha: string, sparse?: string[] }} FetchSpec
 * @typedef {{ op: "remove", path: string }
 *   | { op: "write", path: string, content: string }
 *   | { op: "replace", path: string, from: string, to: string }
 *   | { op: "drop-arg", flag: string, startsWith: string }
 *   | { op: "drop-overlay", overlay: string }} Edit
 * @typedef {{ id: string, kind: string, why: string, edits: Edit[], expect?: Record<string, unknown> }} Mutation
 * @typedef {{
 *   case: string, description: string, form: "full" | "reduced", needs: string[],
 *   tools?: { helm?: string, kustomize?: string },
 *   input: { fixture?: string, parts?: string[], overlays?: string[], fetched?: string, scan: string },
 *   exit?: number,
 *   fetch: FetchSpec[], args: string[], expectedDir?: string, mutations: Mutation[]
 * }} GoldenCase
 * @typedef {{ ok: boolean, version: string | null, why: string }} Probe
 * @typedef {{ helm: Probe, kustomize: Probe, git: Probe, network: Probe, toolPath: string }} Environment
 */

/** @param {unknown} c @param {string} msg @returns {asserts c} */
function need(c, msg) {
  if (!c) throw new Error(`golden: ${msg}`);
}

/** A relative path inside its base, never absolute and never climbing out. @param {string} p */
function relInside(p) {
  return typeof p === "string" && p !== "" && !path.isAbsolute(p) && !p.split(/[\\/]/).includes("..");
}

/** The case folders, sorted. @param {string} [dir] */
export function listCases(dir = GOLDEN_DIR) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "input.json")))
    .map((e) => e.name)
    .sort();
}

/** Reads and checks one case's input manifest. @param {string} id @param {string} [dir] @returns {GoldenCase} */
export function loadCase(id, dir = GOLDEN_DIR) {
  need(CASE_ID.test(id), `bad case id ${JSON.stringify(id)}`);
  const c = JSON.parse(fs.readFileSync(path.join(dir, id, "input.json"), "utf8"));
  need(c.case === id, `${id}: input.json names case ${JSON.stringify(c.case)}`);
  need(c.form === "full" || c.form === "reduced", `${id}: form must be full or reduced`);
  need(Array.isArray(c.needs) && c.needs.every((/** @type {string} */ n) => NEEDS.includes(n)), `${id}: bad needs`);
  need(Array.isArray(c.args) && c.args.every((/** @type {unknown} */ a) => typeof a === "string"), `${id}: bad args`);
  need(Array.isArray(c.fetch) && Array.isArray(c.mutations), `${id}: fetch and mutations must be lists`);
  need(typeof c.input === "object" && c.input !== null && relInside(c.input.scan), `${id}: bad input`);
  need((c.input.fixture === undefined) !== (c.input.fetched === undefined), `${id}: one of fixture or fetched`);
  if (c.input.fixture !== undefined) need(relInside(c.input.fixture), `${id}: fixture must be a repo path`);
  for (const o of c.input.overlays ?? []) need(relInside(o), `${id}: overlay must be a repo path`);
  for (const p of c.input.parts ?? []) need(relInside(p), `${id}: part must be a path in the fixture`);
  if (c.expectedDir !== undefined) need(relInside(c.expectedDir), `${id}: expectedDir must be a repo path`);
  for (const t of ["helm", "kustomize"])
    if (c.needs.includes(t))
      need(
        typeof c.tools?.[t] === "string",
        `${id}: a case that needs ${t} names the ${t} version it was reviewed with (tools.${t})`,
      );
  if (c.fetch.length > 0)
    need(c.needs.includes("network") && c.needs.includes("git"), `${id}: a fetch needs git and network`);
  for (const f of c.fetch) {
    need(CASE_ID.test(f.id), `${id}: bad fetch id`);
    need(
      typeof f.url === "string" && f.url.startsWith("https://") && !f.url.includes("@"),
      `${id}: fetch url must be https without userinfo`,
    );
    need(FULL_SHA.test(f.sha), `${id}: fetch ${f.id} needs a full 40-hex sha`);
    for (const s of f.sparse ?? []) need(relInside(s), `${id}: bad sparse path`);
  }
  if (c.input.fetched !== undefined)
    need(
      c.fetch.some((/** @type {FetchSpec} */ f) => f.id === c.input.fetched),
      `${id}: fetched names no fetch`,
    );
  const ids = new Set();
  for (const m of c.mutations) {
    need(CASE_ID.test(m.id) && !ids.has(m.id), `${id}: bad or repeated mutation id`);
    ids.add(m.id);
    need(Array.isArray(m.edits) && m.edits.length > 0, `${id}/${m.id}: a mutation needs edits`);
  }
  return c;
}

/** Where a case's expected files live (the case folder unless `expectedDir` says otherwise). @param {GoldenCase} c @param {string} [dir] */
export function expectedDir(c, dir = GOLDEN_DIR) {
  return c.expectedDir === undefined ? path.join(dir, c.case) : path.join(ROOT, c.expectedDir);
}

/** The golden cache root; refused inside the checkout. @param {NodeJS.ProcessEnv} [env] */
export function cacheRoot(env = process.env) {
  const dir = path.resolve(env.CRANKPATH_GOLDEN_CACHE ?? path.join(os.homedir(), ".cache", "crankpath-golden"));
  const rel = path.relative(ROOT, dir);
  need(rel.startsWith("..") || path.isAbsolute(rel), "the golden cache must lie outside the repository");
  return dir;
}

/** @param {string} name @param {string} searchPath */
function findOnPath(name, searchPath) {
  for (const dir of searchPath.split(path.delimiter)) {
    if (dir === "" || !path.isAbsolute(dir)) continue;
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && (st.mode & 0o111) !== 0) return p;
    } catch {
      // not here
    }
  }
  return null;
}

/** @param {string} file @param {string[]} args @param {number} [timeout] */
function version(file, args, timeout = 20_000) {
  const r = spawnSync(file, args, { encoding: "utf8", timeout, env: { PATH: "", HOME: os.tmpdir() } });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * What this machine offers: helm, kustomize and git on PATH (with versions) and the network (a
 * read-only `git ls-remote` of a public repository). The network is probed only when git is there.
 * @param {{ searchPath?: string, networkProbe?: string, offline?: boolean }} [o]
 * @returns {Environment}
 */
export function probeEnvironment(o = {}) {
  const searchPath = o.searchPath ?? process.env.PATH ?? "";
  const helm = findOnPath("helm", searchPath);
  const kustomize = findOnPath("kustomize", searchPath);
  const git = findOnPath("git", searchPath);
  /** @param {string | null} file @param {string} name @param {string[]} args @param {(s: string) => string | null} pick @returns {Probe} */
  const tool = (file, name, args, pick) => {
    if (file === null) return { ok: false, version: null, why: `${name} not found on PATH` };
    const out = version(file, args);
    const v = out === null ? null : pick(out);
    return v === null
      ? { ok: false, version: null, why: `${name} did not report a version` }
      : { ok: true, version: v, why: "" };
  };
  const helmP = tool(helm, "helm", ["version", "--template", "{{.Version}}"], (s) =>
    /^v\d+\.\d+\.\d+$/.test(s) ? s : null,
  );
  const kustomizeP = tool(kustomize, "kustomize", ["version"], (s) => /^(v\d+\.\d+\.\d+)$/.exec(s)?.[1] ?? null);
  const gitP = tool(git, "git", ["--version"], (s) => /^git version (\S+)/.exec(s)?.[1] ?? null);
  /** @type {Probe} */
  let network;
  if (o.offline) network = { ok: false, version: null, why: "network not used (--offline)" };
  else if (git === null || !gitP.ok)
    network = { ok: false, version: null, why: "network not probed: git not found on PATH" };
  else {
    const url = o.networkProbe ?? "https://github.com/hashicorp/vault-helm";
    const r = spawnSync(git, [...GIT_SAFE, "ls-remote", "--exit-code", "--", url, "HEAD"], {
      encoding: "utf8",
      timeout: 30_000,
      env: gitEnv(),
    });
    network =
      r.status === 0
        ? { ok: true, version: null, why: "" }
        : {
            ok: false,
            version: null,
            why: `network unreachable (git ls-remote of a public repository: ${r.error ? "timed out" : `exit ${r.status}`})`,
          };
  }
  const dirs = [helm, kustomize].filter((p) => p !== null).map((p) => path.dirname(/** @type {string} */ (p)));
  const toolPath = [...new Set([...dirs, path.dirname(process.execPath)])].join(path.delimiter);
  return { helm: helmP, kustomize: kustomizeP, git: gitP, network, toolPath };
}

/**
 * The PATH a case's crankpath runs with: helm and kustomize only when the case needs them, so a
 * case that needs neither prints the same toolchain line on every machine.
 * @param {GoldenCase} c @param {Environment} env
 */
export function toolPathFor(c, env) {
  return c.needs.includes("helm") || c.needs.includes("kustomize") ? env.toolPath : path.dirname(process.execPath);
}

/** Why a case cannot run here, or null when it can. @param {GoldenCase} c @param {Environment} env */
export function skipReason(c, env) {
  const reasons = [];
  for (const n of c.needs) {
    const p = /** @type {Probe} */ (env[/** @type {"helm" | "kustomize" | "git" | "network"} */ (n)]);
    if (!p.ok) reasons.push(p.why);
  }
  for (const [tool, want] of Object.entries(c.tools ?? {})) {
    const p = /** @type {Probe} */ (env[/** @type {"helm" | "kustomize"} */ (tool)]);
    if (p.ok && p.version !== want)
      reasons.push(`${tool} ${p.version} is not ${want}, the version the expected output was reviewed with`);
  }
  return reasons.length === 0 ? null : reasons.join("; ");
}

// Fixed git options for the harness's own read-only fetches: no hooks, https only, no submodules,
// no redirects, no credential prompt, no fsmonitor.
const GIT_SAFE = Object.freeze([
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "submodule.recurse=false",
  "-c",
  "http.followRedirects=false",
  "-c",
  "credential.helper=",
]);
function gitEnv() {
  return {
    PATH: process.env.PATH ?? "",
    HOME: os.tmpdir(),
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    LANG: "C",
  };
}
/** @param {string[]} args @param {string} [cwd] */
function git(args, cwd) {
  const r = spawnSync("git", [...GIT_SAFE, ...args], { cwd, encoding: "utf8", env: gitEnv(), timeout: 600_000 });
  if (r.status !== 0)
    throw new Error(`golden: git ${args[0]} failed (exit ${r.status}): ${(r.stderr ?? "").trim().split("\n").at(-1)}`);
  return r.stdout.trim();
}

/** The checkout of a fetch in the cache, fetched read-only when absent; its HEAD is checked against the pinned sha. @param {FetchSpec} f @param {string} cache */
export function ensureFetched(f, cache) {
  const dir = path.join(cache, "src", `${f.id}@${f.sha}`);
  if (fs.existsSync(dir)) {
    need(git(["rev-parse", "HEAD"], dir) === f.sha, `${f.id}: the cached checkout is not at ${f.sha}`);
    // a cached checkout whose files were changed, added or removed is not the pinned commit (review n2)
    need(
      git(["status", "--porcelain", "--untracked-files=all", "--ignored"], dir) === "",
      `${f.id}: the cached checkout's working tree differs from ${f.sha}; remove it from the golden cache`,
    );
    return dir;
  }
  const tmp = `${dir}.part`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(["clone", "--quiet", "--filter=blob:none", "--no-checkout", "--", f.url, tmp]);
  const tagged = git(["rev-parse", "--verify", "--quiet", `${f.rev}^{commit}`], tmp);
  need(tagged === f.sha, `${f.id}: ${f.rev} resolves to ${tagged}, not the pinned ${f.sha}`);
  if (f.sparse !== undefined) git(["sparse-checkout", "set", "--", ...f.sparse], tmp);
  git(["checkout", "--quiet", "--detach", f.sha], tmp);
  need(git(["rev-parse", "HEAD"], tmp) === f.sha, `${f.id}: checkout is not at ${f.sha}`);
  fs.renameSync(tmp, dir);
  return dir;
}

/** Copies a directory, leaving out `.git`. @param {string} from @param {string} to */
function copyTree(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => path.basename(src) !== ".git",
  });
}

/**
 * Builds a case's input tree in a fresh work directory: the fixture with its overlays copied over
 * it in order, or a copy of the fetched checkout; then the mutation's file edits, if any.
 * @param {GoldenCase} c @param {{ cache: string, work: string, fetched: Record<string, string>, mutation?: Mutation }} o
 */
export function prepareTree(c, o) {
  fs.rmSync(o.work, { recursive: true, force: true });
  fs.mkdirSync(o.work, { recursive: true });
  const tree = path.join(o.work, "tree");
  const dropped = new Set((o.mutation?.edits ?? []).flatMap((e) => (e.op === "drop-overlay" ? [e.overlay] : [])));
  if (c.input.fixture !== undefined) {
    const from = path.join(ROOT, c.input.fixture);
    // only the named parts of the fixture (its variants and stand-ins are not the estate under test)
    for (const part of c.input.parts ?? ["."]) copyTree(path.join(from, part), path.join(tree, part));
    for (const overlay of c.input.overlays ?? []) {
      if (dropped.has(overlay)) continue;
      fs.cpSync(path.join(ROOT, overlay), tree, { recursive: true });
    }
  } else {
    copyTree(/** @type {string} */ (o.fetched[/** @type {string} */ (c.input.fetched)]), tree);
  }
  for (const d of dropped)
    need(
      (c.input.overlays ?? []).includes(d),
      `${c.case}/${o.mutation?.id}: drop-overlay names no overlay of the case`,
    );
  for (const e of o.mutation?.edits ?? []) {
    if (e.op !== "remove" && e.op !== "replace" && e.op !== "write") continue;
    need(relInside(e.path), `${c.case}/${o.mutation?.id}: bad edit path`);
    const target = path.join(tree, e.path);
    if (e.op === "write") {
      // a new file of crankpath's own (never repository text): it must not exist yet
      need(!fs.existsSync(target), `${c.case}/${o.mutation?.id}: write names a file that exists`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, e.content);
      continue;
    }
    need(fs.existsSync(target), `${c.case}/${o.mutation?.id}: ${e.op} names no file`);
    if (e.op === "remove") fs.rmSync(target, { recursive: true });
    else {
      const text = fs.readFileSync(target, "utf8");
      need(text.split(e.from).length === 2, `${c.case}/${o.mutation?.id}: replace must match exactly once`);
      fs.writeFileSync(target, text.replace(e.from, e.to));
    }
  }
  return tree;
}

/**
 * The crankpath argument list of a case: placeholders `{tree}` (the input tree), `{src:<id>}` (a
 * fetched checkout) and `{case}` (the case folder) replaced; a mutation's `drop-arg` edits applied.
 * @param {GoldenCase} c @param {{ tree: string, fetched: Record<string, string>, cacheDir: string, caseDir: string, mutation?: Mutation }} o
 */
export function caseArgs(c, o) {
  const subst = (/** @type {string} */ a) =>
    a
      .replaceAll("{tree}", o.tree)
      .replaceAll("{case}", o.caseDir)
      .replace(/\{src:([a-z0-9-]+)\}/g, (_m, id) => {
        const p = o.fetched[id];
        need(p !== undefined, `${c.case}: {src:${id}} names no fetch`);
        return p;
      });
  let args = [...c.args];
  for (const e of o.mutation?.edits ?? []) {
    if (e.op !== "drop-arg") continue;
    const at = args.findIndex((a, i) => a === e.flag && (args[i + 1] ?? "").startsWith(e.startsWith));
    need(at >= 0, `${c.case}/${o.mutation?.id}: drop-arg matches no argument`);
    args = [...args.slice(0, at), ...args.slice(at + 2)];
  }
  const scan = path.join(o.tree, c.input.scan);
  return [scan, ...args.map(subst), "--cache-dir", o.cacheDir, "--no-color"];
}

/** Runs the built crankpath with only `toolPath` on PATH. @param {string[]} args @param {string} toolPath */
export function crankpath(args, toolPath) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: { PATH: toolPath },
    maxBuffer: 512 * 1024 * 1024,
    timeout: 900_000,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** @param {Record<string, number>} m @param {string} k */
function bump(m, k) {
  m[k] = (m[k] ?? 0) + 1;
}
/** @param {Record<string, number>} m */
function sorted(m) {
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The reduced form of a crankpath JSON report: node ids and counts only.
 * @param {any} r
 */
export function reduce(r) {
  /** @type {Record<string, number>} */
  const edgesByKind = {};
  /** @type {Record<string, number>} */
  const edgesBySource = {};
  for (const e of r.edges) {
    bump(edgesByKind, e.kind);
    bump(edgesBySource, e.source);
  }
  /** @param {any[]} list @param {(x: any) => string} key */
  const countBy = (list, key) => {
    /** @type {Record<string, number>} */
    const m = {};
    for (const x of list) bump(m, key(x));
    return sorted(m);
  };
  return {
    form: REDUCED_FORM,
    runStatus: {
      state: r.runStatus.state,
      floor: r.runStatus.floor,
      reasons: r.runStatus.reasons,
      counts: r.runStatus.counts,
    },
    toolchain: { helm: r.toolchain.helm, kustomize: r.toolchain.kustomize, tested: r.toolchain.tested },
    nodes: { total: r.nodes.length, byKind: countBy(r.nodes, (n) => n.kind) },
    edges: { total: r.edges.length, byKind: sorted(edgesByKind), bySource: sorted(edgesBySource) },
    cycles: r.cycles.map((/** @type {any} */ c) => ({
      id: c.id,
      label: c.label,
      labelBeforeCranks: c.labelBeforeCranks,
      nodes: c.nodes,
      edgeCount: c.edges.length,
      edges: c.edges.map((/** @type {any} */ e) => [e.from, e.kind, e.to]),
      crankedBy: c.crankedBy,
      introducedBy: c.introducedBy,
    })),
    hiddenCycles: r.hiddenCycles.length,
    externals: r.externals.map((/** @type {any} */ x) => ({ id: x.id, coldStart: x.coldStart, servedBy: x.servedBy })),
    opaque: {
      total: r.opaque.length,
      byReason: countBy(r.opaque, (o) => o.reason),
      // the opaque sources that are nodes (a Kustomize root or a chart applied by hand is a path: counted only)
      nodes: r.opaque.flatMap((/** @type {any} */ o) => (o.node === null ? [] : [o.node])).sort(),
    },
    // by outcome (crankpath's closed refusal words), not by the reason's wording
    unreadable: { total: r.unreadable.length, byReason: countBy(r.unreadable, (u) => u.outcome) },
    skipped: { total: r.skipped.length, byReason: countBy(r.skipped, (s) => s.reason) },
    unresolved: { total: r.unresolved.length, byWhy: countBy(r.unresolved, (u) => u.why) },
    // floating revisions only: the note that a chart's two renders differed (`field: "helm template"`)
    // is left out, because it depends on whether two renders of a chart whose output varies happen to
    // agree (B2: two renders cannot prove determinism); the cases name such charts in reviewed.md
    floating: r.floating.filter((/** @type {any} */ f) => f.field !== "helm template").length,
    undeployed: { charts: (r.undeployedCharts ?? []).length, kustomizeRoots: r.undeployedKustomizeRoots.length },
    repoMappings: {
      total: r.repoMappings.length,
      used: r.repoMappings.filter((/** @type {any} */ m) => m.used).length,
    },
    cranks: r.cranks.map((/** @type {any} */ k) => ({
      id: k.id,
      matched: k.matched,
      createdNodes: k.createdNodes.length,
      alreadyCreated: k.alreadyCreated,
      reroutedEdges: k.reroutedEdges.map((/** @type {any} */ e) => [e.from, e.to]),
      removedEdges: k.removedEdges,
    })),
    statusCounts: r.statusCounts,
    statusesByReason: countBy(r.statuses, (s) => `${s.status}:${s.reason ?? "none"}`),
    plan: {
      steps: r.plan.steps.map((/** @type {any} */ s) => ({
        no: s.no,
        kind: s.kind,
        manual: s.manual,
        crank: s.crank,
        nodes: s.nodes,
      })),
      listedUnordered: r.plan.listedUnordered.length,
      conflicts: r.plan.conflicts.length,
      assumes: {
        externals: r.plan.assumes.externals,
        cranks: r.plan.assumes.cranks,
        clusterProvided: r.plan.assumes.clusterProvided.length,
        argocdNamespace: r.plan.assumes.argocdNamespace,
      },
    },
    notComputed: r.notComputed,
  };
}

const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "crankpath-report.schema.json"), "utf8"));
/** crankpath's own words: every enumerated value of the frozen JSON schema. */
const VOCABULARY = (() => {
  const words = new Set();
  JSON.stringify(SCHEMA, (k, v) => {
    if (k === "enum" && Array.isArray(v)) for (const w of v) words.add(String(w));
    return v;
  });
  return words;
})();
/** The count fields the reduced form copies whole: `runStatus.counts` (with `sourcesByKind`) and `statusCounts`. */
const COUNT_KEYS = (() => {
  const counts = SCHEMA.properties.runStatus.properties.counts.properties;
  return new Set([
    ...Object.keys(counts),
    ...Object.keys(counts.sourcesByKind.properties),
    ...Object.keys(SCHEMA.properties.statusCounts.properties),
  ]);
})();
/** The refusal outcomes of the bounded reader and the tree walk (src/u2-intake-config/bounded-reader.ts `Refusal`). */
const UNREADABLE_OUTCOMES = Object.freeze([
  "symlink",
  "traversal",
  "not-found",
  "not-regular-file",
  "changed",
  "io-error",
  "too-large",
  "too-deep",
  "too-many-documents",
  "alias-limit",
  "parse-error",
]);
/** Every key the reduced form itself uses (`reduce` below); any other key must be a node kind or a word of crankpath's. */
export const REDUCED_KEYS = Object.freeze([
  "alreadyCreated",
  "argocdNamespace",
  "assumes",
  "byKind",
  "byReason",
  "bySource",
  "byWhy",
  "charts",
  "clusterProvided",
  "coldStart",
  "conflicts",
  "counts",
  "crank",
  "crankedBy",
  "cranks",
  "createdNodes",
  "cycles",
  "edgeCount",
  "edges",
  "externals",
  "floating",
  "floor",
  "form",
  "helm",
  "hiddenCycles",
  "id",
  "introducedBy",
  "kind",
  "kustomize",
  "kustomizeRoots",
  "label",
  "labelBeforeCranks",
  "listedUnordered",
  "manual",
  "matched",
  "no",
  "nodes",
  "notComputed",
  "opaque",
  "plan",
  "reasons",
  "removedEdges",
  "repoMappings",
  "reroutedEdges",
  "runStatus",
  "servedBy",
  "skipped",
  "state",
  "statusCounts",
  "statusesByReason",
  "steps",
  "tested",
  "toolchain",
  "total",
  "undeployed",
  "unreadable",
  "unresolved",
  "used",
]);

/**
 * The strings of a reduced form that are not node ids, node kinds, cycle or crank ids, tool versions
 * or crankpath's own words (review m1): keys are checked against the reduced form's own keys and the
 * schema's words, values against the report's ids and the schema's words. An empty list is the
 * evidence that nothing else of the scanned repository is in it.
 * @param {any} report the full report the reduced form was made from
 * @param {unknown} reduced
 * @returns {string[]}
 */
export function foreignStrings(report, reduced) {
  const kinds = new Set(report.nodes.map((/** @type {any} */ n) => n.kind));
  const values = new Set([
    REDUCED_FORM,
    ...VOCABULARY,
    ...UNREADABLE_OUTCOMES,
    ...kinds,
    ...report.nodes.map((/** @type {any} */ n) => n.id),
    ...report.plan.assumes.argocdNamespace, // node ids of the assumed Argo CD namespace
    ...report.cycles.map((/** @type {any} */ c) => c.id),
    ...report.cranks.map((/** @type {any} */ c) => c.id),
    ...[report.toolchain.helm, report.toolchain.kustomize].filter((v) => typeof v === "string"),
  ]);
  const keys = new Set([...REDUCED_KEYS, ...COUNT_KEYS, ...VOCABULARY, ...UNREADABLE_OUTCOMES, ...kinds]);
  const statusKey = (/** @type {string} */ k) => {
    const [status, reason, more] = k.split(":");
    return (
      more === undefined &&
      ["blocked", "startable", "unverified"].includes(status ?? "") &&
      (reason === "none" || VOCABULARY.has(reason ?? ""))
    );
  };
  /** @type {Set<string>} */
  const out = new Set();
  /** @param {unknown} x */
  const walk = (x) => {
    if (typeof x === "string") {
      if (!values.has(x)) out.add(x);
    } else if (Array.isArray(x)) for (const v of x) walk(v);
    else if (x !== null && typeof x === "object")
      for (const [k, v] of Object.entries(x)) {
        if (!keys.has(k) && !statusKey(k)) out.add(k);
        walk(v);
      }
  };
  walk(reduced);
  return [...out].sort();
}

/** The headline of a reduced form, which a mutation's `expect` is matched against. @param {ReturnType<typeof reduce>} d */
export function headline(d) {
  return {
    state: d.runStatus.state,
    cycles: d.cycles.length,
    uncranked: d.cycles.filter((/** @type {{ label: string }} */ c) => c.label !== "cranked").length,
    cranked: d.cycles.filter((/** @type {{ label: string }} */ c) => c.label === "cranked").length,
    labels: d.cycles.map((/** @type {{ label: string }} */ c) => c.label).sort(),
    opaque: d.opaque.total,
    externals: d.externals.length,
    planSteps: d.plan.steps.length,
    firstStep: d.plan.steps[0]?.kind ?? null,
    startable: d.statusCounts.startable,
    undeployedCharts: d.undeployed.charts,
    cycleIds: d.cycles.map((/** @type {{ id: string }} */ c) => c.id).sort(),
    opaqueNodes: d.opaque.nodes,
  };
}

/** A text rendering of a reduced form, one fact per line, for `expected.txt` of a reduced case and for review. @param {ReturnType<typeof reduce>} d */
export function summaryText(d) {
  /** @param {Record<string, number>} m */
  const counts = (m) =>
    Object.keys(m).length === 0
      ? "none"
      : Object.entries(m)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ");
  const L = [`crankpath golden summary (${d.form}: node ids and counts only)`];
  L.push(
    `run status: ${d.runStatus.state}  reasons: ${d.runStatus.reasons.join(", ") || "none"}  floor: ${d.runStatus.floor ? "yes" : "no"}`,
  );
  L.push(`toolchain: helm ${d.toolchain.helm ?? "missing"}, kustomize ${d.toolchain.kustomize ?? "missing"}`);
  L.push(`nodes: ${d.nodes.total} (${counts(d.nodes.byKind)})`);
  L.push(`edges: ${d.edges.total} (${counts(d.edges.bySource)}); by kind: ${counts(d.edges.byKind)}`);
  const h = headline(d);
  L.push(`cycles: ${h.cycles} (uncranked ${h.uncranked}, cranked ${h.cranked}); hidden: ${d.hiddenCycles}`);
  for (const c of d.cycles) {
    const was = c.label === c.labelBeforeCranks ? "" : ` (was ${c.labelBeforeCranks})`;
    L.push(`  cycle ${c.id}  ${c.label}${was}  nodes ${c.nodes.length}  edges ${c.edgeCount}`);
    for (const n of c.nodes) L.push(`    node ${n}`);
    for (const [f, k, t] of c.edges) L.push(`    edge ${f} ${k} ${t}`);
    if (c.crankedBy.length > 0) L.push(`    cranked by ${c.crankedBy.join(", ")}`);
    if (c.introducedBy.length > 0) L.push(`    introduced by ${c.introducedBy.join(", ")}`);
  }
  L.push(`externals: ${d.externals.length}`);
  for (const x of d.externals)
    L.push(`  ${x.id}  ${x.coldStart}${x.servedBy === null ? "" : `  served by ${x.servedBy}`}`);
  L.push(`opaque: ${d.opaque.total} (${counts(d.opaque.byReason)})`);
  for (const n of d.opaque.nodes) L.push(`  opaque node ${n}`);
  L.push(`unreadable files: ${d.unreadable.total} (${counts(d.unreadable.byReason)})`);
  L.push(`skipped objects: ${d.skipped.total} (${counts(d.skipped.byReason)})`);
  L.push(`unresolved: ${d.unresolved.total} (${counts(d.unresolved.byWhy)})`);
  L.push(
    `floating revisions: ${d.floating}; repository mappings: ${d.repoMappings.total} (${d.repoMappings.used} used)`,
  );
  L.push(
    `not deployed by anything read: ${d.undeployed.charts} chart directories, ${d.undeployed.kustomizeRoots} Kustomize roots`,
  );
  for (const k of d.cranks)
    L.push(
      `crank ${k.id}  matched: ${k.matched ? "yes" : "no"}  creates ${k.createdNodes} nodes  removes ${k.removedEdges} edges  reroutes ${k.reroutedEdges.length}`,
    );
  for (const k of d.cranks) for (const [f, t] of k.reroutedEdges) L.push(`  reroute ${f} -> ${t}`);
  L.push(`statuses: ${counts(d.statusCounts)}; by reason: ${counts(d.statusesByReason)}`);
  L.push(
    `plan: ${d.plan.steps.length} steps; listed unordered ${d.plan.listedUnordered}; conflicts ${d.plan.conflicts}`,
  );
  for (const s of d.plan.steps)
    L.push(
      `  step ${s.no}  ${s.manual ? "manual" : "auto"}  ${s.kind}${s.crank === null ? "" : ` ${s.crank}`}  ${s.nodes.join(", ")}`,
    );
  L.push(
    `plan assumes: externals ${d.plan.assumes.externals.join(", ") || "none"}; cranks ${d.plan.assumes.cranks.join(", ") || "none"}; cluster-provided ${d.plan.assumes.clusterProvided}`,
  );
  L.push(`not computed: ${d.notComputed.join(", ") || "none"}`);
  return `${L.join("\n")}\n`;
}

/** The two outputs a case is compared on: crankpath's own (full) or the reduced form (reduced). @param {GoldenCase} c @param {{ json: string, text: string }} out */
export function comparable(c, out) {
  if (c.form === "full") return { json: out.json, text: out.text };
  const d = reduce(JSON.parse(out.json));
  return { json: `${JSON.stringify(d, null, 2)}\n`, text: summaryText(d) };
}

/** Partial match of an expectation against a headline. @param {Record<string, unknown>} expect @param {Record<string, unknown>} h */
export function unmet(expect, h) {
  return Object.entries(expect)
    .filter(([k, v]) => JSON.stringify(h[k]) !== JSON.stringify(v))
    .map(([k, v]) => `${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(h[k])}`);
}

/**
 * Runs one case (and, when asked, one mutation of it): the JSON and the text output of the built
 * crankpath over a freshly prepared input tree.
 * @param {GoldenCase} c @param {{ cache: string, toolPath: string, mutation?: Mutation, dir?: string }} o
 */
export function runCase(c, o) {
  const fetched = Object.fromEntries(c.fetch.map((f) => [f.id, ensureFetched(f, o.cache)]));
  const work = path.join(o.cache, "work", c.case, o.mutation?.id ?? "base");
  const tree = prepareTree(c, { cache: o.cache, work, fetched, ...(o.mutation ? { mutation: o.mutation } : {}) });
  const caseDir = path.join(o.dir ?? GOLDEN_DIR, c.case);
  const args = caseArgs(c, {
    tree,
    fetched,
    cacheDir: path.join(o.cache, "crankpath-cache"),
    caseDir,
    ...(o.mutation ? { mutation: o.mutation } : {}),
  });
  const json = crankpath([...args, "--format", "json"], o.toolPath);
  const text = crankpath(args, o.toolPath);
  return { json: json.stdout, text: text.stdout, codes: [json.code, text.code], stderr: json.stderr + text.stderr };
}

/** Writes a run's outputs under the cache (never the repository). @param {string} cache @param {string} id @param {string} name @param {{ json: string, text: string }} out @param {GoldenCase} c */
export function writeObserved(cache, id, name, out, c) {
  const dir = path.join(cache, "runs", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), out.json);
  fs.writeFileSync(path.join(dir, `${name}.txt`), out.text);
  const red = comparable({ ...c, form: "reduced" }, out);
  fs.writeFileSync(path.join(dir, `${name}.reduced.json`), red.json);
  fs.writeFileSync(path.join(dir, `${name}.summary.txt`), red.text);
  return dir;
}

/** @param {string} text */
function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The first differing line of two texts, as a line number and both lines cut short. @param {string} a @param {string} b */
export function firstDifference(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if (x[i] !== y[i]) {
      const cut = (/** @type {string | undefined} */ s) =>
        s === undefined ? "<none>" : JSON.stringify(s.slice(0, 100));
      return `line ${i + 1}: expected ${cut(x[i])}, got ${cut(y[i])}`;
    }
  return "no line differs";
}

/**
 * @typedef {{ result: "PASS" | "FAIL" | "SKIPPED" | "OBSERVED", name: string, why: string, summary?: string }} CheckResult
 */

/**
 * GoldenHarness and MutationChecker for one case: SKIPPED (with the reason) when this machine
 * lacks what it needs; else the run compared with the expected files (mode `compare`), written to
 * the cache only (`observe`) or written as the expected files (`pin`, refused without reviewed.md);
 * then each declared mutation, which must change the reduced result and meet its `expect`.
 * @param {string} id
 * @param {{ cache: string, env: Environment, mode?: "compare" | "observe" | "pin", dir?: string }} o
 * @returns {CheckResult[]}
 */
export function checkCase(id, o) {
  const dir = o.dir ?? GOLDEN_DIR;
  const mode = o.mode ?? "compare";
  /** @type {CheckResult[]} */
  const out = [];
  const c = loadCase(id, dir);
  const skip = skipReason(c, o.env);
  if (skip !== null) {
    out.push({ result: "SKIPPED", name: `${id}: expected output`, why: skip });
    for (const m of c.mutations) out.push({ result: "SKIPPED", name: `${id} mutation ${m.id}`, why: skip });
    return out;
  }
  const toolPath = toolPathFor(c, o.env);
  /** @type {ReturnType<typeof runCase>} */
  let base;
  try {
    base = runCase(c, { cache: o.cache, toolPath, dir });
  } catch (e) {
    return [{ result: "FAIL", name: `${id}: run`, why: e instanceof Error ? e.message : String(e) }];
  }
  const wantExit = c.exit ?? 0;
  if (base.codes.some((code) => code !== wantExit))
    return [
      { result: "FAIL", name: `${id}: run`, why: `crankpath exited ${base.codes.join(" and ")}, expected ${wantExit}` },
    ];
  const runs = writeObserved(o.cache, id, "observed", base, c);
  const got = comparable(c, base);
  const baseReport = JSON.parse(base.json);
  const baseReduced = reduce(baseReport);
  const exp = expectedDir(c, dir);
  // the reduced form carries ids, counts and crankpath's words only (review m1): never compared,
  // pinned or printed otherwise; the strings themselves are not shown (they may be repository text)
  const foreign = foreignStrings(baseReport, baseReduced);
  if (foreign.length > 0)
    return [
      {
        result: "FAIL",
        name: `${id}: run`,
        why: `the reduced form holds ${foreign.length} strings that are not ids or crankpath's words; not compared, not pinned`,
      },
    ];
  const digests = { json: sha256(got.json), text: sha256(got.text) };
  if (mode === "observe") {
    out.push({
      result: "OBSERVED",
      name: id,
      why: `outputs written to the golden cache (${path.relative(o.cache, runs)}); not compared; to pin, the review records expected.json sha-256: ${digests.json} and expected.txt sha-256: ${digests.text}`,
      summary: summaryText(baseReduced),
    });
  } else if (mode === "pin") {
    const reviewed = path.join(dir, id, "reviewed.md");
    const record = fs.existsSync(reviewed) ? fs.readFileSync(reviewed, "utf8") : null;
    const recorded = (/** @type {string} */ f) =>
      record === null ? undefined : new RegExp(`${f.replace(".", "\\.")} sha-256: ([0-9a-f]{64})`).exec(record)?.[1];
    const refusal =
      record === null
        ? "refused: reviewed.md is missing (review the real-run output first)"
        : /^Pending\.$/m.test(record)
          ? "refused: reviewed.md records the review as pending"
          : recorded("expected.json") === undefined || recorded("expected.txt") === undefined
            ? "refused: reviewed.md records no sha-256 of the reviewed expected.json and expected.txt"
            : recorded("expected.json") !== digests.json
              ? "refused: this run's expected.json differs from the reviewed one (sha-256)"
              : recorded("expected.txt") !== digests.text
                ? "refused: this run's expected.txt differs from the reviewed one (sha-256)"
                : null;
    if (refusal !== null) return [{ result: "FAIL", name: `${id}: pin`, why: refusal }];
    fs.writeFileSync(path.join(exp, "expected.json"), got.json);
    fs.writeFileSync(path.join(exp, "expected.txt"), got.text);
    return [
      {
        result: "OBSERVED",
        name: `${id}: pinned`,
        why: `expected.json and expected.txt written from this run (${c.form} form)`,
      },
    ];
  } else {
    const files = /** @type {const} */ ([
      ["json", "expected.json"],
      ["text", "expected.txt"],
    ]);
    if (files.some(([, f]) => !fs.existsSync(path.join(exp, f))))
      out.push({ result: "FAIL", name: `${id}: expected output`, why: "not pinned: the expected files are missing" });
    else {
      const diffs = files.flatMap(([k, f]) => {
        const want = fs.readFileSync(path.join(exp, f), "utf8");
        return want === got[k] ? [] : [`${f} differs at ${firstDifference(want, got[k])}`];
      });
      out.push({
        result: diffs.length === 0 ? "PASS" : "FAIL",
        name: `${id}: expected output`,
        why:
          diffs.length === 0
            ? `expected.json and expected.txt match the run (${c.form} form)`
            : [...diffs, ...failureNotes(c, exp, baseReduced, o.cache, id, base)].join("; "),
      });
    }
  }
  for (const m of c.mutations) {
    const name = `${id} mutation ${m.id}`;
    try {
      const r = runCase(c, { cache: o.cache, toolPath, mutation: m, dir });
      writeObserved(o.cache, id, `mutation-${m.id}`, r, c);
      const d = reduce(JSON.parse(r.json));
      const problems = unmet(m.expect ?? {}, headline(d));
      if (JSON.stringify(d) === JSON.stringify(baseReduced))
        out.push({
          result: "FAIL",
          name,
          why: `${m.kind}: the result did not change, so this golden cannot fail on it`,
        });
      else if (problems.length > 0)
        out.push({ result: "FAIL", name, why: `${m.kind}: changed, but ${problems.join("; ")}` });
      else
        out.push({
          result: mode === "observe" ? "OBSERVED" : "PASS",
          name,
          why: `${m.kind}: result changed; ${JSON.stringify(headline(d))}`,
        });
    } catch (e) {
      out.push({ result: "FAIL", name, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/**
 * What a failed comparison says beyond the first differing line (review m7): which counts differ
 * from the pinned output, this run's timeouts and opaque outcomes (a render that timed out, failed or
 * hit a limit under load is named here), and where the failed output is kept in the cache.
 * @param {GoldenCase} c @param {string} exp @param {ReturnType<typeof reduce>} now
 * @param {string} cache @param {string} id @param {{ json: string, text: string }} out
 */
function failureNotes(c, exp, now, cache, id, out) {
  const notes = [];
  try {
    const pinned = JSON.parse(fs.readFileSync(path.join(exp, "expected.json"), "utf8"));
    const before = c.form === "reduced" ? pinned : reduce(pinned);
    const a = /** @type {Record<string, unknown>} */ (before.runStatus.counts);
    const b = /** @type {Record<string, unknown>} */ (now.runStatus.counts);
    const differ = Object.keys(b)
      .filter((k) => typeof b[k] === "number" && a[k] !== b[k])
      .map((k) => `${k} ${a[k] ?? "absent"} expected, ${b[k]} in this run`);
    if (differ.length > 0) notes.push(`counts that differ: ${differ.join(", ")}`);
  } catch {
    notes.push("the pinned expected.json could not be read as a report");
  }
  const reasons = Object.entries(now.opaque.byReason).map(([k, v]) => `${k} ${v}`);
  notes.push(
    `this run: timeouts ${now.runStatus.counts.timeouts ?? 0}; opaque by reason ${reasons.join(", ") || "none"}`,
  );
  const dir = path.join(cache, "runs", id);
  let n = 1;
  while (fs.existsSync(path.join(dir, `failed-${n}.json`))) n += 1;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `failed-${n}.json`), out.json);
  fs.writeFileSync(path.join(dir, `failed-${n}.txt`), out.text);
  notes.push(`outputs kept in the golden cache as runs/${id}/failed-${n}.{json,txt}`);
  return notes;
}

/** The lane's exit code: 1 on any failure, 2 when any check was skipped or only observed, 0 only when all passed. @param {CheckResult[]} results */
export function laneExit(results) {
  if (results.some((r) => r.result === "FAIL")) return 1;
  if (results.length === 0 || results.some((r) => r.result !== "PASS")) return 2;
  return 0;
}
