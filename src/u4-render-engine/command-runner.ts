// CommandRunner (U4, contract C12; BR4.17 to BR4.19, FR3.8, NFR1): the only way crankpath starts a
// process. The allowlist is closed and keyed by (tool, subcommand): `helm template`, `helm
// dependency build`, `helm pull`, `helm version`, `kustomize build`, `kustomize version`, and the
// fixed `git` fetch forms (`git clone` and `git rev-parse --verify HEAD`, B3), defined with their
// own checks in git-runner.ts and run only through it (it adds git's fixed `-c` options and runs
// git in its own process group; this runner refuses git). Each allowed command also has a closed set of options: anything else, including
// `--dry-run=server`, `--kubeconfig`, `--post-renderer` or `--enable-helm`, is refused before a
// process exists. A refusal is a construction error, a bug in crankpath, never a run outcome.
//
// The child gets an argv array (no shell), an environment built from nothing (C12: PATH, a fixed
// locale, a private HOME, helm's config, cache and data homes under the private directory,
// `KUBECONFIG=/dev/null`; no credential, no token, no proxy of the user's; the render commands get
// a closed one), a wall-clock limit and byte caps
// from the LimitSet. The result is a fixed outcome word; standard error is kept only for
// crankpath's own classification of a failure and is never shown. No call is ever retried.

import { spawnSync } from "node:child_process";
import path from "node:path";
import type { DerivedLimit } from "../u1-graph-model/limits.js";
import { LIMITS } from "../u1-graph-model/limits.js";
import { GIT_ALLOWED_COMMANDS } from "./git-runner.js";
import { guardChartUrl } from "./url-guard.js";

export type Tool = "helm" | "kustomize" | "git";

type OptionKind = "flag" | "value" | readonly string[];

export interface AllowedCommand {
  readonly tool: Tool;
  readonly subcommand: readonly string[];
  /** Options allowed before `--`: a flag, an option with any value, or an option with one of fixed values. */
  readonly options: Readonly<Record<string, OptionKind>>;
  /** How many positional arguments follow `--`. */
  readonly positionals: number;
  /** True for a command that never needs the network: it runs behind CLOSED_PROXY (B2 review pass 3, M1). */
  readonly closedProxy?: boolean;
}

/** The closed allowlist (C12, FR3.8). Nothing else can run. */
export const ALLOWED_COMMANDS: readonly AllowedCommand[] = Object.freeze([
  Object.freeze({
    tool: "helm",
    subcommand: Object.freeze(["template"]),
    options: Object.freeze({
      "--namespace": "value",
      "--include-crds": "flag",
      "--skip-schema-validation": "flag",
      "--values": "value",
    }),
    positionals: 2,
    closedProxy: true,
  }),
  Object.freeze({
    tool: "helm",
    subcommand: Object.freeze(["dependency", "build"]),
    options: Object.freeze({}),
    positionals: 1,
  }),
  Object.freeze({
    tool: "helm",
    subcommand: Object.freeze(["pull"]),
    options: Object.freeze({ "--repo": "value", "--version": "value", "--untar": "flag", "--untardir": "value" }),
    positionals: 1,
  }),
  Object.freeze({
    tool: "helm",
    subcommand: Object.freeze(["version"]),
    options: Object.freeze({ "--template": Object.freeze(["{{.Version}}"]) }),
    positionals: 0,
  }),
  Object.freeze({
    tool: "kustomize",
    subcommand: Object.freeze(["build"]),
    options: Object.freeze({ "--load-restrictor": Object.freeze(["LoadRestrictionsRootOnly"]) }),
    positionals: 1,
    closedProxy: true,
  }),
  Object.freeze({
    tool: "kustomize",
    subcommand: Object.freeze(["version"]),
    options: Object.freeze({}),
    positionals: 0,
  }),
  // the git forms (B3): one closed list; checked and run by git-runner.ts only
  ...GIT_ALLOWED_COMMANDS,
] satisfies AllowedCommand[]);

/**
 * The proxy `helm template` and `kustomize build` are given (B2 review pass 3, M1, defence in
 * depth): a loopback port nothing listens on (port 1 needs privilege to bind), with `NO_PROXY`
 * empty, so an HTTP fetch either tool was not stopped from making fails at the proxy before any
 * name is resolved. Go never sends a request for a loopback address through a proxy, so a
 * loopback URL is covered only by the pre-reads. `helm pull` and `helm dependency build`, which
 * must fetch, get no proxy.
 */
export const CLOSED_PROXY = "http://127.0.0.1:1";
const CLOSED_PROXY_ENV = Object.freeze({
  HTTP_PROXY: CLOSED_PROXY,
  HTTPS_PROXY: CLOSED_PROXY,
  ALL_PROXY: CLOSED_PROXY,
  NO_PROXY: "",
});

/** A broken allowlist rule: a bug in crankpath, never a property of the scanned repo. */
export class CommandRefused extends Error {}

export interface CommandRequest {
  readonly tool: Tool;
  readonly subcommand: readonly string[];
  /** Options, then `--`, then positionals (`--` may be left out when there are none). */
  readonly args: readonly string[];
  /** Working directory: always inside crankpath's private directory. */
  readonly cwd: string;
}

export type CommandOutcome = "ok" | "failed" | "timed-out" | "over-cap" | "not-started";

/** Fixed outcome words (BR4.19). */
export const OUTCOME_WORDS: Readonly<Record<CommandOutcome, string>> = Object.freeze({
  ok: "ok",
  failed: "exited with an error",
  "timed-out": "timed out",
  "over-cap": "over cap",
  "not-started": "could not start",
});

export interface CommandResult {
  readonly tool: Tool;
  readonly subcommand: readonly string[];
  readonly outcome: CommandOutcome;
  readonly exitCode: number | null;
  readonly stdout: Buffer;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  /** Which stream went over its cap, when outcome is `over-cap`. */
  readonly overCap: "stdout" | "stderr" | null;
  readonly timedOut: boolean;
  /** Wall time in milliseconds (diagnostics and measurement only: never in a report). */
  readonly durationMs: number;
  /** Standard error, for crankpath's own failure classification only: never printed, cached or logged. */
  readonly stderr: Buffer;
}

export interface SpawnOutput {
  readonly status: number | null;
  readonly signal: string | null;
  readonly stdout: Buffer | null;
  readonly stderr: Buffer | null;
  readonly error?: { readonly code?: string } | undefined;
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeout: number;
  readonly maxBuffer: number;
}

/** The process port: the real one is spawnSync with no shell; tests may replace it. */
export type Spawn = (file: string, args: readonly string[], options: SpawnOptions) => SpawnOutput;

export const realSpawn: Spawn = (file, args, options) => {
  const r = spawnSync(file, [...args], {
    cwd: options.cwd,
    env: { ...options.env },
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    killSignal: "SIGKILL",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: r.status,
    signal: r.signal,
    stdout: r.stdout ?? null,
    stderr: r.stderr ?? null,
    error: r.error as { code?: string } | undefined,
  };
};

export interface RunnerLimits {
  readonly wallClock: DerivedLimit<"milliseconds">;
  readonly stdoutBytes: DerivedLimit<"bytes">;
  readonly stderrBytes: DerivedLimit<"bytes">;
}

export const RUNNER_LIMITS: RunnerLimits = Object.freeze({
  wallClock: LIMITS.renderWallClock,
  stdoutBytes: LIMITS.renderStdoutBytes,
  stderrBytes: LIMITS.renderStderrBytes,
});

/** The private directories a child sees as its home and helm's homes (all under `.crankpath`). */
export interface ChildHomes {
  readonly home: string;
  readonly tmp: string;
  readonly helmConfig: string;
  readonly helmCache: string;
  readonly helmData: string;
  readonly empty: string;
}

/** The environment allowlist's keys, in order (BR4.18). Nothing else ever reaches a child. */
export const CHILD_ENV_KEYS = Object.freeze([
  "PATH",
  "LANG",
  "LC_ALL",
  "HOME",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "HELM_CONFIG_HOME",
  "HELM_CACHE_HOME",
  "HELM_DATA_HOME",
  "HELM_PLUGINS",
  "HELM_NO_PLUGINS",
  "HELM_REGISTRY_CONFIG",
  "HELM_REPOSITORY_CONFIG",
  "HELM_REPOSITORY_CACHE",
  "KUSTOMIZE_PLUGIN_HOME",
  "DOCKER_CONFIG",
  "KUBECONFIG",
] as const);

/**
 * Builds the child environment from nothing but the private homes. The tools are started by
 * absolute path and need no PATH, so a child's PATH is an empty private directory (B2 review pass
 * 2, M1): a tool that tries to start another program (kustomize's `git` for a remote base it was
 * not stopped from fetching, a helm plugin) finds none. The locale is fixed (not inherited) so tool
 * output cannot vary with it. Registry and repository configuration point at files that do not
 * exist, so helm reads no credential and no repository list; plugins are disabled.
 */
export function buildChildEnv(homes: ChildHomes): Readonly<Record<string, string>> {
  const env: Record<(typeof CHILD_ENV_KEYS)[number], string> = {
    PATH: homes.empty,
    LANG: "C",
    LC_ALL: "C",
    HOME: homes.home,
    TMPDIR: homes.tmp,
    XDG_CONFIG_HOME: path.join(homes.home, ".config"),
    XDG_CACHE_HOME: path.join(homes.home, ".cache"),
    XDG_DATA_HOME: path.join(homes.home, ".local", "share"),
    HELM_CONFIG_HOME: homes.helmConfig,
    HELM_CACHE_HOME: homes.helmCache,
    HELM_DATA_HOME: homes.helmData,
    HELM_PLUGINS: homes.empty,
    HELM_NO_PLUGINS: "1",
    HELM_REGISTRY_CONFIG: path.join(homes.helmConfig, "registry", "config.json"),
    HELM_REPOSITORY_CONFIG: path.join(homes.helmConfig, "repositories.yaml"),
    HELM_REPOSITORY_CACHE: path.join(homes.helmCache, "repository"),
    KUSTOMIZE_PLUGIN_HOME: homes.empty,
    DOCKER_CONFIG: homes.empty,
    KUBECONFIG: "/dev/null",
  };
  return Object.freeze(env);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Checks a request against the allowlist; throws CommandRefused for anything else (BR4.17). */
export function checkAllowed(request: CommandRequest): AllowedCommand {
  const allowed = ALLOWED_COMMANDS.find((c) => c.tool === request.tool && sameList(c.subcommand, request.subcommand));
  if (allowed === undefined) {
    throw new CommandRefused(`not on the allowlist: ${request.tool} ${request.subcommand.join(" ")}`);
  }
  const args = request.args;
  let i = 0;
  while (i < args.length && args[i] !== "--") {
    const a = args[i] as string;
    const kind = Object.hasOwn(allowed.options, a) ? allowed.options[a] : undefined;
    if (kind === undefined) throw new CommandRefused(`option not allowed for ${request.tool}: ${a}`);
    if (kind === "flag") {
      i += 1;
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value === "--") throw new CommandRefused(`option without a value: ${a}`);
    if (typeof kind !== "string" && !kind.includes(value)) throw new CommandRefused(`fixed option value: ${a}`);
    if (a === "--repo" && !guardChartUrl(value).ok) throw new CommandRefused("--repo URL refused by the URL guard");
    i += 2;
  }
  const positionals = i < args.length ? args.slice(i + 1) : [];
  if (positionals.length !== allowed.positionals) {
    throw new CommandRefused(`${allowed.positionals} positional arguments expected after --`);
  }
  if (allowed.positionals > 0 && args[i] !== "--") throw new CommandRefused("positional arguments need --");
  for (const p of positionals) {
    if (p.length === 0 || p.includes("\0")) throw new CommandRefused("empty or NUL positional argument");
  }
  if (request.tool === "helm" && sameList(request.subcommand, ["pull"])) {
    const target = positionals[0] as string;
    const viaRepo = args.includes("--repo");
    if (viaRepo === target.includes("://"))
      throw new CommandRefused("helm pull needs a chart name with --repo, or an oci:// reference");
    if (!viaRepo && !(target.startsWith("oci://") && guardChartUrl(target).ok)) {
      throw new CommandRefused("helm pull reference refused by the URL guard");
    }
  }
  return allowed;
}

export interface CommandRunner {
  run(request: CommandRequest): CommandResult;
  /** The absolute path of a tool, or null when it is not on PATH. */
  binary(tool: Tool): string | null;
}

export interface RunnerConfig {
  readonly binaries: Readonly<Partial<Record<Tool, string | null>>>;
  readonly env: Readonly<Record<string, string>>;
  readonly limits?: RunnerLimits;
  readonly spawn?: Spawn;
}

const EMPTY = Buffer.alloc(0);

export function createCommandRunner(config: RunnerConfig): CommandRunner {
  const limits = config.limits ?? RUNNER_LIMITS;
  const spawn = config.spawn ?? realSpawn;
  return Object.freeze({
    binary: (tool: Tool) => config.binaries[tool] ?? null,
    run(request: CommandRequest): CommandResult {
      // git has its own runner (fixed options, per-call header, process group): never this one
      if (request.tool === "git") throw new CommandRefused("git runs only through the git runner");
      const allowed = checkAllowed(request);
      const file = config.binaries[request.tool] ?? null;
      const base = { tool: request.tool, subcommand: request.subcommand };
      if (file === null) {
        return Object.freeze({
          ...base,
          outcome: "not-started",
          exitCode: null,
          stdout: EMPTY,
          stdoutBytes: 0,
          stderrBytes: 0,
          overCap: null,
          timedOut: false,
          durationMs: 0,
          stderr: EMPTY,
        });
      }
      const stdoutCap = limits.stdoutBytes.value;
      const stderrCap = limits.stderrBytes.value;
      const started = performance.now();
      const r = spawn(file, [...request.subcommand, ...request.args], {
        cwd: request.cwd,
        env: allowed.closedProxy === true ? { ...config.env, ...CLOSED_PROXY_ENV } : config.env,
        timeout: limits.wallClock.value,
        // one buffer bound for both streams (spawnSync); each stream is checked against its own cap below
        maxBuffer: Math.max(stdoutCap, stderrCap) + 1,
      });
      const durationMs = Math.round(performance.now() - started);
      const stdout = r.stdout ?? EMPTY;
      const stderr = r.stderr ?? EMPTY;
      const code = r.error?.code;
      let outcome: CommandOutcome;
      let overCap: "stdout" | "stderr" | null = null;
      if (code === "ETIMEDOUT") outcome = "timed-out";
      else if (code === "ENOBUFS" || stdout.length > stdoutCap || stderr.length > stderrCap) {
        outcome = "over-cap";
        overCap = stdout.length > stdoutCap || (code === "ENOBUFS" && stderr.length <= stderrCap) ? "stdout" : "stderr";
      } else if (code !== undefined) outcome = "not-started";
      else if (r.status === 0 && r.signal === null) outcome = "ok";
      else outcome = "failed";
      return Object.freeze({
        ...base,
        outcome,
        exitCode: r.status,
        stdout: outcome === "ok" ? stdout : EMPTY,
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
        overCap,
        timedOut: outcome === "timed-out",
        durationMs,
        stderr: outcome === "over-cap" ? EMPTY : stderr,
      });
    },
  });
}
