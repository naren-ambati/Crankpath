// RepoFetcher (U4; FR1.2, FR1.8, NFR1, NFR10, NFR11, BR4.11 to BR4.13, OD-9, OD-10, OD-12, C13):
// the read-only shallow fetch of one repository named by the command line (`crankpath <url>
// --rev <rev>`) or by a `repos: {"<url>": {fetch: true}}` entry, into
// `.crankpath/repos/<host>/<path>@<sha>/`.
//
// - The URL guard runs before any process: https only; a host by name (no IP literal in any
//   spelling, no loopback, link-local, `.local`, `.internal`, `.svc`, `.cluster.local` or
//   single-label name, and no name outside the delegated top-level domains, each of which could
//   only reach a host inside some network); no credential, query or
//   fragment in the URL; ASCII only (a non-ASCII host is refused; an IDN host given in its ASCII
//   `xn--` form is an ordinary name and is admitted under the same rules).
//   A host that resolves to a private address (DNS rebinding) is a stated residual risk: the guard
//   sees names, not addresses.
// - One attempt, no redirects, no submodules, no hooks (git-runner.ts: the fixed options).
// - A token comes only from CRANKPATH_TOKEN_<HOST> (the host upper-cased, `.` to `_`, `-` to `__`;
//   every label is a DNS label, so two hosts never share a variable), and only for that host: it is
//   sent as an `Authorization` header scoped to `https://<host>[:port]/`, through the environment
//   of that one call, never through argv, and never printed, cached or logged. crankpath.yaml has
//   no key that names a variable.
// - The resolved commit is recorded; a branch, a tag or the default branch is `floating` (OD-12).
// - A refusal, a 401, 403, 404, 429, a timeout or `--no-network` is a fetch outcome with fixed
//   words (unknown: the repository may exist), never "gone" and never a pass.
// - The cache holds object stores only (`git clone --bare`), never a tree crankpath reads (B3 review
//   pass 2, M1). Whatever cache location, a cached store is read only after git has verified it:
//   its well-named object files (and nothing else: no config, hooks, alternates or refs) are copied
//   into a private git directory of the run that crankpath writes itself, `git fsck --strict`
//   passes and `HEAD^{commit}` is the commit asked for; the commit's files are then written by
//   `checkout-index` into the run's own directory, with the repository's attributes off, and only
//   that directory is scanned. A store that fails is discarded and refetched (or `offline` under
//   `--no-network`). A fresh fetch goes through the same verification.
// - A cache root inside the scanned tree is the tree's own `.crankpath` and is not trusted (the
//   scanned repo could have committed it): nothing cached there is read, and a fetch made there is
//   used for this run only and removed at its end.
// - One run makes at most fetchesPerRun fetches (M2), the command line's URL and every `repos:`
//   entry together, each bounded by repoFetchWallClock; a fetch past that is a counted `limit`.

import fs from "node:fs";
import path from "node:path";
import { LIMITS } from "../u1-graph-model/limits.js";
import { normaliseRepoUrl } from "../u2-intake-config/repo-identity.js";
import { ROOT_ZONE_TLDS } from "../u6-extractors-workload/root-zone-tlds.js";
import { createGitRunner, type GitResult, type GitRunner, type GitSpawn } from "./git-runner.js";
import type { WorkDir } from "./work-dir.js";

export type GitUrlProblem =
  | "unparseable"
  | "scheme"
  | "credential"
  | "query"
  | "ip-literal"
  | "loopback"
  | "internal"
  | "not-ascii"
  | "special-use"
  | "path";

/** crankpath's fixed wording for each refusal (never with the URL's own text). */
export const GIT_URL_PROBLEM_WORDS: Readonly<Record<GitUrlProblem, string>> = Object.freeze({
  unparseable: "not a URL crankpath can read",
  scheme: "only https repositories are fetched",
  credential: "a URL holding a credential is never used (a token comes from CRANKPATH_TOKEN_<HOST> only)",
  query: "a URL with a query or fragment is never used",
  "ip-literal": "an IP address is never fetched from (a host name is required)",
  loopback: "a loopback or link-local host is never fetched from",
  internal:
    "a host that can only be inside a network (one label, .svc, .cluster.local, .internal, or no delegated top-level domain) is never fetched from",
  "not-ascii": "a host or path outside ASCII is never fetched from",
  "special-use":
    "a special-use domain name (IANA registry: .local, .test, .example, .invalid, .onion, home.arpa and others) is never fetched from",
  path: "a repository path with an empty, dot or hidden segment is never fetched from",
});

export type GuardedGitUrl =
  | {
      readonly ok: true;
      /** The URL git is given: `https://<host>[:port]/<path>`. */
      readonly url: string;
      /** `https://<host>[:port]/`: the one origin a token may be sent to. */
      readonly origin: string;
      /** The lower-cased host name, without the port. */
      readonly host: string;
      /** A port other than 443, or null. */
      readonly port: string | null;
      /** The normalised identity (FR2.3), for the cache key and for RepoIdentity. */
      readonly normalised: string;
    }
  | { readonly ok: false; readonly problem: GitUrlProblem };

const DNS_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * IANA "Special-Use Domain Names" registry (updated 2026-05-22, fetched 2026-11-15,
 * docs/lookups.md): names that never reach a public host by design. A host equal to one, or under
 * one, is never fetched from (B3 review m4); so is anything under `arpa` (no repository is served
 * there); `internal` (reserved by ICANN for private use) is refused as internal, below.
 */
export const SPECIAL_USE_NAMES: readonly string[] = Object.freeze([
  "alt",
  "6tisch.arpa",
  "eap.arpa",
  "eap-noob.arpa",
  "home.arpa",
  "10.in-addr.arpa",
  "254.169.in-addr.arpa",
  "16.172.in-addr.arpa",
  "17.172.in-addr.arpa",
  "18.172.in-addr.arpa",
  "19.172.in-addr.arpa",
  "20.172.in-addr.arpa",
  "21.172.in-addr.arpa",
  "22.172.in-addr.arpa",
  "23.172.in-addr.arpa",
  "24.172.in-addr.arpa",
  "25.172.in-addr.arpa",
  "26.172.in-addr.arpa",
  "27.172.in-addr.arpa",
  "28.172.in-addr.arpa",
  "29.172.in-addr.arpa",
  "30.172.in-addr.arpa",
  "31.172.in-addr.arpa",
  "170.0.0.192.in-addr.arpa",
  "171.0.0.192.in-addr.arpa",
  "168.192.in-addr.arpa",
  "8.e.f.ip6.arpa",
  "9.e.f.ip6.arpa",
  "a.e.f.ip6.arpa",
  "b.e.f.ip6.arpa",
  "ipv4only.arpa",
  "resolver.arpa",
  "service.arpa",
  "example",
  "example.com",
  "example.net",
  "example.org",
  "invalid",
  "local",
  "localhost",
  "onion",
  "test",
]);
const EXTRA_REFUSED_SUFFIXES: readonly string[] = Object.freeze(["arpa"]);

function specialUse(host: string): boolean {
  return [...SPECIAL_USE_NAMES, ...EXTRA_REFUSED_SUFFIXES].some((n) => host === n || host.endsWith(`.${n}`));
}
const NUMERIC = /^(?:0x[0-9a-f]*|[0-9]+)$/i;

/** Checks a URL crankpath itself would fetch with git. Never throws. */
export function guardGitUrl(raw: string): GuardedGitUrl {
  if (raw.length === 0 || raw.length > 2048) return { ok: false, problem: "unparseable" };
  if (!/^[\x21-\x7e]+$/.test(raw)) return { ok: false, problem: "not-ascii" };
  if (!raw.toLowerCase().startsWith("https://")) return { ok: false, problem: "scheme" };
  if (raw.includes("?") || raw.includes("#")) return { ok: false, problem: "query" };
  if (raw.includes("\\")) return { ok: false, problem: "unparseable" };
  const rest = raw.slice("https://".length);
  const slash = rest.indexOf("/");
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const rawPath = slash === -1 ? "" : rest.slice(slash + 1);
  if (authority.includes("@")) return { ok: false, problem: "credential" };
  if (authority.includes("%")) return { ok: false, problem: "unparseable" };
  if (authority.startsWith("[")) return { ok: false, problem: "ip-literal" };
  const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(authority);
  if (m === null) return { ok: false, problem: "unparseable" };
  const host = (m[1] as string).toLowerCase();
  const port = m[2];
  // a port is a number: `:0443` is 443 and `:08443` is 8443 before it names a token or an origin (n2)
  const portNumber = port === undefined ? 443 : Number(port);
  if (portNumber < 1 || portNumber > 65535) return { ok: false, problem: "unparseable" };
  const labels = host.split(".");
  // any all-numeric or hex-looking last label is an address in some resolver's reading
  if (labels.every((l) => NUMERIC.test(l)) || NUMERIC.test(labels[labels.length - 1] as string)) {
    return { ok: false, problem: "ip-literal" };
  }
  if (!labels.every((l) => DNS_LABEL.test(l))) return { ok: false, problem: "unparseable" };
  if (host.endsWith(".cluster.local")) return { ok: false, problem: "internal" };
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, problem: "loopback" };
  if (host.endsWith(".local")) return { ok: false, problem: "loopback" };
  if (specialUse(host)) return { ok: false, problem: "special-use" };
  if (host === "ip6-localhost" || host === "ip6-loopback" || host.endsWith(".localdomain")) {
    return { ok: false, problem: "loopback" };
  }
  // a name not under a delegated top-level domain (the dated root-zone list B4 committed) can only
  // be resolved inside some network: `gitea-http.gitea`, `forge.lan`, `x.corp`
  if (
    labels.length < 2 ||
    labels.includes("svc") ||
    host.endsWith(".cluster.local") ||
    host.endsWith(".internal") ||
    !ROOT_ZONE_TLDS.has(labels[labels.length - 1] as string)
  ) {
    return { ok: false, problem: "internal" };
  }
  const segments = rawPath.replace(/\/+$/, "").split("/");
  // a percent-encoded control character (`%00` to `%1f`, `%7f`: CR LF among them) is refused too (n1)
  if (
    rawPath === "" ||
    segments.some((s) => s === "" || s.startsWith(".") || /%2e/i.test(s.slice(0, 3)) || /%(?:[01][0-9a-f]|7f)/i.test(s))
  ) {
    return { ok: false, problem: "path" };
  }
  const authorityOut = portNumber === 443 ? host : `${host}:${portNumber}`;
  const url = `https://${authorityOut}/${segments.join("/")}`;
  const normalised = normaliseRepoUrl(url);
  if (normalised === null) return { ok: false, problem: "unparseable" };
  return {
    ok: true,
    url,
    origin: `https://${authorityOut}/`,
    host,
    port: portNumber === 443 ? null : String(portNumber),
    normalised,
  };
}

/**
 * The one environment variable a host's token is read from (OD-9; B3 review m1: host and port):
 * `CRANKPATH_TOKEN_<HOST>` for the default port, `CRANKPATH_TOKEN_<HOST>_<PORT>` for another, so a
 * token never goes to another port of its host. Injective over what the guard admits: a label
 * never starts or ends with `-` (so `.` is a lone `_` and `-` an even run), and the last label is
 * a delegated top-level domain, never all digits, so the port suffix cannot be read as a label.
 */
export function tokenVariable(host: string, port: string | null = null): string {
  const name = host.toUpperCase().replace(/-/g, "__").replace(/\./g, "_");
  return port === null ? `CRANKPATH_TOKEN_${name}` : `CRANKPATH_TOKEN_${name}_${port}`;
}

/** The `Authorization` header for a token (Basic, as git sends a password; the user name is fixed). */
export function authHeader(token: string): string {
  return `Authorization: Basic ${Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")}`;
}

export type RevPlan =
  | {
      readonly ok: true;
      readonly kind: "default" | "branch" | "ref" | "sha";
      readonly value: string | null;
      readonly floating: boolean;
    }
  | { readonly ok: false; readonly problem: "abbreviated" | "invalid" };

/**
 * How a revision is fetched: none or `HEAD`, the default branch (floating); a full sha, that
 * commit (pinned); `refs/heads/...` or `refs/tags/...`, that ref (floating); another name, a
 * branch or tag of that name (floating). An abbreviated sha cannot be fetched (a server serves
 * full object names only) and is refused rather than read as a name.
 */
export function planRevision(rev: string | null): RevPlan {
  if (rev === null || rev === "HEAD") return { ok: true, kind: "default", value: null, floating: true };
  if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(rev)) return { ok: true, kind: "sha", value: rev, floating: false };
  if (/^[0-9a-f]{4,39}$/.test(rev)) return { ok: false, problem: "abbreviated" };
  if (rev.length === 0 || rev.length > 255 || !/^[A-Za-z0-9._/-]+$/.test(rev) || rev.startsWith("-")) {
    return { ok: false, problem: "invalid" };
  }
  if (rev.includes("..") || rev.includes("//") || rev.endsWith("/") || rev.endsWith(".lock") || rev.endsWith(".")) {
    return { ok: false, problem: "invalid" };
  }
  if (rev.split("/").some((s) => s.startsWith("."))) return { ok: false, problem: "invalid" };
  if (rev.startsWith("refs/heads/") || rev.startsWith("refs/tags/"))
    return { ok: true, kind: "ref", value: rev, floating: true };
  return { ok: true, kind: "branch", value: rev, floating: true };
}

export type FetchResult =
  | {
      readonly ok: true;
      /** The real path of the files materialised from the verified commit, in the run's own directory (a scan root). */
      readonly dir: string;
      readonly commit: string;
      readonly floating: boolean;
      /** True when a trusted cache already held the pinned commit and it passed verification (no network used). */
      readonly cached: boolean;
      /**
       * Paths of the commit (relative, as git lists them) not written, because another path of it
       * names the same file on a case-insensitive or normalising file system (B3 review pass 3,
       * m1): each is reported as an unreadable file, a counted gap, on every platform.
       */
      readonly collisions: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: "unreadable-repo" | "offline" | "tool-missing" | "limit";
      readonly detail: string;
    };

/**
 * What the fetcher needs of the run's WorkDir (work-dir.ts, C13): the cache root, whether it is
 * trusted, and a new private directory inside the run directory, removed with it at the end of the
 * run in every outcome.
 */
export type FetchWork = Pick<WorkDir, "cacheRoot" | "trusted" | "makeDir">;

export interface FetcherConfig {
  /** The run's WorkDir: `.crankpath` (or `--cache-dir`); a cache inside the scanned tree is untrusted. */
  readonly work: FetchWork;
  /** `--no-network` makes this false: only a trusted cache of a pinned commit is used. */
  readonly network: boolean;
  /** Reads one environment variable (only CRANKPATH_TOKEN_<HOST>[_<PORT>] names are ever asked for). */
  readonly env: (name: string) => string | undefined;
  /**
   * True for the fetches the scanned repository names (`repos: {fetch: true}`): no token is ever
   * attached to them (B3 review M2, OD-9 narrowed), so the checked party cannot choose which
   * repositories the invoker's token reads. Only a URL the invoker names on the command line gets one.
   */
  readonly anonymous?: boolean;
  /** The absolute path of git, or null. */
  readonly git: string | null;
  readonly spawn?: GitSpawn;
  readonly wallClock?: number;
  /** fetchedRepoBytes (tests use a small one). */
  readonly checkoutBytes?: number;
  /** filesPerScan (tests use a small one). */
  readonly checkoutFiles?: number;
  /** The clock of the per-fetch deadline (tests); Date.now otherwise. */
  readonly now?: () => number;
  /** The run's fetch allowance (fetchesPerRun), shared by every fetcher of one run; a fresh one otherwise. */
  readonly allowance?: FetchAllowance;
}

/** How many fetches a run may still make (M2): one allowance per run, shared by all its fetchers. */
export interface FetchAllowance {
  readonly max: number;
  /** Takes one fetch; false (and counted in `refused`) when the run has made `max`. */
  take(): boolean;
  readonly refused: number;
}

export function createFetchAllowance(max: number = LIMITS.fetchesPerRun.value): FetchAllowance {
  let taken = 0;
  let refused = 0;
  return {
    max,
    take() {
      if (taken >= max) {
        refused += 1;
        return false;
      }
      taken += 1;
      return true;
    },
    get refused() {
      return refused;
    },
  };
}

export interface RepoFetcher {
  fetch(url: string, rev: string | null): FetchResult;
}

/**
 * Fixed words for a failed fetch, from git's standard error (which is never shown). The patterns
 * are git 2.55.0's own texts under the fixed options, captured against a loopback listener
 * (test/fixtures/git-stderr/git-2.55.0.json, B3 review m3): with no credential helper and no
 * prompt a 401 is "unable to get password from user"; a status git refuses is "The requested URL
 * returned error: <code>" (a redirect too, since redirects are errors); a 404 on the first request
 * is "repository '<url>' not found". None of them is read as an absent repository.
 */
export function classifyFailure(result: GitResult): string {
  if (result.outcome === "timed-out") return "timed out (repoFetchWallClock); unknown whether the repository exists";
  if (result.outcome === "over-cap") return "git's output was over the limit (gitOutputBytes)";
  if (result.outcome === "not-started") return "git could not be started";
  const e = result.stderr.toLowerCase();
  const has = (...words: string[]) => words.some((w) => e.includes(w));
  const status = /the requested url returned error: (\d{3})/.exec(e)?.[1] ?? null;
  if (status !== null && /^30[1278]$/.test(status)) {
    return `the server answered with a redirect (HTTP ${status}), which is never followed; unknown whether the repository exists (a forge may redirect a URL written without .git)`;
  }
  if (has("remote branch") || has("could not find remote", "couldn't find remote ref")) {
    return "the revision was not found on the server";
  }
  if (has("not our ref", "unadvertised object", "no such remote ref"))
    return "the server would not serve that revision";
  if (status === "403") return "refused by the server (HTTP 403); unknown whether the repository exists";
  if (status === "401" || has("unable to get password", "authentication failed", "could not read username")) {
    return "the server asks for a credential (HTTP 401), or hides the repository behind one; unknown whether the repository exists";
  }
  if (status === "404" || /repository '[^']*' not found/.test(e) || has("repository not found")) {
    return "not found or not visible (HTTP 404); unknown whether the repository exists";
  }
  if (status === "429" || has("rate limit", "too many requests")) {
    return "rate limited (HTTP 429); unknown whether the repository exists";
  }
  if (status !== null) return `the server answered HTTP ${status}; unknown whether the repository exists`;
  if (has("could not resolve host")) return "the host name did not resolve";
  if (has("ssl", "certificate", "tls")) return "the TLS connection failed";
  if (has("failed to connect", "connection refused", "connection timed out", "timed out")) {
    return "the host could not be reached";
  }
  if (has("not allowed")) return "refused by git's own protocol rules";
  return "the fetch failed; unknown whether the repository exists";
}

function isRealDir(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Creates each missing component as a 0700 directory, refusing any symlink on the way. */
function ensureDirs(base: string, parts: readonly string[]): string | null {
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    if (isRealDir(current)) continue;
    try {
      fs.mkdirSync(current, { mode: 0o700 });
    } catch {
      return null;
    }
    if (!isRealDir(current)) return null;
  }
  return current;
}

const SHA_FORM = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The object files of a store crankpath copies, by name (everything else is never read). */
const LOOSE_DIR = /^[0-9a-f]{2}$/;
const LOOSE_FILE = (format: "sha1" | "sha256") => (format === "sha1" ? /^[0-9a-f]{38}$/ : /^[0-9a-f]{62}$/);
const PACK_FILE = (format: "sha1" | "sha256") =>
  format === "sha1" ? /^pack-[0-9a-f]{40}\.(?:pack|idx|rev)$/ : /^pack-[0-9a-f]{64}\.(?:pack|idx|rev)$/;
const READ_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const WRITE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;

type Copied = { readonly ok: true } | { readonly ok: false; readonly limit: string | null };

/**
 * Copies a store's well-named object files into `toObjects`, never following a symlink (each file
 * is opened with O_NOFOLLOW and must be a regular file), within maxBytes and maxFiles together.
 * Nothing else of the store is read: its config, hooks, refs, `info/` and `objects/info/`
 * (alternates) never reach git.
 */
function copyObjects(
  fromObjects: string,
  toObjects: string,
  format: "sha1" | "sha256",
  maxBytes: number,
  maxFiles: number,
): Copied {
  let bytes = 0;
  let files = 0;
  const names = (d: string): string[] | null => {
    try {
      return isRealDir(d) ? fs.readdirSync(d).sort() : null;
    } catch {
      return null;
    }
  };
  const copy = (from: string, to: string): Copied | null => {
    let fd: number;
    try {
      fd = fs.openSync(from, READ_FLAGS);
    } catch {
      return null; // a symlink, or unreadable: not copied (verification then fails if git needed it)
    }
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile()) return null;
      files += 1;
      bytes += st.size;
      if (bytes > maxBytes)
        return { ok: false, limit: "the fetched repository is larger than the run could read (fetchedRepoBytes)" };
      if (files > maxFiles)
        return { ok: false, limit: "the fetched repository holds more files than a scan lists (filesPerScan)" };
      const data = fs.readFileSync(fd);
      const out = fs.openSync(to, WRITE_FLAGS, 0o600);
      try {
        fs.writeSync(out, data);
      } finally {
        fs.closeSync(out);
      }
      return null;
    } catch {
      return { ok: false, limit: null };
    } finally {
      fs.closeSync(fd);
    }
  };
  try {
    fs.mkdirSync(path.join(toObjects, "pack"), { recursive: true, mode: 0o700 });
  } catch {
    return { ok: false, limit: null };
  }
  // the objects directory itself must be a real directory: lstat and O_NOFOLLOW guard only the
  // last component of a path, so a symlinked `objects` would lead every read below it elsewhere
  if (!isRealDir(fromObjects)) return { ok: true };
  for (const d of names(fromObjects) ?? []) {
    if (!LOOSE_DIR.test(d)) continue;
    const inner = names(path.join(fromObjects, d));
    if (inner === null) continue;
    try {
      fs.mkdirSync(path.join(toObjects, d), { mode: 0o700 });
    } catch {
      return { ok: false, limit: null };
    }
    for (const f of inner) {
      if (!LOOSE_FILE(format).test(f)) continue;
      const r = copy(path.join(fromObjects, d, f), path.join(toObjects, d, f));
      if (r !== null) return r;
    }
  }
  for (const f of names(path.join(fromObjects, "pack")) ?? []) {
    if (!PACK_FILE(format).test(f)) continue;
    const r = copy(path.join(fromObjects, "pack", f), path.join(toObjects, "pack", f));
    if (r !== null) return r;
  }
  return { ok: true };
}

type Materialised =
  | {
      readonly ok: true;
      readonly dir: string;
      /** Paths of the commit not written, because another path names the same file on some file system (m1). */
      readonly collisions: readonly string[];
    }
  | {
      readonly ok: false;
      /**
       * `verification`: git ran and refused the objects (fsck, or HEAD not a commit): the store is
       * bad. `limit`: a bound was reached. `incomplete`: a call did not finish (timed out, over its
       * output cap, not started) or a local write failed: nothing is known about the store (m2).
       * `unwritable`: the objects are sound but git would not write the commit's files.
       */
      readonly kind: "verification" | "limit" | "incomplete" | "unwritable";
      readonly detail: string;
    };

const SIZE_WORDS = "the fetched repository is larger than the run could read (fetchedRepoBytes)";
const COUNT_WORDS = "the fetched repository holds more files than a scan lists (filesPerScan)";

/**
 * The key under which two paths name one file on a case-insensitive or normalising file system
 * (the default on macOS and Windows): Unicode normalisation (NFC and NFD agree after NFC) and case
 * (upper then lower case, so `ß` and `SS` agree). Wider than any one file system: a pair a given
 * file system keeps apart may still be reported, never the reverse.
 */
function foldKey(rawLatin1: string): string {
  return Buffer.from(rawLatin1, "latin1")
    .toString("utf8")
    .normalize("NFC")
    .toUpperCase()
    .toLowerCase()
    .normalize("NFC");
}

/** The paths of a listing that collide: every listed path whose own name or a parent directory's shares a fold key with another. */
function collisions(paths: readonly string[]): {
  readonly members: readonly string[];
  readonly affected: readonly string[];
} {
  const byKey = new Map<string, Set<string>>();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join("/");
      const key = foldKey(name);
      let set = byKey.get(key);
      if (set === undefined) {
        set = new Set();
        byKey.set(key, set);
      }
      set.add(name);
    }
  }
  const members = new Set<string>();
  for (const set of byKey.values()) if (set.size > 1) for (const n of set) members.add(n);
  if (members.size === 0) return { members: [], affected: [] };
  const affected = paths.filter((p) => {
    const parts = p.split("/");
    for (let i = 1; i <= parts.length; i++) if (members.has(parts.slice(0, i).join("/"))) return true;
    return false;
  });
  // the shallowest names only: removing them removes everything under them
  const shallow = [...members].filter((m) => {
    const parts = m.split("/");
    for (let i = 1; i < parts.length; i++) if (members.has(parts.slice(0, i).join("/"))) return false;
    return true;
  });
  return { members: shallow.sort(), affected };
}

/** Removes one written path of the tree (never following a symlink: rm removes a link itself), only inside the tree. */
function removeInside(treeReal: string, rawLatin1: string): void {
  const rel = Buffer.from(rawLatin1, "latin1");
  const target = Buffer.concat([Buffer.from(`${treeReal}${path.sep}`), rel]);
  const parent = path.dirname(target.toString("latin1"));
  try {
    // the parent must resolve inside the tree (no collision group above it is left standing)
    const real = fs.realpathSync.native(Buffer.from(parent, "latin1")).toString();
    if (real !== treeReal && !real.startsWith(`${treeReal}${path.sep}`)) return;
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // absent already (a case-insensitive file system wrote one entry for the group)
  }
}

/**
 * Verifies the commit `sha` of an object store and writes its files into `work/tree` (M1): the
 * store's object files are copied into `work/git`, a git directory crankpath writes itself (its
 * own config, HEAD naming `sha`, and `shallow` naming `sha`, the boundary of a depth-1 fetch);
 * `git fsck --strict` must pass (every object's hash, the pack checksums, connectivity from
 * HEAD, which must be a commit). Before anything is written, `ls-tree` lists every path with its
 * declared size: their sum and count must be within maxBytes and maxFiles (pass 3, M1), and paths
 * that would name one file on a case-insensitive or normalising file system are found (m1). Then
 * `read-tree HEAD` and `checkout-index --all` write the files, with the empty tree as the
 * attribute source; the colliding paths are removed again on every platform and returned, so the
 * result is the same everywhere. The private git directory is removed once the files are written
 * (m5); `checkoutSize` stays as a backstop.
 */
function materialise(
  runner: GitRunner,
  store: string,
  sha: string,
  work: string,
  maxBytes: number,
  maxFiles: number,
): Materialised {
  const format = sha.length === 64 ? "sha256" : "sha1";
  const gitDir = path.join(work, "git");
  const treeDir = path.join(work, "tree");
  const incomplete = (detail: string): Materialised => ({ ok: false, kind: "incomplete", detail });
  const unwritten = "the run directory could not be written";
  try {
    fs.mkdirSync(work, { mode: 0o700 });
    fs.mkdirSync(gitDir, { mode: 0o700 });
    fs.mkdirSync(path.join(gitDir, "refs"), { mode: 0o700 });
    fs.writeFileSync(
      path.join(gitDir, "config"),
      format === "sha1"
        ? "[core]\n\trepositoryformatversion = 0\n\tbare = true\n"
        : "[core]\n\trepositoryformatversion = 1\n\tbare = true\n[extensions]\n\tobjectFormat = sha256\n",
      { mode: 0o600, flag: "wx" },
    );
    fs.writeFileSync(path.join(gitDir, "HEAD"), `${sha}\n`, { mode: 0o600, flag: "wx" });
    fs.writeFileSync(path.join(gitDir, "shallow"), `${sha}\n`, { mode: 0o600, flag: "wx" });
  } catch {
    return incomplete(unwritten);
  }
  try {
    const copied = copyObjects(path.join(store, "objects"), path.join(gitDir, "objects"), format, maxBytes, maxFiles);
    if (!copied.ok)
      return copied.limit !== null ? { ok: false, kind: "limit", detail: copied.limit } : incomplete(unwritten);
    const repo = { gitDir, workTree: null, objectFormat: format } as const;
    const call = (subcommand: string[], extra: Partial<Parameters<GitRunner["run"]>[0]> = {}) =>
      runner.run({ subcommand, args: [], cwd: gitDir, auth: null, repo, ...extra });
    // only a finished git that refused is a verdict on the store (m2): any other outcome says nothing
    const notFinished = (r: GitResult) => r.outcome !== "ok" && r.outcome !== "failed";
    const fsck = call(["fsck", "--strict", "--no-dangling", "--no-progress"]);
    if (notFinished(fsck)) return incomplete(`verifying: ${classifyFailure(fsck)}`);
    if (fsck.outcome !== "ok") return { ok: false, kind: "verification", detail: "git fsck refused the objects" };
    const listed = call(["ls-tree", "-r", "-l", "-z", "HEAD"]);
    if (listed.outcome === "over-cap")
      return { ok: false, kind: "limit", detail: `${SIZE_WORDS}: its file list alone` };
    if (notFinished(listed)) return incomplete(`listing: ${classifyFailure(listed)}`);
    if (listed.outcome !== "ok")
      return { ok: false, kind: "unwritable", detail: "git would not list the commit's files" };
    const paths: string[] = [];
    let bytes = 0;
    for (const record of listed.stdout.split("\0")) {
      if (record === "") continue;
      // `<mode> <type> <name> <size>TAB<path>`: the size is padded, `-` for a submodule (an empty directory)
      const m = /^[0-7]{6} (?:blob|commit) [0-9a-f]{40,64} +(\d+|-)\t(.+)$/s.exec(record);
      if (m === null) return { ok: false, kind: "unwritable", detail: "git's file list could not be read" };
      bytes += m[1] === "-" ? 0 : Number(m[1]);
      paths.push(m[2] as string);
      if (bytes > maxBytes) return { ok: false, kind: "limit", detail: SIZE_WORDS };
      if (paths.length > maxFiles) return { ok: false, kind: "limit", detail: COUNT_WORDS };
    }
    const collided = collisions(paths);
    if (call(["read-tree", "HEAD"]).outcome !== "ok") {
      return { ok: false, kind: "unwritable", detail: "git would not read the commit's tree" };
    }
    try {
      fs.mkdirSync(treeDir, { mode: 0o700 });
    } catch {
      return incomplete(unwritten);
    }
    const checkout = call(["checkout-index", "--all", "--force", "--quiet"], {
      cwd: treeDir,
      repo: { ...repo, workTree: treeDir },
    });
    if (notFinished(checkout)) return incomplete(`writing: ${classifyFailure(checkout)}`);
    if (checkout.outcome !== "ok")
      return { ok: false, kind: "unwritable", detail: "git would not write the commit's files" };
    const treeReal = fs.realpathSync.native(treeDir);
    for (const m of collided.members) removeInside(treeReal, m);
    // a backstop: what was written is measured too
    const size = checkoutSize(treeDir, maxBytes, maxFiles);
    if (size !== null) return { ok: false, kind: "limit", detail: size };
    return {
      ok: true,
      dir: treeReal,
      collisions: collided.affected.map((p) => Buffer.from(p, "latin1").toString("utf8")).sort(),
    };
  } finally {
    // the copy of the objects is not needed once the files are written, or once refused (m5)
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
}

/**
 * Null when a directory (a fetched store, or the files materialised from it) is within the byte
 * and file bounds; else crankpath's words for the limit hit. Iterative lstat walk (symlinks
 * counted as entries, never followed).
 */
export function checkoutSize(dir: string, maxBytes: number, maxFiles: number): string | null {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop() as string;
    let names: string[];
    try {
      names = fs.readdirSync(d);
    } catch {
      return "the fetched checkout could not be measured";
    }
    for (const name of names) {
      const p = path.join(d, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(p);
      } catch {
        return "the fetched checkout could not be measured";
      }
      if (st.isDirectory()) stack.push(p);
      else {
        files += 1;
        bytes += st.size;
        if (bytes > maxBytes) return "the fetched repository is larger than the run could read (fetchedRepoBytes)";
        if (files > maxFiles) return "the fetched repository holds more files than a scan lists (filesPerScan)";
      }
    }
  }
  return null;
}

const VERIFY_FAILED = "the cached copy failed verification (git fsck refused its objects) and was discarded";

export function createRepoFetcher(config: FetcherConfig): RepoFetcher {
  const { work: area } = config;
  const allowance = config.allowance ?? createFetchAllowance();
  const maxBytes = config.checkoutBytes ?? LIMITS.fetchedRepoBytes.value;
  const maxFiles = config.checkoutFiles ?? LIMITS.filesPerScan.value;
  const guard = (u: string) => guardGitUrl(u).ok;
  const fail = (reason: "unreadable-repo" | "offline" | "tool-missing" | "limit", detail: string): FetchResult => ({
    ok: false,
    reason,
    detail,
  });
  const discard = (entry: string) => {
    try {
      fs.rmSync(entry, { recursive: true, force: true });
    } catch {
      // left; it is verified again (and fails again) on every later read
    }
  };
  return Object.freeze({
    fetch(url: string, rev: string | null): FetchResult {
      const guarded = guardGitUrl(url);
      if (!guarded.ok) return fail("unreadable-repo", `refused: ${GIT_URL_PROBLEM_WORDS[guarded.problem]}`);
      const plan = planRevision(rev);
      if (!plan.ok) {
        return fail(
          "unreadable-repo",
          plan.problem === "abbreviated"
            ? "refused: an abbreviated commit sha cannot be fetched (give the full sha)"
            : "refused: not a revision crankpath passes to git",
        );
      }
      const key = guarded.normalised.split("/");
      const cacheParts = ["repos", ...key.slice(0, -1)];
      const leafName = (sha: string) => `${key[key.length - 1] as string}@${sha}`;
      // a pinned commit may be in a trusted cache; it is used only after git verifies it (M1)
      const cached =
        plan.kind === "sha" && area.trusted
          ? path.join(area.cacheRoot, ...cacheParts, leafName(plan.value as string))
          : null;
      const hit = cached !== null && isRealDir(cached) ? cached : null;
      if (hit === null && !config.network)
        return fail("offline", "not fetched under --no-network, and not in a trusted cache at a pinned commit");
      if (config.git === null) {
        return fail(
          "tool-missing",
          hit === null
            ? "git not found on PATH"
            : "git not found on PATH (a cached repository is read only after git has verified it)",
        );
      }
      if (!allowance.take()) {
        return fail("limit", `not fetched: the run has made fetchesPerRun (${allowance.max}) fetches`);
      }
      // a private directory inside the run directory (removed with it): git's home, an empty
      // directory for its PATH, the clone, the private git directory and the materialised files
      const made = area.makeDir("fetch");
      if (!made.ok) return fail("unreadable-repo", "the cache directory could not be written");
      const work = made.path;
      try {
        fs.mkdirSync(path.join(work, "home"), { mode: 0o700 });
        fs.mkdirSync(path.join(work, "empty"), { mode: 0o700 });
      } catch {
        return fail("unreadable-repo", "the cache directory could not be written");
      }
      // one wall clock for the whole fetch: the clone and every verification call together (m4)
      const runner = createGitRunner({
        git: config.git,
        home: path.join(work, "home"),
        empty: path.join(work, "empty"),
        guard,
        ...(config.spawn === undefined ? {} : { spawn: config.spawn }),
        ...(config.wallClock === undefined ? {} : { wallClock: config.wallClock }),
        ...(config.now === undefined ? {} : { now: config.now }),
        listingBytes: maxBytes,
      });
      if (hit !== null) {
        const m = materialise(runner, hit, plan.value as string, path.join(work, "hit"), maxBytes, maxFiles);
        if (m.ok) {
          return {
            ok: true,
            dir: m.dir,
            commit: plan.value as string,
            floating: false,
            cached: true,
            collisions: m.collisions,
          };
        }
        if (m.kind === "limit") return fail("limit", m.detail);
        // only git's refusal is a verdict on the store (m2): a call that did not finish leaves it
        if (m.kind === "incomplete") return fail("unreadable-repo", `the cached copy was not read: ${m.detail}`);
        if (m.kind === "unwritable") return fail("unreadable-repo", m.detail);
        discard(hit);
        if (!config.network) return fail("offline", `${VERIFY_FAILED}; not fetched under --no-network`);
      }
      const token = config.anonymous === true ? undefined : config.env(tokenVariable(guarded.host, guarded.port));
      const auth = token === undefined || token === "" ? null : { origin: guarded.origin, header: authHeader(token) };
      const revArgs =
        plan.kind === "default"
          ? []
          : plan.kind === "branch"
            ? ["--branch", plan.value as string]
            : ["--revision", plan.value as string];
      const clone = runner.run({
        subcommand: ["clone"],
        args: [
          "--bare",
          "--depth",
          "1",
          "--single-branch",
          "--no-tags",
          "--no-recurse-submodules",
          "--quiet",
          ...revArgs,
          "--",
          guarded.url,
          "store",
        ],
        cwd: work,
        auth,
      });
      if (clone.outcome !== "ok") {
        const words = classifyFailure(clone);
        return fail(
          "unreadable-repo",
          config.anonymous === true ? `${words}; fetched without a token (a repos: entry never gets one)` : words,
        );
      }
      const store = path.join(work, "store");
      if (!isRealDir(store)) return fail("unreadable-repo", "the fetch left no repository");
      // the store's size on disk is bounded (B3 review m5): over the limit it is refused and removed
      const size = checkoutSize(store, maxBytes, maxFiles);
      if (size !== null) {
        fs.rmSync(store, { recursive: true, force: true });
        return fail("limit", size);
      }
      // the commit the clone holds, from the store git has just written (its own HEAD and refs)
      const head = runner.run({
        subcommand: ["rev-parse", "--verify", "HEAD^{commit}"],
        args: [],
        cwd: store,
        auth: null,
        repo: {
          gitDir: store,
          workTree: null,
          objectFormat: plan.kind === "sha" && (plan.value as string).length === 64 ? "sha256" : "sha1",
        },
      });
      const sha = head.stdout.trim();
      if (head.outcome === "timed-out" || head.outcome === "over-cap" || head.outcome === "not-started")
        return fail("unreadable-repo", `the fetched commit could not be read: ${classifyFailure(head)}`);
      if (head.outcome !== "ok" || !SHA_FORM.test(sha))
        return fail("unreadable-repo", "the fetched commit could not be read");
      if (plan.kind === "sha" && sha !== plan.value)
        return fail("unreadable-repo", "the fetched commit is not the one asked for");
      const m = materialise(runner, store, sha, path.join(work, "fresh"), maxBytes, maxFiles);
      if (!m.ok) {
        fs.rmSync(store, { recursive: true, force: true });
        if (m.kind === "limit") return fail("limit", m.detail);
        if (m.kind === "verification")
          return fail("unreadable-repo", "the fetched objects failed verification (git fsck refused them)");
        return fail(
          "unreadable-repo",
          m.kind === "incomplete" ? `the fetched commit was not read: ${m.detail}` : m.detail,
        );
      }
      if (area.trusted) {
        // the verified store is kept for later pinned reads (each verified again); a failure to
        // keep it changes nothing in this run
        const parent = ensureDirs(area.cacheRoot, cacheParts);
        const target = parent === null ? null : path.join(parent, leafName(sha));
        if (target !== null && !fs.existsSync(target)) {
          try {
            fs.renameSync(store, target);
          } catch {
            // not cached
          }
        }
      }
      // the store is now in the cache, or not needed: only the written files stay in the run (m5)
      fs.rmSync(store, { recursive: true, force: true });
      return {
        ok: true,
        dir: m.dir,
        commit: sha,
        floating: plan.floating,
        cached: false,
        collisions: m.collisions,
      };
    },
  });
}

/** The absolute path of git on a PATH, or null (a regular executable file, symlinks resolved). */
export function findGit(pathEnv: string): string | null {
  for (const dir of pathEnv.split(path.delimiter)) {
    if (dir === "" || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, "git");
    try {
      const real = fs.realpathSync.native(candidate);
      const st = fs.statSync(real);
      if (st.isFile() && (st.mode & 0o111) !== 0) return real;
    } catch {
      // not here
    }
  }
  return null;
}
