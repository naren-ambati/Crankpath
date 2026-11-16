#!/usr/bin/env node
// release-checks: the ReleaseChecks list in one command (US12.3, W12.1, OD-8, OD-23, OD-28). Each check
// prints one result line, PASS, FAIL, NOT RUN or SKIPPED; a check that could not run is never a pass.
// Nothing is published, tagged or pushed (BR12.5).
//
// Usage:
//   node scripts/release-checks.mjs            the offline checks, the last step of `npm run verify`
//   node scripts/release-checks.mjs --release  `npm run release:check`: also the network and helm checks,
//                                              and every NOT RUN, SKIPPED or pending item fails
//
// Offline checks: check-tree (personal paths, the design workspace's names, this machine's names),
// check-docs (links, anchors, reachability, Mermaid, output captions, the claim map, the README order,
// forbidden claims, the D11 document set), secret-grep (credentials and the packed files; the denylist
// is its own line), check-pack (what ships, the licence text, package.json, the pinned lockfile) and
// interim-reason (the B1 opacity reason `not-in-this-build` must be gone from src/ and dist/ before a
// release), check-images (every screenshot of docs/images has its transcript, alt text, caption, a doc
// that shows it and an entry in docs/images/README.md; the set under 3,000,000 bytes) and
// check-examples (every example of examples/expected.json pinned and shown in docs/examples.md, every
// quote there equal to its pinned output; the examples themselves run in the test suite).
// Release-only checks: npm audit (a registry call), and the golden lane `npm run verify:golden` (OD-23:
// both goldens must have run with helm and the network; a skipped golden cannot satisfy v0.1.0).
// Without --release these two print NOT RUN (release only); the denylist and the interim reason are
// reported, and do not fail the offline run; with --release each fails unless it passed.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocs } from "./check-docs.mjs";
import { checkExamples } from "./check-examples.mjs";
import { checkImages } from "./check-images.mjs";
import { checkPack } from "./check-pack.mjs";
import { checkTree } from "./check-tree.mjs";
import { secretGrep } from "./secret-grep.mjs";

export const INTERIM_REASON = "not-in-this-build";

/**
 * Files under src/ and dist/ that still name the interim opacity reason.
 * @param {string} root
 */
export function interimReasonFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && fs.readFileSync(full, "utf8").includes(INTERIM_REASON))
        out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  // with no src/ there is nothing to prove the reason absent from: that is a finding, not a pass
  if (!fs.existsSync(path.join(root, "src"))) out.push("src/ (missing: nothing to check)");
  walk(path.join(root, "src"));
  walk(path.join(root, "dist"));
  return out;
}

/**
 * The npm audit result: counts by severity for the whole tree and for the runtime tree.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env] the environment npm runs with (a test passes a fake npm on PATH)
 * @returns {{ result: "PASS" | "FAIL" | "NOT RUN", detail: string }}
 */
export function audit(root, env = process.env) {
  /** @param {string[]} extra */
  const run = (extra) =>
    spawnSync("npm", ["audit", "--json", ...extra], {
      cwd: root,
      encoding: "utf8",
      env: { ...env, npm_config_update_notifier: "false", npm_config_fund: "false" },
    });
  const counts = [];
  for (const [label, extra] of /** @type {[string, string[]][]} */ ([
    ["runtime", ["--omit=dev"]],
    ["all", []],
  ])) {
    const r = run(extra);
    let meta;
    try {
      meta = JSON.parse(r.stdout).metadata?.vulnerabilities;
    } catch {
      meta = undefined;
    }
    if (meta === undefined) return { result: "NOT RUN", detail: `npm audit gave no result (${label}; offline?)` };
    counts.push({ label, meta });
  }
  const runtime = counts[0]?.meta;
  const words = counts.map(
    ({ label, meta }) =>
      `${label}: ${meta.total} (${["critical", "high", "moderate", "low", "info"].map((s) => `${s} ${meta[s] ?? 0}`).join(", ")})`,
  );
  return { result: runtime.total === 0 ? "PASS" : "FAIL", detail: `vulnerabilities ${words.join("; ")}` };
}

/**
 * The golden lane (OD-23): PASS only when `npm run verify:golden` exits 0.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ result: "PASS" | "FAIL" | "NOT RUN" | "SKIPPED", detail: string }}
 */
export function goldens(root, env = process.env) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.scripts?.["verify:golden"] === undefined)
    return { result: "NOT RUN", detail: "there is no verify:golden script in this build" };
  const r = spawnSync("npm", ["run", "--silent", "verify:golden"], { cwd: root, encoding: "utf8", env });
  const last = `${r.stdout ?? ""}`.trim().split("\n").slice(-1)[0] ?? "";
  if (r.status === 0) return { result: "PASS", detail: last };
  if (r.status === 2) return { result: "SKIPPED", detail: `${last} (a skipped golden cannot satisfy v0.1.0, OD-23)` };
  return { result: "FAIL", detail: last };
}

/**
 * Runs the checks. Returns the result lines and whether the run passes.
 * @param {{ root: string, release?: boolean, env?: NodeJS.ProcessEnv, today?: string }} options
 */
export function releaseChecks({ root, release = false, env = process.env, today }) {
  /** @type {{ check: string, result: "PASS" | "FAIL" | "NOT RUN" | "SKIPPED", detail: string, blocking: boolean }[]} */
  const results = [];
  /** @type {string[]} */
  const details = [];

  const tree = checkTree({ root });
  for (const f of tree.findings) details.push(`check-tree  ${f.file}:${f.line === 0 ? "name" : f.line}: ${f.rule}`);
  results.push({
    check: "check-tree",
    result: tree.findings.length === 0 && tree.filesRead > 0 ? "PASS" : "FAIL",
    detail: `${tree.filesRead} files read, ${tree.findings.length} finding(s)`,
    blocking: true,
  });

  const docs = checkDocs({ root, release, ...(today === undefined ? {} : { today }) });
  for (const p of docs.pending) details.push(`check-docs  pending ${p}`);
  for (const p of docs.problems) details.push(`check-docs  ${p}`);
  results.push({
    check: "check-docs",
    result: docs.problems.length === 0 ? "PASS" : "FAIL",
    detail: `${docs.files} Markdown files, ${docs.claims} claim(s) mapped, ${docs.problems.length} problem(s), ${docs.pending.length} pending`,
    blocking: true,
  });

  const grep = secretGrep({ root, env, release: false });
  for (const f of grep.findings) details.push(`secret-grep  ${f}`);
  results.push({
    check: "secret-grep",
    result: grep.findings.length === 0 && grep.treeRead > 0 ? "PASS" : "FAIL",
    detail: `${grep.treeRead} files in the tree, ${grep.packRead} in the package, ${grep.findings.length} finding(s)`,
    blocking: true,
  });
  results.push({
    check: "denylist",
    result: grep.denylistRun ? (grep.findings.some((f) => f.includes("denylist")) ? "FAIL" : "PASS") : "NOT RUN",
    detail: grep.denylistDetail,
    blocking: release || grep.denylistRun,
  });

  const pack = checkPack(root);
  for (const n of pack.notes) details.push(`check-pack  note ${n}`);
  for (const p of pack.problems) details.push(`check-pack  ${p}`);
  results.push({
    check: "check-pack",
    result: pack.problems.length === 0 ? "PASS" : "FAIL",
    detail: `${pack.list.length} files would ship, ${pack.problems.length} problem(s)`,
    blocking: true,
  });

  const images = checkImages({ root });
  for (const p of images.problems) details.push(`check-images  ${p}`);
  results.push({
    check: "check-images",
    result: images.problems.length === 0 ? "PASS" : "FAIL",
    detail: `${images.images} images, ${images.bytes} bytes, ${images.problems.length} problem(s)`,
    blocking: true,
  });

  /** @type {{ problems: string[], examples: number, runs: number, quotes: number }} */
  let examples;
  try {
    examples = checkExamples({
      examplesDir: path.join(root, "examples"),
      docFile: path.join(root, "docs", "examples.md"),
      root,
    });
  } catch (e) {
    examples = {
      problems: [`examples/expected.json could not be read (${e instanceof Error ? e.message : String(e)})`],
      examples: 0,
      runs: 0,
      quotes: 0,
    };
  }
  for (const p of examples.problems) details.push(`check-examples  ${p}`);
  results.push({
    check: "check-examples",
    result: examples.problems.length === 0 ? "PASS" : "FAIL",
    detail: `${examples.examples} examples, ${examples.runs} runs, ${examples.quotes} quotes, ${examples.problems.length} problem(s)`,
    blocking: true,
  });

  const interim = interimReasonFiles(root);
  for (const f of interim) details.push(`interim-reason  ${f} names "${INTERIM_REASON}"`);
  results.push({
    check: "interim-reason",
    result: interim.length === 0 ? "PASS" : "FAIL",
    detail:
      interim.length === 0
        ? `"${INTERIM_REASON}" is in no file under src/ or dist/`
        : `"${INTERIM_REASON}" is still in ${interim.length} file(s) under src/ and dist/${release ? "" : " (blocks a release only)"}`,
    blocking: release,
  });

  if (release) {
    results.push({ check: "npm-audit", ...audit(root, env), blocking: true });
    results.push({ check: "goldens", ...goldens(root, env), blocking: true });
  } else {
    results.push({ check: "npm-audit", result: "NOT RUN", detail: "release only (a registry call)", blocking: false });
    results.push({
      check: "goldens",
      result: "NOT RUN",
      detail: "release only (needs helm and the network)",
      blocking: false,
    });
  }
  const ok = results.every((r) => r.result === "PASS" || !r.blocking);
  return { ok, results, details };
}

/**
 * The one summary line. A failure that blocks only a release is counted apart, so an offline run that
 * passes never shows a bare "failed" count above zero.
 * @param {{ result: string, blocking: boolean }[]} results
 * @param {boolean} release
 */
export function summaryLine(results, release) {
  const n = (/** @type {(c: { result: string, blocking: boolean }) => boolean} */ p) => results.filter(p).length;
  const parts = [`${n((c) => c.result === "PASS")} passed`, `${n((c) => c.result === "FAIL" && c.blocking)} failed`];
  const later = n((c) => c.result === "FAIL" && !c.blocking);
  if (later > 0) parts.push(`${later} failing a release only`);
  parts.push(`${n((c) => c.result === "NOT RUN")} not run`, `${n((c) => c.result === "SKIPPED")} skipped`);
  return `release checks${release ? " (release mode)" : ""}: ${parts.join(", ")}; a check not run or skipped is not a pass`;
}

/**
 * The verdict line: which checks block this run (a FAIL, or a NOT RUN or SKIPPED that blocks), or that
 * none does.
 * @param {{ check: string, result: string, blocking: boolean }[]} results
 * @param {boolean} release
 */
export function verdictLine(results, release) {
  const blockers = results.filter((c) => c.blocking && c.result !== "PASS").map((c) => `${c.check} ${c.result}`);
  const what = release ? "release check" : "offline checks";
  return blockers.length === 0 ? `${what}: nothing blocks` : `${what}: FAILED, blocked by ${blockers.join(", ")}`;
}

function main() {
  const args = process.argv.slice(2);
  const release = args.includes("--release");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = releaseChecks({ root, release });
  for (const d of r.details) console.log(`  ${d}`);
  for (const c of r.results) console.log(`${c.result.padEnd(8)} ${c.check.padEnd(15)} ${c.detail}`);
  console.log(summaryLine(r.results, release));
  console.log(verdictLine(r.results, release));
  if (release)
    console.log(
      "Not checked here: whether the name crankpath is still free on npm and GitHub (re-check by hand before the go). Nothing was published.",
    );
  process.exitCode = r.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
