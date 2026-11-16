// A git repository built for the Action's tests: a base commit from fixture layers, then a head
// commit on top of it after a mutation of the working tree (or of the index, for raw trees), and the
// Action run in-process over it with the GitHub variables pointed at temporary files.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ActionIo, type ActionRun, runAction } from "../../action/action-entry.mjs";

const FIXTURES = fileURLToPath(new URL("../fixtures/action/", import.meta.url));

function copyLayer(from: string, to: string): void {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyLayer(s, d);
    } else if (e.isFile()) fs.writeFileSync(d, fs.readFileSync(s));
  }
}

export interface TestRepo {
  readonly tmp: string;
  readonly dir: string;
  readonly base: string;
  git(args: string[], input?: string | Buffer): string;
  /** Mutates the working tree, commits everything as the head, and returns its id. */
  commitHead(mutate: (dir: string) => void): string;
  /** A tree object written raw (`hash-object -t tree --literally`), for names git would refuse. */
  rawTree(entries: { mode: string; name: string; oid: string }[]): string;
  cleanup(): void;
}

export function makeRepo(layers: string[], mutateBase?: (dir: string) => void): TestRepo {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-action-repo-"));
  const dir = path.join(tmp, "repo");
  fs.mkdirSync(dir);
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: tmp,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.org",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.org",
    GIT_AUTHOR_DATE: "2026-11-16T00:00:00+0000",
    GIT_COMMITTER_DATE: "2026-11-16T00:00:00+0000",
  };
  const git = (args: string[], input?: string | Buffer) => {
    const r = spawnSync("git", args, { cwd: dir, env, input, maxBuffer: 1 << 30 });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
    return r.stdout.toString().trim();
  };
  git(["-c", "init.defaultBranch=main", "init", "-q"]);
  for (const l of layers) copyLayer(path.join(FIXTURES, l), dir);
  mutateBase?.(dir);
  git(["add", "-A"]);
  git(["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "base"]);
  const base = git(["rev-parse", "HEAD"]);
  return {
    tmp,
    dir,
    base,
    git,
    commitHead(mutate) {
      mutate(dir);
      git(["add", "-A"]);
      git(["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "head"]);
      return git(["rev-parse", "HEAD"]);
    },
    rawTree(entries) {
      const buf = Buffer.concat(
        entries.map((e) => Buffer.concat([Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.oid, "hex")])),
      );
      return git(["hash-object", "-t", "tree", "-w", "--literally", "--stdin"], buf);
    },
    cleanup() {
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/** Runs the Action in-process over a TestRepo; returns what it wrote. */
export function runOn(
  repo: TestRepo,
  inputs: Record<string, string | undefined> = {},
  extra: Partial<ActionIo> = {},
): ActionRun & { output: string; summaryFile: string; lines: string[] } {
  const runner = fs.mkdtempSync(path.join(repo.tmp, "runner-"));
  const summary = path.join(runner, "..", `summary-${path.basename(runner)}.md`);
  const output = path.join(runner, "..", `output-${path.basename(runner)}`);
  fs.writeFileSync(summary, "");
  fs.writeFileSync(output, "");
  const lines: string[] = [];
  const run = runAction({
    env: {
      PATH: process.env.PATH,
      HOME: repo.tmp,
      GITHUB_WORKSPACE: repo.dir,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: runner,
      GITHUB_SERVER_URL: "http://gitea-http.gitea:3000",
      GITHUB_REPOSITORY: "ops/estate",
      INPUT_BASE_REF: repo.base,
      ...inputs,
    },
    cwd: repo.dir,
    stdout: (l) => lines.push(l),
    ...extra,
  });
  return { ...run, output: fs.readFileSync(output, "utf8"), summaryFile: fs.readFileSync(summary, "utf8"), lines };
}

/** The lines inside the summary's text fence. */
export function fenced(md: string): string[] {
  const l = md.split("\n");
  return l.slice(l.indexOf("```text") + 1, l.lastIndexOf("```"));
}
