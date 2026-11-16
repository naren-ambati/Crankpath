// Regression tests for the B3 third review pass (reviews/bolt-3-review-pass-3.md). M1: what a
// commit would write is summed and counted from git's listing before anything is written. m1:
// paths that name one file on a case-insensitive or normalising file system are found from the
// listing, not written, and reported as unreadable files on every platform. m2: a verification
// call that did not finish is reported as what it was and leaves a cached store alone. m3: one
// test per guard the pass-3 mutation run found untested (fsck itself, each size and count bound on
// its own, the per-fetch deadline, the shallow boundary, protectNTFS/protectHFS, two helper
// paths). m4: a legacy file mode is not refused. m5: the copy of the objects and an uncached store
// are removed once the files are written. The real-git blocks build object stores with the
// installed git, locally (no network); dummy tokens only.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import {
  buildGitEnv,
  GIT_CONFIG,
  type GitSpawn,
  gitArgv,
  helperArgv,
  realGitSpawn,
} from "../../src/u4-render-engine/git-runner.js";
import { createRepoFetcher, type FetcherConfig, findGit } from "../../src/u4-render-engine/repo-fetcher.js";
import { createWorkDir } from "../../src/u4-render-engine/work-dir.js";
import { runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { fakeGit, fakeGitPath, subcommandAt, writeFakeStore } from "../helpers/git-fake.js";
import { estate, tempDir } from "../helpers/scan.js";

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
const entryOf = (cache: string, sha = SHA) => path.join(cache, "repos", "git.acme.dev", "ops", `vendor@${sha}`);
const sub = (args: readonly string[]) => args[subcommandAt(args)];
const b64 = (t: string | Buffer) => Buffer.from(t).toString("base64");
/** Every file name under a directory (to show nothing was written). */
function filesUnder(d: string): string[] {
  if (!fs.existsSync(d)) return [];
  return (fs.readdirSync(d, { recursive: true }) as string[]).filter((n) => fs.lstatSync(path.join(d, n)).isFile());
}

function offlineFetcher(cache: string, extra: Partial<FetcherConfig> & { spawn?: GitSpawn; git?: string | null }) {
  const work = createWorkDir(cache, true);
  cleanup.push(work.runDir);
  const f = createRepoFetcher({ work, network: false, env: () => undefined, git: "/g", ...extra });
  return { f, work };
}

// ---------------------------------------------------------------------------------------------
// The installed git: object stores built by hand (bare, loose objects), as a planted cache could be

const realGit = findGit(process.env.PATH ?? "");
const genv = (home: string) => ({
  PATH: "",
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  LANG: "C",
  GIT_AUTHOR_NAME: "crankpath-test",
  GIT_AUTHOR_EMAIL: "test@acme.dev",
  GIT_COMMITTER_NAME: "crankpath-test",
  GIT_COMMITTER_EMAIL: "test@acme.dev",
});
function g(cwd: string, args: string[], input?: string | Buffer): string {
  const r = spawnSync(realGit as string, args, { cwd, env: genv(cwd), input, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return String(r.stdout).trim();
}
/** A bare repository to build objects in. */
function bare(): string {
  const d = dir("bare");
  g(d, ["init", "-q", "--bare"]);
  return d;
}
const blob = (repo: string, content: string | Buffer) => g(repo, ["hash-object", "-w", "--stdin"], content);
/** A tree object written as raw bytes (so any name or mode can be held, as a hostile store could). */
function rawTree(repo: string, entries: readonly (readonly [string, string, string])[]): string {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a[1]), Buffer.from(b[1])));
  const body = Buffer.concat(
    sorted.map(([mode, name, oid]) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, "hex")])),
  );
  return g(repo, ["hash-object", "-t", "tree", "-w", "--literally", "--stdin"], body);
}
const commit = (repo: string, tree: string, parent?: string) =>
  g(repo, ["commit-tree", tree, ...(parent === undefined ? [] : ["-p", parent]), "-m", "x"]);
/** Places a store as the cache entry of URL at sha. */
function place(cache: string, repo: string, sha: string): string {
  const entry = entryOf(cache, sha);
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.cpSync(repo, entry, { recursive: true });
  return entry;
}

describe.skipIf(realGit === null)(
  "M1: the size and count of what a commit writes are bounded before it is written",
  () => {
    it("refuses a blob that expands at many paths before checkout-index writes a byte", () => {
      const repo = bare();
      const zero = blob(repo, Buffer.alloc(200_000));
      const sha = commit(
        repo,
        rawTree(
          repo,
          Array.from({ length: 10 }, (_, i) => ["100644", `f${i}.yaml`, zero] as const),
        ),
      );
      const cache = dir("cache");
      place(cache, repo, sha);
      const spawned: string[] = [];
      const spy: GitSpawn = (file, args, opts) => {
        spawned.push(sub(args) as string);
        return realGitSpawn(file, args, opts);
      };
      const { f, work } = offlineFetcher(cache, { git: realGit, spawn: spy, checkoutBytes: 1_000_000 });
      expect(f.fetch(URL, sha)).toEqual({
        ok: false,
        reason: "limit",
        detail: "the fetched repository is larger than the run could read (fetchedRepoBytes)",
      });
      expect(spawned).toEqual(["fsck", "ls-tree"]);
      expect(filesUnder(work.runDir).filter((n) => n.endsWith(".yaml"))).toEqual([]);
    });
    it("refuses more paths than filesPerScan before writing (the store itself is within both bounds)", () => {
      const repo = bare();
      const one = blob(repo, "x: 1\n");
      const sha = commit(
        repo,
        rawTree(
          repo,
          Array.from({ length: 5 }, (_, i) => ["100644", `f${i}.yaml`, one] as const),
        ),
      );
      const cache = dir("cache");
      place(cache, repo, sha);
      const { f, work } = offlineFetcher(cache, { git: realGit, checkoutFiles: 3 });
      expect(f.fetch(URL, sha)).toEqual({
        ok: false,
        reason: "limit",
        detail: "the fetched repository holds more files than a scan lists (filesPerScan)",
      });
      expect(filesUnder(work.runDir).filter((n) => n.endsWith(".yaml"))).toEqual([]);
    });
    it("refuses a listing larger than fetchedRepoBytes on its own (empty files with long names)", () => {
      const repo = bare();
      const empty = blob(repo, "");
      const sha = commit(
        repo,
        rawTree(
          repo,
          Array.from(
            { length: 50 },
            (_, i) => ["100644", `${String(i).padStart(2, "0")}${"n".repeat(60)}.yaml`, empty] as const,
          ),
        ),
      );
      const cache = dir("cache");
      place(cache, repo, sha);
      expect(offlineFetcher(cache, { git: realGit, checkoutBytes: 2000 }).f.fetch(URL, sha)).toEqual({
        ok: false,
        reason: "limit",
        detail: "the fetched repository is larger than the run could read (fetchedRepoBytes): its file list alone",
      });
    });
  },
);

describe.skipIf(realGit === null)("m1: colliding paths are not written, and are reported on every platform", () => {
  it("finds case, normalisation and directory collisions from the listing and writes none of them", () => {
    const repo = bare();
    const a = blob(repo, "kind: A\n");
    const b = blob(repo, "kind: B\n");
    const ok = blob(repo, "kind: Ok\n");
    const docsX = rawTree(repo, [["100644", "x.yaml", a]]);
    const docsY = rawTree(repo, [["100644", "y.yaml", b]]);
    const nfc = "café.yaml";
    const nfd = "café.yaml";
    const sha = commit(
      repo,
      rawTree(repo, [
        ["100644", "App.yaml", a],
        ["100644", "app.yaml", b],
        ["100644", nfc, a],
        ["100644", nfd, b],
        ["40000", "Docs", docsX],
        ["40000", "docs", docsY],
        ["100644", "ok.yaml", ok],
      ]),
    );
    const cache = dir("cache");
    place(cache, repo, sha);
    const r = offlineFetcher(cache, { git: realGit }).f.fetch(URL, sha);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.collisions).toEqual(["App.yaml", "Docs/x.yaml", "app.yaml", nfc, nfd, "docs/y.yaml"].sort());
    expect(fs.readFileSync(path.join(r.dir, "ok.yaml"), "utf8")).toBe("kind: Ok\n");
    const written = filesUnder(r.dir).map((n) => n.normalize("NFC").toLowerCase());
    expect(written).toEqual(["ok.yaml"]);
  });
  it("reports each colliding path as an unreadable file, a counted gap (positional URL, fake git)", () => {
    const tree = estate({ "apps/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\n" });
    cleanup.push(tree);
    const git = fakeGit({ trees: { [URL]: tree }, sha: SHA });
    // the fake lists what its store holds: add the colliding pair to the store it writes
    const spawnPair: GitSpawn = (file, args, opts) => {
      const r = git.spawn(file, args, opts);
      if (sub(args) === "clone") {
        const store = path.join(opts.cwd, "store");
        for (const n of fs.readdirSync(path.join(store, "objects", "pack")))
          fs.rmSync(path.join(store, "objects", "pack", n));
        writeFakeStore(store, SHA, {
          "apps/cm.yaml": b64(fs.readFileSync(path.join(tree, "apps/cm.yaml"))),
          "K/a.yaml": b64("x: 1\n"),
          "k/b.yaml": b64("y: 1\n"),
        });
      }
      return r;
    };
    const r = runPipeline({
      path: ".",
      cwd: dir("cwd"),
      url: URL,
      rev: SHA,
      gitSpawn: spawnPair,
      toolPath: fakeGitPath(dir("bin")),
    });
    expect(r.kind).toBe("report");
    if (r.kind !== "report") return;
    expect(r.report.unreadable.filter((u) => u.outcome === "path-collision").map((u) => u.path)).toEqual([
      "K/a.yaml",
      "k/b.yaml",
    ]);
    expect(r.report.runStatus.counts.unreadableFiles).toBe(2);
    expect(r.report.notVerified).toContainEqual({ item: "unreadable-files", count: 2 });
  });
});

describe("m2: a verification call that did not finish is not a verdict on the store", () => {
  const failing =
    (outcome: "ETIMEDOUT" | "ENOBUFS", on: string, base: ReturnType<typeof fakeGit>): GitSpawn =>
    (file, args, opts) =>
      sub(args) === on
        ? { status: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: { code: outcome } }
        : base.spawn(file, args, opts);
  it("leaves a cached store in place when fsck times out or passes its output cap, and says so", () => {
    for (const code of ["ETIMEDOUT", "ENOBUFS"] as const) {
      const cache = dir("cache");
      const entry = entryOf(cache);
      writeFakeStore(entry, SHA, { "a.yaml": b64("x: 1\n") });
      const git = fakeGit({ trees: {}, sha: SHA });
      const r = offlineFetcher(cache, { spawn: failing(code, "fsck", git) }).f.fetch(URL, SHA);
      expect(r, code).toEqual({
        ok: false,
        reason: "unreadable-repo",
        detail: `the cached copy was not read: verifying: ${
          code === "ETIMEDOUT"
            ? "timed out (repoFetchWallClock); unknown whether the repository exists"
            : "git's output was over the limit (gitOutputBytes)"
        }`,
      });
      expect(fs.existsSync(path.join(entry, "objects", "pack")), code).toBe(true);
    }
  });
  it("names a timeout during a fresh fetch's verification as a timeout, never as failed verification", () => {
    const tree = estate({ "a.yaml": "x: 1\n" });
    cleanup.push(tree);
    const git = fakeGit({ trees: { [URL]: tree }, sha: SHA });
    const work = createWorkDir(dir("cache"), true);
    cleanup.push(work.runDir);
    const f = createRepoFetcher({
      work,
      network: true,
      env: () => undefined,
      git: "/g",
      spawn: failing("ETIMEDOUT", "fsck", git),
    });
    expect(f.fetch(URL, SHA)).toEqual({
      ok: false,
      reason: "unreadable-repo",
      detail:
        "the fetched commit was not read: verifying: timed out (repoFetchWallClock); unknown whether the repository exists",
    });
  });
});

describe("m3: each bound on its own (fake git)", () => {
  it("the copy's byte bound: a store holding more than it writes is refused while copying", () => {
    const cache = dir("cache");
    writeFakeStore(entryOf(cache), SHA, { "a.yaml": b64("x: 1\n") }, SHA, 6000);
    const git = fakeGit({ trees: {}, sha: SHA });
    const spawned: string[] = [];
    const spy: GitSpawn = (file, args, opts) => {
      spawned.push(sub(args) as string);
      return git.spawn(file, args, opts);
    };
    expect(offlineFetcher(cache, { spawn: spy, checkoutBytes: 4000 }).f.fetch(URL, SHA)).toEqual({
      ok: false,
      reason: "limit",
      detail: "the fetched repository is larger than the run could read (fetchedRepoBytes)",
    });
    expect(spawned).toEqual([]);
  });
  it("the copy's file bound: loose objects beyond filesPerScan are refused while copying", () => {
    const cache = dir("cache");
    const entry = entryOf(cache);
    writeFakeStore(entry, SHA, { "a.yaml": b64("x: 1\n") });
    fs.mkdirSync(path.join(entry, "objects", "ab"));
    for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(entry, "objects", "ab", `${i}`.padStart(38, "c")), "z");
    const git = fakeGit({ trees: {}, sha: SHA });
    expect(offlineFetcher(cache, { spawn: git.spawn, checkoutFiles: 3 }).f.fetch(URL, SHA)).toEqual({
      ok: false,
      reason: "limit",
      detail: "the fetched repository holds more files than a scan lists (filesPerScan)",
    });
  });
  it("the bound on what was written stands alone when the listing under-declares (a backstop)", () => {
    const cache = dir("cache");
    writeFakeStore(entryOf(cache), SHA, { "zeros.bin": b64(Buffer.alloc(20_000)) });
    const git = fakeGit({ trees: {}, sha: SHA, listingLies: true });
    expect(offlineFetcher(cache, { spawn: git.spawn, checkoutBytes: 10_000 }).f.fetch(URL, SHA)).toEqual({
      ok: false,
      reason: "limit",
      detail: "the fetched repository is larger than the run could read (fetchedRepoBytes)",
    });
  });
  it("one deadline per fetch: each git call gets what is left, and a call past it never starts", () => {
    const tree = estate({ "a.yaml": "x: 1\n" });
    cleanup.push(tree);
    const git = fakeGit({ trees: { [URL]: tree }, sha: SHA });
    let t = 1_000_000;
    const slow: GitSpawn = (file, args, opts) => {
      const r = git.spawn(file, args, opts);
      t += 40_000;
      return r;
    };
    const work = createWorkDir(dir("cache"), true);
    cleanup.push(work.runDir);
    const f = createRepoFetcher({ work, network: true, env: () => undefined, git: "/g", spawn: slow, now: () => t });
    const r = f.fetch(URL, SHA);
    expect(git.calls.map((c) => [sub(c.args), c.timeout])).toEqual([
      ["clone", LIMITS.repoFetchWallClock.value],
      ["rev-parse", LIMITS.repoFetchWallClock.value - 40_000],
      ["fsck", LIMITS.repoFetchWallClock.value - 80_000],
    ]);
    expect(r).toEqual({
      ok: false,
      reason: "unreadable-repo",
      detail:
        "the fetched commit was not read: listing: timed out (repoFetchWallClock); unknown whether the repository exists",
    });
  });
});

describe.skipIf(realGit === null)(
  "m3: fsck itself, the shallow boundary, protectNTFS and protectHFS (installed git)",
  () => {
    it("refuses a pack whose index names a blob by another blob's hash (only fsck sees it)", () => {
      // the honest commit names `good`; a pack holds the bytes of `evil` under good's name
      const repo = bare();
      const good = blob(repo, "kind: Good\n");
      const sha = commit(repo, rawTree(repo, [["100644", "ok.yaml", good]]));
      fs.rmSync(path.join(repo, "objects", good.slice(0, 2), good.slice(2)));
      const ev = bare();
      const evil = blob(ev, "kind: EVIL\n");
      const pack = spawnSync(realGit as string, ["pack-objects", "--stdout"], {
        cwd: ev,
        env: genv(ev),
        input: `${evil}\n`,
      }).stdout;
      const work = dir("forge");
      fs.writeFileSync(path.join(work, "f.pack"), pack);
      g(work, ["index-pack", "f.pack"]);
      const idx = Buffer.from(fs.readFileSync(path.join(work, "f.idx")));
      // idx v2: 8-byte header, 256 x 4-byte fanout, then the object names
      expect(idx.subarray(1032, 1052).toString("hex")).toBe(evil);
      Buffer.from(good, "hex").copy(idx, 1032);
      const first = Buffer.from(good, "hex")[0] as number;
      for (let i = 0; i < 256; i++) idx.writeUInt32BE(i >= first ? 1 : 0, 8 + 4 * i);
      createHash("sha1")
        .update(idx.subarray(0, idx.length - 20))
        .digest()
        .copy(idx, idx.length - 20);
      const name = pack.subarray(pack.length - 20).toString("hex");
      fs.writeFileSync(path.join(repo, "objects", "pack", `pack-${name}.pack`), pack);
      fs.writeFileSync(path.join(repo, "objects", "pack", `pack-${name}.idx`), idx);
      // control: without fsck, git reads the forged bytes as the commit's file
      expect(g(repo, ["cat-file", "-p", good])).toBe("kind: EVIL");
      const cache = dir("cache");
      const entry = place(cache, repo, sha);
      const { f, work: w } = offlineFetcher(cache, { git: realGit });
      expect(f.fetch(URL, sha)).toMatchObject({ ok: false, reason: "offline", detail: /failed verification/ });
      expect(filesUnder(w.runDir).filter((n) => n.endsWith(".yaml"))).toEqual([]);
      expect(fs.existsSync(entry)).toBe(false);
    });
    it("verifies a depth-1 store of a commit whose parent is not held (the shallow boundary crankpath writes)", () => {
      const repo = bare();
      const t1 = rawTree(repo, [["100644", "a.yaml", blob(repo, "x: 1\n")]]);
      const parent = commit(repo, t1);
      const t2 = rawTree(repo, [["100644", "a.yaml", blob(repo, "x: 2\n")]]);
      const sha = commit(repo, t2, parent);
      fs.rmSync(path.join(repo, "objects", parent.slice(0, 2), parent.slice(2)));
      const cache = dir("cache");
      place(cache, repo, sha);
      const r = offlineFetcher(cache, { git: realGit }).f.fetch(URL, sha);
      expect(r).toMatchObject({ ok: true, cached: true });
      expect(fs.readFileSync(path.join(r.ok ? r.dir : "", "a.yaml"), "utf8")).toBe("x: 2\n");
    });
    it("m4: a legacy group-writable mode (100664) is not refused: fsck --strict only warns on it", () => {
      const repo = bare();
      const sha = commit(repo, rawTree(repo, [["100664", "a.yaml", blob(repo, "x: 1\n")]]));
      const cache = dir("cache");
      place(cache, repo, sha);
      const r = offlineFetcher(cache, { git: realGit }).f.fetch(URL, sha);
      expect(r).toMatchObject({ ok: true, cached: true });
    });
    it("core.protectNTFS and core.protectHFS: the fixed options refuse git~1 and .git with a zero-width joiner at read-tree, over an earlier false", () => {
      for (const name of ["git~1", ".git‌"]) {
        const repo = bare();
        const inner = rawTree(repo, [["100644", "config", blob(repo, "[core]\n")]]);
        const sha = commit(repo, rawTree(repo, [["40000", name, inner]]));
        fs.writeFileSync(path.join(repo, "HEAD"), `${sha}\n`);
        const req = {
          subcommand: ["read-tree", "HEAD"],
          args: [],
          cwd: repo,
          auth: null,
          repo: { gitDir: repo, workTree: null, objectFormat: "sha1" as const },
        };
        const weaker = ["-c", "core.protectNTFS=false", "-c", "core.protectHFS=false"];
        const run = (argv: string[]) =>
          spawnSync(realGit as string, argv, { cwd: repo, env: buildGitEnv(repo, repo, null), encoding: "utf8" });
        const ours = run([...weaker, ...gitArgv(req)]);
        expect(ours.status, name).not.toBe(0);
        expect(ours.stderr, name).toMatch(/invalid path/);
        const control = run([
          ...weaker,
          ...gitArgv(req).filter(
            (a, i, all) =>
              !["core.protectNTFS=true", "core.protectHFS=true"].includes(a) &&
              !(a === "-c" && ["core.protectNTFS=true", "core.protectHFS=true"].includes(all[i + 1] as string)),
          ),
        ]);
        expect(control.status, `${name}: ${control.stderr}`).toBe(0);
      }
      expect(GIT_CONFIG.filter(([k]) => k === "core.protectNTFS" || k === "core.protectHFS")).toHaveLength(2);
    });
  },
);

describe("m5: only the written files stay in the run directory", () => {
  it("removes the copy of the objects and an uncached store once the files are written", () => {
    const tree = estate({ "a.yaml": "x: 1\n" });
    cleanup.push(tree);
    const git = fakeGit({ trees: { [URL]: tree }, sha: SHA });
    for (const trusted of [true, false]) {
      const work = createWorkDir(dir("cache"), trusted);
      cleanup.push(work.runDir);
      const r = createRepoFetcher({ work, network: true, env: () => undefined, git: "/g", spawn: git.spawn }).fetch(
        URL,
        SHA,
      );
      expect(r.ok).toBe(true);
      const fetchDir = path.dirname(path.dirname(r.ok ? r.dir : ""));
      expect(fs.readdirSync(fetchDir).sort(), String(trusted)).toEqual(["empty", "fresh", "home"]);
      expect(fs.readdirSync(path.join(fetchDir, "fresh")), String(trusted)).toEqual(["tree"]);
      work.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// m3: the helper's two untested paths, with a stand-in for git (a marked grandchild in its group)

let markers = 0;
function standIn(mode: "exit" | "chatty"): { file: string; marker: string } {
  const d = dir("standin");
  const marker = `crankpath-standin3-${process.pid}-${++markers}-${Date.now()}`;
  const file = path.join(d, "git");
  const child =
    mode === "exit"
      ? // the grandchild holds git's own output pipes after git exits
        `spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)", ${JSON.stringify(marker)}], { stdio: "inherit" }); process.exit(0);`
      : `spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)", ${JSON.stringify(marker)}], { stdio: "ignore" }); const tick = () => { process.stdout.write("x\\n"); setImmediate(tick); }; tick();`;
  fs.writeFileSync(file, `#!${process.execPath}\nconst { spawn } = require("node:child_process");\n${child}\n`, {
    mode: 0o755,
  });
  return { file, marker };
}
function alive(marker: string): string[] {
  const ps = spawnSync("ps", ["-A", "-o", "command"], { encoding: "utf8" }).stdout;
  return ps.split("\n").filter((l) => l.includes(marker) && !l.includes("ps -A"));
}
async function gone(marker: string): Promise<string[]> {
  for (let i = 0; i < 50 && alive(marker).length > 0; i++) await new Promise((r) => setTimeout(r, 100));
  return alive(marker);
}

describe("m3: the helper kills the group when git exits, and when its caller is gone", () => {
  it("git exits while a descendant still holds its pipes: the call returns at once, and the descendant is killed", async () => {
    const s = standIn("exit");
    const started = Date.now();
    const r = realGitSpawn(s.file, [], { cwd: dir("run"), env: { PATH: "" }, timeout: 20_000, maxBuffer: 1 << 20 });
    expect(r.status).toBe(0);
    expect(r.error).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await gone(s.marker)).toEqual([]);
  });
  it("the helper's standard output closes (its caller is gone): it kills the group and exits", async () => {
    const s = standIn("chatty");
    const helper = spawn(process.execPath, helperArgv(s.file, [], 60_000, 1 << 30), {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "" },
    });
    await new Promise<void>((resolve) => helper.stdout?.once("data", () => resolve()));
    const exited = new Promise<void>((resolve) => helper.once("exit", () => resolve()));
    helper.stdout?.destroy();
    const started = Date.now();
    await exited;
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(await gone(s.marker)).toEqual([]);
  });
});
