// Run by bounded-reader.test.ts in a child `node` (a main thread, with Node's default stack, as
// the CLI runs): calls the reader from every depth near the end of the stack and prints, as JSON,
// each call that threw after the reader was entered. "Entered" is read from the reader's own probe
// counter (a property, set by the reader's first guarded statement), so a stack overflow at the
// call site, before the reader runs, is not counted as the reader's.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRoot, parseYamlBounded, readerProbe, readYaml } from "../../src/u2-intake-config/bounded-reader.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-deep-"));
fs.writeFileSync(path.join(dir, "a.yaml"), "a: [1, [2, [3]]]\n");
const opened = openRoot(dir);
if (!opened.ok) throw new Error("root");
const root = opened.root;
const shallow = `${"[".repeat(50)}${"]".repeat(50)}`;
const deep = `${"[".repeat(280)}${"]".repeat(280)}`;
/** @param {number} k @param {() => unknown} call @returns {unknown} */
const at = (k, call) => (k > 0 ? at(k - 1, call) : call());
/** The deepest `at` recursion that still completes, measured now (frame sizes change as code warms). */
const capacity = () => {
  let max = 0;
  for (let lo = 1, hi = 1 << 20; lo <= hi; ) {
    const mid = (lo + hi) >> 1;
    try {
      at(mid, () => 0);
      max = mid;
      lo = mid + 1;
    } catch {
      hi = mid - 1;
    }
  }
  return max;
};
/** @type {[string, () => unknown][]} */
const calls = [
  ["parse 50", () => parseYamlBounded(shallow)],
  ["parse 280", () => parseYamlBounded(deep)],
  ["read", () => readYaml(root, "a.yaml")],
];
/** @type {string[]} */
const escaped = [];
let reached = 0;
for (const [name, call] of calls) {
  const max = capacity();
  for (let leave = 1; leave < 3000; leave += 1) {
    const before = readerProbe.entries;
    try {
      at(max - leave, call);
    } catch {
      if (readerProbe.entries !== before) escaped.push(`${name}, ${leave} frames left`);
    }
    if (readerProbe.entries !== before) reached += 1;
  }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ reached, escaped: escaped.slice(0, 5), escapedCount: escaped.length }));
