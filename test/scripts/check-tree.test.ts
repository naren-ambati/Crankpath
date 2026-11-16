import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { checkTree, decodeText, isExcluded, listFiles, rules } from "../../scripts/check-tree.mjs";

// Forbidden strings are assembled at run time so this test file itself stays clean.
const HOME = `/${"Users"}/someone/x`;
const LINUX_HOME = `/${"home"}/someone/x`;
// Forbidden words spelled by character codes, so this file passes the rules it tests.
const chars = (...codes: number[]) => String.fromCharCode(...codes);
const TOOL = chars(65, 73, 45, 68, 76, 67);
const TOOL_FOLDER = chars(97, 105, 100, 108, 99);
const START = `START${"-"}HERE`;
const HOST = "test-host-7.local";

let dir: string;

function put(rel: string, text: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-check-tree-"));
  put("clean.md", "nothing to see\n");
  put("home.md", `line one\nsee ${HOME}\n`);
  put("linux.md", `x ${LINUX_HOME}\n`);
  put("tool.md", `designed with ${TOOL.toLowerCase()}\n`);
  put("folder.ts", `import x from "../${TOOL_FOLDER}/a";\n`);
  put("start.md", `read ${START}.md\n`);
  put("host.md", `built on TEST-HOST-7\n`);
  put(`${TOOL_FOLDER}/inside.md`, `${TOOL} ${HOME}\n`);
  put(`${TOOL_FOLDER}-inputs/inside.md`, `${TOOL}\n`);
  put(`.${"claude"}/inside.md`, `${TOOL}\n`);
  put(`${START}.md`, `${TOOL}\n`);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("check-tree", () => {
  it("finds each rule in a temp file, with file and line", () => {
    const files = ["clean.md", "home.md", "linux.md", "tool.md", "folder.ts", "start.md", "host.md"];
    const { filesRead, findings } = checkTree({ root: dir, hostname: HOST, userName: "", files });
    expect(filesRead).toBe(7);
    expect(findings).toEqual([
      { file: "home.md", line: 2, rule: "home-path" },
      { file: "linux.md", line: 1, rule: "home-path" },
      { file: "tool.md", line: 1, rule: "design-tool" },
      { file: "folder.ts", line: 1, rule: "design-tool" },
      { file: "start.md", line: 1, rule: "start-file" },
      { file: "host.md", line: 1, rule: "hostname" },
    ]);
  });

  it("reports nothing for a clean file", () => {
    expect(checkTree({ root: dir, hostname: HOST, userName: "", files: ["clean.md"] })).toEqual({
      filesRead: 1,
      findings: [],
    });
  });

  it("never reads the excluded design folders or the start file", () => {
    const files = [
      `${TOOL_FOLDER}/inside.md`,
      `${TOOL_FOLDER}-inputs/inside.md`,
      `.${"claude"}/inside.md`,
      `${START}.md`,
    ];
    expect(checkTree({ root: dir, hostname: HOST, userName: "", files })).toEqual({ filesRead: 0, findings: [] });
    for (const f of files) expect(isExcluded(f)).toBe(true);
    expect(isExcluded(`docs/${TOOL_FOLDER}/x.md`)).toBe(false);
  });

  it("checks the hostname read at run time, with and without .local, and ignores localhost", () => {
    expect(rules(HOST).filter((r) => r.rule === "hostname")).toHaveLength(2);
    expect(rules("localhost").filter((r) => r.rule === "hostname")).toHaveLength(0);
    const { findings } = checkTree({ root: dir, hostname: "other-machine", userName: "", files: ["host.md"] });
    expect(findings).toEqual([]);
  });

  it("lists tracked and untracked-not-ignored files of this repository, without ignored ones", () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const files = listFiles(repo);
    expect(files).toContain("package.json");
    expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
  });
});

describe("check-tree: the gaps the B0 review found", () => {
  const scan = (files: string[], userName = "") => checkTree({ root: dir, hostname: HOST, userName, files }).findings;

  it("checks file and folder names, not only content", () => {
    put(`${TOOL_FOLDER}-notes.md`, "clean\n");
    put(`notes/${TOOL}/x.md`, "clean\n");
    expect(scan([`${TOOL_FOLDER}-notes.md`, `notes/${TOOL}/x.md`])).toEqual([
      { file: `${TOOL_FOLDER}-notes.md`, line: 0, rule: "design-tool" },
      { file: `notes/${TOOL}/x.md`, line: 0, rule: "design-tool" },
    ]);
  });

  it("matches the tool name with a space, an underscore or a zero-width split", () => {
    const first = chars(65, 73);
    const last = chars(68, 76, 67);
    put("variants.md", `${first} ${last}\n${first}_${last}\n${chars(65)}\u200b${chars(73)}-${last}\nclean\n`);
    expect(scan(["variants.md"]).map((f) => f.line)).toEqual([1, 2, 3]);
  });

  it("finds Windows home paths and macOS per-user temporary folders", () => {
    put(
      "win.md",
      `C:\\${"Users"}\\bob\\x\n/${"private"}/${"var"}/folders/ab/x\n/var/${"folders"}/ab/x\nhttps://api.example.org/users/x\n`,
    );
    expect(scan(["win.md"]).map((f) => [f.line, f.rule])).toEqual([
      [1, "home-path"],
      [2, "home-path"],
      [3, "home-path"],
    ]);
  });

  it("reads UTF-16 files, and refuses a file that is not text", () => {
    fs.writeFileSync(
      path.join(dir, "u16.md"),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`see ${HOME}`, "utf16le")]),
    );
    fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0x61, 0x00, 0x62]));
    expect(scan(["u16.md", "bin.dat"])).toEqual([
      { file: "u16.md", line: 1, rule: "home-path" },
      { file: "bin.dat", line: 0, rule: "not-text" },
    ]);
    const be = Buffer.from([0xfe, 0xff, 0x00, 0x41]);
    expect(decodeText(be)).toBe("A");
  });

  it("checks a symlink's target text", () => {
    fs.symlinkSync(`/${"Users"}/bob/secret`, path.join(dir, "lnk"));
    expect(scan(["lnk"])).toEqual([{ file: "lnk", line: 0, rule: "home-path" }]);
  });

  it("splits lines on carriage returns too", () => {
    put("cr.md", `L1\rL2 ${HOME}\rL3\n`);
    expect(scan(["cr.md"])).toEqual([{ file: "cr.md", line: 2, rule: "home-path" }]);
  });

  it("checks this machine's login name, except service accounts", () => {
    put("who.md", "written by somebody-7\n");
    expect(scan(["who.md"], "somebody-7")).toEqual([{ file: "who.md", line: 1, rule: "user-name" }]);
    expect(rules(HOST, "runner").some((r) => r.rule === "user-name")).toBe(false);
  });

  it("lists untracked files that are not ignored (the --others half), and not ignored ones", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-check-tree-git-"));
    try {
      execFileSync("git", ["init", "-q", repo]);
      fs.writeFileSync(path.join(repo, ".gitignore"), "ignored.md\n");
      fs.writeFileSync(path.join(repo, "untracked.md"), `see ${HOME}\n`);
      fs.writeFileSync(path.join(repo, "ignored.md"), `see ${HOME}\n`);
      const files = listFiles(repo);
      expect(files).toEqual([".gitignore", "untracked.md"]);
      expect(checkTree({ root: repo, hostname: HOST, userName: "" }).findings).toEqual([
        { file: "untracked.md", line: 1, rule: "home-path" },
      ]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("check-tree: home-relative personal folders and the local settings folder", () => {
  const scan = (files: string[]) => checkTree({ root: dir, hostname: HOST, userName: "", files }).findings;
  const SETTINGS = `.${"claude"}`;

  it("finds a ~/ path to a personal folder, any case, and not other uses of a tilde", () => {
    const home = chars(36, 72, 79, 77, 69);
    put(
      "tilde.md",
      `see ${chars(126)}/${"Documents"}/notes\n${chars(126)}/${"Desktop"}/x\n${home}/${"Downloads"}/y\nabout ~5 files\n${chars(126)}/.npmrc\na${chars(126)}/b\n${chars(126)}/${"notes"}/x\n${chars(36, 123)}HOME}/${"Documents"}\n`,
    );
    expect(scan(["tilde.md"])).toEqual([
      { file: "tilde.md", line: 1, rule: "home-relative" },
      { file: "tilde.md", line: 2, rule: "home-relative" },
      { file: "tilde.md", line: 3, rule: "home-relative" },
      { file: "tilde.md", line: 7, rule: "home-relative" },
      { file: "tilde.md", line: 8, rule: "home-relative" },
    ]);
  });

  it("finds a mention of the local settings folder anywhere but .gitignore", () => {
    put(
      "settings.md",
      `kept in ${SETTINGS}/settings.local.json\nthe ${SETTINGS} folder\nclaude.com\nx.${"claude"}.example\n`,
    );
    put(".gitignore", `${SETTINGS}/settings.local.json\n`);
    expect(scan(["settings.md", ".gitignore"])).toEqual([
      { file: "settings.md", line: 1, rule: "settings-folder" },
      { file: "settings.md", line: 2, rule: "settings-folder" },
    ]);
  });
});

describe("check-tree: the evasions the second review found", () => {
  const scan = (files: string[], userName = "") => checkTree({ root: dir, hostname: HOST, userName, files }).findings;
  const first = chars(65, 73);
  const last = chars(68, 76, 67);

  it.each([
    ["space and hyphen", `${first} - ${last}`],
    ["two spaces", `${first}  ${last}`],
    ["slash", `${first}/${last}`],
    ["dotted", `${chars(65)}.${chars(73)}. ${last}`],
    ["tab", `${first}\t${last}`],
    ["no-break space", `${first}\u00a0${last}`],
    ["en dash", `${first}\u2013${last}`],
    ["non-breaking hyphen", `${first}\u2011${last}`],
    ["full-width letters", "\uff21\uff29\uff24\uff2c\uff23"],
    ["letters split by hyphens", chars(97, 45, 105, 45, 100, 45, 108, 45, 99)],
    ["markup between", `${first}<br>${last}`],
  ])("finds the tool name written with %s", (_name, text) => {
    put("evade.md", `${text}\n`);
    expect(scan(["evade.md"]).map((f) => f.rule)).toEqual(["design-tool"]);
  });

  it("third review: does not flag the spelled-out phrase or letters listed apart in code", () => {
    put(
      "fp.md",
      `${first} development life cycle\n${first}-driven development lifecycle\nx = [a, i, d, l, c]\nconst a = i; d.l.c\nif (a, i, d)\n`,
    );
    expect(scan(["fp.md"])).toEqual([]);
  });

  it("third review: flags a home folder with a path segment, not a CI account or a bare folder", () => {
    const h = `/${"home"}`;
    put("homes.md", `${h}/alice/x\n${h}/runner/work/x\n${h}/vagrant/data\n${h}/user\nsee ${h}/ci\n`);
    expect(scan(["homes.md"])).toEqual([{ file: "homes.md", line: 1, rule: "home-path" }]);
  });

  it("does not flag ordinary words that merely contain the letters", () => {
    put("words.md", "he said lc\nmaid lace\nsoftware development life cycle\n");
    expect(scan(["words.md"])).toEqual([]);
  });

  it.each([
    ["doubled backslashes", `C:${chars(92, 92)}${"Users"}${chars(92, 92)}bob${chars(92, 92)}x`],
    ["percent-encoded", `%2F${"Users"}%2Fbob`],
    ["a space after the slash", `/${"Users"}/ bob/x`],
  ])("finds a home path written with %s", (_name, text) => {
    put("home2.md", `${text}\n`);
    expect(scan(["home2.md"]).map((f) => f.rule)).toEqual(["home-path"]);
  });

  it("matches a login name as a whole word and skips names of three characters or fewer", () => {
    put("login.md", "specification\nsomebody-7 wrote this\nsomebody-71\n");
    expect(scan(["login.md"], "somebody-7").map((f) => f.line)).toEqual([2]);
    expect(rules(HOST, "ci").some((r) => r.rule === "user-name")).toBe(false);
    expect(scan(["login.md"], "ci")).toEqual([]);
  });
});
