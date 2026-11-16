import { describe, expect, it } from "vitest";
import { compareCodePoints, compareTuples, sortedUnique } from "../../src/u1-graph-model/order.js";

describe("code-point order (C1 Ordering)", () => {
  it("sorts an astral character after every BMP character, unlike UTF-16 order", () => {
    const astral = "\u{1f600}";
    const highBmp = "￮";
    // UTF-16 code units put the astral character (a surrogate pair, 0xd83d...) before U+FFEE.
    expect([highBmp, astral].sort()).toEqual([astral, highBmp]);
    expect([highBmp, astral].sort(compareCodePoints)).toEqual([highBmp, astral]);
    expect(compareCodePoints(astral, "a")).toBe(1);
    expect(compareCodePoints("a", astral)).toBe(-1);
  });
  it("orders prefixes first and equal strings as equal", () => {
    expect(compareCodePoints("ab", "abc")).toBe(-1);
    expect(compareCodePoints("abc", "ab")).toBe(1);
    expect(compareCodePoints("x", "x")).toBe(0);
    expect(compareCodePoints("B", "a")).toBe(-1);
  });
  it("compares tuples field by field and dedupes", () => {
    expect(compareTuples(["a", "b"], ["a", "c"])).toBeLessThan(0);
    expect(compareTuples(["a"], ["a", "b"])).toBeLessThan(0);
    expect(sortedUnique(["b", "a", "b"])).toEqual(["a", "b"]);
  });
});
