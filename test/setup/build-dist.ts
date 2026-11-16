// Global setup: the tests that run the built binary (the end-to-end test, the closed-pipe test)
// must never run a stale or missing `dist`. Before any test, if `dist` is older than `src` (or
// absent), it is built once with the project's own build command; a failed build fails the run.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function newest(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n = Math.max(n, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return n;
}

export default function setup(): void {
  const bin = path.join(ROOT, "dist", "u9-cli-package", "cli.js");
  if (fs.existsSync(bin) && fs.statSync(bin).mtimeMs >= newest(path.join(ROOT, "src"))) return;
  const tsc = path.join(ROOT, "node_modules", ".bin", "tsc");
  const r = spawnSync(tsc, ["-p", "tsconfig.build.json"], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error("test setup: the build failed");
}
