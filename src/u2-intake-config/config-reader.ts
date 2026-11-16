// ConfigReader (U2, contract C2; BR2.5 to BR2.7, FR6.1, FR6.7, ADR-015): reads `crankpath.yaml`
// through BoundedReader and validates the whole key set strictly by hand (no schema library, OD-20).
// An unknown key, a duplicate key or a wrong type is an error naming the key path; nothing is
// analysed with a half-read file. Because the scanned repo supplies this file, it has limited
// authority: a `repos:` mapping or a `render:<path>` must stay inside the scanned root, and no
// value may name an environment variable. An absent file means no declared facts.

import path from "node:path";
import { parseDocument, isMap, isPair, isScalar, isSeq } from "yaml";
import type {
  ClusterDecl,
  ConfigDocument,
  CrankDecl,
  CrankReroute,
  CrankTarget,
  DeclaredEdge,
  ExternalDecl,
  MatchRule,
  RepoMapping,
} from "../u1-graph-model/declared-facts.js";
import { NO_DECLARED_FACTS } from "../u1-graph-model/declared-facts.js";
import { externalId, isNodeId, isValidExternalName } from "../u1-graph-model/graph-model.js";
import { type DerivedLimit, LIMITS, limitValue } from "../u1-graph-model/limits.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import {
  canonicalPath,
  openRoot,
  parseYamlBounded,
  REASON_WORDS,
  readText,
  type ScanRoot,
  type YamlValue,
} from "./bounded-reader.js";
import { ALIAS_LABEL, normaliseRepoUrl } from "./repo-identity.js";
import { checkDirectory } from "./tree-walk.js";

export const CONFIG_FILE = "crankpath.yaml";

/** crankpath's fixed wording for what is wrong at a key path. */
export type ConfigProblem =
  | "unknown key"
  | "duplicate key"
  | "expected a mapping"
  | "expected a list"
  | "expected a string"
  | "expected true"
  | "expected available or unavailable"
  | "needs cold_start or served_by, not both"
  | "empty"
  | "not a node id"
  | "not a node id or external name"
  | "not an external name"
  | "not a host pattern"
  | "not a URL crankpath can compare"
  | "same repository as another entry"
  | "needs read_from or fetch, not both"
  | "outside the scanned root"
  | "names an environment variable"
  | "not a directory inside the scanned root"
  | "names a --repo-alias label"
  | "a crank needs by"
  | "a crank needs creates or reroutes"
  | "more than one document"
  | "not readable"
  | "more entries than the limit";

export interface ConfigError {
  /** The key path in crankpath's notation (`edges[0].from`, `repos."<url>".read_from`); null for the file. */
  readonly keyPath: string | null;
  readonly problem: ConfigProblem;
  /** For an unreadable file: BoundedReader's fixed reason word. */
  readonly reasonWord?: string;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: ConfigDocument }
  | { readonly ok: false; readonly error: ConfigError };

class Invalid extends Error {
  constructor(
    readonly keyPath: string,
    readonly problem: ConfigProblem,
  ) {
    super(problem);
  }
}

type Obj = { [key: string]: YamlValue };

function isObj(v: YamlValue | undefined): v is Obj {
  return v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v);
}

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function keyPathOf(base: string, key: string): string {
  const part = PLAIN_KEY.test(key) ? key : JSON.stringify(key);
  return base === "" ? part : `${base}.${part}`;
}

function obj(v: YamlValue | undefined, at: string): Obj {
  if (!isObj(v)) throw new Invalid(at, "expected a mapping");
  return v;
}

function allowKeys(o: Obj, at: string, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new Invalid(keyPathOf(at, k), "unknown key");
}

function list(v: YamlValue | undefined, at: string): YamlValue[] {
  if (!Array.isArray(v)) throw new Invalid(at, "expected a list");
  return v;
}

function str(v: YamlValue | undefined, at: string): string {
  if (typeof v !== "string") throw new Invalid(at, "expected a string");
  if (v.length === 0) throw new Invalid(at, "empty");
  return v;
}

// `$NAME`, `${NAME}`, `%NAME%`, or a leading `~`: a value that would select something from the
// environment of whoever runs crankpath (FR6.7).
const ENV_REFERENCE = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_][A-Za-z0-9_]*%|^~/;

function insidePath(v: string, at: string): string {
  if (ENV_REFERENCE.test(v)) throw new Invalid(at, "names an environment variable");
  if (v === "." || v === "./") return "";
  const canon = canonicalPath(v);
  if (!canon.ok) {
    if (canon.refusal.outcome === "traversal") throw new Invalid(at, "outside the scanned root");
    return "";
  }
  return canon.path;
}

function nodeRef(v: YamlValue | undefined, at: string): string {
  const s = str(v, at);
  if (!isNodeId(s)) throw new Invalid(at, "not a node id");
  return s;
}

function readExternals(v: YamlValue | undefined): ExternalDecl[] {
  if (v === undefined) return [];
  const o = obj(v, "external");
  const out: ExternalDecl[] = [];
  for (const name of Object.keys(o)) {
    const at = keyPathOf("external", name);
    const id = externalId(name);
    if (id === undefined) throw new Invalid(at, "not an external name");
    const body = o[name];
    let coldStart: ExternalDecl["coldStart"] = "unspecified";
    let servedBy: string | null = null;
    if (body !== null) {
      const b = obj(body, at);
      allowKeys(b, at, ["cold_start", "served_by"]);
      if (b.cold_start !== undefined) {
        const c = str(b.cold_start, keyPathOf(at, "cold_start"));
        if (c !== "available" && c !== "unavailable") {
          throw new Invalid(keyPathOf(at, "cold_start"), "expected available or unavailable");
        }
        coldStart = c;
      }
      if (b.served_by !== undefined) servedBy = nodeRef(b.served_by, keyPathOf(at, "served_by"));
      // Both would say two things at once: available at cold start, and only as available as the
      // node serving it. Refused rather than resolved by a precedence crankpath would invent.
      if (b.cold_start !== undefined && b.served_by !== undefined)
        throw new Invalid(at, "needs cold_start or served_by, not both");
    }
    out.push(Object.freeze({ name, id, coldStart, servedBy, keyPath: at }));
  }
  return out.sort((a, b) => compareCodePoints(a.name, b.name));
}

const HOST_PATTERN = /^[A-Za-z0-9*](?:[A-Za-z0-9*.-]{0,251}[A-Za-z0-9*])?$/;

function readMatches(v: YamlValue | undefined): MatchRule[] {
  if (v === undefined) return [];
  return list(v, "match").map((item, i) => {
    const at = `match[${i}]`;
    const o = obj(item, at);
    allowKeys(o, at, ["host", "node"]);
    const host = str(o.host, `${at}.host`);
    if (!HOST_PATTERN.test(host)) throw new Invalid(`${at}.host`, "not a host pattern");
    const node = str(o.node, `${at}.node`);
    if (!isNodeId(node) && !isValidExternalName(node))
      throw new Invalid(`${at}.node`, "not a node id or external name");
    return Object.freeze({ host, node, order: i, keyPath: at });
  });
}

function readRepos(v: YamlValue | undefined, root: ScanRoot): RepoMapping[] {
  if (v === undefined) return [];
  const o = obj(v, "repos");
  const out: RepoMapping[] = [];
  const seen = new Map<string, string>();
  for (const url of Object.keys(o)) {
    const at = keyPathOf("repos", url);
    if (ENV_REFERENCE.test(url)) throw new Invalid(at, "names an environment variable");
    const normalised = normaliseRepoUrl(url);
    if (normalised === null) throw new Invalid(at, "not a URL crankpath can compare");
    if (seen.has(normalised)) throw new Invalid(at, "same repository as another entry");
    seen.set(normalised, at);
    const b = obj(o[url], at);
    allowKeys(b, at, ["read_from", "fetch"]);
    const hasRead = b.read_from !== undefined;
    const hasFetch = b.fetch !== undefined;
    if (hasRead === hasFetch) throw new Invalid(at, "needs read_from or fetch, not both");
    if (hasFetch) {
      if (b.fetch !== true) throw new Invalid(keyPathOf(at, "fetch"), "expected true");
      out.push(Object.freeze({ url, normalised, readFrom: null, fetch: true, keyPath: at }));
      continue;
    }
    const readAt = keyPathOf(at, "read_from");
    const readFrom = insidePath(str(b.read_from, readAt), readAt);
    if (ALIAS_LABEL.test(readFrom.split("/")[0] ?? "")) throw new Invalid(readAt, "names a --repo-alias label");
    const dir = checkDirectory(root, readFrom);
    if (!dir.ok) throw new Invalid(readAt, "not a directory inside the scanned root");
    out.push(Object.freeze({ url, normalised, readFrom, fetch: false, keyPath: at }));
  }
  return out.sort((a, b) => compareCodePoints(a.normalised, b.normalised));
}

function readEdges(v: YamlValue | undefined): DeclaredEdge[] {
  if (v === undefined) return [];
  return list(v, "edges").map((item, i) => {
    const at = `edges[${i}]`;
    const o = obj(item, at);
    allowKeys(o, at, ["from", "to", "why"]);
    return Object.freeze({
      from: nodeRef(o.from, `${at}.from`),
      to: nodeRef(o.to, `${at}.to`),
      why: str(o.why, `${at}.why`),
      keyPath: at,
    });
  });
}

function crankTarget(v: YamlValue | undefined, at: string): CrankTarget {
  const s = str(v, at);
  if (s.startsWith("render:"))
    return Object.freeze({ kind: "render", path: insidePath(s.slice("render:".length), at) });
  if (!isNodeId(s)) throw new Invalid(at, "not a node id");
  return Object.freeze({ kind: "node", node: s });
}

function crankReroute(v: YamlValue | undefined, at: string): CrankReroute {
  const o = obj(v, at);
  allowKeys(o, at, ["node", "to"]);
  const node = nodeRef(o.node, `${at}.node`);
  const to = str(o.to, `${at}.to`);
  if (!isValidExternalName(to)) throw new Invalid(`${at}.to`, "not an external name");
  return Object.freeze({ node, to });
}

function readCranks(v: YamlValue | undefined): CrankDecl[] {
  if (v === undefined) return [];
  return list(v, "cranks").map((item, i) => {
    const at = `cranks[${i}]`;
    const o = obj(item, at);
    allowKeys(o, at, ["creates", "reroutes", "by", "ref"]);
    if (o.by === undefined) throw new Invalid(at, "a crank needs by");
    const by = str(o.by, `${at}.by`);
    const creates =
      o.creates === undefined
        ? []
        : Array.isArray(o.creates)
          ? o.creates.map((c, j) => crankTarget(c, `${at}.creates[${j}]`))
          : [crankTarget(o.creates, `${at}.creates`)];
    const reroutes =
      o.reroutes === undefined
        ? []
        : Array.isArray(o.reroutes)
          ? o.reroutes.map((r, j) => crankReroute(r, `${at}.reroutes[${j}]`))
          : [crankReroute(o.reroutes, `${at}.reroutes`)];
    if (creates.length === 0 && reroutes.length === 0) throw new Invalid(at, "a crank needs creates or reroutes");
    const ref = o.ref === undefined ? null : str(o.ref, `${at}.ref`);
    return Object.freeze({
      id: `crank:${i + 1}`,
      creates: Object.freeze(creates),
      reroutes: Object.freeze(reroutes),
      by,
      ref,
      keyPath: at,
    });
  });
}

function stringMap(v: YamlValue | undefined, at: string): Readonly<Record<string, string>> {
  if (v === undefined) return Object.freeze({});
  const o = obj(v, at);
  const out: Record<string, string> = {};
  for (const k of Object.keys(o).sort(compareCodePoints)) {
    const value = o[k];
    if (typeof value !== "string") throw new Invalid(keyPathOf(at, k), "expected a string");
    Object.defineProperty(out, k, { value, enumerable: true });
  }
  return Object.freeze(out);
}

function readClusters(v: YamlValue | undefined): ClusterDecl[] {
  if (v === undefined) return [];
  const o = obj(v, "clusters");
  const out: ClusterDecl[] = [];
  for (const name of Object.keys(o)) {
    const at = keyPathOf("clusters", name);
    const b = o[name] === null ? {} : obj(o[name], at);
    allowKeys(b, at, ["labels", "annotations"]);
    out.push(
      Object.freeze({
        name,
        labels: stringMap(b.labels, keyPathOf(at, "labels")),
        annotations: stringMap(b.annotations, keyPathOf(at, "annotations")),
        keyPath: at,
      }),
    );
  }
  return out.sort((a, b) => compareCodePoints(a.name, b.name));
}

const TOP_KEYS = ["external", "match", "repos", "edges", "cranks", "clusters"] as const;

/**
 * Every entry of every section, counted (review M3): the scanned repo controls these counts, so
 * they are held to the derived `declaredEntries` limit.
 */
export function countEntries(c: ConfigDocument): number {
  let n = c.externals.length + c.matches.length + c.repos.length + c.edges.length + c.clusters.length;
  for (const k of c.cranks) n += 1 + k.creates.length + k.reroutes.length;
  for (const cl of c.clusters) n += Object.keys(cl.labels).length + Object.keys(cl.annotations).length;
  return n;
}

/** Validates one parsed document (null = an empty file) against C2. `scanned` is the scanned root. */
export function validateConfig(
  doc: YamlValue,
  file: string,
  scanned: ScanRoot,
  entryLimit: DerivedLimit<"entries"> = LIMITS.declaredEntries,
): ConfigResult {
  if (doc === null) return { ok: true, config: { ...NO_DECLARED_FACTS, file } };
  try {
    if (!isObj(doc)) throw new Invalid("", "expected a mapping");
    allowKeys(doc, "", TOP_KEYS);
    const config: ConfigDocument = Object.freeze({
      file,
      externals: Object.freeze(readExternals(doc.external)),
      matches: Object.freeze(readMatches(doc.match)),
      repos: Object.freeze(readRepos(doc.repos, scanned)),
      edges: Object.freeze(readEdges(doc.edges)),
      cranks: Object.freeze(readCranks(doc.cranks)),
      clusters: Object.freeze(readClusters(doc.clusters)),
    });
    if (countEntries(config) > limitValue(entryLimit))
      return { ok: false, error: { keyPath: null, problem: "more entries than the limit" } };
    return { ok: true, config };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: { keyPath: e.keyPath, problem: e.problem } };
    throw e;
  }
}

/**
 * The key path of the first duplicate key, found by one linear walk of the composed document (the
 * text has already passed BoundedReader's limits; aliases are not followed). Null when none is found.
 */
export function duplicateKeyPath(text: string): string | null {
  const doc = parseDocument(text, { version: "1.1", uniqueKeys: false, logLevel: "silent" });
  const stack: { node: unknown; at: string }[] = [{ node: doc.contents, at: "" }];
  while (stack.length > 0) {
    const { node, at } = stack.pop() as { node: unknown; at: string };
    if (isMap(node)) {
      const seen = new Set<string>();
      for (const item of node.items) {
        if (!isPair(item) || !isScalar(item.key)) continue;
        const key = String(item.key.value);
        if (key === "<<") continue;
        const p = keyPathOf(at, key);
        if (seen.has(key)) return p;
        seen.add(key);
        stack.push({ node: item.value, at: p });
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => {
        stack.push({ node: item, at: `${at}[${i}]` });
      });
    }
  }
  return null;
}

export interface ConfigLocation {
  /** The directory holding the file (the scanned root by default) and the file's name in it. */
  readonly dir: ScanRoot;
  readonly name: string;
  /** The label used in evidence and output: `crankpath.yaml` or the `--config` base name. */
  readonly label: string;
  /** True when the file was named by `--config` (absent is then an error, not empty facts). */
  readonly explicit: boolean;
}

/**
 * Where to read the config: `<root>/crankpath.yaml`, or the `--config` path resolved against the
 * invoker's working directory (opened by its directory).
 */
export function configLocation(
  scanned: ScanRoot,
  configPath: string | undefined,
  cwd: string,
): ConfigLocation | ConfigError {
  if (configPath === undefined) return { dir: scanned, name: CONFIG_FILE, label: CONFIG_FILE, explicit: false };
  const abs = path.resolve(cwd, configPath);
  const dir = openRoot(path.dirname(abs));
  if (!dir.ok) return { keyPath: null, problem: "not readable", reasonWord: "not found" };
  const name = path.basename(abs);
  return { dir: dir.root, name, label: name, explicit: true };
}

/** Reads and validates the config at its location. An absent default file is no declared facts. */
export function readConfig(
  location: ConfigLocation,
  scanned: ScanRoot,
  entryLimit: DerivedLimit<"entries"> = LIMITS.declaredEntries,
): ConfigResult {
  const text = readText(location.dir, location.name);
  if (text.outcome === "not-found" && !location.explicit) return { ok: true, config: NO_DECLARED_FACTS };
  if (text.outcome !== "ok")
    return { ok: false, error: { keyPath: null, problem: "not readable", reasonWord: text.reasonWord } };
  const parsed = parseYamlBounded(text.text);
  if (!parsed.ok) {
    if (parsed.detail === "duplicate key") {
      const at = duplicateKeyPath(text.text);
      if (at !== null) return { ok: false, error: { keyPath: at, problem: "duplicate key" } };
      return { ok: false, error: { keyPath: null, problem: "duplicate key" } };
    }
    return { ok: false, error: { keyPath: null, problem: "not readable", reasonWord: REASON_WORDS[parsed.refusal] } };
  }
  const docs = parsed.documents;
  if (docs.length > 1) return { ok: false, error: { keyPath: null, problem: "more than one document" } };
  return validateConfig(docs[0] ?? null, location.label, scanned, entryLimit);
}
