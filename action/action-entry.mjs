// ActionEntry (U10, contract C10; FR10.1 to FR10.5, BR10.4 to BR10.7, OD-11): the composite
// Action's one script. It finds the head commit and the base (the merge base of base-ref and the
// head), copies each commit's tree out of git raw (no attribute or filter processing) into the
// runner's temporary directory, never into the checkout, runs the CLI this Action built from its own
// checkout on both with the same config and alias rules, compares the two JSON reports
// (BaseHeadDiffer) and writes the job summary, the annotations (workflow commands on standard
// output) and the step outputs. Its exit status is 0 only for NO_NEW_CYCLES_FOUND; FAILED and
// NOT CHECKED are not green (OD-11).
//
// Inputs arrive as environment variables (INPUT_PATH, INPUT_CONFIG, INPUT_BASE_REF,
// INPUT_REPO_ALIAS) and reach git and the CLI only as single argument-array elements, never through
// a shell. git runs only rev-parse, merge-base, ls-tree and cat-file, with hooks and fsmonitor off
// and every transport refused; the CLI runs with an environment allowlist, so the workflow token
// (GITHUB_TOKEN, ACTIONS_*) never reaches it or any process it starts, and its standard output is
// discarded, so nothing it prints reaches the runner. The copies are removed before the script
// ends. No timer of its own: a job stopped by its `timeout-minutes` is cancelled, which is not
// green either.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { diffReports, notCheckedResult, readReport, sideReasons } from "./base-head-differ.mjs";
import { exitStatus, renderAnnotations, renderOutputs, renderSummary, workflowCommand } from "./summary.mjs";

/** @typedef {import("./base-head-differ.mjs").NotCheckedReason} NotCheckedReason */
/** @typedef {import("./base-head-differ.mjs").ActionReport} ActionReport */
/** @typedef {Record<string, string | undefined>} Env */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The CLI this Action built from its own checkout (BR10.6): never one from a registry. */
export const CLI_PATH = path.join(HERE, "..", "dist", "u9-cli-package", "cli.js");

/** Variables the CLI may see (C12's allowlist for the process that starts the render tools). */
const CLI_ENV_ALLOW = ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TZ"];
/** Variables that hold the workflow's own tokens: never passed on, nor any other name holding their value. */
const WORKFLOW_TOKENS = [
  "GITHUB_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "INPUT_TOKEN",
  "GH_TOKEN",
];

/**
 * The CLI's environment: the allowlist, `NO_COLOR`, and the per-host `CRANKPATH_TOKEN_<HOST>`
 * variables the workflow author set (the CLI sends each only to its own host), except one whose
 * value is a workflow token's. Nothing else: no GITHUB_*, ACTIONS_*, INPUT_*, NODE_OPTIONS.
 * @returns {Record<string, string>}
 */
export function cliEnv(/** @type {Env} */ parent) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const k of CLI_ENV_ALLOW) {
    const v = parent[k];
    if (v !== undefined) env[k] = v;
  }
  env.NO_COLOR = "1";
  const workflowValues = new Set(WORKFLOW_TOKENS.map((k) => parent[k]).filter((v) => v !== undefined && v !== ""));
  for (const [k, v] of Object.entries(parent)) {
    if (!/^CRANKPATH_TOKEN_[A-Z0-9_]+$/.test(k) || v === undefined || v === "") continue;
    if (workflowValues.has(v)) continue;
    env[k] = v;
  }
  return env;
}

/** git's environment: PATH and HOME only (the runner's own git configuration), fixed locale, no prompt. */
export function gitEnv(/** @type {Env} */ parent, /** @type {Record<string, string>} */ extra = {}) {
  /** @type {Record<string, string>} */
  const env = { LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", ...extra };
  for (const k of ["PATH", "HOME"]) {
    const v = parent[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

/** Fixed options on every git call: no hooks, no fsmonitor, no transport of any kind. */
export const GIT_OPTIONS = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "protocol.allow=never",
];

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {Env} parent
 * @param {Record<string, string>} [extra]
 */
function git(cwd, args, parent, extra) {
  const r = spawnSync("git", [...GIT_OPTIONS, ...args], {
    cwd,
    env: gitEnv(parent, extra),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { ok: r.status === 0 && r.error === undefined, out: typeof r.stdout === "string" ? r.stdout : "" };
}

/**
 * The bytes the CLI may hold in memory at once while a commit is copied: a working set only (any
 * value gives the same copy), so it is not a limit on what is read. A larger blob is fetched alone.
 */
const COPY_CHUNK_BYTES = 64 * 1024 * 1024;

const SLASH = 0x2f;
/** A tree path's segments, or undefined when one is empty, `.`, `..` or `.git` in any case. */
function safeSegments(/** @type {Buffer} */ p) {
  const segments = [];
  let start = 0;
  for (let i = 0; i <= p.length; i += 1) {
    if (i < p.length && p[i] !== SLASH) continue;
    const seg = p.subarray(start, i);
    const text = seg.toString("latin1");
    if (seg.length === 0 || text === "." || text === ".." || text.toLowerCase() === ".git") return undefined;
    segments.push(seg);
    start = i + 1;
  }
  return segments;
}

/**
 * What a repository-relative path is in a commit, every ancestor checked: `dir`, `file`, `link`
 * (it or an ancestor is a symbolic link), `submodule` (it or an ancestor is a gitlink) or `missing`.
 * Read with `git ls-tree` on each parent directory (literal paths), so a link is never followed.
 * @returns {"dir" | "file" | "link" | "submodule" | "missing" | "git"}
 */
export function pathKind(
  /** @type {string} */ toplevel,
  /** @type {string} */ commit,
  /** @type {string} */ rel,
  /** @type {Env} */ parent,
) {
  const segs = rel.split("/").filter((x) => x !== "");
  if (segs.length === 0) return "dir";
  const env = gitEnv(parent, { GIT_LITERAL_PATHSPECS: "1" });
  for (let i = 0; i < segs.length; i += 1) {
    const dir = segs.slice(0, i).join("/");
    const r = spawnSync(
      "git",
      [
        ...GIT_OPTIONS,
        "ls-tree",
        "-z",
        "--full-tree",
        "--end-of-options",
        commit,
        ...(dir === "" ? [] : ["--", `${dir}/`]),
      ],
      { cwd: toplevel, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: Number.POSITIVE_INFINITY },
    );
    if (r.status !== 0 || r.error !== undefined) return "git";
    const want = Buffer.from(i === 0 ? /** @type {string} */ (segs[0]) : `${dir}/${segs[i]}`);
    let mode;
    for (const rec of /** @type {Buffer} */ (r.stdout).toString("latin1").split("\0")) {
      const tab = rec.indexOf("\t");
      if (tab !== -1 && Buffer.from(rec.slice(tab + 1), "latin1").equals(want)) mode = rec.slice(0, 6);
    }
    if (mode === undefined) return "missing";
    if (mode === "120000") return "link";
    if (mode === "160000") return "submodule";
    if (mode !== "040000") return i === segs.length - 1 ? "file" : "missing";
  }
  return "dir";
}

/** @typedef {{ name: string, value: number, unit: string }} CopyBound */
/** @typedef {{ path: string, size: number, unit: "bytes" | "entries" }} OverBound */

/** A tree entry's path as text (display only: it is quoted wherever it is printed). */
function entryPath(/** @type {{ segments: Buffer[] }} */ e) {
  return Buffer.concat(e.segments.flatMap((s, n) => (n === 0 ? [s] : [Buffer.from("/"), s]))).toString("utf8");
}

/** The entries over a byte bound, largest first, then by path (B8 review pass 3, m2). */
function largest(/** @type {{ segments: Buffer[], size: number }[]} */ entries) {
  return [...entries]
    .sort((a, b) => b.size - a.size || (entryPath(a) < entryPath(b) ? -1 : entryPath(a) > entryPath(b) ? 1 : 0))
    .map((e) => /** @type {OverBound} */ ({ path: entryPath(e), size: e.size, unit: "bytes" }));
}

/** The top-level directories of the entries listed so far, most entries first. */
function topDirectories(/** @type {{ segments: Buffer[] }[]} */ entries) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const e of entries) {
    const top = e.segments.length > 1 ? /** @type {Buffer} */ (e.segments[0]).toString("utf8") : ".";
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([p, n]) => /** @type {OverBound} */ ({ path: p, size: n, unit: "entries" }));
}
/**
 * What bounds a copy: crankpath's own derived limits, by name, so the Action reads no more of a
 * commit than crankpath would of a fetched repository (B8 review pass 2, m5). A bound the build
 * does not derive is null (no bound of that kind). `chunkBytes` is the working set only.
 * @typedef {{ entries: CopyBound | null, totalBytes: CopyBound | null, blobBytes: CopyBound | null,
 *   wallClock: CopyBound | null, chunkBytes: number }} CopyBounds
 */

/**
 * The copy's bounds from a LimitSet: `filesPerScan` (tree entries), `fetchedRepoBytes` (all blob
 * bytes), `fileBytes` (the largest blob) and `repoFetchWallClock` (the whole copy).
 * @returns {CopyBounds}
 */
export function copyBounds(/** @type {Record<string, any> | undefined} */ limits) {
  const pick = (/** @type {string} */ name) => {
    const l = limits?.[name];
    return l !== undefined && l !== null && l.status === "derived" && typeof l.value === "number"
      ? { name, value: /** @type {number} */ (l.value), unit: String(l.unit) }
      : null;
  };
  return {
    entries: pick("filesPerScan"),
    totalBytes: pick("fetchedRepoBytes"),
    blobBytes: pick("fileBytes"),
    wallClock: pick("repoFetchWallClock"),
    chunkBytes: COPY_CHUNK_BYTES,
  };
}

/** @type {CopyBounds} */
const NO_BOUNDS = { entries: null, totalBytes: null, blobBytes: null, wallClock: null, chunkBytes: COPY_CHUNK_BYTES };

/**
 * Copies one commit's tree into `dest` raw (B8 review m2): the entries from `git ls-tree -r -z -l`,
 * the blobs from `git cat-file --batch`, written byte for byte. No `.gitattributes`, filter driver,
 * end-of-line or `ident` processing runs, from either side or the runner's configuration. Modes are
 * handled one by one: a regular file is written 0644 (0755 when executable); a symbolic link is
 * recreated as a link (never followed: crankpath's reader refuses it by name); a gitlink (a
 * submodule) is an empty directory and its path is returned, because what it holds is never read.
 * It stops (`unsafe`) on any other mode, a path segment that is empty, `.`, `..` or `.git`, or a
 * path that meets an existing entry (case-folded names, a link where a directory is needed); on a
 * bound (`limit`, naming it) before anything is written; and (`io`) when the file system refuses a
 * write for another reason. Nothing is written outside `dest`.
 * @returns {{ ok: true, submodules: string[] } | { ok: false, why: "git" | "unsafe" | "io" } | { ok: false, why: "limit", limit: CopyBound, over?: OverBound[] }}
 */
export function copyCommitTree(
  /** @type {string} */ toplevel,
  /** @type {string} */ commit,
  /** @type {string} */ dest,
  /** @type {Env} */ parent,
  /** @type {CopyBounds} */ bounds = NO_BOUNDS,
  /** @type {readonly string[]} */ paths = [],
) {
  // only the given paths (repository-relative, literal, never patterns), or the whole tree
  const env = gitEnv(parent, { GIT_LITERAL_PATHSPECS: "1" });
  const only = paths.includes("") ? [] : [...paths];
  const start = Date.now();
  const clock = bounds.wallClock;
  const late = () => clock !== null && Date.now() - start >= clock.value;
  const remaining = () => (clock === null ? undefined : Math.max(1, clock.value - (Date.now() - start)));
  if (late() && clock !== null) return { ok: false, why: "limit", limit: clock };
  const ls = spawnSync(
    "git",
    [
      ...GIT_OPTIONS,
      "ls-tree",
      "-r",
      "-z",
      "-l",
      "--full-tree",
      "--end-of-options",
      commit,
      ...(only.length > 0 ? ["--", ...only] : []),
    ],
    {
      cwd: toplevel,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: Number.POSITIVE_INFINITY,
      timeout: remaining(),
    },
  );
  if (late() && clock !== null) return { ok: false, why: "limit", limit: clock };
  if (ls.status !== 0 || ls.error !== undefined) return { ok: false, why: "git" };
  /** @type {{ mode: string, type: string, oid: string, size: number, segments: Buffer[] }[]} */
  const entries = [];
  const out = /** @type {Buffer} */ (ls.stdout);
  let at = 0;
  while (at < out.length) {
    const end = out.indexOf(0, at);
    const record = out.subarray(at, end === -1 ? out.length : end);
    at = end === -1 ? out.length : end + 1;
    const tab = record.indexOf(0x09);
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40,64}) +(\d+|-)$/.exec(record.subarray(0, tab).toString("latin1"));
    const segments = tab === -1 ? undefined : safeSegments(record.subarray(tab + 1));
    if (m === null || segments === undefined) return { ok: false, why: "unsafe" };
    // the entries bound while parsing, so a huge listing is not parsed to the end (pass 3, n1)
    if (bounds.entries !== null && entries.length >= bounds.entries.value) {
      return { ok: false, why: "limit", limit: bounds.entries, over: topDirectories(entries) };
    }
    entries.push({
      mode: /** @type {string} */ (m[1]),
      type: /** @type {string} */ (m[2]),
      oid: /** @type {string} */ (m[3]),
      size: m[4] === "-" ? 0 : Number(m[4]),
      segments,
    });
  }
  // the bounds, before anything is written

  const total = entries.reduce((n, e) => n + e.size, 0);
  if (bounds.totalBytes !== null && total > bounds.totalBytes.value)
    return { ok: false, why: "limit", limit: bounds.totalBytes, over: largest(entries) };
  const blobLimit = bounds.blobBytes;
  if (blobLimit !== null && entries.some((e) => e.size > blobLimit.value))
    return {
      ok: false,
      why: "limit",
      limit: blobLimit,
      over: largest(entries.filter((e) => e.size > blobLimit.value)),
    };

  /** @type {Map<string, Buffer>} */
  const blobs = new Map();
  const fetch = (/** @type {typeof entries} */ batch) => {
    const want = batch.filter((e) => e.type === "blob");
    if (want.length === 0) return true;
    const size = want.reduce((n, e) => n + e.size + e.oid.length + 32, 0);
    const r = spawnSync("git", [...GIT_OPTIONS, "cat-file", "--batch"], {
      cwd: toplevel,
      env,
      input: want.map((e) => `${e.oid}\n`).join(""),
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: size + 1024,
      timeout: remaining(),
    });
    if (r.status !== 0 || r.error !== undefined) return false;
    const buf = /** @type {Buffer} */ (r.stdout);
    let p = 0;
    for (const e of want) {
      const nl = buf.indexOf(0x0a, p);
      const header = /^([0-9a-f]+) blob (\d+)$/.exec(buf.subarray(p, nl).toString("latin1"));
      if (nl === -1 || header === null || header[1] !== e.oid) return false;
      const n = Number(header[2]);
      blobs.set(e.oid, buf.subarray(nl + 1, nl + 1 + n));
      p = nl + 1 + n + 1;
    }
    return true;
  };

  const root = Buffer.from(dest);
  const join = (/** @type {Buffer[]} */ segs) => Buffer.concat([root, ...segs.flatMap((s) => [Buffer.from("/"), s])]);
  /** an existing entry where one is to be made is unsafe; any other refusal is an I/O failure */
  const failed = (/** @type {unknown} */ e) =>
    /** @type {{ ok: false, why: "unsafe" | "io" }} */ ({
      ok: false,
      why: /** @type {NodeJS.ErrnoException} */ (e).code === "EEXIST" ? "unsafe" : "io",
    });
  try {
    fs.mkdirSync(dest);
  } catch (e) {
    return failed(e);
  }
  /** @type {string[]} */
  const submodules = [];
  let i = 0;
  while (i < entries.length) {
    // one chunk of entries whose blobs fit the working set (at least one entry)
    let j = i;
    let bytes = 0;
    do {
      bytes += /** @type {(typeof entries)[number]} */ (entries[j]).size;
      j += 1;
    } while (
      j < entries.length &&
      bytes + /** @type {(typeof entries)[number]} */ (entries[j]).size <= bounds.chunkBytes
    );
    const chunk = entries.slice(i, j);
    const fetched = fetch(chunk);
    if (late() && clock !== null) return { ok: false, why: "limit", limit: clock };
    if (!fetched) return { ok: false, why: "git" };
    for (const e of chunk) {
      for (let k = 1; k < e.segments.length; k += 1) {
        const dir = join(e.segments.slice(0, k));
        let st;
        try {
          st = fs.lstatSync(dir);
        } catch {
          st = undefined;
        }
        if (st !== undefined && (!st.isDirectory() || st.isSymbolicLink())) return { ok: false, why: "unsafe" };
        if (st === undefined) {
          try {
            fs.mkdirSync(dir);
          } catch (err) {
            return failed(err);
          }
        }
      }
      const target = join(e.segments);
      try {
        if (e.mode === "160000" && e.type === "commit") {
          fs.mkdirSync(target);
          submodules.push(
            Buffer.concat(e.segments.flatMap((s, n) => (n === 0 ? [s] : [Buffer.from("/"), s]))).toString("utf8"),
          );
        } else if (e.mode === "120000" && e.type === "blob") {
          fs.symlinkSync(/** @type {Buffer} */ (blobs.get(e.oid)), target);
        } else if ((e.mode === "100644" || e.mode === "100755" || e.mode === "100664") && e.type === "blob") {
          const mode = e.mode === "100755" ? 0o755 : 0o644;
          fs.writeFileSync(target, /** @type {Buffer} */ (blobs.get(e.oid)), { flag: "wx", mode });
          fs.chmodSync(target, mode);
        } else return { ok: false, why: "unsafe" };
      } catch (err) {
        return failed(err);
      }
    }
    blobs.clear();
    i = j;
  }
  return { ok: true, submodules };
}

/** A relative path that stays inside its root once normalised; undefined otherwise. */
export function insidePath(/** @type {string} */ p) {
  if (p === "" || path.isAbsolute(p) || p.includes("\0")) return undefined;
  const n = path.normalize(p);
  if (n === ".." || n.startsWith(`..${path.sep}`)) return undefined;
  return n === "." ? "" : n.replace(/[\\/]+$/, "");
}

/** A base-ref the Action accepts: a commit id or a plain ref name (never an option, never a revision expression). */
export function validRef(/** @type {string} */ ref) {
  return /^[A-Za-z0-9._/-]{1,255}$/.test(ref) && !ref.startsWith("-") && !ref.includes("..");
}

/**
 * The repository's own URL, from the runner's GITHUB_SERVER_URL and GITHUB_REPOSITORY; undefined
 * when either is absent or not of the expected shape (the CLI then reads none, on both sides).
 */
export function repoUrl(/** @type {Env} */ env) {
  const server = env.GITHUB_SERVER_URL ?? "";
  const repo = env.GITHUB_REPOSITORY ?? "";
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(server)) return undefined;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return undefined;
  return `${server}/${repo}`;
}

/**
 * The repo-alias input: newline-separated `url=path`. A relative path is resolved inside each
 * analysed tree (the same rule on both sides); an absolute path is used as given on both.
 * @returns {{ ok: true, aliases: { url: string, path: string, line: number }[] } | { ok: false, line: number }}
 */
export function parseAliases(/** @type {string} */ input) {
  const aliases = [];
  const lines = input.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = /** @type {string} */ (lines[i]).trim();
    if (line === "") continue;
    const eq = line.indexOf("=");
    if (eq <= 0 || eq === line.length - 1) return { ok: false, line: i + 1 };
    const p = line.slice(eq + 1);
    if (!path.isAbsolute(p) && insidePath(p) === undefined) return { ok: false, line: i + 1 };
    aliases.push({ url: line.slice(0, eq), path: p, line: i + 1 });
  }
  return { ok: true, aliases };
}

/**
 * Where a path of a copy leads once every link is resolved: `inside` the copy's real root,
 * `outside` it (a link out of the copy, in the path or any of its ancestors), or `missing`.
 * @returns {"inside" | "outside" | "missing"}
 */
export function placeInCopy(/** @type {string} */ rootReal, /** @type {string} */ p) {
  let real;
  try {
    real = fs.realpathSync.native(p);
  } catch {
    // a missing path: what exists of it must still lead inside
    const parent = path.dirname(p);
    if (parent === p) return "missing";
    /** @type {"inside" | "outside" | "missing"} */
    const up = placeInCopy(rootReal, parent);
    return up === "outside" ? "outside" : "missing";
  }
  return real === rootReal || real.startsWith(`${rootReal}${path.sep}`) ? "inside" : "outside";
}

function isDir(/** @type {string} */ p) {
  try {
    const s = fs.lstatSync(p);
    return s.isDirectory() && !s.isSymbolicLink();
  } catch {
    return false;
  }
}
function isFile(/** @type {string} */ p) {
  try {
    const s = fs.lstatSync(p);
    return s.isFile() && !s.isSymbolicLink();
  } catch {
    return false;
  }
}

/** The first line of the CLI's standard error, bounded; it is quoted wherever it is shown. */
function firstLine(/** @type {string} */ stderr) {
  const line = stderr.split("\n").find((l) => l.trim() !== "") ?? "";
  return Array.from(line).slice(0, 381).join("");
}

/**
 * Runs the CLI on one tree; JSON goes to a file outside every scanned root.
 * @param {{ cliPath: string, scanDir: string, cwd: string, jsonFile: string, args: string[], env: Env }} o
 * @returns {{ kind: "report", exit: number, json: unknown } | { kind: "error", exit: number, said: string }}
 */
export function runCli(o) {
  const r = spawnSync(process.execPath, [o.cliPath, o.scanDir, "--format", "json", "--out", o.jsonFile, ...o.args], {
    cwd: o.cwd,
    env: cliEnv(o.env),
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  });
  const exit = typeof r.status === "number" ? r.status : 1;
  const said = typeof r.stderr === "string" ? firstLine(r.stderr) : "";
  if (r.error !== undefined || (exit !== 0 && exit !== 2)) return { kind: "error", exit, said };
  try {
    return { kind: "report", exit, json: JSON.parse(fs.readFileSync(o.jsonFile, "utf8")) };
  } catch {
    return { kind: "error", exit, said: "" };
  }
}

/**
 * @typedef {{ env: Env, cwd: string, stdout: (line: string) => void, cliPath?: string, copyBounds?: CopyBounds }} ActionIo
 * @typedef {{ exit: number, summary: string, annotations: string[], outputs: string }} ActionRun
 */

/**
 * The whole Action. Writes the summary and outputs to the files the runner names, the annotations
 * to `io.stdout`, and returns what it wrote and the exit status.
 * @param {ActionIo} io
 * @returns {ActionRun}
 */
export function runAction(io) {
  const env = io.env;
  const work = fs.mkdtempSync(path.join(env.RUNNER_TEMP ?? os.tmpdir(), "crankpath-action-"));
  try {
    const { diff, ctx } = compare(io, work);
    const summary = renderSummary(diff, ctx);
    const annotations = renderAnnotations(diff, ctx);
    const outputs = renderOutputs(diff);
    let exit = exitStatus(diff);
    try {
      if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
      if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, outputs);
    } catch {
      annotations.push(
        workflowCommand(
          "error",
          { title: "crankpath" },
          "The job summary or the step outputs could not be written. This job is not green.",
        ),
      );
      exit = 1;
    }
    for (const a of annotations) io.stdout(a);
    return { exit, summary, annotations, outputs };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * @param {ActionIo} io
 * @param {string} work
 */
function compare(io, work) {
  const env = io.env;
  const version = crankpathVersion();
  const ctx = {
    crankpathVersion: version,
    baseCommit: /** @type {string | null} */ (null),
    headCommit: /** @type {string | null} */ (null),
    pathPrefix: "",
    baseRef: /** @type {string | undefined} */ (undefined),
  };
  const stop = (/** @type {NotCheckedReason[]} */ reasons) => ({ diff: notCheckedResult(reasons), ctx });

  // the runner's own files: without them the result cannot reach the job (B8 review n1)
  /** @type {NotCheckedReason[]} */
  const runnerFiles = [];
  for (const name of ["GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT"])
    if (!env[name]) runnerFiles.push({ side: "both", code: "runner-file-missing", value: name });
  if (runnerFiles.length > 0) return stop(runnerFiles);

  const workspace = env.GITHUB_WORKSPACE ?? io.cwd;
  const inputPath = (env.INPUT_PATH ?? ".").trim() || ".";
  const rel = insidePath(inputPath);
  if (rel === undefined)
    return stop([{ side: "both", code: "invalid-input", value: "path must be a relative path inside the workspace" }]);
  const target = path.join(workspace, rel);
  const top = git(target, ["rev-parse", "--show-toplevel"], env);
  const prefixOut = git(target, ["rev-parse", "--show-prefix"], env);
  if (!top.ok || !prefixOut.ok) return stop([{ side: "both", code: "not-a-checkout", value: inputPath }]);
  const toplevel = top.out.trim();
  const prefix = prefixOut.out.trim().replace(/\/+$/, "");
  ctx.pathPrefix = prefix;

  const config = (env.INPUT_CONFIG ?? "").trim();
  if (config !== "" && !path.isAbsolute(config) && insidePath(config) === undefined) {
    return stop([
      { side: "both", code: "invalid-input", value: "config must be a path inside the repository, or absolute" },
    ]);
  }
  const aliases = parseAliases(env.INPUT_REPO_ALIAS ?? "");
  if (!aliases.ok) {
    return stop([
      {
        side: "both",
        code: "invalid-input",
        value: `repo-alias line ${aliases.line} is not url=path with a path inside the repository, or absolute`,
      },
    ]);
  }

  const head = git(toplevel, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], env);
  if (head.ok) ctx.headCommit = head.out.trim();
  const baseRef = (env.INPUT_BASE_REF ?? "").trim();
  /** @type {NotCheckedReason[]} */
  const reasons = [];
  if (baseRef === "") reasons.push({ side: "base", code: "no-base" });
  else if (!validRef(baseRef))
    reasons.push({ side: "base", code: "invalid-input", value: "base-ref is not a commit id or a ref name" });
  else {
    const base = git(toplevel, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${baseRef}^{commit}`], env);
    if (base.ok) ctx.baseCommit = base.out.trim();
    else {
      const shallow = git(toplevel, ["rev-parse", "--is-shallow-repository"], env);
      reasons.push({
        side: "base",
        code: shallow.ok && shallow.out.trim() === "true" ? "base-not-in-checkout-shallow" : "base-not-in-checkout",
        value: baseRef,
      });
    }
  }
  if (!head.ok) reasons.push({ side: "head", code: "head-unreadable" });
  if (reasons.length > 0) return stop(reasons);

  // The base is the merge base of base-ref and the head (B8 review m6): what the head holds that
  // the base branch gained after the fork is not this pull request's.
  const resolved = /** @type {string} */ (ctx.baseCommit);
  const merge = git(
    toplevel,
    ["merge-base", "--end-of-options", resolved, /** @type {string} */ (ctx.headCommit)],
    env,
  );
  if (!merge.ok) {
    const shallow = git(toplevel, ["rev-parse", "--is-shallow-repository"], env);
    ctx.baseCommit = null;
    return stop([
      {
        side: "base",
        code: shallow.ok && shallow.out.trim() === "true" ? "no-merge-base-shallow" : "no-merge-base",
        value: baseRef,
      },
    ]);
  }
  ctx.baseCommit = merge.out.trim();
  ctx.baseRef = baseRef;
  if (ctx.baseCommit === ctx.headCommit) return stop([{ side: "both", code: "base-is-head" }]);

  const url = repoUrl(env);
  const cliPath = io.cliPath ?? CLI_PATH;
  /** @type {Record<"base" | "head", ActionReport | undefined>} */
  const reports = { base: undefined, head: undefined };
  for (const side of /** @type {const} */ (["base", "head"])) {
    const commit = /** @type {string} */ (side === "base" ? ctx.baseCommit : ctx.headCommit);
    const tree = path.join(work, `${side}-tree`);
    // only what crankpath reads from the commit: the scanned path, a relative config and the
    // relative alias paths (lead decision after pass 2), each checked for a link on its way
    /** @type {{ rel: string, reason: NotCheckedReason }[]} */
    const wanted = [{ rel: prefix, reason: { side, code: "outside-copy-path", value: inputPath } }];
    if (config !== "" && !path.isAbsolute(config))
      wanted.push({
        rel: /** @type {string} */ (insidePath(config)),
        reason: { side, code: "outside-copy-config", value: config },
      });
    for (const a of aliases.aliases)
      if (!path.isAbsolute(a.path))
        wanted.push({
          rel: /** @type {string} */ (insidePath(a.path)),
          reason: { side, code: "outside-copy-alias", count: a.line },
        });
    const linked = wanted.find((w) => pathKind(toplevel, commit, w.rel.split(path.sep).join("/"), env) === "link");
    if (linked !== undefined) {
      reasons.push(linked.reason);
      continue;
    }
    const subset = prefix === "" ? [""] : wanted.map((w) => w.rel.split(path.sep).join("/"));
    const copied = copyCommitTree(toplevel, commit, tree, env, io.copyBounds ?? NO_BOUNDS, subset);
    if (!copied.ok) {
      if (copied.why === "limit")
        reasons.push({
          side,
          code: "copy-limit",
          limit: copied.limit,
          over: copied.over ?? [],
          ...(prefix === "" ? { value: "whole-tree" } : {}),
        });
      else reasons.push({ side, code: { unsafe: "unsafe-tree", io: "copy-io", git: "export-failed" }[copied.why] });
      continue;
    }
    // every path read inside the copy must stay inside it, links resolved (B8 review pass 2, m3)
    const treeReal = fs.realpathSync.native(tree);
    const scanDir = prefix === "" ? tree : path.join(tree, prefix);
    const scan = placeInCopy(treeReal, scanDir);
    if (scan === "outside") {
      reasons.push({ side, code: "outside-copy-path", value: inputPath });
      continue;
    }
    if (scan === "missing" || !isDir(fs.realpathSync.native(scanDir))) {
      reasons.push({ side, code: "path-missing", value: inputPath });
      continue;
    }
    // one chart cache for both runs, outside both trees (a cache inside a scanned tree is never
    // trusted by crankpath), so both sides render a fetched chart from the same bytes
    const args = ["--cache-dir", path.join(work, "chart-cache")];
    if (url !== undefined) args.push("--repo-url", url);
    if (config !== "") {
      const file = path.isAbsolute(config) ? config : path.join(tree, /** @type {string} */ (insidePath(config)));
      const placed = path.isAbsolute(config) ? "inside" : placeInCopy(treeReal, file);
      if (placed === "outside") {
        reasons.push({ side, code: "outside-copy-config", value: config });
        continue;
      }
      if (!path.isAbsolute(config) && (placed === "missing" || !isFile(fs.realpathSync.native(file)))) {
        reasons.push({ side, code: "config-missing", value: config });
        continue;
      }
      args.push("--config", file);
    }
    let aliasOutside = false;
    for (const a of aliases.aliases) {
      const p = path.isAbsolute(a.path) ? a.path : path.join(tree, /** @type {string} */ (insidePath(a.path)));
      if (!path.isAbsolute(a.path) && placeInCopy(treeReal, p) === "outside") {
        reasons.push({ side, code: "outside-copy-alias", count: a.line });
        aliasOutside = true;
        break;
      }
      args.push("--repo-alias", `${a.url}=${p}`);
    }
    if (aliasOutside) continue;
    const ran = runCli({ cliPath, scanDir, cwd: tree, jsonFile: path.join(work, `${side}.json`), args, env });
    if (ran.kind === "error") {
      reasons.push({ side, code: "tool-error", exit: ran.exit, value: ran.said });
      continue;
    }
    const report = readReport(ran.json);
    if (report === undefined) {
      reasons.push({ side, code: "report-unreadable" });
      continue;
    }
    reports[side] = {
      ...report,
      submodules: copied.submodules,
      run: { ...report.run, submodules: copied.submodules.length },
    };
  }
  const base = reports.base;
  const headReport = reports.head;
  if (reasons.length === 0 && base !== undefined && headReport !== undefined)
    return { diff: diffReports(base, headReport), ctx };
  for (const side of /** @type {const} */ (["base", "head"])) {
    const r = reports[side];
    if (r !== undefined) reasons.push(...sideReasons(side, r.run));
  }
  return { diff: notCheckedResult(reasons, base?.run ?? null, headReport?.run ?? null), ctx };
}

function crankpathVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "(unknown version)";
  } catch {
    return "(unknown version)";
  }
}

/**
 * The copy's bounds from the build this Action made (`dist/u1-graph-model/limits.js`): crankpath's
 * own `filesPerScan`, `fetchedRepoBytes`, `fileBytes` and `repoFetchWallClock`.
 * @returns {Promise<CopyBounds>}
 */
export async function loadCopyBounds() {
  const limitsUrl = pathToFileURL(path.join(HERE, "..", "dist", "u1-graph-model", "limits.js")).href;
  const { LIMITS } = await import(limitsUrl);
  return copyBounds(LIMITS);
}

/** The script's entry: any error it did not expect is NOT CHECKED, never a green step. */
export async function main() {
  try {
    // the copy's bounds are crankpath's own limits, from the build this Action made
    const bounds = await loadCopyBounds();
    const run = runAction({
      env: process.env,
      cwd: process.cwd(),
      stdout: (l) => process.stdout.write(`${l}\n`),
      copyBounds: bounds,
    });
    process.exitCode = run.exit;
  } catch {
    process.stdout.write(
      `${workflowCommand("error", { title: "crankpath NOT CHECKED" }, "NOT CHECKED: the Action stopped on an internal error (a bug). This job is not green.")}\n`,
    );
    try {
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "result=NOT_CHECKED\nnew-cycles=\n");
    } catch {
      // the exit status below still says the job is not green
    }
    process.exitCode = 1;
  }
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(path.resolve(invoked)).href) main();
