// Test helpers: write a small estate to a temporary directory and run the command line in-process.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../../src/u9-cli-package/cli-shell.js";

export const FIXTURE = fileURLToPath(new URL("../fixtures/thin-slice/", import.meta.url));
export const THIN_SLICE_URL = "http://gitea-http.gitea:3000/ops/thin-slice";

export interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function run(argv: readonly string[], cwd: string): Run {
  let stdout = "";
  let stderr = "";
  const code = main(argv, {
    stdout: (t) => {
      stdout += t;
    },
    stderr: (t) => {
      stderr += t;
    },
    cwd,
  });
  return { code, stdout, stderr };
}

/** A fresh temporary directory; the caller removes it. */
export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `crankpath-${prefix}-`));
}

/** Writes files (relative path to content) under a new temporary root and returns it. */
export function estate(files: Readonly<Record<string, string>>): string {
  const root = tempDir("estate");
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** A copy of the thin-slice repo under a new temporary directory. */
export function copyThinSlice(): string {
  const dir = tempDir("thin");
  fs.cpSync(path.join(FIXTURE, "repo"), path.join(dir, "repo"), { recursive: true });
  return path.join(dir, "repo");
}

export function app(name: string, sourcePath: string, repoURL = THIN_SLICE_URL, extra = ""): string {
  return [
    "apiVersion: argoproj.io/v1alpha1",
    "kind: Application",
    "metadata:",
    `  name: ${name}`,
    "  namespace: argocd",
    "spec:",
    "  source:",
    `    repoURL: ${repoURL}`,
    `    path: ${sourcePath}`,
    extra,
    "  destination:",
    "    server: https://kubernetes.default.svc",
    `    namespace: ${name}`,
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
