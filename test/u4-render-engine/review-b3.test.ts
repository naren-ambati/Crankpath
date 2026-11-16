// Regression tests for the B3 review (reviews/bolt-3-review.md): m1 (a token scoped to host and
// port), m2 (a timed-out git leaves no helper alive), m3 (git's real failure texts), m4
// (special-use names), m5 (the checkout size cap), m6 (guards and fixed options shown by
// behaviour), m8 (a floating fetch's commit is cached). The behaviour tests run the installed
// git against a loopback listener this test starts (127.0.0.1 only; the only token is a dummy);
// to reach it the fixed options are used with `protocol.http.allow` in place of https, the one
// change, named where it is made.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildGitEnv,
  checkGitAllowed,
  createGitRunner,
  GIT_CONFIG,
  GitCommandRefused,
  type GitRequest,
  gitArgv,
  realGitSpawn,
} from "../../src/u4-render-engine/git-runner.js";
import {
  authHeader,
  checkoutSize,
  classifyFailure,
  createRepoFetcher,
  findGit,
  guardGitUrl,
  SPECIAL_USE_NAMES,
  tokenVariable,
} from "../../src/u4-render-engine/repo-fetcher.js";
import { fakeGit } from "../helpers/git-fake.js";
import { createWorkDir } from "../../src/u4-render-engine/work-dir.js";
import { estate, tempDir } from "../helpers/scan.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const VENDOR_URL = "https://git.acme.dev/ops/vendor";
const TOKEN = "dummy-review-token-0001";
const RECORDED = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("../fixtures/git-stderr/git-2.55.0.json", import.meta.url)), "utf8"),
) as { stderr: Record<string, string> };
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const d = tempDir(prefix);
  cleanup.push(d);
  return fs.realpathSync(d);
}
function tree(files: Record<string, string> = { "a.yaml": "x: 1\n" }): string {
  const d = estate(files);
  cleanup.push(d);
  return d;
}
const failed = (stderr: string) => classifyFailure({ outcome: "failed", exitCode: 128, stdout: "", stderr });

describe("m1: a token goes to its host and port only", () => {
  it("names the port in the variable for a port other than 443", () => {
    expect(tokenVariable("git.acme.dev")).toBe("CRANKPATH_TOKEN_GIT_ACME_DEV");
    expect(tokenVariable("git.acme.dev", "8443")).toBe("CRANKPATH_TOKEN_GIT_ACME_DEV_8443");
    expect(guardGitUrl("https://git.acme.dev:8443/ops/x")).toMatchObject({ ok: true, port: "8443" });
    expect(guardGitUrl("https://git.acme.dev:443/ops/x")).toMatchObject({ ok: true, port: null });
  });
  it("sends the default port's token to no other port, and another port's token only there", () => {
    const run = (env: Record<string, string>) => {
      const git = fakeGit({ trees: { "https://git.acme.dev:8443/ops/x": tree() }, sha: SHA });
      const f = createRepoFetcher({
        work: createWorkDir(dir("cache"), true),
        network: true,
        env: (n) => env[n],
        git: "/usr/bin/git",
        spawn: git.spawn,
      });
      expect(f.fetch("https://git.acme.dev:8443/ops/x", SHA).ok).toBe(true);
      return git.calls[0];
    };
    expect(run({ CRANKPATH_TOKEN_GIT_ACME_DEV: TOKEN })?.env.CRANKPATH_GIT_AUTH_HEADER).toBeUndefined();
    const scoped = run({ CRANKPATH_TOKEN_GIT_ACME_DEV_8443: TOKEN });
    expect(scoped?.env.CRANKPATH_GIT_AUTH_HEADER).toBe(authHeader(TOKEN));
    expect(scoped?.args).toContain("http.https://git.acme.dev:8443/.extraHeader=CRANKPATH_GIT_AUTH_HEADER");
  });
});

describe("m3: the failure words come from git's real texts (recorded with git 2.55.0)", () => {
  it("names a 401, 403, 404 and a refused redirect from what git actually prints", () => {
    expect(failed(RECORDED.stderr["401"] as string)).toMatch(/^the server asks for a credential \(HTTP 401\)/);
    expect(failed(RECORDED.stderr["401-with-token"] as string)).toMatch(/HTTP 401/);
    expect(failed(RECORDED.stderr["403"] as string)).toMatch(/^refused by the server \(HTTP 403\)/);
    expect(failed(RECORDED.stderr["404"] as string)).toMatch(/^not found or not visible \(HTTP 404\)/);
    expect(failed(RECORDED.stderr["301"] as string)).toMatch(
      /^the server answered with a redirect \(HTTP 301\), which is never followed/,
    );
    for (const t of Object.values(RECORDED.stderr)) expect(failed(t)).toMatch(/unknown whether the repository exists/);
  });
});

describe("m4: special-use names (IANA registry) are never fetched from", () => {
  it("refuses each registry name and every name under it, and anything under arpa", () => {
    for (const n of SPECIAL_USE_NAMES) {
      for (const host of [n, `git.${n}`]) {
        const r = guardGitUrl(`https://${host}/ops/x`);
        expect(r.ok, host).toBe(false);
      }
    }
    for (const host of [
      "forge.home.arpa",
      "1.0.168.192.in-addr.arpa",
      "x.ip6.arpa",
      "git.example.org",
      "a.b.test",
      "x.onion",
      "repo.invalid",
    ]) {
      expect(guardGitUrl(`https://${host}/ops/x`), host).toMatchObject({ ok: false });
    }
    expect(guardGitUrl("https://git.acme.dev/ops/x").ok).toBe(true);
    expect(guardGitUrl("https://examples.org/ops/x").ok).toBe(true);
  });
});

describe("m5: a fetched checkout's size is capped", () => {
  it("measures every regular file of a fetched directory, and stops at either bound", () => {
    const d = tree({ "a.bin": "x".repeat(5000), "b/c.yaml": "y: 1\n" });
    expect(checkoutSize(d, 10_000, 100)).toBeNull();
    expect(checkoutSize(d, 4000, 100)).toMatch(/larger than the run could read/);
    expect(checkoutSize(d, 10_000, 1)).toMatch(/more files than a scan lists/);
  });
  it("refuses a clone over the cap as a counted limit and removes it", () => {
    const git = fakeGit({ trees: { [VENDOR_URL]: tree({ "big.bin": "z".repeat(20_000) }) }, sha: SHA });
    const cache = dir("cache");
    const f = createRepoFetcher({
      work: createWorkDir(cache, true),
      network: true,
      env: () => undefined,
      git: "/usr/bin/git",
      spawn: git.spawn,
      checkoutBytes: 10_000,
    });
    expect(f.fetch(VENDOR_URL, SHA)).toEqual({
      ok: false,
      reason: "limit",
      detail: "the fetched repository is larger than the run could read (fetchedRepoBytes)",
    });
    expect(fs.existsSync(path.join(cache, "repos"))).toBe(false);
  });
});

describe("m6: each guard has a test that fails without it", () => {
  it("refuses a pinned fetch that resolved to another commit", () => {
    const git = fakeGit({ trees: { [VENDOR_URL]: tree() }, sha: OTHER_SHA });
    const f = createRepoFetcher({
      work: createWorkDir(dir("c"), true),
      network: true,
      env: () => undefined,
      git: "/g",
      spawn: git.spawn,
    });
    expect(f.fetch(VENDOR_URL, SHA)).toEqual({
      ok: false,
      reason: "unreadable-repo",
      detail: "the fetched commit is not the one asked for",
    });
  });
  it("refuses a name with a svc label anywhere, even under a public domain", () => {
    expect(guardGitUrl("https://kubernetes.default.svc.acme.dev/ops/x")).toEqual({ ok: false, problem: "internal" });
  });
  it("refuses a revision that reads as an option at the allowlist itself, whatever the planner did", () => {
    const req = (rev: string): GitRequest => ({
      subcommand: ["clone"],
      args: ["--branch", rev, "--", VENDOR_URL, "repo"],
      cwd: "/x",
      auth: null,
    });
    expect(() => checkGitAllowed(req("-x"), () => true)).toThrow(GitCommandRefused);
    expect(() => checkGitAllowed(req("--upload-pack=/bin/sh"), () => true)).toThrow(GitCommandRefused);
    expect(() => checkGitAllowed(req("main"), () => true)).not.toThrow();
  });
  it("scopes a header to a prefix of the clone URL, never to an origin found inside it", () => {
    const r: GitRequest = {
      subcommand: ["clone"],
      args: ["--", "https://evil.acme.net/https://git.acme.dev/x", "repo"],
      cwd: "/x",
      auth: { origin: "https://git.acme.dev/", header: "h" },
    };
    expect(() => checkGitAllowed(r, () => true)).toThrow(/another origin/);
  });
});

describe("m8: a floating fetch is cached under the commit it resolved to", () => {
  it("serves a later pinned fetch of that commit from the cache, offline too", () => {
    const cache = dir("cache");
    const git = fakeGit({ trees: { [VENDOR_URL]: tree() }, sha: SHA });
    const online = createRepoFetcher({
      work: createWorkDir(cache, true),
      network: true,
      env: () => undefined,
      git: "/g",
      spawn: git.spawn,
    });
    expect(online.fetch(VENDOR_URL, "main")).toMatchObject({ ok: true, commit: SHA, floating: true });
    const offline = createRepoFetcher({
      work: createWorkDir(cache, true),
      network: false,
      env: () => undefined,
      git: "/g",
      spawn: git.spawn,
    });
    expect(offline.fetch(VENDOR_URL, SHA)).toMatchObject({ ok: true, commit: SHA, cached: true, floating: false });
  });
});

// ---------------------------------------------------------------------------------------------
// The installed git, against a loopback listener (no network beyond 127.0.0.1)

const realGit = findGit(process.env.PATH ?? "");
const SERVER = fileURLToPath(new URL("../support/git-http-server.mjs", import.meta.url));

describe.skipIf(realGit === null)("the installed git under the fixed options, against a loopback listener", () => {
  let server: ChildProcess;
  let port = 0;
  let log = "";
  const base = () => `http://127.0.0.1:${port}`;
  beforeAll(async () => {
    const d = dir("srv");
    log = path.join(d, "log.jsonl");
    fs.writeFileSync(log, "");
    server = spawn(process.execPath, [SERVER, log], { stdio: ["ignore", "pipe", "inherit"] });
    port = await new Promise<number>((resolve) => {
      server.stdout?.once("data", (b: Buffer) => resolve(Number(String(b).trim())));
    });
  });
  afterAll(() => {
    server.kill("SIGKILL");
  });
  const requests = () =>
    fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as { path: string; auth: string | null });

  /** The fixed argv with the one change the loopback test needs: http allowed in place of https. */
  function overHttp(req: GitRequest, extra: (a: string[]) => string[] = (a) => a): string[] {
    return extra(gitArgv(req).map((a) => (a === "protocol.https.allow=always" ? "protocol.http.allow=always" : a)));
  }
  function git(args: string[], cwd: string, env: Record<string, string>, timeout = 20_000) {
    const r = realGitSpawn(realGit as string, args, { cwd, env, timeout, maxBuffer: 1 << 20 });
    return { status: r.status, stderr: String(r.stderr ?? ""), timedOut: r.error?.code === "ETIMEDOUT" };
  }
  function clone(
    p: string,
    opts: {
      auth?: GitRequest["auth"];
      extra?: (a: string[]) => string[];
      env?: Record<string, string>;
      timeout?: number;
    } = {},
  ) {
    const cwd = dir("clone");
    fs.mkdirSync(path.join(cwd, "home"));
    const req: GitRequest = {
      subcommand: ["clone"],
      args: ["--depth", "1", "--quiet", "--", `${base()}/${p}`, "repo"],
      cwd,
      auth: opts.auth ?? null,
    };
    const env = {
      ...buildGitEnv(path.join(cwd, "home"), path.join(cwd, "home"), opts.auth?.header ?? null),
      ...opts.env,
    };
    return { cwd, ...git(overHttp(req, opts.extra), cwd, env, opts.timeout) };
  }
  const withPort = (t: string) => t.replace(/<port>/g, String(port));

  it("m3: prints the recorded texts, and they are classified by status", () => {
    for (const code of ["401", "403", "404"]) {
      const r = clone(`status/${code}/x/y`);
      expect(r.status, code).toBe(128);
      expect(r.stderr, code).toBe(withPort(RECORDED.stderr[code] as string));
      expect(failed(r.stderr)).toContain(`HTTP ${code}`);
    }
  });
  it("http.followRedirects=false: a 301 is an error, its target never requested, no header carried", () => {
    const before = requests().length;
    const r = clone("redirect/a/b", { auth: { origin: `${base()}/`, header: authHeader(TOKEN) } });
    expect(r.stderr).toBe(withPort(RECORDED.stderr["301"] as string).replace("/redirect/x/y/", "/redirect/a/b/"));
    const seen = requests().slice(before);
    expect(seen.map((q) => q.path)).toEqual(["/redirect/a/b/info/refs?service=git-upload-pack"]);
    // control: the same clone allowed to follow requests the target
    const followed = clone("redirect/c/d", {
      extra: (a) => a.map((x) => (x === "http.followRedirects=false" ? "http.followRedirects=true" : x)),
    });
    expect(followed.status).toBe(128);
    expect(requests().map((q) => q.path)).toContain("/status/404/c/d/info/refs?service=git-upload-pack");
  });
  it("--config-env: the header goes to its exact origin, never to another host name or port", () => {
    const before = requests().length;
    clone("status/404/h/1", { auth: { origin: `${base()}/`, header: authHeader(TOKEN) } });
    clone("status/404/h/2", { auth: { origin: `http://127.0.0.1:${port + 1}/`, header: authHeader(TOKEN) } });
    clone("status/404/h/3", { auth: { origin: `http://localhost:${port}/`, header: authHeader(TOKEN) } });
    const seen = requests().slice(before);
    expect(seen.map((q) => q.auth !== null)).toEqual([true, false, false]);
  });
  it("credential.helper is cleared: a helper from a config file is never asked", () => {
    const d = dir("helper");
    const marker = path.join(d, "asked");
    const script = path.join(d, "helper.sh");
    fs.writeFileSync(script, `#!/bin/sh\necho asked > ${marker}\n`, { mode: 0o755 });
    const cfg = path.join(d, "gitconfig");
    fs.writeFileSync(cfg, `[credential]\n\thelper = ${script}\n`);
    clone("status/401/c/1", { env: { GIT_CONFIG_GLOBAL: cfg } });
    expect(fs.existsSync(marker)).toBe(false);
    // control: without the fixed option the same helper is asked
    clone("status/401/c/2", {
      env: { GIT_CONFIG_GLOBAL: cfg },
      extra: (a) =>
        a.filter((x, i) => !(x === "credential.helper=" || (a[i + 1] === "credential.helper=" && x === "-c"))),
    });
    expect(fs.existsSync(marker)).toBe(true);
  });
  it("core.hooksPath=/dev/null: a hook a template would install never runs on a clone", () => {
    const d = dir("hooks");
    const env0 = { PATH: "", HOME: d, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    const run0 = (args: string[], cwd: string) => {
      const r = spawnSync(realGit as string, args, { cwd, env: env0 });
      if (r.status !== 0) throw new Error(String(r.stderr));
    };
    run0(["init", "-q", "src"], d);
    fs.writeFileSync(path.join(d, "src", "a.yaml"), "x: 1\n");
    run0(["add", "a.yaml"], path.join(d, "src"));
    run0(
      ["-c", "user.name=crankpath-test", "-c", "user.email=test@acme.dev", "commit", "-q", "-m", "x"],
      path.join(d, "src"),
    );
    const marker = path.join(d, "ran");
    fs.mkdirSync(path.join(d, "tpl", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(d, "tpl", "hooks", "post-checkout"), `#!/bin/sh\necho ran > ${marker}\n`, {
      mode: 0o755,
    });
    const localClone = (target: string, change: (a: string[]) => string[]) => {
      const req: GitRequest = {
        subcommand: ["clone"],
        args: ["--quiet", "--", `file://${path.join(d, "src")}`, target],
        cwd: d,
        auth: null,
      };
      // the loopback change here: the file protocol allowed, and a template with a hook
      const argv = change(
        gitArgv(req).map((x) =>
          x === "protocol.https.allow=always"
            ? "protocol.file.allow=always"
            : x === "init.templateDir="
              ? `init.templateDir=${path.join(d, "tpl")}`
              : x,
        ),
      );
      return git(argv, d, buildGitEnv(d, d, null));
    };
    expect(localClone("one", (a) => a).status).toBe(0);
    expect(fs.existsSync(path.join(d, "one", "a.yaml"))).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
    // control: without the fixed option the template's hook runs
    expect(
      localClone("two", (a) => a.map((x) => (x === "core.hooksPath=/dev/null" ? "core.fsmonitor=false" : x))).status,
    ).toBe(0);
    expect(fs.existsSync(marker)).toBe(true);
  });
  it("protocol.allow=never: plain http and file are refused under the unchanged options", () => {
    const cwd = dir("proto");
    fs.mkdirSync(path.join(cwd, "home"));
    const env = buildGitEnv(path.join(cwd, "home"), path.join(cwd, "home"), null);
    const req: GitRequest = {
      subcommand: ["clone"],
      args: ["--quiet", "--", `${base()}/status/404/p`, "repo"],
      cwd,
      auth: null,
    };
    const r = git(gitArgv(req), cwd, env);
    expect(r.stderr).toMatch(/transport 'http' not allowed/);
    expect(requests().map((q) => q.path)).not.toContain("/status/404/p/info/refs?service=git-upload-pack");
  });
  it("safe.bareRepository=explicit: a bare repository found from the working directory is not used", () => {
    const d = dir("bare");
    spawnSync(realGit as string, ["init", "-q", "--bare", "b.git"], {
      cwd: d,
      env: { PATH: "", HOME: d, GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    const env = buildGitEnv(d, d, null);
    const req: GitRequest = {
      subcommand: ["rev-parse", "--verify", "HEAD"],
      args: [],
      cwd: path.join(d, "b.git"),
      auth: null,
    };
    const ours = git(gitArgv(req), path.join(d, "b.git"), env);
    expect(ours.stderr).toMatch(/cannot use bare repository/);
    const control = git(
      gitArgv(req).map((x) => (x === "safe.bareRepository=explicit" ? "safe.bareRepository=all" : x)),
      path.join(d, "b.git"),
      env,
    );
    expect(control.stderr).not.toMatch(/cannot use bare repository/);
  });
  it("m2: a timed-out fetch leaves no git process alive (the whole group is killed)", () => {
    const r = clone("slow/s/t", { timeout: 2000, auth: { origin: `${base()}/`, header: authHeader(TOKEN) } });
    expect(r.timedOut).toBe(true);
    const ps = spawnSync("ps", ["-A", "-o", "command"], { encoding: "utf8" }).stdout;
    const alive = ps.split("\n").filter((l) => l.includes(`127.0.0.1:${port}/slow/s/t`));
    expect(alive).toEqual([]);
  });
  it("every fixed option is a configuration key the installed git knows", () => {
    const known = new Set(
      String(
        spawnSync(realGit as string, ["help", "--config"], {
          encoding: "utf8",
          env: { PATH: "", HOME: "/nonexistent" },
        }).stdout,
      )
        .split("\n")
        .map((l) => l.trim().toLowerCase()),
    );
    // a listed key with a placeholder (`protocol.<name>.allow`) stands for every name
    const patterns = [...known]
      .filter((k) => k.includes("<"))
      .map((k) => new RegExp(`^${k.replace(/[.]/g, "\\.").replace(/<[^>]+>/g, "[^.]+")}$`));
    for (const [k] of GIT_CONFIG) {
      const key = k.toLowerCase();
      expect(known.has(key) || patterns.some((r) => r.test(key)), k).toBe(true);
    }
  });
  it("runs a real clone through the runner as the fetcher does (guard bypassed for the loopback URL only)", () => {
    const cwd = dir("runner");
    fs.mkdirSync(path.join(cwd, "home"));
    const runner = createGitRunner({
      git: realGit,
      home: path.join(cwd, "home"),
      empty: path.join(cwd, "home"),
      guard: () => true,
      wallClock: 5000,
    });
    const r = runner.run({
      subcommand: ["clone"],
      args: ["--quiet", "--", `${base()}/status/403/r`, "repo"],
      cwd,
      auth: null,
    });
    // the unchanged options refuse plain http before any request
    expect(r.outcome).toBe("failed");
    expect(r.stderr).toMatch(/not allowed/);
  });
});
