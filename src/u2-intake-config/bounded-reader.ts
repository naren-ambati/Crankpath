// BoundedReader (U2, BR2.1 to BR2.3, NFR1.1, NFR5.1): reads files confined to the scanned root and
// parses multi-document YAML under the derived limits. It never throws on hostile input and never
// follows a symlink: every outcome is a typed value, either `ok` with the documents or a named
// refusal with crankpath's fixed wording (never the parser's message).
//
// How each limit is applied:
// - size: from lstat before opening, then again from fstat on the open descriptor, and the read
//   itself stops one byte past the limit (a file that grows while read is still refused);
// - document count and nesting depth: while lexing and parsing, before any document is composed
//   (the CST parser keeps an explicit stack, so its length is the nesting depth so far);
// - the parser's own stack: the yaml package reports stack exhaustion as an error; that is the
//   same `too-deep` refusal;
// - document size in nodes: while lexing, every lexeme that starts a node (a scalar, an alias, a
//   flow collection) is counted per document, and a document with more than the expanded-node
//   limit is refused before the yaml package composes it (composing it would cost far more);
// - file memory: every lexeme of the file (scalars, indicators, anchors, tags, aliases, spaces,
//   newlines, comments, in every document) is counted against lexemesPerFile, derived from the
//   heap, a reserve for the text and the baseline, and the measured worst memory per lexeme;
// - alias and merge-key expansion: crankpath converts the parsed document to plain values itself,
//   in one iterative pass that resolves aliases in document order, shares (never copies) the
//   aliased value and counts the expanded size before anything walks it; a cycle is refused.
// The yaml package's own alias resolution and duplicate-key check are not used: both scan the
// document once per alias or per key (quadratic), which a hostile file can turn into a freeze.

import fs from "node:fs";
import path from "node:path";
import { Composer, CST, type Document, isAlias, isMap, isPair, isScalar, isSeq, Lexer, Parser } from "yaml";
import { type DerivedLimit, LIMITS } from "../u1-graph-model/limits.js";

export interface ReaderLimits {
  readonly fileBytes: DerivedLimit<"bytes">;
  readonly documentsPerFile: DerivedLimit<"documents">;
  readonly nestingDepth: DerivedLimit<"levels">;
  readonly expandedNodesPerDocument: DerivedLimit<"nodes">;
  readonly lexemesPerFile: DerivedLimit<"lexemes">;
}

export const READER_LIMITS: ReaderLimits = Object.freeze({
  fileBytes: LIMITS.fileBytes,
  documentsPerFile: LIMITS.documentsPerFile,
  nestingDepth: LIMITS.nestingDepth,
  expandedNodesPerDocument: LIMITS.expandedNodesPerDocument,
  lexemesPerFile: LIMITS.lexemesPerFile,
});

export type Refusal =
  | "symlink"
  | "traversal"
  | "not-found"
  | "not-regular-file"
  | "changed"
  | "io-error"
  | "too-large"
  | "too-deep"
  | "too-many-documents"
  | "alias-limit"
  | "parse-error";

/** crankpath's fixed wording for each refusal (BR2.3). */
export const REASON_WORDS: Readonly<Record<Refusal, string>> = Object.freeze({
  symlink: "symlink, not followed",
  traversal: "outside the scanned root",
  "not-found": "not found",
  "not-regular-file": "not a regular file",
  changed: "changed while read",
  "io-error": "could not be read",
  "too-large": "too large",
  "too-deep": "too deep",
  "too-many-documents": "too many documents",
  "alias-limit": "alias expansion over the limit",
  "parse-error": "not valid YAML",
});

/** A JSON-like value: what a YAML document converts to. */
export type YamlValue = null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };

export interface ReadOk {
  readonly outcome: "ok";
  /** Canonical path relative to the root, `/`-separated. */
  readonly path: string;
  readonly size: number;
  readonly documents: readonly YamlValue[];
}

export interface ReadRefused {
  readonly outcome: Refusal;
  /** The request as given when it could not be made canonical, else the canonical path. */
  readonly path: string;
  readonly reasonWord: string;
  /** A fixed detail word chosen by crankpath (never repo text or a parser message). */
  readonly detail?: string;
}

export type ReadResult = ReadOk | ReadRefused;

export interface TextOk {
  readonly outcome: "ok";
  readonly path: string;
  readonly size: number;
  readonly text: string;
}

export type TextResult = TextOk | ReadRefused;

export interface ScanRoot {
  /** The real path of the root directory (symlinks in the root's own path are the caller's). */
  readonly real: string;
}

export type RootResult =
  | { readonly ok: true; readonly root: ScanRoot }
  | { readonly ok: false; readonly reason: Refusal };

/** Opens the root once: it must be an existing directory; its real path is the confinement prefix. */
export function openRoot(rootPath: string): RootResult {
  try {
    const real = fs.realpathSync.native(rootPath);
    if (!fs.statSync(real).isDirectory()) return { ok: false, reason: "not-regular-file" };
    return { ok: true, root: Object.freeze({ real }) };
  } catch {
    return { ok: false, reason: "not-found" };
  }
}

function refused(outcome: Refusal, p: string, detail?: string): ReadRefused {
  return detail === undefined
    ? { outcome, path: p, reasonWord: REASON_WORDS[outcome] }
    : { outcome, path: p, reasonWord: REASON_WORDS[outcome], detail };
}

/** The canonical `/`-separated relative form, or a refusal for absolute paths and `..` segments. */
export function canonicalPath(request: string): { ok: true; path: string } | { ok: false; refusal: ReadRefused } {
  if (request.length === 0 || request.includes("\0")) {
    return { ok: false, refusal: refused("traversal", request, "invalid path") };
  }
  if (path.isAbsolute(request)) return { ok: false, refusal: refused("traversal", request, "absolute path") };
  const parts = request.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.some((s) => s === "..")) return { ok: false, refusal: refused("traversal", request, "parent segment") };
  if (parts.length === 0) return { ok: false, refusal: refused("not-regular-file", request, "the root itself") };
  return { ok: true, path: parts.join("/") };
}

type Located = { ok: true; rel: string; full: string; stat: fs.Stats } | { ok: false; refusal: ReadRefused };

/** lstat every component from the root: a symlink anywhere on the path is refused, not followed. */
function locate(root: ScanRoot, request: string): Located {
  const canon = canonicalPath(request);
  if (!canon.ok) return canon;
  const parts = canon.path.split("/");
  let current = root.real;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i] as string);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(current);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, refusal: refused("not-found", canon.path) };
      return { ok: false, refusal: refused("io-error", canon.path) };
    }
    if (st.isSymbolicLink()) return { ok: false, refusal: refused("symlink", canon.path) };
    const last = i === parts.length - 1;
    if (!last && !st.isDirectory()) return { ok: false, refusal: refused("not-found", canon.path) };
    if (last) return { ok: true, rel: canon.path, full: current, stat: st };
  }
  return { ok: false, refusal: refused("not-found", canon.path) };
}

// O_NOFOLLOW refuses a symlink swapped in at the last component; O_NONBLOCK keeps a FIFO swapped
// in after lstat from blocking the open.
const OPEN_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;

/** Reads a regular file under the root, at most `fileBytes`, as UTF-8 text. */
export function readText(root: ScanRoot, request: string, limits: ReaderLimits = READER_LIMITS): TextResult {
  return readTextWithHooks(root, request, limits, {});
}

/** Points between the checks where a test may change the file under the reader (a race). */
export interface RaceHooks {
  readonly afterLocate?: () => void;
  readonly afterOpen?: () => void;
  readonly beforeRead?: () => void;
}

/** readText with race hooks: for tests that prove each check holds when the file changes mid-read. */
export function readTextWithHooks(root: ScanRoot, request: string, limits: ReaderLimits, hooks: RaceHooks): TextResult {
  try {
    return readTextChecked(root, request, limits, hooks);
  } catch {
    // An object literal, no call: this handler must work with almost no stack left.
    return { outcome: "io-error", path: request, reasonWord: "could not be read", detail: "unexpected failure" };
  }
}

function readTextChecked(root: ScanRoot, request: string, limits: ReaderLimits, hooks: RaceHooks): TextResult {
  const located = locate(root, request);
  if (!located.ok) return located.refusal;
  const { rel, full, stat } = located;
  if (!stat.isFile()) return refused("not-regular-file", rel);
  const max = limits.fileBytes.value;
  // An early exit only: the bounded read below is what enforces the size, whatever the file does.
  if (stat.size > max) return refused("too-large", rel, "file");
  hooks.afterLocate?.();
  let fd: number;
  try {
    fd = fs.openSync(full, OPEN_FLAGS);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ELOOP") return refused("symlink", rel);
    if (code === "ENOENT") return refused("not-found", rel);
    return refused("io-error", rel);
  }
  try {
    hooks.afterOpen?.();
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return refused("not-regular-file", rel);
    if (st.ino !== stat.ino || st.dev !== stat.dev) return refused("changed", rel, "another file");
    // The path must resolve to exactly itself under the root. A different real path means either
    // an intermediate directory swapped for a symlink after the lstat walk, or another spelling of
    // the file (case or Unicode form on a file system that folds them): both are refused, so one
    // file is only ever read under one spelling.
    const real = fs.realpathSync.native(full);
    if (real !== path.join(root.real, ...rel.split("/"))) {
      const sameSpellingFolded = real.toLowerCase().normalize("NFC") === full.toLowerCase().normalize("NFC");
      return sameSpellingFolded ? refused("traversal", rel, "another spelling") : refused("symlink", rel);
    }
    hooks.beforeRead?.();
    const buf = Buffer.alloc(Math.min(max, st.size) + 1);
    let total = 0;
    for (;;) {
      if (total === buf.length) break;
      const n = fs.readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
    }
    if (total > max) return refused("too-large", rel, "file");
    // Not the size fstat reported: the file grew or shrank while it was read, so this read is not
    // the file (a shorter read would look complete and valid).
    if (total !== st.size) return refused("changed", rel, total > st.size ? "grew" : "shrank");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, total));
    } catch {
      return refused("parse-error", rel, "not UTF-8");
    }
    return { outcome: "ok", path: rel, size: total, text };
  } catch {
    return refused("io-error", rel);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Reads and parses a multi-document YAML file under the root. `beforeParse`, when given, sees the
 * read text before it is parsed and may refuse it (the run's memory budget charges the parse's
 * transient cost there).
 */
export function readYaml(
  root: ScanRoot,
  request: string,
  limits: ReaderLimits = READER_LIMITS,
  beforeParse?: (text: TextOk) => ReadRefused | null,
): ReadResult {
  try {
    readerProbe.entries += 1;
    const text = readText(root, request, limits);
    if (text.outcome !== "ok") return text;
    const refusedBefore = beforeParse?.(text) ?? null;
    if (refusedBefore !== null) return refusedBefore;
    const parsed = parseYamlBounded(text.text, limits);
    if (!parsed.ok) return refused(parsed.refusal, text.path, parsed.detail);
    return { outcome: "ok", path: text.path, size: text.size, documents: parsed.documents };
  } catch (e) {
    // parseYamlBounded catches everything itself; this second boundary holds when even its own
    // handler fails (a caller already at the end of the stack). Object literals only, no call.
    return e instanceof RangeError
      ? { outcome: "too-deep", path: request, reasonWord: "too deep", detail: "parser stack" }
      : { outcome: "parse-error", path: request, reasonWord: "not valid YAML" };
  }
}

/**
 * Counts entries into the reader's guarded bodies: a test reads it (a property, no call) to tell a
 * stack overflow at its own call site, before the reader was entered, from one the reader let out.
 */
export const readerProbe: { entries: number } = { entries: 0 };

/**
 * The lexemes of a text, counted as parseYamlBounded counts them (every lexeme of every document,
 * whitespace and comments included), without parsing; it stops at `max + 1`. A pre-scan whose
 * memory is one lexeme at a time.
 */
export function countLexemes(text: string, max: number): number {
  let n = 0;
  for (const _ of new Lexer().lex(text)) {
    n += 1;
    if (n > max) break;
  }
  return n;
}

export type ParseResult =
  | { readonly ok: true; readonly documents: readonly YamlValue[] }
  | { readonly ok: false; readonly refusal: Refusal; readonly detail?: string };

function parseFailure(refusal: Refusal, detail?: string): ParseResult {
  return detail === undefined ? { ok: false, refusal } : { ok: false, refusal, detail };
}

/**
 * Parses YAML text (YAML 1.1 semantics, as the Kubernetes decoders read it: `yes`/`no` booleans and
 * `<<` merge keys) under the limits. Pure apart from CPU and memory, which the limits bound.
 */
export function parseYamlBounded(text: string, limits: ReaderLimits = READER_LIMITS): ParseResult {
  try {
    readerProbe.entries += 1;
    const maxDocs = limits.documentsPerFile.value;
    const maxDepth = limits.nestingDepth.value;
    const maxNodes = limits.expandedNodesPerDocument.value;
    const maxLexemes = limits.lexemesPerFile.value;
    const lexer = new Lexer();
    const parser = new Parser();
    const composer = new Composer({ version: "1.1", uniqueKeys: false, logLevel: "silent", strict: true });
    const documents: YamlValue[] = [];
    let seen = 0;
    let nodeLexemes = 0;
    let afterBlockHeader = false;
    let aliasLexeme = false;
    let lexemes = 0;
    const take = (doc: Document.Parsed): ParseResult | undefined => {
      const converted = convertDocument(doc, maxNodes);
      if (!converted.ok) return converted;
      documents.push(converted.value);
      return undefined;
    };
    for (const lexeme of lexer.lex(text)) {
      if (startsNode(lexeme, afterBlockHeader)) nodeLexemes += 1;
      const kind = CST.tokenType(lexeme);
      if (kind === "alias") aliasLexeme = true;
      // every lexeme of the file, whitespace and comments included, costs parser memory
      lexemes += 1;
      if (lexemes > maxLexemes) return parseFailure("too-large", "file memory");
      if (kind === "block-scalar-header") afterBlockHeader = true;
      else if (kind !== "space" && kind !== "comment" && kind !== "newline") afterBlockHeader = false;
      if (nodeLexemes > maxNodes)
        return aliasLexeme ? parseFailure("alias-limit") : parseFailure("too-large", "document");
      for (const token of parser.next(lexeme)) {
        if (token.type === "document") {
          seen += 1;
          nodeLexemes = 0;
          aliasLexeme = false;
          if (seen > maxDocs) return parseFailure("too-many-documents");
        }
        for (const doc of composer.next(token)) {
          const failed = take(doc);
          if (failed) return failed;
        }
      }
      // The stack holds the document and each open collection: its length bounds the depth.
      if (parser.stack.length - 1 > maxDepth) return parseFailure("too-deep", "nesting");
    }
    for (const token of parser.end()) {
      if (token.type === "document") {
        seen += 1;
        if (seen > maxDocs) return parseFailure("too-many-documents");
      }
      for (const doc of composer.next(token)) {
        const failed = take(doc);
        if (failed) return failed;
      }
    }
    for (const doc of composer.end()) {
      const failed = take(doc);
      if (failed) return failed;
    }
    return { ok: true, documents };
  } catch (e) {
    // Preallocated results: near the end of the stack the handler itself must not call anything.
    return e instanceof RangeError ? STACK_EXHAUSTED : PARSE_ERROR;
  }
}

const STACK_EXHAUSTED: ParseResult = Object.freeze({ ok: false, refusal: "too-deep", detail: "parser stack" });
const PARSE_ERROR: ParseResult = Object.freeze({ ok: false, refusal: "parse-error" });

/**
 * Does this lexeme start a value node? Plain scalars arrive after the SCALAR marker; quoted
 * scalars, aliases, block-scalar headers and flow collection starts are recognised by their first
 * character. The content line of a block scalar is not a second node. Every node counted here is
 * also counted by the converter, so this count never exceeds the expanded size.
 */
function startsNode(lexeme: string, afterBlockHeader: boolean): boolean {
  if (lexeme === CST.SCALAR) return true;
  if (lexeme === "[" || lexeme === "{") return true;
  if (afterBlockHeader) return false;
  const c = lexeme[0];
  return c === "'" || c === '"' || c === "*" || c === "|" || c === ">";
}

type Converted = { ok: true; value: YamlValue } | { ok: false; refusal: Refusal; detail?: string };

interface Frame {
  readonly node: unknown;
  /** The value being built, once the node's children are being visited. */
  value?: YamlValue;
  /** Expanded size of the node so far (1 for the node itself plus its children). */
  size: number;
  childIndex: number;
  /** For a map: keys seen so far, to refuse duplicates. */
  keys?: Set<string>;
  /** For a map: keys set by merge keys, which explicit keys may override once. */
  merged?: Set<string>;
  /** The key a map frame is waiting to set, or the merge marker. */
  pendingKey?: string | typeof MERGE;
  anchor?: string;
}

const MERGE = Symbol("merge");

interface AnchorEntry {
  done: boolean;
  value?: YamlValue;
  size: number;
  isMap: boolean;
}

function scalarValue(node: { value: unknown; source?: string }): YamlValue {
  const v = node.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : String(node.source ?? v);
  if (typeof v === "bigint") return v.toString();
  // timestamps, binary and other YAML 1.1 types: kept as their source text
  return typeof node.source === "string" ? node.source : String(v);
}

function keyString(node: unknown): string | typeof MERGE | undefined {
  if (!isScalar(node)) return undefined;
  const v = node.value;
  if (typeof v === "symbol") return v.description === "<<" ? MERGE : undefined;
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return typeof node.source === "string" ? node.source : undefined;
}

function defineKey(target: { [key: string]: YamlValue }, key: string, value: YamlValue): void {
  // defineProperty creates an own property even for `__proto__`: no prototype is ever changed.
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Converts one composed document to plain values with an explicit stack (no recursion), resolving
 * each alias to the latest preceding anchor of that name, sharing its value, and counting the
 * expanded size; refuses collection keys, duplicate keys, cyclic or unknown aliases and any
 * expansion over `maxNodes`.
 */
function convertDocument(doc: Document.Parsed, maxNodes: number): Converted {
  if (doc.errors.length > 0) {
    if (doc.errors.some((e) => e.code === "RESOURCE_EXHAUSTION"))
      return { ok: false, refusal: "too-deep", detail: "parser stack" };
    return { ok: false, refusal: "parse-error" };
  }
  const anchors = new Map<string, AnchorEntry>();
  let expanded = 0;
  let sawAlias = false;
  const over = (): Converted =>
    sawAlias ? { ok: false, refusal: "alias-limit" } : { ok: false, refusal: "too-large", detail: "document" };
  let result: YamlValue = null;
  const stack: Frame[] = [];

  // Returns a finished value for leaves and aliases, or undefined after pushing a frame.
  const enter = (node: unknown): { value: YamlValue; size: number } | Converted | undefined => {
    if (node === null || node === undefined) {
      expanded += 1;
      return { value: null, size: 1 };
    }
    if (isAlias(node)) {
      sawAlias = true;
      const entry = anchors.get(node.source);
      if (entry === undefined) return { ok: false, refusal: "parse-error", detail: "unknown alias" };
      if (!entry.done) return { ok: false, refusal: "alias-limit", detail: "cyclic alias" };
      expanded += entry.size;
      if (expanded > maxNodes) return over();
      return { value: entry.value as YamlValue, size: entry.size };
    }
    const anchor = (node as { anchor?: string }).anchor;
    if (isScalar(node)) {
      expanded += 1;
      const value = scalarValue(node);
      if (anchor) anchors.set(anchor, { done: true, value, size: 1, isMap: false });
      return { value, size: 1 };
    }
    if (isMap(node) || isSeq(node)) {
      expanded += 1;
      const frame: Frame = { node, size: 1, childIndex: 0 };
      if (isMap(node)) {
        frame.value = {};
        frame.keys = new Set();
        frame.merged = new Set();
      } else {
        frame.value = [];
      }
      if (anchor) {
        frame.anchor = anchor;
        anchors.set(anchor, { done: false, size: 0, isMap: isMap(node) });
      }
      stack.push(frame);
      return undefined;
    }
    return { ok: false, refusal: "parse-error", detail: "unsupported node" };
  };

  const isFailure = (r: unknown): r is Converted & { ok: false } =>
    typeof r === "object" && r !== null && "ok" in r && (r as { ok: unknown }).ok === false;

  // Attach a finished child to the frame on top of the stack (or make it the result).
  const attach = (value: YamlValue, size: number, fromMap: boolean): Converted | undefined => {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      result = value;
      return undefined;
    }
    top.size += size;
    if (Array.isArray(top.value)) {
      top.value.push(value);
      return undefined;
    }
    const target = top.value as { [key: string]: YamlValue };
    const key = top.pendingKey;
    top.pendingKey = undefined;
    if (key === MERGE) {
      // value is a mapping, or a sequence of mappings; earlier keys win, explicit keys win.
      const sources = Array.isArray(value) ? value : [value];
      if (!fromMap && !Array.isArray(value)) return { ok: false, refusal: "parse-error", detail: "merge value" };
      for (const src of sources) {
        if (src === null || typeof src !== "object" || Array.isArray(src)) {
          return { ok: false, refusal: "parse-error", detail: "merge value" };
        }
        for (const k of Object.keys(src)) {
          if (top.keys?.has(k)) continue;
          top.keys?.add(k);
          top.merged?.add(k);
          defineKey(target, k, src[k] as YamlValue);
        }
      }
      return undefined;
    }
    if (key === undefined) return { ok: false, refusal: "parse-error" };
    if (top.keys?.has(key)) {
      if (!top.merged?.has(key)) return { ok: false, refusal: "parse-error", detail: "duplicate key" };
      top.merged.delete(key);
    }
    top.keys?.add(key);
    defineKey(target, key, value);
    return undefined;
  };

  const first = enter(doc.contents);
  if (isFailure(first)) return first;
  if (first !== undefined) return { ok: true, value: (first as { value: YamlValue }).value };

  while (stack.length > 0) {
    const top = stack[stack.length - 1] as Frame;
    const items = (top.node as { items: unknown[] }).items;
    if (top.childIndex >= items.length) {
      stack.pop();
      if (top.anchor !== undefined) {
        const entry = anchors.get(top.anchor);
        if (entry !== undefined) {
          entry.done = true;
          entry.value = top.value;
          entry.size = top.size;
        }
      }
      const failed = attach(top.value as YamlValue, top.size, !Array.isArray(top.value));
      if (failed) return failed;
      continue;
    }
    const item = items[top.childIndex];
    top.childIndex += 1;
    let child: unknown = item;
    if (isPair(item)) {
      if (Array.isArray(top.value)) {
        // a pair inside a sequence (YAML 1.1 !!omap / !!pairs, or `- a: b` compact form)
        return { ok: false, refusal: "parse-error", detail: "pair in sequence" };
      }
      let keyNode: unknown = item.key;
      if (isAlias(keyNode)) {
        sawAlias = true;
        const entry = anchors.get(keyNode.source);
        if (entry === undefined || !entry.done) return { ok: false, refusal: "parse-error", detail: "alias key" };
        if (typeof entry.value === "object" && entry.value !== null) {
          return { ok: false, refusal: "parse-error", detail: "collection key" };
        }
        top.pendingKey = entry.value === null ? "null" : String(entry.value);
        keyNode = undefined;
      } else {
        const k = keyString(keyNode);
        if (k === undefined) return { ok: false, refusal: "parse-error", detail: "collection key" };
        top.pendingKey = k;
        const keyAnchor = (keyNode as { anchor?: string } | null)?.anchor;
        if (keyAnchor && isScalar(keyNode)) {
          anchors.set(keyAnchor, { done: true, value: scalarValue(keyNode), size: 1, isMap: false });
        }
      }
      expanded += 1;
      top.size += 1;
      if (expanded > maxNodes) return over();
      child = item.value;
    }
    const entered = enter(child);
    if (isFailure(entered)) return entered;
    if (expanded > maxNodes) return over();
    if (entered !== undefined) {
      const done = entered as { value: YamlValue; size: number };
      const fromMap = typeof done.value === "object" && done.value !== null && !Array.isArray(done.value);
      const failed = attach(done.value, done.size, fromMap);
      if (failed) return failed;
    }
  }
  return { ok: true, value: result };
}
