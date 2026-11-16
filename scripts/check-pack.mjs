#!/usr/bin/env node
// check-pack: what the package would ship and how it is pinned (FR12.3, FR12.4, NFR16, D9, D15).
// Read-only and offline: `npm pack --dry-run --json --ignore-scripts --offline` lists the files; nothing is
// written, packed or published.
//
// Usage: node scripts/check-pack.mjs (after `npm run build`; `npm run verify` builds first)
//
// Rules (each problem prints `rule detail`; any problem exits 1):
//   pack-content   the tarball holds only dist/**, README.md, CHANGELOG.md, LICENSE, NOTICE and
//                  package.json; it holds each of the last five, something under dist/, and the bin file;
//                  every dist/ file is a .js or .d.ts compiled from a source under src/
//   licence-text   LICENSE is byte-identical to the Apache License 2.0 text (its SHA-256, checked against
//                  https://www.apache.org/licenses/LICENSE-2.0.txt, docs/lookups.md)
//   licence-file   no licence-like file other than the root LICENSE (beside the root NOTICE) and an
//                  upstream LICENSE directly inside test/corpus/<copy>/ beside that copy's NOTICE
//   package-json   "license" is "Apache-2.0"; "private" is not true; "repository", "homepage" and "bugs"
//                  are the values set below; "files" is exactly dist, README.md, CHANGELOG.md and NOTICE;
//                  no script runs on install, pack or publish, and none publishes (BR12.5)
//   pinned         every dependency and development dependency is an exact version, and the lockfile
//                  holds that exact version
//   lockfile       package-lock.json is lockfileVersion 3; every locked package is resolved from
//                  registry.npmjs.org with an integrity hash; no runtime package has an install script;
//                  a development package with one is named, and .npmrc must hold `ignore-scripts=true`
//                  so it never runs

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** SHA-256 of https://www.apache.org/licenses/LICENSE-2.0.txt (fetched read-only 2026-11-16, docs/lookups.md). */
export const APACHE_2_SHA256 = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";
export const EXPECTED_META = Object.freeze({
  repository: { type: "git", url: "git+https://github.com/naren-ambati/crankpath.git" },
  homepage: "https://github.com/naren-ambati/crankpath#readme",
  bugs: { url: "https://github.com/naren-ambati/crankpath/issues" },
});
export const FILES_FIELD = Object.freeze(["dist", "README.md", "CHANGELOG.md", "NOTICE"]);
export const TOP_LEVEL = Object.freeze(["README.md", "CHANGELOG.md", "LICENSE", "NOTICE", "package.json"]);
/** Lifecycle scripts that run on install, pack or publish, and publish itself. */
export const FORBIDDEN_SCRIPTS = Object.freeze([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepack",
  "postpack",
  "prepublish",
  "prepublishOnly",
  "publish",
  "postpublish",
  "preversion",
  "version",
  "postversion",
]);
const LICENCE_NAME = /^(?:licen[cs]e|copying|unlicense)(?:[.-].*)?$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist"]);

/** @param {string} root */
export function packList(root) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts", "--offline"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" },
  });
  const info = JSON.parse(out)[0];
  return /** @type {{ path: string }[]} */ (info.files).map((f) => f.path).sort();
}

/**
 * @param {string[]} paths
 * @param {Record<string, unknown>} pkg
 */
export function checkList(paths, pkg) {
  /** @type {string[]} */
  const problems = [];
  for (const p of paths)
    if (!p.startsWith("dist/") && !TOP_LEVEL.includes(p))
      problems.push(`pack-content the tarball would hold "${p}" (only dist/, ${TOP_LEVEL.join(", ")} may ship)`);
  if (!paths.some((p) => p.startsWith("dist/"))) problems.push("pack-content nothing under dist/ (run npm run build)");
  for (const f of TOP_LEVEL) if (!paths.includes(f)) problems.push(`pack-content the tarball does not hold ${f}`);
  const bin = pkg.bin;
  const bins = typeof bin === "string" ? [bin] : bin !== null && typeof bin === "object" ? Object.values(bin) : [];
  for (const b of bins) {
    const rel = path.posix.normalize(String(b));
    if (!paths.includes(rel)) problems.push(`pack-content the bin "${rel}" is not in the tarball`);
  }
  return problems;
}

/** @param {Record<string, any>} pkg */
export function checkPackageJson(pkg) {
  /** @type {string[]} */
  const problems = [];
  if (pkg.license !== "Apache-2.0") problems.push('package-json "license" must be "Apache-2.0"');
  if (pkg.private === true) problems.push('package-json "private" must not be true');
  for (const [k, v] of Object.entries(EXPECTED_META))
    if (JSON.stringify(pkg[k]) !== JSON.stringify(v)) problems.push(`package-json "${k}" must be ${JSON.stringify(v)}`);
  if (JSON.stringify(pkg.files) !== JSON.stringify(FILES_FIELD))
    problems.push(`package-json "files" must be exactly ${JSON.stringify(FILES_FIELD)}`);
  const scripts = pkg.scripts ?? {};
  for (const s of FORBIDDEN_SCRIPTS)
    if (s in scripts) problems.push(`package-json the script "${s}" runs on install, pack or publish`);
  for (const [name, cmd] of Object.entries(scripts))
    if (/\b(?:npm|pnpm|yarn)\s+publish\b|\bgit\s+push\b|\bgit\s+tag\b/.test(String(cmd)))
      problems.push(`package-json the script "${name}" publishes, pushes or tags`);
  return problems;
}

/**
 * @param {Record<string, any>} pkg
 * @param {Record<string, any>} lock
 * @param {string} npmrc
 */
export function checkLock(pkg, lock, npmrc) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  if (lock.lockfileVersion !== 3) problems.push("lockfile package-lock.json must be lockfileVersion 3");
  const packages = lock.packages ?? {};
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!/^\d+\.\d+\.\d+$/.test(String(spec)))
        problems.push(`pinned ${field} "${name}" is "${spec}", not an exact version`);
      const locked = packages[`node_modules/${name}`];
      if (locked === undefined || locked.version !== spec)
        problems.push(`pinned ${field} "${name}" ${spec} is not the version the lockfile holds`);
    }
  }
  const ignoreScripts = /^\s*ignore-scripts\s*=\s*true\s*$/m.test(npmrc);
  if (!ignoreScripts) problems.push("lockfile .npmrc must hold ignore-scripts=true");
  for (const [key, p] of Object.entries(packages)) {
    if (key === "") continue;
    if (p.link === true) {
      problems.push(`lockfile ${key} is a link, not a registry package`);
      continue;
    }
    let host = "";
    try {
      host = new URL(String(p.resolved)).host;
    } catch {
      host = "";
    }
    if (host !== "registry.npmjs.org") problems.push(`lockfile ${key} is not resolved from registry.npmjs.org`);
    if (typeof p.integrity !== "string" || !p.integrity.startsWith("sha512-"))
      problems.push(`lockfile ${key} has no sha512 integrity hash`);
    if (p.hasInstallScript === true) {
      if (p.dev !== true) problems.push(`lockfile ${key} is a runtime package with an install script`);
      else
        notes.push(`${key} (development only) has an install script; .npmrc ignore-scripts=true keeps it from running`);
    }
  }
  return { problems, notes };
}

/**
 * Licence-like files other than the root LICENSE beside the root NOTICE and test/corpus/<copy>/LICENSE beside
 * test/corpus/<copy>/NOTICE.
 * @param {string} root
 */
export function findLicenceFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full);
      else if (LICENCE_NAME.test(name) && !allowedLicence(rel, dir)) out.push(rel);
    }
  };
  walk(root);
  return out;
}

/** @param {string} rel @param {string} dir */
function allowedLicence(rel, dir) {
  if (rel === "LICENSE") return fs.existsSync(path.join(dir, "NOTICE"));
  const parts = rel.split("/");
  return (
    parts.length === 4 &&
    parts[0] === "test" &&
    parts[1] === "corpus" &&
    parts[3] === "LICENSE" &&
    fs.existsSync(path.join(dir, "NOTICE"))
  );
}

/**
 * Every file under dist/ must be compiled output of a source under src/ (`dist/x.js` and `dist/x.d.ts`
 * from `src/x.ts`): the build does not clean dist/, so a stale output of a deleted source, or any
 * other file put there, would ship (review n2).
 * @param {string} root
 * @param {string[]} list the tarball's paths
 */
export function checkDistSources(root, list) {
  /** @type {string[]} */
  const problems = [];
  for (const p of list) {
    if (!p.startsWith("dist/")) continue;
    const m = /^dist\/(.+?)(?:\.d\.ts|\.js)$/.exec(p);
    if (m === null) {
      problems.push(`pack-content "${p}" is not a compiled .js or .d.ts file`);
      continue;
    }
    const src = `src/${m[1]}.ts`;
    if (!fs.existsSync(path.join(root, src)))
      problems.push(`pack-content "${p}" has no source ${src} (a stale build output)`);
  }
  return problems;
}

/** @param {string} root @param {{ list?: string[] }} [opts] */
export function checkPack(root, opts = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  /** @type {string[]} */
  const problems = [...checkPackageJson(pkg)];
  const list = opts.list ?? packList(root);
  problems.push(...checkList(list, pkg));
  problems.push(...checkDistSources(root, list));
  const licence = path.join(root, "LICENSE");
  if (!fs.existsSync(licence)) problems.push("licence-text there is no LICENSE file");
  else {
    const sha = createHash("sha256").update(fs.readFileSync(licence)).digest("hex");
    if (sha !== APACHE_2_SHA256)
      problems.push("licence-text LICENSE is not byte-identical to the Apache License 2.0 text");
  }
  for (const f of findLicenceFiles(root))
    problems.push(`licence-file "${f}" is a licence file outside the root and the corpus copies' folders`);
  const lockPath = path.join(root, "package-lock.json");
  /** @type {string[]} */
  let notes = [];
  if (!fs.existsSync(lockPath)) problems.push("lockfile there is no package-lock.json");
  else {
    const npmrcPath = path.join(root, ".npmrc");
    const npmrc = fs.existsSync(npmrcPath) ? fs.readFileSync(npmrcPath, "utf8") : "";
    const lock = checkLock(pkg, JSON.parse(fs.readFileSync(lockPath, "utf8")), npmrc);
    problems.push(...lock.problems);
    notes = lock.notes;
  }
  return { problems, notes, list };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = checkPack(root);
  for (const n of r.notes) console.log(`note  ${n}`);
  for (const p of r.problems) console.log(`FAIL  ${p}`);
  const top = r.list.filter((p) => !p.startsWith("dist/"));
  console.log(
    `check-pack: ${r.list.length} files would ship (${r.list.length - top.length} under dist/, ${top.join(", ")}), ${r.problems.length} problem(s)`,
  );
  process.exitCode = r.problems.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
