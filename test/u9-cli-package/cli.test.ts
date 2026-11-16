// The command line in-process (C6, BR9.1 to BR9.5, BR9.8, BR2.5, BR2.7): flags, exit codes and the
// messages of crankpath's own voice, with any repo or user text quoted.

import fs from "node:fs";
import path from "node:path";
import { fakePath } from "../helpers/render.js";
import { afterAll, describe, expect, it } from "vitest";
import { app, estate, FIXTURE, run, tempDir, THIN_SLICE_URL } from "../helpers/scan.js";
import { flat, unwrapText } from "../helpers/text.js";

const REPO = path.join(FIXTURE, "repo");
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function make(files: Record<string, string>): string {
  const d = estate(files);
  cleanup.push(d);
  return d;
}

describe("exit codes (BR9.3 to BR9.5)", () => {
  it("is 0 when the analysis ran, with a cycle", () => {
    expect(run([REPO, "--repo-url", THIN_SLICE_URL], process.cwd()).code).toBe(0);
  });
  it("is 1 on an unknown flag, quoted", () => {
    const r = run([REPO, "--fail-on-cycles"], process.cwd());
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('error: unknown option "--fail-on-cycles"\n');
    expect(r.stdout).toBe("");
  });
  it("is 1 on an invalid crankpath.yaml, naming the key path quoted", () => {
    const root = make({
      "crankpath.yaml": "external:\n  github.com: {cold_start: yes}\n",
      "apps/a.yaml": app("a", "x"),
    });
    const r = run([root], process.cwd());
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(
      'error: invalid crankpath.yaml at key path "external.\\"github.com\\".cold_start" (expected a string)\n',
    );
    expect(r.stdout).toBe("");
  });
  it("is 1 when a repo-supplied repos: entry points outside the root, and names it", () => {
    const root = make({
      "crankpath.yaml": 'repos:\n  "https://example.org/x": {read_from: ../../etc}\n',
      "apps/a.yaml": app("a", "x"),
    });
    const r = run([root], process.cwd());
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(
      'error: invalid crankpath.yaml at key path "repos.\\"https://example.org/x\\".read_from" (outside the scanned root)\n',
    );
  });
  it("is 2 with nothing analysed (M4), quoting the path", () => {
    const root = make({ "README.md": "docs only\n", "docs/a.yaml": "a: 1\n", "docs/b.txt": "x\n" });
    const r = run([path.relative(process.cwd(), root)], process.cwd());
    expect(r.code).toBe(2);
    // one statement per line once the 80-column layout is undone (the long path wraps)
    expect(flat(r.stdout)).toBe(
      flat(
        [
          "crankpath 0.1.0",
          "Run status: NOTHING ANALYSED",
          `path: "${path.relative(process.cwd(), root)}"  found: 0 Applications, 0 ApplicationSets, 0 Kustomizations, 0 HelmReleases, 0 Kustomize roots; 3 files hold no source document`,
          "exit code 2",
          "",
        ].join("\n"),
      ),
    );
    const json = JSON.parse(run([root, "--format", "json"], process.cwd()).stdout);
    expect(json.runStatus).toMatchObject({ state: "NOTHING ANALYSED", reasons: ["no-sources"] });
  });
  it("is 1 for a path it cannot read", () => {
    const r = run(["does/not/exist"], process.cwd());
    expect(r).toEqual({ code: 1, stdout: "", stderr: 'error: cannot read path "does/not/exist"\n' });
  });
});

describe("flags (C6, FR9.1)", () => {
  it("prints the version and the helm and kustomize versions detected (BR9.2)", () => {
    const r = run(["--version"], process.cwd());
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("crankpath 0.1.0\nhelm: not found on PATH\nkustomize: not found on PATH\n");
    expect(run(["--version"], process.cwd(), fakePath("tested")).stdout).toBe(
      "crankpath 0.1.0\nhelm: v4.3.2 (tested)\nkustomize: v5.8.1 (tested)\n",
    );
    expect(run(["--version"], process.cwd(), fakePath("untested")).stdout).toBe(
      "crankpath 0.1.0\nhelm: v4.0.0 (not the tested v4.3.2)\nkustomize: v5.8.1 (tested)\n",
    );
    expect(run(["--version"], process.cwd(), fakePath("garbled")).stdout).toContain("helm: version not recognised\n");
  });
  it("refuses a flag whose stage arrives in a later build, instead of running without it", () => {
    // B3: a URL and --rev are no longer later work (test/u9-cli-package/repo-fetch.test.ts); B6 made
    // --format mermaid and --explain real: no flag of C6 is left to refuse as later work
    for (const args of [] as string[][]) {
      const r = run([REPO, ...args], process.cwd());
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.stderr).toMatch(/^error: .*arrives in a later build/);
    }
    expect(run([REPO, "--format", "yaml"], process.cwd()).stderr).toBe(
      'error: unknown format "yaml" (text, json or mermaid)\n',
    );
  });
  it("accepts --no-network, --cache-dir and --verbose; --verbose writes counts only to stderr", () => {
    const r = run([REPO, "--repo-url", THIN_SLICE_URL, "--no-network", "--cache-dir", "x", "--verbose"], process.cwd());
    expect(r.code).toBe(0);
    expect(
      r.stderr
        .split("\n")
        .filter(Boolean)
        .every((l) => l.startsWith("crankpath: ")),
    ).toBe(true);
    expect(r.stderr).not.toContain("gitea");
  });
  it("refuses an unparseable --repo-url without echoing userinfo, and a malformed --repo-alias", () => {
    const bad = run([REPO, "--repo-url", "file:///srv/x"], process.cwd());
    expect(bad.code).toBe(1);
    const secret = run([REPO, "--repo-url", "git://user:hunter2@example.org/x"], process.cwd());
    expect(secret.code).toBe(1);
    expect(secret.stderr).not.toContain("hunter2");
    expect(run([REPO, "--repo-alias", "nothing"], process.cwd()).stderr).toBe(
      "error: invalid --repo-alias (expected <url>=<path>)\n",
    );
    expect(
      run([REPO, "--repo-alias", "https://u:hunter2@example.org/x=/no/such/dir"], process.cwd()).stderr,
    ).not.toContain("hunter2");
  });
  it("takes the scanned URL from .git/config when --repo-url is absent", () => {
    const root = make({
      ".git/config": `[remote "origin"]\n\turl = https://user:tok@example.org/ops/self.git\n`,
      "apps/a.yaml": app("a", "cfg", "https://example.org/ops/self"),
      "cfg/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\n",
    });
    const r = run([root], process.cwd());
    expect(unwrapText(r.stdout)).toContain(
      'scanned: repo "https://example.org/ops/self.git" (from the origin in .git/config)',
    );
    expect(unwrapText(r.stdout)).not.toContain("tok@");
    const json = JSON.parse(run([root, "--format", "json"], process.cwd()).stdout);
    expect(json.nodes.map((n: { id: string }) => n.id)).toContain("ConfigMap/a/c");
  });
  it("maps a repo outside the root only through --repo-alias, labelled, never by path", () => {
    const other = make({ "deploy/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: far}\n" });
    const root = make({ "apps/a.yaml": app("a", "deploy", "https://example.org/ops/other") });
    const unmapped = JSON.parse(run([root, "--format", "json"], process.cwd()).stdout);
    expect(unmapped.opaque[0]).toMatchObject({ reason: "unreadable-repo" });
    const mapped = run(
      [root, "--format", "json", "--repo-alias", `https://example.org/ops/other.git=${other}`],
      process.cwd(),
    );
    const json = JSON.parse(mapped.stdout);
    const far = json.nodes.find((n: { id: string }) => n.id === "ConfigMap/a/far");
    expect(far.origin.path).toBe("alias:1/deploy/cm.yaml");
    expect(mapped.stdout).not.toContain(other);
  });
  it("writes --out outside the scanned tree only, never through a symlink", () => {
    const outDir = tempDir("out");
    cleanup.push(outDir);
    const target = path.join(outDir, "report.json");
    const ok = run([REPO, "--repo-url", THIN_SLICE_URL, "--format", "json", "--out", target], process.cwd());
    expect(ok).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(fs.readFileSync(target, "utf8")).toBe(fs.readFileSync(path.join(FIXTURE, "expected.json"), "utf8"));
    const inside = run([REPO, "--out", path.join(REPO, "report.txt")], process.cwd());
    expect(inside.code).toBe(1);
    expect(fs.existsSync(path.join(REPO, "report.txt"))).toBe(false);
    fs.writeFileSync(path.join(outDir, "real.txt"), "keep\n");
    fs.symlinkSync(path.join(outDir, "real.txt"), path.join(outDir, "link.txt"));
    const linked = run([REPO, "--out", path.join(outDir, "link.txt")], process.cwd());
    expect(linked.code).toBe(1);
    expect(fs.readFileSync(path.join(outDir, "real.txt"), "utf8")).toBe("keep\n");
  });
  it("reads --config relative to the working directory it was given", () => {
    const root = make({
      "apps/a.yaml": app("a", "cfg"),
      "cfg/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\n",
    });
    const facts = make({ "facts.yaml": "external:\n  github.com: {cold_start: available}\n" });
    const r = run([root, "--config", "facts.yaml"], facts);
    expect(r.code).toBe(0);
    expect(unwrapText(r.stdout)).toContain('  external "github.com"  available (declared, not verified)');
    expect(run([root, "--config", "facts.yaml"], root).stderr).toBe(
      'error: invalid --config file "facts.yaml" (not readable: not found)\n',
    );
  });
  it("prints help on --help with exit 0", () => {
    const r = run(["--help"], process.cwd());
    expect(r.code).toBe(0);
    expect(unwrapText(r.stdout)).toContain("--repo-alias");
    // B6 review n2: the order of the path and --explain [id]
    expect(r.stdout).toContain("The path comes first: `crankpath ./repo --explain` explains every cycle");
  });
});
