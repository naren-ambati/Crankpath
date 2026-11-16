import fs from "node:fs";
import { describe, expect, it } from "vitest";
import * as limitsModule from "../../src/u1-graph-model/limits.js";
import {
  type Limit,
  LIMITS,
  type LimitSet,
  limitValue,
  MINIMAL_OBJECT_DOCUMENT,
  type NotYetDerivedLimit,
} from "../../src/u1-graph-model/limits.js";
import { withValue } from "../support/limits.js";

const entries = Object.entries(LIMITS) as [keyof LimitSet, Limit][];

describe("LimitSet (OD-5)", () => {
  it("every limit is either derived with a basis and date, or not yet derived with the bolt that derives it", () => {
    for (const [name, limit] of entries) {
      expect(limit.protects.length, name).toBeGreaterThan(0);
      if (limit.status === "derived") {
        expect(Number.isInteger(limit.value) && limit.value > 0, name).toBe(true);
        expect(limit.basis.length, name).toBeGreaterThan(20);
        expect(limit.date, name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      } else {
        expect(limit.derivedIn, name).toMatch(/^B\d+ step 0$/);
        expect("value" in limit, name).toBe(false);
      }
    }
  });

  it("names the limits with no derivation yet, with the bolt that derives them (no picked constants)", () => {
    // B6 derived explainElementaryCycles; B3 derives its two below
    expect(
      (Object.values(LIMITS) as Limit[]).flatMap((l) => (l.status === "notYetDerived" ? [l.derivedIn] : [])),
    ).not.toContain("B3 step 0");
  });

  it("derives B3's limits from what they protect (B3 step 0)", () => {
    // the run's memory: every generated Application an object charged its rate and four strings
    expect(LIMITS.generatedApplicationsPerApplicationSet).toMatchObject({ status: "derived", unit: "applications" });
    expect(LIMITS.generatedApplicationsPerApplicationSet.value).toBe(Math.floor(2_448_619_776 / (6678 + 4 * 4665)));
    // the run's memory over the measured walked-file cost plus a PATH_MAX path in two-byte units
    expect(LIMITS.filesPerScan).toMatchObject({ status: "derived", unit: "files" });
    expect(LIMITS.filesPerScan.value).toBe(Math.floor(2_448_619_776 / (577 + 2 * 4096)));
    expect(LIMITS.generatorPatternSteps.value).toBe((3 * 1024 * 1024) / 2);
    expect(LIMITS.repoFetchWallClock.value).toBe(90_000);
    expect(LIMITS.gitOutputBytes.value).toBe(LIMITS.fileBytes.value);
    // B3 review fixes: the rendering work (M1) and the checkout size (m5), both from the run budget
    expect(LIMITS.generatorRenderSteps.value).toBe(Math.floor(2_448_619_776 / 2));
    expect(LIMITS.fetchedRepoBytes.value).toBe(Math.floor(2_448_619_776 / 33));
  });

  it("exports no way to forge a derived limit (withValue lives in test/support)", () => {
    expect(Object.keys(limitsModule).sort()).toEqual(["LIMITS", "MINIMAL_OBJECT_DOCUMENT", "limitValue"]);
  });

  it("derives the render-dependent limits at B2 step 0 from their stated bases (OD-5)", () => {
    expect(LIMITS.renderWallClock.value).toBe(90 * 1000);
    expect(LIMITS.renderStdoutBytes.value).toBe(100 * 1024 * 1024);
    expect(LIMITS.renderStderrBytes.value).toBe(LIMITS.renderStdoutBytes.value);
    expect(LIMITS.renderedObjects.basis).toContain("/ 24 bytes");
    expect(LIMITS.renderedObjects.basis).toContain("ResourceStatus is 39 bytes");
    expect(LIMITS.renderedObjects.value).toBe(Math.floor((1.5 * 1024 * 1024) / 24));
    expect(LIMITS.renderedObjects.value).toBeGreaterThan(Math.floor((1.5 * 1024 * 1024) / 39));
    expect(LIMITS.renderedDocumentBytes.value).toBe(3 * 1024 * 1024);
    for (const name of [
      "renderWallClock",
      "renderStdoutBytes",
      "renderStderrBytes",
      "renderedObjects",
      "renderedDocumentBytes",
    ] as const) {
      expect(LIMITS[name].status).toBe("derived");
    }
  });

  it("makes a not-yet-derived limit unusable as a number (type and runtime)", () => {
    // B3 derived the last two of the set; the type still forbids a pending limit's use as a number
    const pending: NotYetDerivedLimit<"files"> = Object.freeze({
      status: "notYetDerived",
      unit: "files",
      protects: "a test",
      derivedIn: "B9 step 0",
      why: "a test",
    });
    // @ts-expect-error a not-yet-derived limit has no value
    const v: number | undefined = pending.value;
    expect(v).toBeUndefined();
    // @ts-expect-error limitValue takes derived limits only
    expect(() => limitValue(pending)).toThrow(/not-yet-derived/);
    expect(limitValue(LIMITS.fileBytes)).toBe(10_000_000);
  });

  it("is frozen: no unit can change a limit at run time", () => {
    expect(Object.isFrozen(LIMITS)).toBe(true);
    for (const [, limit] of entries) expect(Object.isFrozen(limit)).toBe(true);
  });

  it("computes the derived values from their stated bases", () => {
    expect(MINIMAL_OBJECT_DOCUMENT.length).toBe(46);
    expect(LIMITS.documentsPerFile.value).toBe(Math.floor(10_000_000 / 46));
    expect(LIMITS.expandedNodesPerDocument.value).toBe((3 * 1024 * 1024) / 2);
    expect(LIMITS.quotedTextChars.value).toBe(63 + 1 + 63 + 1 + 253);
    expect(LIMITS.nestingDepth.value).toBe(287);
    expect(LIMITS.explainElementaryCycles.value).toBe(24 - 3);
    expect(LIMITS.lexemesPerFile.value).toBe(Math.floor((2_500_000_000 - 45 * 1024 * 1024 - 3 * 10_000_000) / 937));
  });

  it("withValue keeps unit and protection and records the test basis", () => {
    const l = withValue(LIMITS.fileBytes, 10, "test");
    expect(l).toMatchObject({ status: "derived", value: 10, unit: "bytes", basis: "test" });
    expect(LIMITS.fileBytes.value).toBe(10_000_000);
  });

  it("docs/limits.md names every limit with its value or its not-yet-derived bolt", () => {
    const doc = fs.readFileSync(new URL("../../docs/limits.md", import.meta.url), "utf8");
    for (const [name, limit] of entries) {
      const row = doc.split("\n").find((line) => line.startsWith(`| \`${name}\` |`));
      expect(row, name).toBeDefined();
      if (limit.status === "derived") expect(row, name).toContain(`| ${limit.value.toLocaleString("en-US")} |`);
      else expect(row, name).toContain(`not yet derived: ${limit.derivedIn}`);
    }
  });
});
