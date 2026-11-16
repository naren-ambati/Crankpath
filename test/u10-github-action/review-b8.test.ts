// Regression tests for the B8 review (reviews/bolt-8-review.md): each was written before its fix
// and seen red on 1f55063. M1 a head that reads less than the base is NOT CHECKED; m1 base equal to
// head; m2 the trees are copied raw (no filter or attribute runs); m3 submodules are a counted gap;
// m4 a cranked head cycle says whether its edges are new; m5 the CLI's standard output never reaches
// the runner and every git call carries the fixed options; m6 the base is the merge base; n1 the
// runner's files missing is NOT CHECKED.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CLI_PATH, copyCommitTree, GIT_OPTIONS, runAction } from "../../action/action-entry.mjs";
import { diffReports, type RunSummary } from "../../action/base-head-differ.mjs";
import { renderSummary } from "../../action/summary.mjs";
import { buildCase, FAKE_WORKFLOW_TOKEN, fakeToolsDir } from "../../scripts/action-local.mjs";
import { RING_REPORT, read, report } from "../helpers/action-reports.js";

const temps: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-review-b8-"));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const CTX = {
  crankpathVersion: "0.1.0",
  baseCommit: "a".repeat(40),
  headCommit: "b".repeat(40),
  pathPrefix: "",
  baseRef: "main",
};
const fenced = (md: string) => {
  const l = md.split("\n");
  return l.slice(l.indexOf("```text") + 1, l.lastIndexOf("```"));
};

// M1's first fix compared gap counts; the second review's m1 replaced it by item-by-item matching
// (review-b8-pass2.test.ts holds those tests). What stays from M1 here: fewer gaps compare, and a
// submodule is a gap of its own (m3).
describe("M1: a head with gaps the base did not have is NOT CHECKED", () => {
  it("fewer gaps in the head are compared as before", () => {
    const u = {
      candidates: [],
      candidatesTruncated: false,
      field: null,
      owner: null,
      subject: "Service/a/b",
      value: null,
      where: "w",
      why: "not-defined",
    };
    const base = report({ unresolved: [u] }, { unresolved: 1 }, { state: "ANALYSED WITH GAPS" });
    expect(diffReports(read(base), read(RING_REPORT())).result).toBe("FAILED");
  });
  it("a submodule only the head has is a new gap (m3)", () => {
    const head = { ...read(report()), submodules: ["apps/sub"] };
    head.run = { ...head.run, submodules: 1 };
    const d = diffReports(read(report()), head);
    expect(d.result).toBe("NOT_CHECKED");
    expect(d.newGaps).toEqual([{ kind: "submodule", path: "apps/sub" }]);
  });
});

describe("m4: a cranked head cycle says whether its edges are new", () => {
  const crank = {
    alreadyCreated: 0,
    by: "apply by hand",
    createdNodes: ["Service/gitea/gitea-http"],
    id: "crank:1",
    keyPath: "cranks[0]",
    matched: true,
    ref: null,
    removedEdges: 2,
    reroutedEdges: [],
  };
  const cranked = RING_REPORT("cranked", { crankedBy: ["crank:1"] }, { cranks: [crank] });
  it("a crank this pull request adds over edges this pull request adds", () => {
    const d = diffReports(read(report()), read(cranked));
    expect(d.crankedInHead.map((c) => [c.cycle.id, c.newEdges, c.addedByPr])).toEqual([["c-ring", 3, true]]);
    expect(fenced(renderSummary(d, CTX))).toContain(
      "  cycle c-ring  label: cranked  edges: 3   (cranked by a crank this pull request adds; 3 of its edges are new in this pull request)",
    );
  });
  it("a crank the base already had over edges the base already had", () => {
    const d = diffReports(read(cranked), read(cranked));
    expect(d.crankedInHead.map((c) => [c.newEdges, c.addedByPr])).toEqual([[0, false]]);
    expect(fenced(renderSummary(d, CTX))).toContain(
      "  cycle c-ring  label: cranked  edges: 3   (cranked by a crank the base already had; 0 of its edges are new in this pull request)",
    );
  });
});

describe("m1, m6, n1 in the summary", () => {
  it("states that the base is the merge base of base-ref and the head", () => {
    const d = diffReports(read(RING_REPORT()), read(RING_REPORT()));
    expect(renderSummary(d, CTX).split("\n")[2]).toBe(
      'crankpath 0.1.0; base commit aaaaaaaaaaaa (the merge base of base-ref "main" and the head); head commit bbbbbbbbbbbb.',
    );
  });
});

/** The checkout and the commits of a harness case, with the Action run in-process. */
function act(
  name: string,
  inputs: Record<string, string | undefined> = {},
  setup?: (checkout: string, home: string) => void,
) {
  const t = tmp();
  const built = buildCase(name, t);
  setup?.(built.checkout, built.home);
  const runner = path.join(t, "runner");
  fs.mkdirSync(runner);
  const summary = path.join(t, "summary.md");
  const output = path.join(t, "output");
  fs.writeFileSync(summary, "");
  fs.writeFileSync(output, "");
  const lines: string[] = [];
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: built.home,
    GITHUB_WORKSPACE: built.checkout,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_OUTPUT: output,
    RUNNER_TEMP: runner,
    GITHUB_SERVER_URL: "http://gitea-http.gitea:3000",
    GITHUB_REPOSITORY: "ops/estate",
    GITHUB_TOKEN: FAKE_WORKFLOW_TOKEN,
    INPUT_BASE_REF: built.baseCommit,
    ...inputs,
  };
  const run = runAction({ env, cwd: built.checkout, stdout: (l) => lines.push(l) });
  const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
  return { run, lines, built, summary: read(summary), output: read(output), t };
}

const git = (cwd: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.org",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.org",
      ...env,
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

describe("m1: a base that resolves to the head commit is NOT CHECKED", () => {
  it("base-ref HEAD", () => {
    const r = act("unrelated-change", { INPUT_BASE_REF: "HEAD" });
    expect(r.output).toBe("result=NOT_CHECKED\nnew-cycles=\n");
    expect(fenced(r.summary)[0]).toBe(
      "NOT CHECKED: the base commit is the head commit, so there is nothing to compare. This job is not green.",
    );
  });
});

describe("m2: each commit is copied raw, with no filter or attribute processing", () => {
  it("a filter driver in the runner's git configuration never runs, whatever the head's attributes say", () => {
    const marker = path.join(tmp(), "ran");
    const r = act("unrelated-change", {}, (checkout, home) => {
      fs.writeFileSync(
        path.join(home, ".gitconfig"),
        `[filter "evil"]\n\tsmudge = sh -c "echo ran >> ${marker}; cat"\n`,
      );
      fs.writeFileSync(path.join(checkout, ".gitattributes"), "*.yaml filter=evil\n*.yaml eol=crlf\n");
      git(checkout, ["add", ".gitattributes"]);
      git(checkout, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "attrs"]);
    });
    expect(fs.existsSync(marker)).toBe(false);
    expect(r.output).toBe("result=NO_NEW_CYCLES_FOUND\nnew-cycles=0\n");
  });
  it("copies blobs byte for byte, keeps the executable bit and symbolic links, and counts submodules", () => {
    const t = tmp();
    const repo = path.join(t, "r");
    fs.mkdirSync(repo);
    git(repo, ["-c", "init.defaultBranch=main", "init", "-q"]);
    fs.writeFileSync(path.join(repo, ".gitattributes"), "*.txt eol=crlf\n* export-ignore\n");
    fs.mkdirSync(path.join(repo, "d"));
    fs.writeFileSync(path.join(repo, "d", "a.txt"), "one\ntwo\n");
    fs.writeFileSync(path.join(repo, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
    fs.symlinkSync("d/a.txt", path.join(repo, "link"));
    git(repo, ["add", "-A"]);
    git(repo, ["update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},sub`]);
    git(repo, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "c"]);
    const commit = git(repo, ["rev-parse", "HEAD"]);
    const dest = path.join(t, "copy");
    const out = copyCommitTree(repo, commit, dest, { PATH: process.env.PATH, HOME: t });
    expect(out).toEqual({ ok: true, submodules: ["sub"] });
    expect(fs.readFileSync(path.join(dest, "d", "a.txt"), "utf8")).toBe("one\ntwo\n");
    expect(fs.statSync(path.join(dest, "run.sh")).mode & 0o777).toBe(0o755);
    expect(fs.statSync(path.join(dest, "d", "a.txt")).mode & 0o777).toBe(0o644);
    expect(fs.readlinkSync(path.join(dest, "link"))).toBe("d/a.txt");
    expect(fs.statSync(path.join(dest, "sub")).isDirectory()).toBe(true);
    expect(fs.readdirSync(path.join(dest, "sub"))).toEqual([]);
    expect(fs.readdirSync(dest).sort()).toEqual([".gitattributes", "d", "link", "run.sh", "sub"]);
  });
  it("a tree whose paths collide (one name a link, the other a directory under it) is not copied through the link", () => {
    const t = tmp();
    const repo = path.join(t, "r");
    fs.mkdirSync(repo);
    git(repo, ["-c", "init.defaultBranch=main", "init", "-q"]);
    const outside = path.join(t, "outside");
    fs.mkdirSync(outside);
    // `a` is a link to a directory outside; `a/b` can only exist in a crafted index
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: repo,
      input: "x\n",
      encoding: "utf8",
    }).stdout.trim();
    const target = spawnSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: repo,
      input: outside,
      encoding: "utf8",
    }).stdout.trim();
    const tree = spawnSync("git", ["mktree", "--missing"], {
      cwd: repo,
      input: `120000 blob ${target}\tA\n040000 tree ${spawnSync("git", ["mktree"], { cwd: repo, input: `100644 blob ${blob}\tb\n`, encoding: "utf8" }).stdout.trim()}\ta\n`,
      encoding: "utf8",
    }).stdout.trim();
    const commit = spawnSync("git", ["commit-tree", tree, "-m", "c"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: t,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.org",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.org",
      },
    }).stdout.trim();
    const dest = path.join(t, "copy");
    copyCommitTree(repo, commit, dest, { PATH: process.env.PATH, HOME: t });
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe("m2: the copy never overwrites and sets modes itself", () => {
  /** A one-commit repository whose tree is given in `git mktree` lines (blob contents inline). */
  function repoWith(entries: [string, string, string][]) {
    const t = tmp();
    const repo = path.join(t, "r");
    fs.mkdirSync(repo);
    git(repo, ["-c", "init.defaultBranch=main", "init", "-q"]);
    const lines = entries.map(([mode, content, name]) => {
      const oid = spawnSync("git", ["hash-object", "-w", "--stdin"], {
        cwd: repo,
        input: content,
        encoding: "utf8",
      }).stdout.trim();
      return `${mode} blob ${oid}\t${name}\n`;
    });
    const tree = spawnSync("git", ["mktree"], { cwd: repo, input: lines.join(""), encoding: "utf8" }).stdout.trim();
    const commit = git(repo, ["commit-tree", tree, "-m", "c"]);
    return { t, repo, commit };
  }
  it("two names that one file system folds together stop the copy there, never one overwriting the other", () => {
    const { t, repo, commit } = repoWith([
      ["100644", "first\n", "A.yaml"],
      ["100644", "second\n", "a.yaml"],
    ]);
    const probe = path.join(t, "Case-Probe");
    fs.writeFileSync(probe, "");
    const foldsCase = fs.existsSync(path.join(t, "case-probe"));
    const out = copyCommitTree(repo, commit, path.join(t, "copy"), { PATH: process.env.PATH, HOME: t });
    if (foldsCase) expect(out).toEqual({ ok: false, why: "unsafe" });
    else {
      expect(out).toEqual({ ok: true, submodules: 0 });
      expect(fs.readFileSync(path.join(t, "copy", "a.yaml"), "utf8")).toBe("second\n");
    }
  });
  it("file modes do not depend on the process umask", () => {
    const { t, repo, commit } = repoWith([
      ["100644", "x\n", "plain.yaml"],
      ["100755", "#!/bin/sh\n", "run.sh"],
    ]);
    const old = process.umask(0o077);
    try {
      copyCommitTree(repo, commit, path.join(t, "copy"), { PATH: process.env.PATH, HOME: t });
    } finally {
      process.umask(old);
    }
    expect(fs.statSync(path.join(t, "copy", "plain.yaml")).mode & 0o777).toBe(0o644);
    expect(fs.statSync(path.join(t, "copy", "run.sh")).mode & 0o777).toBe(0o755);
  });
});

describe("m3: a submodule is a counted gap of its side", () => {
  it("a submodule only the head has is a new gap: NOT CHECKED", () => {
    const r = act("unrelated-change", {}, (checkout) => {
      git(checkout, ["update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},apps/sub`]);
      git(checkout, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "sub"]);
    });
    expect(fenced(r.summary)[0]).toBe(
      "NOT CHECKED: the head has 1 gap the base did not have, so what they hide could not be compared (listed below). This job is not green.",
    );
  });
});

describe("m5: what reaches the runner", () => {
  it("the CLI's standard output never reaches the Action's: no workflow command from it", () => {
    const dir = tmp();
    const probe = path.join(dir, "probe.mjs");
    const thin = fs.readFileSync(new URL("../fixtures/thin-slice/expected.json", import.meta.url), "utf8");
    fs.writeFileSync(path.join(dir, "report.json"), thin);
    fs.writeFileSync(
      probe,
      `import fs from "node:fs";\nprocess.stdout.write("::error::from the CLI\\n");\nfs.copyFileSync(${JSON.stringify(path.join(dir, "report.json"))}, process.argv[process.argv.indexOf("--out") + 1]);\n`,
    );
    const entry = path.join(path.dirname(CLI_PATH), "..", "..", "action", "action-entry.mjs");
    const script = `import(${JSON.stringify(entry)}).then((m) => { const r = m.runCli({ cliPath: ${JSON.stringify(probe)}, scanDir: ${JSON.stringify(dir)}, cwd: ${JSON.stringify(dir)}, jsonFile: ${JSON.stringify(path.join(dir, "o.json"))}, args: [], env: { PATH: process.env.PATH } }); process.stderr.write(r.kind); });`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(r.stderr).toBe("report");
    expect(r.stdout).toBe("");
  });
  it("every git call carries the fixed options and is one of the read-only subcommands", () => {
    const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    const bin = tmp();
    const log = path.join(bin, "calls.log");
    fs.writeFileSync(
      path.join(bin, "git"),
      `#!/bin/sh\nprintf '%s\\0' "$@" >> ${JSON.stringify(log)}\nprintf '\\n' >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realGit)} "$@"\n`,
      { mode: 0o755 },
    );
    const r = act("add-cycle", { PATH: `${bin}:${process.env.PATH}` });
    expect(r.output).toBe("result=FAILED\nnew-cycles=1\n");
    const calls = fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => l.split("\0").filter((a) => a !== ""));
    expect(calls.length).toBeGreaterThan(4);
    for (const c of calls) {
      expect(c.slice(0, GIT_OPTIONS.length)).toEqual(GIT_OPTIONS);
      expect(["rev-parse", "merge-base", "ls-tree", "cat-file"]).toContain(c[GIT_OPTIONS.length]);
    }
    expect(GIT_OPTIONS).toEqual([
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "protocol.allow=never",
    ]);
  });
});

describe("m6: the base is the merge base of base-ref and the head", () => {
  it("a crank the base branch added after the fork is not read as one this pull request removed", () => {
    // base-ref names the base branch tip, which moved on from the fork point and added a crank the
    // head (the pull request) never saw; the comparison is with the fork point
    const again = act("unrelated-change", { INPUT_BASE_REF: "base-branch" }, (checkout) => {
      const head = git(checkout, ["rev-parse", "HEAD"]);
      const fork = git(checkout, ["rev-parse", "HEAD^"]);
      git(checkout, ["checkout", "-q", "-b", "base-branch", fork]);
      fs.writeFileSync(
        path.join(checkout, "crankpath.yaml"),
        fs.readFileSync(new URL("../fixtures/action/add-crank/head/crankpath.yaml", import.meta.url)),
      );
      git(checkout, ["add", "crankpath.yaml"]);
      git(checkout, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "base moves on"]);
      git(checkout, ["checkout", "-q", "--detach", head]);
    });
    expect(again.output).toBe("result=NO_NEW_CYCLES_FOUND\nnew-cycles=0\n");
    expect(again.summary).toContain('(the merge base of base-ref "base-branch" and the head)');
  });
  it("no merge base (unrelated histories) is NOT CHECKED", () => {
    const r = act("unrelated-change", { INPUT_BASE_REF: "orphan" }, (checkout) => {
      const head = git(checkout, ["rev-parse", "HEAD"]);
      git(checkout, ["checkout", "-q", "--orphan", "orphan"]);
      git(checkout, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "orphan"]);
      git(checkout, ["checkout", "-q", "--detach", head]);
    });
    expect(fenced(r.summary)[0]).toBe(
      'NOT CHECKED: base-ref "orphan" and the head share no history (no merge base). This job is not green.',
    );
  });
});

describe("n1: the runner's summary or output file missing is NOT CHECKED", () => {
  for (const missing of ["GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT"]) {
    it(`${missing} unset`, () => {
      const r = act("unrelated-change", { [missing]: undefined });
      expect(r.run.exit).toBe(1);
      expect(r.lines[0]).toBe(
        `::error title=crankpath NOT CHECKED::NOT CHECKED: the runner gave no ${missing} file, so the result cannot be written where the runner reads it. This job is not green.`,
      );
    });
  }
});

describe("the RunSummary the Action reads", () => {
  it("carries the gap counts it compares", () => {
    const r: RunSummary = read(report({}, { runLimitEdges: 4, declaredFacts: 2 })).run;
    expect([r.runLimitEdges, r.declaredFacts, r.submodules]).toEqual([4, 2, 0]);
  });
});

describe("after the B2 merge: real render outcomes through the Action", () => {
  /** A runAction over a harness case, with the runner's PATH and the CLI given. */
  function actWith(name: string, opts: { path: string; cliPath?: string; setup?: (checkout: string) => void }) {
    const t = tmp();
    const built = buildCase(name, t);
    opts.setup?.(built.checkout);
    const runner = path.join(t, "runner");
    fs.mkdirSync(runner);
    const summary = path.join(t, "summary.md");
    const output = path.join(t, "output");
    fs.writeFileSync(summary, "");
    fs.writeFileSync(output, "");
    const lines: string[] = [];
    const run = runAction({
      env: {
        PATH: opts.path,
        HOME: built.home,
        GITHUB_WORKSPACE: built.checkout,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: runner,
        GITHUB_SERVER_URL: "http://gitea-http.gitea:3000",
        GITHUB_REPOSITORY: "ops/estate",
        INPUT_BASE_REF: built.baseCommit,
      },
      cwd: built.checkout,
      stdout: (l) => lines.push(l),
      ...(opts.cliPath === undefined ? {} : { cliPath: opts.cliPath }),
    });
    return { run, lines, summary: fs.readFileSync(summary, "utf8"), output: fs.readFileSync(output, "utf8"), t };
  }
  const NODE_DIR = path.dirname(process.execPath);
  it("the head's Helm source renders with the tools on PATH, and the cycle it renders is new", () => {
    const r = actWith("add-helm-chart", {
      path: [fakeToolsDir(tmp()), NODE_DIR, "/usr/bin", "/bin"].join(path.delimiter),
    });
    expect(r.output).toBe("result=FAILED\nnew-cycles=1\n");
    expect(fenced(r.summary)).toContain(
      '    Issuer "web/ca" needs Secret "web/ca-key"  [file: "render:Application/argocd/ca\\x230"]',
    );
  });
  it("without helm the head's chart is opaque, a gap the base did not have: NOT CHECKED", () => {
    const r = actWith("add-helm-chart", { path: [NODE_DIR, "/usr/bin", "/bin"].join(path.delimiter) });
    expect(fenced(r.summary)[0]).toMatch(
      /^NOT CHECKED: the head has \d+ gaps? the base did not have, so what they hide could not be compared \(listed below\)\. This job is not green\.$/,
    );
    expect(fenced(r.summary)).toContain(
      '  new in the head: opaque source Application "argocd/ca"  reason: tool-missing',
    );
  });
  it("a render stopped by crankpath's time limit is NOT CHECKED (OD-30), through the real pipeline", () => {
    const t = tmp();
    // the CLI as built, with only the render wall clock shortened (the derived 90 s would make the test slow)
    const cli = path.join(t, "short-clock-cli.mjs");
    const dist = path.join(path.dirname(CLI_PATH), "..");
    fs.writeFileSync(
      cli,
      [
        `import { main } from ${JSON.stringify(path.join(dist, "u9-cli-package", "cli-shell.js"))};`,
        `import { runPipeline } from ${JSON.stringify(path.join(dist, "u9-cli-package", "pipeline-runner.js"))};`,
        `import { RUNNER_LIMITS } from ${JSON.stringify(path.join(dist, "u4-render-engine", "command-runner.js"))};`,
        "const wallClock = { ...RUNNER_LIMITS.wallClock, value: 1500 };",
        'process.exitCode = main(process.argv.slice(2), { stdout: (x) => process.stdout.write(x), stderr: (x) => process.stderr.write(x), cwd: process.cwd(), toolPath: process.env.PATH ?? "", run: (o) => runPipeline({ ...o, runnerLimits: { ...RUNNER_LIMITS, wallClock } }) });',
      ].join("\n"),
    );
    const r = actWith("add-helm-chart", {
      path: [fakeToolsDir(tmp()), NODE_DIR, "/usr/bin", "/bin"].join(path.delimiter),
      cliPath: cli,
      setup: (checkout) => {
        fs.writeFileSync(path.join(checkout, "charts", "ca", "fake.json"), '{"mode":"sleep","ms":20000}');
        git(checkout, ["add", "-A"]);
        git(checkout, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "slow chart"]);
      },
    });
    expect(r.output).toBe("result=NOT_CHECKED\nnew-cycles=\n");
    expect(fenced(r.summary)).toContain(
      "NOT CHECKED: 1 render timed out on the head, so its output may differ on a rerun. This job is not green.",
    );
  });
  it("both runs share one chart cache outside the copied trees", () => {
    const t = tmp();
    const log = path.join(t, "argv.log");
    const probe = path.join(t, "probe.mjs");
    fs.writeFileSync(
      probe,
      `import fs from "node:fs";\nconst a = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + "\\n");\nfs.copyFileSync(${JSON.stringify(fileURLToPath(new URL("../fixtures/thin-slice/expected.json", import.meta.url)))}, a[a.indexOf("--out") + 1]);\n`,
    );
    actWith("unrelated-change", { path: process.env.PATH ?? "", cliPath: probe });
    const calls = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as string[]);
    expect(calls).toHaveLength(2);
    const caches = calls.map((a) => a[a.indexOf("--cache-dir") + 1] as string);
    expect(caches[0]).toBe(caches[1]);
    for (const a of calls) expect((caches[0] as string).startsWith(`${a[0]}${path.sep}`)).toBe(false);
    expect(path.basename(caches[0] as string)).toBe("chart-cache");
  });
});
