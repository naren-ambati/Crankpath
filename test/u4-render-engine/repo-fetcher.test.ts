// RepoFetcher and its git forms (FR1.2, FR1.8, NFR11, BR4.11 to BR4.13, OD-9, OD-12, C12, C13):
// the URL guard, the token variable and where a token may go, the closed git allowlist with its
// fixed options, revisions, failure words and the cache layout, through a fake git (no network).
// The last block runs the installed git itself, offline (file:// only), to show that the fixed
// options refuse every transport but https and that a header given through the environment is
// never written into the clone.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  AUTH_HEADER_VARIABLE,
  buildGitEnv,
  checkGitAllowed,
  createGitRunner,
  GIT_CONFIG,
  GitCommandRefused,
  type GitRequest,
  gitArgv,
} from "../../src/u4-render-engine/git-runner.js";
import {
  authHeader,
  classifyFailure,
  createRepoFetcher,
  findGit,
  guardGitUrl,
  planRevision,
  tokenVariable,
} from "../../src/u4-render-engine/repo-fetcher.js";
import { allText, fakeGit, subcommandAt } from "../helpers/git-fake.js";
import { createWorkDir, resolveCacheRoot } from "../../src/u4-render-engine/work-dir.js";
import { estate, tempDir } from "../helpers/scan.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const URL = "https://git.acme.dev/ops/vendor";
const TOKEN = "tok-3f9b-NEVER-PRINT";
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const d = tempDir(prefix);
  cleanup.push(d);
  return fs.realpathSync(d);
}
function tree(): string {
  const d = estate({ "apps/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\n" });
  cleanup.push(d);
  return d;
}

describe("the URL guard (FR1.8, AC4.5.1)", () => {
  it("admits https URLs with a public host name, and gives the one origin a token may go to", () => {
    expect(guardGitUrl("https://Git.Acme.dev/ops/vendor.git")).toEqual({
      ok: true,
      url: "https://git.acme.dev/ops/vendor.git",
      origin: "https://git.acme.dev/",
      host: "git.acme.dev",
      port: null,
      normalised: "git.acme.dev/ops/vendor",
    });
    expect(guardGitUrl("https://git.acme.dev:8443/ops/x")).toMatchObject({
      ok: true,
      origin: "https://git.acme.dev:8443/",
    });
    expect(guardGitUrl("https://git.acme.dev:443/ops/x")).toMatchObject({
      ok: true,
      origin: "https://git.acme.dev/",
    });
  });
  it("refuses everything else by name, before any process", () => {
    const table: [string, string][] = [
      ["http://git.acme.dev/ops/x", "scheme"],
      ["git://git.acme.dev/ops/x", "scheme"],
      ["ssh://git@git.acme.dev/ops/x", "scheme"],
      ["git@git.acme.dev:ops/x", "scheme"],
      ["file:///srv/repo", "scheme"],
      ["https://user:pw@git.acme.dev/ops/x", "credential"],
      ["https://tok@git.acme.dev/ops/x", "credential"],
      ["https://git.acme.dev/ops/x?ref=main", "query"],
      ["https://git.acme.dev/ops/x#main", "query"],
      ["https://127.0.0.1/ops/x", "ip-literal"],
      ["https://2130706433/ops/x", "ip-literal"],
      ["https://0x7f.1/ops/x", "ip-literal"],
      ["https://017700000001/ops/x", "ip-literal"],
      ["https://[::1]/ops/x", "ip-literal"],
      ["https://[fe80::1]/ops/x", "ip-literal"],
      ["https://169.254.169.254/latest", "ip-literal"],
      ["https://localhost/ops/x", "loopback"],
      ["https://api.localhost/ops/x", "loopback"],
      ["https://printer.local/ops/x", "loopback"],
      ["https://gitea/ops/x", "internal"],
      ["https://gitea-http.gitea/ops/x", "internal"],
      ["https://gitea-http.gitea.svc/ops/x", "internal"],
      ["https://gitea.gitea.svc.cluster.local/ops/x", "internal"],
      ["https://metadata.google.internal/x", "internal"],
      ["https://forge.lan/ops/x", "internal"],
      ["https://gіt.acme.dev/ops/x", "not-ascii"],
      ["https://git.acme.dev/ops/x y", "not-ascii"],
      ["https://git%2eacme.dev/ops/x", "unparseable"],
      ["https://git.acme.dev\\@evil.example/x", "unparseable"],
      ["https://-bad-.acme.dev/x", "unparseable"],
      ["https://git.acme.dev", "path"],
      ["https://git.acme.dev/ops/../x", "path"],
      ["https://git.acme.dev/ops//x", "path"],
      ["https://git.acme.dev/.git/x", "path"],
    ];
    for (const [raw, problem] of table) expect(guardGitUrl(raw), raw).toEqual({ ok: false, problem });
  });
});

describe("tokens (NFR11, OD-9, AC4.5.2)", () => {
  it("are read from CRANKPATH_TOKEN_<HOST>: upper-cased, . to _ and - to __", () => {
    expect(tokenVariable("git.acme.dev")).toBe("CRANKPATH_TOKEN_GIT_ACME_DEV");
    expect(tokenVariable("my-forge.acme.dev")).toBe("CRANKPATH_TOKEN_MY__FORGE_ACME_DEV");
  });
  it("never share a variable between two hosts the guard admits", () => {
    const hosts = ["a-b.acme.dev", "a.b.acme.dev", "a--b.acme.dev", "ab.acme.dev", "a-.b.acme.dev"];
    const admitted = hosts.filter((h) => guardGitUrl(`https://${h}/x/y`).ok);
    expect(admitted).toEqual(["a-b.acme.dev", "a.b.acme.dev", "a--b.acme.dev", "ab.acme.dev"]);
    expect(new Set(admitted.map((h) => tokenVariable(h))).size).toBe(admitted.length);
  });
  it("go as a Basic Authorization header", () => {
    expect(authHeader("t")).toBe(`Authorization: Basic ${Buffer.from("x-access-token:t").toString("base64")}`);
  });
});

describe("revisions (OD-12, AC4.5.3)", () => {
  it("pin a full sha and flag every other form floating", () => {
    expect(planRevision(SHA)).toEqual({ ok: true, kind: "sha", value: SHA, floating: false });
    expect(planRevision(null)).toMatchObject({ ok: true, kind: "default", floating: true });
    expect(planRevision("HEAD")).toMatchObject({ ok: true, kind: "default", floating: true });
    expect(planRevision("main")).toMatchObject({ ok: true, kind: "branch", value: "main", floating: true });
    expect(planRevision("refs/tags/v1.0")).toMatchObject({ ok: true, kind: "ref", floating: true });
  });
  it("refuse an abbreviated sha and anything git could read as an option or a range", () => {
    expect(planRevision("8b9d40f")).toEqual({ ok: false, problem: "abbreviated" });
    for (const bad of ["--upload-pack=x", "-x", "a..b", "a b", "a/../b", "x.lock", "a//b", ".hidden", ""]) {
      expect(planRevision(bad), bad).toMatchObject({ ok: false });
    }
  });
});

describe("the closed git allowlist and fixed options (C12)", () => {
  const ok = (u: string) => guardGitUrl(u).ok;
  const clone = (args: string[], auth: GitRequest["auth"] = null): GitRequest => ({
    subcommand: ["clone"],
    args,
    cwd: "/x",
    auth,
  });
  it("allows the clone and the verification forms crankpath uses", () => {
    expect(() =>
      checkGitAllowed(clone(["--bare", "--depth", "1", "--single-branch", "--no-tags", "--", URL, "store"]), ok),
    ).not.toThrow();
    const repo = { gitDir: "/x/git", workTree: null, objectFormat: "sha1" } as const;
    for (const subcommand of [
      ["fsck", "--strict", "--no-dangling", "--no-progress"],
      ["rev-parse", "--verify", "HEAD^{commit}"],
      ["read-tree", "HEAD"],
    ]) {
      expect(() => checkGitAllowed({ subcommand, args: [], cwd: "/x", auth: null, repo }, ok)).not.toThrow();
    }
    expect(() =>
      checkGitAllowed(
        {
          subcommand: ["checkout-index", "--all", "--force", "--quiet"],
          args: [],
          cwd: "/x",
          auth: null,
          repo: { ...repo, workTree: "/x/tree" },
        },
        ok,
      ),
    ).not.toThrow();
  });
  it("refuses any other subcommand, option, value, URL or header origin", () => {
    const refused: GitRequest[] = [
      { subcommand: ["fetch"], args: [], cwd: "/x", auth: null },
      { subcommand: ["submodule", "update"], args: [], cwd: "/x", auth: null },
      { subcommand: ["rev-parse"], args: ["--verify", "HEAD"], cwd: "/x", auth: null },
      clone(["--recurse-submodules", "--", URL, "repo"]),
      clone(["--upload-pack", "x", "--", URL, "repo"]),
      clone(["--config", "core.hooksPath=.", "--", URL, "repo"]),
      clone(["--depth", "2", "--", URL, "repo"]),
      clone(["--revision", "--upload-pack=x", "--", URL, "repo"]),
      clone(["--revision", SHA, "--branch", "main", "--", URL, "repo"]),
      clone(["--", "file:///srv/repo", "repo"]),
      clone(["--", "http://git.acme.dev/ops/x", "repo"]),
      clone([URL, "repo"]),
      clone(["--", URL, "repo"], { origin: "https://evil.acme.dev/", header: "h" }),
      { subcommand: ["rev-parse", "--verify", "HEAD"], args: [], cwd: "/x", auth: null },
      {
        subcommand: ["rev-parse", "--verify", "HEAD^{commit}"],
        args: [],
        cwd: "/x",
        auth: { origin: "https://git.acme.dev/", header: "h" },
        repo: { gitDir: "/x/git", workTree: null, objectFormat: "sha1" },
      },
    ];
    for (const r of refused) expect(() => checkGitAllowed(r, ok), JSON.stringify(r)).toThrow(GitCommandRefused);
  });
  it("puts the fixed options first, and a token only behind --config-env, never in argv", () => {
    const req = clone(["--depth", "1", "--", URL, "repo"], {
      origin: "https://git.acme.dev/",
      header: authHeader(TOKEN),
    });
    const argv = gitArgv(req);
    expect(argv.slice(0, GIT_CONFIG.length * 2)).toEqual(GIT_CONFIG.flatMap(([k, v]) => ["-c", `${k}=${v}`]));
    expect(argv).toContain(`http.https://git.acme.dev/.extraHeader=${AUTH_HEADER_VARIABLE}`);
    expect(argv.join(" ")).not.toContain(TOKEN);
    expect(argv.join(" ")).not.toContain(Buffer.from(`x-access-token:${TOKEN}`).toString("base64"));
    expect(argv.slice(subcommandAt(argv))).toEqual(["clone", "--depth", "1", "--", URL, "repo"]);
  });
  it("builds the child environment from nothing: no inherited variable, no proxy, no global config", () => {
    process.env.CRANKPATH_TEST_LEAK = "leak";
    const env = buildGitEnv("/h", "/e", null);
    expect(Object.keys(env).sort()).toEqual(
      [
        "GIT_ATTR_NOSYSTEM",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_NO_REPLACE_OBJECTS",
        "GIT_PROTOCOL_FROM_USER",
        "GIT_TERMINAL_PROMPT",
        "HOME",
        "LANG",
        "LC_ALL",
        "PATH",
        "TMPDIR",
        "XDG_CONFIG_HOME",
      ].sort(),
    );
    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(buildGitEnv("/h", "/e", "H")[AUTH_HEADER_VARIABLE]).toBe("H");
    delete process.env.CRANKPATH_TEST_LEAK;
  });
  // the options are shown by their behaviour against the installed git, not by a copy of the
  // list (B3 review m6): test/u4-render-engine/review-b3.test.ts
});

describe("failures are what they are (never gone, never a pass)", () => {
  const r = (stderr: string) => classifyFailure({ outcome: "failed", exitCode: 128, stdout: "", stderr });
  it("names each outcome in fixed words, and says the repository may exist", () => {
    expect(r("fatal: unable to access 'https://x/': The requested URL returned error: 403")).toMatch(
      /HTTP 403.*unknown whether/,
    );
    expect(r("remote: Repository not found.\nfatal: repository 'https://x/' not found")).toMatch(
      /HTTP 404.*unknown whether/,
    );
    expect(r("fatal: could not read Username for 'https://x': terminal prompts disabled")).toMatch(/HTTP 401/);
    expect(r("fatal: unable to access 'https://x/': The requested URL returned error: 429")).toMatch(/rate limited/);
    expect(r("fatal: unable to access 'https://x/': The requested URL returned error: 301")).toMatch(
      /redirect \(HTTP 301\), which is never followed/,
    );
    expect(r("fatal: Remote branch nope not found in upstream origin")).toBe(
      "the revision was not found on the server",
    );
    expect(r("fatal: unable to access: Could not resolve host: x")).toBe("the host name did not resolve");
    expect(r("something else")).toMatch(/unknown whether the repository exists/);
    expect(classifyFailure({ outcome: "timed-out", exitCode: null, stdout: "", stderr: "" })).toMatch(/timed out/);
    for (const s of ["403", "404", "401", "429", "x"])
      expect(r(s)).not.toMatch(/\bgone\b|absent|deleted|does not exist/);
  });
});

describe("the fetch (fake git)", () => {
  function fetcher(
    options: { network?: boolean; trusted?: boolean; env?: Record<string, string>; fail?: Record<string, string> } = {},
  ) {
    const cache = dir("cache");
    const git = fakeGit({
      trees: { [URL]: tree(), "https://git.acme.dev/ops/other": tree() },
      sha: SHA,
      ...(options.fail ? { fail: options.fail } : {}),
    });
    const work = createWorkDir(cache, options.trusted ?? true);
    const f = createRepoFetcher({
      work,
      network: options.network ?? true,
      env: (n) => options.env?.[n],
      git: "/usr/bin/git",
      spawn: git.spawn,
    });
    return { f, git, cache, work };
  }
  it("clones a shallow bare store into .crankpath/repos/<host>/<path>@<sha>/, scans the run's own copy, and records the commit (C13, AC4.5.3)", () => {
    const { f, git, cache, work } = fetcher();
    const r = f.fetch(URL, SHA);
    expect(r).toMatchObject({ ok: true, commit: SHA, floating: false, cached: false });
    // the scanned files are materialised in the run directory, never the cache entry (pass 2, M1)
    expect((r.ok ? r.dir : "").startsWith(`${work.runDir}${path.sep}`)).toBe(true);
    const cloneArgs = git.calls[0]?.args ?? [];
    expect(cloneArgs.slice(subcommandAt(cloneArgs))).toEqual([
      "clone",
      "--bare",
      "--depth",
      "1",
      "--single-branch",
      "--no-tags",
      "--no-recurse-submodules",
      "--quiet",
      "--revision",
      SHA,
      "--",
      URL,
      "store",
    ]);
    expect(fs.existsSync(path.join(r.ok ? r.dir : "", "apps", "cm.yaml"))).toBe(true);
    // the fetch's private directory was in the run's WorkDir: gone with it; the cached store stays
    work.cleanup();
    expect(fs.readdirSync(path.join(cache, "tmp"))).toEqual([]);
    expect(fs.existsSync(path.join(cache, "repos", "git.acme.dev", "ops", `vendor@${SHA}`, "objects", "pack"))).toBe(
      true,
    );
  });
  it("flags a branch and the default branch floating, with the commit it got", () => {
    const { f, git } = fetcher();
    expect(f.fetch(URL, "main")).toMatchObject({ ok: true, commit: SHA, floating: true });
    expect(git.calls[0]?.args).toEqual(expect.arrayContaining(["--branch", "main"]));
    expect(f.fetch(URL, null)).toMatchObject({ ok: true, floating: true });
  });
  it("reads a trusted cache of a pinned commit offline, once git has verified it", () => {
    const { f, git, cache } = fetcher();
    expect(f.fetch(URL, SHA)).toMatchObject({ ok: true, cached: false });
    const offline = createRepoFetcher({
      work: createWorkDir(cache, true),
      network: false,
      env: () => undefined,
      git: "/usr/bin/git",
      spawn: git.spawn,
    });
    expect(offline.fetch(URL, SHA)).toMatchObject({ ok: true, cached: true, commit: SHA });
    expect(offline.fetch(URL, "main")).toMatchObject({ ok: false, reason: "offline" });
    const untrusted = createRepoFetcher({
      work: createWorkDir(cache, false),
      network: false,
      env: () => undefined,
      git: null,
    });
    expect(untrusted.fetch(URL, SHA)).toMatchObject({ ok: false, reason: "offline" });
  });
  it("in an untrusted cache, fetches for this run only and removes it at the end", () => {
    const { f, cache, work } = fetcher({ trusted: false });
    const r = f.fetch(URL, SHA);
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(cache, "repos"))).toBe(false);
    work.cleanup();
    expect(fs.existsSync(r.ok ? r.dir : "x")).toBe(false);
  });
  it("sends a token only to its own host, only through the call's environment (AC4.5.2)", () => {
    const { f, git, cache } = fetcher({
      env: { CRANKPATH_TOKEN_GIT_ACME_DEV: TOKEN, CRANKPATH_TOKEN_EVIL_ACME_DEV: "evil-token" },
    });
    expect(f.fetch(URL, SHA).ok).toBe(true);
    const [clone, revParse] = git.calls as [(typeof git.calls)[0], (typeof git.calls)[0]];
    expect(clone.env[AUTH_HEADER_VARIABLE]).toBe(authHeader(TOKEN));
    expect(clone.args).toContain(`http.https://git.acme.dev/.extraHeader=${AUTH_HEADER_VARIABLE}`);
    expect(clone.args.join("\n")).not.toContain(TOKEN);
    expect(revParse.env[AUTH_HEADER_VARIABLE]).toBeUndefined();
    expect(JSON.stringify(git.calls)).not.toContain("evil-token");
    expect(allText(cache)).not.toContain(TOKEN);
    expect(allText(cache)).not.toContain(Buffer.from(`x-access-token:${TOKEN}`).toString("base64"));
  });
  it("gives another host no token: a token never follows the input to another host", () => {
    const { f, git } = fetcher({ env: { CRANKPATH_TOKEN_GITHUB_COM: TOKEN } });
    expect(f.fetch(URL, SHA).ok).toBe(true);
    expect(JSON.stringify(git.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(git.calls)).not.toContain(AUTH_HEADER_VARIABLE);
  });
  it("is unreadable-repo with fixed words on a 403, never gone, and runs no second attempt", () => {
    const { f, git } = fetcher({ fail: { [URL]: "fatal: unable to access: The requested URL returned error: 403" } });
    expect(f.fetch(URL, SHA)).toEqual({
      ok: false,
      reason: "unreadable-repo",
      detail: "refused by the server (HTTP 403); unknown whether the repository exists",
    });
    expect(git.calls).toHaveLength(1);
  });
  it("refuses a guarded URL and an abbreviated sha before any process", () => {
    const { f, git } = fetcher();
    expect(f.fetch("https://127.0.0.1/ops/x", SHA)).toMatchObject({ ok: false, reason: "unreadable-repo" });
    expect(f.fetch("http://git.acme.dev/ops/x", null)).toMatchObject({ ok: false, detail: /only https/ });
    expect(f.fetch(URL, "8b9d40f")).toMatchObject({ ok: false, detail: /abbreviated/ });
    expect(git.calls).toHaveLength(0);
  });
  it("is tool-missing without git, and offline under --no-network", () => {
    expect(
      createRepoFetcher({ work: createWorkDir(dir("c"), true), network: true, env: () => undefined, git: null }).fetch(
        URL,
        null,
      ),
    ).toMatchObject({
      ok: false,
      reason: "tool-missing",
    });
    expect(fetcher({ network: false }).f.fetch(URL, null)).toMatchObject({ ok: false, reason: "offline" });
  });
});

describe("where the cache is (C13)", () => {
  it("is the WorkDir's (B2): a URL to fetch has no scanned tree yet, so its cache is trusted", () => {
    const cwd = dir("cwd");
    expect(resolveCacheRoot(cwd, undefined, null)).toEqual({
      ok: true,
      cacheRoot: path.join(cwd, ".crankpath"),
      trusted: true,
    });
    expect(resolveCacheRoot(cwd, undefined, cwd)).toMatchObject({ ok: true, trusted: false });
  });
  it("finds git only as an executable regular file on an absolute PATH entry", () => {
    const d = dir("path");
    fs.writeFileSync(path.join(d, "git"), "x", { mode: 0o644 });
    expect(findGit(`relative:${d}`)).toBeNull();
  });
});

const realGit = findGit(process.env.PATH ?? "");
describe.skipIf(realGit === null)("the installed git under the fixed options (offline: file:// only)", () => {
  function bareRepo(): string {
    const work = dir("work");
    const run = (args: string[], cwd: string) => {
      const r = spawnSync(realGit as string, args, {
        cwd,
        env: { PATH: "", HOME: work, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", LANG: "C" },
      });
      if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
    };
    run(["init", "-q", "src"], work);
    fs.writeFileSync(path.join(work, "src", "a.yaml"), "x: 1\n");
    run(["add", "a.yaml"], path.join(work, "src"));
    run(
      ["-c", "user.name=crankpath-test", "-c", "user.email=test@acme.dev", "commit", "-q", "-m", "x"],
      path.join(work, "src"),
    );
    run(["clone", "-q", "--bare", "src", "bare.git"], work);
    return path.join(work, "bare.git");
  }
  it("refuses the file transport (protocol.allow=never) even when the guard is bypassed", () => {
    const bare = bareRepo();
    const work = dir("clone");
    fs.mkdirSync(path.join(work, "home"));
    fs.mkdirSync(path.join(work, "empty"));
    const runner = createGitRunner({
      git: realGit,
      home: path.join(work, "home"),
      empty: path.join(work, "empty"),
      guard: () => true,
    });
    const r = runner.run({
      subcommand: ["clone"],
      args: ["--depth", "1", "--quiet", "--", `file://${bare}`, "repo"],
      cwd: work,
      auth: null,
    });
    expect(r.outcome).toBe("failed");
    expect(r.stderr).toMatch(/transport 'file' not allowed/);
    expect(fs.existsSync(path.join(work, "repo", "a.yaml"))).toBe(false);
  });
  it("never writes a header given through the environment into the clone, and installs no hook", () => {
    const bare = bareRepo();
    const work = dir("clone");
    fs.mkdirSync(path.join(work, "home"));
    const header = authHeader(TOKEN);
    const argv = gitArgv({
      subcommand: ["clone"],
      args: ["--depth", "1", "--quiet", "--", `file://${bare}`, "repo"],
      cwd: work,
      auth: { origin: "https://git.acme.dev/", header },
    }).map((a) => (a === "protocol.allow=never" ? "protocol.file.allow=always" : a));
    const r = spawnSync(realGit as string, argv, {
      cwd: work,
      env: { ...buildGitEnv(path.join(work, "home"), path.join(work, "home"), header) },
    });
    expect(r.status, String(r.stderr)).toBe(0);
    expect(fs.readFileSync(path.join(work, "repo", "a.yaml"), "utf8")).toBe("x: 1\n");
    const text = allText(work);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(header);
    expect(text).not.toContain(Buffer.from(`x-access-token:${TOKEN}`).toString("base64"));
    const hooks = path.join(work, "repo", ".git", "hooks");
    expect(fs.existsSync(hooks) ? fs.readdirSync(hooks) : []).toEqual([]);
    const head = createGitRunner({
      git: realGit,
      home: path.join(work, "home"),
      empty: path.join(work, "home"),
      guard: () => true,
    }).run({
      subcommand: ["rev-parse", "--verify", "HEAD^{commit}"],
      args: [],
      cwd: path.join(work, "repo"),
      auth: null,
      repo: { gitDir: path.join(work, "repo", ".git"), workTree: null, objectFormat: "sha1" },
    });
    expect(head.outcome).toBe("ok");
    expect(head.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
  });
});
