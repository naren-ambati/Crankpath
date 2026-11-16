import fs from "node:fs";
import { describe, expect, it } from "vitest";
import * as limitsModule from "../../src/u1-graph-model/limits.js";
import { LIMITS, type LimitSet, limitValue, MINIMAL_OBJECT_DOCUMENT } from "../../src/u1-graph-model/limits.js";
import { withValue } from "../support/limits.js";

const entries = Object.entries(LIMITS) as [keyof LimitSet, LimitSet[keyof LimitSet]][];

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
    expect(LIMITS.explainElementaryCycles).toMatchObject({ status: "notYetDerived", derivedIn: "B6 step 0" });
    expect(LIMITS.generatedApplicationsPerApplicationSet).toMatchObject({
      status: "notYetDerived",
      derivedIn: "B3 step 0",
    });
    expect(LIMITS.filesPerScan).toMatchObject({ status: "notYetDerived", derivedIn: "B3 step 0" });
  });

  it("exports no way to forge a derived limit (withValue lives in test/support)", () => {
    expect(Object.keys(limitsModule).sort()).toEqual(["LIMITS", "MINIMAL_OBJECT_DOCUMENT", "limitValue"]);
  });

  it("lists the render-dependent limits as not yet derived (B2 step 0), not as done", () => {
    for (const name of ["renderWallClock", "renderStdoutBytes", "renderStderrBytes", "renderedObjects"] as const) {
      expect(LIMITS[name].status).toBe("notYetDerived");
      expect(LIMITS[name].derivedIn).toBe("B2 step 0");
    }
  });

  it("makes a not-yet-derived limit unusable as a number (type and runtime)", () => {
    // @ts-expect-error a not-yet-derived limit has no value
    const v: number | undefined = LIMITS.renderWallClock.value;
    expect(v).toBeUndefined();
    // @ts-expect-error limitValue takes derived limits only
    expect(() => limitValue(LIMITS.renderedObjects)).toThrow(/not-yet-derived/);
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
