// B2 review M4: the parse of a render's output has its own memory budget over every document
// (lexemesPerRender, derived as lexemesPerFile is), so output within every per-document limit can
// no longer cost minutes and gigabytes: a hit is a counted `limit` with no object kept.

import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { OUTPUT_LIMITS, parseRenderedOutput } from "../../src/u4-render-engine/rendered-output.js";
import { withValue } from "../support/limits.js";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

const cm = (name: string) => `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${name}\ndata: {a: "1", b: "2"}\n`;

describe("the parse budget of one render (M4)", () => {
  it("is derived from the same heap, baseline and per-lexeme figures as lexemesPerFile, with the output's text reserve", () => {
    expect(LIMITS.lexemesPerRender.value).toBe(
      Math.floor((2_500_000_000 - 45 * 1024 * 1024 - 3 * 100 * 1024 * 1024) / 937),
    );
    expect(OUTPUT_LIMITS.lexemes).toBe(LIMITS.lexemesPerRender);
  });
  it("counts lexemes over every document: documents each far inside the per-file budget still hit the render's", () => {
    const one = parseRenderedOutput(Buffer.from(cm("a")), "r");
    expect(one.ok).toBe(true);
    const perDoc = one.ok ? one.lexemes : 0;
    expect(perDoc).toBeGreaterThan(10);
    const limits = { ...OUTPUT_LIMITS, lexemes: withValue(LIMITS.lexemesPerRender, perDoc * 3 + 5, "test") };
    const three = [cm("a"), cm("b"), cm("c")].join("---\n");
    expect(parseRenderedOutput(Buffer.from(three), "r", limits).ok).toBe(true);
    const four = [cm("a"), cm("b"), cm("c"), cm("d")].join("---\n");
    expect(parseRenderedOutput(Buffer.from(four), "r", limits)).toEqual({ ok: false, problem: "over-parse-budget" });
  });
  it("stops in seconds on output that once took minutes (node-dense documents within every per-document limit)", () => {
    const doc = `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: a\nx: [${"1,".repeat(1_400_000)}1]\n`;
    const out = Buffer.from(Array.from({ length: 4 }, () => doc).join("---\n"));
    const t0 = cpuStart();
    expect(parseRenderedOutput(out, "r")).toEqual({ ok: false, problem: "over-parse-budget" });
    expect(cpuSince(t0)).toBeLessThan(60_000);
  });
});
