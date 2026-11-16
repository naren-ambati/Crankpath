// Fetching end to end through the pipeline with a fake git (no network): `crankpath <url> --rev`
// (FR1.2) and `repos: {fetch: true}` (OD-10). The token test proves the token string reaches only
// its host's git call (through that call's environment) and appears nowhere in standard output,
// standard error, the JSON or the cache (AC4.5.2); the failure tests show a 403 or `--no-network`
// as the outcome it is, never as an absent repository.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { writeJson } from "../../src/u8-output/json-renderer.js";
import { renderTextLines } from "../../src/u8-output/text-renderer.js";
import { AUTH_HEADER_VARIABLE } from "../../src/u4-render-engine/git-runner.js";
import { authHeader } from "../../src/u4-render-engine/repo-fetcher.js";
import { main } from "../../src/u9-cli-package/cli-shell.js";
import { type RunOptions, runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { allText, fakeGit, fakeGitPath } from "../helpers/git-fake.js";
import { app, estate, flat, run, tempDir } from "../helpers/scan.js";

const SHA = "89abcdef0123456789abcdef0123456789abcdef";
const HOMELAB = fileURLToPath(new URL("../fixtures/homelab-shape/repo", import.meta.url));
const PUBLIC = "https://git.acme.dev/ops/homelab";
const VENDOR = "https://git.acme.dev/ops/vendor";
const TOKEN = "s3cr3t-crankpath-token-0f8e";
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function dir(prefix: string): string {
  const d = tempDir(prefix);
  cleanup.push(d);
  return fs.realpathSync(d);
}

function outputs(options: RunOptions) {
  const r = runPipeline(options);
  if (r.kind !== "report") return { error: r.message, text: "", json: "", report: null };
  let json = "";
  writeJson(r.report, (c) => {
    json += c;
  });
  return { error: null, text: `${renderTextLines(r.report).join("\n")}\n`, json, report: JSON.parse(json) };
}

describe("crankpath <url> --rev (FR1.2)", () => {
  it("fetches the URL, scans it as its own URL, and records the commit (pinned: not floating)", () => {
    const cwd = dir("cwd");
    const git = fakeGit({ trees: { [PUBLIC]: HOMELAB }, sha: SHA });
    const p = outputs({
      path: ".",
      cwd,
      url: PUBLIC,
      rev: SHA,
      gitSpawn: git.spawn,
      toolPath: fakeGitPath(dir("bin")),
    });
    expect(p.error).toBeNull();
    expect(p.report.repo).toEqual({ url: PUBLIC, urlFrom: "fetched", commit: SHA, floating: false });
    expect(flat(p.text)).toContain(
      flat(`scanned: repo "${PUBLIC}" (fetched read-only by crankpath)  commit: "${SHA}"  floating: no`),
    );
    // the cache keeps the verified object store, never a tree that is read (pass 2, M1)
    const entry = path.join(cwd, ".crankpath", "repos", "git.acme.dev", "ops", `homelab@${SHA}`);
    expect(fs.existsSync(path.join(entry, "objects", "pack"))).toBe(true);
    expect(fs.existsSync(path.join(entry, "system"))).toBe(false);
    // the fetched tree's own name gives the suggestion for its in-cluster mirror (FR2.2, FR2.4)
    expect(flat(p.text)).toContain(
      flat('suggested repos entry (not applied): "http://gitea-http.gitea:3000/ops/homelab": {read_from: .}'),
    );
  });
  it("flags a branch floating and records the commit it got (OD-12)", () => {
    const cwd = dir("cwd");
    const git = fakeGit({ trees: { [PUBLIC]: HOMELAB }, sha: SHA });
    const p = outputs({
      path: ".",
      cwd,
      url: PUBLIC,
      rev: "main",
      gitSpawn: git.spawn,
      toolPath: fakeGitPath(dir("bin")),
    });
    expect(p.report.repo).toMatchObject({ commit: SHA, floating: true });
    expect(flat(p.text)).toContain(flat(`commit: "${SHA}"  floating: yes`));
  });
  it("exits 1 with the fetch's own words on a 403 or offline, never as an empty or absent repo", () => {
    const cwd = dir("cwd");
    const git = fakeGit({ trees: {}, sha: SHA, fail: { [PUBLIC]: "fatal: The requested URL returned error: 403" } });
    const p = outputs({
      path: ".",
      cwd,
      url: PUBLIC,
      rev: SHA,
      gitSpawn: git.spawn,
      toolPath: fakeGitPath(dir("bin")),
    });
    expect(p.error).toBe(
      `error: could not fetch "${PUBLIC}" (unreadable-repo: refused by the server (HTTP 403); unknown whether the repository exists)`,
    );
    const off = outputs({
      path: ".",
      cwd,
      url: PUBLIC,
      rev: "main",
      noNetwork: true,
      gitSpawn: git.spawn,
      toolPath: fakeGitPath(dir("bin")),
    });
    expect(off.error).toMatch(/\(offline: not fetched under --no-network/);
  });
  it("reads a cached pinned commit under --no-network, after git has verified it (no clone)", () => {
    const cwd = dir("cwd");
    const git = fakeGit({ trees: { [PUBLIC]: HOMELAB }, sha: SHA });
    const bin = fakeGitPath(dir("bin"));
    expect(outputs({ path: ".", cwd, url: PUBLIC, rev: SHA, gitSpawn: git.spawn, toolPath: bin }).error).toBeNull();
    const calls = git.calls.length;
    const again = outputs({
      path: ".",
      cwd,
      url: PUBLIC,
      rev: SHA,
      noNetwork: true,
      gitSpawn: git.spawn,
      toolPath: bin,
    });
    expect(again.error).toBeNull();
    expect(git.calls.slice(calls).map((c) => c.args.find((a) => !a.startsWith("-") && !a.includes("=")))).toEqual([
      "fsck",
      "ls-tree",
      "read-tree",
      "checkout-index",
    ]);
  });
});

describe("the command line around a URL (C6)", () => {
  it("refuses --rev without a URL, --repo-url with one, an abbreviated sha and a non-https URL", () => {
    expect(run([HOMELAB, "--rev", SHA], process.cwd()).stderr).toBe(
      "error: --rev applies to a URL to fetch, not to a local checkout\n",
    );
    expect(run([PUBLIC, "--repo-url", PUBLIC], process.cwd()).stderr).toBe(
      "error: --repo-url cannot be given with a URL to fetch (the URL is its own URL)\n",
    );
    const abbreviated = run([PUBLIC, "--rev", "8b9d40f", "--cache-dir", path.join(dir("c"), "cache")], process.cwd());
    expect(abbreviated.code).toBe(1);
    expect(abbreviated.stderr).toContain("an abbreviated commit sha cannot be fetched");
    const plain = run(["http://git.acme.dev/ops/x", "--cache-dir", path.join(dir("c"), "cache")], process.cwd());
    expect(plain.code).toBe(1);
    expect(plain.stderr).toContain("only https repositories are fetched");
    const internal = run(
      ["https://gitea-http.gitea/ops/x", "--cache-dir", path.join(dir("c"), "cache")],
      process.cwd(),
    );
    expect(internal.stderr).toContain("can only be inside a network");
  });
});

describe("repos: {fetch: true} (OD-10)", () => {
  function scanned(): string {
    const d = estate({
      "apps/vendor.yaml": app("vendor", "apps", VENDOR),
      "crankpath.yaml": `repos:\n  "${VENDOR}": {fetch: true}\n`,
    });
    cleanup.push(d);
    return d;
  }
  function vendorTree(): string {
    const d = estate({ "apps/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: vendored}\ndata: {k: v}\n" });
    cleanup.push(d);
    return d;
  }
  it("fetches the entry when a source needs it, reads it as fetch:1, records its commit (floating) and counts it as a declared fact", () => {
    const repo = scanned();
    const git = fakeGit({ trees: { [VENDOR]: vendorTree() }, sha: SHA });
    const o = outputs({
      path: repo,
      cwd: dir("cwd"),
      repoUrl: PUBLIC,
      gitSpawn: git.spawn,
      toolPath: fakeGitPath(dir("bin")),
    });
    expect(o.error).toBeNull();
    expect(o.report.nodes.map((n: { id: string }) => n.id)).toContain("ConfigMap/vendor/vendored");
    expect(o.report.repoMappings).toEqual([
      { commit: SHA, failure: null, floating: true, from: "crankpath.yaml", root: "fetch:1", url: VENDOR, used: true },
    ]);
    expect(flat(o.text)).toContain(
      flat(
        `  read through a mapping: repo "${VENDOR}"  root: "fetch:1"  commit: "${SHA}"  floating: yes (the default branch)  fetched without a token  (crankpath.yaml repos:, declared, not verified)`,
      ),
    );
    expect(o.report.runStatus.counts.declaredFacts).toBe(1);
    const node = o.report.nodes.find((n: { id: string }) => n.id === "ConfigMap/vendor/vendored");
    expect(node.origin.path).toBe("fetch:1/apps/cm.yaml");
  });
  it("is opaque offline under --no-network, and unreadable-repo with its words on a 404, never absent", () => {
    const repo = scanned();
    const git = fakeGit({ trees: {}, sha: SHA });
    const off = outputs({
      path: repo,
      cwd: dir("cwd"),
      repoUrl: PUBLIC,
      noNetwork: true,
      gitSpawn: git.spawn,
      toolPath: fakeGitPath(dir("bin")),
    });
    expect(off.report.opaque).toEqual([
      expect.objectContaining({ node: "Application/argocd/vendor", reason: "offline", value: VENDOR }),
    ]);
    expect(git.calls).toHaveLength(0);
    const missing = outputs({
      path: repo,
      cwd: dir("cwd"),
      repoUrl: PUBLIC,
      gitSpawn: git.spawn,
      toolPath: fakeGitPath(dir("bin")),
    });
    const mark = missing.report.opaque[0];
    expect(mark).toMatchObject({
      reason: "unreadable-repo",
      detail:
        "not found or not visible (HTTP 404); unknown whether the repository exists; fetched without a token (a repos: entry never gets one)",
    });
    expect(flat(missing.text)).toContain(flat("not fetched: unreadable-repo: not found or not visible (HTTP 404)"));
    expect(missing.report.runStatus.state).toBe("ANALYSED WITH GAPS");
    expect(missing.report.repoMappings[0].used).toBe(false);
  });
  it("refuses an entry the guard refuses, before git", () => {
    const d = estate({
      "apps/a.yaml": app("a", "apps", "https://10.0.0.7/ops/x"),
      "crankpath.yaml": 'repos:\n  "https://10.0.0.7/ops/x": {fetch: true}\n',
    });
    cleanup.push(d);
    const git = fakeGit({ trees: {}, sha: SHA });
    const o = outputs({
      path: d,
      cwd: dir("cwd"),
      repoUrl: PUBLIC,
      gitSpawn: git.spawn,
      toolPath: fakeGitPath(dir("bin")),
    });
    expect(o.report.opaque[0]).toMatchObject({
      reason: "unreadable-repo",
      detail: /an IP address is never fetched from/,
    });
    expect(git.calls).toHaveLength(0);
  });
});

describe("the token reaches its own host only, and only for the URL the invoker names (AC4.5.2, B3 review M2)", () => {
  it("goes to the command line's URL only; a repos: entry on the same host gets none; it is in no output or cache", () => {
    // the fetched repository's own crankpath.yaml names a second repository on the same host
    const fetched = estate({
      "apps/vendor.yaml": app("vendor", "apps", VENDOR),
      "apps/other.yaml": app("other", "apps", "https://forge.acme.net/ops/other"),
      "crankpath.yaml": `repos:\n  "${VENDOR}": {fetch: true}\n  "https://forge.acme.net/ops/other": {fetch: true}\n`,
    });
    cleanup.push(fetched);
    const vendor = estate({ "apps/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: v}\n" });
    cleanup.push(vendor);
    const git = fakeGit({
      trees: { [PUBLIC]: fetched, [VENDOR]: vendor, "https://forge.acme.net/ops/other": vendor },
      sha: SHA,
    });
    const cwd = dir("cwd");
    const env: Record<string, string> = {
      CRANKPATH_TOKEN_GIT_ACME_DEV: TOKEN,
      CRANKPATH_TOKEN_FORGE_ACME_NET: "other-token",
      HOME: "/elsewhere",
      GITHUB_TOKEN: "ambient",
    };
    let stdout = "";
    let stderr = "";
    const io = {
      stdout: (t: string) => {
        stdout += t;
      },
      stderr: (t: string) => {
        stderr += t;
      },
      cwd,
      env,
      run: (o: RunOptions) => runPipeline({ ...o, gitSpawn: git.spawn, toolPath: fakeGitPath(dir("bin")) }),
    };
    expect(main([PUBLIC, "--rev", SHA, "--verbose"], io)).toBe(0);
    const textOut = stdout;
    stdout = "";
    expect(main([PUBLIC, "--rev", SHA, "--format", "json", "--verbose"], io)).toBe(0);
    const forms = [TOKEN, authHeader(TOKEN), Buffer.from(`x-access-token:${TOKEN}`).toString("base64")];
    for (const f of forms) {
      expect(textOut).not.toContain(f);
      expect(stdout).not.toContain(f);
      expect(stderr).not.toContain(f);
      expect(allText(path.join(cwd, ".crankpath"))).not.toContain(f);
    }
    const toPublic = git.calls.filter((c) => c.args.includes(PUBLIC));
    expect(toPublic.length).toBeGreaterThan(0);
    for (const c of toPublic) {
      expect(c.env[AUTH_HEADER_VARIABLE]).toBe(authHeader(TOKEN));
      expect(c.args.join(" ")).not.toContain(TOKEN);
    }
    // the repos: entries (one on the same host) were fetched, and without any token
    const fromConfig = git.calls.filter(
      (c) => c.args.includes(VENDOR) || c.args.includes("https://forge.acme.net/ops/other"),
    );
    expect(fromConfig.length).toBeGreaterThan(0);
    for (const c of fromConfig) {
      expect(c.env[AUTH_HEADER_VARIABLE]).toBeUndefined();
      expect(c.args.join(" ")).not.toContain(AUTH_HEADER_VARIABLE);
    }
    expect(JSON.stringify(git.calls)).not.toContain("other-token");
    expect(flat(textOut)).toContain("fetched without a token");
    // no ambient variable of the invoker reaches git: only the fixed environment
    for (const c of git.calls) {
      expect(c.env.GITHUB_TOKEN).toBeUndefined();
      expect(c.env.HOME).not.toBe("/elsewhere");
    }
  });
});
