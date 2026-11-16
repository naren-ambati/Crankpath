// The thin slice end to end, in-process: the committed expected output byte for byte, a plain
// mutation that removes the cycle, determinism across runs, working directories and checkout
// locations, and the hostile-input rules on the real output.

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claimWordsInOwnVoice } from "../../src/u1-graph-model/status-model.js";
import { copyThinSlice, FIXTURE, run, THIN_SLICE_URL, tempDir } from "../helpers/scan.js";

const REPO = path.join(FIXTURE, "repo");
const ARGS = ["--repo-url", THIN_SLICE_URL];
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

function expected(name: "expected.txt" | "expected.json"): string {
  return fs.readFileSync(path.join(FIXTURE, name), "utf8");
}

describe("thin slice: the committed expected output (B1 definition of done)", () => {
  it("prints expected.txt byte for byte, exit 0", () => {
    const r = run([REPO, ...ARGS], process.cwd());
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(expected("expected.txt"));
  });
  it("prints expected.json byte for byte, exit 0", () => {
    const r = run([REPO, ...ARGS, "--format", "json"], process.cwd());
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(expected("expected.json"));
  });
  it("shows one uncranked extracted cycle with evidence on every edge", () => {
    const report = JSON.parse(run([REPO, ...ARGS, "--format", "json"], process.cwd()).stdout);
    expect(report.cycles).toHaveLength(1);
    expect(report.cycles[0].label).toBe("extracted");
    expect(report.cycles[0].crankedBy).toEqual([]);
    for (const e of report.edges) {
      expect(e.evidence.file.length * e.evidence.field.length * e.evidence.renderedPath.length).toBeGreaterThan(0);
    }
    // The three-edge Gitea path of the design is inside the component.
    const keys = report.cycles[0].edges.map(
      (e: { from: string; kind: string; to: string }) => `${e.from} ${e.kind} ${e.to}`,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "Application/argocd/gitea reads-source Service/gitea/gitea-http",
        "Service/gitea/gitea-http selects Deployment/gitea/gitea",
        "Deployment/gitea/gitea deployed-by Application/argocd/gitea",
      ]),
    );
  });
});

describe("thin slice: a mutation changes the output (B1, MutationChecker arrives in B7)", () => {
  it("removing the Service from a copy removes the cycle and changes both outputs", () => {
    const repo = copyThinSlice();
    cleanup.push(path.dirname(repo));
    fs.rmSync(path.join(repo, "platform", "gitea", "service.yaml"));
    const text = run([repo, ...ARGS], process.cwd());
    const json = JSON.parse(run([repo, ...ARGS, "--format", "json"], process.cwd()).stdout);
    expect(text.code).toBe(0);
    expect(text.stdout).not.toBe(expected("expected.txt"));
    expect(json.cycles).toEqual([]);
    expect(text.stdout).toContain(
      "Cycles: none found among 5 nodes and 5 edges read (1 node opaque, so cycles inside it cannot be seen; 2 unresolved items; 2 objects skipped)",
    );
    // The host may be in-cluster and now matches no Service: each Application that names it is listed.
    expect(text.stdout).toContain('  unresolved 1 of 2  why: host-unplaced  subject: Application "argocd/gitea"');
  });
  it("pointing the repoURL at a host no Service has removes the cycle", () => {
    const repo = copyThinSlice();
    cleanup.push(path.dirname(repo));
    const file = path.join(repo, "apps", "gitea.yaml");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("gitea-http.gitea:3000", "git.example.org"));
    const json = JSON.parse(run([repo, ...ARGS, "--format", "json"], process.cwd()).stdout);
    expect(json.cycles).toEqual([]);
    // The Application now names another repo: opaque, with a suggested entry (its last segment is
    // the scanned repo's name), which is not applied.
    const gitea = json.opaque.find((o: { node: string }) => o.node === "Application/argocd/gitea");
    expect(gitea).toMatchObject({
      reason: "unreadable-repo",
      suggestion: { url: "http://git.example.org/ops/thin-slice", readFrom: "." },
    });
    expect(json.nodes.filter((n: { origin: { renderJob: string | null } }) => n.origin.renderJob !== null)).toEqual([]);
  });
});

describe("thin slice: determinism (NFR2, BR8.2)", () => {
  it("gives byte-identical output twice", () => {
    const a = run([REPO, ...ARGS, "--format", "json"], process.cwd()).stdout;
    const b = run([REPO, ...ARGS, "--format", "json"], process.cwd()).stdout;
    expect(a).toBe(b);
  });
  it("gives identical JSON from another working directory and another checkout location", () => {
    const repo = copyThinSlice();
    cleanup.push(path.dirname(repo));
    const elsewhere = tempDir("cwd");
    cleanup.push(elsewhere);
    const here = run([REPO, ...ARGS, "--format", "json"], process.cwd()).stdout;
    const there = run([path.relative(elsewhere, repo), ...ARGS, "--format", "json"], elsewhere).stdout;
    const absolute = run([repo, ...ARGS, "--format", "json"], "/").stdout;
    expect(there).toBe(here);
    expect(absolute).toBe(here);
    for (const out of [here, there]) {
      expect(out).not.toContain(path.dirname(repo));
      expect(out).not.toContain(FIXTURE);
      expect(out).not.toMatch(/"\/(?:Users|home|tmp|private|var)\//);
    }
  });
});

describe("thin slice: hostile input (FR8.6, NFR4, BR1.3)", () => {
  const text = run([REPO, ...ARGS], process.cwd()).stdout;
  const lines = text.split("\n").filter((l) => l.length > 0);
  // crankpath's own first words; anything from the repo comes later on a line, quoted.
  const OWN = new Set([
    "crankpath",
    "toolchain:",
    "scanned:",
    "Run",
    "gaps:",
    "Opacity:",
    "found:",
    "opaque",
    "could",
    "field:",
    "skipped",
    "file:",
    "Cycles:",
    "cycle",
    "Application",
    "Service",
    "shortest",
    "Not",
    "unresolved",
    "External",
    "Plan",
    "blocked",
    "ConfigMap",
    "Deployment",
    "Secret",
    "Assumed,",
  ]);
  it("starts every line with crankpath's own words", () => {
    for (const line of lines) expect(OWN.has(line.trimStart().split(" ")[0] as string), line).toBe(true);
  });
  it("shows control characters as visible codes and never emits a raw one", () => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the test is about control characters
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(text).toContain('name: "gitea\\x1b[2J\\x1b[HRun status: ANALYSED"');
    expect(text).toContain('value: "docs\\x0aRun status: ANALYSED\\x0a\\x1b[32mPASS everything is fine\\x1b[0m"');
  });
  it("skips and names the name that would read as another node's id, and keeps the real node single", () => {
    const report = JSON.parse(run([REPO, ...ARGS, "--format", "json"], process.cwd()).stdout);
    expect(report.skipped.map((s: { name: string }) => s.name)).toContain("x/../../Service/gitea/gitea-http");
    const svc = report.nodes.filter((n: { id: string }) => n.id === "Service/gitea/gitea-http");
    expect(svc).toHaveLength(1);
    expect(svc[0].flags).toEqual([]);
  });
  it("never prints a Secret value", () => {
    for (const format of ["text", "json"]) {
      expect(run([REPO, ...ARGS, "--format", format], process.cwd()).stdout).not.toContain(
        "fixture-value-that-must-not-be-printed",
      );
    }
  });
  it("uses no claim word in its own voice while the run has gaps", () => {
    expect(claimWordsInOwnVoice(text)).toEqual([]);
    // the guard can fail: the same text with a claim in crankpath's voice is caught
    expect(claimWordsInOwnVoice(text.replace("Run status: ANALYSED WITH GAPS", "Run status: OK"))).toEqual(["OK"]);
  });
});
