// The Action's fixture repositories are inert (release review, files m1): every git call that builds
// one turns automatic maintenance and gc off, so no detached `git maintenance run --auto` started by a
// fixture commit can write into `.git/objects` while a test compares snapshots of the checkout. A
// recording `git` on PATH holds each helper to it: every call it makes must carry both options.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCase } from "../../scripts/action-local.mjs";
import { makeRepo } from "../helpers/action-repo.js";

const INERT = ["-c", "maintenance.auto=false", "-c", "gc.auto=0"];
const made: string[] = [];
const savedPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = savedPath;
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A `git` that records its arguments, one JSON array per line, then runs the real git. */
function recordingGit(): { log: string; calls: () => string[][] } {
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  expect(real).not.toBe("");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-recording-git-"));
  made.push(d);
  const log = path.join(d, "calls.log");
  fs.writeFileSync(
    path.join(d, "git"),
    `#!${process.execPath}\nconst fs = require("node:fs");\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\nconst r = require("node:child_process").spawnSync(${JSON.stringify(real)}, process.argv.slice(2), { stdio: "inherit" });\nprocess.exit(r.status === null ? 1 : r.status);\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${d}${path.delimiter}${savedPath ?? ""}`;
  return {
    log,
    calls: () =>
      fs
        .readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as string[]),
  };
}

const inert = (args: string[]) => args.slice(0, INERT.length).join(" ") === INERT.join(" ");

describe("the Action's fixture repositories are inert", () => {
  it("the local harness (scripts/action-local.mjs) runs every git call with maintenance and gc off", () => {
    const g = recordingGit();
    const t = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-inert-case-"));
    made.push(t);
    buildCase("unrelated-change", t);
    const calls = g.calls();
    expect(calls.some((c) => c.includes("commit"))).toBe(true);
    expect(calls.filter((c) => !inert(c))).toEqual([]);
  });

  it("the test helper (test/helpers/action-repo.ts) does too, for its own calls and the ones tests make through it", () => {
    const g = recordingGit();
    const repo = makeRepo(["_estate/web-only"]);
    made.push(repo.tmp);
    repo.commitHead((d) => fs.writeFileSync(path.join(d, "extra.yaml"), "kind: ConfigMap\n"));
    repo.git(["rev-parse", "HEAD"]);
    const calls = g.calls();
    expect(calls.some((c) => c.includes("commit"))).toBe(true);
    expect(calls.filter((c) => !inert(c))).toEqual([]);
  });
});
