// The live fetch lane's cache folder (scripts/live-cache.mjs, used by scripts/live-fetch.mjs): a folder
// that does not exist is created, and every other problem is one FAIL line, never a stack trace. The
// script itself is run only on a refusal, which it reports before it loads git or fetches anything.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { liveCacheRoot } from "../../scripts/live-cache.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const made: string[] = [];
const scratch = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-live-cache-test-"));
  made.push(d);
  return d;
};
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("the live fetch lane's cache folder", () => {
  it("is the temporary folder when CRANKPATH_LIVE_CACHE is unset or empty", () => {
    expect(liveCacheRoot(undefined, "/tmp-x", ROOT)).toEqual({ ok: true, dir: "/tmp-x", created: false });
    expect(liveCacheRoot("", "/tmp-x", ROOT)).toEqual({ ok: true, dir: "/tmp-x", created: false });
  });

  it("creates a folder that does not exist, and uses one that does", () => {
    const base = scratch();
    const missing = path.join(base, "a", "b");
    const r = liveCacheRoot(missing, os.tmpdir(), ROOT);
    expect(r).toEqual({ ok: true, dir: fs.realpathSync(missing), created: true });
    expect(fs.statSync(missing).isDirectory()).toBe(true);
    expect(liveCacheRoot(missing, os.tmpdir(), ROOT)).toEqual({
      ok: true,
      dir: fs.realpathSync(missing),
      created: false,
    });
  });

  it("refuses a relative path, a file, a symbolic link and a folder inside the repository, each as one FAIL line", () => {
    const base = scratch();
    const file = path.join(base, "file");
    fs.writeFileSync(file, "x");
    const link = path.join(base, "link");
    fs.symlinkSync(base, link);
    const cases: [string, string][] = [
      ["relative/cache", "must be an absolute path"],
      [file, "names something that is not a folder"],
      [link, "is a symbolic link; name the folder itself"],
      [path.join(ROOT, "test"), "is inside this repository"],
      [ROOT, "is inside this repository"],
    ];
    for (const [value, why] of cases)
      expect(liveCacheRoot(value, os.tmpdir(), ROOT)).toEqual({
        ok: false,
        line: `live fetch: FAIL (CRANKPATH_LIVE_CACHE ${why})`,
      });
    // nothing was created for a refusal
    expect(fs.existsSync(path.join(ROOT, "relative"))).toBe(false);
  });

  it("reports a folder it cannot create as a FAIL line with the error code", () => {
    const base = scratch();
    const file = path.join(base, "file");
    fs.writeFileSync(file, "x");
    const r = liveCacheRoot(path.join(file, "below"), os.tmpdir(), ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.line).toMatch(/^live fetch: FAIL \(CRANKPATH_LIVE_CACHE could not be created or read \(E[A-Z]+\)\)$/);
  });

  it("makes the script print the FAIL line and exit 1, with no stack trace and no fetch", () => {
    const base = scratch();
    const file = path.join(base, "file");
    fs.writeFileSync(file, "x");
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "live-fetch.mjs")], {
      env: { PATH: "", CRANKPATH_LIVE_CACHE: file },
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("live fetch: FAIL (CRANKPATH_LIVE_CACHE names something that is not a folder)\n");
    expect(r.stderr).toBe("");
  });

  it("makes the script report a missing git as SKIPPED and exit 2, never 0, after creating a missing folder", () => {
    const missing = path.join(scratch(), "new-cache");
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "live-fetch.mjs")], {
      env: { PATH: "", CRANKPATH_LIVE_CACHE: missing },
      encoding: "utf8",
    });
    expect(r.stdout).toBe(
      "live fetch: created the cache folder named by CRANKPATH_LIVE_CACHE\nlive fetch: SKIPPED (git not found on PATH)\n",
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("");
    expect(fs.statSync(missing).isDirectory()).toBe(true);
  });
});
