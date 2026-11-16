// End to end through the built binary (`npm run verify` builds before it tests): the thin-slice
// text on stdout byte for byte and the exit codes, as a user would run it.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURE, THIN_SLICE_URL } from "../helpers/scan.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BIN = path.join(ROOT, "dist", "u9-cli-package", "cli.js");

function newestSource(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestSource(full) : fs.statSync(full).mtimeMs);
  }
  return newest;
}

function crankpath(args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    // node only: helm and kustomize are not found, so the toolchain line is the same on every machine
    env: { PATH: path.dirname(process.execPath) },
  });
}

describe("the built crankpath binary", () => {
  it("is built from the current sources (run `npm run build` first)", () => {
    expect(fs.existsSync(BIN), "dist is missing: run npm run build").toBe(true);
    expect(fs.statSync(BIN).mtimeMs, "dist is older than src: run npm run build").toBeGreaterThanOrEqual(
      newestSource(path.join(ROOT, "src")),
    );
    expect(fs.readFileSync(BIN, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
  it("prints the thin-slice expected text and exits 0", () => {
    const r = crankpath([path.relative(ROOT, path.join(FIXTURE, "repo")), "--repo-url", THIN_SLICE_URL]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(fs.readFileSync(path.join(FIXTURE, "expected.txt"), "utf8"));
  });
  it("prints the thin-slice expected JSON and exits 0", () => {
    const r = crankpath([path.join(FIXTURE, "repo"), "--repo-url", THIN_SLICE_URL, "--format", "json"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(fs.readFileSync(path.join(FIXTURE, "expected.json"), "utf8"));
  });
  it("prints the thin-slice expected --explain and Mermaid outputs and exits 0", () => {
    const repo = path.join(FIXTURE, "repo");
    const explain = crankpath([repo, "--repo-url", THIN_SLICE_URL, "--explain", "c-d8197e7d"]);
    expect(explain.status).toBe(0);
    expect(explain.stdout).toBe(fs.readFileSync(path.join(FIXTURE, "expected-explain.txt"), "utf8"));
    const mermaid = crankpath([repo, "--repo-url", THIN_SLICE_URL, "--format", "mermaid"]);
    expect(mermaid.status).toBe(0);
    expect(mermaid.stdout).toBe(fs.readFileSync(path.join(FIXTURE, "expected-mermaid.md"), "utf8"));
  });
  it("exits 1 on an unknown flag and 2 on a tree with no source", () => {
    const bad = crankpath(["--nope"]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toBe('error: unknown option "--nope"\n');
    const none = crankpath([path.relative(ROOT, path.join(FIXTURE, "repo", "platform"))]);
    expect(none.status).toBe(2);
    expect(none.stdout).toContain("Run status: NOTHING ANALYSED");
  });
});
