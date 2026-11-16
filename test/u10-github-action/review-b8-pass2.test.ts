// Regression tests for the second B8 review (reviews/bolt-8-review-pass-2.md), written before the
// fixes and seen red on 6aad6f1. m1 gaps are matched item by item, never by count; m2 new cycles
// are found first, and declared facts are their own reason; m3 a path in a copy that leads out of
// it is NOT CHECKED; m4 the guards that could not fail; m5 the copy's bounds and its I/O wording.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { copyBounds, copyCommitTree, loadCopyBounds } from "../../action/action-entry.mjs";
import { diffReports } from "../../action/base-head-differ.mjs";
import { GAP_LIST_ENTRIES, renderSummary } from "../../action/summary.mjs";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { type Json, RING_REPORT, read, report } from "../helpers/action-reports.js";
import { fenced, makeRepo, runOn, type TestRepo } from "../helpers/action-repo.js";

const repos: TestRepo[] = [];
function repo(layers: string[], mutateBase?: (dir: string) => void): TestRepo {
  const r = makeRepo(layers, mutateBase);
  repos.push(r);
  return r;
}
afterEach(() => {
  for (const r of repos.splice(0)) r.cleanup();
});
const CTX = { crankpathVersion: "0.1.0", baseCommit: "a".repeat(40), headCommit: "b".repeat(40), pathPrefix: "" };

const OTHER_APP = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: other
  namespace: argocd
spec:
  project: default
  source:
    repoURL: http://unknown-host.example.org/x/y
    targetRevision: 0123456789abcdef0123456789abcdef01234567
    path: p
  destination:
    server: https://kubernetes.default.svc
    namespace: other
`;
const hideGitea = (dir: string) => {
  const f = path.join(dir, "apps", "gitea.yaml");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("kind: Application", "kind: Applicationn"));
};

describe("m1: gaps are matched item by item", () => {
  it("a head that hides a cycle and removes an unrelated base gap is NOT CHECKED (the review's swap)", () => {
    const r = repo(["_estate/full"], (d) => fs.writeFileSync(path.join(d, "apps", "other.yaml"), OTHER_APP));
    r.commitHead((d) => {
      fs.rmSync(path.join(d, "apps", "other.yaml"));
      hideGitea(d);
    });
    const run = runOn(r);
    expect(run.output).toBe("result=NOT_CHECKED\nnew-cycles=\n");
    const lines = fenced(run.summaryFile);
    expect(lines[0]).toMatch(
      /^NOT CHECKED: the head has \d+ gaps? the base did not have, so what they hide could not be compared \(listed below\)\. This job is not green\.$/,
    );
    expect(lines.some((l) => l.startsWith("  new in the head: "))).toBe(true);
  });
  it("each kind of gap item new in the head is named; the same item in both is not", () => {
    const cases: [Json, string][] = [
      [
        {
          opaque: [
            {
              detail: null,
              field: null,
              kustomizeRoot: null,
              lostEdges: ["x"],
              node: "Application/argocd/a",
              reason: "render-failed",
              suggestion: null,
              value: null,
            },
          ],
        },
        'new in the head: opaque source Application "argocd/a"  reason: render-failed',
      ],
      [
        {
          opaque: [
            {
              detail: null,
              field: null,
              kustomizeRoot: "kust/app",
              lostEdges: ["x"],
              node: null,
              reason: "render-failed",
              suggestion: null,
              value: null,
            },
          ],
        },
        'new in the head: opaque Kustomize root "kust/app"  reason: render-failed',
      ],
      [
        { unreadable: [{ detail: null, outcome: "parse-error", path: "apps/a.yaml", reasonWord: "not valid YAML" }] },
        'new in the head: unreadable file "apps/a.yaml"  (not valid YAML)',
      ],
      [
        {
          skipped: [
            {
              document: 2,
              file: "apps/a.yaml",
              item: null,
              kind: "ConfigMap",
              name: "x",
              namespace: "n",
              reason: "invalid-name",
              renderJob: null,
              source: false,
            },
          ],
        },
        'new in the head: skipped object in file "apps/a.yaml"  document: 2  reason: invalid-name',
      ],
      [
        {
          unresolved: [
            {
              candidates: [],
              candidatesTruncated: false,
              field: null,
              owner: null,
              subject: "Service/a/b",
              value: null,
              where: "apps/a.yaml#1",
              why: "not-defined",
            },
          ],
        },
        'new in the head: unresolved not-defined  subject: "Service/a/b"  where: "apps/a.yaml\\x231"',
      ],
    ];
    for (const [parts, words] of cases) {
      const d = diffReports(read(report()), read(report(parts)));
      expect(d.result, words).toBe("NOT_CHECKED");
      expect(d.notChecked.map((n) => n.code)).toEqual(["new-gaps"]);
      expect(fenced(renderSummary(d, CTX))).toContain(`  ${words}`);
      // twin: the same item in the base is not new
      expect(diffReports(read(report(parts)), read(report(parts))).result).toBe("NO_NEW_CYCLES_FOUND");
    }
  });
  it("every part of an item's key counts: a different document, node or host is a different item", () => {
    const sk = (document: number) => ({
      document,
      file: "apps/a.yaml",
      item: null,
      kind: "ConfigMap",
      name: "x",
      namespace: "n",
      reason: "invalid-name",
      renderJob: null,
      source: false,
    });
    const op = (node: string) => ({
      detail: null,
      field: null,
      kustomizeRoot: null,
      lostEdges: ["x"],
      node,
      reason: "render-failed",
      suggestion: null,
      value: null,
    });
    const mo = (host: string) => ({
      declared: "Service/a/b",
      extracted: { candidates: [], node: null, outcome: "none" },
      host,
      keyPath: "match[0]",
    });
    const pairs: [Json, Json][] = [
      [{ skipped: [sk(1)] }, { skipped: [sk(2)] }],
      [{ opaque: [op("Application/argocd/a")] }, { opaque: [op("Application/argocd/b")] }],
      [{ matchOverrides: [mo("a.example.org")] }, { matchOverrides: [mo("b.example.org")] }],
    ];
    for (const [b, h] of pairs)
      expect(diffReports(read(report(b)), read(report(h))).result, JSON.stringify(h)).toBe("NOT_CHECKED");
  });
  it("removing a base gap never compensates for a new one of the same kind", () => {
    const u = (subject: string) => ({
      candidates: [],
      candidatesTruncated: false,
      field: null,
      owner: null,
      subject,
      value: null,
      where: "w",
      why: "not-defined",
    });
    const d = diffReports(
      read(report({ unresolved: [u("Service/a/old")] })),
      read(report({ unresolved: [u("Service/a/new")] })),
    );
    expect(d.result).toBe("NOT_CHECKED");
    expect(d.newGaps).toHaveLength(1);
  });
  it("edges not kept over the run limit have no item list: a higher count is a new gap", () => {
    const d = diffReports(read(report({}, { runLimitEdges: 1 })), read(report({}, { runLimitEdges: 3 })));
    expect(fenced(renderSummary(d, CTX))).toContain("  new in the head: edges not kept over the run limit: 3 (base 1)");
  });
  it("a long list is capped and counted", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      detail: null,
      outcome: "parse-error",
      path: `f${String(i).padStart(2, "0")}.yaml`,
      reasonWord: "not valid YAML",
    }));
    const lines = fenced(renderSummary(diffReports(read(report()), read(report({ unreadable: many }))), CTX));
    expect(lines.filter((l) => l.startsWith("  new in the head: "))).toHaveLength(GAP_LIST_ENTRIES);
    expect(lines).toContain(
      `  and ${40 - GAP_LIST_ENTRIES} more gaps new in the head; run crankpath on the head commit to see them all`,
    );
    expect(GAP_LIST_ENTRIES).toBe(LIMITS.explainListEntries.value);
  });
});

describe("m2: new cycles first; declared facts are their own reason", () => {
  it("a cycle that needs a declared edge the PR adds is FAILED, with its label and the edge listed", () => {
    const r = repo(["_estate/web-only"]);
    r.commitHead((d) =>
      fs.writeFileSync(
        path.join(d, "crankpath.yaml"),
        'edges:\n  - {from: Application/argocd/web, to: Deployment/web/web, why: "declared by PR"}\n',
      ),
    );
    const run = runOn(r);
    expect(run.output).toBe("result=FAILED\nnew-cycles=1\n");
    const lines = fenced(run.summaryFile);
    expect(lines[1]).toMatch(
      /^ {2}cycle c-[0-9a-f]+ {2}label: declared \(unverified\) {2}edges: \d+ {3}\(head only; base has \d+ of its edges\)$/,
    );
    expect(lines).toContain(
      '    Application "argocd/web" depends on Deployment "web/web"  [declared, not verified]  [file: "crankpath.yaml"]',
    );
    expect(
      lines.some((l) => l.startsWith('  declared edge: Application "argocd/web" depends on Deployment "web/web"')),
    ).toBe(true);
    expect(run.summaryFile).not.toContain("reads less");
  });
  it("new gaps beside a new cycle do not hide it: FAILED, and the gaps are listed", () => {
    const parts = {
      unreadable: [{ detail: null, outcome: "parse-error", path: "x.yaml", reasonWord: "not valid YAML" }],
    };
    const d = diffReports(read(report()), read({ ...RING_REPORT(), ...parts }));
    expect(d.result).toBe("FAILED");
    expect(fenced(renderSummary(d, CTX))).toContain('  new in the head: unreadable file "x.yaml"  (not valid YAML)');
  });
  it("a declared fact with no new cycle is NOT CHECKED in its own words, each fact listed", () => {
    const m = {
      declared: "Service/a/b",
      extracted: { candidates: [], node: null, outcome: "none" },
      host: "git.example.org",
      keyPath: "match[0]",
    };
    const d = diffReports(read(report()), read(report({ matchOverrides: [m] })));
    expect(d.notChecked.map((n) => n.code)).toEqual(["new-declared"]);
    const lines = fenced(renderSummary(d, CTX));
    expect(lines[0]).toBe(
      "NOT CHECKED: the head relies on 1 declared fact the base did not (crankpath.yaml; documented by the PR author, not verified; listed below). This job is not green.",
    );
    expect(lines).toContain('  new in the head: match entry sends host "git.example.org" to Service "a/b"');
    expect(lines.join("\n")).not.toContain("reads less");
  });
});

describe("m3: a path in the copy that leads out of it is NOT CHECKED", () => {
  it("the scan path through a link the merge base holds", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-outside-"));
    try {
      fs.mkdirSync(path.join(outside, "dir"));
      const r = repo(["_estate/web-only"], (d) => fs.symlinkSync(outside, path.join(d, "sub")));
      r.commitHead((d) => {
        fs.rmSync(path.join(d, "sub"));
        fs.mkdirSync(path.join(d, "sub", "dir"), { recursive: true });
        fs.writeFileSync(path.join(d, "sub", "dir", "README.md"), "x\n");
      });
      const run = runOn(r, { INPUT_PATH: "sub/dir" });
      expect(fenced(run.summaryFile)[0]).toBe(
        'NOT CHECKED: path "sub/dir" in the base commit leads outside the copy (through a symbolic link). This job is not green.',
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  it("a relative config through a link the head holds, and a repo-alias path the same way", () => {
    const r = repo(["_estate/full"], (d) => {
      fs.mkdirSync(path.join(d, "ci"));
      fs.writeFileSync(path.join(d, "ci", "cfg.yaml"), "{}\n");
    });
    r.commitHead((d) => {
      fs.rmSync(path.join(d, "ci"), { recursive: true });
      fs.symlinkSync(r.tmp, path.join(d, "ci"));
    });
    expect(fenced(runOn(r, { INPUT_CONFIG: "ci/cfg.yaml" }).summaryFile)[0]).toBe(
      'NOT CHECKED: config "ci/cfg.yaml" in the head commit leads outside the copy (through a symbolic link). This job is not green.',
    );
    expect(fenced(runOn(r, { INPUT_REPO_ALIAS: "https://example.org/x=ci" }).summaryFile)[0]).toBe(
      "NOT CHECKED: repo-alias line 1 in the head commit leads outside the copy (through a symbolic link). This job is not green.",
    );
  });
});

describe("m4: the guards that could not fail", () => {
  it("a tree entry named .. or .GIT stops the copy, and nothing is written outside it", () => {
    for (const name of ["..", ".GIT", ".git", "."]) {
      const r = repo(["_estate/web-only"]);
      const blob = r.git(["hash-object", "-w", "--stdin"], "PWNED\n");
      const inner = r.rawTree([{ mode: "100644", name: "escaped.txt", oid: blob }]);
      const root = r.rawTree([{ mode: "40000", name, oid: inner }]);
      const commit = r.git(["-c", "commit.gpgsign=false", "commit-tree", root, "-m", "crafted"]);
      const dest = path.join(r.tmp, "copy", "tree");
      fs.mkdirSync(path.dirname(dest));
      expect(copyCommitTree(r.dir, commit, dest, { PATH: process.env.PATH, HOME: r.tmp }), name).toEqual({
        ok: false,
        why: "unsafe",
      });
      expect(fs.existsSync(path.join(r.tmp, "copy", "escaped.txt"))).toBe(false);
    }
  });
  it("the base runs before the head, so the head reads only what the base's run fetched into the cache", () => {
    const r = repo(["_estate/web-only"]);
    r.commitHead(() => {});
    const log = path.join(r.tmp, "order.log");
    const probe = path.join(r.tmp, "probe.mjs");
    const thin = new URL("../fixtures/thin-slice/expected.json", import.meta.url);
    fs.writeFileSync(
      probe,
      `import fs from "node:fs";\nconst a = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(log)}, a[0] + "\\n");\nfs.copyFileSync(new URL(${JSON.stringify(thin.href)}), a[a.indexOf("--out") + 1]);\n`,
    );
    runOn(r, { INPUT_BASE_REF: r.base }, { cliPath: probe });
    const order = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((p) => path.basename(p));
    expect(order).toEqual(["base-tree", "head-tree"]);
  });
  it("a copy in many chunks is byte-identical to one in a single chunk", () => {
    const r = repo(["_estate/full"]);
    const head = r.commitHead(() => {});
    const one = path.join(r.tmp, "one");
    const many = path.join(r.tmp, "many");
    const env = { PATH: process.env.PATH, HOME: r.tmp };
    const bounds = copyBounds(LIMITS);
    expect(copyCommitTree(r.dir, head, one, env, bounds)).toEqual({ ok: true, submodules: [] });
    // count the blob fetches through a git wrapper: one chunk per blob at a 1-byte working set
    const bin = path.join(r.tmp, "bin");
    fs.mkdirSync(bin);
    const calls = path.join(r.tmp, "calls.log");
    const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(
      path.join(bin, "git"),
      `#!/bin/sh\necho "$7" >> ${JSON.stringify(calls)}\nexec ${JSON.stringify(realGit)} "$@"\n`,
      { mode: 0o755 },
    );
    const wrapped = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: r.tmp };
    expect(copyCommitTree(r.dir, head, many, wrapped, { ...bounds, chunkBytes: 1 })).toEqual({
      ok: true,
      submodules: [],
    });
    const fetches = fs
      .readFileSync(calls, "utf8")
      .split("\n")
      .filter((l) => l === "cat-file").length;
    expect(fetches).toBeGreaterThan(5);
    const list = (d: string): string[] =>
      fs
        .readdirSync(d, { recursive: true, encoding: "utf8" })
        .sort()
        .map((f) => {
          const p = path.join(d, f);
          return fs.statSync(p).isFile() ? `${f} ${fs.readFileSync(p).toString("base64")}` : f;
        });
    expect(list(many)).toEqual(list(one));
    expect(list(one).length).toBeGreaterThan(5);
  });
});

describe("m5: the copy's bounds and its wording", () => {
  const env = () => ({ PATH: process.env.PATH, HOME: "/nonexistent" });
  function headOf(r: TestRepo) {
    return r.commitHead(() => {});
  }
  it("takes all four bounds from crankpath's own limits, as the build this Action made holds them", async () => {
    const b = copyBounds(LIMITS);
    expect(b.entries).toEqual({ name: "filesPerScan", value: LIMITS.filesPerScan.value, unit: "files" });
    expect(b.totalBytes).toEqual({ name: "fetchedRepoBytes", value: LIMITS.fetchedRepoBytes.value, unit: "bytes" });
    expect(b.blobBytes).toEqual({ name: "fileBytes", value: LIMITS.fileBytes.value, unit: "bytes" });
    expect(b.wallClock).toEqual({
      name: "repoFetchWallClock",
      value: LIMITS.repoFetchWallClock.value,
      unit: "milliseconds",
    });
    // what the Action's entry loads at run time is the build's LIMITS, the same four
    expect(await loadCopyBounds()).toEqual(b);
  });
  it("the entry script applies them: a file over fileBytes in the head is NOT CHECKED, named", () => {
    const r = repo(["_estate/web-only"]);
    r.commitHead((d) => fs.writeFileSync(path.join(d, "big.yaml"), Buffer.alloc(LIMITS.fileBytes.value + 1, 0x61)));
    const runner = fs.mkdtempSync(path.join(r.tmp, "rt-"));
    const summary = path.join(r.tmp, "summary.md");
    const output = path.join(r.tmp, "output");
    fs.writeFileSync(summary, "");
    fs.writeFileSync(output, "");
    const entry = fileURLToPath(new URL("../../action/action-entry.mjs", import.meta.url));
    const p = spawnSync(process.execPath, [entry], {
      cwd: r.dir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: r.tmp,
        GITHUB_WORKSPACE: r.dir,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: runner,
        INPUT_BASE_REF: r.base,
      },
    });
    expect(p.status).toBe(1);
    expect(fenced(fs.readFileSync(summary, "utf8"))[0]).toBe(
      `NOT CHECKED: the head commit is over a bound of the Action's copy: a file over fileBytes (${LIMITS.fileBytes.value.toLocaleString("en-US")} bytes); with path the repository's root the whole tree is copied, so set the path input to the estate's directory and only what crankpath reads counts. This job is not green.`,
    );
  });
  it("each bound refuses with the limit named, never as a bad path", () => {
    const r = repo(["_estate/full"]);
    const head = headOf(r);
    const b = copyBounds(LIMITS);
    const at = (i: number) => path.join(r.tmp, `c${i}`);
    expect(
      copyCommitTree(r.dir, head, at(1), env(), { ...b, entries: { name: "filesPerScan", value: 3, unit: "files" } }),
    ).toMatchObject({
      ok: false,
      why: "limit",
      limit: { name: "filesPerScan", value: 3, unit: "files" },
    });
    expect(
      copyCommitTree(r.dir, head, at(2), env(), {
        ...b,
        totalBytes: { name: "fetchedRepoBytes", value: 100, unit: "bytes" },
      }),
    ).toMatchObject({
      why: "limit",
      limit: { name: "fetchedRepoBytes" },
    });
    expect(
      copyCommitTree(r.dir, head, at(3), env(), { ...b, blobBytes: { name: "fileBytes", value: 10, unit: "bytes" } }),
    ).toMatchObject({
      why: "limit",
      limit: { name: "fileBytes" },
    });
    expect(
      copyCommitTree(r.dir, head, at(4), env(), {
        ...b,
        wallClock: { name: "repoFetchWallClock", value: 0, unit: "milliseconds" },
      }),
    ).toMatchObject({
      why: "limit",
      limit: { name: "repoFetchWallClock" },
    });
  });
  it("the summary names a bound that stopped a copy", () => {
    const r = repo(["_estate/full"]);
    headOf(r);
    const run = runOn(
      r,
      {},
      { copyBounds: { ...copyBounds(LIMITS), blobBytes: { name: "fileBytes", value: 10, unit: "bytes" } } },
    );
    expect(fenced(run.summaryFile)[0]).toBe(
      "NOT CHECKED: the base commit is over a bound of the Action's copy: a file over fileBytes (10 bytes); with path the repository's root the whole tree is copied, so set the path input to the estate's directory and only what crankpath reads counts. This job is not green.",
    );
  });
  it("a write the file system refuses is an I/O failure in its own words", () => {
    const r = repo(["_estate/web-only"]);
    const blob = r.git(["hash-object", "-w", "--stdin"], "x\n");
    const root = r.rawTree([{ mode: "100644", name: `${"n".repeat(300)}.yaml`, oid: blob }]);
    const commit = r.git(["-c", "commit.gpgsign=false", "commit-tree", root, "-m", "long name"]);
    expect(copyCommitTree(r.dir, commit, path.join(r.tmp, "c"), env())).toEqual({ ok: false, why: "io" });
  });
});

describe("lead decision after pass 2: copy only what crankpath reads from each commit", () => {
  /** A repository whose estate lives under estate/, beside other parts of a monorepo. */
  function monorepo(extra?: (dir: string) => void) {
    const r = repo([], (d) => {
      fs.mkdirSync(path.join(d, "estate"));
      fs.cpSync(fileURLToPath(new URL("../fixtures/action/_estate/full", import.meta.url)), path.join(d, "estate"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(d, "big"));
      fs.writeFileSync(path.join(d, "big", "blob.bin"), Buffer.alloc(20000, 0x61));
      fs.mkdirSync(path.join(d, "ci"));
      fs.writeFileSync(path.join(d, "ci", "cfg.yaml"), "{}\n");
      fs.mkdirSync(path.join(d, "vendor", "x"), { recursive: true });
      fs.writeFileSync(path.join(d, "vendor", "x", "README.md"), "x\n");
      extra?.(d);
    });
    r.commitHead(() => {});
    return r;
  }
  const small = () => ({ ...copyBounds(LIMITS), blobBytes: { name: "fileBytes", value: 10000, unit: "bytes" } });
  it("a file over a bound outside the scanned path does not stop the check", () => {
    const run = runOn(monorepo(), { INPUT_PATH: "estate" }, { copyBounds: small() });
    expect(run.output).toBe("result=NO_NEW_CYCLES_FOUND\nnew-cycles=0\n");
    // twin: the same file inside the scanned path is over the bound
    const inside = runOn(
      monorepo((d) => fs.writeFileSync(path.join(d, "estate", "blob.bin"), Buffer.alloc(20000, 0x61))),
      { INPUT_PATH: "estate" },
      { copyBounds: small() },
    );
    expect(fenced(inside.summaryFile)[0]).toMatch(
      /^NOT CHECKED: the base commit is over a bound of the Action's copy: a file over fileBytes/,
    );
  });
  it("copies the scanned path, a relative config and relative alias paths, and nothing else", () => {
    const r = monorepo();
    const log = path.join(r.tmp, "tree.log");
    const probe = path.join(r.tmp, "probe.mjs");
    const thin = new URL("../fixtures/thin-slice/expected.json", import.meta.url);
    fs.writeFileSync(
      probe,
      `import fs from "node:fs";\nimport path from "node:path";\nconst a = process.argv.slice(2);\nconst tree = process.cwd();\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(fs.readdirSync(tree, { recursive: true }).sort()) + "\\n");\nfs.copyFileSync(new URL(${JSON.stringify(thin.href)}), a[a.indexOf("--out") + 1]);\n`,
    );
    const run = runOn(
      r,
      { INPUT_PATH: "estate", INPUT_CONFIG: "ci/cfg.yaml", INPUT_REPO_ALIAS: "https://example.org/x=vendor/x" },
      { cliPath: probe },
    );
    expect(run.output).toBe("result=NO_NEW_CYCLES_FOUND\nnew-cycles=0\n");
    const trees = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as string[]);
    expect(trees).toHaveLength(2);
    for (const t of trees) {
      expect(t.filter((p) => !p.includes(path.sep))).toEqual(["ci", "estate", "vendor"]);
      expect(t).toContain(path.join("ci", "cfg.yaml"));
      expect(t).toContain(path.join("vendor", "x", "README.md"));
      expect(t.some((p) => p.startsWith("big"))).toBe(false);
      // no .git in a copy: crankpath reads the repository's URL only from --repo-url
      expect(t.some((p) => p === ".git" || p.startsWith(`.git${path.sep}`))).toBe(false);
    }
  });
  it("a path input is literal, never a pattern: `e*` copies the directory of that name only", () => {
    const r = monorepo((d) => {
      fs.writeFileSync(path.join(d, "estate", "blob.bin"), Buffer.alloc(20000, 0x61));
      fs.cpSync(fileURLToPath(new URL("../fixtures/action/_estate/full", import.meta.url)), path.join(d, "e*"), {
        recursive: true,
      });
    });
    const run = runOn(r, { INPUT_PATH: "e*" }, { copyBounds: small() });
    expect(run.output).toBe("result=NO_NEW_CYCLES_FOUND\nnew-cycles=0\n");
  });
});
