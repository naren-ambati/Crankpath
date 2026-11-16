import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openRoot, type ScanRoot } from "../../src/u2-intake-config/bounded-reader.js";
import { canonicalDir, checkDirectory, walkFiles } from "../../src/u2-intake-config/tree-walk.js";

let base: string;
let root: ScanRoot;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-walk-"));
  const inside = path.join(base, "root");
  fs.mkdirSync(path.join(inside, "a", "b", "c"), { recursive: true });
  fs.mkdirSync(path.join(inside, ".git"));
  fs.mkdirSync(path.join(inside, ".crankpath"));
  fs.mkdirSync(path.join(base, "outside"));
  fs.writeFileSync(path.join(base, "outside", "secret.yaml"), "x: 1\n");
  fs.writeFileSync(path.join(inside, "z.yaml"), "a: 1\n");
  fs.writeFileSync(path.join(inside, "a", "one.yaml"), "a: 1\n");
  fs.writeFileSync(path.join(inside, "a", "b", "two.yaml"), "a: 1\n");
  fs.writeFileSync(path.join(inside, "a", "b", "c", "three.yaml"), "a: 1\n");
  fs.writeFileSync(path.join(inside, ".git", "config"), "x\n");
  fs.writeFileSync(path.join(inside, ".crankpath", "cached.yaml"), "x: 1\n");
  fs.symlinkSync(path.join(base, "outside"), path.join(inside, "a", "link-dir"));
  fs.symlinkSync(path.join(base, "outside", "secret.yaml"), path.join(inside, "a", "link.yaml"));
  const r = openRoot(inside);
  if (!r.ok) throw new Error("root");
  root = r.root;
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("tree walk (BR2.1, FR1.3)", () => {
  it("lists regular files in code-point order and names symlinks without following them", () => {
    const w = walkFiles(root, "", {
      recurse: true,
      skipNames: new Set([".git"]),
      skipAtStart: new Set([".crankpath"]),
    });
    if (!w.ok) throw new Error("walk");
    expect(w.files).toEqual(["a/b/c/three.yaml", "a/b/two.yaml", "a/one.yaml", "z.yaml"]);
    expect(w.refusals.map((r) => [r.path, r.outcome])).toEqual([
      ["a/link-dir", "symlink"],
      ["a/link.yaml", "symlink"],
    ]);
  });
  it("does not recurse unless asked", () => {
    const w = walkFiles(root, "a", { recurse: false });
    if (!w.ok) throw new Error("walk");
    expect(w.files).toEqual(["a/one.yaml"]);
  });
  it("refuses a start directory through a symlink, outside the root, or missing", () => {
    expect(walkFiles(root, "a/link-dir", { recurse: true })).toMatchObject({
      ok: false,
      refusal: { outcome: "symlink" },
    });
    expect(walkFiles(root, "../outside", { recurse: true })).toMatchObject({
      ok: false,
      refusal: { outcome: "traversal" },
    });
    expect(walkFiles(root, "/etc", { recurse: true })).toMatchObject({ ok: false, refusal: { outcome: "traversal" } });
    expect(walkFiles(root, "nope", { recurse: true })).toMatchObject({ ok: false, refusal: { outcome: "not-found" } });
    expect(checkDirectory(root, "z.yaml")).toMatchObject({ ok: false, refusal: { outcome: "not-found" } });
    expect(checkDirectory(root, "./a/")).toEqual({ ok: true, path: "a" });
  });
  it("canonicalises directory requests, the root included", () => {
    expect(canonicalDir(".")).toEqual({ ok: true, path: "" });
    expect(canonicalDir("")).toEqual({ ok: true, path: "" });
    expect(canonicalDir("a//b/./")).toEqual({ ok: true, path: "a/b" });
    expect(canonicalDir("a/../b")).toMatchObject({ ok: false });
    expect(canonicalDir("a\0b")).toMatchObject({ ok: false });
  });
  it("walks a deep tree without recursion", () => {
    let p = path.join(root.real, "deep");
    for (let i = 0; i < 200; i++) p = path.join(p, "d");
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "x.yaml"), "a: 1\n");
    const w = walkFiles(root, "deep", { recurse: true });
    if (!w.ok) throw new Error("walk");
    expect(w.files).toHaveLength(1);
  });
});

describe("admitting files (filesPerScan and the run budget, B3)", () => {
  it("asks before each file and stops the whole walk at the first refusal, naming the file not listed", () => {
    const asked: string[] = [];
    const w = walkFiles(root, "", {
      recurse: true,
      skipNames: new Set([".git"]),
      skipAtStart: new Set([".crankpath"]),
      admit: (rel) => {
        asked.push(rel);
        return asked.length > 2 ? { reasonWord: "file count limit reached", detail: "files per scan" } : null;
      },
    });
    if (!w.ok) throw new Error("walk");
    expect(w.files).toHaveLength(2);
    expect(asked).toHaveLength(3);
    expect(w.refusals).toEqual(
      expect.arrayContaining([
        { outcome: "too-large", path: asked[2], reasonWord: "file count limit reached", detail: "files per scan" },
      ]),
    );
  });
  it("lists everything when every file is admitted", () => {
    const opts = { recurse: true, skipNames: new Set([".git"]), skipAtStart: new Set([".crankpath"]) };
    const w = walkFiles(root, "", { ...opts, admit: () => null });
    const plain = walkFiles(root, "", opts);
    if (!w.ok || !plain.ok) throw new Error("walk");
    expect(w.files).toEqual(plain.files);
    expect(w.files.length).toBeGreaterThan(2);
  });
});
