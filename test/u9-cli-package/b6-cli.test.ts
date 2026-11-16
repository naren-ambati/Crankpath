// The B6 command-line wiring (C6): --format mermaid and --explain [id] render the same Report;
// an id that names nothing is a usage error with the id quoted; --explain prints text only; colour
// is decoration, on only for a terminal with no NO_COLOR and no --no-color, and never for a file,
// JSON or Mermaid; removing the colour gives the plain text byte for byte.

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../../src/u9-cli-package/cli-shell.js";
import { stripColour } from "../../src/u8-output/text-layout.js";
import { estate, FIXTURE, run, THIN_SLICE_URL, tempDir } from "../helpers/scan.js";

const REPO = path.join(FIXTURE, "repo");
const ARGS = [REPO, "--repo-url", THIN_SLICE_URL];
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

function tty(argv: readonly string[], noColor?: string) {
  let stdout = "";
  let stderr = "";
  const code = main(argv, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd: process.cwd(),
    // no helm or kustomize on the tool path, so the toolchain line is the expected output's (B2 merge)
    toolPath: "",
    isTTY: true,
    ...(noColor === undefined ? {} : { noColor }),
  });
  return { code, stdout, stderr };
}

describe("--explain and --format mermaid (B6)", () => {
  it("refuses an id that names no cycle and no node, quoting it, with nothing on standard output", () => {
    const r = run([...ARGS, "--explain", "c-0000\u001b[2Jx"], process.cwd());
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe('error: --explain names no cycle and no node of this report: "c-0000\\x1b[2Jx"\n');
  });
  it("explains a node id", () => {
    const r = run([...ARGS, "--explain", "Service/gitea/gitea-http"], process.cwd());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('node Service "gitea/gitea-http"');
    expect(r.stdout).toContain("  on a cycle: cycle c-d8197e7d (extracted)");
  });
  it("prints text only: --explain with --format json or mermaid is a usage error", () => {
    for (const format of ["json", "mermaid"]) {
      const r = run([...ARGS, "--explain", "--format", format], process.cwd());
      expect(r.code).toBe(1);
      expect(r.stderr).toBe("error: --explain prints text; it cannot be combined with --format json or mermaid\n");
    }
    expect(run([...ARGS, "--explain", "--format", "text"], process.cwd()).code).toBe(0);
  });
  it("prints the nothing-analysed report (exit 2) when there is nothing to explain", () => {
    const root = estate({ "README.md": "docs only\n" });
    cleanup.push(root);
    const r = run([root, "--explain"], process.cwd());
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("Run status: NOTHING ANALYSED");
  });
  it("gives byte-identical Mermaid and --explain output on every run and from another working directory (BR8.2)", () => {
    const elsewhere = tempDir("cwd");
    cleanup.push(elsewhere);
    for (const extra of [["--format", "mermaid"], ["--explain"]]) {
      const a = run([...ARGS, ...extra], process.cwd()).stdout;
      expect(run([...ARGS, ...extra], process.cwd()).stdout).toBe(a);
      expect(run([REPO, "--repo-url", THIN_SLICE_URL, ...extra], elsewhere).stdout).toBe(a);
    }
  });
  it("writes the Mermaid document to --out", () => {
    const dir = tempDir("out");
    cleanup.push(dir);
    const out = path.join(dir, "graph.md");
    expect(run([...ARGS, "--format", "mermaid", "--out", out], process.cwd()).code).toBe(0);
    expect(fs.readFileSync(out, "utf8")).toBe(fs.readFileSync(path.join(FIXTURE, "expected-mermaid.md"), "utf8"));
  });
});

describe("colour is decoration only (BR8.6, FR8.7, NFR14)", () => {
  const plain = run(ARGS, process.cwd()).stdout;
  it("colours a terminal's text and explain output; without the colour codes the bytes are the plain output", () => {
    const coloured = tty(ARGS).stdout;
    expect(coloured).toContain("\x1b[");
    expect(stripColour(coloured)).toBe(plain);
    const explain = tty([...ARGS, "--explain"]).stdout;
    expect(explain).toContain("\x1b[");
    expect(stripColour(explain)).toBe(run([...ARGS, "--explain"], process.cwd()).stdout);
  });
  it("never colours with NO_COLOR set, with --no-color, for a file, or for JSON and Mermaid", () => {
    expect(tty(ARGS, "1").stdout).toBe(plain);
    expect(tty([...ARGS, "--no-color"]).stdout).toBe(plain);
    expect(tty([...ARGS, "--format", "json"]).stdout).not.toContain("\x1b[");
    expect(tty([...ARGS, "--format", "mermaid"]).stdout).not.toContain("\x1b[");
    const dir = tempDir("colour");
    cleanup.push(dir);
    const out = path.join(dir, "report.txt");
    expect(tty([...ARGS, "--out", out]).code).toBe(0);
    expect(fs.readFileSync(out, "utf8")).toBe(plain);
  });
  it("keeps every result word when colour is off: the run status and statuses are words", () => {
    expect(plain).toContain("Run status: ANALYSED WITH GAPS");
    expect(plain).toContain("(6 blocked, 0 unverified)");
  });
});
