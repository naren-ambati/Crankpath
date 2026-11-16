// The Action's local harness (U11 for U10; no `act`, no network, no GitHub). For each case under
// `test/fixtures/action/<case>/case.json` it builds a local git repository with two commits, the
// base and the head, from the committed fixture trees (layers copied in order, then the case's
// renames applied to the head, for names a committed file cannot carry), optionally clones it
// shallow over `file://`, and runs the Action's own script (`action/action-entry.mjs`) with the
// GitHub environment pointed at temporary files: GITHUB_STEP_SUMMARY, GITHUB_OUTPUT, RUNNER_TEMP,
// and a fake GITHUB_TOKEN that must never reach crankpath. It prints each case's exit status,
// outputs, annotations and job summary. Commits use a fixed identity and fixed dates, so the
// commit ids, and with them the printed text, are the same on every run.
//
// It runs the `check` step of `action/action.yml` itself (its bash run line and its env, evaluated
// from the inputs' defaults), not the script directly; it skips the setup-node and build steps.
// Usage: npm run build && node scripts/action-local.mjs [case ...]
// It runs the built CLI (`dist/`), as the Action does after its build step.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const FIXTURES = path.join(ROOT, "test", "fixtures", "action");
const ACTION_DIR = path.join(ROOT, "action");

/**
 * The `check` step of `action/action.yml` (its run line, shell and env) and the Action's inputs.
 * The harness runs this step as the runner would; it skips the two steps before it (setup-node and
 * build.sh): it uses the Node running it and the `dist/` already built.
 * @returns {{ run: string, shell: string, env: Record<string, string>, inputs: Record<string, { default?: string }> }}
 */
export function checkStep() {
  const action = parse(fs.readFileSync(path.join(ACTION_DIR, "action.yml"), "utf8"));
  const step = action.runs.steps.find((/** @type {{ id?: string }} */ s) => s.id === "check");
  return { run: step.run, shell: step.shell, env: step.env, inputs: action.inputs };
}

/** A whole-value workflow expression `${{ name }}` from a fixed table; any other expression is a harness error. */
function evaluate(/** @type {string} */ value, /** @type {Record<string, string>} */ context) {
  const m = /^\$\{\{ ([\w.-]+) \}\}$/.exec(value);
  if (m === null) {
    if (value.includes("${{")) throw new Error(`action-local: an expression the harness cannot evaluate: ${value}`);
    return value;
  }
  const v = context[/** @type {string} */ (m[1])];
  if (v === undefined) throw new Error(`action-local: an expression the harness cannot evaluate: ${value}`);
  return v;
}

/** The fake workflow token the harness sets; no output and no crankpath process may hold it. */
export const FAKE_WORKFLOW_TOKEN = "ghs_fixture-workflow-token-that-must-not-reach-crankpath";

/**
 * @typedef {{ description: string, base: string[], head: string[], baseRef?: string,
 *   clone?: "shallow", renames?: Record<string, string>, tools?: "fake",
 *   expect: { result: string, newCycles: string, exit: number } }} ActionCase
 * @typedef {{ name: string, description: string, exit: number, outputs: string, annotations: string[],
 *   summary: string, expect: ActionCase["expect"], baseCommit: string, headCommit: string }} CaseRun
 */

/**
 * Writes the fake helm and kustomize of `test/fixtures/fake-tools` (the tested versions) into `dir`
 * and returns it, for a case with `"tools": "fake"`: the wrappers name this Node by absolute path,
 * because crankpath gives the tools it starts no PATH to find one.
 */
export function fakeToolsDir(/** @type {string} */ dir) {
  const tool = pathToFileURL(path.join(ROOT, "test", "fixtures", "fake-tools", "fake-tool.mjs")).href;
  for (const [name, version] of [
    ["helm", "v4.3.2"],
    ["kustomize", "v5.8.1"],
  ]) {
    const body = `#!${process.execPath}\nimport(${JSON.stringify(tool)}).then((m) => m.run(${JSON.stringify(name)}, ${JSON.stringify(version)}));\n`;
    fs.writeFileSync(path.join(dir, /** @type {string} */ (name)), body, { mode: 0o755 });
  }
  return dir;
}

/** Every case, in code-point order of its folder name. */
export function caseNames() {
  return fs
    .readdirSync(FIXTURES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(FIXTURES, e.name, "case.json")))
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** @returns {ActionCase} */
export function readCase(/** @type {string} */ name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name, "case.json"), "utf8"));
}

/** Copies a fixture layer's files (regular files only) into the work tree. */
function copyLayer(/** @type {string} */ from, /** @type {string} */ to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyLayer(src, dst);
    } else if (e.isFile()) {
      fs.writeFileSync(dst, fs.readFileSync(src));
      fs.chmodSync(dst, 0o644);
    }
  }
}

/** Options every fixture git call carries, so a fixture repository starts no background work. */
export const INERT_GIT = Object.freeze(["-c", "maintenance.auto=false", "-c", "gc.auto=0"]);

/** @param {string} dir */
function clearTree(dir) {
  for (const e of fs.readdirSync(dir)) if (e !== ".git") fs.rmSync(path.join(dir, e), { recursive: true, force: true });
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} env
 */
function git(cwd, args, env) {
  // inert: no automatic maintenance or gc, which a commit would start detached and which would write into
  // .git/objects while a test compares snapshots of the checkout (release review, files m1)
  const r = spawnSync("git", [...INERT_GIT, ...args], { cwd, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`action-local: git ${args[0]} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * Builds the case's repository; returns the checkout the Action runs in and the two commits.
 * @param {string} name
 * @param {string} tmp
 */
export function buildCase(name, tmp) {
  const c = readCase(name);
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "crankpath fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.org",
    GIT_COMMITTER_NAME: "crankpath fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.org",
  };
  const origin = path.join(tmp, "origin");
  fs.mkdirSync(origin);
  git(origin, ["-c", "init.defaultBranch=main", "init", "-q"], env);
  const commit = (/** @type {string} */ message, /** @type {string} */ date) => {
    git(origin, ["add", "-A"], env);
    const dated = { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    git(origin, ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", message], dated);
    return git(origin, ["rev-parse", "HEAD"], env);
  };
  for (const layer of c.base) copyLayer(path.join(FIXTURES, layer), origin);
  const baseCommit = commit("base", "2026-11-15T00:00:00+0000");
  clearTree(origin);
  for (const layer of c.head) copyLayer(path.join(FIXTURES, layer), origin);
  for (const [from, to] of Object.entries(c.renames ?? {}))
    fs.renameSync(path.join(origin, from), path.join(origin, to));
  const headCommit = commit("head", "2026-11-15T01:00:00+0000");
  let checkout = origin;
  if (c.clone === "shallow") {
    checkout = path.join(tmp, "checkout");
    git(tmp, ["clone", "-q", "--depth", "1", pathToFileURL(origin).href, checkout], env);
  }
  return { c, checkout, baseCommit, headCommit, home };
}

/**
 * Runs one case through the Action's own script.
 * @returns {CaseRun}
 */
export function runCase(/** @type {string} */ name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-action-local-"));
  try {
    const { c, checkout, baseCommit, headCommit, home } = buildCase(name, tmp);
    const summaryFile = path.join(tmp, "step-summary.md");
    const outputFile = path.join(tmp, "step-output");
    const runnerTemp = path.join(tmp, "runner-temp");
    fs.writeFileSync(summaryFile, "");
    fs.writeFileSync(outputFile, "");
    fs.mkdirSync(runnerTemp);
    // the runner's environment (setup-node's role: the Node running the harness comes first on PATH;
    // a `"tools": "fake"` case puts the fake helm and kustomize before it)
    const tools = c.tools === "fake" ? [fakeToolsDir(fs.mkdtempSync(path.join(tmp, "tools-")))] : [];
    /** @type {Record<string, string>} */
    const env = {
      PATH: [...tools, path.dirname(process.execPath), process.env.PATH ?? "/usr/bin:/bin"].join(path.delimiter),
      HOME: home,
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_WORKSPACE: checkout,
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: runnerTemp,
      GITHUB_SERVER_URL: "http://gitea-http.gitea:3000",
      GITHUB_REPOSITORY: "ops/estate",
      GITHUB_TOKEN: FAKE_WORKFLOW_TOKEN,
    };
    // the step's env, evaluated as the runner would: inputs from their action.yml defaults, the
    // pull request's base from the event (none for the no-base case), the Action's own path
    const step = checkStep();
    /** @type {Record<string, string>} */
    const context = { "github.action_path": ACTION_DIR, "github.event.pull_request.base.sha": c.baseRef ?? baseCommit };
    for (const [name, input] of Object.entries(step.inputs))
      context[`inputs.${name}`] = evaluate(input.default ?? "", context);
    for (const [k, v] of Object.entries(step.env)) env[k] = evaluate(v, context);
    if (step.shell !== "bash") throw new Error("action-local: the check step is not a bash step");
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], {
      cwd: checkout,
      env,
      encoding: "utf8",
    });
    const annotations = r.stdout.split("\n").filter((l) => l !== "");
    const leftOver = fs.readdirSync(runnerTemp).length;
    if (leftOver !== 0) throw new Error("action-local: the Action left files in RUNNER_TEMP");
    return {
      name,
      description: c.description,
      exit: typeof r.status === "number" ? r.status : -1,
      outputs: fs.readFileSync(outputFile, "utf8"),
      annotations,
      summary: fs.readFileSync(summaryFile, "utf8"),
      expect: c.expect,
      baseCommit,
      headCommit,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The printed form of one case (what the release round screenshots). */
export function formatRun(/** @type {CaseRun} */ run) {
  const lines = [
    `== case: ${run.name}`,
    `   ${run.description}`,
    `exit status: ${run.exit}`,
    "outputs (GITHUB_OUTPUT):",
    ...run.outputs
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => `  ${l}`),
    `annotations (workflow commands on standard output): ${run.annotations.length}`,
    ...run.annotations.map((l) => `  ${l}`),
    "job summary (GITHUB_STEP_SUMMARY):",
    run.summary.trimEnd(),
    "",
  ];
  return lines.join("\n");
}

function main() {
  const names = process.argv.slice(2);
  const all = caseNames();
  for (const n of names) if (!all.includes(n)) throw new Error(`action-local: no case named ${JSON.stringify(n)}`);
  for (const name of names.length > 0 ? names : all) process.stdout.write(`${formatRun(runCase(name))}\n`);
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(path.resolve(invoked)).href) main();
