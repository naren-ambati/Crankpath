import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  audit,
  goldens,
  INTERIM_REASON,
  interimReasonFiles,
  releaseChecks,
  summaryLine,
  verdictLine,
} from "../../scripts/release-checks.mjs";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-release-checks-"));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

describe("the summary line", () => {
  it("never counts a check that did not run as passed, and counts release-only failures apart", () => {
    const line = summaryLine(
      [
        { result: "PASS", blocking: true },
        { result: "NOT RUN", blocking: false },
        { result: "FAIL", blocking: false },
        { result: "SKIPPED", blocking: true },
      ],
      false,
    );
    expect(line).toBe(
      "release checks: 1 passed, 0 failed, 1 failing a release only, 1 not run, 1 skipped; a check not run or skipped is not a pass",
    );
    expect(summaryLine([{ result: "FAIL", blocking: true }], true)).toBe(
      "release checks (release mode): 0 passed, 1 failed, 0 not run, 0 skipped; a check not run or skipped is not a pass",
    );
  });
});

describe("the verdict line", () => {
  it("names every check that blocks, a NOT RUN included, and says when nothing blocks", () => {
    const results = [
      { check: "check-docs", result: "PASS", blocking: true },
      { check: "denylist", result: "NOT RUN", blocking: true },
      { check: "npm-audit", result: "NOT RUN", blocking: false },
    ];
    expect(verdictLine(results, true)).toBe("release check: FAILED, blocked by denylist NOT RUN");
    expect(verdictLine(results.slice(0, 1), false)).toBe("offline checks: nothing blocks");
  });
});

describe("the interim opacity reason (the B1 deviation)", () => {
  it("names each file under src/ and dist/ that still holds it, and nothing elsewhere", () => {
    const root = tree({
      "src/a.ts": `export const r = "${INTERIM_REASON}";\n`,
      "dist/a.js": `"${INTERIM_REASON}"\n`,
      "src/b.ts": "export {};\n",
      "test/a.test.ts": `"${INTERIM_REASON}"\n`,
    });
    expect(interimReasonFiles(root)).toEqual(["src/a.ts", "dist/a.js"]);
    expect(interimReasonFiles(tree({ "src/b.ts": "x\n" }))).toEqual([]);
    // review n2: with no src/ there is nothing to prove the reason absent from
    expect(interimReasonFiles(tree({ "dist/a.js": "x\n" }))).toEqual(["src/ (missing: nothing to check)"]);
  });
});

describe("the golden lane (OD-23)", () => {
  const pkg = (script?: string) =>
    JSON.stringify({ name: "p", version: "1.0.0", scripts: script === undefined ? {} : { "verify:golden": script } });

  it("is NOT RUN without a verify:golden script, SKIPPED on exit 2, FAIL on another exit, PASS on 0", () => {
    expect(goldens(tree({ "package.json": pkg() })).result).toBe("NOT RUN");
    expect(goldens(tree({ "package.json": pkg("node -e \"console.log('x skipped');process.exit(2)\"") })).result).toBe(
      "SKIPPED",
    );
    expect(goldens(tree({ "package.json": pkg('node -e "process.exit(1)"') })).result).toBe("FAIL");
    expect(goldens(tree({ "package.json": pkg("node -e \"console.log('2 passed')\"") }))).toEqual({
      result: "PASS",
      detail: "2 passed",
    });
  });
});

/** A directory holding a fake `npm`: `audit --json [--omit=dev]` prints FAKE_AUDIT_RUNTIME or FAKE_AUDIT_ALL, `run` exits FAKE_RUN_EXIT. */
function fakeNpm(): string {
  const dir = tree({});
  const script = [
    "#!/bin/sh",
    'if [ "$1" = "audit" ]; then',
    '  case "$*" in *--omit=dev*) printf "%s" "$FAKE_AUDIT_RUNTIME";; *) printf "%s" "$FAKE_AUDIT_ALL";; esac',
    "  exit 1",
    "fi",
    'if [ "$1" = "run" ]; then echo "golden lane: fake"; exit "$' + '{FAKE_RUN_EXIT:-0}"; fi',
    "exit 3",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "npm"), script, { mode: 0o755 });
  return dir;
}
const meta = (total: number) =>
  JSON.stringify({ metadata: { vulnerabilities: { critical: 0, high: total, moderate: 0, low: 0, info: 0, total } } });
const PATH_WITH = (dir: string) => `${dir}${path.delimiter}${process.env.PATH ?? ""}`;

describe("npm audit (release only, review m3)", () => {
  it("passes with no runtime vulnerability, fails with one, and is NOT RUN without an answer", () => {
    const dir = fakeNpm();
    const root = tree({ "package.json": "{}" });
    const env = (runtime: string, all: string) => ({
      PATH: PATH_WITH(dir),
      FAKE_AUDIT_RUNTIME: runtime,
      FAKE_AUDIT_ALL: all,
    });
    expect(audit(root, env(meta(0), meta(2))).result).toBe("PASS");
    expect(audit(root, env(meta(0), meta(2))).detail).toContain("all: 2 (critical 0, high 2");
    expect(audit(root, env(meta(1), meta(1))).result).toBe("FAIL");
    expect(audit(root, env("not json", meta(0))).result).toBe("NOT RUN");
    expect(audit(root, env(meta(0), "")).result).toBe("NOT RUN");
  });
});

describe("releaseChecks, the gate npm run release:check runs (review m3)", () => {
  function repo(): string {
    const root = tree({
      "package.json": JSON.stringify({
        name: "p",
        version: "1.0.0",
        files: ["dist"],
        scripts: { "verify:golden": "x" },
      }),
      "dist/a.js": "export {};\n",
      "src/a.ts": "export {};\n",
      "README.md": "# p\n",
    });
    const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    return root;
  }
  const row = (r: ReturnType<typeof releaseChecks>, check: string) => r.results.find((c) => c.check === check);

  it("blocks a release when the denylist is NOT RUN, and does not block the offline run", () => {
    const root = repo();
    const dir = fakeNpm();
    const env = { PATH: PATH_WITH(dir), FAKE_AUDIT_RUNTIME: meta(0), FAKE_AUDIT_ALL: meta(0) };
    const offline = releaseChecks({ root, env });
    expect(row(offline, "denylist")).toMatchObject({ result: "NOT RUN", blocking: false });
    expect(row(offline, "npm-audit")).toMatchObject({ result: "NOT RUN", blocking: false });
    const release = releaseChecks({ root, env, release: true });
    expect(row(release, "denylist")).toMatchObject({ result: "NOT RUN", blocking: true });
    expect(row(release, "npm-audit")).toMatchObject({ result: "PASS", blocking: true });
    expect(row(release, "goldens")).toMatchObject({ result: "PASS", blocking: true });
    expect(release.ok).toBe(false);
    expect(verdictLine(release.results, true)).toContain("denylist NOT RUN");
  });

  it("runs check-images and check-examples as blocking rows: a tree without examples fails the offline run", () => {
    const root = repo();
    const offline = releaseChecks({ root, env: { PATH: PATH_WITH(fakeNpm()) } });
    expect(row(offline, "check-images")).toMatchObject({ result: "PASS", blocking: true });
    expect(row(offline, "check-examples")).toMatchObject({ result: "FAIL", blocking: true });
    expect(offline.ok).toBe(false);
    expect(verdictLine(offline.results, false)).toContain("check-examples FAIL");
  });

  it("passes the denylist row when a term file is given and no term is found, and blocks a skipped golden", () => {
    const root = repo();
    const dir = fakeNpm();
    const list = path.join(tree({ "names.txt": "zorblaxian\n" }), "names.txt");
    const env = {
      PATH: PATH_WITH(dir),
      FAKE_AUDIT_RUNTIME: meta(0),
      FAKE_AUDIT_ALL: meta(0),
      FAKE_RUN_EXIT: "2",
      CRANKPATH_DENYLIST_FILE: list,
    };
    const release = releaseChecks({ root, env, release: true });
    expect(row(release, "denylist")).toMatchObject({ result: "PASS", blocking: true });
    expect(row(release, "goldens")).toMatchObject({ result: "SKIPPED", blocking: true });
    expect(release.ok).toBe(false);
  });
});
