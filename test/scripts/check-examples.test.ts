// check-examples (scripts/check-examples.mjs): the repository's examples are all pinned and shown,
// and each rule fails on a copy of examples/ and docs/examples.md broken on purpose.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkExamples } from "../../scripts/check-examples.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function copy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-check-examples-"));
  dirs.push(root);
  fs.cpSync(path.join(ROOT, "examples"), path.join(root, "examples"), { recursive: true, verbatimSymlinks: true });
  fs.mkdirSync(path.join(root, "docs"));
  fs.copyFileSync(path.join(ROOT, "docs", "examples.md"), path.join(root, "docs", "examples.md"));
  const run = () =>
    checkExamples({
      examplesDir: path.join(root, "examples"),
      docFile: path.join(root, "docs", "examples.md"),
      root,
    }).problems;
  return { root, run };
}

describe("check-examples", () => {
  it("passes the repository's examples and docs/examples.md", () => {
    const r = checkExamples();
    expect(r.problems).toEqual([]);
    expect(r.examples).toBe(10);
    expect(r.quotes).toBeGreaterThan(10);
  });

  it("passes an untouched copy, then fails each break by name", () => {
    const { root, run } = copy();
    expect(run()).toEqual([]);
    const doc = path.join(root, "docs", "examples.md");
    const text = fs.readFileSync(doc, "utf8");
    fs.writeFileSync(doc, text.replace("Run status: ANALYSED WITH GAPS", "Run status: ANALYSED"));
    expect(run().some((p) => p.startsWith("quote docs/examples.md:") && p.includes("is not the pinned output"))).toBe(
      true,
    );
    fs.writeFileSync(doc, text.replace("example-output: plan/text", "example-output: plan/nope"));
    expect(run()).toContain(
      `quote docs/examples.md:${text.split("\n").findIndex((l) => l.includes("example-output: plan/text")) + 1} names plan/nope, which is not a pinned run`,
    );
    fs.writeFileSync(doc, `${text}\nSee examples/missing-dir.\n`);
    expect(run()).toContain("bad-path docs/examples.md names examples/missing-dir");
    fs.writeFileSync(doc, text);
    fs.rmSync(path.join(root, "examples", "plan", "expected", "json.stdout"));
    expect(run()).toContain("not-pinned plan/json");
    fs.writeFileSync(path.join(root, "examples", "plan", "expected", "old.stdout"), "");
    expect(run()).toContain("stale-pin examples/plan/expected/old.stdout");
    fs.mkdirSync(path.join(root, "examples", "extra"));
    expect(run()).toContain("directory examples/extra is not in expected.json");
  });
});
