// The 80-column layout and the colour decoration (C8, FR8.2, FR8.6, FR8.7, BR8.6, NFR14): a line
// breaks only where a continuation starts with crankpath's own words; colour only marks words that
// are already there, never inside repo text, and is off unless a terminal, no NO_COLOR, no
// --no-color.

import { describe, expect, it } from "vitest";
import { quote } from "../../src/u1-graph-model/safe-text.js";
import {
  colourLine,
  stripColour,
  TEXT_WIDTH,
  useColour,
  wrapLine,
  wrapLines,
} from "../../src/u8-output/text-layout.js";
import { unwrapLines } from "../helpers/text.js";

const T = "terminal";

describe("wrapLine", () => {
  it("keeps a line of 80 columns or fewer as it is", () => {
    const line = `a${" b".repeat(39)}c`;
    expect(line.length).toBe(80);
    expect(wrapLine(line)).toEqual([line]);
  });
  it("wraps a long statement at spaces with a hanging indent of four", () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const out = wrapLine(`  ${words}`);
    expect(out.length).toBeGreaterThan(1);
    for (const l of out) expect(l.length).toBeLessThanOrEqual(TEXT_WIDTH);
    for (const l of out.slice(1)) expect(l.startsWith("      w")).toBe(true);
    expect(out.join(" ").replace(/ +/g, " ").trim()).toBe(words);
  });
  it("never breaks inside a quoted value, right after a label ending in a colon, or right before a quote", () => {
    const value = quote("name:", "a b c d e f g h i j k l m n o p q r s t u v w x y z ".repeat(3), T);
    const line = `  skipped 1 of 1  reason: invalid-name  kind: "ConfigMap"  ${value}  file: "x y.yaml"`;
    const out = wrapLine(line);
    for (const l of out) {
      expect(l.trimStart().startsWith('"'), l).toBe(false);
      expect((l.match(/(?<!\\)"/g) ?? []).length % 2, l).toBe(0);
    }
    expect(out.some((l) => l.trimStart().startsWith("name: "))).toBe(true);
    expect(out.some((l) => l.endsWith("name:") || l.endsWith("kind:") || l.endsWith("file:"))).toBe(false);
  });
  it("does not break right after a label ending in a colon even where that break would fit", () => {
    const head = "a".repeat(72);
    // the break after `reason:` would end the first line at column 80; the bare value would start the next
    expect(wrapLine(`${head} reason: invalid-name`)).toEqual([head, "    reason: invalid-name"]);
  });
  it("keeps a single label and value longer than the width whole, never cut", () => {
    const value = quote("value:", "x".repeat(200), T);
    const out = wrapLine(`    field: "f"  ${value}  (not found)`);
    expect(out).toEqual(['    field: "f"', `        ${value}`, "        (not found)"]);
  });
  it("leaves a line with no break point as it is", () => {
    const line = `x${"y".repeat(100)}`;
    expect(wrapLine(line)).toEqual([line]);
  });
  it("counts code points, so an astral character in a quoted value counts once", () => {
    const line = `a ${quote("v:", "\u{1f600}".repeat(70), T)} z`;
    expect([...line].length).toBeLessThan(80);
    expect(wrapLine(line)).toEqual([line]);
  });
  it("can be undone: continuation lines are indented four deeper than their statement", () => {
    const logical = [
      "Plan (an order, not a schedule): no steps, because no node is startable and the long reason goes on and on.",
      "  Assumed, not verified by crankpath: 0 externals declared available; 0 externals served by an in-estate node.",
      "    a child line that is long enough to wrap around the eighty column limit at least once here",
      "",
      "short",
    ];
    expect(unwrapLines(wrapLines(logical).join("\n"))).toEqual(logical);
  });
});

describe("colour (decoration only)", () => {
  it("colours crankpath's own result words and nothing inside a quoted value", () => {
    const line = `Run status: ANALYSED WITH GAPS  ${quote("name:", "ANALYSED blocked UNRESOLVED", T)}  blocked`;
    const coloured = colourLine(line);
    expect(coloured).toContain("\x1b[1m\x1b[33mANALYSED WITH GAPS\x1b[0m");
    expect(coloured).toContain('name: "ANALYSED blocked UNRESOLVED"');
    expect(coloured.endsWith("\x1b[31mblocked\x1b[0m")).toBe(true);
    expect(stripColour(coloured)).toBe(line);
  });
  it("never colours a word inside another word", () => {
    expect(colourLine("unblocked ANALYSEDX x-blocked")).toBe("unblocked ANALYSEDX x-blocked");
  });
  it("is on only for a terminal with NO_COLOR unset or empty and no --no-color", () => {
    expect(useColour({ isTTY: true, noColorEnv: undefined, noColorFlag: false })).toBe(true);
    expect(useColour({ isTTY: true, noColorEnv: "", noColorFlag: false })).toBe(true);
    expect(useColour({ isTTY: true, noColorEnv: "1", noColorFlag: false })).toBe(false);
    expect(useColour({ isTTY: true, noColorEnv: undefined, noColorFlag: true })).toBe(false);
    expect(useColour({ isTTY: false, noColorEnv: undefined, noColorFlag: false })).toBe(false);
  });
});
