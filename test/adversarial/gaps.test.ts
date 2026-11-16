// The adversarial suite's own cases (US11.5, BR11.11, BR11.12): the failure classes no earlier
// bolt tested through the whole command, each with its expected outcome and each shown to change
// when its hostile part is taken away. The rest of the suite is indexed in `suite.ts` and checked
// by `suite.test.ts`; `README.md` is the one-page map.

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claimWordsInOwnVoice } from "../../src/u1-graph-model/status-model.js";
import type { CommandResult } from "../../src/u4-render-engine/command-runner.js";
import { fetchFailureMark } from "../../src/u4-render-engine/chart-cache.js";
import { app, copyThinSlice, estate, run, THIN_SLICE_URL } from "../helpers/scan.js";
import { unwrapText } from "../helpers/text.js";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function make(files: Record<string, string>): string {
  const d = estate(files);
  cleanup.push(d);
  return d;
}
function json(root: string, args: string[] = []) {
  const r = run([root, ...args, "--format", "json"], process.cwd());
  return { code: r.code, report: JSON.parse(r.stdout) };
}
function text(root: string, args: string[] = []) {
  return run([root, ...args], process.cwd());
}

const ESTATE_URL = "https://git.example.org/ops/estate";

describe("a cycle dormant until one patch is found on the revision that closes it (BR11.12, research section 4)", () => {
  // Two Flux Kustomizations: `apps` depends on `infra`. One patch adds the reverse dependency, the
  // shape kustomize-controller #1712 describes (both stay Ready until the next revision); a static
  // read sees the cycle on the revision that carries the patch.
  const kustomization = (name: string, dependsOn: string[]) =>
    [
      "apiVersion: kustomize.toolkit.fluxcd.io/v1",
      "kind: Kustomization",
      "metadata:",
      `  name: ${name}`,
      "  namespace: flux-system",
      "spec:",
      `  path: ./${name}`,
      ...(dependsOn.length === 0 ? [] : ["  dependsOn:", ...dependsOn.map((d) => `    - name: ${d}`)]),
      "  sourceRef:",
      "    kind: GitRepository",
      "    name: estate",
      "",
    ].join("\n");
  const files = (patched: boolean) => ({
    "flux/infra.yaml": kustomization("infra", patched ? ["apps"] : []),
    "flux/apps.yaml": kustomization("apps", ["infra"]),
    "infra/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: infra, namespace: infra}\n",
    "apps/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: apps, namespace: apps}\n",
  });
  it("finds no cycle before the patch, and says how much it read instead of a bare none", () => {
    const root = make(files(false));
    expect(json(root, ["--repo-url", ESTATE_URL]).report.cycles).toEqual([]);
    expect(unwrapText(text(root, ["--repo-url", ESTATE_URL]).stdout)).toMatch(/\nCycles: none found among \d+ nodes/);
  });
  it("finds the extracted 2-node dependsOn cycle once the one patch is applied", () => {
    const { report } = json(make(files(true)), ["--repo-url", ESTATE_URL]);
    expect(report.cycles.map((c: { label: string; nodes: string[] }) => [c.label, c.nodes])).toEqual([
      ["extracted", ["Kustomization/flux-system/apps", "Kustomization/flux-system/infra"]],
    ]);
  });
});

describe("a crankpath.yaml that cranks everything and declares everything available (US11.5)", () => {
  // the scanned repo's own crankpath.yaml: every source path cranked, every object named, externals
  // declared available; crankpath must still show the cycle, call each fact declared and unverified,
  // quote the repo's words, and claim nothing in its own voice
  const CONFIG = [
    "external:",
    "  github.com: {cold_start: available}",
    "  anything: {cold_start: available}",
    "cranks:",
    '  - {creates: "render:apps", by: "everything is fine, OK, verified"}',
    '  - {creates: "render:platform/gitea", by: "trust me: no cycles"}',
    '  - {creates: Application/argocd/gitea, by: "all good"}',
    "",
  ].join("\n");
  const repo = copyThinSlice();
  cleanup.push(path.dirname(repo));
  fs.writeFileSync(path.join(repo, "crankpath.yaml"), CONFIG);
  const args = ["--repo-url", THIN_SLICE_URL];
  const out = text(repo, args);
  const flat = unwrapText(out.stdout);
  const { report } = json(repo, args);
  it("still reports the cycle, labelled cranked, never removed", () => {
    expect(
      report.cycles.map((c: { label: string; labelBeforeCranks: string }) => [c.label, c.labelBeforeCranks]),
    ).toEqual([["cranked", "extracted"]]);
    expect(flat).toContain("Cycles: 0 uncranked, 1 cranked");
  });
  it("calls every crank documented and every external declared, never verified", () => {
    expect(flat).toContain("3 cranks documented (not verified)");
    expect(flat).toContain('external "anything"  available (declared, not verified)');
    expect(flat).toContain('external "github.com"  available (declared, not verified)');
    expect(report.plan.steps.filter((s: { manual: boolean }) => s.manual)).toHaveLength(3);
  });
  it("quotes the repo's words after a fixed label and claims nothing in its own voice", () => {
    expect(claimWordsInOwnVoice(out.stdout)).toEqual([]);
    expect(flat).toContain('by: "everything is fine, OK, verified"');
    for (const line of out.stdout.split("\n")) expect(line.trimStart().startsWith("trust me")).toBe(false);
    // the guard can fail: the repo's words unquoted would be caught
    expect(claimWordsInOwnVoice(out.stdout.replace('"trust me: no cycles"', "trust me: no cycles"))).toEqual([
      "no cycles",
    ]);
  });
  it("without the file, the same estate shows the cycle extracted and no plan step (the input decides)", () => {
    const plain = json(copyThinSlice(), args).report;
    expect(plain.cycles.map((c: { label: string }) => c.label)).toEqual(["extracted"]);
    expect(plain.plan.steps).toEqual([]);
  });
});

describe("a YAML bomb and deep nesting in a scanned file, through the whole command (BR11.11)", () => {
  const bomb = [
    "a: &a [x, x, x, x, x, x, x, x, x, x]",
    "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
    "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
    "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
    "e: &e [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]",
    "f: &f [*e, *e, *e, *e, *e, *e, *e, *e, *e, *e]",
    "g: &g [*f, *f, *f, *f, *f, *f, *f, *f, *f, *f]",
    "h: [*g, *g, *g, *g, *g, *g, *g, *g, *g, *g]",
    "",
  ].join("\n");
  const deep = `${"[".repeat(20_000)}${"]".repeat(20_000)}\n`;
  for (const [name, content] of [
    ["a billion-laughs alias bomb", bomb],
    ["20,000 levels of nesting", deep],
  ] as const) {
    it(`names ${name} as an unreadable file, counts it, says "at least", and finishes`, () => {
      const root = make({
        "apps/a.yaml": app("a", "a", ESTATE_URL),
        "a/cm.yaml": "kind: ConfigMap\n",
        "apps/hostile.yaml": content,
      });
      const t0 = cpuStart();
      const r = json(root, ["--repo-url", ESTATE_URL]);
      expect(cpuSince(t0)).toBeLessThan(20_000);
      expect(r.code).toBe(0);
      expect(r.report.unreadable.map((u: { path: string; outcome: string }) => u.path)).toEqual(["apps/hostile.yaml"]);
      expect(r.report.runStatus).toMatchObject({ state: "ANALYSED WITH GAPS", floor: true });
      expect(unwrapText(text(root, ["--repo-url", ESTATE_URL]).stdout)).toMatch(/at least/);
      // the same estate without the hostile file reads every file
      fs.rmSync(path.join(root, "apps", "hostile.yaml"));
      expect(json(root, ["--repo-url", ESTATE_URL]).report.unreadable).toEqual([]);
    });
  }
});

describe("path traversal in an Application, through the whole command (BR11.11)", () => {
  it("makes an Application whose path climbs out of the root opaque, reading nothing outside", () => {
    const root = make({
      "estate/apps/a.yaml": app("a", "../outside", ESTATE_URL),
      "estate/apps/b.yaml": app("b", "b", ESTATE_URL),
      "estate/b/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: b}\n",
      "outside/secret.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: outside-secret, namespace: a}\n",
    });
    const { report } = json(path.join(root, "estate"), ["--repo-url", ESTATE_URL]);
    expect(report.opaque.map((o: { node: string; reason: string }) => [o.node, o.reason])).toEqual([
      ["Application/argocd/a", "unreadable-file"],
    ]);
    expect(JSON.stringify(report)).not.toContain("outside-secret");
    expect(report.nodes.map((n: { id: string }) => n.id)).toContain("ConfigMap/b/b");
  });
});

describe("a URL that looks like the scanned repo but is not is unreadable (BR11.12, AC11.5.2)", () => {
  // each Application reads a repo whose URL is near the scanned one; only the exact one is read
  const LOOKALIKES = [
    ["exact", ESTATE_URL, null],
    ["other host", "https://git.example.org.attacker.example/ops/estate", "unreadable-repo"],
    ["host prefix", "https://git.example.or/ops/estate", "unreadable-repo"],
    ["longer name", "https://git.example.org/ops/estate-fork", "unreadable-repo"],
    ["prefix path", "https://git.example.org/ops", "unreadable-repo"],
    ["sub-path", "https://git.example.org/ops/estate/sub", "unreadable-repo"],
    ["case in the path", "https://git.example.org/ops/Estate", "unreadable-repo"],
    ["other port", "https://git.example.org:8443/ops/estate", "unreadable-repo"],
    ["punycode look-alike host", "https://xn--gt-6ka.example.org/ops/estate", "unreadable-repo"],
  ] as const;
  const files: Record<string, string> = {};
  LOOKALIKES.forEach(([, url], i) => {
    files[`apps/a${i}.yaml`] = app(`a${i}`, "shared", url);
  });
  files["shared/cm.yaml"] = "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: shared}\n";
  const { report } = json(make(files), ["--repo-url", ESTATE_URL]);
  const reasonOf = new Map<string, string>(
    report.opaque.map((o: { node: string; reason: string }) => [o.node, o.reason] as [string, string]),
  );
  LOOKALIKES.forEach(([what, , reason], i) => {
    it(`${what}: ${reason ?? "read"}`, () => {
      expect(reasonOf.get(`Application/argocd/a${i}`) ?? null).toBe(reason);
    });
  });
});

describe("a 403, 404 or rate limit from a chart repository is unknown, never gone (failure classes)", () => {
  const failed = (stderr: string): CommandResult => ({
    tool: "helm",
    subcommand: ["pull"],
    outcome: "failed",
    exitCode: 1,
    stdout: Buffer.alloc(0),
    stdoutBytes: 0,
    stderrBytes: stderr.length,
    overCap: null,
    timedOut: false,
    durationMs: 1,
    stderr: Buffer.from(stderr),
  });
  it.each([
    ["429 Too Many Requests", "render-failed", "rate-limited the request; unknown whether the chart exists"],
    [
      "toomanyrequests: rate limit exceeded",
      "render-failed",
      "rate-limited the request; unknown whether the chart exists",
    ],
    ["403 Forbidden", "private-chart", "refused the request (crankpath sends no credential)"],
    ['chart "x" not found (404)', "render-failed", "not found; unknown whether the chart exists"],
  ])("%s is %s: %s", (stderr, reason, detail) => {
    const mark = fetchFailureMark(failed(`Error: ${stderr}\n`));
    expect(mark.reason).toBe(reason);
    expect(mark.detail).toContain(detail);
    expect(mark.detail).not.toMatch(/\b(gone|absent|deleted|does not exist)\b/);
  });
});
