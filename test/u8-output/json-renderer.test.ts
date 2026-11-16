// The JSON contract's layout (C7, BR8.1, BR8.2): sorted keys at every level, two-space indentation,
// one trailing newline, repo text as escaped data, and every C7 section present.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE, run, THIN_SLICE_URL } from "../helpers/scan.js";

const out = run([path.join(FIXTURE, "repo"), "--repo-url", THIN_SLICE_URL, "--format", "json"], process.cwd()).stdout;

function keysSorted(v: unknown): boolean {
  if (Array.isArray(v)) return v.every(keysSorted);
  if (v === null || typeof v !== "object") return true;
  const keys = Object.keys(v);
  return keys.every((k, i) => i === 0 || (keys[i - 1] as string) < k) && Object.values(v).every(keysSorted);
}

describe("JSON layout (C7)", () => {
  it("has every C7 section, schemaVersion 1, sorted keys, 2-space indent and one trailing newline", () => {
    const r = JSON.parse(out);
    for (const k of [
      "schemaVersion",
      "repo",
      "toolchain",
      "runStatus",
      "nodes",
      "edges",
      "opaque",
      "cycles",
      "statuses",
      "externals",
      "plan",
      "unresolved",
    ]) {
      expect(Object.hasOwn(r, k), k).toBe(true);
    }
    expect(r.schemaVersion).toBe(1);
    expect(keysSorted(r)).toBe(true);
    expect(out.endsWith("}\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
    expect(out.split("\n")[1]).toMatch(/^ {2}"/);
    expect(r.toolchain).toEqual({
      crankpath: "0.1.0",
      helm: null,
      kustomize: null,
      tested: false,
      testedPair: { helm: "v4.3.2", kustomize: "v5.8.1" },
      missing: ["helm", "kustomize"],
      unrecognised: [],
    });
  });
  it("holds repo text as escaped data: no raw control character, the visible code instead", () => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the test is about control characters
    expect(out).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
    expect(out).not.toContain("\\u001b");
    expect(out).toContain("gitea\\\\x1b[2J");
  });
  it("holds no timestamp, absolute path or machine name", () => {
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
    expect(out).not.toContain(FIXTURE);
    expect(out).not.toContain(path.resolve("."));
    expect(out).not.toMatch(/"\/[^"]/);
    const host = os
      .hostname()
      .replace(/\.local$/i, "")
      .trim();
    if (host.length > 3) expect(out).not.toContain(host);
    expect(fs.existsSync(path.join(FIXTURE, "expected.json"))).toBe(true);
  });
});
