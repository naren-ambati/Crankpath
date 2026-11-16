#!/usr/bin/env node
// check-docs: the documentation release check (US12.1, US12.2, BR12.1 to BR12.3, NFR3, NFR14, D11).
// Read-only and offline: it reads the Markdown files git lists (tracked, and untracked but not
// ignored), never the design workspace check-tree excludes, and never the third-party corpus copies
// under test/corpus/ (their text is upstream's, not crankpath's).
//
// Usage: node scripts/check-docs.mjs [--release] [--today YYYY-MM-DD]
//
// Scopes. "Checked" files are every listed Markdown file outside test/corpus/. "Reachable" files are
// the checked files outside test/, reviews/, BUILD-NOTES.md and CLAUDE.md (the working records and
// fixture notes; a fixture's expected Mermaid output is crankpath's output, not a diagram of the docs).
// "User docs" are the reachable files outside RECORD_PREFIXES (the design copies, the research, the
// dated lookups and the census record, which are records of sources and dated runs, not claims made in
// crankpath's voice; the census record has its own test, test/u11-validation-harness/census-record.test.ts).
//
// Rules (each problem prints `file:line rule message`; any problem exits 1):
//   broken-link      (checked files) a relative link or image whose target does not exist, leaves the
//                    root, points into the excluded design workspace, or whose #anchor is not a heading
//                    of the target Markdown file (GitHub's slug rules)
//   unreachable      (reachable files) not reachable from README.md by following relative Markdown
//                    links
//   mermaid-parse    (reachable files) a ```mermaid fence that does not parse structurally (see
//                    checkMermaidText)
//   mermaid-fallback (reachable files) a ```mermaid fence whose next non-blank line after the fence does
//                    not start `Text fallback:` with text after it
//   fence-kind       (user docs) every fence is one of: a code language (yaml, json, mermaid, ts, bash,
//                    ...), output (no info string, `text` or `crankpath-output`), `measurement` (the
//                    dated output of a measuring script, not a claim a test reproduces) or
//                    `illustration` (a drawing that is not output, which must hold no line crankpath
//                    prints); any other info string fails (review m2)
//   measurement-caption (user docs) a `measurement` fence whose caption does not name its command in a
//                    code span (or say the script is kept outside the repository) and give a date
//   output-caption   (user docs) an output fence (above; a code fence whose content is crankpath's
//                    output counts too) whose caption (the last non-blank line before the
//                    fence) does not name the command in a code span (crankpath, its cli.js, or a
//                    `node scripts/` harness that runs it) and say `run YYYY-MM-DD` with a
//                    real date that is not after today
//   claim-missing    (user docs other than the claim map itself) an output fence, or a prose unit holding a cycle id (`c-` and eight hex
//                    digits) or a count of the form `N of M <word>`, with no claim marker
//                    `<!-- claim CL-<n> -->` (for a fence: in its caption or the two lines above the caption; for
//                    prose: in the same paragraph, list item or table row; a count, not a cycle id,
//                    may carry `<!-- measured YYYY-MM-DD -->` instead: a dated observation of runs)
//   claim-map        (docs/claims.md) a marker with no row, a row no user doc marks, a row whose test
//                    file is not a test/**/*.test.ts file, whose test title is not a string in an
//                    `it(` or `test(` call of that file, or that is skipped, or whose run date is not a
//                    real date at or before today
//   readme-order     README.md's first `## ` heading must begin `Opacity`, and its second must name the
//                    homelab cycles (BR12.1)
//   forbidden-claim  (user docs, prose only: code spans and fences are not read) a word crankpath must
//                    not use about its own results: "no cycles", "GREEN", "certified", "guarantee",
//                    "all clear", "bulletproof" (NFR3), except right after a negation ("cannot guarantee"); to
//                    discuss the word itself, put it in a code span
//   doc-set          a document D11 requires is missing (BR12.2); without --release it is listed as
//                    pending, with --release it fails
//   pending-hook     a comment `<!-- pending: <what> -->` in a user doc marks text that waits for a real
//                    result; without --release it is listed, with --release it fails
//
// Mermaid: the docs' diagrams are checked by a structural parser written here (no Mermaid parser is
// small enough to pin, B6): the first line must be a supported diagram header; flowchart lines must
// each be a node, an edge chain, `subgraph`/`end`, `direction`, `classDef`/`class`/`style`/
// `linkStyle` or a `%%` comment; every diagram's brackets and quotes must balance on each line and
// every `subgraph` must be closed. It proves structure, not that Mermaid renders the diagram.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isExcluded, listFiles } from "./check-tree.mjs";

export const CORPUS_PREFIX = "test/corpus/";
export const UNREACHABLE_EXEMPT = Object.freeze(["test/", "reviews/", "BUILD-NOTES.md", "CLAUDE.md"]);
export const RECORD_PREFIXES = Object.freeze(["docs/design/", "docs/research.md", "docs/lookups.md", "docs/census.md"]);
/** The D11 document set (BR12.2); `docs/action.md` is the Action guide. */
export const DOC_SET = Object.freeze([
  "README.md",
  "docs/concepts.md",
  "docs/crankpath-yaml.md",
  "docs/write-your-cranks.md",
  "docs/action.md",
  "docs/limits.md",
  "docs/what-it-cannot-see.md",
  "docs/claims.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
]);
export const CLAIM_MAP = "docs/claims.md";

const CLAIM_MARKER = /<!--\s*claim\s+(CL-\d+)\s*-->/g;
// the hook text may hold `<` and `>` (`render:<path>`): it ends at the first `-->`
const PENDING = /<!--\s*pending:\s*(.*?)\s*-->/g;
const RUN_DATE = /\brun (\d{4})-(\d{2})-(\d{2})\b/;
// Lines only crankpath's own output starts with (text report, explain, JSON, Mermaid output).
const OUTPUT_LINE =
  /^\s*(?:crankpath \d+\.\d+\.\d+\b|Run status: |Opacity: \d|Cycles: |cycle c-[0-9a-f]{8}\b|Plan \(an order|Not startable from a cold start:|"schemaVersion": |toolchain: |scanned: repo )/m;
const CYCLE_ID = /(?<![\w-])c-[0-9a-f]{8}(?![\w-])/;
// a count of the form `N of M <word>` (an opacity count, a node count, a share of anything): a measured
// claim that needs a marker (review m5)
const OPACITY_COUNT = /\b\d[\d,]* of \d[\d,]* [A-Za-z]/;
/** Info strings of fences that hold code or input, not output (review m2). */
export const CODE_LANGS = Object.freeze([
  "yaml",
  "yml",
  "json",
  "mermaid",
  "ts",
  "typescript",
  "js",
  "javascript",
  "sh",
  "bash",
  "shell",
  "diff",
  "toml",
  "ini",
]);
const MEASURED_DATE = /\b(?:run|measured) (\d{4})-(\d{2})-(\d{2})\b/i;
const FORBIDDEN = [
  { word: "no cycles", re: /\bno cycles\b/i },
  { word: "GREEN", re: /\bGREEN\b/ },
  { word: "certified", re: /\bcertif(?:y|ied|ies)\b/i },
  { word: "guarantee", re: /\bguarantee[sd]?\b/i },
  { word: "all clear", re: /\ball[- ]clear\b/i },
  { word: "bulletproof", re: /\bbullet-?proof\b/i },
];
const MERMAID_TYPES = new Set([
  "flowchart",
  "graph",
  "sequenceDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "classDiagram",
]);

/** @param {string} rel */
export function isChecked(rel) {
  return rel.endsWith(".md") && !rel.startsWith(CORPUS_PREFIX) && !isExcluded(rel);
}
/** @param {string} rel */
export function mustBeReachable(rel) {
  return isChecked(rel) && !UNREACHABLE_EXEMPT.some((p) => rel === p || rel.startsWith(p));
}
/** @param {string} rel */
export function isUserDoc(rel) {
  return mustBeReachable(rel) && !RECORD_PREFIXES.some((p) => rel === p || rel.startsWith(p));
}

/**
 * Fenced blocks with the 1-based line of the opening fence, the info string, the body, the caption (the
 * last non-blank line before the fence), the caption with the two lines above it, and the first non-blank line
 * after.
 * @param {string} text
 */
export function fencedBlocks(text) {
  const lines = text.split("\n");
  /** @type {{ line: number, endLine: number, info: string, body: string, caption: string, above: string, after: string }[]} */
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i] ?? "");
    if (open === null) continue;
    const fence = open[1] ?? "```";
    let end = i + 1;
    while (end < lines.length) {
      const t = (lines[end] ?? "").trim();
      if (t.startsWith(fence.slice(0, 3)) && t.replace(/[`~]/g, "") === "" && t.length >= fence.length) break;
      end++;
    }
    let c = i - 1;
    while (c >= 0 && (lines[c] ?? "").trim() === "") c--;
    let a = end + 1;
    while (a < lines.length && (lines[a] ?? "").trim() === "") a++;
    out.push({
      line: i + 1,
      endLine: end + 1,
      info: (open[2] ?? "").trim(),
      body: lines.slice(i + 1, end).join("\n"),
      caption: c >= 0 ? (lines[c] ?? "") : "",
      above: c >= 0 ? lines.slice(Math.max(0, c - 2), c + 1).join("\n") : "",
      after: a < lines.length ? (lines[a] ?? "") : "",
    });
    i = end;
  }
  return out;
}

/** The lines with every fenced block blanked (line numbers kept). @param {string} text */
export function proseLines(text) {
  const lines = text.split("\n");
  for (const b of fencedBlocks(text)) for (let i = b.line - 1; i < b.endLine && i < lines.length; i++) lines[i] = "";
  return lines;
}

/** GitHub's heading anchor slug. @param {string} heading */
export function slug(heading) {
  return heading
    .replace(/<[^>]*>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** @param {string} text */
export function headings(text) {
  /** @type {{ level: number, text: string, line: number }[]} */
  const out = [];
  proseLines(text).forEach((line, i) => {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m !== null) out.push({ level: (m[1] ?? "").length, text: m[2] ?? "", line: i + 1 });
  });
  return out;
}

/** @param {string} text */
export function headingSlugs(text) {
  const seen = new Map();
  const out = new Set();
  for (const h of headings(text)) {
    const s = slug(h.text);
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    out.add(n === 0 ? s : `${s}-${n}`);
  }
  return out;
}

/** Relative link targets outside fences and code spans. @param {string} text */
export function linkTargets(text) {
  /** @type {{ line: number, target: string }[]} */
  const out = [];
  proseLines(text).forEach((raw, i) => {
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g))
      out.push({ line: i + 1, target: m[1] ?? "" });
    const ref = /^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/.exec(line);
    if (ref !== null) out.push({ line: i + 1, target: ref[1] ?? "" });
  });
  return out;
}

/**
 * Resolves a link target against the file it is in: `{ external: true }` for a URL, else the repository
 * path and anchor, or `{ error }`.
 * @param {string} file
 * @param {string} target
 * @returns {{ external: true } | { rel: string, anchor: string } | { error: string }}
 */
export function resolveLink(file, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return { external: true };
  const hash = target.indexOf("#");
  const pathPart = hash < 0 ? target : target.slice(0, hash);
  let anchor = "";
  let decoded = pathPart;
  try {
    anchor = hash < 0 ? "" : decodeURIComponent(target.slice(hash + 1));
    decoded = decodeURIComponent(pathPart);
  } catch {
    return { error: "is not a valid percent-encoded link" };
  }
  if (decoded === "") return { rel: file, anchor };
  const rel = path.posix.normalize(
    decoded.startsWith("/") ? decoded.slice(1) : path.posix.join(path.posix.dirname(file), decoded),
  );
  if (rel === ".." || rel.startsWith("../")) return { error: "leaves the repository" };
  return { rel: rel.replace(/\/$/, ""), anchor };
}

/**
 * The structural Mermaid check. Returns the problems (empty when the diagram parses).
 * @param {string} body
 */
export function checkMermaidText(body) {
  /** @type {string[]} */
  const problems = [];
  const lines = body.split("\n").map((l) => l.replace(/\s+$/, ""));
  const meaningful = lines
    .map((l, i) => ({ l: l.trim(), n: i + 1 }))
    .filter((x) => x.l !== "" && !x.l.startsWith("%%"));
  const first = meaningful[0];
  if (first === undefined) return ["the diagram is empty"];
  const head = first.l.split(/\s+/);
  const type = head[0] ?? "";
  if (!MERMAID_TYPES.has(type)) return [`line ${first.n}: "${type.slice(0, 40)}" is not a supported diagram type`];
  if ((type === "flowchart" || type === "graph") && !/^(?:TB|TD|BT|RL|LR)$/.test(head[1] ?? ""))
    problems.push(`line ${first.n}: a flowchart needs a direction (TB, TD, BT, RL or LR)`);
  let open = 0;
  for (const { l, n } of meaningful.slice(1)) {
    const balance = balanced(l);
    if (balance !== "") problems.push(`line ${n}: ${balance}`);
    if (type === "flowchart" || type === "graph") {
      if (/^subgraph\b/.test(l)) open++;
      else if (l === "end") {
        if (open === 0) problems.push(`line ${n}: "end" with no open subgraph`);
        else open--;
      } else if (!isFlowchartStatement(l)) problems.push(`line ${n}: not a flowchart statement: ${l.slice(0, 60)}`);
    }
  }
  if (open > 0) problems.push(`${open} subgraph(s) not closed with "end"`);
  return problems;
}

const NODE_ID = "[A-Za-z_][\\w-]*";
const SHAPE =
  "(?:\\[\\[[^\\]]*\\]\\]|\\[\\([^)]*\\)\\]|\\(\\([^)]*\\)\\)|\\[[^\\]]*\\]|\\([^)]*\\)|\\{\\{[^}]*\\}\\}|\\{[^}]*\\}|>[^\\]]*\\])";
const NODE = `${NODE_ID}(?:${SHAPE})?(?::::${NODE_ID})?`;
const ARROW = "(?:-->|---|-\\.->|-\\.-|==>|===|--o|--x|<-->)";
const EDGE_LABEL = "(?:\\|[^|]*\\||\\s--\\s[^-]+?\\s-->)";
const NODE_GROUP = `${NODE}(?:\\s*&\\s*${NODE})*`;
const FLOW_STATEMENT = new RegExp(`^${NODE_GROUP}(?:\\s*${ARROW}\\s*(?:${EDGE_LABEL}\\s*)?${NODE_GROUP})*\\s*;?$`);

/** @param {string} l */
function isFlowchartStatement(l) {
  if (/^direction\s+(?:TB|TD|BT|RL|LR)$/.test(l)) return true;
  if (/^(?:classDef|class|style|linkStyle)\s+\S/.test(l)) return true;
  return FLOW_STATEMENT.test(l);
}

/** "" when quotes and brackets balance on the line (quoted text is not counted), else why not. @param {string} l */
function balanced(l) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  /** @type {string[]} */
  const stack = [];
  let quoted = false;
  for (const ch of l) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== pairs[ch]) return `unbalanced "${ch}"`;
    }
  }
  if (quoted) return "an unclosed double quote";
  if (stack.length > 0) return `unclosed "${stack[stack.length - 1]}"`;
  return "";
}

/**
 * Whether the prose uses a forbidden word other than right after a negation ("cannot guarantee", "never
 * certified"): a negated use denies the claim instead of making it.
 * @param {string} prose
 * @param {RegExp} re
 */
export function forbiddenUse(prose, re) {
  const g = new RegExp(re.source, `${re.flags.replace("g", "")}g`);
  for (const m of prose.matchAll(g)) {
    const before = prose.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (!/\b(?:not|cannot|can't|never|nor|without)\s+(?:[\w-]+\s+){0,2}$/i.test(before)) return true;
  }
  return false;
}

/**
 * What a fence of a user doc is (review m2): `output` (an unlabelled or `text` fence, `crankpath-output`,
 * or a code fence whose content is crankpath output), `measurement`, `illustration`, `code`, or
 * `unknown` (an info string none of these).
 * @param {{ info: string, body: string }} b
 * @returns {"output" | "measurement" | "illustration" | "code" | "unknown"}
 */
export function fenceKind(b) {
  const info = b.info.split(/\s+/)[0] ?? "";
  if (info === "" || info === "text" || info === "crankpath-output") return "output";
  if (info === "measurement") return "measurement";
  if (info === "illustration") return "illustration";
  if (CODE_LANGS.includes(info)) return showsOutput(b) ? "output" : "code";
  return "unknown";
}

/** Whether a fence shows crankpath output. @param {{ info: string, body: string }} b */
export function showsOutput(b) {
  const info = b.info.split(/\s+/)[0] ?? "";
  if (info === "crankpath-output") return true;
  if (info === "mermaid") return /^%% crankpath\b/m.test(b.body);
  return OUTPUT_LINE.test(b.body);
}

/** @param {string} iso @param {string} today */
function dateProblem(iso, today) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return `${iso} is not a real date`;
  if (iso > today) return `${iso} is after today (${today})`;
  return "";
}

/**
 * Prose units (a paragraph, a list item or a table row) with the line each starts on; fences blanked.
 * @param {string} text
 */
export function proseUnits(text) {
  /** @type {{ line: number, text: string }[]} */
  const units = [];
  /** @type {{ line: number, text: string } | null} */
  let cur = null;
  const flush = () => {
    if (cur !== null) units.push(cur);
    cur = null;
  };
  proseLines(text).forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.trim() === "" || /^#{1,6}\s/.test(line)) {
      flush();
      return;
    }
    if (/^\s*\|/.test(line) || /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      cur = { line: i + 1, text: line.trim() };
      if (/^\s*\|/.test(line)) flush();
      return;
    }
    if (cur === null) cur = { line: i + 1, text: line.trim() };
    else cur.text += ` ${line.trim()}`;
  });
  flush();
  return units;
}

/**
 * The claim map rows of docs/claims.md: `| CL-n | where | claim | test file | test title | run date |`.
 * @param {string} text
 */
export function parseClaimMap(text) {
  /** @type {{ id: string, line: number, where: string, claim: string, file: string, title: string, run: string }[]} */
  const rows = [];
  proseLines(text).forEach((raw, i) => {
    const m = /^\|\s*(CL-\d+)\s*\|(.*)\|\s*$/.exec(raw.trim());
    if (m === null) return;
    const cells = (m[2] ?? "").split("|").map((c) => c.trim().replace(/^`|`$/g, ""));
    rows.push({
      id: m[1] ?? "",
      line: i + 1,
      where: cells[0] ?? "",
      claim: cells[1] ?? "",
      file: cells[2] ?? "",
      title: cells[3] ?? "",
      run: cells[4] ?? "",
    });
  });
  return rows;
}

/**
 * Whether `title` is the title of an active it()/test() call in the test source. Titles in the source may be
 * written in double quotes, single quotes or backticks; the claim map writes the title without quotes.
 * @param {string} source
 * @param {string} title
 * @returns {"ok" | "missing" | "skipped"}
 */
export function findTest(source, title) {
  if (title === "") return "missing";
  let found = "missing";
  for (const q of ['"', "'", "`"]) {
    const lit = `${q}${title}${q}`;
    let at = source.indexOf(lit);
    while (at >= 0) {
      const before = source.slice(Math.max(0, at - 40), at);
      const call = /\b(it|test)((?:\.\w+)*)\(\s*$/.exec(before);
      if (call !== null) {
        if (/\.(?:skip|todo|fails)\b/.test(call[2] ?? "")) found = found === "ok" ? "ok" : "skipped";
        else return "ok";
      }
      at = source.indexOf(lit, at + 1);
    }
  }
  return /** @type {"ok" | "missing" | "skipped"} */ (found);
}

/**
 * Runs every rule over the files of a tree.
 * @param {{ root: string, files?: string[], release?: boolean, today?: string }} options
 */
export function checkDocs({ root, files, release = false, today = new Date().toISOString().slice(0, 10) }) {
  const all = (files ?? listFiles(root)).filter((f) => !isExcluded(f) && !f.startsWith(CORPUS_PREFIX));
  const exists = new Set(all);
  const dirs = new Set();
  for (const f of all) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const checked = all.filter(isChecked).filter((f) => fs.existsSync(path.join(root, f)));
  /** @type {Map<string, string>} */
  const texts = new Map();
  const read = (/** @type {string} */ rel) => {
    let t = texts.get(rel);
    if (t === undefined) {
      t = fs.readFileSync(path.join(root, rel), "utf8");
      texts.set(rel, t);
    }
    return t;
  };
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const pending = [];
  /** @type {Map<string, string[]>} */
  const graph = new Map();
  /** @type {Map<string, string>} where each claim marker is (first use) */
  const markers = new Map();

  for (const f of checked) {
    const text = read(f);
    const out = [];
    for (const { line, target } of linkTargets(text)) {
      const r = resolveLink(f, target);
      if ("external" in r) continue;
      if ("error" in r) {
        problems.push(`${f}:${line} broken-link the link "${target}" ${r.error}`);
        continue;
      }
      if (isExcluded(r.rel) || isExcluded(`${r.rel}/`)) {
        problems.push(`${f}:${line} broken-link the link "${target}" points into a folder that is not shipped`);
        continue;
      }
      if (!exists.has(r.rel) && !dirs.has(r.rel) && !fs.existsSync(path.join(root, r.rel))) {
        problems.push(`${f}:${line} broken-link the link target "${target}" does not exist`);
        continue;
      }
      if (r.rel.endsWith(".md")) {
        out.push(r.rel);
        if (r.anchor !== "" && !headingSlugs(read(r.rel)).has(r.anchor.toLowerCase()))
          problems.push(`${f}:${line} broken-link the anchor "#${r.anchor}" is not a heading of ${r.rel}`);
      }
    }
    graph.set(f, out);
    if (!mustBeReachable(f)) continue;
    for (const b of fencedBlocks(text)) {
      if ((b.info.split(/\s+/)[0] ?? "") !== "mermaid") continue;
      for (const p of checkMermaidText(b.body)) problems.push(`${f}:${b.line} mermaid-parse ${p}`);
      if (!b.after.startsWith("Text fallback:") || b.after.slice("Text fallback:".length).trim() === "")
        problems.push(
          `${f}:${b.line} mermaid-fallback the diagram is not followed by a "Text fallback:" line with text`,
        );
    }
    if (!isUserDoc(f)) continue;

    text.split("\n").forEach((line, i) => {
      for (const m of line.replace(/`[^`]*`/g, "").matchAll(PENDING)) {
        pending.push(`${f}:${i + 1} ${m[1]}`);
        if (release) problems.push(`${f}:${i + 1} pending-hook a pending hook blocks a release: ${m[1]}`);
      }
      for (const m of line.matchAll(CLAIM_MARKER))
        if (!markers.has(m[1] ?? "")) markers.set(m[1] ?? "", `${f}:${i + 1}`);
    });
    for (const b of fencedBlocks(text)) {
      const kind = fenceKind(b);
      if (kind === "unknown") {
        problems.push(
          `${f}:${b.line} fence-kind the info string "${b.info.slice(0, 30)}" is not a code language, text (output), measurement or illustration`,
        );
        continue;
      }
      if (kind === "illustration") {
        if (OUTPUT_LINE.test(b.body))
          problems.push(
            `${f}:${b.line} fence-kind an illustration holds lines crankpath prints; quote output as output`,
          );
        continue;
      }
      if (kind === "measurement") {
        const cmdOrWhere =
          /`[^`]*(?:\b(?:crankpath|cli\.js)\b|node scripts\/)[^`]*`/.test(b.caption) ||
          /outside the repository/.test(b.caption);
        const date = MEASURED_DATE.exec(b.caption);
        if (!cmdOrWhere || date === null)
          problems.push(
            `${f}:${b.line} measurement-caption a measurement needs a caption naming its command in a code span (or saying the script is kept outside the repository) and "run YYYY-MM-DD"`,
          );
        else {
          const why = dateProblem(`${date[1]}-${date[2]}-${date[3]}`, today);
          if (why !== "") problems.push(`${f}:${b.line} measurement-caption the caption date ${why}`);
        }
        continue;
      }
      if (kind === "code") continue;
      const cmd = /`[^`]*(?:\b(?:crankpath|cli\.js)\b|node scripts\/)[^`]*`/.test(b.caption);
      const date = RUN_DATE.exec(b.caption);
      if (!cmd || date === null)
        problems.push(
          `${f}:${b.line} output-caption the output has no caption naming the command in a code span and "run YYYY-MM-DD"`,
        );
      else {
        const why = dateProblem(`${date[1]}-${date[2]}-${date[3]}`, today);
        if (why !== "") problems.push(`${f}:${b.line} output-caption the caption date ${why}`);
      }
      if (!/<!--\s*claim\s+CL-\d+\s*-->/.test(`${b.above}\n${b.caption}`))
        problems.push(`${f}:${b.line} claim-missing the output has no claim marker <!-- claim CL-<n> -->`);
    }
    const lines = text.split("\n");
    for (const u of proseUnits(text)) {
      const plain = u.text.replace(/`[^`]*`/g, " ");
      const claimish = f !== CLAIM_MAP && (CYCLE_ID.test(u.text) || OPACITY_COUNT.test(plain));
      // a dated measurement in prose (`<!-- measured YYYY-MM-DD -->`) is a record of runs, not a claim a test
      // reproduces: it is accepted in place of a claim marker for a count, never for a cycle id
      const measured = !CYCLE_ID.test(u.text) && /<!--\s*measured \d{4}-\d{2}-\d{2}\s*-->/.test(u.text);
      if (claimish && !measured && !/<!--\s*claim\s+CL-\d+\s*-->/.test(u.text)) {
        // a marker may also sit on the line right after a table row
        if (!/<!--\s*claim\s+CL-\d+\s*-->/.test(lines[u.line] ?? ""))
          problems.push(
            `${f}:${u.line} claim-missing a cycle id or opacity count with no claim marker in the same unit`,
          );
      }
      const prose = plain.replace(/<!--.*?-->/g, " ").replace(/\]\([^)]*\)/g, "]");
      for (const { word, re } of FORBIDDEN)
        if (forbiddenUse(prose, re))
          problems.push(`${f}:${u.line} forbidden-claim the word "${word}" in crankpath's own prose`);
    }
  }

  // reachability from README.md
  const seen = new Set();
  const queue = exists.has("README.md") ? ["README.md"] : [];
  while (queue.length > 0) {
    const f = /** @type {string} */ (queue.shift());
    if (seen.has(f)) continue;
    seen.add(f);
    for (const g of graph.get(f) ?? []) if (!seen.has(g)) queue.push(g);
  }
  for (const f of checked)
    if (mustBeReachable(f) && !seen.has(f))
      problems.push(`${f}:1 unreachable no chain of links from README.md reaches it`);

  // README order (BR12.1)
  if (exists.has("README.md")) {
    const h2 = headings(read("README.md")).filter((h) => h.level === 2);
    if (!/^opacity\b/i.test(h2[0]?.text ?? ""))
      problems.push(`README.md:${h2[0]?.line ?? 1} readme-order the first section must be the opacity statement`);
    if (!/homelab/i.test(h2[1]?.text ?? "") || !/cycle/i.test(h2[1]?.text ?? ""))
      problems.push(`README.md:${h2[1]?.line ?? 1} readme-order the second section must be the two homelab cycles`);
  }

  // the claim map
  const mapRows = exists.has(CLAIM_MAP) ? parseClaimMap(read(CLAIM_MAP)) : [];
  /** @type {Set<string>} */
  const rowIds = new Set();
  for (const r of mapRows) {
    const at = `${CLAIM_MAP}:${r.line}`;
    if (rowIds.has(r.id)) problems.push(`${at} claim-map ${r.id} has more than one row`);
    rowIds.add(r.id);
    if (!markers.has(r.id)) problems.push(`${at} claim-map ${r.id} is not marked in any user doc`);
    if (!/^test\/.+\.test\.ts$/.test(r.file) || !fs.existsSync(path.join(root, r.file)))
      problems.push(`${at} claim-map ${r.id} names "${r.file}", which is not a test file of this repository`);
    else {
      const found = findTest(fs.readFileSync(path.join(root, r.file), "utf8"), r.title);
      if (found === "missing")
        problems.push(`${at} claim-map ${r.id}: no it() or test() titled "${r.title.slice(0, 80)}" in ${r.file}`);
      if (found === "skipped") problems.push(`${at} claim-map ${r.id}: the test "${r.title.slice(0, 80)}" is skipped`);
    }
    const d = /^(\d{4}-\d{2}-\d{2})$/.exec(r.run);
    const why = d === null ? `"${r.run}" is not a date` : dateProblem(d[1] ?? "", today);
    if (why !== "") problems.push(`${at} claim-map ${r.id}: the last verified run ${why}`);
  }
  for (const [id, where] of markers)
    if (!rowIds.has(id)) problems.push(`${where} claim-map ${id} has no row in ${CLAIM_MAP}`);

  // the document set (BR12.2)
  for (const d of DOC_SET) {
    if (exists.has(d) && fs.existsSync(path.join(root, d))) continue;
    if (release) problems.push(`${d}:1 doc-set the document is missing (D11)`);
    else pending.push(`${d}:1 the document does not exist yet (D11; a release fails)`);
  }
  return {
    files: checked.length,
    userDocs: checked.filter(isUserDoc).length,
    claims: mapRows.length,
    problems,
    pending,
  };
}

function main() {
  const args = process.argv.slice(2);
  const release = args.includes("--release");
  const t = args.indexOf("--today");
  const today = t >= 0 ? args[t + 1] : undefined;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = checkDocs({ root, release, ...(today === undefined ? {} : { today }) });
  for (const p of r.pending) console.log(`pending  ${p}`);
  for (const p of r.problems) console.log(`FAIL  ${p}`);
  console.log(
    `check-docs: ${r.files} Markdown files (${r.userDocs} user docs), ${r.claims} claim(s) mapped, ${r.problems.length} problem(s), ${r.pending.length} pending${release ? " (release mode)" : ""}`,
  );
  process.exitCode = r.problems.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
