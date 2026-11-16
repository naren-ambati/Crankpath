// WorkDir (U4 and U9, contract C13; BR4.3, BR4.8, BR9.8, FR8.8, NFR17): the one place crankpath
// writes files. Everything it writes is under its cache root (`.crankpath` in the working
// directory by default, or `--cache-dir`): `charts/` (the chart cache), `repos/<host>/<path>@<sha>/`
// (fetched repositories, B3) and `tmp/<run>/`, a private
// mode-0700 directory for this run (helm's homes, values files, chart and kustomization copies),
// removed when the run ends. Files are created mode 0600, exclusively, never through a symlink.
// Nothing is created until a job needs it, so a run of plain directories writes nothing.
//
// A cache root inside the scanned tree must be the tree's own `.crankpath` (which discovery never
// reads); there its chart cache is not trusted, because the scanned repo could have committed it:
// cached charts are then never read, only written.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ChildHomes } from "./command-runner.js";

export const CACHE_DIR_NAME = ".crankpath";

export type CacheRootResult =
  | {
      readonly ok: true;
      readonly cacheRoot: string;
      /** False when the cache root is inside the scanned tree: cached charts are not read. */
      readonly trusted: boolean;
    }
  | { readonly ok: false; readonly problem: "inside-tree" | "not-a-directory" | "parent-missing" };

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/**
 * Where the cache root is, from `--cache-dir` (or the default) and the scanned root's real path;
 * null before a scanned root exists (the fetch of a URL to scan, B3: its checkout goes into the cache).
 */
export function resolveCacheRoot(cwd: string, flag: string | undefined, rootReal: string | null): CacheRootResult {
  const target = path.resolve(cwd, flag ?? CACHE_DIR_NAME);
  let parentReal: string;
  try {
    parentReal = fs.realpathSync.native(path.dirname(target));
  } catch {
    return { ok: false, problem: "parent-missing" };
  }
  const cacheRoot = path.join(parentReal, path.basename(target));
  try {
    const st = fs.lstatSync(cacheRoot);
    if (!st.isDirectory()) return { ok: false, problem: "not-a-directory" };
  } catch {
    // absent: created when first needed
  }
  if (rootReal !== null && inside(cacheRoot, rootReal)) {
    if (cacheRoot !== path.join(rootReal, CACHE_DIR_NAME)) return { ok: false, problem: "inside-tree" };
    return { ok: true, cacheRoot, trusted: false };
  }
  return { ok: true, cacheRoot, trusted: true };
}

export type Made = { readonly ok: true; readonly path: string } | { readonly ok: false };

/** A directory that exists as a real directory (never a symlink), or is created now mode 0700. */
export function ensureDir(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    try {
      fs.mkdirSync(p, { mode: 0o700 });
      return fs.lstatSync(p).isDirectory();
    } catch {
      return false;
    }
  }
}

export interface WorkDir {
  readonly cacheRoot: string;
  readonly trusted: boolean;
  /** The run's private directory path (created by `ensureRun`). */
  readonly runDir: string;
  /** The homes children see: paths inside the run directory (they need not exist for `version`). */
  readonly homes: ChildHomes;
  /** Creates the cache root, `tmp/` and the run directory with the homes; false when it cannot. */
  ensureRun(): boolean;
  /** A new empty private directory inside the run directory (`name-N`). */
  makeDir(name: string): Made;
  /** Writes a new mode-0600 file in a private directory; never follows a symlink, never overwrites. */
  writeFile(dir: string, name: string, data: string | Buffer): Made;
  /** The chart cache directory, created when absent; null when it cannot be. */
  chartsDir(): string | null;
  /** Removes a directory this run made (a job's private directory, in every outcome). */
  remove(dir: string): void;
  /** Removes the run directory (every outcome). */
  cleanup(): void;
}

const WRITE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;

/**
 * A `.gitignore` of `*` in a cache root crankpath has just created or in an existing `.crankpath`,
 * so values written there (decoded Secret values among them) are never committed with the tree the
 * cache sits in (B2 review m3, pass 3 m3). One already there is kept (never overwritten).
 */
function ignoreAll(cacheRoot: string): boolean {
  const p = path.join(cacheRoot, ".gitignore");
  try {
    const fd = fs.openSync(p, WRITE_FLAGS, 0o600);
    try {
      fs.writeSync(fd, "*\n");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // present already (or a symlink, never followed): either way nothing is written through it
  }
  return true;
}

const RUN_DIR = /^run-(\d{1,10})-[0-9a-f]{12}$/;

/** Removes run directories whose process is gone (a run killed before it could clean up). */
function removeStaleRuns(tmp: string): boolean {
  let names: string[] = [];
  try {
    names = fs.readdirSync(tmp);
  } catch {
    return true;
  }
  for (const name of names) {
    const m = RUN_DIR.exec(name);
    if (m === null) continue;
    const pid = Number(m[1]);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (e) {
      alive = (e as NodeJS.ErrnoException).code === "EPERM";
    }
    if (alive || pid === process.pid) continue;
    const full = path.join(tmp, name);
    try {
      const st = fs.lstatSync(full);
      if (st.isDirectory() && !st.isSymbolicLink()) fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // left for a later run
    }
  }
  return true;
}

export function createWorkDir(cacheRoot: string, trusted: boolean): WorkDir {
  const runDir = path.join(cacheRoot, "tmp", `run-${process.pid}-${randomBytes(6).toString("hex")}`);
  const homes: ChildHomes = Object.freeze({
    home: path.join(runDir, "home"),
    tmp: path.join(runDir, "tmp"),
    helmConfig: path.join(runDir, "helm", "config"),
    helmCache: path.join(runDir, "helm", "cache"),
    helmData: path.join(runDir, "helm", "data"),
    empty: path.join(runDir, "empty"),
  });
  let made: boolean | null = null;
  let counter = 0;
  const owns = (p: string) => inside(path.resolve(p), runDir);
  return {
    cacheRoot,
    trusted,
    runDir,
    homes,
    ensureRun() {
      if (made !== null) return made;
      // the .gitignore goes into a cache root crankpath creates now, and into an existing one
      // named `.crankpath` that has none (a repository may commit one: B2 review pass 3, m3); any
      // other existing directory (a project root given as --cache-dir) is never changed (pass 2)
      const existed = fs.existsSync(cacheRoot);
      made =
        ensureDir(cacheRoot) &&
        ((existed && path.basename(cacheRoot) !== CACHE_DIR_NAME) || ignoreAll(cacheRoot)) &&
        ensureDir(path.join(cacheRoot, "tmp")) &&
        removeStaleRuns(path.join(cacheRoot, "tmp")) &&
        (() => {
          try {
            fs.mkdirSync(runDir, { mode: 0o700 });
            return true;
          } catch {
            return false;
          }
        })() &&
        [
          homes.home,
          homes.tmp,
          path.join(runDir, "helm"),
          homes.helmConfig,
          homes.helmCache,
          homes.helmData,
          homes.empty,
        ]
          .map(ensureDir)
          .every(Boolean);
      return made;
    },
    makeDir(name) {
      if (!this.ensureRun()) return { ok: false };
      counter += 1;
      const p = path.join(runDir, `${name}-${counter}`);
      try {
        fs.mkdirSync(p, { mode: 0o700 });
        return { ok: true, path: p };
      } catch {
        return { ok: false };
      }
    },
    writeFile(dir, name, data) {
      const p = path.join(dir, name);
      if (!owns(dir) || !owns(p) || name.includes("/") || name.includes("\0")) return { ok: false };
      let fd: number;
      try {
        fd = fs.openSync(p, WRITE_FLAGS, 0o600);
      } catch {
        return { ok: false };
      }
      try {
        fs.writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf8") : data);
        return { ok: true, path: p };
      } catch {
        return { ok: false };
      } finally {
        fs.closeSync(fd);
      }
    },
    chartsDir() {
      if (!ensureDir(cacheRoot)) return null;
      const p = path.join(cacheRoot, "charts");
      return ensureDir(p) ? p : null;
    },
    remove(dir) {
      if (!owns(dir) || path.resolve(dir) === runDir) return;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // removed with the run directory at the latest
      }
    },
    cleanup() {
      if (made === null) return;
      try {
        fs.rmSync(runDir, { recursive: true, force: true });
      } catch {
        // a leftover private directory is removed by the next run's cleanup of its own only; stated
      }
    },
  };
}

/** Writes a file at `rel` (a canonical `/` path) under `base`, creating private directories. */
export function writeTreeFile(work: WorkDir, base: string, rel: string, data: Buffer): boolean {
  const parts = rel.split("/");
  let dir = base;
  if (!ensureDir(base)) return false;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    if (!ensureDir(dir)) return false;
  }
  return work.writeFile(dir, parts[parts.length - 1] as string, data).ok;
}
