#!/usr/bin/env node
// Measures what the reader limits are derived from and what they cost (dev-only; docs/limits.md
// quotes its output). Run `npm run build` first: every measurement uses the built BoundedReader,
// each in its own child process so each line reports that child's own peak resident memory.
//
//   node scripts/measure-limits.mjs [--part1 | --part3]
//
// 1. memory per lexeme: 39 shapes of about 3 MB with the node, lexeme and depth limits lifted
//    (several documents, comments and whitespace included), and the resident cost of a byte of
//    text; the most bytes per lexeme, the text cost and the baseline are the basis of lexemesPerFile;
// 2. depth capacity: the deepest nesting the yaml package composes, per shape, with V8's
//    interpreter only (--jitless) and half of the default stack already in use; the smallest is
//    the basis of nestingDepth;
// 3. cost at the limits: for each shape, the largest file the derived limits accept (and one just
//    over), each child run with the derived heap (--max-old-space-size), so a shape that needed
//    more would crash here;
// 4. the yaml package's own guards that BoundedReader does not use.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const readerUrl = pathToFileURL(path.join(root, "dist", "u2-intake-config", "bounded-reader.js")).href;

/**
 * @param {string} code @param {string[]} [flags]
 * @returns {any}
 */
function child(code, flags = []) {
  const out = execFileSync(process.execPath, [...flags, "--input-type=module", "-e", code], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(out.trim().split("\n").at(-1) ?? "null");
}

const LIFTED = `const lift = (l, v) => ({ ...l, value: v });
  const L = { ...READER_LIMITS, expandedNodesPerDocument: lift(READER_LIMITS.expandedNodesPerDocument, 1e12),
    lexemesPerFile: lift(READER_LIMITS.lexemesPerFile, 1e12), nestingDepth: lift(READER_LIMITS.nestingDepth, 10000) };`;

const ONLY_PART3 = process.argv.includes("--part3");

/** @type {Record<string, string>} generators of about N bytes */
const LEXEME_SHAPES = {
  "anchored block items": 'return "- &a x\\n".repeat(Math.floor(N/7));',
  "anchored and tagged block items": 'return "- &a !!str x\\n".repeat(Math.floor(N/13));',
  "tagged block items": 'return "- !!str x\\n".repeat(Math.floor(N/10));',
  "block items": 'return "- x\\n".repeat(Math.floor(N/4));',
  "flow numbers": 'return "[" + "1,".repeat(Math.floor(N/2)) + "1]";',
  "flow tagged numbers": 'return "[" + "!!int 1,".repeat(Math.floor(N/8)) + "1]";',
  "flow anchored numbers": 'return "[" + "&a 1,".repeat(Math.floor(N/5)) + "1]";',
  "aliases in a flow sequence": 'return "a: &a [1]\\nb: [" + "*a,".repeat(Math.floor(N/3)) + "1]\\n";',
  "block keys":
    'const a=[]; let n=0; for(let i=0;n<N;i++){const l="k"+i.toString(36)+": 1\\n";a.push(l);n+=l.length;} return a.join("");',
  "explicit keys":
    'const a=[]; let n=0; for(let i=0;n<N;i++){const l="? k"+i.toString(36)+"\\n: 1\\n";a.push(l);n+=l.length;} return a.join("");',
  "quoted strings": 'return "[" + "\\"a\\",".repeat(Math.floor(N/4)) + "1]";',
  "empty flow maps": 'return "[" + "{},".repeat(Math.floor(N/3)) + "1]";',
  "empty flow sequences": 'return "[" + "[],".repeat(Math.floor(N/3)) + "1]";',
  "null values in a flow map":
    'const a=["{"]; let n=0; for(let i=0;n<N;i++){const l="k"+i.toString(36)+":,";a.push(l);n+=l.length;} a.push("z: 1}"); return a.join("");',
  "three documents of empty flow maps":
    'const d = "---\\n[" + "{},".repeat(Math.floor(N/9)) + "1]\\n"; return d + d + d;',
  "three documents of empty flow sequences":
    'const d = "---\\n[" + "[],".repeat(Math.floor(N/9)) + "1]\\n"; return d + d + d;',
  "comment lines": 'return "a: 1\\n" + "#\\n".repeat(Math.floor(N/2));',
  "comments in a flow sequence": 'return "[1,\\n" + "#\\n".repeat(Math.floor(N/2)) + "1]\\n";',
  "newlines in a flow sequence": 'return "[1" + "\\n".repeat(N) + "]\\n";',
  "newline and space in a flow sequence": 'return "[1" + "\\n ".repeat(Math.floor(N/2)) + "]\\n";',
  "blank lines in a block mapping": 'return "a: 1\\n" + "\\n".repeat(N) + "b: 2\\n";',
  "comments between block items": 'return "- 1\\n#\\n".repeat(Math.floor(N/6));',
  "empty flow maps and newlines":
    'return "[" + "{},".repeat(Math.floor(N/6)) + "\\n".repeat(Math.floor(N/2)) + "1]\\n";',
  // nested collections: more nodes per lexeme (shapes the third review found or added for it)
  "nested empty flow sequences, four deep": 'return "[" + "[[[[]]]],".repeat(Math.floor(N/9)) + "1]";',
  "nested empty flow sequences, two deep": 'return "[" + "[[]],".repeat(Math.floor(N/5)) + "1]";',
  "flow sequences of one number": 'return "[" + "[1],".repeat(Math.floor(N/4)) + "1]";',
  "flow sequences of an empty map": 'return "[" + "[{}],".repeat(Math.floor(N/5)) + "1]";',
  "flow maps of an empty sequence": 'return "[" + "{a: []},".repeat(Math.floor(N/8)) + "1]";',
  "flow sequences of an alias": 'return "a: &a x\\nb: [" + "[*a],".repeat(Math.floor(N/5)) + "1]\\n";',
  "flow maps of an alias": 'return "a: &a x\\nb: [" + "{k: *a},".repeat(Math.floor(N/8)) + "1]\\n";',
  "merge keys": 'return "a: &a {x: 1}\\nb: [" + "{<<: *a},".repeat(Math.floor(N/9)) + "1]\\n";',
  "aliases of a map": 'return "a: &a {x: 1}\\nb: [" + "*a,".repeat(Math.floor(N/3)) + "1]\\n";',
  "flow key-value pairs":
    'return "{" + Array.from({length: Math.floor(N/7)}, (_, i) => "k" + i.toString(36) + ": 1,").join("") + "z: 1}";',
  "empty strings": "return '[' + \"'',\".repeat(Math.floor(N/3)) + '1]';",
  "flow sequences of an alias, ten deep":
    'const u = "[".repeat(10) + "*a" + "]".repeat(10) + ","; return "a: &a x\\nb: [" + u.repeat(Math.floor(N/u.length)) + "1]\\n";',
  "flow sequences of an alias, 280 deep":
    'const u = "[".repeat(280) + "*a" + "]".repeat(280) + ","; return "a: &a x\\nb: [" + u.repeat(Math.floor(N/u.length)) + "1]\\n";',
  "nested empty flow sequences, 280 deep":
    'const u = "[".repeat(280) + "]".repeat(280) + ","; return "[" + u.repeat(Math.floor(N/u.length)) + "1]";',
  // invalid YAML still costs memory until the parser refuses it
  "runs of commas (not valid YAML)": 'return "[" + ",".repeat(N) + "1]";',
  "nested flow maps with commas (not valid YAML)":
    'const u = "{".repeat(10) + "}".repeat(10) + ","; return "[" + u.repeat(Math.floor(N/u.length)) + "1]";',
};

console.log(`node ${process.version}, ${process.platform} ${process.arch}`);
if (!ONLY_PART3) {
  console.log(
    `1. memory per lexeme (${Object.keys(LEXEME_SHAPES).length} shapes, about 3 MB each, node, lexeme and depth limits lifted; every lexeme counted):`,
  );
  let worst = 0;
  let worstBase = 0;
  for (const [name, body] of Object.entries(LEXEME_SHAPES)) {
    const r = child(`
    import { parseYamlBounded, READER_LIMITS } from ${JSON.stringify(readerUrl)};
    import { Lexer } from "yaml";
    ${LIFTED}
    const before = process.resourceUsage().maxRSS;
    const N = 3_000_000; const text = (() => { ${body} })();
    let lexemes = 0;
    for (const _ of new Lexer().lex(text)) lexemes++;
    const base = process.resourceUsage().maxRSS;
    const r = parseYamlBounded(text, L);
    const peak = process.resourceUsage().maxRSS;
    console.log(JSON.stringify({ lexemes, outcome: r.ok ? "ok" : r.refusal, beforeKiB: before, baseKiB: base, peakKiB: peak }));`);
    const perLexeme = Math.round(((r.peakKiB - r.baseKiB) * 1024) / r.lexemes);
    worst = Math.max(worst, perLexeme);
    worstBase = Math.max(worstBase, Math.ceil(r.beforeKiB / 1024));
    console.log(
      `  ${name}: ${r.lexemes} lexemes, ${r.outcome}, before the text ${Math.round(r.beforeKiB / 1024)} MiB, with it ${Math.round(r.baseKiB / 1024)} MiB, peak ${Math.round(r.peakKiB / 1024)} MiB, ${perLexeme} bytes per lexeme`,
    );
  }
  const perByte = child(`
  import { parseYamlBounded, READER_LIMITS } from ${JSON.stringify(readerUrl)};
  const before = process.resourceUsage().maxRSS;
  const N = READER_LIMITS.fileBytes.value;
  const text = "a: " + "x".repeat(N - 4) + "\\n";
  const r = parseYamlBounded(text);
  const peak = process.resourceUsage().maxRSS;
  console.log(JSON.stringify({ ok: r.ok, bytes: text.length, perByte: ((peak - before) * 1024) / text.length }));`);
  console.log(
    `  text cost: one scalar of ${perByte.bytes} bytes, ${perByte.ok ? "ok" : "refused"}, ${perByte.perByte.toFixed(2)} resident bytes per byte of text`,
  );
  console.log(`  most bytes per lexeme: ${worst}; largest baseline before the text: ${worstBase} MiB`);
  if (process.argv.includes("--part1")) process.exit(0);

  console.log("2. depth capacity (--jitless, half the default stack in use; nesting levels composed):");
  /** @type {Record<string, string>} */
  const NESTING = {
    "flow sequences": '(n) => "[".repeat(n) + "]".repeat(n)',
    "flow mappings": '(n) => "{a: ".repeat(n) + "1" + "}".repeat(n)',
    "tagged flow sequences": '(n) => "!!seq [".repeat(n) + "]".repeat(n)',
    "anchored flow sequences": '(n) => Array.from({ length: n }, (_, i) => "&a" + i + " [").join("") + "]".repeat(n)',
    "block mappings": '(n) => Array.from({ length: n }, (_, i) => " ".repeat(i) + "a:\\n").join("")',
    "block sequences": '(n) => Array.from({ length: n }, (_, i) => " ".repeat(2 * i) + "-\\n").join("")',
    "compact block sequences": '(n) => "- ".repeat(n) + "x\\n"',
    "alternating flow mappings and sequences":
      '(n) => Array.from({ length: n }, (_, i) => (i % 2 ? "[" : "{a: ")).join("") + "1" + Array.from({ length: n }, (_, i) => ((n - 1 - i) % 2 ? "]" : "}")).join("")',
  };
  let minDepth = Number.POSITIVE_INFINITY;
  for (const [name, gen] of Object.entries(NESTING)) {
    const r = child(
      `
    import { parseYamlBounded, READER_LIMITS } from ${JSON.stringify(readerUrl)};
    ${LIFTED}
    const gen = ${gen};
    let frames = 0; const probe = () => { frames++; probe(); }; try { probe(); } catch {}
    const at = (k, f) => (k === 0 ? f() : at(k - 1, f));
    const reserve = Math.floor(frames / 2);
    const ok = (n) => { try { return at(reserve, () => parseYamlBounded(gen(n), L).ok); } catch { return false; } };
    let lo = 1, hi = 4000;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ok(m)) lo = m; else hi = m - 1; }
    console.log(JSON.stringify({ frames, reserve, capacity: lo }));`,
      ["--jitless"],
    );
    minDepth = Math.min(minDepth, r.capacity);
    console.log(`  ${name}: ${r.capacity} (stack ${r.frames} probe frames, ${r.reserve} in use)`);
  }
  console.log(`  smallest: ${minDepth}`);
}

// The derived heap: V8 12.4's default old generation on the smallest GitHub-hosted runner (5 GB).
const heapMiB = Math.floor(2_500_000_000 / 1024 / 1024);
console.log(
  `3. cost at the limits (child heap --max-old-space-size=${heapMiB}; each file is the largest the limits accept, or one unit over):`,
);
// Each shape: a unit repeated inside documents. The child sizes the file to the largest one the
// derived limits accept: units per document under the node limit, the whole file under fileBytes
// and lexemesPerFile (lexemes per unit measured on a sample). "over" adds units past the lexeme limit.
/** @type {Record<string, { pre: string, unit: string, post: string, nodes: number, over?: boolean }>} */
const ACCEPTED = {
  "empty flow maps, several documents": { pre: "---\n[", unit: "{},", post: "1]\n", nodes: 1 },
  "empty flow sequences, several documents": { pre: "---\n[", unit: "[],", post: "1]\n", nodes: 1 },
  "flow numbers, several documents": { pre: "---\n[", unit: "1,", post: "1]\n", nodes: 1 },
  "quoted strings, several documents": { pre: "---\n[", unit: '"a",', post: "1]\n", nodes: 1 },
  "aliases, several documents": { pre: "---\na: &a [1]\nb: [", unit: "*a,", post: "1]\n", nodes: 2 },
  "anchored block items, several documents": { pre: "---\n", unit: "- &a x\n", post: "", nodes: 1 },
  "tagged block items, several documents": { pre: "---\n", unit: "- !!str x\n", post: "", nodes: 1 },
  "comment lines": { pre: "a: 1\n", unit: "#\n", post: "", nodes: 0 },
  "newlines in a flow sequence": { pre: "[1", unit: "\n", post: "]\n", nodes: 0 },
  "newline and space in a flow sequence": { pre: "[1", unit: "\n ", post: "]\n", nodes: 0 },
  "comments between block items": { pre: "", unit: "- 1\n#\n", post: "", nodes: 1 },
  "nested empty flow sequences, four deep": { pre: "---\n[", unit: "[[[[]]]],", post: "1]\n", nodes: 4 },
  "nested empty flow sequences, two deep": { pre: "---\n[", unit: "[[]],", post: "1]\n", nodes: 2 },
  "flow sequences of an empty map": { pre: "---\n[", unit: "[{}],", post: "1]\n", nodes: 2 },
  "flow maps of an alias": { pre: "---\na: &a x\nb: [", unit: "{k: *a},", post: "1]\n", nodes: 3 },
  "a run of commas (not valid YAML)": { pre: "[", unit: ",", post: "1]", nodes: 0 },
  "minimal object documents": {
    pre: "",
    unit: "---\napiVersion: v1\nkind: X\nmetadata:\n name: a\n",
    post: "",
    nodes: 0,
  },
  "newlines in a flow sequence, one unit over": { pre: "[1", unit: "\n", post: "]\n", nodes: 0, over: true },
};
for (const [name, shape] of Object.entries(ACCEPTED)) {
  const r = child(
    `
    import { parseYamlBounded, READER_LIMITS } from ${JSON.stringify(readerUrl)};
    import { Lexer } from "yaml";
    const s = ${JSON.stringify(shape)};
    const count = (t) => { let n = 0; for (const _ of new Lexer().lex(t)) n++; return n; };
    const sample = 1000;
    const perUnit = (count(s.pre + s.unit.repeat(sample) + s.post) - count(s.pre + s.post)) / sample;
    const perDoc = count(s.pre + s.post) + 1;
    const N = READER_LIMITS.fileBytes.value;
    const maxLex = READER_LIMITS.lexemesPerFile.value;
    const maxNodes = READER_LIMITS.expandedNodesPerDocument.value;
    const unitsPerDoc = s.nodes === 0 ? Infinity : Math.floor((maxNodes - 16) / s.nodes);
    let total = Math.floor((N - 1024) / s.unit.length);
    total = Math.min(total, Math.floor((maxLex - 4096) / perUnit));
    if (s.over) total = Math.ceil((maxLex + 10) / perUnit);
    const docs = Math.max(1, Math.ceil(total / Math.min(unitsPerDoc, total)));
    const each = Math.ceil(total / docs);
    const parts = [];
    for (let d = 0; d < docs; d++) parts.push(s.pre + s.unit.repeat(each) + s.post);
    const text = parts.join("");
    const lexemes = count(text);
    const t0 = performance.now();
    const r = parseYamlBounded(text);
    const ms = Math.round(performance.now() - t0);
    const outcome = r.ok ? "ok, " + r.documents.length + " documents" : r.refusal + (r.detail ? " (" + r.detail + ")" : "");
    console.log(JSON.stringify({ bytes: text.length, lexemes, ms, outcome, maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024) }));`,
    [`--max-old-space-size=${heapMiB}`],
  );
  console.log(`  ${name}: ${r.bytes} bytes, ${r.lexemes} lexemes, ${r.ms} ms, ${r.outcome}, peak RSS ${r.maxRssMB} MB`);
}

if (ONLY_PART3) process.exit(0);

// 4. The yaml package's own behaviour that BoundedReader works around (same date, same machine).
const { Composer, Parser } = await import("yaml");

/** @param {string} text @param {Record<string, unknown>} options */
function compose(text, options) {
  return [...new Composer({ version: "1.1", logLevel: "silent", ...options }).compose(new Parser().parse(text))];
}

console.log("4. yaml package duplicate-key check (uniqueKeys on), distinct block keys:");
for (const n of [10000, 20000, 40000]) {
  const text = Array.from({ length: n }, (_, i) => `k${i}: 1\n`).join("");
  const t0 = performance.now();
  compose(text, { uniqueKeys: true });
  const on = Math.round(performance.now() - t0);
  const t1 = performance.now();
  compose(text, { uniqueKeys: false });
  console.log(`  ${n} keys: ${on} ms with the check, ${Math.round(performance.now() - t1)} ms without`);
}

console.log("   yaml package conversion of nested collection keys ({? {? ... x}}):");
for (const n of [100, 200, 300]) {
  const text = `${"{? ".repeat(n)}x${"}".repeat(n)}`;
  const t0 = performance.now();
  compose(text, {})[0]?.toJS({ maxAliasCount: -1 });
  console.log(`  ${n} levels: ${Math.round(performance.now() - t0)} ms`);
}
