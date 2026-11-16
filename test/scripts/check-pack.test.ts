import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  APACHE_2_SHA256,
  checkDistSources,
  checkList,
  checkLock,
  checkPack,
  checkPackageJson,
  findLicenceFiles,
} from "../../scripts/check-pack.mjs";
import { createHash } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
const LIST = [
  "CHANGELOG.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "dist/u9-cli-package/cli.js",
  "dist/u9-cli-package/library.js",
  "package.json",
];

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("package.json", () => {
  it("passes crankpath's own package.json", () => {
    expect(checkPackageJson(PKG)).toEqual([]);
  });

  it("fails a wrong licence, private, changed metadata, a changed files list and lifecycle or publish scripts", () => {
    const bad = {
      ...PKG,
      license: "MIT",
      private: true,
      homepage: "https://example.org",
      files: [...PKG.files, "src"],
      scripts: { ...PKG.scripts, postinstall: "node x", ship: "npm publish" },
    };
    expect(checkPackageJson(bad).map((p: string) => p.split(" ").slice(0, 2).join(" "))).toEqual([
      'package-json "license"',
      'package-json "private"',
      'package-json "homepage"',
      'package-json "files"',
      "package-json the",
      "package-json the",
    ]);
  });
});

describe("the tarball list", () => {
  it("passes the six allowed entries and the bin", () => {
    expect(checkList(LIST, PKG)).toEqual([]);
  });

  it("fails an extra file, a missing top-level file, nothing under dist and a missing bin", () => {
    expect(checkList([...LIST, "src/x.ts"], PKG)).toHaveLength(1);
    expect(
      checkList(
        LIST.filter((p) => p !== "CHANGELOG.md"),
        PKG,
      ),
    ).toHaveLength(1);
    expect(
      checkList(
        LIST.filter((p) => !p.startsWith("dist/")),
        PKG,
      ),
    ).toHaveLength(2);
    expect(
      checkList(
        LIST.filter((p) => p !== "dist/u9-cli-package/cli.js"),
        PKG,
      ),
    ).toHaveLength(1);
  });
});

describe("the lockfile", () => {
  it("passes crankpath's lockfile and names the development package with an install script", () => {
    const r = checkLock(PKG, LOCK, "ignore-scripts=true\n");
    expect(r.problems).toEqual([]);
    expect(r.notes).toEqual([
      "node_modules/fsevents (development only) has an install script; .npmrc ignore-scripts=true keeps it from running",
    ]);
  });

  it("fails a range, a version the lock does not hold, a missing ignore-scripts, a foreign registry, no integrity and a runtime install script", () => {
    const lock = structuredClone(LOCK);
    lock.packages["node_modules/yaml"].resolved = "https://registry.example.org/yaml.tgz";
    delete lock.packages["node_modules/commander"].integrity;
    lock.packages["node_modules/commander"].hasInstallScript = true;
    const pkg = { ...PKG, dependencies: { ...PKG.dependencies, yaml: "^2.9.1" } };
    const problems = checkLock(pkg, lock, "").problems;
    expect(problems).toEqual([
      'pinned dependencies "yaml" is "^2.9.1", not an exact version',
      'pinned dependencies "yaml" ^2.9.1 is not the version the lockfile holds',
      "lockfile .npmrc must hold ignore-scripts=true",
      "lockfile node_modules/commander has no sha512 integrity hash",
      "lockfile node_modules/commander is a runtime package with an install script",
      "lockfile node_modules/yaml is not resolved from registry.npmjs.org",
    ]);
    expect(checkLock(PKG, { ...LOCK, lockfileVersion: 2 }, "ignore-scripts=true").problems).toEqual([
      "lockfile package-lock.json must be lockfileVersion 3",
    ]);
  });
});

describe("licence files and the licence text", () => {
  function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-check-pack-"));
    dirs.push(root);
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
  }

  it("allows the root LICENSE beside NOTICE and a corpus copy's LICENSE beside its NOTICE, nothing else", () => {
    const root = tree({
      LICENSE: "x",
      NOTICE: "x",
      "test/corpus/a/LICENSE": "x",
      "test/corpus/a/NOTICE": "x",
      "test/corpus/b/LICENSE": "x",
      "test/corpus/a/deep/LICENSE.md": "x",
      "src/COPYING": "x",
      "node_modules/z/LICENSE": "x",
    });
    expect(findLicenceFiles(root)).toEqual(["src/COPYING", "test/corpus/a/deep/LICENSE.md", "test/corpus/b/LICENSE"]);
  });

  it("knows the Apache License 2.0 text by its hash, and crankpath's LICENSE is that text", () => {
    const sha = createHash("sha256")
      .update(fs.readFileSync(path.join(ROOT, "LICENSE")))
      .digest("hex");
    expect(sha).toBe(APACHE_2_SHA256);
  });

  it("fails a LICENSE that differs by one byte", () => {
    const text = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
    const root = tree({
      LICENSE: `${text} `,
      NOTICE: "x",
      "package.json": JSON.stringify(PKG),
      "package-lock.json": JSON.stringify(LOCK),
      ".npmrc": "ignore-scripts=true\n",
      "src/u9-cli-package/cli.ts": "x",
      "src/u9-cli-package/library.ts": "x",
    });
    const r = checkPack(root, { list: LIST });
    expect(r.problems).toEqual(["licence-text LICENSE is not byte-identical to the Apache License 2.0 text"]);
  });
});

describe("dist/ against src/ (review n2)", () => {
  it("refuses a dist file with no source in src/, and a file that is not compiled output", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-dist-"));
    dirs.push(root);
    for (const [rel, text] of Object.entries({ "src/a/b.ts": "x", "src/c.ts": "x" })) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    const list = [
      "dist/a/b.js",
      "dist/a/b.d.ts",
      "dist/c.js",
      "dist/gone.js",
      "dist/gone.d.ts",
      "dist/extra-secret.txt",
    ];
    expect(checkDistSources(root, list)).toEqual([
      'pack-content "dist/gone.js" has no source src/gone.ts (a stale build output)',
      'pack-content "dist/gone.d.ts" has no source src/gone.ts (a stale build output)',
      'pack-content "dist/extra-secret.txt" is not a compiled .js or .d.ts file',
    ]);
    expect(checkDistSources(root, list.slice(0, 3))).toEqual([]);
  });
});
