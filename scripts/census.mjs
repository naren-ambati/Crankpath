#!/usr/bin/env node
// The day-1 census (dev-only, not shipped): fetches each OD-26 estate read-only at its pinned
// commit into a cache outside the repository, reads its YAML only through BoundedReader (the built
// module in dist/, so run `npm run build` first), classifies it with scripts/census-lib.mjs and
// writes the C11 census JSON (URLs, commits and counts only).
//
//   node scripts/census.mjs [--out <file>] [--cache <dir>] [--need]
//
// --need prints, instead of the census, what the estates' readable files need of the reader
// limits (largest file, most documents in a file, deepest nesting, most nodes in a document).
//
// The cache is --cache, else $CRANKPATH_CENSUS_CACHE, else `cache/census` in the folder that holds
// this checkout; it must be outside the repository.
// Git runs only in these fixed forms: init, a depth-1 fetch of the exact commit over https with
// hooks, submodules, redirects and every other protocol disabled, a detached checkout and
// rev-parse. A fetch that fails is reported as failed for that estate, never as an empty estate.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { censusJson, classifyEstate, measureNeed } from "./census-lib.mjs";

/** The OD-26 estates, as recorded in docs/census.md section 1. */
export const ESTATES = Object.freeze([
  { url: "https://github.com/gitops-bridge-dev/gitops-bridge", sha: "cac900a22e6b82fd011f0f5f94dc35a1614cf24d" },
  { url: "https://github.com/mortennordbye/homelab", sha: "d1f07baeda9ccc196f17017bfaa547c867e0a768" },
  { url: "https://github.com/acelinkio/argocd-homelab", sha: "2f9aab023f92b6d73051bd86ec163a48a56dbe1e" },
  { url: "https://github.com/ricsanfre/pi-cluster", sha: "adf08ec2915bfc39e720b36a610ecfc94cb00634" },
  { url: "https://github.com/niki-on-github/nixos-k3s", sha: "9318b97bfdb1c49bc844734d4301d9c0142cab3a" },
]);

const GIT_SAFE = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "http.followRedirects=false",
  "-c",
  "submodule.recurse=false",
  "-c",
  "credential.helper=",
];

const GIT_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME ?? "/",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  LANG: "C",
};

/** @param {string[]} args @param {string} cwd */
function git(args, cwd) {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Fetches the exact commit (or reuses a cached checkout already at it).
 * @param {{ url: string, sha: string }} estate @param {string} cacheDir
 */
function fetchEstate(estate, cacheDir) {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(estate.url)) throw new Error("estate URL form");
  if (!/^[0-9a-f]{40}$/.test(estate.sha)) throw new Error("estate commit form");
  const dir = path.join(cacheDir, estate.url.replace("https://github.com/", "").replace("/", "_"));
  if (fs.existsSync(path.join(dir, ".git"))) {
    try {
      // reuse only a checkout at the commit with a clean working tree (no edit, no extra file)
      const clean = git([...GIT_SAFE, "status", "--porcelain", "--untracked-files=all", "--ignored"], dir) === "";
      if (clean && git([...GIT_SAFE, "rev-parse", "HEAD"], dir) === estate.sha) return dir;
    } catch {
      // fall through to a fresh fetch
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  git(["init", "-q", dir], cacheDir);
  git([...GIT_SAFE, "fetch", "-q", "--depth=1", "--no-tags", "--no-recurse-submodules", estate.url, estate.sha], dir);
  git([...GIT_SAFE, "checkout", "-q", "--detach", "FETCH_HEAD"], dir);
  const head = git([...GIT_SAFE, "rev-parse", "HEAD"], dir);
  if (head !== estate.sha) throw new Error("fetched commit differs");
  return dir;
}

/**
 * Is `rel` an existing directory under `real`, with no symlink on the way?
 * @param {string} real @param {string} rel
 */
function dirExists(real, rel) {
  let cur = real;
  for (const part of rel.split("/").filter((s) => s !== "" && s !== ".")) {
    if (part === "..") return false;
    cur = path.join(cur, part);
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch {
      return false;
    }
    if (st.isSymbolicLink() || !st.isDirectory()) return false;
  }
  return true;
}

/**
 * Walks the checkout without following symlinks and reads every YAML file through BoundedReader.
 * @param {string} dir @param {typeof import("../src/u2-intake-config/bounded-reader.js")} reader
 */
function readEstate(dir, reader) {
  const opened = reader.openRoot(dir);
  if (!opened.ok) throw new Error("estate root did not open");
  const root = opened.root;
  const files = [];
  /** @type {string[]} */
  const unreadable = [];
  /** @type {Record<string, number>} */
  const unreadableFiles = {};
  let filesRead = 0;
  let symlinks = 0;
  let chartTemplateFilesUnreadable = 0;
  let maxFileBytes = 0;
  /** @type {string[]} */
  const stack = [""];
  while (stack.length > 0) {
    const rel = /** @type {string} */ (stack.pop());
    const entries = fs.readdirSync(path.join(root.real, rel), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isSymbolicLink()) {
        symlinks += 1;
        continue;
      }
      if (e.isDirectory()) {
        if (e.name !== ".git") stack.push(childRel);
        continue;
      }
      if (!e.isFile() || !/\.ya?ml$/.test(e.name)) continue;
      const r = reader.readYaml(root, childRel);
      if (r.outcome === "ok") {
        filesRead += 1;
        maxFileBytes = Math.max(maxFileBytes, r.size);
        files.push({ path: r.path, documents: r.documents });
        continue;
      }
      unreadableFiles[r.outcome] = (unreadableFiles[r.outcome] ?? 0) + 1;
      unreadable.push(childRel);
      const t = childRel.split("/").indexOf("templates");
      if (t >= 0 && fs.existsSync(path.join(root.real, ...childRel.split("/").slice(0, t), "Chart.yaml"))) {
        chartTemplateFilesUnreadable += 1;
      }
    }
  }
  return {
    files,
    unreadable,
    filesRead,
    unreadableFiles,
    symlinks,
    chartTemplateFilesUnreadable,
    maxFileBytes,
    pathExists: (/** @type {string} */ p) => dirExists(root.real, p),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cacheDir = opt("--cache") ?? process.env.CRANKPATH_CENSUS_CACHE ?? path.join(repoRoot, "..", "cache", "census");
  const cacheAbs = path.resolve(cacheDir);
  if (cacheAbs === repoRoot || cacheAbs.startsWith(`${repoRoot}${path.sep}`)) {
    console.error("census: the cache must be outside the repository");
    process.exitCode = 2;
    return;
  }
  const readerPath = path.join(repoRoot, "dist", "u2-intake-config", "bounded-reader.js");
  const reader = await import(pathToFileURL(readerPath).href);
  fs.mkdirSync(cacheAbs, { recursive: true });
  const results = [];
  const need = [];
  for (const estate of ESTATES) {
    const dir = fetchEstate(estate, cacheAbs);
    const read = readEstate(dir, reader);
    need.push({ url: estate.url, maxFileBytes: read.maxFileBytes, ...measureNeed(read.files) });
    const count = classifyEstate({
      ownUrl: estate.url,
      files: read.files,
      pathExists: read.pathExists,
      unreadable: read.unreadable,
    });
    results.push({
      url: estate.url,
      sha: estate.sha,
      count,
      filesRead: read.filesRead,
      unreadableFiles: read.unreadableFiles,
      chartTemplateFilesUnreadable: read.chartTemplateFilesUnreadable,
      symlinks: read.symlinks,
    });
  }
  if (args.includes("--need")) {
    for (const n of need) console.log(JSON.stringify(n));
    return;
  }
  const json = `${JSON.stringify(censusJson(results), null, 2)}\n`;
  const out = opt("--out");
  if (out !== undefined) fs.writeFileSync(out, json);
  else process.stdout.write(json);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
