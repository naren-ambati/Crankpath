// The live fetch lane's cache folder (scripts/live-fetch.mjs): where its private directory goes, or the
// one line that says why the lane cannot run. Never a stack trace: a folder that does not exist is
// created, and anything else that is wrong is a FAIL line the lane prints before it fetches anything.
import fs from "node:fs";
import path from "node:path";

/**
 * The folder the lane makes its private directory in.
 * @param {string | undefined} value CRANKPATH_LIVE_CACHE as set (unset or empty: the system temporary folder)
 * @param {string} tmp the system temporary folder
 * @param {string} repoRoot this repository's root: the cache must lie outside it
 * @returns {{ ok: true, dir: string, created: boolean } | { ok: false, line: string }}
 */
export function liveCacheRoot(value, tmp, repoRoot) {
  const fail = (/** @type {string} */ why) => ({
    ok: /** @type {const} */ (false),
    line: `live fetch: FAIL (CRANKPATH_LIVE_CACHE ${why})`,
  });
  if (value === undefined || value === "") return { ok: true, dir: tmp, created: false };
  if (!path.isAbsolute(value)) return fail("must be an absolute path");
  let created = false;
  try {
    let st = fs.lstatSync(value, { throwIfNoEntry: false });
    if (st === undefined) {
      fs.mkdirSync(value, { recursive: true });
      created = true;
      st = fs.lstatSync(value);
    }
    if (st.isSymbolicLink()) return fail("is a symbolic link; name the folder itself");
    if (!st.isDirectory()) return fail("names something that is not a folder");
    const real = fs.realpathSync(value);
    const root = fs.realpathSync(repoRoot);
    if (real === root || real.startsWith(`${root}${path.sep}`)) return fail("is inside this repository");
    return { ok: true, dir: real, created };
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String(e.code) : "error";
    return fail(`could not be created or read (${code})`);
  }
}
