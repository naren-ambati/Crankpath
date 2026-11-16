#!/usr/bin/env node
// Measures what one run costs in crankpath's own structures (dev-only; docs/limits.md quotes its
// output and src/u1-graph-model/run-limits.ts takes its rates). Each shape is a generated estate
// at two sizes, run by the built pipeline (`npm run build` first) with no budget, in its own child
// process, with the JSON output held in memory as `--out` does. The rate of a shape is the
// difference in peak resident memory between its two sizes divided by the difference in units.
//
//   node scripts/measure-run-limits.mjs

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
const { writeJson } = await import(${JSON.stringify(dist("u8-output/json-renderer.js"))});
const [dir, url] = process.argv.slice(1);
const unlimited = { bytes: Number.MAX_SAFE_INTEGER, rates: { perFileByte: 0, perObject: 0, perStringLeaf: 0, perEdge: 0 }, parse: { bytesPerLexeme: 0, textBytesPerByte: 0 }, maxEdges: Number.MAX_SAFE_INTEGER };
const out = runPipeline({ path: dir, cwd: process.cwd(), repoUrl: url, budget: unlimited });
if (out.kind !== "report") throw new Error(out.message);
const chunks = [];
writeJson(out.report, (c) => chunks.push(c));
const c = out.report.runStatus.counts;
process.stdout.write(JSON.stringify({ maxRss: process.resourceUsage().maxRSS * 1024, nodes: c.nodes, edges: c.edgesExtracted, out: chunks.reduce((n, x) => n + x.length, 0) }));
`;

/**
 * @param {string} name
 * @param {string} sourcePath
 */
function app(name, sourcePath) {
  return `apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata: {name: ${name}, namespace: argocd}\nspec:\n  source: {repoURL: "${URL_SELF}", path: ${sourcePath}}\n  destination: {server: "https://kubernetes.default.svc", namespace: ${name}}\n`;
}

/** @type {Record<string, (dir: string, n: number) => {units: number, bytes: number}>} */
const SHAPES = {
  // n Applications, each rendering one directory of 2,000 small ConfigMaps: units are objects.
  objects(dir, n) {
    fs.mkdirSync(path.join(dir, "apps"));
    fs.mkdirSync(path.join(dir, "big"));
    for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, "apps", `a${i}.yaml`), app(`a${i}`, "big"));
    let text = "";
    for (let k = 0; k < 2000; k++)
      text += `---\napiVersion: v1\nkind: ConfigMap\nmetadata: {name: c${k}}\ndata: {k: v}\n`;
    fs.writeFileSync(path.join(dir, "big", "cms.yaml"), text);
    return { units: n * 2000, bytes: text.length };
  },
  // one Deployment with n references to Secrets no source defines: units are edges, each with a
  // stub node and an unresolved item.
  edges(dir, n) {
    fs.mkdirSync(path.join(dir, "apps"));
    fs.mkdirSync(path.join(dir, "w"));
    fs.writeFileSync(path.join(dir, "apps", "a.yaml"), app("a", "w"));
    const env = [];
    for (let k = 0; k < n; k++) env.push(`          - {name: E${k}, valueFrom: {secretKeyRef: {name: s${k}, key: k}}}`);
    const text = `apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: d}\nspec:\n  template:\n    spec:\n      containers:\n        - name: c\n          env:\n${env.join("\n")}\n`;
    fs.writeFileSync(path.join(dir, "w", "d.yaml"), text);
    return { units: n, bytes: text.length };
  },
  // n files of about 1,000,000 bytes: a flow sequence of short distinct strings (the densest
  // values per byte YAML allows that are not refused): units are file bytes.
  "files-flow"(dir, n) {
    fs.mkdirSync(path.join(dir, "apps"));
    fs.mkdirSync(path.join(dir, "data"));
    fs.mkdirSync(path.join(dir, "empty"));
    fs.writeFileSync(path.join(dir, "apps", "a.yaml"), app("a", "empty"));
    const items = [];
    for (let k = 0, len = 0; len < 1_000_000; k++) {
      const s = k.toString(36);
      items.push(s);
      len += s.length + 1;
    }
    const text = `[${items.join(",")}]\n`;
    for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, "data", `f${i}.yaml`), text);
    return { units: n * text.length, bytes: n * text.length };
  },
  // n files of 1,000,000 bytes of data that no source renders: units are file bytes.
  files(dir, n) {
    fs.mkdirSync(path.join(dir, "apps"));
    fs.mkdirSync(path.join(dir, "data"));
    fs.mkdirSync(path.join(dir, "empty"));
    fs.writeFileSync(path.join(dir, "apps", "a.yaml"), app("a", "empty"));
    let line = "";
    const lines = [];
    for (let k = 0; line.length < 1_000_000; k++) {
      lines.push(`k${k}: value-${k}`);
      if (lines.length % 1000 === 0) line = lines.join("\n");
    }
    const text = `${lines.join("\n")}\n`;
    for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, "data", `f${i}.yaml`), text);
    return { units: n * text.length, bytes: n * text.length };
  },
};

/** @type {Record<string, number[]>} */
const SIZES = { objects: [100, 200], edges: [50_000, 100_000], files: [50, 100], "files-flow": [50, 100] };
const only = process.argv.slice(2);

/** @param {string} dir */
function runChild(dir) {
  const out = execFileSync(
    process.execPath,
    ["--max-old-space-size=8192", "--input-type=module", "-e", CHILD, dir, URL_SELF],
    {
      encoding: "utf8",
      maxBuffer: 1 << 20,
    },
  );
  return JSON.parse(out);
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-measure-run-"));
try {
  const fixture = fileURLToPath(new URL("../test/fixtures/thin-slice/repo", import.meta.url));
  const baseline = runChild(fixture);
  console.log(`baseline (thin-slice fixture): peak ${baseline.maxRss} bytes`);
  for (const [name, make] of Object.entries(SHAPES)) {
    if (only.length > 0 && !only.includes(name)) continue;
    const runs = (SIZES[name] ?? []).map((n) => {
      const dir = fs.mkdtempSync(path.join(base, `${name}-`));
      const made = make(dir, n);
      const r = runChild(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(
        `${name} n=${n}: units ${made.units}, input bytes ${made.bytes}, nodes ${r.nodes}, edges ${r.edges}, output ${r.out} chars, peak ${r.maxRss} bytes`,
      );
      return { ...made, ...r };
    });
    const [a, b] = /** @type {[any, any]} */ (runs);
    const rate = (b.maxRss - a.maxRss) / (b.units - a.units);
    console.log(`${name}: ${rate.toFixed(1)} bytes per unit (peak difference over unit difference)`);
    if (name === "edges") {
      const perRefBytes = (b.bytes - a.bytes) / (b.units - a.units);
      console.log(`edges: ${perRefBytes.toFixed(1)} input bytes per reference`);
    }
  }
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
