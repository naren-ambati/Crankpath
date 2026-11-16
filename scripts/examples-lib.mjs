// The examples under examples/ (docs/examples.md): what each run must show is written down in
// examples/expected.json (before the first run), and the byte-for-byte output of each run is pinned
// in examples/<example>/expected/<run>.stdout and .stderr. This module runs one run with the built
// CLI, checks the written facts and compares with the pinned files; the test
// (test/examples/examples.test.ts), the pin script (scripts/examples.mjs) and the screenshot
// capture (docs/images/capture.mjs) all use it, so the three cannot judge a run differently.
//
// A run is made as a user would make it: `node dist/u9-cli-package/cli.js <args>` from the
// repository root, with node alone on PATH (so helm and kustomize are not found and the toolchain
// line is the same on every machine) and the run's own `env` added. `{tmp}` in `setup` and `args` is
// a fresh temporary directory, removed afterwards. `setup` is a node script run first (the
// refusals example makes its oversized file at run time).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const CLI = path.join(ROOT, "dist", "u9-cli-package", "cli.js");
export const EXAMPLES = path.join(ROOT, "examples");
export const EXPECTED_FILE = path.join(EXAMPLES, "expected.json");
export const LANES = Object.freeze(["offline", "live"]);
const FACT_KEYS = Object.freeze(["lines", "contains", "absent", "startCounts", "empty"]);
const RUN_KEYS = Object.freeze(["name", "setup", "args", "env", "exit", "stdout", "stderr", "sameAs"]);

/**
 * @typedef {{ lines?: string[], contains?: string[], absent?: string[], startCounts?: Record<string, number>, empty?: boolean }} Facts
 * @typedef {{ name: string, setup?: string[], args: string[], env?: Record<string, string>, exit: number, stdout: Facts, stderr: Facts, sameAs?: string }} Run
 * @typedef {{ lane: string, what: string, runs: Run[] }} Example
 * @typedef {{ about: string, edits: { example: string, run: string, what: string, why: string }[], examples: Record<string, Example> }} Expected
 * @typedef {{ exit: number | null, stdout: string, stderr: string }} Result
 */

/** @returns {Expected} */
export function loadExpected(file = EXPECTED_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Problems with the shape of expected.json (an unknown key is a problem, so a misspelt fact is
 * never silently ignored).
 * @param {Expected} expected
 * @returns {string[]}
 */
export function shapeProblems(expected) {
  const out = [];
  const names = new Set();
  for (const [name, ex] of Object.entries(expected.examples)) {
    if (!LANES.includes(ex.lane)) out.push(`${name}: lane must be one of ${LANES.join(", ")}`);
    if (typeof ex.what !== "string" || ex.what === "") out.push(`${name}: what is missing`);
    if (!Array.isArray(ex.runs) || ex.runs.length === 0) out.push(`${name}: no runs`);
    for (const run of ex.runs ?? []) {
      const id = `${name}/${run.name}`;
      if (names.has(id)) out.push(`${id}: two runs with one name`);
      names.add(id);
      for (const k of Object.keys(run)) if (!RUN_KEYS.includes(k)) out.push(`${id}: unknown key ${k}`);
      if (!/^[a-z0-9-]+$/.test(run.name ?? "")) out.push(`${id}: a run name is lower-case letters, digits and -`);
      if (![0, 1, 2].includes(run.exit)) out.push(`${id}: exit must be 0, 1 or 2`);
      if (!Array.isArray(run.args) || run.args.some((a) => typeof a !== "string")) out.push(`${id}: args`);
      for (const stream of ["stdout", "stderr"]) {
        const facts = /** @type {Record<string, unknown>} */ (run[/** @type {"stdout"|"stderr"} */ (stream)] ?? {});
        if (Object.keys(facts).length === 0) out.push(`${id}: no ${stream} facts`);
        for (const k of Object.keys(facts)) if (!FACT_KEYS.includes(k)) out.push(`${id}: ${stream}: unknown fact ${k}`);
      }
    }
  }
  for (const name of Object.keys(expected.examples))
    for (const run of expected.examples[name]?.runs ?? [])
      if (run.sameAs !== undefined && !names.has(run.sameAs)) out.push(`${name}/${run.name}: sameAs names no run`);
  return out;
}

/** @param {string} arg @param {string} tmp */
const fill = (arg, tmp) => arg.split("{tmp}").join(tmp);

/** The environment of every run: node alone on PATH, plus the run's own variables. */
export function runEnv(/** @type {Record<string, string> | undefined} */ extra) {
  return { PATH: path.dirname(process.execPath), ...(extra ?? {}) };
}

/**
 * Runs one run with the built CLI. `{tmp}` is a fresh directory, removed afterwards.
 * @param {Run} run
 * @returns {Result}
 */
export function runExample(run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-example-"));
  try {
    const env = runEnv(run.env);
    if (run.setup !== undefined) {
      const s = spawnSync(
        process.execPath,
        run.setup.map((a) => fill(a, tmp)),
        { cwd: ROOT, encoding: "utf8", env },
      );
      if (s.status !== 0) throw new Error(`setup of ${run.name} failed: ${s.stderr}`);
    }
    const r = spawnSync(process.execPath, [CLI, ...run.args.map((a) => fill(a, tmp))], {
      cwd: ROOT,
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
    return { exit: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The written facts a stream breaks (none means it meets them all).
 * @param {Facts} facts
 * @param {string} text
 * @param {string} label
 * @returns {string[]}
 */
export function factProblems(facts, text, label) {
  const out = [];
  const lines = text.split("\n").map((l) => l.trim());
  if (facts.empty === true && text !== "") out.push(`${label}: expected empty`);
  for (const l of facts.lines ?? []) if (!lines.includes(l)) out.push(`${label}: no line ${JSON.stringify(l)}`);
  for (const s of facts.contains ?? [])
    if (!text.includes(s)) out.push(`${label}: does not contain ${JSON.stringify(s)}`);
  for (const s of facts.absent ?? []) if (text.includes(s)) out.push(`${label}: contains ${JSON.stringify(s)}`);
  for (const [start, n] of Object.entries(facts.startCounts ?? {})) {
    const got = lines.filter((l) => l.startsWith(start)).length;
    if (got !== n) out.push(`${label}: ${got} lines start with ${JSON.stringify(start)}, expected ${n}`);
  }
  return out;
}

/**
 * Every written fact the result breaks: the exit code, then each stream.
 * @param {Run} run
 * @param {Result} result
 * @returns {string[]}
 */
export function checkRun(run, result) {
  const out = [];
  if (result.exit !== run.exit) out.push(`exit expected ${run.exit}, got ${result.exit}`);
  out.push(...factProblems(run.stdout, result.stdout, "stdout"));
  out.push(...factProblems(run.stderr, result.stderr, "stderr"));
  return out;
}

/** @param {string} example @param {string} run @param {string} [examplesDir] */
export function pinnedPaths(example, run, examplesDir = EXAMPLES) {
  const dir = path.join(examplesDir, example, "expected");
  return { dir, stdout: path.join(dir, `${run}.stdout`), stderr: path.join(dir, `${run}.stderr`) };
}

/**
 * The pinned output of a run, or null when it is not pinned.
 * @param {string} example @param {string} run
 * @returns {{ stdout: string, stderr: string } | null}
 */
export function readPinned(example, run, examplesDir = EXAMPLES) {
  const p = pinnedPaths(example, run, examplesDir);
  if (!fs.existsSync(p.stdout) || !fs.existsSync(p.stderr)) return null;
  return { stdout: fs.readFileSync(p.stdout, "utf8"), stderr: fs.readFileSync(p.stderr, "utf8") };
}

/**
 * Compares a result with the pinned files, byte for byte; names the first differing line.
 * @param {string} example @param {Run} run @param {Result} result
 * @returns {string[]}
 */
export function comparePinned(example, run, result) {
  const pinned = readPinned(example, run.name);
  if (pinned === null) return [`not pinned (examples/${example}/expected/${run.name}.stdout and .stderr)`];
  const out = [];
  for (const stream of /** @type {const} */ (["stdout", "stderr"])) {
    if (pinned[stream] === result[stream]) continue;
    const a = pinned[stream].split("\n");
    const b = result[stream].split("\n");
    let i = 0;
    while (i < a.length && a[i] === b[i]) i += 1;
    out.push(
      `${stream} differs from the pinned file at line ${i + 1}: pinned ${JSON.stringify(a[i] ?? "<end>")}, got ${JSON.stringify(b[i] ?? "<end>")}`,
    );
  }
  return out;
}

/** Every run, as [example name, example, run]. @param {Expected} expected */
export function allRuns(expected) {
  /** @type {[string, Example, Run][]} */
  const out = [];
  for (const [name, ex] of Object.entries(expected.examples)) for (const run of ex.runs) out.push([name, ex, run]);
  return out;
}

// ---- quotes of pinned output in docs/examples.md
// A quote is a fence whose caption line (the line right before it) ends with
// `<!-- example-output: <example>/<run> [stderr] [key <name>] -->`: the fence holds that run's
// pinned stdout (or stderr), or with `key` only the block of that top-level key of a JSON output.

export const DOC_FILE = path.join(ROOT, "docs", "examples.md");
const QUOTE_MARKER =
  /<!--\s*example-output:\s*([a-z0-9-]+)\/([a-z0-9-]+)((?:\s+stderr)?)(?:\s+key\s+([A-Za-z]+))?\s*-->\s*$/;

/**
 * The text a quote must hold: a run's pinned stream, or the lines of one top-level key of it.
 * @param {string} example @param {string} run @param {"stdout"|"stderr"} stream @param {string | undefined} key
 * @returns {string | null}
 */
export function quotedText(example, run, stream, key, examplesDir = EXAMPLES) {
  const pinned = readPinned(example, run, examplesDir);
  if (pinned === null) return null;
  const text = pinned[stream];
  if (key === undefined) return text;
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`  ${JSON.stringify(key)}: `));
  if (start < 0) return null;
  const first = /** @type {string} */ (lines[start]);
  if (!/[[{]$/.test(first)) return `${first}\n`;
  const end = lines.findIndex((l, i) => i > start && /^ {2}[\]}],?$/.test(l));
  return end < 0 ? null : `${lines.slice(start, end + 1).join("\n")}\n`;
}

/**
 * Every quote in a Markdown text: its marker, the fence body and the fence's line numbers.
 * @param {string} text
 * @returns {{ example: string, run: string, stream: "stdout"|"stderr", key: string | undefined, body: string, open: number, close: number, line: number }[]}
 */
export function docQuotes(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const m = QUOTE_MARKER.exec(/** @type {string} */ (lines[i]));
    if (m === null) continue;
    const fence = /^(`{3,})text$/.exec(/** @type {string} */ (lines[i + 1]));
    if (fence === null)
      throw new Error(`docs/examples.md:${i + 1}: an example-output marker must be followed by a text fence`);
    const ticks = /** @type {string} */ (fence[1]);
    const close = lines.findIndex((l, j) => j > i + 1 && l === ticks);
    if (close < 0) throw new Error(`docs/examples.md:${i + 2}: the fence is not closed`);
    const body = lines.slice(i + 2, close).join("\n");
    out.push({
      example: /** @type {string} */ (m[1]),
      run: /** @type {string} */ (m[2]),
      stream: /** @type {"stdout"|"stderr"} */ (m[3]?.trim() === "stderr" ? "stderr" : "stdout"),
      key: m[4],
      body: close === i + 2 ? "" : `${body}\n`,
      open: i + 1,
      close,
      line: i + 1,
    });
  }
  return out;
}
