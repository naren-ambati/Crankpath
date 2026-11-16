// Renders docs/images/transcripts/<id>.json (real captured output, see capture.mjs) into
// docs/images/<id>.png.
//
//   CRANKPATH_RENDER_TOOLS=<dir> node docs/images/render.mjs [id ...]
//
// <dir> is a folder outside the repository holding exactly playwright 1.65.0, marked 18.1.3 and
// mermaid 12.3.0 (`npm install --ignore-scripts --save-exact playwright@1.65.0 marked@18.1.3
// mermaid@12.3.0`, then `npx playwright install chromium`, a read-only download); this script
// refuses any other version. ImageMagick's `magick` must be on PATH. CRANKPATH_IMAGES_TRIAL=<dir>
// reads <dir>/transcripts and writes the PNGs to <dir> instead (a trial that leaves docs/images
// untouched).
//
// Nothing here edits the captured text. A terminal card shows each command, its output and its
// exit status as stored, and turns the colour codes crankpath writes (SGR 1, 31, 33 and 0,
// src/u8-output/text-layout.ts) into styled spans; any other escape is shown as <ESC>. The Action
// images show the stored job summary Markdown rendered as GitHub renders a job summary, with the
// step's annotations under it. The Mermaid image renders the stored Markdown with each ```mermaid
// block drawn by Mermaid itself in the page; a block Mermaid cannot parse stops the script, so the
// image also shows that crankpath's diagram parses. Each card is screenshotted with Playwright's
// headless Chromium and reduced with `magick in.png -colors 48 -dither None -strip PNG8:out.png`.
// After each image it records, in <dir>/manifest.json, the SHA-256 of the PNG it wrote and of the
// transcript it rendered (keys sorted), which scripts/check-images.mjs compares (release review m2).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { manifestEntry } from "../../scripts/check-images.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRIAL = process.env.CRANKPATH_IMAGES_TRIAL;
const OUT = TRIAL === undefined ? HERE : TRIAL;
const TR = path.join(OUT, "transcripts");
const TOOLS = process.env.CRANKPATH_RENDER_TOOLS;
export const PINNED = Object.freeze({ playwright: "1.65.0", marked: "18.1.3", mermaid: "12.3.0" });

/** The installed version of a package of the tools folder, refused unless it is the pinned one. */
function tool(/** @type {string} */ tools, /** @type {keyof typeof PINNED} */ name) {
  const dir = path.join(tools, "node_modules", name);
  const version = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  if (version !== PINNED[name]) throw new Error(`render: ${name} ${version} found, ${PINNED[name]} pinned`);
  return dir;
}

const esc = (/** @type {string} */ s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ESC = String.fromCharCode(27);
const SGR = /** @type {Record<string, string>} */ ({ 1: "bold", 31: "red", 33: "yellow" });

/** Escapes the text, then turns each `ESC[<n>m` into a styled span (0 closes every open one). */
export function ansi(/** @type {string} */ text) {
  let open = 0;
  const html = esc(text).replace(new RegExp(`${ESC}\\[(\\d+)m`, "g"), (all, n) => {
    if (n === "0") {
      const r = "</span>".repeat(open);
      open = 0;
      return r;
    }
    const cls = SGR[n];
    if (cls === undefined) return `&lt;ESC&gt;${all.slice(1)}`;
    open += 1;
    return `<span class="${cls}">`;
  });
  return `${html}${"</span>".repeat(open)}`.split(ESC).join("&lt;ESC&gt;");
}

const termCss = `
*{box-sizing:border-box}
body{margin:0;background:#ffffff;padding:20px;width:1060px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#1f2328}
.card{border:1px solid #d0d7de;border-radius:10px;background:#f6f8fa;overflow:hidden}
.bar{display:flex;justify-content:space-between;gap:16px;padding:8px 14px;background:#eaeef2;border-bottom:1px solid #d0d7de;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#57606a}
.bar b{color:#1f2328;font-weight:600}
.body{padding:14px 16px}
.cmd{font-size:13px;line-height:1.45;font-weight:700;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 6px}
.cmd .p{color:#0969da}
pre.out{margin:0 0 6px;font-size:12px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;color:#1f2328}
pre.out .bold{font-weight:700}pre.out .red{color:#cf222e;font-weight:700}pre.out .yellow{color:#9a6700;font-weight:700}
.meta{font:11px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#6e7781;margin:0 0 14px}
.meta .ok{color:#1a7f37;font-weight:600}.meta .warn{color:#9a6700;font-weight:600}
.body>*:last-child{margin-bottom:0}`;

function bar(/** @type {any} */ t, /** @type {string} */ right) {
  return `<div class="bar"><span><b>crankpath ${esc(t.version)}</b> · ${esc(t.title)}</span><span>${esc(right)}</span></div>`;
}

function terminal(/** @type {any} */ t) {
  const blocks = t.commands
    .map((/** @type {any} */ c) => {
      const cls = c.exit === 0 ? "ok" : "warn";
      return `<div class="cmd"><span class="p">$</span> ${esc(c.command)}</div><pre class="out">${ansi(c.output)}</pre><div class="meta"><span class="${cls}">exit ${c.exit}</span> · ${c.seconds} s</div>`;
    })
    .join("");
  return `<!doctype html><meta charset="utf-8"><style>${termCss}</style><div class="card" id="c">${bar(t, `captured ${t.capturedAt.slice(0, 10)}`)}<div class="body">${blocks}</div></div>`;
}

const mdCss = `
*{box-sizing:border-box}
body{margin:0;background:#fff;padding:20px;width:1060px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f2328}
.card{border:1px solid #d0d7de;border-radius:6px;overflow:hidden}
.bar{display:flex;justify-content:space-between;gap:16px;padding:8px 16px;background:#f6f8fa;border-bottom:1px solid #d0d7de;font-size:12px;color:#57606a}
.bar b{color:#1f2328;font-weight:600}
.md{padding:16px 24px 20px}
h1,h2{font-size:1.5em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em;margin:0 0 16px}h3{font-size:1.25em;margin:20px 0 12px}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:85%}
pre{background:#f6f8fa;border-radius:6px;padding:12px 16px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45}
:not(pre)>code{background:#818b981f;border-radius:6px;padding:.2em .4em}
pre.mermaid{background:#fff;border:1px solid #d1d9e0;text-align:center;font-family:inherit;font-size:14px}
p{margin:0 0 16px}
.ann{border-top:1px solid #d0d7de;padding:10px 24px 14px;background:#f6f8fa;font-size:12px;color:#57606a}
.ann pre{margin:6px 0 0;background:#fff;border:1px solid #d0d7de}`;

function summaryPage(/** @type {any} */ t, /** @type {(md: string) => string} */ md) {
  const c = t.commands[0];
  const notes = c.output
    .split("\n")
    .filter((/** @type {string} */ l) => /^\s*::(?:warning|error|notice)/.test(l))
    .map((/** @type {string} */ l) => l.trim())
    .join("\n");
  const ann =
    notes === ""
      ? `<div class="ann">Annotations printed by the step: none</div>`
      : `<div class="ann">Annotations printed by the step (workflow commands on its standard output)<pre>${esc(notes)}</pre></div>`;
  const exit = /\nexit status: (\d+)\n/.exec(c.output)?.[1] ?? "?";
  return `<!doctype html><meta charset="utf-8"><style>${mdCss}</style><div class="card" id="c"><div class="bar"><span><b>Job summary</b> · ${esc(t.title)} · step exit ${esc(exit)}</span><span>GITHUB_STEP_SUMMARY from scripts/action-local.mjs, captured ${t.capturedAt.slice(0, 10)}</span></div><div class="md">${md(t.summary)}</div>${ann}</div>`;
}

function mermaidPage(/** @type {any} */ t, /** @type {(md: string) => string} */ md) {
  const c = t.commands[0];
  // marked writes a ```mermaid fence as <pre><code class="language-mermaid">; Mermaid draws a <pre class="mermaid">
  const html = md(c.output).replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_all, body) => `<pre class="mermaid">${body}</pre>`,
  );
  return `<!doctype html><meta charset="utf-8"><style>${mdCss}</style><div class="card" id="c">${bar(t, `$ ${c.command}  (exit ${c.exit}), captured ${t.capturedAt.slice(0, 10)}`)}<div class="md">${html}</div></div>`;
}

async function main() {
  if (TOOLS === undefined) throw new Error("render: set CRANKPATH_RENDER_TOOLS to the tools folder (see the header)");
  const req = createRequire(path.join(TOOLS, "package.json"));
  const { chromium } = req(tool(TOOLS, "playwright"));
  tool(TOOLS, "marked");
  const { marked } = await import(pathToFileURL(req.resolve("marked")).href);
  const mermaidJs = path.join(tool(TOOLS, "mermaid"), "dist", "mermaid.min.js");
  const md = (/** @type {string} */ s) => /** @type {string} */ (marked.parse(s, { async: false }));
  const only = process.argv.slice(2);
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-shots-raw-"));
  /** @type {string[]} */
  const rendered = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1.5 });
    for (const f of fs
      .readdirSync(TR)
      .filter((x) => x.endsWith(".json") && !/-attempt\d+\.json$/.test(x))
      .sort()) {
      const t = JSON.parse(fs.readFileSync(path.join(TR, f), "utf8"));
      if (only.length > 0 && !only.includes(t.id)) continue;
      if (t.mermaid === true) {
        await page.setContent(mermaidPage(t, md));
        await page.addScriptTag({ path: mermaidJs });
        const result = await page.evaluate(async () => {
          const g = /** @type {any} */ (globalThis);
          const m = g.mermaid;
          m.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
          /** @type {any[]} */
          const blocks = [...g.document.querySelectorAll("pre.mermaid")];
          for (const b of blocks) await m.parse(b.textContent ?? "");
          await m.run({ nodes: blocks });
          return { blocks: blocks.length, drawn: blocks.filter((b) => b.querySelector("svg") !== null).length };
        });
        if (result.blocks === 0 || result.drawn !== result.blocks)
          throw new Error(`render: ${t.id}: Mermaid drew ${result.drawn} of ${result.blocks} diagrams`);
      } else await page.setContent(typeof t.summary === "string" ? summaryPage(t, md) : terminal(t));
      const shot = path.join(raw, `${t.id}.png`);
      await page.locator("#c").screenshot({ path: shot });
      const out = path.join(OUT, `${t.id}.png`);
      execFileSync("magick", [shot, "-colors", "48", "-dither", "None", "-strip", `PNG8:${out}`]);
      rendered.push(t.id);
      console.log(`rendered ${t.id} (${fs.statSync(out).size} bytes)`);
    }
  } finally {
    await browser.close();
    fs.rmSync(raw, { recursive: true, force: true });
  }
  const manifestFile = path.join(OUT, "manifest.json");
  /** @type {Record<string, { png: string, transcript: string }>} */
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {};
  for (const id of rendered) manifest[id] = manifestEntry(OUT, id);
  const sorted = Object.fromEntries(
    Object.keys(manifest)
      .sort()
      .map((k) => [k, manifest[k]]),
  );
  fs.writeFileSync(manifestFile, `${JSON.stringify(sorted, null, 2)}\n`);
  const total = fs
    .readdirSync(OUT)
    .filter((x) => x.endsWith(".png"))
    .reduce((n, x) => n + fs.statSync(path.join(OUT, x)).size, 0);
  console.log(`render: ${total} bytes of PNG in ${TRIAL === undefined ? "docs/images" : "the trial folder"}`);
}

const invoked = process.argv[1];
if (invoked !== undefined && path.resolve(invoked) === fileURLToPath(import.meta.url)) await main();
