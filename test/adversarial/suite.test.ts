// The adversarial suite's index is checked against the tests it names (US11.5): every failure class
// has an expected outcome and at least one test; every reference names a test file, a describe
// title and a test title exactly as the file writes them, and vitest itself (its result for those
// files, review m2) must report that test as passed; the README lists every class. A renamed,
// deleted, skipped or commented-out test makes this fail, so the one place stays true.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUITE } from "./suite.js";
import { type FileResult, referenceStatus, titlePattern, vitestResults } from "./vitest-results.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const quoted = (src: string, title: string) =>
  src.includes(`"${title}"`) || src.includes(`'${title}'`) || src.includes(`\`${title}\``);

describe("the adversarial suite index (US11.5)", () => {
  it("names each class once, with an outcome and at least one test", () => {
    expect(new Set(SUITE.map((c) => c.id)).size).toBe(SUITE.length);
    for (const c of SUITE) {
      expect(c.outcome.length, c.id).toBeGreaterThan(0);
      expect(c.refs.length, c.id).toBeGreaterThan(0);
    }
  });
  for (const c of SUITE)
    it(`${c.id}: every reference matches a test as written`, () => {
      for (const r of c.refs) {
        const file = path.join(ROOT, r.file);
        expect(fs.existsSync(file), r.file).toBe(true);
        const src = fs.readFileSync(file, "utf8");
        expect(quoted(src, r.describe), `${r.file}: describe ${JSON.stringify(r.describe)}`).toBe(true);
        expect(quoted(src, r.it), `${r.file}: it ${JSON.stringify(r.it)}`).toBe(true);
      }
    });
  it("has every referenced test reported passed by vitest itself (never skipped, todo or missing)", () => {
    const files = [...new Set(SUITE.flatMap((c) => c.refs.map((r) => r.file)))].sort();
    const results = vitestResults(ROOT, files);
    const bad = SUITE.flatMap((c) =>
      c.refs.flatMap((r) => {
        const s = referenceStatus(results, r);
        return s.ok ? [] : [`${c.id}: ${r.file}: ${JSON.stringify(r.it)} -> ${s.statuses.join(",") || "no such test"}`];
      }),
    );
    expect(bad).toEqual([]);
  }, 900_000);
  it("would fail on a skipped, todo or missing referenced test (the vitest check can fail)", () => {
    const ref = { file: "test/x.test.ts", describe: "group", it: "case %s" };
    const at = (status: string, title = "case one", ancestors = ["group"]): FileResult[] => [
      { name: "test/x.test.ts", assertionResults: [{ ancestorTitles: ancestors, title, status }] },
    ];
    expect(referenceStatus(at("passed"), ref)).toEqual({ ok: true, statuses: ["passed"] });
    expect(referenceStatus(at("skipped"), ref).ok).toBe(false);
    expect(referenceStatus(at("todo"), ref).ok).toBe(false);
    expect(referenceStatus(at("passed", "other"), ref)).toEqual({ ok: false, statuses: [] });
    expect(referenceStatus(at("passed", "case one", ["elsewhere"]), ref).ok).toBe(false);
    expect(referenceStatus([], ref).ok).toBe(false);
    expect(titlePattern(`names \${name} as %s`).test("names a bomb as x")).toBe(true);
    expect(titlePattern("a.b").test("axb")).toBe(false);
  });
  it("would catch a reference to a test that does not exist (the check can fail)", () => {
    const src = fs.readFileSync(path.join(ROOT, "test", "adversarial", "gaps.test.ts"), "utf8");
    expect(quoted(src, "a test nobody wrote")).toBe(false);
  });
  it("is mapped in the README, class by class", () => {
    const readme = fs.readFileSync(path.join(ROOT, "test", "adversarial", "README.md"), "utf8");
    for (const c of SUITE) expect(readme, c.id).toContain(`\`${c.id}\``);
  });
});
