// A fake git process for fetch tests (no network, no real git). It keeps an object store in the
// shape crankpath reads (B3 review pass 2, M1): `clone --bare` writes `HEAD` and one "pack",
// `objects/pack/pack-<sha1 of its content>.pack` (deflated JSON: the commit and the tree's files,
// so a file of zeros packs small as in git), with its `.idx`; `fsck` checks every pack's name
// against its content and that HEAD names a commit held; `rev-parse --verify HEAD^{commit}` prints
// that commit; `ls-tree` lists each file's size and path (or, with `listingLies`, size 0);
// `read-tree HEAD` writes the index;
// `checkout-index --all` writes the index's files into `--work-tree`. Every call is recorded with
// its argv, environment and working directory, so tests can check what would reach git, and where
// a token would go.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { GitSpawn, GitSpawnOutput } from "../../src/u4-render-engine/git-runner.js";

export interface GitCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  /** The entries of the directory the call's PATH names, at the time of the call. */
  readonly pathEntries: readonly string[] | null;
  /** The wall clock the call was given. */
  readonly timeout: number;
}

export interface FakeGit {
  readonly spawn: GitSpawn;
  readonly calls: GitCall[];
}

export interface FakeGitOptions {
  /** The tree a clone of each URL produces. */
  readonly trees: Readonly<Record<string, string>>;
  /** The commit every clone holds (whatever revision was asked for). */
  readonly sha: string;
  /** A clone of this URL fails with this standard error (exit 128). */
  readonly fail?: Readonly<Record<string, string>>;
  readonly timeout?: boolean;
  /** `ls-tree` reports every size as 0 (to show the bound on what was written stands alone). */
  readonly listingLies?: boolean;
}

const out = (status: number, stdout = "", stderr = "", code?: string): GitSpawnOutput => ({
  status,
  signal: null,
  stdout: Buffer.from(stdout),
  stderr: Buffer.from(stderr),
  ...(code === undefined ? {} : { error: { code } }),
});

/** The subcommand position: after the fixed `-c` pairs, a `--config-env` pair and the repository options. */
export function subcommandAt(args: readonly string[]): number {
  let i = 0;
  for (;;) {
    if (args[i] === "-c" || args[i] === "--config-env") i += 2;
    else if (/^--(?:git-dir|work-tree|attr-source)=/.test(args[i] ?? "")) i += 1;
    else return i;
  }
}

function option(args: readonly string[], name: string): string | null {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a === undefined ? null : a.slice(name.length + 3);
}

function readFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop() as string;
    for (const name of fs.readdirSync(path.join(root, rel))) {
      const r = rel === "" ? name : `${rel}/${name}`;
      const st = fs.lstatSync(path.join(root, r));
      if (st.isDirectory()) {
        if (name !== ".git") stack.push(r);
      } else if (st.isFile()) files[r] = fs.readFileSync(path.join(root, r)).toString("base64");
    }
  }
  return files;
}

/**
 * Writes a fake object store holding one commit with these files (also used to plant caches);
 * `pad` bytes of noise in the pack that no file uses (a store larger than what it writes).
 */
export function writeFakeStore(
  dir: string,
  commit: string,
  files: Record<string, string>,
  head = commit,
  pad = 0,
): void {
  fs.mkdirSync(path.join(dir, "objects", "pack"), { recursive: true });
  fs.mkdirSync(path.join(dir, "refs", "heads"), { recursive: true });
  // incompressible noise: sha256 blocks of a counter
  const blocks: Buffer[] = [];
  for (let i = 0; i * 32 < pad; i++) blocks.push(createHash("sha256").update(String(i)).digest());
  const noise = Buffer.concat(blocks).subarray(0, pad);
  const content = zlib.deflateSync(JSON.stringify({ commit, files, pad: noise.toString("base64") }));
  const name = `pack-${createHash("sha1").update(content).digest("hex")}`;
  fs.writeFileSync(path.join(dir, "objects", "pack", `${name}.pack`), content);
  fs.writeFileSync(path.join(dir, "objects", "pack", `${name}.idx`), "idx");
  fs.writeFileSync(path.join(dir, "HEAD"), `${head}\n`);
  fs.writeFileSync(path.join(dir, "config"), "[core]\n\tbare = true\n");
}

function packs(gitDir: string): { ok: boolean; commits: string[]; files: Record<string, string> } {
  const dir = path.join(gitDir, "objects", "pack");
  const commits: string[] = [];
  let files: Record<string, string> = {};
  let ok = true;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { ok: false, commits, files };
  }
  for (const name of names.filter((n) => n.endsWith(".pack"))) {
    const content = fs.readFileSync(path.join(dir, name));
    if (name !== `pack-${createHash("sha1").update(content).digest("hex")}.pack`) {
      ok = false;
      continue;
    }
    try {
      const p = JSON.parse(zlib.inflateSync(content).toString("utf8")) as {
        commit: string;
        files: Record<string, string>;
      };
      commits.push(p.commit);
      files = p.files;
    } catch {
      ok = false;
    }
  }
  return { ok, commits, files };
}

function head(gitDir: string): string | null {
  try {
    const t = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const ref = /^ref: (refs\/heads\/.+)$/.exec(t)?.[1];
    return ref === undefined ? t : fs.readFileSync(path.join(gitDir, ref), "utf8").trim();
  } catch {
    return null;
  }
}

export function fakeGit(options: FakeGitOptions): FakeGit {
  const calls: GitCall[] = [];
  const spawn: GitSpawn = (file, args, opts) => {
    let pathEntries: string[] | null = null;
    try {
      pathEntries = fs.readdirSync(opts.env.PATH ?? "");
    } catch {
      pathEntries = null;
    }
    calls.push({ file, args: [...args], env: { ...opts.env }, cwd: opts.cwd, pathEntries, timeout: opts.timeout });
    if (options.timeout === true) return out(1, "", "", "ETIMEDOUT");
    const at = subcommandAt(args);
    const sub = args[at];
    const gitDir = option(args, "git-dir");
    if (sub === "clone") {
      const dash = args.indexOf("--", at);
      const url = args[dash + 1] as string;
      const dir = args[dash + 2] as string;
      const failure = options.fail?.[url];
      if (failure !== undefined) return out(128, "", failure);
      const tree = options.trees[url];
      if (tree === undefined) return out(128, "", "fatal: repository not found");
      if (!args.includes("--bare")) return out(129, "", "the fake clones bare only");
      const target = path.join(opts.cwd, dir);
      // as git leaves it: detached for --revision, a branch HEAD otherwise
      const branch = args.includes("--branch") ? (args[args.indexOf("--branch") + 1] as string) : "main";
      writeFakeStore(target, options.sha, readFiles(tree), args.includes("--revision") ? options.sha : "");
      if (!args.includes("--revision")) {
        fs.writeFileSync(path.join(target, "HEAD"), `ref: refs/heads/${branch}\n`);
        fs.mkdirSync(path.dirname(path.join(target, "refs", "heads", branch)), { recursive: true });
        fs.writeFileSync(path.join(target, "refs", "heads", branch), `${options.sha}\n`);
      }
      return out(0);
    }
    if (gitDir === null) return out(128, "", "fatal: not a git repository");
    const store = packs(gitDir);
    const commit = head(gitDir);
    const held = commit !== null && store.commits.includes(commit);
    if (sub === "fsck") {
      if (!store.ok) return out(1, "", "error: pack checksum mismatch");
      return held ? out(0) : out(2, "", "error: HEAD: invalid sha1 pointer");
    }
    if (sub === "rev-parse") return held ? out(0, `${commit}\n`) : out(128, "", "fatal: Needed a single revision");
    if (sub === "ls-tree") {
      if (!held) return out(128, "", "fatal: Not a valid object name HEAD");
      const listing = Object.entries(store.files)
        .map(
          ([rel, b64]) =>
            `100644 blob ${"0".repeat(40)} ${String(options.listingLies === true ? 0 : Buffer.from(b64, "base64").length).padStart(7)}\t${rel}\0`,
        )
        .join("");
      return out(0, listing);
    }
    if (sub === "read-tree") {
      if (!held) return out(128, "", "fatal: Not a valid object name HEAD");
      fs.writeFileSync(path.join(gitDir, "index"), JSON.stringify(store.files));
      return out(0);
    }
    if (sub === "checkout-index") {
      const workTree = option(args, "work-tree");
      if (workTree === null) return out(128, "", "fatal: this operation must be run in a work tree");
      const files = JSON.parse(fs.readFileSync(path.join(gitDir, "index"), "utf8")) as Record<string, string>;
      for (const [rel, b64] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(workTree, rel)), { recursive: true });
        fs.writeFileSync(path.join(workTree, rel), Buffer.from(b64, "base64"));
      }
      return out(0);
    }
    return out(1, "", "unexpected");
  };
  return { spawn, calls };
}

/** A directory holding an executable named `git` (never run: the fake spawn answers). */
export function fakeGitPath(dir: string): string {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "git"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  return bin;
}

/** Every file under a directory, read as text (to prove a string is in none of them). */
export function allText(dir: string): string {
  let text = "";
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop() as string;
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (st.isFile()) text += `${name}\n${fs.readFileSync(p, "latin1")}\n`;
      else text += `${name}\n`;
    }
  }
  return text;
}
