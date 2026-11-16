// Directory listing under the scanned root (U2, BR2.1, FR1.3): the same confinement as
// BoundedReader. Every component of the starting directory is lstat-ed (a symlink anywhere is
// refused, not followed); every entry found is lstat-ed; a symlink entry is named and counted, never
// followed; the walk is iterative (no recursion, so depth cannot overflow a stack) and its output is
// in code-point order. File contents are never read here.

import fs from "node:fs";
import path from "node:path";
import { compareCodePoints } from "../u1-graph-model/order.js";
import { REASON_WORDS, type ReadRefused, type Refusal, type ScanRoot } from "./bounded-reader.js";

function refused(outcome: Refusal, p: string, detail?: string): ReadRefused {
  return detail === undefined
    ? { outcome, path: p, reasonWord: REASON_WORDS[outcome] }
    : { outcome, path: p, reasonWord: REASON_WORDS[outcome], detail };
}

/**
 * The canonical `/`-separated form of a directory request, `""` for the root itself; a refusal for
 * absolute paths, `..` segments and NUL. `.`, empty segments and a trailing `/` are dropped.
 */
export function canonicalDir(request: string): { ok: true; path: string } | { ok: false; refusal: ReadRefused } {
  if (request.includes("\0")) return { ok: false, refusal: refused("traversal", request, "invalid path") };
  if (path.isAbsolute(request) || request.startsWith("/")) {
    return { ok: false, refusal: refused("traversal", request, "absolute path") };
  }
  const parts = request.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.some((s) => s === "..")) return { ok: false, refusal: refused("traversal", request, "parent segment") };
  return { ok: true, path: parts.join("/") };
}

function fullPath(root: ScanRoot, rel: string): string {
  return rel === "" ? root.real : path.join(root.real, ...rel.split("/"));
}

/** Checks that a canonical directory exists under the root with no symlink on its path. */
export function checkDirectory(
  root: ScanRoot,
  request: string,
): { ok: true; path: string } | { ok: false; refusal: ReadRefused } {
  const canon = canonicalDir(request);
  if (!canon.ok) return canon;
  if (canon.path === "") return canon;
  let current = root.real;
  for (const part of canon.path.split("/")) {
    current = path.join(current, part);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(current);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, refusal: refused("not-found", canon.path) };
      return { ok: false, refusal: refused("io-error", canon.path) };
    }
    if (st.isSymbolicLink()) return { ok: false, refusal: refused("symlink", canon.path) };
    if (!st.isDirectory()) return { ok: false, refusal: refused("not-found", canon.path, "not a directory") };
  }
  return canon;
}

export type EntryKind = "file" | "dir" | "symlink" | "missing" | "other" | "outside";

/**
 * What a canonical path under the root is, without reading it: every component is lstat-ed, so a
 * symlink anywhere on the path is `symlink` (never followed); `outside` for an absolute path or a
 * `..` segment.
 */
export function entryKind(root: ScanRoot, request: string): EntryKind {
  const canon = canonicalDir(request);
  if (!canon.ok) return canon.refusal.outcome === "traversal" ? "outside" : "other";
  if (canon.path === "") return "dir";
  let current = root.real;
  const parts = canon.path.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i] as string);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(current);
    } catch {
      return "missing";
    }
    if (st.isSymbolicLink()) return "symlink";
    const last = i === parts.length - 1;
    if (!last && !st.isDirectory()) return "missing";
    if (last) return st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
  }
  return "missing";
}

export interface WalkOptions {
  readonly recurse: boolean;
  /** Directory names skipped at any depth (for example `.git`). */
  readonly skipNames?: ReadonlySet<string>;
  /** Directory names skipped only directly under the start directory. */
  readonly skipAtStart?: ReadonlySet<string>;
  /**
   * Asked before each regular file is listed (the scan's file count and the run budget, B3): null
   * admits it; a refusal stops the walk there, and the refusal is listed for the file not admitted
   * (outcome `too-large`), so a stopped listing is named and counted, never silently short.
   */
  readonly admit?: (rel: string) => { readonly reasonWord: string; readonly detail: string } | null;
}

export interface WalkResult {
  /** Regular files, canonical paths relative to the root, code-point order. */
  readonly files: readonly string[];
  /** Entries refused: symlinks, special files, unreadable directories. Code-point order by path. */
  readonly refusals: readonly ReadRefused[];
}

export type WalkOutcome = ({ readonly ok: true } & WalkResult) | { readonly ok: false; readonly refusal: ReadRefused };

/** Lists the regular files under a directory of the root, recursively when asked. */
export function walkFiles(root: ScanRoot, request: string, options: WalkOptions): WalkOutcome {
  const start = checkDirectory(root, request);
  if (!start.ok) return start;
  const files: string[] = [];
  const refusals: ReadRefused[] = [];
  const stack: string[] = [start.path];
  let stopped = false;
  while (stack.length > 0 && !stopped) {
    const dir = stack.pop() as string;
    const full = fullPath(root, dir);
    let names: string[];
    try {
      names = fs.readdirSync(full).sort(compareCodePoints);
      // The directory must still be itself: a component swapped for a symlink after the check
      // would make the listing come from elsewhere.
      if (fs.realpathSync.native(full) !== full) {
        refusals.push(refused("symlink", dir === "" ? "." : dir));
        continue;
      }
    } catch {
      refusals.push(refused("io-error", dir === "" ? "." : dir));
      continue;
    }
    const subdirs: string[] = [];
    for (const name of names) {
      const rel = dir === "" ? name : `${dir}/${name}`;
      let st: fs.Stats;
      try {
        st = fs.lstatSync(path.join(full, name));
      } catch {
        refusals.push(refused("io-error", rel));
        continue;
      }
      if (st.isSymbolicLink()) refusals.push(refused("symlink", rel));
      else if (st.isDirectory()) {
        if (!options.recurse) continue;
        if (options.skipNames?.has(name)) continue;
        if (dir === start.path && options.skipAtStart?.has(name)) continue;
        subdirs.push(rel);
      } else if (st.isFile()) {
        const no = options.admit?.(rel) ?? null;
        if (no !== null) {
          refusals.push({ outcome: "too-large", path: rel, reasonWord: no.reasonWord, detail: no.detail });
          stopped = true;
          break;
        }
        files.push(rel);
      } else refusals.push(refused("not-regular-file", rel));
    }
    if (!stopped) for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i] as string);
  }
  files.sort(compareCodePoints);
  refusals.sort((a, b) => compareCodePoints(a.path, b.path));
  return { ok: true, files, refusals };
}
