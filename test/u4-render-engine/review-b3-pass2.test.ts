// Regression tests for the B3 second review pass (reviews/bolt-3-review-pass-2.md). M1: a cached
// repository is read only after git has verified its objects (fsck, HEAD equal to the commit
// asked for), and only from files materialised from those objects into the run's own directory;
// nothing of the cache entry's own work tree, config, hooks or alternates is ever read. M2: one
// run makes at most fetchesPerRun fetches. m1: the process-group helper kills git's whole group
// on every way it ends (over the output cap, SIGINT, SIGTERM, SIGHUP). m2: one behaviour test
// per guard the mutation run found untested. Nits: control characters in a path, a port with
// leading zeros. The real-git blocks build their object stores with the installed git, locally
// (file:// with that protocol allowed for the set-up only); no network, dummy tokens only.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { RUN_LIMITS } from "../../src/u1-graph-model/run-limits.js";
import {
  AUTH_HEADER_VARIABLE,
  buildGitEnv,
  checkGitAllowed,
  createGitRunner,
  GIT_CONFIG,
  GitCommandRefused,
  type GitRequest,
  gitArgv,
  realGitSpawn,
} from "../../src/u4-render-engine/git-runner.js";
import * as gitRunner from "../../src/u4-render-engine/git-runner.js";
import { createRepoFetcher, findGit, guardGitUrl } from "../../src/u4-render-engine/repo-fetcher.js";
import * as repoFetcher from "../../src/u4-render-engine/repo-fetcher.js";
import { createWorkDir } from "../../src/u4-render-engine/work-dir.js";
import { type RunOptions, runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { fakeGit, fakeGitPath, subcommandAt, writeFakeStore } from "../helpers/git-fake.js";
import { app, estate, tempDir } from "../helpers/scan.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const URL = "https://git.acme.dev/ops/vendor";
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const d = tempDir(prefix);
  cleanup.push(d);
  return fs.realpathSync(d);
}
function tree(
  files: Record<string, string> = { "apps/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\n" },
) {
  const d = estate(files);
  cleanup.push(d);
  return d;
}
const entryOf = (cache: string, sha = SHA) => path.join(cache, "repos", "git.acme.dev", "ops", `vendor@${sha}`);
const sub = (args: readonly string[]) => args[subcommandAt(args)];
const inside = (p: string, base: string) => p === base || p.startsWith(`${base}${path.sep}`);

/** A planted cache entry in the shape the first pass trusted: a work tree with `.git/HEAD` naming the sha. */
function plantWorkTree(cache: string): string {
  const entry = entryOf(cache);
  fs.mkdirSync(path.join(entry, ".git"), { recursive: true });
  fs.writeFileSync(path.join(entry, ".git", "HEAD"), `${SHA}\n`);
  fs.mkdirSync(path.join(entry, "k"));
  fs.writeFileSync(
    path.join(entry, "k", "planted.yaml"),
    "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: planted}\n",
  );
  return entry;
}

function fetcher(cache: string, network: boolean, git: ReturnType<typeof fakeGit> | null, trusted = true) {
  const work = createWorkDir(cache, trusted);
  const f = createRepoFetcher({
    work,
    network,
    env: () => undefined,
    git: git === null ? null : "/usr/bin/git",
    ...(git === null ? {} : { spawn: git.spawn }),
  });
  return { f, work };
}

describe("M1: a cached repository is read only through objects git has verified (fake git)", () => {
  it("never reads a planted work tree: offline under --no-network, and refetched online", () => {
    const cache = dir("cache");
    const entry = plantWorkTree(cache);
    const git = fakeGit({ trees: { [URL]: tree() }, sha: SHA });
    const off = fetcher(cache, false, git);
    expect(off.f.fetch(URL, SHA)).toEqual({
      ok: false,
      reason: "offline",
      detail:
        "the cached copy failed verification (git fsck refused its objects) and was discarded; not fetched under --no-network",
    });
    off.work.cleanup();
    expect(fs.existsSync(entry)).toBe(false);
    plantWorkTree(cache);
    const on = fetcher(cache, true, git);
    const r = on.f.fetch(URL, SHA);
    expect(r).toMatchObject({ ok: true, commit: SHA, cached: false, floating: false });
    const scanned = r.ok ? r.dir : "";
    expect(fs.existsSync(path.join(scanned, "apps", "cm.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(scanned, "k", "planted.yaml"))).toBe(false);
    // the entry now holds the fetched object store, not the planted tree
    expect(fs.existsSync(path.join(entry, "k"))).toBe(false);
    expect(fs.readdirSync(path.join(entry, "objects", "pack")).some((n) => n.endsWith(".pack"))).toBe(true);
    on.work.cleanup();
  });
  it("verifies every hit with git and scans files materialised in the run's own directory, never the cache entry", () => {
    const cache = dir("cache");
    const git = fakeGit({ trees: { [URL]: tree() }, sha: SHA });
    const first = fetcher(cache, true, git);
    expect(first.f.fetch(URL, SHA)).toMatchObject({ ok: true, cached: false });
    first.work.cleanup();
    const before = git.calls.length;
    const off = fetcher(cache, false, git);
    const r = off.f.fetch(URL, SHA);
    expect(r).toMatchObject({ ok: true, cached: true, commit: SHA });
    const scanned = r.ok ? r.dir : "";
    expect(inside(scanned, off.work.runDir)).toBe(true);
    expect(inside(scanned, entryOf(cache))).toBe(false);
    expect(git.calls.slice(before).map((c) => sub(c.args))).toEqual(["fsck", "ls-tree", "read-tree", "checkout-index"]);
    // no call of the hit names the cache entry as its repository: only the private copy
    for (const c of git.calls.slice(before)) expect(c.args.join(" ")).not.toContain(entryOf(cache));
    off.work.cleanup();
    expect(fs.existsSync(scanned)).toBe(false);
  });
  it("does not read a cached commit without git (it cannot be verified)", () => {
    const cache = dir("cache");
    const git = fakeGit({ trees: { [URL]: tree() }, sha: SHA });
    fetcher(cache, true, git).f.fetch(URL, SHA);
    expect(fetcher(cache, false, null).f.fetch(URL, SHA)).toEqual({
      ok: false,
      reason: "tool-missing",
      detail: "git not found on PATH (a cached repository is read only after git has verified it)",
    });
  });
  it("discards an entry whose objects fail fsck", () => {
    const cache = dir("cache");
    const entry = entryOf(cache);
    writeFakeStore(entry, SHA, { "a.yaml": Buffer.from("x: 1\n").toString("base64") });
    const pack = fs.readdirSync(path.join(entry, "objects", "pack")).find((n) => n.endsWith(".pack")) as string;
    fs.appendFileSync(path.join(entry, "objects", "pack", pack), " ");
    const git = fakeGit({ trees: {}, sha: SHA });
    expect(fetcher(cache, false, git).f.fetch(URL, SHA)).toMatchObject({ ok: false, reason: "offline" });
    expect(fs.existsSync(entry)).toBe(false);
  });
  it("copies only well-named object files: the entry's config, hooks, alternates and stray files never reach git", () => {
    const cache = dir("cache");
    const entry = entryOf(cache);
    writeFakeStore(entry, SHA, { "a.yaml": Buffer.from("x: 1\n").toString("base64") });
    fs.writeFileSync(path.join(entry, "config"), "[core]\n\thooksPath = /planted\n\tfsmonitor = /planted/fsm\n");
    fs.mkdirSync(path.join(entry, "hooks"));
    fs.writeFileSync(path.join(entry, "hooks", "post-checkout"), "#!/bin/sh\n", { mode: 0o755 });
    fs.mkdirSync(path.join(entry, "objects", "info"));
    fs.writeFileSync(path.join(entry, "objects", "info", "alternates"), "/planted/objects\n");
    fs.writeFileSync(path.join(entry, "objects", "pack", "evil.pack"), "x");
    fs.mkdirSync(path.join(entry, "info"));
    fs.writeFileSync(path.join(entry, "info", "attributes"), "* filter=planted\n");
    // a loose directory with one well-named object and two stray files (pass 3, n4)
    const loose = "ab".padEnd(40, "c").slice(2);
    fs.mkdirSync(path.join(entry, "objects", "ab"));
    fs.writeFileSync(path.join(entry, "objects", "ab", loose), "z");
    fs.writeFileSync(path.join(entry, "objects", "ab", "tmp_obj_planted"), "z");
    fs.writeFileSync(path.join(entry, "objects", "ab", `${loose}x`), "z");
    const git = fakeGit({ trees: {}, sha: SHA });
    // what the private git directory holds while git runs (it is removed once the files are written)
    let seen: { gitDir: string; files: string[]; config: string } | null = null;
    const spawnSeeing: typeof git.spawn = (file, args, opts) => {
      const arg = args.find((a) => a.startsWith("--git-dir="));
      if (seen === null && arg !== undefined) {
        const gitDir = arg.slice("--git-dir=".length);
        const files = (fs.readdirSync(gitDir, { recursive: true }) as string[]).map((n) => n.split(path.sep).join("/"));
        seen = { gitDir, files: files.sort(), config: fs.readFileSync(path.join(gitDir, "config"), "utf8") };
      }
      return git.spawn(file, args, opts);
    };
    const work = createWorkDir(cache, true);
    const f = createRepoFetcher({ work, network: false, env: () => undefined, git: "/g", spawn: spawnSeeing });
    expect(f.fetch(URL, SHA)).toMatchObject({ ok: true, cached: true });
    const got = seen as unknown as { gitDir: string; files: string[]; config: string };
    expect(inside(got.gitDir, work.runDir)).toBe(true);
    expect(got.config).not.toContain("planted");
    const packs = fs
      .readdirSync(path.join(entry, "objects", "pack"))
      .filter((n) => n.startsWith("pack-"))
      .map((n) => `objects/pack/${n}`);
    expect(got.files).toEqual(
      [
        "HEAD",
        "config",
        "objects",
        "objects/ab",
        `objects/ab/${loose}`,
        "objects/pack",
        ...packs,
        "refs",
        "shallow",
      ].sort(),
    );
    // the copy of the objects is removed once the files are written (pass 3, m5)
    expect(fs.existsSync(got.gitDir)).toBe(false);
    work.cleanup();
  });
  it("never follows a symlinked objects or loose directory out of the entry", () => {
    const real = dir("elsewhere");
    writeFakeStore(real, SHA, { "a.yaml": Buffer.from("x: 1\n").toString("base64") });
    for (const linked of ["objects", "objects/pack"]) {
      const cache = dir("cache");
      const entry = entryOf(cache);
      fs.mkdirSync(path.join(entry, "refs"), { recursive: true });
      fs.writeFileSync(path.join(entry, "HEAD"), `${SHA}\n`);
      if (linked === "objects/pack") fs.mkdirSync(path.join(entry, "objects"));
      fs.symlinkSync(path.join(real, linked), path.join(entry, linked));
      const git = fakeGit({ trees: {}, sha: SHA });
      expect(fetcher(cache, false, git).f.fetch(URL, SHA), linked).toMatchObject({ ok: false, reason: "offline" });
    }
  });
  it("never follows a symlink out of the entry: a linked pack is not copied, so the entry fails verification", () => {
    const cache = dir("cache");
    const real = dir("elsewhere");
    writeFakeStore(real, SHA, { "a.yaml": Buffer.from("x: 1\n").toString("base64") });
    const entry = entryOf(cache);
    fs.mkdirSync(path.join(entry, "objects", "pack"), { recursive: true });
    fs.mkdirSync(path.join(entry, "refs"));
    fs.writeFileSync(path.join(entry, "HEAD"), `${SHA}\n`);
    for (const n of fs.readdirSync(path.join(real, "objects", "pack")))
      fs.symlinkSync(path.join(real, "objects", "pack", n), path.join(entry, "objects", "pack", n));
    const git = fakeGit({ trees: {}, sha: SHA });
    expect(fetcher(cache, false, git).f.fetch(URL, SHA)).toMatchObject({ ok: false, reason: "offline" });
  });
  it("fails closed when a verified store would put more on disk than fetchedRepoBytes", () => {
    const cache = dir("cache");
    const git = fakeGit({ trees: { [URL]: tree() }, sha: SHA });
    fetcher(cache, true, git).f.fetch(URL, SHA);
    const work = createWorkDir(cache, true);
    const small = createRepoFetcher({
      work,
      network: false,
      env: () => undefined,
      git: "/usr/bin/git",
      spawn: git.spawn,
      checkoutBytes: 10,
    });
    expect(small.fetch(URL, SHA)).toMatchObject({ ok: false, reason: "limit", detail: /fetchedRepoBytes/ });
    work.cleanup();
  });
});

const realGit = findGit(process.env.PATH ?? "");
describe.skipIf(realGit === null)("M1 with the installed git: verification and materialisation", () => {
  const setupEnv = (home: string) => ({
    PATH: "",
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    LANG: "C",
  });
  function g(args: string[], cwd: string, home: string): string {
    const r = spawnSync(realGit as string, args, { cwd, env: setupEnv(home), encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  }
  /** A repository with these files, one commit, and a shallow bare clone of it as git itself writes one. */
  function store(files: Record<string, string>, format: "sha1" | "sha256" = "sha1") {
    const d = dir("src");
    g(["init", "-q", `--object-format=${format}`, "src"], d, d);
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(d, "src", rel)), { recursive: true });
      fs.writeFileSync(path.join(d, "src", rel), text);
    }
    g(["add", "-A"], path.join(d, "src"), d);
    g(
      ["-c", "user.name=crankpath-test", "-c", "user.email=test@acme.dev", "commit", "-q", "-m", "x"],
      path.join(d, "src"),
      d,
    );
    const sha = g(["rev-parse", "HEAD"], path.join(d, "src"), d);
    g(
      [
        "-c",
        "protocol.file.allow=always",
        "clone",
        "-q",
        "--bare",
        "--depth",
        "1",
        `file://${path.join(d, "src")}`,
        "store.git",
      ],
      d,
      d,
    );
    return { sha, store: path.join(d, "store.git"), home: d };
  }
  function place(cache: string, from: string, sha: string): string {
    const entry = entryOf(cache, sha);
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.cpSync(from, entry, { recursive: true });
    return entry;
  }
  const offline = (cache: string) => {
    const work = createWorkDir(cache, true);
    cleanup.push(work.runDir);
    return { work, f: createRepoFetcher({ work, network: false, env: () => undefined, git: realGit }) };
  };
  const ATTRS = { ".gitattributes": "*.yaml ident eol=crlf\n", "apps/a.yaml": "id: $Id$\nx: 1\n" };

  it("materialises a verified cached commit byte for byte, attributes off (no ident, no eol conversion)", () => {
    for (const format of ["sha1", "sha256"] as const) {
      const s = store(ATTRS, format);
      const cache = dir("cache");
      place(cache, s.store, s.sha);
      const { f, work } = offline(cache);
      const r = f.fetch(URL, s.sha);
      expect(r, format).toMatchObject({ ok: true, cached: true, commit: s.sha, floating: false });
      const scanned = r.ok ? r.dir : "";
      expect(inside(scanned, work.runDir), format).toBe(true);
      expect(fs.readFileSync(path.join(scanned, "apps", "a.yaml"), "utf8"), format).toBe("id: $Id$\nx: 1\n");
      work.cleanup();
    }
  });
  it("control: the same checkout with the repository's attributes applied would change the bytes", () => {
    const s = store(ATTRS);
    const wt = dir("wt");
    g(["--git-dir", s.store, "--work-tree", wt, "read-tree", "HEAD"], wt, s.home);
    g(["--git-dir", s.store, "--work-tree", wt, "checkout-index", "--all", "--force"], wt, s.home);
    expect(fs.readFileSync(path.join(wt, "apps", "a.yaml"), "utf8")).not.toBe("id: $Id$\nx: 1\n");
  });
  it("discards a store whose HEAD names the commit but whose objects are another commit's", () => {
    const a = store({ "a.yaml": "x: 1\n" });
    const b = store({ "a.yaml": "planted: 1\n" });
    const cache = dir("cache");
    const entry = place(cache, b.store, a.sha);
    fs.writeFileSync(path.join(entry, "HEAD"), `${a.sha}\n`);
    expect(offline(cache).f.fetch(URL, a.sha)).toMatchObject({
      ok: false,
      reason: "offline",
      detail: /failed verification/,
    });
    expect(fs.existsSync(entry)).toBe(false);
  });
  it("discards a store with a corrupted pack", () => {
    const s = store({ "a.yaml": "x: 1\n" });
    const cache = dir("cache");
    const entry = place(cache, s.store, s.sha);
    const packDir = path.join(entry, "objects", "pack");
    const pack = path.join(packDir, fs.readdirSync(packDir).find((n) => n.endsWith(".pack")) as string);
    fs.chmodSync(pack, 0o600);
    const bytes = fs.readFileSync(pack);
    bytes[Math.floor(bytes.length / 2)] = (bytes[Math.floor(bytes.length / 2)] as number) ^ 0xff;
    fs.writeFileSync(pack, bytes);
    expect(offline(cache).f.fetch(URL, s.sha)).toMatchObject({ ok: false, reason: "offline" });
    expect(fs.existsSync(entry)).toBe(false);
  });
  it("discards the first pass's planted work tree (a HEAD file and YAML, no objects)", () => {
    const cache = dir("cache");
    plantWorkTree(cache);
    expect(offline(cache).f.fetch(URL, SHA)).toMatchObject({ ok: false, reason: "offline" });
  });
  it("runs no filter, hook or fsmonitor a planted config names, and reads no planted alternates", () => {
    const s = store({ ".gitattributes": "* filter=planted\n", "a.yaml": "x: 1\n" });
    const other = store({ "b.yaml": "planted: 1\n" });
    const cache = dir("cache");
    const entry = place(cache, s.store, s.sha);
    const marker = path.join(dir("marker"), "ran");
    fs.writeFileSync(
      path.join(entry, "config"),
      `[core]\n\tbare = true\n\tfsmonitor = touch ${marker}\n\thooksPath = ${path.dirname(marker)}\n[filter "planted"]\n\tsmudge = touch ${marker}\n\trequired = true\n`,
    );
    fs.mkdirSync(path.join(entry, "objects", "info"), { recursive: true });
    fs.writeFileSync(path.join(entry, "objects", "info", "alternates"), `${path.join(other.store, "objects")}\n`);
    const { f, work } = offline(cache);
    const r = f.fetch(URL, s.sha);
    expect(r).toMatchObject({ ok: true, cached: true });
    expect(fs.readFileSync(path.join(r.ok ? r.dir : "", "a.yaml"), "utf8")).toBe("x: 1\n");
    expect(fs.existsSync(marker)).toBe(false);
    work.cleanup();
  });
});

describe("M2: one run makes at most fetchesPerRun fetches", () => {
  it("is floor(runMemory / fetchedRepoBytes), derived", () => {
    expect(LIMITS.fetchesPerRun).toMatchObject({ status: "derived", unit: "fetches" });
    expect(LIMITS.fetchesPerRun.value).toBe(Math.floor(RUN_LIMITS.runMemory.value / LIMITS.fetchedRepoBytes.value));
    expect(LIMITS.fetchesPerRun.value).toBe(33);
  });
  it("refuses a fetch past the allowance as a counted limit, before any process", () => {
    const git = fakeGit({ trees: { [URL]: tree(), "https://git.acme.dev/ops/two": tree() }, sha: SHA });
    const work = createWorkDir(dir("cache"), true);
    const allowance = repoFetcher.createFetchAllowance(1);
    const f = createRepoFetcher({ work, network: true, env: () => undefined, git: "/g", spawn: git.spawn, allowance });
    expect(f.fetch(URL, SHA).ok).toBe(true);
    const calls = git.calls.length;
    expect(f.fetch("https://git.acme.dev/ops/two", null)).toEqual({
      ok: false,
      reason: "limit",
      detail: "not fetched: the run has made fetchesPerRun (1) fetches",
    });
    expect(git.calls.length).toBe(calls);
    expect(allowance.refused).toBe(1);
    work.cleanup();
  });
  it("stops a scanned repository's repos: entries at fetchesPerRun: the rest are opaque limit, counted", () => {
    const n = LIMITS.fetchesPerRun.value + 2;
    const files: Record<string, string> = {};
    const trees: Record<string, string> = {};
    const vendor = tree();
    let config = "repos:\n";
    for (let i = 1; i <= n; i++) {
      const url = `https://git.acme.dev/ops/v${String(i).padStart(2, "0")}`;
      files[`apps/a${String(i).padStart(2, "0")}.yaml`] = app(`a${String(i).padStart(2, "0")}`, "apps", url);
      config += `  "${url}": {fetch: true}\n`;
      trees[url] = vendor;
    }
    files["crankpath.yaml"] = config;
    const repo = estate(files);
    cleanup.push(repo);
    const git = fakeGit({ trees, sha: SHA });
    const r = runPipeline({
      path: repo,
      cwd: dir("cwd"),
      repoUrl: "https://git.acme.dev/ops/estate",
      gitSpawn: git.spawn,
      toolPath: fakeGitPath(dir("bin")),
    } as RunOptions);
    expect(r.kind).toBe("report");
    if (r.kind !== "report") return;
    expect(git.calls.filter((c) => sub(c.args) === "clone")).toHaveLength(LIMITS.fetchesPerRun.value);
    const limited = r.report.opaque.filter((o) => o.reason === "limit");
    expect(limited).toHaveLength(2);
    for (const o of limited) expect(o.detail).toBe("not fetched: the run has made fetchesPerRun (33) fetches");
    expect(r.report.runStatus.state).toBe("ANALYSED WITH GAPS");
  });
});

// ---------------------------------------------------------------------------------------------
// m1: the helper ends git's whole process group however it ends. The stand-in for git is a small
// Node program that starts a grandchild (same group, a unique marker in its argv) and then does
// what the case needs; after the call, no process with the marker may be left.

let markers = 0;
function standIn(mode: "flood" | "wait"): { file: string; marker: string } {
  const d = dir("standin");
  const marker = `crankpath-standin-${process.pid}-${++markers}-${Date.now()}`;
  const file = path.join(d, "git");
  fs.writeFileSync(
    file,
    [
      `#!${process.execPath}`,
      `const { spawn } = require("node:child_process");`,
      `spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)", ${JSON.stringify(marker)}], { stdio: "ignore" });`,
      mode === "flood" ? `process.stderr.write("x".repeat(${LIMITS.gitOutputBytes.value + 1000}));` : "",
      `process.stdout.write("ready\\n");`,
      `setTimeout(() => {}, 120000);`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { file, marker };
}
function alive(marker: string): string[] {
  const ps = spawnSync("ps", ["-A", "-o", "command"], { encoding: "utf8" }).stdout;
  return ps.split("\n").filter((l) => l.includes(marker) && !l.includes("ps -A"));
}
// The stand-in's descendant lives 120 s unless it is killed, so waiting up to 30 s for it to go tells a
// kill from none on a busy host too (derived from the 120 s, not picked).
async function gone(marker: string): Promise<string[]> {
  const until = Date.now() + 30_000;
  while (alive(marker).length > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  return alive(marker);
}

describe("m1: git's whole group is killed on every way the helper ends", () => {
  it("over the output cap: the call ends at once as over-cap, and no member of the group is left", async () => {
    const s = standIn("flood");
    const d = dir("run");
    const started = Date.now();
    const r = createGitRunner({ git: s.file, home: d, empty: d, guard: () => true, wallClock: 45_000 }).run({
      subcommand: ["fsck", "--strict", "--no-dangling", "--no-progress"],
      args: [],
      cwd: d,
      auth: null,
      repo: { gitDir: d, workTree: null, objectFormat: "sha1" },
    });
    expect(r.outcome).toBe("over-cap");
    // derived: a call the cap did not end would run to its 45 s wall clock
    expect(Date.now() - started).toBeLessThan(45_000);
    expect(await gone(s.marker)).toEqual([]);
  });
  it("over the cap through the spawn port itself (the first pass's ENOBUFS path)", async () => {
    const s = standIn("flood");
    const r = realGitSpawn(s.file, [], { cwd: dir("run"), env: { PATH: "" }, timeout: 60_000, maxBuffer: 1000 });
    expect(r.error?.code).toBe("ENOBUFS");
    expect(await gone(s.marker)).toEqual([]);
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    it(`on ${signal} to the helper: the helper kills the group before it exits`, async () => {
      const s = standIn("wait");
      const helper = spawn(process.execPath, gitRunner.helperArgv(s.file, [], 60_000, 1 << 20), {
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: "" },
      });
      await new Promise<void>((resolve) => helper.stdout?.once("data", () => resolve()));
      expect(alive(s.marker).length).toBeGreaterThan(0);
      const exited = new Promise<number | null>((resolve) => helper.once("close", (code) => resolve(code)));
      helper.kill(signal);
      await exited;
      expect(await gone(s.marker)).toEqual([]);
    });
  }
  it("at the wall clock: the call returns timed-out only once the group is gone (no grace constant)", async () => {
    const s = standIn("wait");
    const r = realGitSpawn(s.file, [], { cwd: dir("run"), env: { PATH: "" }, timeout: 1500, maxBuffer: 1 << 20 });
    expect(r.error?.code).toBe("ETIMEDOUT");
    expect(alive(s.marker)).toEqual([]);
  });
});

describe("m2: each guard the mutation run found untested", () => {
  it("PATH names an empty directory of the run for every git call, never the invoker's PATH", () => {
    const git = fakeGit({ trees: { [URL]: tree() }, sha: SHA });
    const { f, work } = fetcher(dir("cache"), true, git);
    expect(f.fetch(URL, SHA).ok).toBe(true);
    expect(git.calls.length).toBeGreaterThan(1);
    for (const c of git.calls) {
      expect(c.pathEntries).toEqual([]);
      expect(inside(c.env.PATH as string, work.runDir)).toBe(true);
    }
    work.cleanup();
  });
  it("an empty token is no token: no header, no --config-env", () => {
    const git = fakeGit({ trees: { [URL]: tree() }, sha: SHA });
    const work = createWorkDir(dir("cache"), true);
    const f = createRepoFetcher({
      work,
      network: true,
      env: (n) => (n === "CRANKPATH_TOKEN_GIT_ACME_DEV" ? "" : undefined),
      git: "/g",
      spawn: git.spawn,
    });
    expect(f.fetch(URL, SHA).ok).toBe(true);
    for (const c of git.calls) {
      expect(c.env[AUTH_HEADER_VARIABLE]).toBeUndefined();
      expect(c.args).not.toContain("--config-env");
    }
    work.cleanup();
  });
  it("an auth origin must be exactly https://host[:port]/ even when it is a prefix of the URL", () => {
    const req = (origin: string): GitRequest => ({
      subcommand: ["clone"],
      args: ["--", "https://u@git.acme.dev/ops/x", "repo"],
      cwd: "/x",
      auth: { origin, header: "h" },
    });
    expect(() => checkGitAllowed(req("https://u@git.acme.dev/"), () => true)).toThrow(/auth origin form/);
    expect(() =>
      checkGitAllowed(
        { ...req("https://git.acme.dev/ops/"), args: ["--", "https://git.acme.dev/ops/x", "repo"] },
        () => true,
      ),
    ).toThrow(/auth origin form/);
  });
  it("the positional URL's work directory is removed at the end of the run", () => {
    const cwd = dir("cwd");
    const git = fakeGit({ trees: { [URL]: tree() }, sha: SHA });
    const r = runPipeline({
      path: ".",
      cwd,
      url: URL,
      rev: SHA,
      gitSpawn: git.spawn,
      toolPath: fakeGitPath(dir("bin")),
    });
    expect(r.kind).toBe("report");
    expect(fs.readdirSync(path.join(cwd, ".crankpath", "tmp"))).toEqual([]);
  });
  it.skipIf(realGit === null)(
    "transfer.fsckObjects: a malformed object is refused on arrival (control: accepted without it)",
    () => {
      const d = dir("fsck");
      const env = { PATH: "", HOME: d, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", LANG: "C" };
      const g = (args: string[], input?: string) => {
        const r = spawnSync(realGit as string, args, {
          cwd: path.join(d, "src"),
          env,
          encoding: "utf8",
          ...(input === undefined ? {} : { input }),
        });
        if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
        return r.stdout.trim();
      };
      spawnSync(realGit as string, ["init", "-q", "src"], { cwd: d, env });
      const tree = g(["mktree"], "");
      // an author line with no email: fsck's missingEmail error, accepted by hash-object --literally
      const bad = g(
        ["hash-object", "-t", "commit", "-w", "--literally", "--stdin"],
        `tree ${tree}\nauthor nobody 0 +0000\ncommitter nobody 0 +0000\n\nx\n`,
      );
      g(["update-ref", "refs/heads/main", bad]);
      g(["symbolic-ref", "HEAD", "refs/heads/main"]);
      const clone = (target: string, change: (a: string[]) => string[]) => {
        const req: GitRequest = {
          subcommand: ["clone"],
          args: ["--bare", "--quiet", "--", `file://${path.join(d, "src")}`, target],
          cwd: d,
          auth: null,
        };
        const argv = change(
          gitArgv(req).map((x) => (x === "protocol.https.allow=always" ? "protocol.file.allow=always" : x)),
        );
        return spawnSync(realGit as string, argv, { cwd: d, env: buildGitEnv(d, d, null), encoding: "utf8" });
      };
      const ours = clone("one.git", (a) => a);
      expect(ours.status).not.toBe(0);
      expect(ours.stderr).toMatch(/fsck|missingEmail|bad/i);
      const control = clone("two.git", (a) =>
        a.map((x) => (x === "transfer.fsckObjects=true" ? "transfer.fsckObjects=false" : x)),
      );
      expect(control.status, control.stderr).toBe(0);
      expect(GIT_CONFIG.some(([k, v]) => k === "transfer.fsckObjects" && v === "true")).toBe(true);
    },
  );
  it("refuses a repository option the form does not take, and a relative repository path", () => {
    const base: GitRequest = {
      subcommand: ["fsck", "--strict", "--no-dangling", "--no-progress"],
      args: [],
      cwd: "/x",
      auth: null,
    };
    expect(() => checkGitAllowed(base, () => true)).toThrow(GitCommandRefused);
    expect(() =>
      checkGitAllowed({ ...base, repo: { gitDir: "rel/git", workTree: null, objectFormat: "sha1" } }, () => true),
    ).toThrow(/absolute/);
    expect(() =>
      checkGitAllowed({ ...base, repo: { gitDir: "/x/git", workTree: "/x/t", objectFormat: "sha1" } }, () => true),
    ).toThrow(/work tree/);
    expect(() =>
      checkGitAllowed(
        {
          subcommand: ["clone"],
          args: ["--", URL, "repo"],
          cwd: "/x",
          auth: null,
          repo: { gitDir: "/x/g", workTree: null, objectFormat: "sha1" },
        },
        () => true,
      ),
    ).toThrow(GitCommandRefused);
  });
});

describe("nits", () => {
  it("n1: refuses a percent-encoded control character anywhere in the path (CR LF included)", () => {
    for (const p of ["o/r%0d%0a", "o/r%0D%0A", "o/%00r", "o/r%1f", "o/r%7F", "o%0a/r"]) {
      expect(guardGitUrl(`https://git.acme.dev/${p}`), p).toEqual({ ok: false, problem: "path" });
    }
    expect(guardGitUrl("https://git.acme.dev/o/r%20s")).toMatchObject({ ok: true });
  });
  it("n2: normalises a port written with leading zeros before it names a token or an origin", () => {
    expect(guardGitUrl("https://git.acme.dev:0443/o/r")).toMatchObject({
      ok: true,
      url: "https://git.acme.dev/o/r",
      origin: "https://git.acme.dev/",
      port: null,
    });
    expect(guardGitUrl("https://git.acme.dev:08443/o/r")).toMatchObject({
      ok: true,
      url: "https://git.acme.dev:8443/o/r",
      origin: "https://git.acme.dev:8443/",
      port: "8443",
    });
  });
});
