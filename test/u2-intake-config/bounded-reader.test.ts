import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withValue } from "../support/limits.js";
import {
  canonicalPath,
  openRoot,
  parseYamlBounded,
  READER_LIMITS,
  type ReaderLimits,
  readText,
  readTextWithHooks,
  readYaml,
  type ScanRoot,
} from "../../src/u2-intake-config/bounded-reader.js";
import { Lexer } from "yaml";

let base: string;
let rootDir: string;
let root: ScanRoot;

function write(rel: string, content: string | Buffer): void {
  const full = path.join(rootDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-reader-"));
  rootDir = path.join(base, "repo");
  fs.mkdirSync(rootDir);
  fs.writeFileSync(path.join(base, "outside.yaml"), "secret: outside\n");
  fs.mkdirSync(path.join(base, "outside-dir"));
  fs.writeFileSync(path.join(base, "outside-dir", "x.yaml"), "secret: outside\n");
  write("apps/app.yaml", "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: a\n---\nkind: X\n");
  write("inside.yaml", "a: 1\n");
  fs.symlinkSync(path.join(base, "outside.yaml"), path.join(rootDir, "link-out.yaml"));
  fs.symlinkSync("inside.yaml", path.join(rootDir, "link-in.yaml"));
  fs.symlinkSync(path.join(base, "outside-dir"), path.join(rootDir, "dirlink"));
  fs.symlinkSync("loop-b", path.join(rootDir, "loop-a"));
  fs.symlinkSync("loop-a", path.join(rootDir, "loop-b"));
  execFileSync("mkfifo", [path.join(rootDir, "fifo.yaml")]);
  fs.mkdirSync(path.join(rootDir, "a-directory.yaml"));
  write("bad-utf8.yaml", Buffer.from([0x61, 0x3a, 0x20, 0xff, 0xfe, 0x0a]));
  const opened = openRoot(rootDir);
  if (!opened.ok) throw new Error("test root did not open");
  root = opened.root;
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("BoundedReader confinement (BR2.1)", () => {
  it("reads a file under the root and parses every document", () => {
    const r = readYaml(root, "apps/app.yaml");
    expect(r.outcome).toBe("ok");
    if (r.outcome !== "ok") return;
    expect(r.path).toBe("apps/app.yaml");
    expect(r.documents).toEqual([
      { apiVersion: "argoproj.io/v1alpha1", kind: "Application", metadata: { name: "a" } },
      { kind: "X" },
    ]);
  });

  it("gives two spellings of one path one canonical form", () => {
    expect(canonicalPath("./apps//app.yaml")).toEqual({ ok: true, path: "apps/app.yaml" });
    const r = readYaml(root, "./apps//./app.yaml");
    expect(r.path).toBe("apps/app.yaml");
  });

  it.each([
    ["../outside.yaml", "traversal"],
    ["apps/../../outside.yaml", "traversal"],
    ["apps/../inside.yaml", "traversal"],
    ["/etc/passwd", "traversal"],
    ["", "traversal"],
    ["a\0b", "traversal"],
    ["link-out.yaml", "symlink"],
    ["link-in.yaml", "symlink"],
    ["dirlink/x.yaml", "symlink"],
    ["loop-a", "symlink"],
    ["fifo.yaml", "not-regular-file"],
    ["a-directory.yaml", "not-regular-file"],
    [".", "not-regular-file"],
    ["missing.yaml", "not-found"],
    ["inside.yaml/x", "not-found"],
  ])("refuses %j as %s, with crankpath's fixed wording", (request, outcome) => {
    const r = readYaml(root, request);
    expect(r.outcome).toBe(outcome);
    if (r.outcome === "ok") return;
    expect(r.reasonWord.length).toBeGreaterThan(0);
  });

  it("reads a file under one spelling only: a case variant on a case-folding file system is refused", () => {
    const folds = fs.existsSync(path.join(rootDir, "INSIDE.yaml"));
    const r = readYaml(root, "INSIDE.yaml");
    if (folds) expect(r).toMatchObject({ outcome: "traversal", detail: "another spelling" });
    else expect(r.outcome).toBe("not-found");
    expect(readYaml(root, "inside.yaml").outcome).toBe("ok");
  });

  it("never returns content from outside the root through a symlink to outside", () => {
    const r = readText(root, "link-out.yaml");
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("does not block on a FIFO where a file is expected", () => {
    const t0 = performance.now();
    expect(readYaml(root, "fifo.yaml").outcome).toBe("not-regular-file");
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("refuses bytes that are not UTF-8 as a parse error with fixed wording", () => {
    const r = readYaml(root, "bad-utf8.yaml");
    expect(r).toMatchObject({ outcome: "parse-error", reasonWord: "not valid YAML", detail: "not UTF-8" });
  });

  it("refuses a root that does not exist or is a file", () => {
    expect(openRoot(path.join(rootDir, "nope"))).toEqual({ ok: false, reason: "not-found" });
    expect(openRoot(path.join(rootDir, "inside.yaml"))).toEqual({ ok: false, reason: "not-regular-file" });
  });
});

describe("BoundedReader when the file changes under it (races)", () => {
  const lim = (n: number): ReaderLimits => ({
    ...READER_LIMITS,
    fileBytes: withValue(READER_LIMITS.fileBytes, n, "test"),
  });
  const file = (name: string, text: string) => {
    write(`race/${name}`, text);
    return `race/${name}`;
  };

  it("a file replaced by another (a new inode) after the checks is refused as changed", () => {
    const rel = file("swap.yaml", "a: 1\n");
    const r = readTextWithHooks(root, rel, READER_LIMITS, {
      afterLocate: () => {
        fs.rmSync(path.join(rootDir, rel));
        fs.writeFileSync(path.join(rootDir, rel), "b: 2\n");
      },
    });
    expect(r).toMatchObject({ outcome: "changed", reasonWord: "changed while read", detail: "another file" });
  });

  it("a symlink swapped in at the last component is not followed (O_NOFOLLOW)", () => {
    const rel = file("link.yaml", "a: 1\n");
    const r = readTextWithHooks(root, rel, READER_LIMITS, {
      afterLocate: () => {
        fs.rmSync(path.join(rootDir, rel));
        fs.symlinkSync(path.join(base, "outside.yaml"), path.join(rootDir, rel));
      },
    });
    expect(r.outcome).toBe("symlink");
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("a directory swapped for a symlink to a hard link of the same file is caught by the real-path check", () => {
    const rel = file("sub/same.yaml", "a: 1\n");
    const elsewhere = path.join(base, "elsewhere");
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.linkSync(path.join(rootDir, rel), path.join(elsewhere, "same.yaml"));
    const r = readTextWithHooks(root, rel, READER_LIMITS, {
      afterLocate: () => {
        fs.renameSync(path.join(rootDir, "race/sub"), path.join(base, "moved-sub"));
        fs.symlinkSync(elsewhere, path.join(rootDir, "race/sub"));
      },
    });
    expect(r.outcome).toBe("symlink");
  });

  it("a FIFO swapped in after the checks does not block the open and is refused", () => {
    const rel = file("fifo-later.yaml", "a: 1\n");
    const t0 = performance.now();
    const r = readTextWithHooks(root, rel, READER_LIMITS, {
      afterLocate: () => {
        fs.rmSync(path.join(rootDir, rel));
        execFileSync("mkfifo", [path.join(rootDir, rel)]);
      },
    });
    expect(r.outcome).toBe("not-regular-file");
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("a file that grows past the limit between lstat and open is refused by its fstat size", () => {
    const rel = file("grow1.yaml", "a: 1\n");
    const r = readTextWithHooks(root, rel, lim(10), {
      afterLocate: () => fs.appendFileSync(path.join(rootDir, rel), "b: 22222\n"),
    });
    expect(r).toMatchObject({ outcome: "too-large", detail: "file" });
  });

  it("a file at the limit that grows while read is refused by the bounded read", () => {
    const rel = file("grow2.yaml", "a: 123456\n");
    const r = readTextWithHooks(root, rel, lim(10), {
      beforeRead: () => fs.appendFileSync(path.join(rootDir, rel), "b: 2\n"),
    });
    expect(r).toMatchObject({ outcome: "too-large", detail: "file" });
  });

  it("turns any throw inside the read into an io-error result (the read's own boundary)", () => {
    const rel = file("throws.yaml", "a: 1\n");
    for (const thrown of [new RangeError("Maximum call stack size exceeded"), new Error("boom")]) {
      const r = readTextWithHooks(root, rel, READER_LIMITS, {
        afterLocate: () => {
          throw thrown;
        },
      });
      expect(r).toEqual({
        outcome: "io-error",
        path: rel,
        reasonWord: "could not be read",
        detail: "unexpected failure",
      });
    }
  });

  it("a file under the limit that grows while read is refused as changed, never read as complete", () => {
    const rel = file("grow3.yaml", "a: 1\n");
    const r = readTextWithHooks(root, rel, lim(1000), {
      beforeRead: () => fs.appendFileSync(path.join(rootDir, rel), "b: 2\n"),
    });
    expect(r).toMatchObject({ outcome: "changed", reasonWord: "changed while read", detail: "grew" });
  });

  it("a file that shrinks while read is refused as changed, never read as complete", () => {
    const rel = file("shrink.yaml", "a: 1\nb: 2\nc: 3\n");
    const r = readTextWithHooks(root, rel, lim(1000), {
      beforeRead: () => fs.truncateSync(path.join(rootDir, rel), 5),
    });
    expect(r).toMatchObject({ outcome: "changed", reasonWord: "changed while read", detail: "shrank" });
  });
});

describe("BoundedReader size limit (BR2.2)", () => {
  it("refuses a file over fileBytes from stat, before reading", () => {
    write("big.yaml", `a: ${"x".repeat(200)}\n`);
    const small: ReaderLimits = { ...READER_LIMITS, fileBytes: withValue(READER_LIMITS.fileBytes, 100, "test") };
    expect(readYaml(root, "big.yaml", small)).toMatchObject({ outcome: "too-large", detail: "file" });
    const exact: ReaderLimits = { ...READER_LIMITS, fileBytes: withValue(READER_LIMITS.fileBytes, 204, "test") };
    expect(readYaml(root, "big.yaml", exact).outcome).toBe("ok");
    const oneShort: ReaderLimits = { ...READER_LIMITS, fileBytes: withValue(READER_LIMITS.fileBytes, 203, "test") };
    expect(readYaml(root, "big.yaml", oneShort).outcome).toBe("too-large");
  });

  it("refuses a file over the derived default limit (10,000,000 bytes)", () => {
    write("huge.yaml", Buffer.alloc(10_000_001, 0x61));
    expect(readYaml(root, "huge.yaml").outcome).toBe("too-large");
  });
});

describe("BoundedReader YAML limits (BR2.2, BR2.3)", () => {
  it("refuses a billion-laughs alias bomb quickly, without expanding it", () => {
    let bomb = "a: &a [lol,lol,lol,lol,lol,lol,lol,lol,lol,lol]\n";
    const names = "abcdefghi";
    for (let i = 1; i < names.length; i++) {
      const prev = names[i - 1];
      bomb += `${names[i]}: &${names[i]} [${Array(10).fill(`*${prev}`).join(",")}]\n`;
    }
    const t0 = performance.now();
    expect(parseYamlBounded(bomb)).toEqual({ ok: false, refusal: "alias-limit" });
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("admits aliases under the limit and shares their value", () => {
    const r = parseYamlBounded("a: &x {k: v}\nb: *x\nc: *x\n");
    expect(r).toEqual({ ok: true, documents: [{ a: { k: "v" }, b: { k: "v" }, c: { k: "v" } }] });
  });

  it("counts the expanded size: the limit moves the refusal", () => {
    const text = "a: &x [1, 2, 3]\nb: [*x, *x]\n";
    const lim = (n: number): ReaderLimits => ({
      ...READER_LIMITS,
      expandedNodesPerDocument: withValue(READER_LIMITS.expandedNodesPerDocument, n, "test"),
    });
    // root map 1 + key a 1 + seq 4 + key b 1 + seq 1 + two aliases of 4 = 16
    expect(parseYamlBounded(text, lim(16)).ok).toBe(true);
    expect(parseYamlBounded(text, lim(15))).toEqual({ ok: false, refusal: "alias-limit" });
    expect(parseYamlBounded("a: [1, 2, 3]\n", lim(3))).toEqual({ ok: false, refusal: "too-large", detail: "document" });
  });

  it("refuses a document with more nodes than the limit while lexing, before composing it", () => {
    const n = READER_LIMITS.expandedNodesPerDocument.value;
    const t0 = performance.now();
    expect(parseYamlBounded(`[${"1,".repeat(n)}1]`)).toMatchObject({ ok: false, refusal: "too-large" });
    // aliases: with the default limits the lexeme budget binds first, so the node limit is lowered
    const nodes: ReaderLimits = {
      ...READER_LIMITS,
      expandedNodesPerDocument: withValue(READER_LIMITS.expandedNodesPerDocument, 1000, "test"),
    };
    expect(parseYamlBounded(`a: &a [1]\nb: [${"*a,".repeat(1001)}1]\n`, nodes)).toEqual({
      ok: false,
      refusal: "alias-limit",
    });
    expect(performance.now() - t0).toBeLessThan(60_000);
  }, 60_000);

  it("the lexing-time node count refuses before composing: a truncated document over the limit is too-large, not a parse error", () => {
    // regression for the heap crash fixed in c043698: without the early count this input reaches
    // the composer and comes back as a parse error
    const lim: ReaderLimits = {
      ...READER_LIMITS,
      expandedNodesPerDocument: withValue(READER_LIMITS.expandedNodesPerDocument, 3, "test"),
    };
    expect(parseYamlBounded("[1, 1, 1, 1, 1,", lim)).toEqual({ ok: false, refusal: "too-large", detail: "document" });
    expect(parseYamlBounded("[1, 1,", lim)).toEqual({ ok: false, refusal: "parse-error" });
  });

  it("counts every lexeme of the file against the memory budget: all documents, comments and whitespace", () => {
    const lim = (k: number): ReaderLimits => ({
      ...READER_LIMITS,
      lexemesPerFile: withValue(READER_LIMITS.lexemesPerFile, k, "test"),
    });
    const items = "- &a !!str x\n- &b !!str y\n";
    const n = (t: string) => {
      let c = 0;
      for (const _ of new Lexer().lex(t)) c += 1;
      return c;
    };
    expect(parseYamlBounded(items, lim(n(items))).ok).toBe(true);
    expect(parseYamlBounded(items, lim(n(items) - 1))).toEqual({
      ok: false,
      refusal: "too-large",
      detail: "file memory",
    });
    // the count runs over the whole file, not per document
    const two = `${items}---\n${items}`;
    expect(parseYamlBounded(two, lim(n(items) + 2))).toEqual({
      ok: false,
      refusal: "too-large",
      detail: "file memory",
    });
    expect(parseYamlBounded(two, lim(n(two))).ok).toBe(true);
    // comments and newlines count
    const comments = `a: 1\n${"#\n".repeat(50)}`;
    expect(parseYamlBounded(comments, lim(n(comments) - 1))).toMatchObject({ ok: false, detail: "file memory" });
  });

  it("refuses at the derived budget the accepted-file shapes of the second review: several documents, comments, newlines", () => {
    const N = READER_LIMITS.fileBytes.value;
    const doc = `---\n[${"{},".repeat(Math.floor(N / 9) - 1)}1]\n`;
    expect(parseYamlBounded(doc + doc + doc)).toEqual({ ok: false, refusal: "too-large", detail: "file memory" });
    expect(parseYamlBounded(`a: 1\n${"#\n".repeat(N / 2 - 3)}`)).toEqual({
      ok: false,
      refusal: "too-large",
      detail: "file memory",
    });
    expect(parseYamlBounded(`[1${"\n".repeat(N - 6)}]\n`)).toEqual({
      ok: false,
      refusal: "too-large",
      detail: "file memory",
    });
    expect(parseYamlBounded("- &a x\n".repeat(Math.floor(N / 7)))).toEqual({
      ok: false,
      refusal: "too-large",
      detail: "file memory",
    });
  }, 120_000);

  it("refuses a flow-style document at the API object ceiling by its lexemes first (a stated trade-off)", () => {
    // 1,572,864 one-character values are within expandedNodesPerDocument but cost three lexemes
    // each (scalar marker, scalar, comma): over lexemesPerFile, so the memory budget refuses first
    const n = READER_LIMITS.expandedNodesPerDocument.value;
    expect(3 * n).toBeGreaterThan(READER_LIMITS.lexemesPerFile.value);
    expect(parseYamlBounded(`[${"0,".repeat(n - 1)}0]`)).toEqual({
      ok: false,
      refusal: "too-large",
      detail: "file memory",
    });
  }, 60_000);

  it("maps a RangeError raised inside the parser to the too-deep refusal (the parse handler)", () => {
    const throwing: ReaderLimits = {
      ...READER_LIMITS,
      get nestingDepth(): ReaderLimits["nestingDepth"] {
        throw new RangeError("Maximum call stack size exceeded");
      },
    };
    expect(parseYamlBounded("a: 1\n", throwing)).toEqual({ ok: false, refusal: "too-deep", detail: "parser stack" });
    const other: ReaderLimits = {
      ...READER_LIMITS,
      get nestingDepth(): ReaderLimits["nestingDepth"] {
        throw new Error("boom");
      },
    };
    expect(parseYamlBounded("a: 1\n", other)).toEqual({ ok: false, refusal: "parse-error" });
  });

  it("returns a refusal even when the parse handler itself fails (the read boundary)", () => {
    // A thrown value whose prototype lookup throws makes `instanceof` in the parse handler throw;
    // only the second boundary in readYaml can then turn it into a result.
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new RangeError("Maximum call stack size exceeded");
        },
      },
    );
    const limits: ReaderLimits = {
      ...READER_LIMITS,
      get nestingDepth(): ReaderLimits["nestingDepth"] {
        throw hostile;
      },
    };
    expect(() => parseYamlBounded("a: 1\n", limits)).toThrow(RangeError);
    expect(readYaml(root, "inside.yaml", limits)).toEqual({
      outcome: "too-deep",
      path: "inside.yaml",
      reasonWord: "too deep",
      detail: "parser stack",
    });
  });

  it("the lexing count never refuses what the converter admits (block scalars, quotes, flow)", () => {
    const text = "a: |\n  'x' \"y\" *z [\nb: \"y\"\nc: 'z'\nd: [1, {e: f}]\n";
    const lim = (k: number): ReaderLimits => ({
      ...READER_LIMITS,
      expandedNodesPerDocument: withValue(READER_LIMITS.expandedNodesPerDocument, k, "test"),
    });
    // root 1, a 2, b 2, c 2, d: key 1 + seq 1 + 1 + map 1 + e 1 + f 1 = 13
    expect(parseYamlBounded(text, lim(13))).toMatchObject({ ok: true });
    expect(parseYamlBounded(text, lim(12))).toEqual({ ok: false, refusal: "too-large", detail: "document" });
    // the count restarts for each document
    expect(parseYamlBounded("[1, 2]\n---\n[3, 4]\n", lim(3)).ok).toBe(true);
  });

  it("refuses a cyclic alias and an unknown alias", () => {
    expect(parseYamlBounded("a: &a [1, *a]\n")).toEqual({ ok: false, refusal: "alias-limit", detail: "cyclic alias" });
    expect(parseYamlBounded("a: *nope\n")).toMatchObject({ ok: false, refusal: "parse-error" });
  });

  it("refuses 10,000-deep and 10,001-deep nesting without crashing", () => {
    const deep = (n: number) => `${"[".repeat(n)}${"]".repeat(n)}`;
    expect(parseYamlBounded(deep(10_001))).toEqual({ ok: false, refusal: "too-deep", detail: "nesting" });
    expect(parseYamlBounded(deep(10_000))).toMatchObject({ ok: false, refusal: "too-deep" });
    let block = "";
    for (let i = 0; i < 10_001; i++) block += `${" ".repeat(i)}a:\n`;
    expect(parseYamlBounded(block)).toMatchObject({ ok: false, refusal: "too-deep" });
  });

  it("refuses by the derived depth, deterministically, in every nesting shape", () => {
    const shapes: Record<string, (n: number) => string> = {
      "flow sequences": (n) => `${"[".repeat(n)}${"]".repeat(n)}`,
      "flow mappings": (n) => `${"{a: ".repeat(n)}1${"}".repeat(n)}`,
      "block mappings": (n) => Array.from({ length: n }, (_, i) => `${" ".repeat(i)}a:\n`).join(""),
      "block sequences": (n) => Array.from({ length: n }, (_, i) => `${" ".repeat(2 * i)}-\n`).join(""),
      "compact block sequences": (n) => `${"- ".repeat(n)}x\n`,
      "anchored flow sequences": (n) => `${Array.from({ length: n }, (_, i) => `&a${i} [`).join("")}${"]".repeat(n)}`,
    };
    for (const [name, gen] of Object.entries(shapes)) {
      const last = Array.from({ length: 400 }, (_, i) => parseYamlBounded(gen(i + 1)).ok).lastIndexOf(true) + 1;
      // the pre-scan, not the parser's stack, sets the boundary, and it sits at or below the limit
      expect(last, name).toBeLessThanOrEqual(READER_LIMITS.nestingDepth.value);
      expect(last, name).toBeGreaterThanOrEqual(READER_LIMITS.nestingDepth.value - 2);
      expect(parseYamlBounded(gen(last + 1)), name).toEqual({ ok: false, refusal: "too-deep", detail: "nesting" });
      // the same answer every time
      expect(parseYamlBounded(gen(last)).ok, name).toBe(true);
    }
  }, 60_000);

  it("never throws when called from deep in the stack (a child node, main thread, default stack)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const out = execFileSync(
      process.execPath,
      [
        "--no-warnings",
        "--import",
        path.join(here, "../support/register-ts.mjs"),
        path.join(here, "../support/deep-stack-sweep.mjs"),
      ],
      { encoding: "utf8" },
    );
    const r = JSON.parse(out.trim()) as { reached: number; escaped: string[]; escapedCount: number };
    expect(r.escaped).toEqual([]);
    expect(r.escapedCount).toBe(0);
    expect(r.reached).toBeGreaterThan(5000);
  }, 120_000);

  it("refuses depth over a smaller limit at the pre-scan, admits it at the limit", () => {
    const lim = (n: number): ReaderLimits => ({
      ...READER_LIMITS,
      nestingDepth: withValue(READER_LIMITS.nestingDepth, n, "test"),
    });
    expect(parseYamlBounded("a: [[1]]\n", lim(3)).ok).toBe(true);
    expect(parseYamlBounded("a: [[[1]]]\n", lim(3))).toEqual({ ok: false, refusal: "too-deep", detail: "nesting" });
  });

  it("refuses more documents than the limit and admits exactly the limit", () => {
    const lim: ReaderLimits = {
      ...READER_LIMITS,
      documentsPerFile: withValue(READER_LIMITS.documentsPerFile, 3, "test"),
    };
    expect(parseYamlBounded("a: 1\n---\nb: 2\n---\nc: 3\n", lim).ok).toBe(true);
    expect(parseYamlBounded("a: 1\n---\nb: 2\n---\nc: 3\n---\nd: 4\n", lim)).toEqual({
      ok: false,
      refusal: "too-many-documents",
    });
  });

  it("refuses a stream of empty documents over the derived limit, quickly", () => {
    const t0 = performance.now();
    expect(parseYamlBounded("---\n".repeat(READER_LIMITS.documentsPerFile.value + 1))).toEqual({
      ok: false,
      refusal: "too-many-documents",
    });
    expect(performance.now() - t0).toBeLessThan(30_000);
  }, 30_000);

  it("names malformed and truncated YAML with fixed wording, never the parser's message", () => {
    for (const text of ["a: [1, 2\n", 'a: "unterminated\n', "a: b: c\n", "\tx: 1\n", "a:\n  - x\n - y\n"]) {
      const r = parseYamlBounded(text);
      expect(r, text).toEqual({ ok: false, refusal: "parse-error" });
    }
    write("broken.yaml", "a: [1, 2\n");
    expect(readYaml(root, "broken.yaml")).toEqual({
      outcome: "parse-error",
      path: "broken.yaml",
      reasonWord: "not valid YAML",
    });
  });

  it("refuses duplicate keys and collection keys (the slow paths of the yaml package)", () => {
    expect(parseYamlBounded("a: 1\na: 2\n")).toEqual({ ok: false, refusal: "parse-error", detail: "duplicate key" });
    expect(parseYamlBounded("? [a]\n: 1\n")).toEqual({ ok: false, refusal: "parse-error", detail: "collection key" });
    expect(parseYamlBounded("x: &k [a]\n*k : 1\n")).toMatchObject({ ok: false, refusal: "parse-error" });
    const t0 = performance.now();
    const nested = `${"{? ".repeat(250)}x${"}".repeat(250)}`;
    expect(parseYamlBounded(nested)).toMatchObject({ ok: false, refusal: "parse-error" });
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("reads YAML 1.1 as the Kubernetes decoders do: yes/no/on/off/y/n booleans and merge keys", () => {
    expect(parseYamlBounded("a: yes\nb: off\nc: y\nd: '1'\ne: ~\n")).toEqual({
      ok: true,
      documents: [{ a: true, b: false, c: true, d: "1", e: null }],
    });
    expect(parseYamlBounded("base: &b {x: 1, y: 2}\nm:\n  <<: *b\n  z: 3\n  x: 9\n")).toEqual({
      ok: true,
      documents: [{ base: { x: 1, true: 2 }, m: { x: 9, true: 2, z: 3 } }],
    });
    expect(parseYamlBounded("a: &a {p: 1}\nb: &b {p: 2, q: 2}\nm: {<<: [*a, *b]}\n")).toEqual({
      ok: true,
      documents: [{ a: { p: 1 }, b: { p: 2, q: 2 }, m: { p: 1, q: 2 } }],
    });
    expect(parseYamlBounded("m: {<<: 1}\n")).toMatchObject({ ok: false, refusal: "parse-error" });
  });

  it("runs nothing for tags: unknown and YAML 1.1 types stay plain values", () => {
    expect(parseYamlBounded("a: !!binary aGVsbG8=\nb: 2001-12-14\nc: !custom x\nd: !!js/function 'f'\n")).toEqual({
      ok: true,
      documents: [{ a: "aGVsbG8=", b: "2001-12-14", c: "x", d: "f" }],
    });
  });

  it("never changes a prototype: __proto__ is an own key", () => {
    const r = parseYamlBounded("__proto__: {polluted: 1}\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = r.documents[0] as Record<string, unknown>;
    expect(Object.hasOwn(doc, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps an empty document as null and an empty file as no documents", () => {
    expect(parseYamlBounded("")).toEqual({ ok: true, documents: [] });
    expect(parseYamlBounded("a: 1\n---\n")).toEqual({ ok: true, documents: [{ a: 1 }, null] });
  });

  it("never throws on hostile bytes", () => {
    const samples = ["\x00", "\ufeff", "%YAML 9.9\n---\na", "!<!> x", "&a &b x", "*", "[", "{", "? ", "- - - -", "'''"];
    for (const s of samples) expect(() => parseYamlBounded(s)).not.toThrow();
  });
});
