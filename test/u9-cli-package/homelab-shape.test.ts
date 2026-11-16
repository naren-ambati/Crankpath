// The homelab shape (B3 definition of done): a root ApplicationSet whose git generator reads an
// in-cluster forge. Without a declared repo identity it is opaque `unreadable-repo` with the
// suggested `repos:` entry (M3); with exactly one `--repo-alias` (and no declared edge) both cycles
// are found from extracted edges: the forge serves the repository its own ApplicationSet reads
// (cycle 1), and the ApplicationSet generates the Application that deploys it (cycle 2). The
// opacity lines and the cycle sets were written before the first run; the whole expected files are
// that first run, reviewed (BUILD-NOTES, B3).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { claimWordsInOwnVoice } from "../../src/u1-graph-model/status-model.js";
import { flat, run, tempDir } from "../helpers/scan.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/homelab-shape/", import.meta.url));
const REPO = path.join(FIXTURE, "repo");
const FORGE = "http://gitea-http.gitea:3000/ops/homelab";
const SELF = ["--repo-url", "https://git.example.org/ops/homelab"];
const ALIAS = ["--repo-alias", `${FORGE}=.`];
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

function expected(name: string): string {
  return fs.readFileSync(path.join(FIXTURE, name), "utf8");
}
function json(args: readonly string[], cwd = REPO) {
  const r = run([".", ...args, "--format", "json"], cwd);
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  return JSON.parse(r.stdout);
}
function copy(): string {
  const dir = tempDir("homelab");
  cleanup.push(dir);
  fs.cpSync(REPO, path.join(dir, "repo"), { recursive: true });
  return path.join(dir, "repo");
}
type E = { from: string; kind: string; to: string };
const key = (e: E) => `${e.from} ${e.kind} ${e.to}`;

const CYCLE_1 = [
  "ApplicationSet/argocd/root reads-source Service/gitea/gitea-http",
  "Service/gitea/gitea-http selects Deployment/gitea/gitea",
  "Deployment/gitea/gitea deployed-by Application/argocd/gitea",
  "Application/argocd/gitea generated-by ApplicationSet/argocd/root",
];
const CYCLE_2 = [
  "Application/argocd/argocd generated-by ApplicationSet/argocd/root",
  "ApplicationSet/argocd/root deployed-by Application/argocd/argocd",
];

describe("homelab shape without the alias (M3)", () => {
  it("shows the ApplicationSet opaque unreadable-repo with the suggested entry, never applied", () => {
    const r = run([".", ...SELF], REPO);
    expect(r.code).toBe(0);
    // written before the first run
    expect(flat(r.stdout)).toContain(
      flat(
        [
          '  opaque 1 of 1  node: ApplicationSet "argocd/root"  reason: unreadable-repo',
          "    could not see: Applications generated from its git generator",
          `    field: "spec.generators[0].git.repoURL"  value: "${FORGE}"  (not this repository and not mapped)`,
          `    suggested repos entry (not applied): "${FORGE}": {read_from: .}`,
        ].join("\n"),
      ),
    );
    expect(flat(r.stdout)).toMatch(/Opacity: at least 1 of 1 source opaque .*1 ApplicationSet is not expanded/);
    expect(r.stdout).toBe(expected("expected-without-alias.txt"));
    expect(claimWordsInOwnVoice(r.stdout)).toEqual([]);
  });
  it("generates nothing it cannot read, and says the counts are a floor", () => {
    const report = json(SELF);
    expect(report.runStatus.floor).toBe(true);
    expect(report.nodes.filter((n: { kind: string }) => n.kind === "Application")).toEqual([]);
    expect(report.cycles).toEqual([]);
    const o = report.opaque.find((x: { node: string }) => x.node === "ApplicationSet/argocd/root");
    expect(o).toMatchObject({ reason: "unreadable-repo", suggestion: { url: FORGE, readFrom: "." } });
  });
});

describe("homelab shape with exactly one alias and no declared edges (B3 definition of done)", () => {
  it("prints the expected text, exit 0", () => {
    const r = run([".", ...SELF, ...ALIAS], REPO);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(expected("expected-with-alias.txt"));
    expect(claimWordsInOwnVoice(r.stdout)).toEqual([]);
  });
  it("finds both cycles from extracted edges in one strongly connected component", () => {
    const report = json([...SELF, ...ALIAS]);
    expect(report.cycles).toHaveLength(1);
    const c = report.cycles[0];
    expect(c.label).toBe("extracted");
    expect(c.nodes).toEqual([
      "Application/argocd/argocd",
      "Application/argocd/gitea",
      "ApplicationSet/argocd/root",
      "Deployment/gitea/gitea",
      "Service/gitea/gitea-http",
    ]);
    const keys = c.edges.map(key);
    expect(keys).toEqual(expect.arrayContaining([...CYCLE_1, ...CYCLE_2]));
    for (const e of c.edges) expect(e.source).toBe("extracted");
    expect(report.runStatus.counts.edgesDeclared).toBe(0);
    expect(report.runStatus.counts.declaredFacts).toBe(0);
  });
  it("generates one Application per matching directory, each generated by the ApplicationSet", () => {
    const report = json([...SELF, ...ALIAS]);
    const apps = report.nodes
      .filter((n: { kind: string }) => n.kind === "Application")
      .map((n: { id: string }) => n.id);
    expect(apps).toEqual(["Application/argocd/argocd", "Application/argocd/gitea", "Application/argocd/notes"]);
    const generated = report.edges.filter((e: E) => e.kind === "generated-by").map(key);
    expect(generated).toEqual(apps.map((a: string) => `${a} generated-by ApplicationSet/argocd/root`));
    for (const n of report.nodes.filter((x: { kind: string }) => x.kind === "Application")) {
      expect(n.origin.renderJob).toBe("generator:ApplicationSet/argocd/root");
    }
    expect(report.repoMappings).toEqual([
      { commit: null, failure: null, floating: false, from: "--repo-alias", root: ".", url: FORGE, used: true },
    ]);
  });
  it("is the same from another working directory (the alias path names the scanned root)", () => {
    const here = json([...SELF, ...ALIAS]);
    const other = run([REPO, ...SELF, "--repo-alias", `${FORGE}=${REPO}`, "--format", "json"], process.cwd());
    expect(other.code).toBe(0);
    expect(JSON.parse(other.stdout).cycles).toEqual(here.cycles);
  });
});

describe("homelab shape: mutations change the result (no invented edges)", () => {
  it("without the forge's Service, cycle 1 is gone and cycle 2 stays", () => {
    const repo = copy();
    fs.rmSync(path.join(repo, "platform", "gitea", "service.yaml"));
    const report = json([...SELF, ...ALIAS], repo);
    expect(report.cycles).toHaveLength(1);
    expect(report.cycles[0].nodes).toEqual(["Application/argocd/argocd", "ApplicationSet/argocd/root"]);
    expect(report.cycles[0].edges.map(key).sort()).toEqual([...CYCLE_2].sort());
  });
  it("excluding system/argocd from the generator removes cycle 2", () => {
    const repo = copy();
    const file = path.join(repo, "system", "argocd", "root.yaml");
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace(
          "          - path: apps/*\n",
          "          - path: apps/*\n          - path: system/argocd\n            exclude: true\n",
        ),
    );
    const report = json([...SELF, ...ALIAS], repo);
    const keys = report.cycles.flatMap((c: { edges: E[] }) => c.edges.map(key));
    expect(keys).toEqual(expect.arrayContaining(CYCLE_1));
    for (const k of CYCLE_2) expect(keys).not.toContain(k);
    expect(report.nodes.map((n: { id: string }) => n.id)).not.toContain("Application/argocd/argocd");
  });
  it("a look-alike alias URL maps nothing: the ApplicationSet stays unreadable", () => {
    for (const lookAlike of [
      "http://gitea-http.gitea:3000/ops/homelab-fork",
      "http://gitea-http.gitea:3000/Ops/homelab",
      "http://gitea-http.gitea:3001/ops/homelab",
      "http://gitea-http.gitea.example.org:3000/ops/homelab",
      "http://gitea-http.gitea:3000/ops",
    ]) {
      const report = json([...SELF, "--repo-alias", `${lookAlike}=.`]);
      const o = report.opaque.find((x: { node: string }) => x.node === "ApplicationSet/argocd/root");
      expect(o?.reason, lookAlike).toBe("unreadable-repo");
      expect(report.cycles, lookAlike).toEqual([]);
      expect(report.repoMappings[0].used, lookAlike).toBe(false);
    }
  });
});
