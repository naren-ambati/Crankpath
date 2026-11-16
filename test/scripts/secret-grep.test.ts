import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fold, grepText, loadDenylist, secretGrep, tarEntries } from "../../scripts/secret-grep.mjs";
import { rules } from "../../scripts/check-tree.mjs";
import { gzipSync } from "node:zlib";

// Every credential shape and forbidden string is assembled at run time, so this file passes the grep
// it tests. The denylist terms are made-up words, never a real name.

const GH = `gh${"p"}_${"A1b2".repeat(9)}`;
const AWS = `AK${"IA"}${"ABCDEFGH12345678"}`;
const KEY = `-----BEGIN ${"RSA "}PRIVATE KEY-----`;
const TOKEN_LINE = `CRANKPATH_${"TOKEN"}_EXAMPLE_ORG=${"a1b2c3d4".repeat(3)}`;
const HOME = `/${"Users"}/someone/project`;
const TERM = "zorblaxian";
const HOST = "test-host-9.local";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function tree(files: Record<string, string>): { root: string; files: string[] } {
  const root = tmp("crankpath-secret-grep-");
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return { root, files: Object.keys(files).sort() };
}

function denylist(text: string): string {
  const d = tmp("crankpath-denylist-");
  fs.writeFileSync(path.join(d, "names.txt"), text);
  return path.join(d, "names.txt");
}

const base = { pack: false, hostname: HOST, userName: "" } as const;
const NO_DENYLIST = { PATH: process.env.PATH } as NodeJS.ProcessEnv;

describe("credentials", () => {
  it("finds each credential shape with file and line, never printing the value", () => {
    const t = tree({
      "a.ts": `const a = 1;\nconst t = "${GH}";\n`,
      "b.txt": `${AWS}\n${KEY}\n`,
      "c.sh": `${TOKEN_LINE}\n`,
    });
    const r = secretGrep({ ...t, ...base, env: NO_DENYLIST });
    expect(r.findings).toEqual([
      "a.ts:2: credential (GitHub token)",
      "b.txt:1: credential (AWS access key id)",
      "b.txt:2: credential (private key)",
      "c.sh:1: credential (assigned crankpath token)",
    ]);
    expect(r.findings.join("\n")).not.toContain(GH);
    expect(r.ok).toBe(false);
  });

  it("passes a clean tree and placeholder token values", () => {
    const t = tree({ "a.ts": `CRANKPATH_${"TOKEN"}_EXAMPLE_ORG: "planted-crankpath-token",\n` });
    const r = secretGrep({ ...t, ...base, env: NO_DENYLIST });
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("checks e-mail addresses in Markdown outside test/, allowing the addresses that are nobody's", () => {
    const real = `jane.doe@${"mailbox"}.io`;
    const t = tree({
      "docs/a.md": `write to ${real}\nor admin@example.org, git@github.com, 1+x@users.noreply.github.com\n`,
      "test/x.md": `${real}\n`,
    });
    expect(secretGrep({ ...t, ...base, env: NO_DENYLIST }).findings).toEqual([
      "docs/a.md:1: e-mail (an address that is someone's)",
    ]);
  });

  it("is never a pass over zero files", () => {
    const t = tree({});
    expect(secretGrep({ ...t, ...base, env: NO_DENYLIST }).ok).toBe(false);
  });
});

describe("the denylist (OD-28)", () => {
  it("is NOT RUN when the variable is unset, the file is missing or holds no term, and release mode then fails", () => {
    const t = tree({ "a.md": `${TERM}\n` });
    const cases: NodeJS.ProcessEnv[] = [
      {},
      { CRANKPATH_DENYLIST_FILE: "" },
      { CRANKPATH_DENYLIST_FILE: path.join(os.tmpdir(), "crankpath-no-such-denylist") },
      { CRANKPATH_DENYLIST_FILE: denylist("") },
      { CRANKPATH_DENYLIST_FILE: denylist("# only a comment\n\n   \n") },
    ];
    for (const env of cases) {
      const offline = secretGrep({ ...t, ...base, env });
      expect(offline.denylistRun).toBe(false);
      expect(offline.denylist).toMatch(/^denylist: NOT RUN \(.+; not a pass\)$/);
      expect(offline.ok).toBe(true); // the term is in the tree, but nothing checked it: offline it is reported, not passed
      expect(secretGrep({ ...t, ...base, env, release: true }).ok).toBe(false);
    }
  });

  it("finds a term in contents, file names and folded spellings, naming its number, never the term", () => {
    const zw = `zorbl​axian`;
    const t = tree({
      "a.md": `nothing\nby ${TERM.toUpperCase()} ltd\n`,
      [`docs/${TERM}.md`]: "x\n",
      "b.md": `${zw}\n`,
    });
    const r = secretGrep({
      ...t,
      ...base,
      env: { CRANKPATH_DENYLIST_FILE: denylist(`# names\nunrelated\n${TERM}\n`) },
    });
    expect(r.denylistRun).toBe(true);
    expect(r.findings).toEqual([
      "denylist term #2 found in tree entry 1 (its contents, line 2; path withheld)",
      "denylist term #2 found in tree entry 2 (its contents, line 1; path withheld)",
      "denylist term #2 found in tree entry 3 (its path; path withheld)",
    ]);
    // review m1: no output line holds the term, a file name holding it included
    expect(r.findings.join("\n").toLowerCase()).not.toContain(TERM);
    expect(r.ok).toBe(false);
    expect(secretGrep({ ...t, ...base, release: true, env: { CRANKPATH_DENYLIST_FILE: denylist("other\n") } }).ok).toBe(
      true,
    );
  });

  it("withholds a path that holds a term from every finding, a credential finding included (review m1)", () => {
    const t = tree({ [`${TERM}/key.txt`]: `${KEY}\n`, "z.md": "fine\n" });
    const r = secretGrep({ ...t, ...base, env: { CRANKPATH_DENYLIST_FILE: denylist(`${TERM}\n`) } });
    expect(r.findings).toEqual([
      "denylist term #1 found in tree entry 2 (its path; path withheld)",
      "tree entry 2 (path withheld: it holds a denylist term):1: credential (private key)",
    ]);
    expect(r.findings.join("\n").toLowerCase()).not.toContain(TERM);
  });

  it("scans commit messages and author fields for the denylist (review m3)", () => {
    const t = tree({ "a.md": "fine\n" });
    const git = (...a: string[]) =>
      execFileSync("git", ["-C", t.root, "-c", "user.name=x", "-c", "user.email=x@example.org", ...a], {
        stdio: "ignore",
      });
    git("init", "-q");
    git("add", "a.md");
    git("commit", "-q", "-m", `work done for ${TERM.toUpperCase()}`);
    const r = secretGrep({ ...t, ...base, env: { CRANKPATH_DENYLIST_FILE: denylist(`${TERM}\n`) } });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatch(
      /^denylist term #1 found in commit [0-9a-f]{12} \(its message or author fields, line \d+\)$/,
    );
    expect(r.denylistDetail).toContain("1 commit(s)");
  });

  it("refuses a denylist file inside the repository", () => {
    const t = tree({ "names.txt": `${TERM}\n`, "a.md": "x\n" });
    const state = loadDenylist({ CRANKPATH_DENYLIST_FILE: path.join(t.root, "names.txt") }, t.root);
    expect(state).toMatchObject({ state: "not-run", inside: true });
    const r = secretGrep({ ...t, ...base, env: { CRANKPATH_DENYLIST_FILE: path.join(t.root, "names.txt") } });
    expect(r.findings).toEqual(["CRANKPATH_DENYLIST_FILE: denylist (the denylist file is inside the repository)"]);
  });

  it("folds compatibility forms and format characters", () => {
    expect(fold("Ｚorbl‍ax")).toBe("zorblax");
  });
});

describe("the package", () => {
  it("reads every file of a gzip tar, long names included", () => {
    const header = (name: string, size: number, type: string): Buffer => {
      const h = Buffer.alloc(512);
      h.write(name.slice(0, 100), 0);
      h.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
      h.write(type, 156);
      return h;
    };
    const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
    const long = `package/${"d/".repeat(60)}f.txt`;
    const pax = Buffer.from(`${long.length + 6 + String(long.length).length + 1} path=${long}\n`);
    const tar = Buffer.concat([
      header("package/a.txt", 2, "0"),
      pad(Buffer.from("hi")),
      header("PaxHeader", pax.length, "x"),
      pad(pax),
      header("package/short", 3, "0"),
      pad(Buffer.from("abc")),
      Buffer.alloc(1024),
    ]);
    expect(tarEntries(gzipSync(tar)).map((e) => [e.path, e.data.toString()])).toEqual([
      ["package/a.txt", "hi"],
      [long, "abc"],
    ]);
  });

  it("packs a package and finds a credential, a home path and the host name inside it", () => {
    const t = tree({
      "package.json": JSON.stringify({ name: "p", version: "1.0.0", files: ["dist"] }),
      "dist/a.js": `// ${GH}\nconst p = "${HOME}";\nconst h = "${HOST}";\n`,
      "dist/b.js": "export {};\n",
    });
    const r = secretGrep({ ...t, hostname: HOST, userName: "", env: NO_DENYLIST, files: ["package.json"] });
    expect(r.packRead).toBe(3);
    expect(r.findings).toEqual([
      "package:package/dist/a.js:1: credential (GitHub token)",
      "package:package/dist/a.js:2: home-path",
      "package:package/dist/a.js:3: hostname",
    ]);
  });

  it("applies check-tree's personal rules through grepText", () => {
    expect(grepText("f", HOME, { emails: false, personal: rules(HOST, ""), terms: null })).toEqual(["f:1: home-path"]);
  });
});
