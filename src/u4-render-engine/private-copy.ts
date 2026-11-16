// PrivateTree (U4; BR4.5, BR4.20, BR9.8, B2 review m4): copies directories of the scanned repo into
// the run's private directory, keeping their paths relative to their root, so that helm and
// kustomize only ever read crankpath's own copy: they never see a symlink (the bounded walk
// refuses each one and the reader never follows one), never read past the scanned root, and never
// write into the scanned tree (`helm dependency build` writes `charts/` into the copy). The
// pre-reads read the copy too, so what is checked is byte for byte what the tool reads (no second
// read of the original between the check and the use). Any entry the walk or the reader refuses is
// named, and the caller fails closed: the tool is not run on an incomplete copy.

import path from "node:path";
import type { UnreadableFile } from "../u1-graph-model/graph-model.js";
import { openRoot, type ReadResult, readYaml, type ScanRoot } from "../u2-intake-config/bounded-reader.js";
import { type EntryKind, entryKind, type WalkOutcome, walkFiles } from "../u2-intake-config/tree-walk.js";
import { SKIP_AT_ROOT, SKIP_DIRS } from "../u3-discovery-expansion/source-discovery.js";
import type { RenderIo } from "./render-io.js";
import { ensureDir, writeTreeFile } from "./work-dir.js";

export type CopyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly unreadable: readonly UnreadableFile[]; readonly writeFailed: boolean };

export interface PrivateTree {
  /** The copy's directory: the root's paths below it. */
  readonly base: string;
  /** Copies a directory of the root (recursively, `.git` skipped), once. */
  copy(dir: string): CopyResult;
  /** Copies one file of the root, once. */
  copyFile(rel: string): CopyResult;
  /**
   * Reads and parses a file of the copy (under the reader's limits); `not-found` when not copied.
   * `text`, when given, is handed the text that is parsed (one read: the bytes judged are the bytes parsed).
   */
  read(rel: string, text?: (text: string) => void): ReadResult;
  /** What a path of the copy is (lstat only). */
  kind(rel: string): EntryKind;
  /** Lists a directory of the copy. */
  walk(dir: string): WalkOutcome;
  /** The absolute path of a directory of the copy. */
  abs(dir: string): string;
}

/** A private copy of directories of `root` under `base` (created here); null when it cannot be created. */
export function createPrivateTree(io: RenderIo, root: string, base: string): PrivateTree | null {
  if (!ensureDir(base)) return null;
  const opened = openRoot(base);
  if (!opened.ok) return null;
  const scan: ScanRoot = opened.root;
  const doneDirs = new Set<string>();
  const doneFiles = new Set<string>();
  const failure = (unreadable: UnreadableFile[], writeFailed: boolean): CopyResult => ({
    ok: false,
    unreadable,
    writeFailed,
  });
  return {
    base,
    copy(dir) {
      if (doneDirs.has(dir)) return { ok: true };
      const unreadable: UnreadableFile[] = [];
      const walk = io.walk(root, dir, {
        recurse: true,
        skipNames: SKIP_DIRS,
        ...(root === "." && dir === "" ? { skipAtStart: SKIP_AT_ROOT } : {}),
      });
      const named = (r: { path: string; outcome: string; reasonWord: string; detail?: string }) => ({
        path: io.display(root, r.path),
        outcome: r.outcome,
        reasonWord: r.reasonWord,
        detail: r.detail ?? null,
      });
      if (!walk.ok) return failure([named(walk.refusal)], false);
      for (const r of walk.refusals) unreadable.push(named(r));
      for (const file of walk.files) {
        if (doneFiles.has(file)) continue;
        const read = io.readBytes(root, file);
        if (read.outcome !== "ok") {
          unreadable.push(named({ ...read, path: file }));
          continue;
        }
        if (!writeTreeFile(io.runtime.work, base, file, read.bytes)) return failure(unreadable, true);
        doneFiles.add(file);
      }
      if (unreadable.length > 0) return failure(unreadable, false);
      if (!ensureDir(dir === "" ? base : path.join(base, ...dir.split("/")))) return failure([], true);
      doneDirs.add(dir);
      return { ok: true };
    },
    copyFile(rel) {
      if (doneFiles.has(rel)) return { ok: true };
      const read = io.readBytes(root, rel);
      if (read.outcome !== "ok") {
        return failure(
          [
            {
              path: io.display(root, rel),
              outcome: read.outcome,
              reasonWord: read.reasonWord,
              detail: read.detail ?? null,
            },
          ],
          false,
        );
      }
      if (!writeTreeFile(io.runtime.work, base, rel, read.bytes)) return failure([], true);
      doneFiles.add(rel);
      return { ok: true };
    },
    read: (rel, text) =>
      readYaml(scan, rel, undefined, (t) => {
        text?.(t.text);
        return null;
      }),
    kind: (rel) => entryKind(scan, rel),
    walk: (dir) => walkFiles(scan, dir, { recurse: false }),
    abs: (dir) => (dir === "" ? base : path.join(base, ...dir.split("/"))),
  };
}
