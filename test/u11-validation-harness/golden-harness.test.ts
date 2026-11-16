// GoldenHarness and MutationChecker offline (US11.2, US11.3, US11.6; C11; BR11.5, BR11.14): every
// golden case that needs neither helm nor the network is compared with its expected output and its
// mutations are run, through the same code as `npm run verify:golden`; every other case is skipped
// here with its reason, and a skip is never counted as a pass. The harness itself is shown to fail:
// a changed expected file, a mutation that changes nothing, an unmet expectation, a missing pin.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  cacheRoot,
  checkCase,
  foreignStrings,
  GOLDEN_DIR,
  headline,
  laneExit,
  listCases,
  loadCase,
  probeEnvironment,
  ROOT,
  reduce,
  skipReason,
  summaryText,
} from "../../scripts/golden-lib.mjs";
import { HOSTILE_STRINGS } from "../helpers/fixture-kit.js";

const NODE_ONLY = path.dirname(process.execPath);
// node only, no network probe: what the offline lane sees on every machine
const OFFLINE = probeEnvironment({ searchPath: NODE_ONLY, offline: true });
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function temp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `crankpath-golden-${prefix}-`));
  cleanup.push(d);
  return d;
}

/** A copy of the thin-slice case in a scratch golden folder, with its expected files beside it. */
function scratchThinSlice(edit: (c: Record<string, unknown>) => void = () => {}): { dir: string; caseDir: string } {
  const dir = temp("cases");
  const caseDir = path.join(dir, "thin-slice");
  fs.mkdirSync(caseDir);
  const c = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, "thin-slice", "input.json"), "utf8"));
  for (const f of ["expected.json", "expected.txt"])
    fs.copyFileSync(path.join(ROOT, c.expectedDir, f), path.join(caseDir, f));
  delete c.expectedDir;
  edit(c);
  fs.writeFileSync(path.join(caseDir, "input.json"), JSON.stringify(c, null, 2));
  return { dir, caseDir };
}

describe("the golden cases (C11)", () => {
  const ids = listCases();
  it("are the Vault goldens before and after the edits, and the thin slice", () => {
    expect(ids).toEqual(expect.arrayContaining(["thin-slice", "vault", "vault-edited"]));
  });
  it("each has an input manifest that loads, and a reviewed.md once it is pinned", () => {
    for (const id of ids) {
      const c = loadCase(id);
      expect(c.case).toBe(id);
      const exp = c.expectedDir === undefined ? path.join(GOLDEN_DIR, id) : path.join(ROOT, c.expectedDir);
      if (fs.existsSync(path.join(exp, "expected.json")))
        expect(fs.existsSync(path.join(GOLDEN_DIR, id, "reviewed.md")), `${id}: pinned without reviewed.md`).toBe(true);
      expect(c.mutations.length, `${id}: every golden declares mutations`).toBeGreaterThan(0);
    }
  });
  for (const id of ids) {
    const c = loadCase(id);
    const skip = skipReason(c, OFFLINE);
    if (skip === null) {
      it(`${id}: matches its expected output, and every declared mutation changes the result`, () => {
        const results = checkCase(id, { cache: temp("cache"), env: OFFLINE });
        expect(results.map((r) => [r.result, r.name, r.why]).filter(([r]) => r !== "PASS")).toEqual([]);
        expect(results.length).toBe(1 + c.mutations.length);
      });
    } else {
      // reported by vitest as skipped, never as passed; `npm run verify:golden` runs it
      it.skip(`${id}: needs ${c.needs.join(", ")} (${skip}); run by npm run verify:golden`, () => {});
    }
  }
});

describe("the harness can fail (US11.6)", () => {
  it("fails when the expected text differs from the run, naming the first differing line", () => {
    const { dir, caseDir } = scratchThinSlice();
    const f = path.join(caseDir, "expected.txt");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("Run status:", "Run state:"));
    const [first] = checkCase("thin-slice", { cache: temp("cache"), env: OFFLINE, dir });
    expect(first).toMatchObject({ result: "FAIL", name: "thin-slice: expected output" });
    expect(first?.why).toMatch(/^expected\.txt differs at line \d+: expected "Run state:/);
  });
  it("names the counts that differ and the run's timeouts and opaque outcomes, and keeps the failed output (review m7)", () => {
    const { dir, caseDir } = scratchThinSlice();
    const f = path.join(caseDir, "expected.json");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"edgesExtracted": 9,', '"edgesExtracted": 10,'));
    const cache = temp("cache");
    const [first] = checkCase("thin-slice", { cache, env: OFFLINE, dir });
    expect(first?.result).toBe("FAIL");
    expect(first?.why).toContain("counts that differ: edgesExtracted 10 expected, 9 in this run");
    expect(first?.why).toContain("this run: timeouts 0; opaque by reason unreadable-file 1");
    expect(first?.why).toMatch(/outputs kept in the golden cache as runs\/thin-slice\/failed-1\./);
    expect(fs.existsSync(path.join(cache, "runs", "thin-slice", "failed-1.json"))).toBe(true);
  });
  it("fails a case that is not pinned, and refuses to pin one without a recorded review", () => {
    const { dir, caseDir } = scratchThinSlice();
    fs.rmSync(path.join(caseDir, "expected.json"));
    const cache = temp("cache");
    expect(checkCase("thin-slice", { cache, env: OFFLINE, dir })[0]).toMatchObject({
      result: "FAIL",
      why: "not pinned: the expected files are missing",
    });
    expect(checkCase("thin-slice", { cache, env: OFFLINE, dir, mode: "pin" })).toEqual([
      expect.objectContaining({ result: "FAIL", why: expect.stringContaining("reviewed.md is missing") }),
    ]);
    expect(fs.existsSync(path.join(caseDir, "expected.json"))).toBe(false);
    // a review recorded as pending is no review
    fs.writeFileSync(path.join(caseDir, "reviewed.md"), "# Review\n\n## Lead's review\nPending.\n");
    expect(checkCase("thin-slice", { cache, env: OFFLINE, dir, mode: "pin" })[0]?.why).toBe(
      "refused: reviewed.md records the review as pending",
    );
    expect(fs.existsSync(path.join(caseDir, "expected.json"))).toBe(false);
    // a review that names no reviewed output does not bind the pin (review m5)
    fs.writeFileSync(path.join(caseDir, "reviewed.md"), "# Review\n\n## Lead's review\nReviewed.\n");
    expect(checkCase("thin-slice", { cache, env: OFFLINE, dir, mode: "pin" })[0]?.why).toBe(
      "refused: reviewed.md records no sha-256 of the reviewed expected.json and expected.txt",
    );
    // observe prints the digests of the output a pin would write; the review records them
    const seen = checkCase("thin-slice", { cache, env: OFFLINE, dir, mode: "observe" })[0]?.why ?? "";
    const json = /expected\.json sha-256: ([0-9a-f]{64})/.exec(seen)?.[1];
    const txt = /expected\.txt sha-256: ([0-9a-f]{64})/.exec(seen)?.[1];
    expect(json).toMatch(/^[0-9a-f]{64}$/);
    // a digest of other output is refused (the run differs from the one reviewed)
    fs.writeFileSync(
      path.join(caseDir, "reviewed.md"),
      `# Review\n\nexpected.json sha-256: ${"0".repeat(64)}\nexpected.txt sha-256: ${txt}\n`,
    );
    expect(checkCase("thin-slice", { cache, env: OFFLINE, dir, mode: "pin" })[0]?.why).toBe(
      "refused: this run's expected.json differs from the reviewed one (sha-256)",
    );
    expect(fs.existsSync(path.join(caseDir, "expected.json"))).toBe(false);
    // the reviewed digests pin, and the pin then passes
    fs.writeFileSync(
      path.join(caseDir, "reviewed.md"),
      `# Review\n\nexpected.json sha-256: ${json}\nexpected.txt sha-256: ${txt}\n`,
    );
    expect(checkCase("thin-slice", { cache, env: OFFLINE, dir, mode: "pin" })[0]?.result).toBe("OBSERVED");
    expect(checkCase("thin-slice", { cache, env: OFFLINE, dir })[0]?.result).toBe("PASS");
  });
  it("fails a mutation that leaves the result unchanged, and one that misses what it declares", () => {
    const { dir } = scratchThinSlice((c) => {
      c.mutations = [
        {
          id: "touch-readme",
          kind: "a change that is no mutation",
          why: "a README is not an edge source",
          edits: [{ op: "replace", path: "repo/README.md", from: "Thin-slice fixture", to: "Thin slice fixture" }],
        },
        {
          id: "wrong-expectation",
          kind: "remove an edge source",
          why: "the cycle goes, but the case says it stays",
          edits: [{ op: "remove", path: "repo/platform/gitea/service.yaml" }],
          expect: { cycles: 1 },
        },
      ];
    });
    const results = checkCase("thin-slice", { cache: temp("cache"), env: OFFLINE, dir });
    expect(results.slice(1).map((r) => [r.result, r.why])).toEqual([
      ["FAIL", "a change that is no mutation: the result did not change, so this golden cannot fail on it"],
      ["FAIL", "remove an edge source: changed, but cycles: expected 1, got 0"],
    ]);
    expect(laneExit(results)).toBe(1);
  });
  it("fails a mutation whose edit does not apply, instead of running the unmutated input", () => {
    const { dir } = scratchThinSlice((c) => {
      c.mutations = [
        {
          id: "no-match",
          kind: "rename a node",
          why: "the text is not there",
          edits: [{ op: "replace", path: "repo/platform/gitea/service.yaml", from: "name: nowhere", to: "name: x" }],
        },
      ];
    });
    expect(checkCase("thin-slice", { cache: temp("cache"), env: OFFLINE, dir })[1]).toMatchObject({
      result: "FAIL",
      why: expect.stringContaining("replace must match exactly once"),
    });
  });
  it("adds a file of its own for a write edit, and refuses one that would overwrite a file", () => {
    const extra = "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: added, namespace: gitea}\n";
    const { dir } = scratchThinSlice((c) => {
      c.mutations = [
        {
          id: "write-new",
          kind: "add an object",
          why: "a new ConfigMap in the directory the Application deploys",
          edits: [{ op: "write", path: "repo/platform/gitea/added.yaml", content: extra }],
        },
        {
          id: "write-over",
          kind: "overwrite",
          why: "refused",
          edits: [{ op: "write", path: "repo/platform/gitea/service.yaml", content: extra }],
        },
      ];
    });
    const results = checkCase("thin-slice", { cache: temp("cache"), env: OFFLINE, dir });
    expect(results.slice(1).map((r) => r.result)).toEqual(["PASS", "FAIL"]);
    expect(results[2]?.why).toContain("write names a file that exists");
  });
  it("skips a case that needs helm or the network when they are absent, mutations too, and never passes", () => {
    const { dir } = scratchThinSlice((c) => {
      c.needs = ["helm", "network"];
      c.tools = { helm: "v4.3.2" };
    });
    const results = checkCase("thin-slice", { cache: temp("cache"), env: OFFLINE, dir });
    expect(results.map((r) => r.result)).toEqual(["SKIPPED", "SKIPPED", "SKIPPED", "SKIPPED"]);
    expect(results[0]?.why).toBe("helm not found on PATH; network not used (--offline)");
    expect(laneExit(results)).toBe(2);
    expect(laneExit([])).toBe(2);
    expect(laneExit([{ result: "OBSERVED", name: "x", why: "" }])).toBe(2);
  });
  it("skips a case reviewed with another helm version (its output may differ)", () => {
    const c = { ...loadCase("vault"), needs: ["helm"] };
    const env = { ...OFFLINE, helm: { ok: true, version: "v4.0.0", why: "" } };
    expect(skipReason(c, env)).toBe("helm v4.0.0 is not v4.3.2, the version the expected output was reviewed with");
  });
});

describe("case manifests are checked before anything runs", () => {
  function load(edit: (c: Record<string, unknown>) => void): () => unknown {
    const { dir } = scratchThinSlice(edit);
    return () => loadCase("thin-slice", dir);
  }
  it("refuses an abbreviated sha, a non-https or userinfo URL, a path that climbs out, and a fetch without network", () => {
    const fetch = (f: Record<string, unknown>) => (c: Record<string, unknown>) => {
      c.needs = ["git", "network"];
      c.fetch = [{ id: "x", url: "https://example.org/x", rev: "main", sha: "a".repeat(40), ...f }];
    };
    expect(load(fetch({ sha: "8b9d40f" }))).toThrow(/full 40-hex sha/);
    expect(load(fetch({ url: "http://example.org/x" }))).toThrow(/https without userinfo/);
    expect(load(fetch({ url: "https://user@example.org/x" }))).toThrow(/https without userinfo/);
    expect(load(fetch({ sparse: ["../x"] }))).toThrow(/bad sparse path/);
    expect(
      load((c) => {
        fetch({})(c);
        c.needs = [];
      }),
    ).toThrow(/a fetch needs git and network/);
    expect(load((c) => (c.input = { fixture: "../outside", scan: "repo" }))).toThrow(/fixture must be a repo path/);
    expect(load((c) => (c.input = { fixture: "test/fixtures/thin-slice", scan: "/etc" }))).toThrow(/bad input/);
    expect(load((c) => (c.mutations = [{ id: "m", edits: [] }]))).toThrow(/needs edits/);
    // a case that needs a tool names the version its output was reviewed with (review n1)
    expect(load((c) => (c.needs = ["helm"]))).toThrow(/names the helm version it was reviewed with/);
    expect(
      load((c) => {
        c.needs = ["helm"];
        c.tools = { helm: "v4.3.2" };
      }),
    ).not.toThrow();
  });
  it("refuses a golden cache inside the repository", () => {
    expect(() => cacheRoot({ CRANKPATH_GOLDEN_CACHE: path.join(ROOT, "cache") })).toThrow(/outside the repository/);
    expect(cacheRoot({ CRANKPATH_GOLDEN_CACHE: path.join(os.tmpdir(), "g") })).toBe(path.join(os.tmpdir(), "g"));
  });
});

describe("the reduced form holds node ids and counts only (m11)", () => {
  const report = JSON.parse(
    fs.readFileSync(path.join(ROOT, "test", "fixtures", "thin-slice", "expected.json"), "utf8"),
  );
  it("keeps no file, field, value, URL or name from the scanned repo", () => {
    expect(foreignStrings(report, reduce(report))).toEqual([]);
    const text = JSON.stringify(reduce(report)) + summaryText(reduce(report));
    for (const leak of ["gitea-http.gitea:3000", "apps/gitea.yaml", "spec.source", "fixture-value", "\\u001b", "main"])
      expect(text.includes(leak), leak).toBe(false);
  });
  it("would show a repo string that reached it, as a value or as a key, even one plain word (review m1)", () => {
    const planted = structuredClone(report);
    planted.opaque[0].reason = HOSTILE_STRINGS[0];
    expect(foreignStrings(planted, reduce(planted))).toEqual([HOSTILE_STRINGS[0]]);
    // a one-word field name from the repo, as a value and as a key of the reduced form
    const word = { ...reduce(report), leak: "spec" };
    expect(foreignStrings(report, word)).toEqual(["leak", "spec"]);
    const keyed = reduce(report) as unknown as { opaque: { byReason: Record<string, number> } };
    keyed.opaque.byReason.metadata = 1;
    expect(foreignStrings(report, keyed)).toEqual(["metadata"]);
  });
  it("is checked by the lane before a reduced case is compared or pinned", () => {
    const { dir, caseDir } = scratchThinSlice((c) => {
      c.form = "reduced";
    });
    // a reduced case of the thin slice pins and passes (nothing foreign in it)
    fs.writeFileSync(path.join(caseDir, "reviewed.md"), "# Review\n\nReviewed.\n");
    const cache = temp("cache");
    const pinned = checkCase("thin-slice", { cache, env: OFFLINE, dir, mode: "observe" });
    expect(pinned[0]?.result).toBe("OBSERVED");
    expect(pinned[0]?.why).not.toContain("not ids");
  });
  it("gives a headline a mutation's expectation is matched against", () => {
    expect(headline(reduce(report))).toEqual({
      state: "ANALYSED WITH GAPS",
      cycles: 1,
      uncranked: 1,
      cranked: 0,
      labels: ["extracted"],
      opaque: 1,
      externals: 0,
      planSteps: 0,
      firstStep: null,
      startable: 0,
      undeployedCharts: 0,
      cycleIds: ["c-d8197e7d"],
      opaqueNodes: ["Application/argocd/notes"],
    });
  });
});

describe("npm run verify:golden without helm or the network", () => {
  it("runs the offline cases, prints every other golden SKIPPED with its reason, and exits 2 (never a pass)", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "golden.mjs"), "--offline"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { PATH: NODE_ONLY, CRANKPATH_GOLDEN_CACHE: temp("lane") },
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("PASS  thin-slice: expected output");
    expect(r.stdout).toContain(
      "SKIPPED  vault: expected output  (helm not found on PATH; kustomize not found on PATH; git not found on PATH; network not used (--offline))",
    );
    expect(r.stdout).toMatch(/\ngolden lane: \d+ passed, 0 failed, \d+ skipped \(a skipped golden is not a pass\)\n$/);
    expect(r.stdout).not.toMatch(/^PASS {2}vault/m);
  });
});
