#!/usr/bin/env node
// The examples lane (docs/examples.md): runs every example of examples/expected.json with the built
// CLI (`npm run build` first) and checks each run against what is written down for it and against
// its pinned output. `npm run verify` runs the same checks as a test (test/examples/examples.test.ts).
//
//   node scripts/examples.mjs                  check every offline run; exit 1 on any failure
//   node scripts/examples.mjs --pin [ids]      write the pinned output of each run (or of the runs
//                                              named example/run) from a fresh run, only when the
//                                              run meets every written fact; a run that does not
//                                              is printed in full and nothing is written for it
//   node scripts/examples.mjs --doc            rewrite every quote in docs/examples.md (a fence
//                                              after an `example-output` marker) from the pinned
//                                              file it names, so no quoted output is typed by hand
//
// A run of the `live` lane needs helm or the network; none exists yet, and this script would list
// it as SKIPPED, never as passed.

import fs from "node:fs";
import {
  allRuns,
  CLI,
  checkRun,
  comparePinned,
  DOC_FILE,
  docQuotes,
  loadExpected,
  pinnedPaths,
  quotedText,
  runExample,
  shapeProblems,
} from "./examples-lib.mjs";

const argv = process.argv.slice(2);
if (argv[0] === "--doc") {
  const lines = fs.readFileSync(DOC_FILE, "utf8").split("\n");
  // from the last quote up, so earlier line numbers stay valid
  for (const q of docQuotes(lines.join("\n")).reverse()) {
    const text = quotedText(q.example, q.run, q.stream, q.key);
    if (text === null) throw new Error(`docs/examples.md:${q.line}: ${q.example}/${q.run} is not pinned`);
    lines.splice(q.open + 1, q.close - q.open - 1, ...text.replace(/\n$/, "").split("\n"));
  }
  fs.writeFileSync(DOC_FILE, lines.join("\n"));
  console.log("examples: docs/examples.md quotes rewritten from the pinned files");
  process.exit(0);
}
const pin = argv[0] === "--pin";
const only = pin ? argv.slice(1) : argv;
if (!fs.existsSync(CLI)) {
  console.error("examples: dist/u9-cli-package/cli.js is missing; run npm run build first");
  process.exit(1);
}
const expected = loadExpected();
const shape = shapeProblems(expected);
if (shape.length > 0) {
  for (const p of shape) console.error(`examples: expected.json: ${p}`);
  process.exit(1);
}
let failed = 0;
let skipped = 0;
let passed = 0;
for (const [name, ex, run] of allRuns(expected)) {
  const id = `${name}/${run.name}`;
  if (only.length > 0 && !only.includes(id) && !only.includes(name)) continue;
  if (ex.lane !== "offline") {
    skipped += 1;
    console.log(`SKIPPED  ${id}  (lane ${ex.lane}: needs helm or the network)`);
    continue;
  }
  const result = runExample(run);
  const facts = checkRun(run, result);
  if (pin) {
    if (facts.length > 0) {
      failed += 1;
      console.log(`NOT PINNED  ${id}: the run does not meet what is written down:`);
      for (const p of facts) console.log(`    ${p}`);
      console.log(`--- exit ${result.exit}; stdout:\n${result.stdout}--- stderr:\n${result.stderr}---`);
      continue;
    }
    const p = pinnedPaths(name, run.name);
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.stdout, result.stdout);
    fs.writeFileSync(p.stderr, result.stderr);
    console.log(`PINNED  ${id}  (exit ${result.exit}, ${result.stdout.length} + ${result.stderr.length} characters)`);
    continue;
  }
  const problems = [...facts, ...comparePinned(name, run, result)];
  if (problems.length === 0) {
    passed += 1;
    console.log(`PASS  ${id}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${id}`);
    for (const p of problems) console.log(`    ${p}`);
  }
}
if (!pin) console.log(`examples: ${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
