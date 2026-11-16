// The git forms of the command runner (U4, contract C12; FR1.8, NFR1, NFR11, BR4.11, BR4.12):
// the only git crankpath ever starts. The allowlist is closed and in the command runner's style
// (subcommand, a closed set of options, a fixed number of positionals after `--`): `git clone
// --bare` (shallow, one branch or one revision, no tags, no submodules), and the four forms that
// verify an object store and materialise its commit (B3 review pass 2, M1): `fsck --strict`,
// `rev-parse --verify HEAD^{commit}`, `read-tree HEAD` and `checkout-index --all`, each on a
// repository named by an absolute `--git-dir` (and `--work-tree`), never found from the working
// directory, with the repository's own attributes replaced by the empty tree (`--attr-source`), so
// no filter, `ident`, `eol` or `working-tree-encoding` of the scanned repository changes a byte.
// Anything else is refused before a process exists (a construction error, a bug in crankpath).
//
// Every call carries the same fixed `-c` options before its subcommand (GIT_CONFIG, confirmed
// against `git help config` of git 2.55.0 on 2026-11-15, docs/lookups.md): no hooks, no fsmonitor,
// https as the only protocol, no redirects, no submodule recursion, no credential helper or
// prompt, object checks on, no templates, no automatic maintenance. System and global
// configuration are not read (GIT_CONFIG_NOSYSTEM, GIT_CONFIG_GLOBAL=/dev/null) and HOME is a
// private directory, so no config of the machine can add a helper, a proxy, an `insteadOf` or a
// header. A token (NFR11) never appears in argv: `--config-env` names a fixed variable,
// CRANKPATH_GIT_AUTH_HEADER, for a header key scoped to the one https host being fetched, and the
// variable is set only for that call. Standard error is held only to classify a failure and is
// never shown, cached or logged. No call is retried.
//
// This module is the command runner's sibling for git (command-runner.ts): its allowlist entries
// are part of ALLOWED_COMMANDS (that runner refuses git), its spawn port is that runner's, and it
// adds what git needs: the fixed options before the subcommand, the per-call header environment
// and the process-group kill.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { LIMITS } from "../u1-graph-model/limits.js";
import type { Spawn, SpawnOptions, SpawnOutput } from "./command-runner.js";

type OptionKind = "flag" | "value" | readonly string[];

export interface AllowedGitCommand {
  readonly tool: "git";
  readonly subcommand: readonly string[];
  readonly options: Readonly<Record<string, OptionKind>>;
  /** How many positional arguments follow `--`. */
  readonly positionals: number;
  /**
   * The repository the form runs on: none (clone makes one), a git directory, or a git directory
   * with a work tree (checkout-index). Given as absolute `--git-dir`/`--work-tree` options.
   */
  readonly repository: "none" | "git-dir" | "git-dir-and-work-tree";
  /**
   * What standard output holds: text (held up to gitOutputBytes, decoded as UTF-8), or a listing
   * of the commit's paths (held up to the runner's listingBytes, kept byte for byte as latin1 so a
   * path that is not UTF-8 is not changed).
   */
  readonly output: "text" | "listing";
}

/** The closed git allowlist (C12: "git fetch/clone/rev-parse with fixed -c options"). */
export const GIT_ALLOWED_COMMANDS: readonly AllowedGitCommand[] = Object.freeze([
  Object.freeze({
    tool: "git",
    subcommand: Object.freeze(["clone"]),
    options: Object.freeze({
      "--bare": "flag",
      "--depth": Object.freeze(["1"]),
      "--single-branch": "flag",
      "--no-tags": "flag",
      "--no-recurse-submodules": "flag",
      "--quiet": "flag",
      "--revision": "value",
      "--branch": "value",
    }),
    positionals: 2,
    repository: "none",
    output: "text",
  }),
  ...(
    [
      [["fsck", "--strict", "--no-dangling", "--no-progress"], "git-dir", "text"],
      [["rev-parse", "--verify", "HEAD^{commit}"], "git-dir", "text"],
      // every path HEAD would write, with its declared size: summed and counted before anything is
      // written (B3 review pass 3, M1), and compared for case and normalisation collisions (m1)
      // (`-l -z`: `<mode> <type> <name> <size>TAB<path>NUL`, the path unquoted, byte for byte; a
      // `--format` path is C-quoted even with -z, so it is not used)
      [["ls-tree", "-r", "-l", "-z", "HEAD"], "git-dir", "listing"],
      [["read-tree", "HEAD"], "git-dir", "text"],
      [["checkout-index", "--all", "--force", "--quiet"], "git-dir-and-work-tree", "text"],
    ] as const
  ).map(([subcommand, repository, output]) =>
    Object.freeze({
      tool: "git" as const,
      subcommand: Object.freeze([...subcommand]),
      options: Object.freeze({}),
      positionals: 0,
      repository,
      output,
    }),
  ),
] satisfies AllowedGitCommand[]);

/** The empty tree's object name in each object format: the attribute source of every repository call. */
export const EMPTY_TREE = Object.freeze({
  sha1: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  sha256: "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321",
});

/**
 * The fixed `-c` options of every git call, each confirmed in `git help config` (git 2.55.0,
 * 2026-11-15). Order matters only in that command-line options override every other source.
 */
export const GIT_CONFIG: readonly (readonly [string, string])[] = Object.freeze([
  // hooks: a path that is no directory, so no hook can be found (reference-transaction runs on fetch)
  Object.freeze(["core.hooksPath", "/dev/null"] as const),
  Object.freeze(["core.fsmonitor", "false"] as const),
  // checkout: refuse paths an HFS+ or NTFS file system would treat as .git; no line-ending change
  Object.freeze(["core.protectHFS", "true"] as const),
  Object.freeze(["core.protectNTFS", "true"] as const),
  Object.freeze(["core.autocrlf", "false"] as const),
  // protocols: https only (file, git, ssh, ext and http never)
  Object.freeze(["protocol.allow", "never"] as const),
  Object.freeze(["protocol.https.allow", "always"] as const),
  // redirects are errors, the first request included
  Object.freeze(["http.followRedirects", "false"] as const),
  Object.freeze(["http.sslVerify", "true"] as const),
  // submodules: never recursed
  Object.freeze(["submodule.recurse", "false"] as const),
  Object.freeze(["fetch.recurseSubmodules", "false"] as const),
  // credentials: no helper (an empty value clears the list), no prompt
  Object.freeze(["credential.helper", ""] as const),
  Object.freeze(["credential.interactive", "false"] as const),
  Object.freeze(["core.askPass", ""] as const),
  // objects: checked as they arrive (malformed objects, .gitmodules attacks)
  Object.freeze(["transfer.fsckObjects", "true"] as const),
  // the new repository gets no template (no sample hooks, no info/exclude)
  Object.freeze(["init.templateDir", ""] as const),
  // no automatic maintenance process after the clone
  Object.freeze(["gc.auto", "0"] as const),
  Object.freeze(["maintenance.auto", "false"] as const),
  // a bare repository is used only when named
  Object.freeze(["safe.bareRepository", "explicit"] as const),
]);

/** The one variable a token reaches git through (never in argv). */
export const AUTH_HEADER_VARIABLE = "CRANKPATH_GIT_AUTH_HEADER";

/** A broken allowlist rule: a bug in crankpath, never a property of the scanned repo. */
export class GitCommandRefused extends Error {}

export interface GitRequest {
  readonly subcommand: readonly string[];
  /** Options, then `--`, then positionals. */
  readonly args: readonly string[];
  /** Always crankpath's own directory under the cache root. */
  readonly cwd: string;
  /** The https origin (`https://host[:port]/`) an auth header is scoped to, with the header; or null. */
  readonly auth: { readonly origin: string; readonly header: string } | null;
  /** The repository a form other than clone runs on (absolute paths crankpath made), with its object format. */
  readonly repo?: GitRepository | null;
}

export interface GitRepository {
  readonly gitDir: string;
  readonly workTree: string | null;
  readonly objectFormat: "sha1" | "sha256";
}

export type GitOutcome = "ok" | "failed" | "timed-out" | "over-cap" | "not-started";

export interface GitResult {
  readonly outcome: GitOutcome;
  readonly exitCode: number | null;
  readonly stdout: string;
  /** Standard error, for crankpath's own failure classification only: never printed, cached or logged. */
  readonly stderr: string;
}

/** The process port: the command runner's own shape (B2), so one spawn contract serves every tool. */
export type GitSpawnOptions = SpawnOptions;
export type GitSpawnOutput = SpawnOutput;
export type GitSpawn = Spawn;

/**
 * The process-group helper (B3 review m2; pass 2, m1 and m3): git runs in its own process group,
 * started by a small Node program (run with this Node, no shell), so a helper git started
 * (`git-remote-https`, which holds the token header in its environment) never outlives the call.
 * The helper kills the whole group with SIGKILL on every way the call can end: the wall clock
 * running out, either output stream passing the cap (the helper counts the bytes itself and stops
 * passing them on, so the caller's buffer is never the one to overflow), git exiting, git failing
 * to start, the helper's own standard output or error closing (its caller is gone), and SIGINT,
 * SIGTERM or SIGHUP sent to the helper. It exits only on `close`, which comes once git has exited
 * and every process holding its output pipes (the group) is gone: so the caller needs no timeout
 * of its own and no grace constant. It passes git's output through unchanged and exits with git's
 * status, or with TIMED_OUT_STATUS, OVER_CAP_STATUS or 128 plus the signal's number. A SIGKILL sent
 * to the helper itself cannot be handled; git then lives until it ends by itself (a stated
 * residual: nothing crankpath runs sends one). CommonJS source, given to `node -e`.
 */
export const GROUP_HELPER = `
const { spawn } = require("node:child_process");
const [wall, cap, file, ...args] = process.argv.slice(1);
const limit = Number(cap);
let status = null;
let child = null;
const killGroup = () => { if (child !== null && child.pid !== undefined) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
const end = (s) => { if (status === null) status = s; killGroup(); };
const NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
for (const name of Object.keys(NUMBERS)) process.on(name, () => end(128 + NUMBERS[name]));
process.stdout.on("error", () => end(141));
process.stderr.on("error", () => end(141));
child = spawn(file, args, { detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
const timer = setTimeout(() => end(250), Number(wall));
const pass = (from, to) => {
  let seen = 0;
  from.on("data", (b) => {
    if (status !== null) return;
    seen += b.length;
    if (seen > limit) { end(251); return; }
    to.write(b);
  });
};
pass(child.stdout, process.stdout);
pass(child.stderr, process.stderr);
child.on("error", () => end(127));
child.on("exit", () => killGroup());
child.on("close", (code) => {
  clearTimeout(timer);
  killGroup();
  process.exitCode = status !== null ? status : code === null ? 128 : code;
});
`;
/** The helper's exit status when the wall clock stopped git (git itself never exits with it). */
export const TIMED_OUT_STATUS = 250;
/** The helper's exit status when an output stream passed the cap. */
export const OVER_CAP_STATUS = 251;

/** The helper's argv after the Node executable: the source, the wall clock, the cap, git and its arguments. */
export function helperArgv(file: string, args: readonly string[], timeout: number, maxBuffer: number): string[] {
  // the helper passes on at most maxBuffer - 1 bytes of each stream (a stream of maxBuffer bytes is over)
  return ["-e", GROUP_HELPER, String(timeout), String(maxBuffer - 1), file, ...args];
}

export const realGitSpawn: GitSpawn = (file, args, options) => {
  // no timeout here: the helper enforces the wall clock and exits once git's group is gone (m3)
  const r = spawnSync(process.execPath, helperArgv(file, args, options.timeout, options.maxBuffer), {
    cwd: options.cwd,
    env: { ...options.env },
    maxBuffer: options.maxBuffer,
    killSignal: "SIGKILL",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timedOut = r.status === TIMED_OUT_STATUS;
  const overCap = r.status === OVER_CAP_STATUS || (r.error as { code?: string } | undefined)?.code === "ENOBUFS";
  return {
    status: timedOut || overCap ? null : r.status,
    signal: r.signal,
    stdout: r.stdout ?? null,
    stderr: r.stderr ?? null,
    error: timedOut
      ? { code: "ETIMEDOUT" }
      : overCap
        ? { code: "ENOBUFS" }
        : (r.error as { code?: string } | undefined),
  };
};

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

const ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?\/$/;

/** Checks a request against the git allowlist; throws GitCommandRefused for anything else. */
export function checkGitAllowed(request: GitRequest, guard: (url: string) => boolean): AllowedGitCommand {
  const allowed = GIT_ALLOWED_COMMANDS.find((c) => sameList(c.subcommand, request.subcommand));
  if (allowed === undefined) throw new GitCommandRefused(`not on the allowlist: git ${request.subcommand.join(" ")}`);
  const args = request.args;
  let i = 0;
  let revs = 0;
  while (i < args.length && args[i] !== "--") {
    const a = args[i] as string;
    const kind = Object.hasOwn(allowed.options, a) ? allowed.options[a] : undefined;
    if (kind === undefined) throw new GitCommandRefused(`option not allowed for git: ${a}`);
    if (kind === "flag") {
      i += 1;
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value === "--") throw new GitCommandRefused(`option without a value: ${a}`);
    if (typeof kind !== "string" && !kind.includes(value)) throw new GitCommandRefused(`fixed option value: ${a}`);
    if (a === "--revision" || a === "--branch") {
      revs += 1;
      if (!isSafeRevision(value)) throw new GitCommandRefused(`revision refused: ${a}`);
    }
    i += 2;
  }
  if (revs > 1) throw new GitCommandRefused("--revision and --branch together");
  const positionals = i < args.length ? args.slice(i + 1) : [];
  if (positionals.length !== allowed.positionals) {
    throw new GitCommandRefused(`${allowed.positionals} positional arguments expected after --`);
  }
  if (allowed.positionals > 0 && args[i] !== "--") throw new GitCommandRefused("positional arguments need --");
  for (const p of positionals)
    if (p.length === 0 || p.includes("\0")) throw new GitCommandRefused("empty or NUL positional");
  const repo = request.repo ?? null;
  if (allowed.repository === "none") {
    if (repo !== null) throw new GitCommandRefused("a repository option for a form that makes its own");
  } else {
    if (repo === null) throw new GitCommandRefused("a repository form without --git-dir");
    const wantsTree = allowed.repository === "git-dir-and-work-tree";
    if ((repo.workTree !== null) !== wantsTree) throw new GitCommandRefused("a work tree given to the wrong form");
    for (const p of [repo.gitDir, ...(repo.workTree === null ? [] : [repo.workTree])]) {
      if (!path.isAbsolute(p) || [...p].some((c) => c.charCodeAt(0) < 0x20))
        throw new GitCommandRefused("repository paths must be absolute");
    }
    if (!Object.hasOwn(EMPTY_TREE, repo.objectFormat)) throw new GitCommandRefused("object format");
  }
  if (sameList(allowed.subcommand, ["clone"])) {
    const url = positionals[0] as string;
    if (!guard(url)) throw new GitCommandRefused("clone URL refused by the URL guard");
    if (request.auth !== null && !url.startsWith(request.auth.origin)) {
      throw new GitCommandRefused("an auth header for another origin than the clone URL");
    }
  } else if (request.auth !== null) throw new GitCommandRefused("an auth header for a command that fetches nothing");
  if (request.auth !== null && !ORIGIN.test(request.auth.origin)) throw new GitCommandRefused("auth origin form");
  return allowed;
}

/** A revision crankpath passes to git: a full sha, or a ref name in git's own safe subset. */
export function isSafeRevision(rev: string): boolean {
  if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(rev)) return true;
  if (rev.length === 0 || rev.length > 255) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(rev)) return false;
  if (rev.startsWith("-") || rev.startsWith("/") || rev.endsWith("/") || rev.endsWith(".") || rev.endsWith(".lock")) {
    return false;
  }
  if (rev.includes("..") || rev.includes("//") || rev.split("/").some((s) => s.startsWith("."))) return false;
  return true;
}

/** The environment of a git child, built from nothing (C12, NFR11): no inherited variable reaches it. */
export function buildGitEnv(home: string, empty: string, header: string | null): Readonly<Record<string, string>> {
  const env: Record<string, string> = {
    PATH: empty,
    LANG: "C",
    LC_ALL: "C",
    HOME: home,
    TMPDIR: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PROTOCOL_FROM_USER: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
  };
  if (header !== null) env[AUTH_HEADER_VARIABLE] = header;
  return Object.freeze(env);
}

/** The argv of one call: the fixed options, the scoped header key when a token is sent, the command. */
export function gitArgv(request: GitRequest): string[] {
  const out: string[] = [];
  for (const [k, v] of GIT_CONFIG) out.push("-c", `${k}=${v}`);
  if (request.auth !== null)
    out.push("--config-env", `http.${request.auth.origin}.extraHeader=${AUTH_HEADER_VARIABLE}`);
  const repo = request.repo ?? null;
  if (repo !== null) {
    out.push(`--git-dir=${repo.gitDir}`);
    if (repo.workTree !== null) out.push(`--work-tree=${repo.workTree}`);
    out.push(`--attr-source=${EMPTY_TREE[repo.objectFormat]}`);
  }
  return [...out, ...request.subcommand, ...request.args];
}

export interface GitRunnerConfig {
  /** The absolute path of git, or null when it is not on PATH. */
  readonly git: string | null;
  readonly home: string;
  readonly empty: string;
  readonly guard: (url: string) => boolean;
  readonly spawn?: GitSpawn;
  /**
   * The time every call of this runner may take together (repoFetchWallClock: one fetch, its
   * clone and its verification), counted from the runner's creation; each call gets what is left.
   */
  readonly wallClock?: number;
  /** The clock (tests); Date.now otherwise. */
  readonly now?: () => number;
  /** The most a listing form's output may hold (fetchedRepoBytes by default). */
  readonly listingBytes?: number;
}

export interface GitRunner {
  run(request: GitRequest): GitResult;
  readonly available: boolean;
}

export function createGitRunner(config: GitRunnerConfig): GitRunner {
  const spawn = config.spawn ?? realGitSpawn;
  const textCap = LIMITS.gitOutputBytes.value;
  const now = config.now ?? Date.now;
  const deadline = now() + (config.wallClock ?? LIMITS.repoFetchWallClock.value);
  return Object.freeze({
    available: config.git !== null,
    run(request: GitRequest): GitResult {
      const form = checkGitAllowed(request, config.guard);
      const cap = form.output === "listing" ? (config.listingBytes ?? LIMITS.fetchedRepoBytes.value) : textCap;
      if (config.git === null) return { outcome: "not-started", exitCode: null, stdout: "", stderr: "" };
      const left = deadline - now();
      if (left <= 0) return { outcome: "timed-out", exitCode: null, stdout: "", stderr: "" };
      const r = spawn(config.git, gitArgv(request), {
        cwd: request.cwd,
        env: buildGitEnv(config.home, config.empty, request.auth?.header ?? null),
        timeout: left,
        maxBuffer: cap + 1,
      });
      const stdout = r.stdout ?? Buffer.alloc(0);
      const stderr = r.stderr ?? Buffer.alloc(0);
      const code = r.error?.code;
      let outcome: GitOutcome;
      if (code === "ETIMEDOUT") outcome = "timed-out";
      else if (code === "ENOBUFS" || stdout.length > cap || stderr.length > cap) outcome = "over-cap";
      else if (code !== undefined) outcome = "not-started";
      else if (r.status === 0 && r.signal === null) outcome = "ok";
      else outcome = "failed";
      return {
        outcome,
        exitCode: r.status,
        stdout: outcome === "ok" ? stdout.toString(form.output === "listing" ? "latin1" : "utf8") : "",
        stderr: outcome === "over-cap" ? "" : stderr.toString("latin1"),
      };
    },
  });
}
