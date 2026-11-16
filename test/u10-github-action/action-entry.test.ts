// ActionEntry (U10): the workflow token never reaches crankpath or anything it starts (BR10.5),
// inputs are validated and never become options, the same config and alias rules hold on both
// sides, NOT CHECKED for every case the Action cannot compare (BR10.7), and nothing is written
// into the checkout (NFR17.1).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ActionRun,
  CLI_PATH,
  cliEnv,
  gitEnv,
  insidePath,
  parseAliases,
  repoUrl,
  runAction,
  runCli,
  validRef,
} from "../../action/action-entry.mjs";
import { buildCase, FAKE_WORKFLOW_TOKEN } from "../../scripts/action-local.mjs";

const temps: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-action-test-"));
  temps.push(d);
  return d;
}
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const PARENT = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: "/home/runner",
  LANG: "C.UTF-8",
  GITHUB_TOKEN: FAKE_WORKFLOW_TOKEN,
  GH_TOKEN: "gh-cli-token",
  ACTIONS_RUNTIME_TOKEN: "runtime-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-token",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.org/oidc",
  INPUT_BASE_REF: "main",
  NODE_OPTIONS: "--require /tmp/evil.js",
  GIT_DIR: "/elsewhere/.git",
  CRANKPATH_TOKEN_GIT_EXAMPLE_ORG: "per-host-token",
  CRANKPATH_TOKEN_GITHUB_COM: FAKE_WORKFLOW_TOKEN,
};

describe("the environment crankpath runs in (BR10.5)", () => {
  it("keeps the allowlist and per-host tokens; drops every workflow token, input and loader variable", () => {
    const env = cliEnv(PARENT);
    expect(Object.keys(env).sort()).toEqual(["CRANKPATH_TOKEN_GIT_EXAMPLE_ORG", "HOME", "LANG", "NO_COLOR", "PATH"]);
    expect(Object.values(env)).not.toContain(FAKE_WORKFLOW_TOKEN);
    // twin: without the workflow token the same per-host variable is passed on
    const { GITHUB_TOKEN: _drop, ...noWorkflowToken } = PARENT;
    expect(cliEnv(noWorkflowToken).CRANKPATH_TOKEN_GITHUB_COM).toBe(FAKE_WORKFLOW_TOKEN);
  });
  it("git sees PATH and HOME, a fixed locale and no prompt", () => {
    expect(gitEnv(PARENT, { GIT_INDEX_FILE: "/t/i" })).toEqual({
      PATH: PARENT.PATH,
      HOME: "/home/runner",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
      GIT_INDEX_FILE: "/t/i",
    });
  });
  it("neither the CLI process nor a process it starts holds the workflow token", () => {
    const dir = tmp();
    const probe = path.join(dir, "probe.mjs");
    fs.writeFileSync(
      probe,
      [
        'import fs from "node:fs";',
        'import { spawnSync } from "node:child_process";',
        'const out = process.argv[process.argv.indexOf("--out") + 1];',
        'const child = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], { encoding: "utf8" });',
        "fs.writeFileSync(out, JSON.stringify({ self: process.env, child: JSON.parse(child.stdout), argv: process.argv.slice(2) }));",
      ].join("\n"),
    );
    const ran = runCli({
      cliPath: probe,
      scanDir: dir,
      cwd: dir,
      jsonFile: path.join(dir, "out.json"),
      args: ["--repo-url", "https://example.org/x"],
      env: PARENT,
    });
    expect(ran.kind).toBe("report");
    const seen = (ran as { json: { self: Record<string, string>; child: Record<string, string>; argv: string[] } })
      .json;
    for (const env of [seen.self, seen.child]) {
      const text = JSON.stringify(env);
      expect(text).not.toContain(FAKE_WORKFLOW_TOKEN);
      for (const k of [
        "GITHUB_TOKEN",
        "GH_TOKEN",
        "ACTIONS_RUNTIME_TOKEN",
        "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
        "NODE_OPTIONS",
        "GIT_DIR",
        "INPUT_BASE_REF",
      ]) {
        expect(env[k]).toBeUndefined();
      }
    }
    expect(seen.argv.slice(1, 5)).toEqual(["--format", "json", "--out", path.join(dir, "out.json")]);
  });
  it("a CLI that exits 1 or writes no report is a tool error with its first line", () => {
    const dir = tmp();
    const failing = path.join(dir, "fail.mjs");
    fs.writeFileSync(failing, 'process.stderr.write("\\nerror: something \\"quoted\\"\\nmore\\n"); process.exit(1);');
    expect(
      runCli({ cliPath: failing, scanDir: dir, cwd: dir, jsonFile: path.join(dir, "o.json"), args: [], env: PARENT }),
    ).toEqual({
      kind: "error",
      exit: 1,
      said: 'error: something "quoted"',
    });
    const silent = path.join(dir, "silent.mjs");
    fs.writeFileSync(silent, "process.exit(0);");
    expect(
      runCli({ cliPath: silent, scanDir: dir, cwd: dir, jsonFile: path.join(dir, "o.json"), args: [], env: PARENT })
        .kind,
    ).toBe("error");
  });
});

describe("input rules", () => {
  it("paths stay inside their root", () => {
    expect(insidePath(".")).toBe("");
    expect(insidePath("estate/")).toBe("estate");
    expect(insidePath("a/../b")).toBe("b");
    for (const p of ["..", "../x", "a/../../x", "/abs", "", "a\0b"]) expect(insidePath(p)).toBeUndefined();
  });
  it("base-ref is a commit id or plain ref name, never an option or a revision expression", () => {
    for (const r of ["abc123", "main", "refs/heads/main", "release-1.0", "a".repeat(40)])
      expect(validRef(r)).toBe(true);
    for (const r of ["--upload-pack=x", "-n", "main..evil", "HEAD~1", "HEAD^", "main@{1}", "a b", "a:b", ""])
      expect(validRef(r)).toBe(false);
  });
  it("the repository URL comes from the runner's variables of the expected shape only", () => {
    expect(repoUrl({ GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r" })).toBe(
      "https://github.com/o/r",
    );
    expect(repoUrl({ GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r/x" })).toBeUndefined();
    expect(repoUrl({ GITHUB_SERVER_URL: "https://user:pw@github.com", GITHUB_REPOSITORY: "o/r" })).toBeUndefined();
    expect(repoUrl({})).toBeUndefined();
  });
  it("repo-alias lines are url=path with a path inside the repository, or absolute", () => {
    expect(parseAliases("")).toEqual({ ok: true, aliases: [] });
    expect(parseAliases(" https://example.org/a=vendor/a \n\n https://example.org/b=/abs/b ")).toEqual({
      ok: true,
      aliases: [
        { url: "https://example.org/a", path: "vendor/a", line: 1 },
        { url: "https://example.org/b", path: "/abs/b", line: 3 },
      ],
    });
    expect(parseAliases("https://example.org/a=../outside")).toEqual({ ok: false, line: 1 });
    expect(parseAliases("ok=x\nno-equals")).toEqual({ ok: false, line: 2 });
    expect(parseAliases("=x")).toEqual({ ok: false, line: 1 });
    expect(parseAliases("u=")).toEqual({ ok: false, line: 1 });
  });
});

/** Every path under a directory with its size and modification time. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const s = fs.lstatSync(p);
      out.push(`${path.relative(dir, p)} ${s.size} ${s.mtimeMs}`);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out.sort();
}

function actionOn(name: string, inputs: Record<string, string> = {}, mutate?: (checkout: string) => void) {
  const t = tmp();
  const built = buildCase(name, t);
  mutate?.(built.checkout);
  const runner = path.join(t, "runner-temp");
  fs.mkdirSync(runner);
  const summary = path.join(t, "summary.md");
  const output = path.join(t, "output");
  const lines: string[] = [];
  const before = snapshot(built.checkout);
  const run: ActionRun = runAction({
    env: {
      PATH: process.env.PATH,
      HOME: built.home,
      GITHUB_WORKSPACE: built.checkout,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: runner,
      GITHUB_SERVER_URL: "http://gitea-http.gitea:3000",
      GITHUB_REPOSITORY: "ops/estate",
      GITHUB_TOKEN: FAKE_WORKFLOW_TOKEN,
      INPUT_PATH: ".",
      INPUT_CONFIG: "",
      INPUT_BASE_REF: built.baseCommit,
      INPUT_REPO_ALIAS: "",
      ...inputs,
    },
    cwd: built.checkout,
    stdout: (l) => lines.push(l),
  });
  return {
    run,
    lines,
    built,
    before,
    after: snapshot(built.checkout),
    runnerLeft: fs.readdirSync(runner),
    summary: fs.readFileSync(summary, "utf8"),
    output: fs.readFileSync(output, "utf8"),
  };
}

describe("runAction on fixture repositories", () => {
  it("reads the checkout without writing to it, and leaves nothing in RUNNER_TEMP", () => {
    const r = actionOn("add-cycle");
    expect(r.run.exit).toBe(1);
    expect(r.output).toBe("result=FAILED\nnew-cycles=1\n");
    expect(r.after).toEqual(r.before);
    expect(r.runnerLeft).toEqual([]);
    expect(r.summary).toBe(r.run.summary);
    expect(r.lines).toEqual(r.run.annotations);
    expect(CLI_PATH.endsWith(path.join("dist", "u9-cli-package", "cli.js"))).toBe(true);
  });
  it("analyses commits, not the working tree: an uncommitted edit changes nothing", () => {
    const r = actionOn("add-cycle", {}, (checkout) => fs.rmSync(path.join(checkout, "platform"), { recursive: true }));
    expect(r.output).toBe("result=FAILED\nnew-cycles=1\n");
  });
  it("NOT CHECKED for invalid inputs, never an option passed to git", () => {
    const cases: [Record<string, string>, string][] = [
      [{ INPUT_PATH: "../elsewhere" }, "invalid input: path must be a relative path inside the workspace"],
      [{ INPUT_BASE_REF: "--upload-pack=touch x" }, "invalid input: base-ref is not a commit id or a ref name"],
      [
        { INPUT_CONFIG: "../crankpath.yaml" },
        "invalid input: config must be a path inside the repository, or absolute",
      ],
      [{ INPUT_REPO_ALIAS: "https://example.org/a=../x" }, "invalid input: repo-alias line 1 is not url=path"],
      [{ INPUT_BASE_REF: "0".repeat(40) }, `base commit "${"0".repeat(40)}" not in checkout. This job is not green.`],
      [{ INPUT_BASE_REF: "" }, "no base commit"],
    ];
    for (const [inputs, words] of cases) {
      const r = actionOn("unrelated-change", inputs);
      expect(r.run.exit, JSON.stringify(inputs)).toBe(1);
      expect(r.output).toBe("result=NOT_CHECKED\nnew-cycles=\n");
      expect(r.summary).toContain(words);
      expect(r.after).toEqual(r.before);
    }
  });
  it("a path that is not inside a git checkout is NOT CHECKED", () => {
    const r = actionOn("unrelated-change", {}, (checkout) =>
      fs.rmSync(path.join(checkout, ".git"), { recursive: true }),
    );
    expect(r.summary).toContain('NOT CHECKED: path "." is not inside a git checkout');
  });
  it("the same config rule on both sides: a config file missing from the base is NOT CHECKED, not a different rule", () => {
    const r = actionOn("add-crank", { INPUT_CONFIG: "crankpath.yaml" });
    expect(r.summary).toContain('NOT CHECKED: config "crankpath.yaml" is not in the base commit');
    // twin: the default location is read from each commit, absent in the base, present in the head
    expect(actionOn("add-crank").output).toBe("result=NO_NEW_CYCLES_FOUND\nnew-cycles=0\n");
    // a config present on both sides is used on both
    expect(actionOn("remove-crank", { INPUT_CONFIG: "crankpath.yaml" }).summary).toContain("not in the head commit");
  });
  it("a scanned path missing from one side is NOT CHECKED; a subdirectory is scanned on both", () => {
    const missing = actionOn("add-cycle", { INPUT_PATH: "platform/gitea" });
    expect(missing.summary).toContain('NOT CHECKED: path "platform/gitea" is not in the base commit');
    const sub = actionOn("unrelated-change", { INPUT_PATH: "platform" });
    expect(sub.summary).toContain('scanned path "platform"');
    expect(sub.output).toBe("result=NOT_CHECKED\nnew-cycles=\n");
    expect(sub.summary).toContain("NOTHING ANALYSED");
  });
  it("relative repo-alias paths are read from each commit", () => {
    const r = actionOn("add-cycle", { INPUT_REPO_ALIAS: "https://example.org/ops/mirror=platform" });
    // platform/ exists in both commits, so both sides run with the alias and the cycle is still new
    expect(r.output).toBe("result=FAILED\nnew-cycles=1\n");
    const gone = actionOn("add-cycle", { INPUT_REPO_ALIAS: "https://example.org/ops/mirror=platform/gitea" });
    expect(gone.summary).toContain("tool or usage error on the base");
    expect(gone.summary).toContain('crankpath said: "error: cannot read path');
  });
  it("a failure to write the summary or the outputs is never green", () => {
    const t = tmp();
    const built = buildCase("unrelated-change", t);
    const lines: string[] = [];
    const run = runAction({
      env: {
        PATH: process.env.PATH,
        HOME: built.home,
        GITHUB_WORKSPACE: built.checkout,
        RUNNER_TEMP: t,
        INPUT_BASE_REF: built.baseCommit,
        GITHUB_OUTPUT: path.join(t, "no-such-dir", "out"),
      },
      cwd: built.checkout,
      stdout: (l) => lines.push(l),
    });
    expect(run.exit).toBe(1);
    expect(lines.at(-1)).toBe(
      "::error title=crankpath::The job summary or the step outputs could not be written. This job is not green.",
    );
  });
  it("the entry script run as a program: an unexpected error is NOT CHECKED", () => {
    const t = tmp();
    const out = path.join(t, "output");
    // RUNNER_TEMP names a file, so the Action cannot make its working directory
    fs.writeFileSync(path.join(t, "file"), "");
    const r = spawnSync(
      process.execPath,
      [path.join(path.dirname(CLI_PATH), "..", "..", "action", "action-entry.mjs")],
      {
        env: { PATH: process.env.PATH ?? "", RUNNER_TEMP: path.join(t, "file"), GITHUB_OUTPUT: out },
        encoding: "utf8",
      },
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toBe(
      "::error title=crankpath NOT CHECKED::NOT CHECKED: the Action stopped on an internal error (a bug). This job is not green.\n",
    );
    expect(fs.readFileSync(out, "utf8")).toBe("result=NOT_CHECKED\nnew-cycles=\n");
  });
});
