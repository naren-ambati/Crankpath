// RepoIdentity (U2, contract C5; BR2.12 to BR2.16, FR2.1 to FR2.6, ADR-008): the one rule that
// decides whether a repoURL may be read. A URL is readable only when it normalises equal to the
// scanned repo's own URL, or when `--repo-alias` (anywhere) or `repos:` (inside the root only)
// maps it. Equality is exact on the normalised form: never a prefix, a substring or a guess. An
// unreadable URL whose last path segment equals the scanned repo's name gets a suggested `repos:`
// entry, which is data and is never applied.

import type { RepoMapping } from "../u1-graph-model/declared-facts.js";
import type { RepoResolution } from "../u1-graph-model/extractor.js";
import { redactUrl } from "../u1-graph-model/safe-text.js";
import { readText, type ScanRoot } from "./bounded-reader.js";

// A URL holding a control, format or separator character, or a backslash, is never compared: the
// WHATWG parser would drop or rewrite those silently.
const REFUSED_CHARS = /[\p{Cc}\p{Cf}\p{Z}\\]/u;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
// scp-style `[user@]host:path`, where the path does not start with `//` and the host has no `/`.
const SCP = /^(?:[^@/]+@)?([^@/:[\]]+):(?!\/\/)(.*)$/s;
const DEFAULT_PORTS: Readonly<Record<string, string>> = Object.freeze({ https: "443", http: "80", ssh: "22" });

function normalisePath(raw: string): string | null {
  let p = raw;
  while (p.startsWith("/")) p = p.slice(1);
  while (p.endsWith("/")) p = p.slice(0, -1);
  const last = p.slice(p.lastIndexOf("/") + 1);
  if (last.endsWith(".git") && last.length > ".git".length) p = p.slice(0, -".git".length);
  while (p.endsWith("/")) p = p.slice(0, -1);
  if (p === "") return "";
  const segments = p.split("/");
  // Dot segments (plain or percent-encoded) and empty segments are refused rather than resolved:
  // two spellings of a path must not be made equal by crankpath.
  for (const s of segments) {
    if (s === "" || s === "." || s === "..") return null;
    if (/^(?:\.|%2e){1,2}$/i.test(s)) return null;
  }
  return p;
}

/**
 * The normal form of a repo URL (FR2.3): scheme and userinfo dropped for https, http, ssh and
 * scp-style forms; host lower-cased; the default port dropped and any other kept; leading and
 * trailing `/` and one trailing `.git` dropped; the path compared case-sensitively. Null for
 * anything else (another scheme, a query or fragment, dot segments, control characters).
 */
export function normaliseRepoUrl(raw: string): string | null {
  if (raw.length === 0 || REFUSED_CHARS.test(raw)) return null;
  if (raw.includes("?") || raw.includes("#")) return null;
  const scheme = SCHEME.exec(raw);
  if (scheme !== null) {
    const name = (scheme[1] as string).toLowerCase();
    if (!(name in DEFAULT_PORTS)) return null;
    // The raw path, before the URL parser resolves any dot segment.
    const afterScheme = raw.slice((scheme[0] as string).length);
    const slash = afterScheme.indexOf("/");
    const rawPath = slash === -1 ? "" : afterScheme.slice(slash);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (host === "") return null;
    const port = url.port === DEFAULT_PORTS[name] ? "" : url.port;
    if (normalisePath(rawPath) === null) return null;
    const p = normalisePath(url.pathname);
    if (p === null) return null;
    const authority = port === "" ? host : `${host}:${port}`;
    return p === "" ? authority : `${authority}/${p}`;
  }
  const scp = SCP.exec(raw);
  if (scp === null) return null;
  const host = (scp[1] as string).toLowerCase();
  if (host === "" || !/^[a-z0-9.-]+$/.test(host)) return null;
  const p = normalisePath(scp[2] as string);
  if (p === null) return null;
  return p === "" ? host : `${host}/${p}`;
}

/** The host of a repo URL (lower-case, no port), for host matching; null when it does not normalise. */
export function repoUrlHost(raw: string): string | null {
  const n = normaliseRepoUrl(raw);
  if (n === null) return null;
  const authority = n.split("/")[0] as string;
  const colon = authority.lastIndexOf(":");
  return colon === -1 ? authority : authority.slice(0, colon);
}

/** The last path segment of a normalised URL, or null when it has no path. */
export function lastSegment(normalised: string): string | null {
  const slash = normalised.indexOf("/");
  if (slash === -1) return null;
  return normalised.slice(normalised.lastIndexOf("/") + 1);
}

/**
 * The `origin` remote's URL from git config text, or null. A small reader of the git config
 * syntax: sections `[remote "origin"]` (and the old `[remote.origin]`), `url = value` with quotes,
 * escapes and comments. The first `url` wins. `include`, `includeIf` and `insteadOf` are not
 * followed: a URL they would produce is unknown to crankpath.
 */
export function originFromGitConfig(text: string): string | null {
  let inOrigin = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[")) {
      const m = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line);
      if (m === null) {
        inOrigin = false;
        continue;
      }
      const section = (m[1] as string).toLowerCase();
      const sub = m[2];
      inOrigin = (section === "remote" && sub === "origin") || (sub === undefined && section === "remote.origin");
      continue;
    }
    if (!inOrigin) continue;
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(line);
    if (kv === null || (kv[1] as string).toLowerCase() !== "url" || kv[2] === undefined) continue;
    const value = gitConfigValue(kv[2] as string);
    return value === "" ? null : value;
  }
  return null;
}

function gitConfigValue(raw: string): string {
  let out = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as string;
    if (c === "\\" && i + 1 < raw.length) {
      const n = raw[i + 1] as string;
      out += n === "n" ? "\n" : n === "t" ? "\t" : n === "b" ? "\b" : n;
      i += 1;
    } else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "#" || c === ";")) break;
    else out += c;
  }
  return out.trim();
}

/** The scanned repo's `origin` URL from `.git/config`, read through BoundedReader (git is never run). */
export function readOriginUrl(root: ScanRoot): string | null {
  const read = readText(root, ".git/config");
  return read.outcome === "ok" ? originFromGitConfig(read.text) : null;
}

/** The label prefix of a root mapped by `repos:` in crankpath.yaml; `--repo-alias` roots are `alias:N`. */
export const REPOS_LABEL = "repos:";
/** A path segment spelled like an alias label (`alias:1`): shown with a `./` prefix so it never reads as one. */
export const ALIAS_LABEL = /^alias:\d+$/;

export interface RepoAlias {
  /** The URL as given on the command line. */
  readonly url: string;
  readonly normalised: string;
  /** `alias:N`, numbered in command-line order from 1. */
  readonly label: string;
}

export type ScannedUrlFrom = "flag" | "git-config";

export interface ScannedRepo {
  /** The URL as given or read (may hold userinfo: print only through SafeText's URL functions). */
  readonly url: string | null;
  readonly normalised: string | null;
  /** The last path segment of the normalised URL: the scanned repo's name, for suggestions. */
  readonly name: string | null;
  readonly from: ScannedUrlFrom | null;
}

export interface RepoIdentity {
  readonly scanned: ScannedRepo;
  readonly aliases: readonly RepoAlias[];
  resolve(url: string): RepoResolution;
}

export interface RepoIdentityInput {
  readonly scannedUrl: string | null;
  readonly scannedFrom: ScannedUrlFrom | null;
  readonly aliases: readonly RepoAlias[];
  /** `repos:` entries from crankpath.yaml, already confined to the root by ConfigReader. */
  readonly mappings: readonly RepoMapping[];
}

/** Builds the resolver. Precedence: `--repo-alias`, then the scanned URL, then `repos:`. */
export function createRepoIdentity(input: RepoIdentityInput): RepoIdentity {
  const normalised = input.scannedUrl === null ? null : normaliseRepoUrl(input.scannedUrl);
  const scanned: ScannedRepo = Object.freeze({
    url: input.scannedUrl,
    normalised,
    name: normalised === null ? null : lastSegment(normalised),
    from: input.scannedUrl === null ? null : input.scannedFrom,
  });
  const aliases = Object.freeze([...input.aliases]);
  const mappings = [...input.mappings];
  const resolve = (url: string): RepoResolution => {
    const n = normaliseRepoUrl(url);
    if (n === null)
      return Object.freeze({ outcome: "unreadable", root: null, via: "not-comparable", suggestion: null });
    const alias = aliases.find((a) => a.normalised === n);
    if (alias !== undefined)
      return Object.freeze({ outcome: "alias", root: alias.label, via: "repo-alias", suggestion: null });
    if (normalised !== null && n === normalised) {
      return Object.freeze({ outcome: "self", root: ".", via: "scanned-url", suggestion: null });
    }
    const mapping = mappings.find((m) => m.normalised === n);
    if (mapping !== undefined) {
      if (mapping.readFrom !== null) {
        // `repos:` roots live in their own label space (`repos:<path>`), so a repo-supplied entry can
        // never name, override or shadow a `--repo-alias` root (`alias:N`).
        const root = mapping.readFrom === "" ? "." : `${REPOS_LABEL}${mapping.readFrom}`;
        return Object.freeze({ outcome: "alias", root, via: "repos-read-from", suggestion: null });
      }
      return Object.freeze({ outcome: "unreadable", root: null, via: "repos-fetch", suggestion: null });
    }
    const last = lastSegment(n);
    const suggestion =
      scanned.name !== null && last !== null && last === scanned.name
        ? Object.freeze({ url: redactUrl(url) ?? n, readFrom: "." })
        : null;
    return Object.freeze({ outcome: "unreadable", root: null, via: "none", suggestion });
  };
  return Object.freeze({ scanned, aliases, resolve });
}

export type AliasParse =
  | { readonly ok: true; readonly url: string; readonly normalised: string; readonly path: string }
  | { readonly ok: false; readonly problem: "no-equals" | "not-comparable" | "empty-path" };

/** Parses one `--repo-alias <url>=<path>` value, split at the first `=`. */
export function parseRepoAlias(value: string): AliasParse {
  const eq = value.indexOf("=");
  if (eq <= 0) return { ok: false, problem: "no-equals" };
  const url = value.slice(0, eq);
  const p = value.slice(eq + 1);
  if (p === "") return { ok: false, problem: "empty-path" };
  const normalised = normaliseRepoUrl(url);
  if (normalised === null) return { ok: false, problem: "not-comparable" };
  return { ok: true, url, normalised, path: p };
}
