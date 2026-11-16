#!/usr/bin/env node
// Measures real renders and what the derived render limits cost (dev-only; docs/limits.md quotes
// its output). `npm run build` first. Two parts:
//
// 1. First real renders (OD-7): each chart directory given is rendered with the installed helm
//    through crankpath's own CommandRunner (allowlist, environment, caps), as releases named on
//    the command line, five times each; the line gives the wall time (min, median, max), the bytes
//    of standard output and standard error, and the objects parsed from the output. Charts are
//    read from wherever they were fetched (outside the repository); only their names and versions
//    are printed.
// 2. Cost at the limits: synthetic render outputs at `renderStdoutBytes`, parsed and built by the
//    built rendered-output parser and rendered-set builder, each in its own child process, so each
//    line reports that parse's wall time and the child's peak resident memory.
//
//   node scripts/measure-renders.mjs <chart-dir>[=<release>,<release>] ...

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");
const url = (/** @type {string} */ p) => pathToFileURL(path.join(dist, p)).href;
const { buildChildEnv, createCommandRunner } = await import(url("u4-render-engine/command-runner.js"));
const { findTool, detectToolchain } = await import(url("u4-render-engine/toolchain.js"));
const { parseRenderedOutput } = await import(url("u4-render-engine/rendered-output.js"));
const { LIMITS } = await import(url("u1-graph-model/limits.js"));

const toolPath = process.env.PATH ?? "";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-measure-"));
const homes = {
  home: path.join(scratch, "home"),
  tmp: path.join(scratch, "tmp"),
  helmConfig: path.join(scratch, "helm", "config"),
  helmCache: path.join(scratch, "helm", "cache"),
  helmData: path.join(scratch, "helm", "data"),
  empty: path.join(scratch, "empty"),
};
for (const d of Object.values(homes)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
const runner = createCommandRunner({
  binaries: { helm: findTool("helm", toolPath), kustomize: findTool("kustomize", toolPath) },
  env: buildChildEnv(homes),
});
const toolchain = detectToolchain(runner, scratch);
console.log(
  `node ${process.version}, ${process.platform} ${process.arch}, helm ${toolchain.helm.version}, kustomize ${toolchain.kustomize.version}`,
);

/** @param {number[]} xs */
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log("first real renders (helm template --include-crds, 5 runs each):");
for (const arg of process.argv.slice(2)) {
  const [dir = "", releases = "release"] = arg.split("=");
  const chartYaml = fs.readFileSync(path.join(dir, "Chart.yaml"), "utf8");
  const name = /^name:\s*(\S+)/m.exec(chartYaml)?.[1];
  const version = /^version:\s*(\S+)/m.exec(chartYaml)?.[1];
  for (const release of releases.split(",")) {
    const times = [];
    let last;
    for (let i = 0; i < 5; i++) {
      last = runner.run({
        tool: "helm",
        subcommand: ["template"],
        args: ["--namespace", "default", "--include-crds", "--", release, path.resolve(dir)],
        cwd: scratch,
      });
      times.push(last.durationMs);
    }
    const parsed = parseRenderedOutput(last.stdout, "render:measure");
    const objects = parsed.ok
      ? parsed.documents.filter((/** @type {{ value: unknown }} */ d) => d.value !== null).length
      : `refused (${parsed.problem})`;
    console.log(
      `  ${name} ${version} as ${release}: ${last.outcome}, ${Math.min(...times)}/${median(times)}/${Math.max(...times)} ms, stdout ${last.stdoutBytes} bytes, stderr ${last.stderrBytes} bytes, ${objects} objects`,
    );
  }
}
fs.rmSync(scratch, { recursive: true, force: true });

/** @type {Record<string, string>} each generator builds an output of about N bytes */
const SHAPES = {
  "minimal objects (over the object limit)":
    'const u = "---\\napiVersion: v1\\nkind: ConfigMap\\nmetadata:\\n  name: a\\n"; return u.repeat(Math.floor(N / u.length));',
  "objects of one long string each (3 MiB documents)":
    'const D = LIMITS.renderedDocumentBytes.value - 200; const u = "---\\napiVersion: v1\\nkind: ConfigMap\\nmetadata:\\n  name: a\\ndata:\\n  v: " + "x".repeat(D) + "\\n"; return u.repeat(Math.floor(N / u.length));',
  "flow sequences of numbers (3 MiB documents, nodes at the limit)":
    'const D = LIMITS.renderedDocumentBytes.value - 200; const u = "---\\napiVersion: v1\\nkind: ConfigMap\\nmetadata:\\n  name: a\\nx: [" + "1,".repeat(Math.floor(D / 2)) + "1]\\n"; return u.repeat(Math.floor(N / u.length));',
  "small mappings in a block sequence (3 MiB documents)":
    'const D = LIMITS.renderedDocumentBytes.value - 200; const u = "---\\napiVersion: v1\\nkind: ConfigMap\\nmetadata:\\n  name: a\\nx:\\n" + "- {a: 1}\\n".repeat(Math.floor(D / 10)); return u.repeat(Math.floor(N / u.length));',
  "one document of the whole output (over the document limit)": 'return "a: " + "x".repeat(N - 4) + "\\n";',
};

/** @param {string} body */
function child(body) {
  return `
    import { parseRenderedOutput } from ${JSON.stringify(url("u4-render-engine/rendered-output.js"))};
    import { buildObjects } from ${JSON.stringify(url("u4-render-engine/rendered-set-builder.js"))};
    import { LIMITS } from ${JSON.stringify(url("u1-graph-model/limits.js"))};
    const N = LIMITS.renderStdoutBytes.value;
    const buf = Buffer.from((() => { ${body} })(), "utf8");
    const t0 = performance.now();
    const r = parseRenderedOutput(buf, "render:measure");
    let outcome;
    if (!r.ok) outcome = "refused (" + r.problem + ")";
    else {
      const built = buildObjects(r.documents, { renderJob: "measure", defaultNamespace: "default", destination: "in-cluster" });
      outcome = built.objects.length + " objects built, " + r.refused.length + " documents refused";
    }
    const ms = Math.round(performance.now() - t0);
    console.log(JSON.stringify({ bytes: buf.length, ms, outcome, maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024) }));
  `;
}

console.log(
  `cost at the limits (synthetic outputs of at most renderStdoutBytes = ${LIMITS.renderStdoutBytes.value} bytes):`,
);
for (const [name, body] of Object.entries(SHAPES)) {
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", child(body)], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    const r = JSON.parse(out.trim());
    console.log(`  ${name}: ${r.bytes} bytes, ${r.ms} ms, ${r.outcome}, peak RSS ${r.maxRssMB} MB`);
  } catch (e) {
    console.log(
      `  ${name}: the child failed (${/** @type {{status?: number}} */ (e).status ?? "signal"}): a crash at this shape`,
    );
  }
}
