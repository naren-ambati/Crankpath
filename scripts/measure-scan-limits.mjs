#!/usr/bin/env node
// Measures what a walked file costs a run that charges it nothing (dev-only; docs/limits.md quotes
// its output, and `filesPerScan` in src/u1-graph-model/limits.ts takes the rate). The run budget
// charges a file by its bytes, so an empty file or a file discovery does not parse costs the
// budget nothing; this script measures what such files cost anyway (the walk's path list, the read
// cache entry, the unreadable or ignored count). Each shape is a generated tree at two sizes, run
// by the built pipeline (`npm run build` first) with no budget, in its own child process; the rate
// is the difference in peak resident memory between the two sizes over the difference in files.
//
//   node scripts/measure-scan-limits.mjs

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** @param {string} p */
const dist = (p) => pathToFileURL(path.join(here, "..", "dist", p)).href;
const URL_SELF = "https://example.org/ops/measure";

const CHILD = `
const { runPipeline } = await import(${JSON.stringify(dist("u9-cli-package/pipeline-runner.js"))});
const [dir, url] = process.argv.slice(1);
const unlimited = { bytes: Number.MAX_SAFE_INTEGER, rates: { perFileByte: 0, perObject: 0, perStringLeaf: 0, perEdge: 0 }, parse: { bytesPerLexeme: 0, textBytesPerByte: 0 }, maxEdges: Number.MAX_SAFE_INTEGER, maxFiles: Number.MAX_SAFE_INTEGER };
const out = runPipeline({ path: dir, cwd: process.cwd(), repoUrl: url, budget: unlimited });
if (out.kind !== "report") throw new Error(out.message);
const c = out.report.runStatus.counts;
process.stdout.write(JSON.stringify({ maxRss: process.resourceUsage().maxRSS * 1024, ignored: c.ignoredFiles }));
`;

const APP = `apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata: {name: a, namespace: argocd}\nspec:\n  source: {repoURL: "${URL_SELF}", path: empty}\n  destination: {server: "https://kubernetes.default.svc", namespace: a}\n`;

/**
 * n files spread over directories of 1,000 (GitHub's guidance is at most 3,000 entries per directory).
 * @param {string} dir
 * @param {number} n
 * @param {(i: number) => string} name
 * @param {string} content
 */
function tree(dir, n, name, content) {
  fs.mkdirSync(path.join(dir, "apps"));
  fs.mkdirSync(path.join(dir, "empty"));
  fs.writeFileSync(path.join(dir, "apps", "a.yaml"), APP);
  for (let i = 0; i < n; i++) {
    const d = path.join(dir, "f", `d${Math.floor(i / 1000)}`);
    if (i % 1000 === 0) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, name(i)), content);
  }
}

/** @type {Record<string, (dir: string, n: number) => void>} */
const SHAPES = {
  // empty `.yaml` files: each is walked, read, parsed (no document) and cached
  "empty-yaml"(dir, n) {
    tree(dir, n, (/** @type {number} */ i) => `f${i}.yaml`, "");
  },
  // files discovery never reads: each is only walked and counted
  "other-files"(dir, n) {
    tree(dir, n, (/** @type {number} */ i) => `f${i}.txt`, "");
  },
  // empty `.yaml` files with 200-character names: the cost per character of a path
  "long-names"(dir, n) {
    tree(dir, n, (/** @type {number} */ i) => `${String(i).padStart(195, "x")}.yaml`, "");
  },
};
const SIZES = [50_000, 100_000];

/** @param {string} dir */
function runChild(dir) {
  const out = execFileSync(
    process.execPath,
    ["--max-old-space-size=8192", "--input-type=module", "-e", CHILD, dir, URL_SELF],
    { encoding: "utf8", maxBuffer: 1 << 20 },
  );
  return JSON.parse(out);
}

const only = process.argv.slice(2);
// CRANKPATH_MEASURE_TMP: where the generated trees go (default: the system temporary directory)
const base = fs.mkdtempSync(path.join(process.env.CRANKPATH_MEASURE_TMP ?? os.tmpdir(), "crankpath-measure-scan-"));
try {
  for (const [name, make] of Object.entries(SHAPES)) {
    if (only.length > 0 && !only.includes(name)) continue;
    const runs = SIZES.map((n) => {
      const dir = fs.mkdtempSync(path.join(base, `${name}-`));
      make(dir, n);
      const r = runChild(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`${name} n=${n}: files hold no source ${r.ignored}, peak ${r.maxRss} bytes`);
      return { n, ...r };
    });
    const [a, b] = /** @type {[any, any]} */ (runs);
    console.log(
      `${name}: ${((b.maxRss - a.maxRss) / (b.n - a.n)).toFixed(1)} bytes per file (peak difference over file difference)`,
    );
  }
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
