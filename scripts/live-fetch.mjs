#!/usr/bin/env node
// The live fetch lane (B3, dev-only): fetches one small public repository at a pinned commit with
// the built RepoFetcher (`npm run build` first) and the installed git, read-only, then scans it
// with the built pipeline, then reads the same commit again from the cache under no network (git
// verifies the cached store first). It reports SKIPPED with the reason when it cannot run (no git, or the
// fetch fails, offline included) and exits 2: a skipped lane is never a pass. It reports FAIL and exits 1
// when the cached read fails or the cache folder is unusable (scripts/live-cache.mjs: a folder that does
// not exist is created; a relative path, a file, a symbolic link or a folder inside this repository is
// refused before anything is fetched). Nothing it fetches is committed; the store goes to a private
// directory in the cache folder (CRANKPATH_LIVE_CACHE, an absolute path outside the repository; unset,
// the system temporary folder), removed at the end.
//
//   CRANKPATH_LIVE_CACHE=<dir> node scripts/live-fetch.mjs
//
// The repository: fluxcd/flux2-kustomize-helm-example (Apache-2.0), pinned at the commit its
// default branch held on 2026-11-15 (docs/lookups.md).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { liveCacheRoot } from "./live-cache.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
/** @param {string} p */
const dist = (p) => pathToFileURL(path.join(here, "..", "dist", p)).href;
const URL_LIVE = "https://github.com/fluxcd/flux2-kustomize-helm-example";
const SHA = "4f1a5b1051b469108d1bdf0ebec6c814427e3834";

const cache = liveCacheRoot(process.env.CRANKPATH_LIVE_CACHE, os.tmpdir(), path.join(here, ".."));
if (!cache.ok) {
  console.log(cache.line);
  process.exit(1);
}
if (cache.created) console.log(`live fetch: created the cache folder named by CRANKPATH_LIVE_CACHE`);

const { createRepoFetcher, findGit } = await import(dist("u4-render-engine/repo-fetcher.js"));
const { createWorkDir } = await import(dist("u4-render-engine/work-dir.js"));
const { runPipeline } = await import(dist("u9-cli-package/pipeline-runner.js"));

const git = findGit(process.env.PATH ?? "");
if (git === null) {
  console.log("live fetch: SKIPPED (git not found on PATH)");
  process.exit(2);
}
/** @type {string} */
let cacheRoot;
try {
  cacheRoot = fs.realpathSync(fs.mkdtempSync(path.join(cache.dir, "crankpath-live-")));
} catch (e) {
  const code = e instanceof Error && "code" in e ? String(e.code) : "error";
  console.log(`live fetch: FAIL (no private directory could be made in the cache folder: ${code})`);
  process.exit(1);
}
const work = createWorkDir(cacheRoot, true);
const fetcher = createRepoFetcher({ work, network: true, env: () => undefined, git });
try {
  const started = performance.now();
  const r = fetcher.fetch(URL_LIVE, SHA);
  const ms = Math.round(performance.now() - started);
  if (!r.ok) {
    console.log(`live fetch: SKIPPED (${r.reason}: ${r.detail})`);
    process.exitCode = 2;
  } else {
    report(r, ms);
    // the same commit again under --no-network: read from the cached store only after git has
    // verified it, and materialised again in the run's own directory (B3 review pass 2, M1)
    const again = createWorkDir(cacheRoot, true);
    try {
      const t = performance.now();
      const c = createRepoFetcher({ work: again, network: false, env: () => undefined, git }).fetch(URL_LIVE, SHA);
      const files = c.ok ? fs.readdirSync(c.dir, { recursive: true }).length : 0;
      console.log(
        c.ok
          ? `live fetch: cached read RAN, verified (fsck), its listing bounded, and materialised in ${Math.round(performance.now() - t)} ms; cached: ${c.cached ? "yes" : "no"}; ${files} entries`
          : `live fetch: cached read FAILED (${c.reason}: ${c.detail})`,
      );
      if (!c.ok || !c.cached) process.exitCode = 1;
    } finally {
      again.cleanup();
    }
  }
} finally {
  work.cleanup();
  fs.rmSync(cacheRoot, { recursive: true, force: true });
}

/**
 * @param {{ dir: string, commit: string, floating: boolean }} r
 * @param {number} ms
 */
function report(r, ms) {
  const files = fs.readdirSync(r.dir, { recursive: true }).length;
  const out = runPipeline({ path: r.dir, cwd: cacheRoot, repoUrl: URL_LIVE });
  const status = out.kind === "report" ? out.report.runStatus.state : `error: ${out.message}`;
  const sources = out.kind === "report" ? out.report.runStatus.counts.sourcesFound : 0;
  console.log(
    `live fetch: RAN ${URL_LIVE} at ${r.commit} (floating: ${r.floating ? "yes" : "no"}; pinned ${r.commit === SHA ? "and matched" : "but DIFFERENT"}) in ${ms} ms; ${files} entries materialised; scan: ${status}, ${sources} sources`,
  );
}
