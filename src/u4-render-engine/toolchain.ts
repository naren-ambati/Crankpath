// Toolchain (U4; BR4.14 to BR4.16, FR3.10, NFR12): finds helm and kustomize on PATH, asks each for
// its version through the CommandRunner, and records what it found in every output. A tool not on
// PATH is named (`not found on PATH`) and every job that needs it is opaque `tool-missing`; a tool
// whose version cannot be read is still used and its version is recorded as unrecognised; a
// version other than the tested pair is a printed note naming the tested pair (OD-13).
//
// Only absolute PATH entries are searched: an empty or relative entry (`.`, `bin`) would let the
// scanned checkout or the working directory supply its own `helm`, so it is skipped.

import fs from "node:fs";
import path from "node:path";
import type { CommandRunner } from "./command-runner.js";

/** The tested pair (OD-13; the lead's 2026-11-15 deviation from the design's helm v4.3.1). */
export const TESTED_VERSIONS = Object.freeze({ helm: "v4.3.2", kustomize: "v5.8.1" });

export type RenderTool = "helm" | "kustomize";

export interface ToolVersion {
  readonly tool: RenderTool;
  readonly present: boolean;
  /** `vX.Y.Z[...]` when read, else null (absent, or present with an unreadable version). */
  readonly version: string | null;
  readonly tested: boolean;
  /**
   * Why the version was not read, when its command did not succeed (B2 review pass 3, m6): the
   * tool is a script (`#!`), which under the empty child PATH fails as soon as it looks a program
   * up, or a binary whose version command failed. Absent when the version was read, or when the
   * command ran and printed something else.
   */
  readonly problem?: ToolProblem;
}

export type ToolProblem = "script" | "failed";

/** The words for a ToolProblem, printed after "version not recognised". */
export const TOOL_PROBLEM_WORDS: Readonly<Record<ToolProblem, string>> = Object.freeze({
  script:
    "a script that did not run: tools run with an empty PATH, so a wrapper that looks a program up on PATH fails; give crankpath the real binary",
  failed: "its version command failed; tools run with an empty PATH",
});

function isScript(file: string): boolean {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const head = Buffer.alloc(2);
      return fs.readSync(fd, head, 0, 2, 0) === 2 && head.toString("latin1") === "#!";
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

export interface Toolchain {
  readonly helm: ToolVersion;
  readonly kustomize: ToolVersion;
  /** True only when both are present at the tested versions. */
  readonly tested: boolean;
}

/** The first absolute PATH entry holding an executable regular file named `name`, or null. */
export function findTool(name: RenderTool, pathValue: string): string | null {
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir === "" || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    try {
      const st = fs.statSync(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

const VERSION = /(?:^|\/)(v\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,64})?)(?:\+[0-9A-Za-z.-]{1,64})?\s*$/;

/** The version in a tool's `version` output (first line, at most 200 bytes), or null. */
export function parseToolVersion(output: Buffer): string | null {
  const head = output.subarray(0, 200).toString("latin1");
  const line = head.split("\n")[0]?.trim() ?? "";
  const m = VERSION.exec(line);
  return m === null ? null : (m[1] as string);
}

function versionOf(runner: CommandRunner, tool: RenderTool, cwd: string): ToolVersion {
  const binary = runner.binary(tool);
  if (binary === null) return Object.freeze({ tool, present: false, version: null, tested: false });
  const r = runner.run(
    tool === "helm"
      ? { tool, subcommand: ["version"], args: ["--template", "{{.Version}}"], cwd }
      : { tool, subcommand: ["version"], args: [], cwd },
  );
  const version = r.outcome === "ok" ? parseToolVersion(r.stdout) : null;
  const tested = version === TESTED_VERSIONS[tool];
  if (r.outcome === "ok") return Object.freeze({ tool, present: true, version, tested });
  return Object.freeze({ tool, present: true, version, tested, problem: isScript(binary) ? "script" : "failed" });
}

/** Detects both tools once per run. `cwd` must be a directory that exists (the version commands write nothing). */
export function detectToolchain(runner: CommandRunner, cwd: string): Toolchain {
  const helm = versionOf(runner, "helm", cwd);
  const kustomize = versionOf(runner, "kustomize", cwd);
  return Object.freeze({ helm, kustomize, tested: helm.tested && kustomize.tested });
}

/** The toolchain when neither tool was looked for (tests that render plain sources only). */
export const NO_TOOLS: Toolchain = Object.freeze({
  helm: Object.freeze({ tool: "helm", present: false, version: null, tested: false }),
  kustomize: Object.freeze({ tool: "kustomize", present: false, version: null, tested: false }),
  tested: false,
});
