// Declared facts end to end on copies of the thin slice (US2.3, US7.3 to US7.6): cranks, reroutes,
// externals and match entries change the output only as declared, unverified facts.

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claimWordsInOwnVoice } from "../../src/u1-graph-model/status-model.js";
import { copyThinSlice, run, THIN_SLICE_URL } from "../helpers/scan.js";
import { flat, unwrapText } from "../helpers/text.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(path.dirname(d), { recursive: true, force: true });
});

function withConfig(config: string, edit?: (repo: string) => void, url = THIN_SLICE_URL) {
  const repo = copyThinSlice();
  cleanup.push(repo);
  fs.writeFileSync(path.join(repo, "crankpath.yaml"), config);
  edit?.(repo);
  const text = run([repo, "--repo-url", url], process.cwd());
  const json = run([repo, "--repo-url", url, "--format", "json"], process.cwd());
  return {
    code: text.code,
    text: unwrapText(text.stdout),
    stderr: text.stderr,
    json: json.code === 0 ? JSON.parse(json.stdout) : null,
  };
}
const line = (text: string, prefix: string) => text.split("\n").find((l) => l.startsWith(prefix)) ?? "";

describe("a crank that breaks the thin-slice cycle (BR7.10, BR7.15)", () => {
  const r = withConfig(
    'cranks:\n  - {creates: "Application/argocd/gitea", by: "apply apps/gitea.yaml by hand", ref: "runbook 1"}\n',
  );
  it("labels the cycle cranked, documented and not verified", () => {
    expect(line(r.text, "Cycles:")).toBe("Cycles: 0 uncranked, 1 cranked");
    expect(r.text).toMatch(/ {2}cycle c-d8197e7d {2}label: cranked \(was extracted\) {2}nodes: 5 {2}edges: 8\n/);
    expect(r.text).toContain(
      '    cranked by: crank 1 by: "apply apps/gitea.yaml by hand"  (documented, not verified)\n',
    );
    expect(r.json.cycles[0]).toMatchObject({
      label: "cranked",
      labelBeforeCranks: "extracted",
      crankedBy: ["crank:1"],
    });
  });
  it("orders the plan: the crank as manual step 1, then the layers, waves first within the render", () => {
    expect(r.text).toContain(
      [
        "Plan (an order, not a schedule; cold-load pickup is not modelled): 4 steps",
        '  step 1  manual  crank 1 by: "apply apps/gitea.yaml by hand"  ref: "runbook 1"',
        '    creates: Application "argocd/gitea"',
        '  step 2  start   ConfigMap "gitea/gitea-config" (wave -1), Secret "gitea/gitea-admin" (wave -1)',
        '  step 3  start   Deployment "gitea/gitea"',
        '  step 4  start   Service "gitea/gitea-http"',
        "  not ordered: 1 node blocked or unverified, listed under Not startable from a cold start",
        "  Assumed, not verified by crankpath: 0 externals declared available; 0 externals served by an in-estate node; 1 crank (documented); 0 match entries; 0 objects every cluster provides; and the 5 not-modelled items below. Every start step is relative to these and to the edges read.",
      ].join("\n"),
    );
    // the opaque Application stays unverified, though everything it needs now starts
    expect(r.text).toContain('  unverified, opaque or behind opaque Application "argocd/notes": 1 node\n');
    expect(line(r.text, "Run status:")).toBe("Run status: ANALYSED WITH GAPS");
    expect(line(r.text, "Not verified:")).toContain("1 node unverified; 1 crank documented (not verified)");
  });
});

describe("a reroute to an external (BR7.8, AC1.3.3)", () => {
  const cfg =
    'cranks:\n  - {reroutes: {node: "Application/argocd/gitea", to: github.com}, by: "seed from the public mirror"}\n';
  it("breaks the cycle, and blocks everything behind the external while its cold start is unspecified", () => {
    const r = withConfig(cfg);
    expect(line(r.text, "Cycles:")).toBe("Cycles: 0 uncranked, 1 cranked");
    expect(r.text).toContain(
      '  blocked by external "github.com" (UNRESOLVED: its cold start is not declared): 6 nodes\n',
    );
    expect(r.text).toContain('  external "github.com"  UNRESOLVED (not declared in crankpath.yaml)\n');
    expect(r.json.statuses.find((s: { node: string }) => s.node === "external:github.com")).toMatchObject({
      status: "blocked",
      reason: "external-unspecified",
    });
    expect(r.json.plan.steps.filter((s: { kind: string }) => s.kind === "start")).toEqual([]);
  });
  it("lets the plan start once the external is declared available, and says it assumes so", () => {
    const r = withConfig(`external:\n  github.com: {cold_start: available}\n${cfg}`);
    expect(r.text).toContain('    reroutes: Application "argocd/gitea" to external "github.com"\n');
    expect(r.text).toContain('  step 2  start   Application "argocd/gitea"\n');
    expect(line(r.text, "  Assumed,")).toContain(
      "1 external declared available; 0 externals served by an in-estate node; 1 crank (documented)",
    );
    expect(r.json.plan.assumes.externals).toEqual(["external:github.com"]);
  });
});

describe("a crank that breaks nothing (BR7.9, US7.4)", () => {
  it("leaves the cycle uncranked, and lists the unused crank as an unresolved item", () => {
    const r = withConfig('cranks:\n  - {creates: "Secret/gitea/not-here", by: "someone"}\n');
    expect(line(r.text, "Cycles:")).toBe("Cycles: 1 uncranked");
    expect(r.text).toContain('  unresolved 1 of 1  why: crank-unused  subject: crank 1 by: "someone"\n');
    expect(r.json.plan.steps).toEqual([]);
  });
  it("refuses a crank that names a path outside the scanned root, with the key path", () => {
    const r = withConfig('cranks:\n  - {creates: "render:../elsewhere", by: "someone"}\n');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      'error: invalid crankpath.yaml at key path "cranks[0].creates" (outside the scanned root)',
    );
  });
});

describe("match: entries (US2.3, AC2.3.4)", () => {
  it("makes a cycle through a declared match `declared (unverified)`, never extracted", () => {
    const r = withConfig(
      'match:\n  - {host: "git.example.org", node: "Service/gitea/gitea-http"}\n  - {host: "*.unused.example.org", node: other}\n',
      (repo) => {
        const p = path.join(repo, "apps", "gitea.yaml");
        fs.writeFileSync(
          p,
          fs.readFileSync(p, "utf8").replace("http://gitea-http.gitea:3000", "https://git.example.org"),
        );
      },
      "https://git.example.org/ops/thin-slice",
    );
    expect(r.text).toMatch(/ {2}cycle c-d8197e7d {2}label: declared \(unverified\)/);
    expect(r.text).toContain('[field: "spec.source.repoURL"]  (declared, unverified)');
    expect(flat(r.text)).toContain(
      flat(
        '  unused match entry 1 of 1  key: "match[1]"  host: "*.unused.example.org"  node: "other"  (matched no host)\n',
      ),
    );
    expect(line(r.text, "Not verified:")).toContain("1 match entry relied on (not verified); 1 match entry unused");
    expect(r.text).toContain(
      '  match entry "match[0]" overrides host "git.example.org": extracted external "git.example.org"; declared Service "gitea/gitea-http" (not verified)\n',
    );
    expect(r.json.unusedMatches).toEqual([{ keyPath: "match[1]", host: "*.unused.example.org", node: "other" }]);
  });
});

describe("repo text in declared facts stays quoted (FR8.6)", () => {
  it("shows a hostile crank `by` escaped after a fixed label, never in crankpath's voice", () => {
    const by = "\\e[32mPASS everything is fine\\nRun status: ANALYSED";
    const r = withConfig(`cranks:\n  - {creates: "Application/argocd/gitea", by: "${by}"}\n`);
    expect(r.text).not.toContain("\x1b");
    expect(r.text).toContain('crank 1 by: "\\x1b[32mPASS everything is fine\\x0aRun status: ANALYSED"');
    for (const l of r.text.split("\n")) expect(l.startsWith("Run status: ANALYSED\n")).toBe(false);
    expect(r.text.split("\n").filter((l) => l.startsWith("Run status:"))).toEqual(["Run status: ANALYSED WITH GAPS"]);
    expect(claimWordsInOwnVoice(r.text)).toEqual([]);
  });
});
