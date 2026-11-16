// CliShell (U9, contract C6; BR9.1 to BR9.5, BR9.8, BR9.9, FR9.1, FR9.2): the command line. Every
// flag of C6 is parsed; an unknown flag is a usage error (exit 1) shown quoted in crankpath's voice;
// flags whose stage arrives in a later build say so and exit 1 rather than run silently without
// it. Exit codes: 0 the analysis ran (whatever it found), 1 a tool or usage error, 2 nothing
// analysed. Writes only stdout, stderr and the `--out` file, which may not be inside the scanned
// tree and is never written through a symlink. `--verbose` prints counts only (no repo text, no
// token, no Secret value).

import fs from "node:fs";
import path from "node:path";
import { Command, CommanderError } from "commander";
import { quote } from "../u1-graph-model/safe-text.js";
import { writeJson } from "../u8-output/json-renderer.js";
import { CRANKPATH_VERSION } from "../u8-output/report-assembler.js";
import { renderTextLines } from "../u8-output/text-renderer.js";
import { runPipeline } from "./pipeline-runner.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly cwd: string;
  /** The pipeline to run; tests inject a failing one to reach the top-level guard. */
  readonly run?: typeof runPipeline;
}

/** crankpath's one line for any error it did not expect: no stack, no message from the runtime. */
export const INTERNAL_ERROR =
  "error: crankpath stopped on an internal error (a bug); any report on standard output is incomplete and no --out file was written";

const FORMATS = ["text", "json", "mermaid"] as const;

/** The `--version` text: crankpath's version and the tools this build detects (none). */
export function versionText(): string {
  return [
    `crankpath ${CRANKPATH_VERSION}`,
    "helm: not detected (this build runs no helm)",
    "kustomize: not detected (this build runs no kustomize)",
    "",
  ].join("\n");
}

function program(): Command {
  return new Command()
    .name("crankpath")
    .description(
      "A black-start planner and cycle finder for GitOps estates (reads files only; never touches a cluster).",
    )
    .argument("[path]", "checkout to scan", ".")
    .option("--format <format>", "text | json | mermaid", "text")
    .option("--out <file>", "write the output to this file instead of standard output")
    .option("--config <file>", "crankpath.yaml location (default <path>/crankpath.yaml)")
    .option("--repo-url <url>", "the scanned repo's own URL (else the origin in .git/config)")
    .option(
      "--repo-alias <url=path>",
      "map a repoURL to a local path (repeatable)",
      (v: string, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .option("--rev <rev>", "revision of a URL to fetch")
    .option("--explain [id]", "evidence trail for a cycle or node id")
    .option("--no-network", "cache only (this build makes no network call)")
    .option("--cache-dir <dir>", "cache root (this build caches nothing)")
    .option("--verbose", "counts on standard error")
    .option("--version", "the crankpath version and the detected helm and kustomize versions")
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} });
}

function commanderMessage(e: CommanderError): string {
  if (e.code === "commander.unknownOption") {
    const m = /'(.*)'/s.exec(e.message);
    return quote("error: unknown option", m?.[1] ?? "", "terminal");
  }
  if (e.code === "commander.excessArguments") return "error: too many arguments (crankpath takes one path)";
  if (e.code === "commander.optionMissingArgument") return "error: an option is missing its value";
  return "error: invalid usage";
}

/** Refuses an `--out` inside any scanned tree; writes in chunks without following a symlink. */
function writeOut(
  file: string,
  produce: (write: (chunk: string) => void) => void,
  rootReals: readonly string[],
  cwd: string,
): string | null {
  const target = path.resolve(cwd, file);
  let dirReal: string;
  try {
    dirReal = fs.realpathSync.native(path.dirname(target));
  } catch {
    return quote("error: cannot write", file, "terminal");
  }
  if (rootReals.some((r) => dirReal === r || dirReal.startsWith(`${r}${path.sep}`))) {
    return quote("error: --out is inside the scanned tree, which crankpath never writes:", file, "terminal");
  }
  // The whole report exists (as bounded chunks, never one string) before the file is opened, so
  // a failure while producing it leaves an earlier file untouched.
  const chunks: string[] = [];
  produce((chunk) => chunks.push(chunk));
  try {
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
    const fd = fs.openSync(path.join(dirReal, path.basename(target)), flags, 0o644);
    try {
      for (const chunk of chunks) fs.writeSync(fd, chunk);
    } catch {
      return `${quote("error: cannot write", file, "terminal")} (the file may be incomplete)`;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return quote("error: cannot write", file, "terminal");
  }
  return null;
}

/**
 * Runs the command line; returns the exit code. Any error crankpath did not expect (a bug, or a
 * runtime ceiling such as memory) ends as exit 1 with one fixed line; nothing from it is printed.
 */
export function main(argv: readonly string[], io: CliIo): number {
  try {
    return mainUnguarded(argv, io);
  } catch {
    io.stderr(`${INTERNAL_ERROR}\n`);
    return 1;
  }
}

function mainUnguarded(argv: readonly string[], io: CliIo): number {
  const cmd = program();
  try {
    cmd.parse([...argv], { from: "user" });
  } catch (e) {
    if (e instanceof CommanderError) {
      if (e.code === "commander.helpDisplayed" || e.code === "commander.help") {
        io.stdout(cmd.helpInformation());
        return 0;
      }
      io.stderr(`${commanderMessage(e)}\n`);
      return 1;
    }
    throw e;
  }
  const o = cmd.opts<{
    format: string;
    out?: string;
    config?: string;
    repoUrl?: string;
    repoAlias: string[];
    rev?: string;
    explain?: string | boolean;
    network: boolean;
    cacheDir?: string;
    verbose?: boolean;
    version?: boolean;
  }>();
  if (o.version === true) {
    io.stdout(versionText());
    return 0;
  }
  const target = (cmd.args[0] as string | undefined) ?? ".";
  if (!(FORMATS as readonly string[]).includes(o.format)) {
    io.stderr(`${quote("error: unknown format", o.format, "terminal")} (text, json or mermaid)\n`);
    return 1;
  }
  if (o.format === "mermaid") {
    io.stderr("error: --format mermaid arrives in a later build\n");
    return 1;
  }
  if (o.explain !== undefined) {
    io.stderr("error: --explain arrives in a later build\n");
    return 1;
  }
  if (o.rev !== undefined || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(target)) {
    io.stderr("error: scanning a URL (and --rev) arrives in a later build; scan a local checkout\n");
    return 1;
  }
  const outcome = (io.run ?? runPipeline)({
    path: target,
    cwd: io.cwd,
    repoAliases: o.repoAlias,
    ...(o.repoUrl === undefined ? {} : { repoUrl: o.repoUrl }),
    ...(o.config === undefined ? {} : { config: o.config }),
  });
  if (outcome.kind === "error") {
    io.stderr(`${outcome.message}\n`);
    return outcome.exitCode;
  }
  if (o.verbose === true) for (const line of outcome.diagnostics) io.stderr(`crankpath: ${line}\n`);
  const report = outcome.report;
  const produce = (write: (chunk: string) => void) => {
    if (o.format === "json") writeJson(report, write);
    else for (const line of renderTextLines(report)) write(`${line}\n`);
  };
  if (o.out !== undefined) {
    const failed = writeOut(o.out, produce, outcome.rootReals, io.cwd);
    if (failed !== null) {
      io.stderr(`${failed}\n`);
      return 1;
    }
  } else produce(io.stdout);
  return outcome.exitCode;
}
