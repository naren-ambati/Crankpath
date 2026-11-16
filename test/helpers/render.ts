// Test helpers for the render engine: a RenderIo over a real temporary estate (the real
// BoundedReader and tree walk), a runtime with crankpath's real CommandRunner starting the fake
// helm and kustomize of test/fixtures/fake-tools (real processes, recorded output), and a WorkDir
// in a temporary cache root.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NodeId } from "../../src/u1-graph-model/graph-model.js";
import { openRoot, readBytes, readText, readYaml } from "../../src/u2-intake-config/bounded-reader.js";
import { entryKind, walkFiles } from "../../src/u2-intake-config/tree-walk.js";
import {
  buildChildEnv,
  type CommandResult,
  createCommandRunner,
  type RunnerLimits,
  RUNNER_LIMITS,
} from "../../src/u4-render-engine/command-runner.js";
import { OUTPUT_LIMITS, type OutputLimits } from "../../src/u4-render-engine/rendered-output.js";
import type { RenderIo, ValuesData } from "../../src/u4-render-engine/renderers.js";
import { detectToolchain, findTool, NO_TOOLS } from "../../src/u4-render-engine/toolchain.js";
import { createWorkDir, type WorkDir } from "../../src/u4-render-engine/work-dir.js";

export const FAKE_TOOLS = fileURLToPath(new URL("../fixtures/fake-tools/", import.meta.url));
export const NODE_DIR = path.dirname(process.execPath);

const VARIANTS = {
  tested: { helm: "v4.3.2", kustomize: "v5.8.1" },
  untested: { helm: "v4.0.0", kustomize: "v5.8.1" },
  garbled: { helm: "not a version", kustomize: "ENV" },
} as const;
let generated: string | null = null;

/**
 * The directory of one fake-tool variant. The wrappers are written at run time with this node's
 * absolute path as their interpreter, because crankpath gives its children an empty PATH (B2
 * review pass 2, M1): a `#!/usr/bin/env node` line could not find node there.
 */
export function fakeDir(variant: keyof typeof VARIANTS = "tested"): string {
  if (generated === null) {
    generated = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-fake-tools-")));
    process.once("exit", () => fs.rmSync(generated as string, { recursive: true, force: true }));
  }
  const dir = path.join(generated, variant);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    const tool = new URL("../fixtures/fake-tools/fake-tool.mjs", import.meta.url).href;
    for (const name of ["helm", "kustomize"] as const) {
      const body = `#!${process.execPath}\nimport(${JSON.stringify(tool)}).then((m) => m.run(${JSON.stringify(name)}, ${JSON.stringify(VARIANTS[variant][name])}));\n`;
      fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
    }
  }
  return dir;
}

/** A PATH holding one fake-tool variant (`tested`, `untested`, `garbled`) and node. */
export function fakePath(variant: keyof typeof VARIANTS = "tested"): string {
  return [fakeDir(variant), NODE_DIR].join(path.delimiter);
}

export interface RenderHarness {
  readonly io: RenderIo;
  readonly work: WorkDir;
  readonly commands: CommandResult[];
  readonly root: string;
  readonly cacheRoot: string;
  cleanup(): void;
}

export interface HarnessOptions {
  readonly toolPath?: string | null;
  readonly network?: boolean;
  readonly limits?: RunnerLimits;
  readonly output?: OutputLimits;
  readonly values?: Readonly<Record<NodeId, ValuesData>>;
  readonly trusted?: boolean;
}

/** A harness over an existing directory `root` (the scanned root, label "."). */
export function harness(root: string, options: HarnessOptions = {}): RenderHarness {
  const opened = openRoot(root);
  if (!opened.ok) throw new Error("test helper: root");
  const scan = opened.root;
  const cacheRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-cache-")));
  const work = createWorkDir(cacheRoot, options.trusted ?? true);
  const toolPath = options.toolPath === undefined ? fakePath() : options.toolPath;
  const runner = createCommandRunner({
    binaries: toolPath === null ? {} : { helm: findTool("helm", toolPath), kustomize: findTool("kustomize", toolPath) },
    env: buildChildEnv(work.homes),
    limits: options.limits ?? RUNNER_LIMITS,
  });
  const toolchain = toolPath === null ? NO_TOOLS : detectToolchain(runner, cacheRoot);
  const commands: CommandResult[] = [];
  const nf = (p: string) => ({ outcome: "not-found" as const, path: p, reasonWord: "not found" });
  const io: RenderIo = {
    walk: (label, dir, o) =>
      label === "."
        ? walkFiles(scan, dir, o)
        : { ok: false, refusal: { outcome: "not-found", path: dir, reasonWord: "not found" } },
    read: (label, p) => (label === "." ? readYaml(scan, p) : nf(p)),
    readText: (label, p) => (label === "." ? readText(scan, p) : nf(p)),
    readBytes: (label, p) => (label === "." ? readBytes(scan, p) : nf(p)),
    kind: (label, p) => (label === "." ? entryKind(scan, p) : "missing"),
    display: (label, p) => (label === "." ? p : `${label}/${p}`),
    runtime: {
      runner,
      toolchain,
      work,
      network: options.network ?? true,
      output: options.output ?? OUTPUT_LIMITS,
      valuesData: (id) => options.values?.[id] ?? null,
      record: (r) => {
        commands.push(r);
      },
      admitOutput: () => true,
      holdOutput: () => true,
    },
  };
  return {
    io,
    work,
    commands,
    root: scan.real,
    cacheRoot,
    cleanup() {
      work.cleanup();
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    },
  };
}

/** Every file under a directory (relative paths), for checking what a run left behind. */
export function listTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  if (fs.existsSync(dir)) walk(dir, "");
  return out.sort();
}

/** A snapshot of a tree: relative path to content (and mode), to prove nothing was written. */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of listTree(dir)) {
    const full = path.join(dir, ...f.split("/"));
    const st = fs.lstatSync(full);
    out[f] =
      `${st.mode.toString(8)}:${st.isSymbolicLink() ? `link:${fs.readlinkSync(full)}` : fs.readFileSync(full, "base64")}`;
  }
  return out;
}
