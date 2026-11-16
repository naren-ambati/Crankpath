#!/usr/bin/env node
// check-examples: the examples (examples/, docs/examples.md) are all there and all pinned, and the
// page shows what was pinned. Read-only and offline: it runs no example (the test
// test/examples/examples.test.ts runs each one with the built CLI in `npm run verify`); it is one
// of the release checks (scripts/release-checks.mjs).
//
// Usage: node scripts/check-examples.mjs
//
// Rules (each problem prints one line; any problem exits 1):
//   shape        examples/expected.json breaks its own shape (scripts/examples-lib.mjs shapeProblems)
//   directory    an example directory expected.json does not name, or an example with no directory
//   not-pinned   an offline run without examples/<example>/expected/<run>.stdout and .stderr
//   stale-pin    a pinned file of no run
//   not-shown    an example that docs/examples.md neither quotes nor names (`examples/<name>`)
//   bad-path     an `examples/...` path docs/examples.md names that does not exist
//   quote        a quote in docs/examples.md (a fence after an `example-output` marker) that names
//                no pinned run, or does not hold that run's pinned output byte for byte

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_FILE, docQuotes, EXAMPLES, loadExpected, quotedText, ROOT, shapeProblems } from "./examples-lib.mjs";

/**
 * @param {{ examplesDir?: string, docFile?: string, root?: string }} [options]
 * @returns {{ problems: string[], examples: number, runs: number, quotes: number }}
 */
export function checkExamples({ examplesDir = EXAMPLES, docFile = DOC_FILE, root = ROOT } = {}) {
  const problems = [];
  const expected = loadExpected(path.join(examplesDir, "expected.json"));
  for (const p of shapeProblems(expected)) problems.push(`shape ${p}`);
  const names = Object.keys(expected.examples).sort();
  const dirs = fs
    .readdirSync(examplesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const d of dirs) if (!names.includes(d)) problems.push(`directory examples/${d} is not in expected.json`);
  let runs = 0;
  for (const name of names) {
    const ex = /** @type {import("./examples-lib.mjs").Example} */ (expected.examples[name]);
    if (!dirs.includes(name)) problems.push(`directory examples/${name} does not exist`);
    const pinDir = path.join(examplesDir, name, "expected");
    const have = fs.existsSync(pinDir) ? fs.readdirSync(pinDir).sort() : [];
    const want = ex.lane === "offline" ? ex.runs.flatMap((r) => [`${r.name}.stderr`, `${r.name}.stdout`]) : [];
    for (const r of ex.runs) {
      runs += 1;
      if (ex.lane === "offline" && !(have.includes(`${r.name}.stdout`) && have.includes(`${r.name}.stderr`)))
        problems.push(`not-pinned ${name}/${r.name}`);
    }
    for (const f of have) if (!want.includes(f)) problems.push(`stale-pin examples/${name}/expected/${f}`);
  }
  const doc = fs.existsSync(docFile) ? fs.readFileSync(docFile, "utf8") : "";
  if (doc === "") problems.push("not-shown docs/examples.md is missing or empty");
  /** @type {ReturnType<typeof docQuotes>} */
  let quotes = [];
  try {
    quotes = docQuotes(doc);
  } catch (e) {
    problems.push(`quote ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const q of quotes) {
    const id = `${q.example}/${q.run}`;
    const want = expected.examples[q.example]?.runs.some((r) => r.name === q.run)
      ? quotedText(q.example, q.run, q.stream, q.key, examplesDir)
      : null;
    if (want === null) problems.push(`quote docs/examples.md:${q.line} names ${id}, which is not a pinned run`);
    else if (q.body !== want) problems.push(`quote docs/examples.md:${q.line} is not the pinned output of ${id}`);
  }
  for (const name of names)
    if (!quotes.some((q) => q.example === name) && !new RegExp(`examples/${name}(?![\\w-])`).test(doc))
      problems.push(`not-shown ${name}: docs/examples.md neither quotes nor names it`);
  for (const m of doc.matchAll(/(?<![\w./-])examples\/[A-Za-z0-9._/-]*[A-Za-z0-9_-]/g))
    if (!fs.existsSync(path.join(root, m[0]))) problems.push(`bad-path docs/examples.md names ${m[0]}`);
  return { problems, examples: names.length, runs, quotes: quotes.length };
}

function main() {
  const r = checkExamples();
  for (const p of r.problems) console.log(p);
  console.log(
    `check-examples: ${r.examples} examples, ${r.runs} runs, ${r.quotes} quotes in docs/examples.md, ${r.problems.length} problem(s)`,
  );
  process.exitCode = r.problems.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
