// Regression tests for the third B8 review (reviews/bolt-8-review-pass-3.md), written before the
// fixes and seen red on de901ae. M1 gap items are compared as a multiset over their full keys (every
// field the report carries); m1 each part of a key is pinned, and a limit that is not derived is no
// bound; m2 a whole-copy bound names what is over it and the way out; n1 the entries bound stops
// the listing's parse early.

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyBounds, copyCommitTree } from "../../action/action-entry.mjs";
import { diffReports, notCheckedResult } from "../../action/base-head-differ.mjs";
import { renderSummary } from "../../action/summary.mjs";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { type Json, read, report } from "../helpers/action-reports.js";
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

const multi = (sources: [string, string][]) => `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: multi
  namespace: argocd
spec:
  project: default
  sources:
${sources.map(([u, p]) => `    - repoURL: ${u}\n      targetRevision: 0123456789abcdef0123456789abcdef01234567\n      path: ${p}\n`).join("")}  destination:
    server: https://kubernetes.default.svc
    namespace: multi
`;

describe("M1: a second gap item on an object that already has one is new", () => {
  it("the review's s6: a second unplaced source on a multi-source Application is NOT CHECKED", () => {
    const A: [string, string] = ["http://mirror-a:3000/x/y", "a"];
    const B: [string, string] = ["http://mirror-b:3000/x/y", "b"];
    const r = repo(["_estate/web-only"], (d) => fs.writeFileSync(path.join(d, "apps", "multi.yaml"), multi([A])));
    r.commitHead((d) => fs.writeFileSync(path.join(d, "apps", "multi.yaml"), multi([A, B])));
    const run = runOn(r);
    expect(run.output).toBe("result=NOT_CHECKED\nnew-cycles=\n");
    expect(
      fenced(run.summaryFile).some(
        (l) => l.startsWith("  new in the head: unresolved ") && l.includes('subject: "Application/argocd/multi"'),
      ),
    ).toBe(true);
  });
  it("items are a multiset: a second identical item is new", () => {
    const u = {
      candidates: [],
      candidatesTruncated: false,
      field: "spec.x",
      owner: null,
      subject: "Service/a/b",
      value: null,
      where: "w",
      why: "not-defined",
    };
    const d = diffReports(read(report({ unresolved: [u] })), read(report({ unresolved: [u, u] })));
    expect(d.result).toBe("NOT_CHECKED");
    expect(d.newGaps).toHaveLength(1);
    expect(diffReports(read(report({ unresolved: [u, u] })), read(report({ unresolved: [u, u] }))).result).toBe(
      "NO_NEW_CYCLES_FOUND",
    );
  });
});

describe("m1: every field of an item is part of its key", () => {
  const items: [string, Json][] = [
    [
      "unresolved",
      {
        candidates: ["Service/a/c"],
        candidatesTruncated: false,
        field: "spec.x",
        owner: "Application/argocd/a",
        subject: "Service/a/b",
        value: "h.example.org",
        where: "apps/a.yaml#1",
        why: "not-defined",
      },
    ],
    [
      "opaque",
      {
        detail: "d",
        field: "spec.y",
        kustomizeRoot: null,
        lostEdges: ["objects"],
        node: "Application/argocd/a",
        reason: "render-failed",
        suggestion: null,
        value: "v",
      },
    ],
    ["unreadable", { detail: null, outcome: "parse-error", path: "apps/a.yaml", reasonWord: "not valid YAML" }],
    [
      "skipped",
      {
        document: 1,
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
    [
      "matchOverrides",
      {
        declared: "Service/a/b",
        extracted: { candidates: [], node: null, outcome: "none" },
        host: "git.example.org",
        keyPath: "match[0]",
      },
    ],
    [
      "repoMappings",
      {
        commit: null,
        failure: null,
        floating: false,
        from: "crankpath.yaml",
        root: "vendor/x",
        url: "https://example.org/x",
        used: true,
      },
    ],
  ];
  const changed = (v: unknown): unknown =>
    typeof v === "string"
      ? `${v}-other`
      : typeof v === "number"
        ? v + 1
        : typeof v === "boolean"
          ? !v
          : v === null
            ? "x"
            : Array.isArray(v)
              ? [...v, "extra"]
              : { ...(v as Json), extra: 1 };
  for (const [list, item] of items) {
    for (const field of Object.keys(item)) {
      if (list === "repoMappings" && (field === "from" || field === "used")) continue; // only used crankpath.yaml mappings count
      it(`${list}: another ${field} is another item`, () => {
        const other = { ...item, [field]: field === "item" ? 2 : changed(item[field]) };
        const d = diffReports(read(report({ [list]: [item] })), read(report({ [list]: [other] })));
        expect(d.result).toBe("NOT_CHECKED");
        // twin: the same item is not new
        expect(diffReports(read(report({ [list]: [item] })), read(report({ [list]: [item] }))).result).toBe(
          "NO_NEW_CYCLES_FOUND",
        );
      });
    }
  }
  it("a declared edge is keyed by every field, its evidence included", () => {
    const e = {
      evidence: { field: "edges[0]", file: "crankpath.yaml", line: null, renderedPath: "crankpath.yaml" },
      from: "Application/argocd/a",
      kind: "depends-on",
      orderingOnly: false,
      source: "declared",
      to: "Service/a/b",
    };
    const moved = { ...e, evidence: { ...e.evidence, field: "edges[1]" } };
    expect(diffReports(read(report({ edges: [e] })), read(report({ edges: [moved] }))).result).toBe("NOT_CHECKED");
  });
  it("a limit that is not derived is no bound", () => {
    expect(copyBounds({ fileBytes: { status: "notYetDerived", value: 5, unit: "bytes" } }).blobBytes).toBeNull();
    expect(copyBounds({ fileBytes: { status: "derived", value: 5, unit: "bytes" } }).blobBytes).toEqual({
      name: "fileBytes",
      value: 5,
      unit: "bytes",
    });
  });
});

describe("m2: a whole-copy bound names what is over it and the way out", () => {
  it("a file over fileBytes outside the estate, with path the repository root", () => {
    const r = repo(["_estate/web-only"], (d) => {
      fs.mkdirSync(path.join(d, "docs"));
      fs.writeFileSync(path.join(d, "docs", "demo.mp4"), Buffer.alloc(20000, 0x61));
    });
    r.commitHead(() => {});
    const run = runOn(
      r,
      {},
      { copyBounds: { ...copyBounds(LIMITS), blobBytes: { name: "fileBytes", value: 10000, unit: "bytes" } } },
    );
    const lines = fenced(run.summaryFile);
    expect(lines[0]).toBe(
      "NOT CHECKED: the base commit is over a bound of the Action's copy: a file over fileBytes (10,000 bytes); with path the repository's root the whole tree is copied, so set the path input to the estate's directory and only what crankpath reads counts. This job is not green.",
    );
    expect(lines).toContain('  over the bound: path "docs/demo.mp4"  (20,000 bytes)');
  });
  it("too many bytes names the largest files, too many entries the top directories", () => {
    const r = repo(["_estate/web-only"], (d) => {
      fs.mkdirSync(path.join(d, "media"));
      fs.writeFileSync(path.join(d, "media", "a.bin"), Buffer.alloc(3000, 0x61));
    });
    const head = r.commitHead(() => {});
    const b = copyBounds(LIMITS);
    const bytes = copyCommitTree(
      r.dir,
      head,
      path.join(r.tmp, "c1"),
      { PATH: process.env.PATH, HOME: r.tmp },
      { ...b, totalBytes: { name: "fetchedRepoBytes", value: 2000, unit: "bytes" } },
    );
    expect(bytes).toMatchObject({ ok: false, why: "limit", limit: { name: "fetchedRepoBytes" } });
    expect((bytes as unknown as { over: unknown[] }).over[0]).toEqual({
      path: "media/a.bin",
      size: 3000,
      unit: "bytes",
    });
    const entries = copyCommitTree(
      r.dir,
      head,
      path.join(r.tmp, "c2"),
      { PATH: process.env.PATH, HOME: r.tmp },
      { ...b, entries: { name: "filesPerScan", value: 2, unit: "files" } },
    );
    expect(entries).toMatchObject({ ok: false, why: "limit", limit: { name: "filesPerScan" } });
    expect((entries as unknown as { over: { path: string }[] }).over.map((o) => o.path)).toContain("apps");
  });
  it("names at most the gap list's bound of paths, then a count", () => {
    const over = Array.from({ length: 30 }, (_, i) => ({
      path: `f${String(i).padStart(2, "0")}.bin`,
      size: 9,
      unit: "bytes",
    }));
    const nc = notCheckedResult([
      { side: "base", code: "copy-limit", limit: { name: "fileBytes", value: 1, unit: "bytes" }, over },
    ]);
    const lines = fenced(renderSummary(nc, CTX));
    expect(lines.filter((l) => l.startsWith("  over the bound: "))).toHaveLength(21);
    expect(lines).toContain("  and 9 more paths over the bound");
  });
});

describe("n1: the entries bound stops the parse of the listing early", () => {
  it("an unsafe entry past the bound is never reached: the bound is the reason", () => {
    const r = repo(["_estate/web-only"]);
    const blob = r.git(["hash-object", "-w", "--stdin"], "x\n");
    const bad = r.rawTree([{ mode: "100644", name: "x", oid: blob }]);
    const zz = r.rawTree([{ mode: "40000", name: ".GIT", oid: bad }]);
    const root = r.rawTree([
      { mode: "100644", name: "a", oid: blob },
      { mode: "100644", name: "b", oid: blob },
      { mode: "100644", name: "c", oid: blob },
      { mode: "40000", name: "zz", oid: zz },
    ]);
    const commit = r.git(["-c", "commit.gpgsign=false", "commit-tree", root, "-m", "c"]);
    const out = copyCommitTree(
      r.dir,
      commit,
      path.join(r.tmp, "c"),
      { PATH: process.env.PATH, HOME: r.tmp },
      { ...copyBounds(LIMITS), entries: { name: "filesPerScan", value: 2, unit: "files" } },
    );
    expect(out).toMatchObject({ ok: false, why: "limit", limit: { name: "filesPerScan" } });
  });
});
