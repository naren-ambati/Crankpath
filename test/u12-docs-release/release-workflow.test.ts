// The release workflow (.github/workflows/release.yml), held as a file the way a reader would check it: it
// runs only on a pushed v<major>.<minor>.<patch> tag, reads only, pins every action by full commit SHA (the
// same setup-node commit as the Action), runs the offline gate before it publishes, checks the tag against
// the version, and publishes with provenance. Nothing here runs the workflow or touches a network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  if?: string;
}
interface Workflow {
  on: Record<string, { tags?: string[]; branches?: string[] } | null>;
  permissions: Record<string, string>;
  jobs: Record<string, { permissions?: Record<string, string>; steps?: Step[]; env?: Record<string, string> }>;
}

/** The workflow's shape: what a release run would do. */
function shape(text: string) {
  const wf = parse(text) as Workflow;
  const body = text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n"); // the header comment names the triggers it excludes
  const job = wf.jobs.publish;
  const steps = job?.steps ?? [];
  return { wf, body, job, steps, runs: steps.map((s) => s.run ?? "") };
}

/** The four properties the "can fail" case breaks one at a time. */
function holds(text: string): boolean {
  const s = shape(text);
  return (
    JSON.stringify(s.wf.on) === JSON.stringify({ push: { tags: ["v[0-9]+.[0-9]+.[0-9]+"] } }) &&
    s.steps.every((st) => !st.uses || /@[0-9a-f]{40}$/.test(st.uses)) &&
    s.runs.some((r) => r.trim() === "npm ci --ignore-scripts && npm run verify") &&
    s.runs.at(-1) === "npm publish --provenance --access public"
  );
}

const TEXT = read(".github/workflows/release.yml");
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const SETUP_NODE = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1";

describe("the release workflow", () => {
  const { wf, body, job, steps, runs } = shape(TEXT);

  it("is the only workflow and runs on a pushed v<major>.<minor>.<patch> tag alone", () => {
    expect(fs.readdirSync(path.join(ROOT, ".github", "workflows"))).toEqual(["release.yml"]);
    expect(Object.keys(wf.on)).toEqual(["push"]);
    expect(wf.on.push?.tags).toEqual(["v[0-9]+.[0-9]+.[0-9]+"]);
    expect(wf.on.push?.branches).toBeUndefined();
    expect(body).not.toMatch(/pull_request|schedule|workflow_dispatch|workflow_call|branches/);
  });

  it("reads contents at the top and grants id-token write only to the one job", () => {
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(Object.keys(wf.jobs)).toEqual(["publish"]);
    expect(job?.permissions).toEqual({ contents: "read", "id-token": "write" });
  });

  it("pins every action by full commit SHA with its version, setup-node at the Action's own commit", () => {
    const uses = steps.flatMap((s) => (s.uses ? [s.uses] : []));
    expect(uses).toEqual([CHECKOUT, SETUP_NODE]);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
    expect(TEXT).toMatch(/actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    expect(TEXT).toMatch(/actions\/setup-node@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    expect(read("action/action.yml")).toContain(SETUP_NODE);
    expect(read("docs/action.md")).toContain(CHECKOUT);
    // the commits are recorded as read from the GitHub API, with the date
    const lookups = read("docs/lookups.md");
    expect(lookups).toMatch(/2026-11-16 \| GitHub API \(read-only GET\)[^\n]*actions\/checkout[^\n]*3d3c42e5/);
    expect(lookups).toMatch(/2026-11-16 \| GitHub API \(read-only GET\)[^\n]*actions\/setup-node[^\n]*949feb24/);
  });

  it("keeps no checkout credential and restores no package cache", () => {
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout?.with).toEqual({ "persist-credentials": false });
    const node = steps.find((s) => s.uses?.startsWith("actions/setup-node"));
    expect(node?.with).toEqual({
      "node-version": "22",
      "registry-url": "https://registry.npmjs.org",
      "package-manager-cache": false,
    });
  });

  it("runs the offline gate with install scripts off, before the tag check and the publish", () => {
    const idx = (needle: string) => runs.findIndex((r) => r.includes(needle));
    expect(runs[idx("npm run verify")]?.trim()).toBe("npm ci --ignore-scripts && npm run verify");
    // the lanes that need helm, the network or the owner's deny-list are the owner's local steps
    for (const lane of ["verify:golden", "verify:live", "release:check"])
      expect(runs.some((r) => r.includes(lane))).toBe(false);
    const order = [idx("npm run verify"), idx("GITHUB_REF_NAME"), idx("npm publish")];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("checks the tag equals v<package.json version> and fails with an error otherwise", () => {
    const step = runs.find((r) => r.includes("GITHUB_REF_NAME") && r.includes("package.json"));
    expect(step).toContain('version="v$(node -p "require(\'./package.json\').version")"');
    expect(step).toContain('[ "$version" = "$GITHUB_REF_NAME" ]');
    expect(step).toContain("exit 1");
  });

  it("publishes last, with provenance and public access, from an exact trusted-publishing npm", () => {
    expect(runs.at(-1)).toBe("npm publish --provenance --access public");
    expect(runs.filter((r) => r.includes("npm publish"))).toHaveLength(1);
    expect(runs.some((r) => /^npm install -g npm@\d+\.\d+\.\d+$/.test(r.trim()))).toBe(true);
    expect(job?.env).toEqual({ NODE_AUTH_TOKEN: "$" + "{{ secrets.NPM_TOKEN }}" });
    // no shrinkwrap is added: the package is the six entries check-pack allows
    expect(runs.some((r) => r.includes("npm-shrinkwrap.json"))).toBe(false);
    expect((JSON.parse(read("package.json")) as { files: string[] }).files).not.toContain("npm-shrinkwrap.json");
  });

  it("says in its header that publishing is manual and the helm and network lanes are the owner's", () => {
    const header = TEXT.split("\nname:")[0] ?? "";
    expect(header).toMatch(/Publishing is manual/);
    expect(header).toMatch(/never runs on a push to a branch, a pull request or a schedule/);
    expect(header).toMatch(/owner's local step/);
    expect(header).toMatch(/docs\/release-checklist\.md/);
  });

  it("can fail: a wider tag, a pull-request trigger, a moving action ref, no gate or no provenance is refused", () => {
    const broken = [
      TEXT.replace('tags: ["v[0-9]+.[0-9]+.[0-9]+"]', 'tags: ["v*"]'),
      TEXT.replace("  push:\n", "  pull_request:\n  push:\n"),
      TEXT.replace(CHECKOUT, "actions/checkout@v7"),
      TEXT.replace("run: npm ci --ignore-scripts && npm run verify", "run: npm ci && npm run build"),
      TEXT.replace("npm publish --provenance --access public", "npm publish --access public"),
    ];
    for (const b of broken) {
      expect(b).not.toBe(TEXT);
      expect(holds(b)).toBe(false);
    }
    expect(holds(TEXT)).toBe(true);
  });
});
