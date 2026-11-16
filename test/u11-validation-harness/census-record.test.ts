import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { againstOneThird, LABEL, NOT_SEEN, UNIT } from "../../scripts/census-lib.mjs";
import { ESTATES } from "../../scripts/census.mjs";

const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

interface EstateRow {
  url: string;
  sha: string;
  total: number;
  opaque: number;
  fraction: number | null;
  byReason: Record<string, number>;
  againstOneThird: string;
  atLeast: boolean;
  generatorsCountedOnce: number;
  unreadableFiles: Record<string, number>;
}

describe("the committed census record (C11, BR11.1 to BR11.3, BR11.18)", () => {
  const json = JSON.parse(read("docs/census-2026-11-15-static.json")) as {
    label: string;
    notSeen: string[];
    unit: string;
    estates: EstateRow[];
    total: { total: number; opaque: number; fraction: number | null; againstOneThird: string; atLeast: boolean };
  };
  const doc = read("docs/census.md");
  const results = doc.slice(doc.indexOf("## 3. Results"), doc.indexOf("## 4."));

  it("is labelled a static estimate, names what it cannot see, and never calls itself an upper bound in its results", () => {
    expect(json.label).toBe(LABEL);
    expect(json.label).toBe("static-estimate");
    expect(json.notSeen).toEqual([...NOT_SEEN]);
    expect(json.unit).toBe(UNIT);
    expect(JSON.stringify(json)).not.toContain("at most");
    expect(results).not.toMatch(/at most one third/);
    expect(results).toContain("static estimate until B9 re-runs it with real discovery");
    expect(results).toContain("It is not an upper bound.");
    expect(results.replace("It is not an upper bound.", "")).not.toMatch(/upper bound/i);
  });

  it("covers exactly the five OD-26 estates at their recorded commits, as the census record lists them", () => {
    expect(json.estates.map((e) => [e.url, e.sha])).toEqual(ESTATES.map((e) => [e.url, e.sha]));
    for (const e of ESTATES) expect(doc).toContain(`| ${e.url} | ${e.sha} |`);
  });

  it("adds up: per-estate reasons sum to opaque, estates sum to the total, fractions match", () => {
    for (const e of json.estates) {
      expect(Object.values(e.byReason).reduce((a, b) => a + b, 0)).toBe(e.opaque);
      expect(e.fraction).toBe(e.total === 0 ? null : Math.round((e.opaque / e.total) * 10000) / 10000);
      expect(e.againstOneThird).toBe(againstOneThird(e.opaque, e.total, e.atLeast));
    }
    expect(json.total.total).toBe(json.estates.reduce((a, e) => a + e.total, 0));
    expect(json.total.opaque).toBe(json.estates.reduce((a, e) => a + e.opaque, 0));
    expect(json.total.atLeast).toBe(json.estates.some((e) => e.atLeast));
  });

  it("marks a floor wherever a generator was counted once or a file was unreadable", () => {
    for (const e of json.estates) {
      const hidden = e.generatorsCountedOnce > 0 || Object.values(e.unreadableFiles).some((n) => n > 0);
      expect(e.atLeast, e.url).toBe(hidden);
      if (hidden) expect(e.againstOneThird, e.url).toMatch(/not established/);
    }
  });

  it("holds only URLs, commits, counts, crankpath's reason names and its own fixed wording", () => {
    const allowed = new Set([
      "unsupported-template",
      "cluster-inputs-missing",
      "unsupported-field",
      "unreadable-repo",
      "private-chart",
      "remote-base",
      "encrypted-values",
      "cluster-created-values",
      "unreadable-file",
    ]);
    for (const e of json.estates) for (const k of Object.keys(e.byReason)) expect(allowed.has(k)).toBe(true);
    const fixed = new Set<string>([
      LABEL,
      UNIT,
      "1/3",
      ...NOT_SEEN,
      "nothing counted",
      "over one third",
      "not established",
      "over one third of the counted units; not established for the estate",
    ]);
    const strings: string[] = [];
    JSON.stringify(json, (_k, v) => {
      if (typeof v === "string") strings.push(v);
      return v;
    });
    for (const s of strings) {
      expect(/^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+|[0-9a-f]{40})$/.test(s) || fixed.has(s), s).toBe(true);
    }
  });

  it("states each estate's figure in the results table as the JSON has it, and puts 'at least' before the total", () => {
    for (const e of json.estates) {
      const row = results.split("\n").find((l) => l.startsWith(`| ${e.url.replace("https://github.com/", "")} |`));
      expect(row, e.url).toBeDefined();
      expect(row).toContain(`| ${e.opaque} of ${e.total} |`);
      expect(row).toContain(`| ${e.againstOneThird} |`);
      if (e.atLeast) expect(row).toContain("at least");
    }
    const headline = `${json.total.opaque} of ${json.total.total} counted units`;
    const at = results.indexOf(headline);
    expect(at).toBeGreaterThan(0);
    if (json.total.atLeast) expect(results.slice(at - "at least ".length, at)).toBe("at least ");
  });
});
