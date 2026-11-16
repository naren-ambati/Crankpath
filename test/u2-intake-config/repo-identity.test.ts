import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoMapping } from "../../src/u1-graph-model/declared-facts.js";
import { openRoot, type ScanRoot } from "../../src/u2-intake-config/bounded-reader.js";
import {
  createRepoIdentity,
  normaliseRepoUrl,
  originFromGitConfig,
  parseRepoAlias,
  readOriginUrl,
  repoUrlHost,
} from "../../src/u2-intake-config/repo-identity.js";

const SCANNED = "http://gitea-http.gitea:3000/ops/thin-slice";

function identity(extra: { aliases?: string[]; mappings?: RepoMapping[]; scanned?: string | null } = {}) {
  return createRepoIdentity({
    scannedUrl: extra.scanned === undefined ? SCANNED : extra.scanned,
    scannedFrom: "flag",
    aliases: (extra.aliases ?? []).map((url, i) => ({
      url,
      normalised: normaliseRepoUrl(url) as string,
      label: `alias:${i + 1}`,
    })),
    mappings: extra.mappings ?? [],
  });
}

describe("normalisation (FR2.3, BR2.13)", () => {
  it("drops scheme, userinfo, default port, trailing .git and /, lower-cases the host only", () => {
    const forms = [
      "https://github.com/org/repo",
      "http://github.com/org/repo",
      "https://user:token@github.com/org/repo.git",
      "https://GitHub.com:443/org/repo/",
      "ssh://git@github.com/org/repo.git",
      "ssh://git@github.com:22/org/repo",
      "git@github.com:org/repo.git",
      "github.com:org/repo",
    ];
    for (const f of forms) expect(normaliseRepoUrl(f)).toBe("github.com/org/repo");
  });
  it("keeps a non-default port and the case of the path", () => {
    expect(normaliseRepoUrl(SCANNED)).toBe("gitea-http.gitea:3000/ops/thin-slice");
    expect(normaliseRepoUrl("https://github.com/Org/Repo")).toBe("github.com/Org/Repo");
  });
  it("never makes look-alike hosts, prefix paths or other cases equal", () => {
    const base = normaliseRepoUrl("https://github.com/org/repo");
    for (const other of [
      "https://github.com.evil.example.org/org/repo",
      "https://githuB.com.example.org/org/repo",
      "https://github.com/org/repo-fork",
      "https://github.com/org/repository",
      "https://github.com/org",
      "https://github.com/org/repo/sub",
      "https://github.com/ORG/repo",
      "https://gitlab.com/org/repo",
      "https://github.com:8443/org/repo",
    ]) {
      expect(normaliseRepoUrl(other)).not.toBe(base);
    }
  });
  it("refuses other schemes, queries, fragments, dot and empty segments, controls and backslashes", () => {
    for (const bad of [
      "file:///srv/repo",
      "git://github.com/org/repo",
      "https://github.com/org/repo?x=1",
      "https://github.com/org/repo#main",
      "https://github.com/org/../repo",
      "https://github.com/org/%2e%2e/repo",
      "https://github.com/org//repo",
      "https://github.com/org/repo\n",
      "https://github.com\\org\\repo",
      "https://",
      "",
      "not a url",
    ]) {
      expect(normaliseRepoUrl(bad)).toBeNull();
    }
  });
  it("gives the host for matching", () => {
    expect(repoUrlHost(SCANNED)).toBe("gitea-http.gitea");
    expect(repoUrlHost("git@Gitea-SSH.gitea:ops/x.git")).toBe("gitea-ssh.gitea");
    expect(repoUrlHost("nope")).toBeNull();
  });
});

describe("resolution (BR2.12, BR2.14, C5)", () => {
  it("reads only the scanned repo itself or an explicit mapping", () => {
    expect(identity().resolve("http://gitea-http.gitea:3000/ops/thin-slice.git")).toMatchObject({
      outcome: "self",
      root: ".",
    });
    expect(identity().resolve("http://gitea-http.gitea:3000/ops/thin-slice-other")).toMatchObject({
      outcome: "unreadable",
    });
  });
  it("prefers --repo-alias, then the scanned URL, then repos:", () => {
    const mapping: RepoMapping = {
      url: "https://example.org/ops/vendor",
      normalised: "example.org/ops/vendor",
      readFrom: "vendor",
      fetch: false,
      keyPath: 'repos."https://example.org/ops/vendor"',
    };
    const id = identity({ aliases: [SCANNED], mappings: [mapping] });
    expect(id.resolve(SCANNED)).toMatchObject({ outcome: "alias", root: "alias:1", via: "repo-alias" });
    expect(id.resolve("https://example.org/ops/vendor.git")).toMatchObject({
      outcome: "alias",
      root: "repos:vendor",
      via: "repos-read-from",
    });
    const fetchOnly = identity({ mappings: [{ ...mapping, readFrom: null, fetch: true }] });
    expect(fetchOnly.resolve("https://example.org/ops/vendor")).toMatchObject({
      outcome: "unreadable",
      via: "repos-fetch",
    });
  });
  it("suggests a repos: entry when the last segment matches the scanned repo's name, and never applies it", () => {
    const id = identity();
    const r = id.resolve("https://user:secret@github.com/someone/thin-slice");
    expect(r.outcome).toBe("unreadable");
    expect(r.root).toBeNull();
    expect(r.suggestion).toEqual({ url: "https://github.com/someone/thin-slice", readFrom: "." });
    expect(id.resolve("https://github.com/someone/other").suggestion).toBeNull();
    // the suggestion is data: resolving the same URL again is still unreadable
    expect(id.resolve("https://github.com/someone/thin-slice").outcome).toBe("unreadable");
  });
  it("gives no suggestion and no self when the scanned URL is unknown", () => {
    const id = identity({ scanned: null });
    expect(id.resolve(SCANNED)).toMatchObject({ outcome: "unreadable", suggestion: null });
    expect(id.scanned).toMatchObject({ url: null, normalised: null, name: null, from: null });
  });
  it("calls a URL it cannot compare unreadable, not equal to anything", () => {
    expect(identity().resolve("git://gitea-http.gitea:3000/ops/thin-slice")).toMatchObject({
      outcome: "unreadable",
      via: "not-comparable",
    });
  });
});

describe("--repo-alias values", () => {
  it("splits at the first = and refuses malformed values", () => {
    expect(parseRepoAlias(`${SCANNED}=../checkout`)).toMatchObject({ ok: true, path: "../checkout" });
    expect(parseRepoAlias("no-equals")).toEqual({ ok: false, problem: "no-equals" });
    expect(parseRepoAlias(`${SCANNED}=`)).toEqual({ ok: false, problem: "empty-path" });
    expect(parseRepoAlias("file:///x=.")).toEqual({ ok: false, problem: "not-comparable" });
  });
});

describe("origin from .git/config (BR2.15)", () => {
  it("reads the first url of the origin remote, with quotes, comments and the old section form", () => {
    const text = [
      "[core]",
      "\turl = https://example.org/not/this",
      '[remote "upstream"]',
      "\turl = https://example.org/upstream/repo",
      '[remote "origin"]  ; the one',
      '\turl = "https://example.org/ops/thin-slice.git" # comment',
      "\turl = https://example.org/second",
    ].join("\n");
    expect(originFromGitConfig(text)).toBe("https://example.org/ops/thin-slice.git");
    expect(originFromGitConfig("[remote.origin]\nurl=git@example.org:ops/x")).toBe("git@example.org:ops/x");
    expect(originFromGitConfig('[remote "origin"]\n\tfetch = +refs/heads/*')).toBeNull();
    expect(originFromGitConfig("")).toBeNull();
  });

  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  function rootWith(setup: (d: string) => void): ScanRoot {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-origin-"));
    setup(dir);
    const r = openRoot(dir);
    if (!r.ok) throw new Error("root");
    return r.root;
  }
  it("reads .git/config by a bounded read, and refuses a symlinked or file-form .git", () => {
    const plain = rootWith((d) => {
      fs.mkdirSync(path.join(d, ".git"));
      fs.writeFileSync(path.join(d, ".git", "config"), '[remote "origin"]\n\turl = https://example.org/ops/a\n');
    });
    expect(readOriginUrl(plain)).toBe("https://example.org/ops/a");
    fs.rmSync(dir as string, { recursive: true, force: true });
    const linked = rootWith((d) => {
      const real = path.join(d, "elsewhere");
      fs.mkdirSync(real);
      fs.writeFileSync(path.join(real, "config"), '[remote "origin"]\n\turl = https://example.org/ops/b\n');
      fs.symlinkSync(real, path.join(d, ".git"));
    });
    expect(readOriginUrl(linked)).toBeNull();
    fs.rmSync(dir as string, { recursive: true, force: true });
    const worktree = rootWith((d) => fs.writeFileSync(path.join(d, ".git"), "gitdir: /somewhere/else\n"));
    expect(readOriginUrl(worktree)).toBeNull();
  });
});
