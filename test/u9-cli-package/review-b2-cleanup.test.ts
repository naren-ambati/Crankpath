// B2 review m3: the cache root ignores itself for git, a run killed earlier leaves no private
// directory behind once crankpath runs again, and an interrupt (SIGINT or SIGTERM to the process
// group, as a terminal's Ctrl-C) removes the run's private directory before crankpath exits.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { fakePath } from "../helpers/render.js";
import { run, tempDir } from "../helpers/scan.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/render/repo/", import.meta.url));
const BIN = fileURLToPath(new URL("../../dist/u9-cli-package/cli.js", import.meta.url));
const URL_ = "https://example.org/ops/render-demo";
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

function copy(): { repo: string; cache: string } {
  const dir = tempDir("cleanup");
  cleanup.push(dir);
  fs.cpSync(FIXTURE, path.join(dir, "repo"), { recursive: true });
  return { repo: path.join(dir, "repo"), cache: path.join(dir, "cache") };
}

describe("the cache directory and leftover private directories (m3)", () => {
  it("writes a .gitignore of * into the cache root when it first uses it", () => {
    const { repo, cache } = copy();
    expect(run([repo, "--repo-url", URL_, "--cache-dir", cache], "/", fakePath()).code).toBe(0);
    expect(fs.readFileSync(path.join(cache, ".gitignore"), "utf8")).toBe("*\n");
  });
  it("removes a run directory of a process that is gone, and keeps one of a live process", () => {
    const { repo, cache } = copy();
    const stale = path.join(cache, "tmp", "run-999999-0123456789ab");
    const live = path.join(cache, "tmp", `run-${process.pid}-0123456789ab`);
    for (const d of [stale, live]) {
      fs.mkdirSync(path.join(d, "values-1"), { recursive: true });
      fs.writeFileSync(path.join(d, "values-1", "values-1.yaml"), "secret: decoded\n");
    }
    expect(run([repo, "--repo-url", URL_, "--cache-dir", cache], "/", fakePath()).code).toBe(0);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(live)).toBe(true);
  });
});

describe("a signal ends crankpath at once; the next run removes what it left (B2 review pass 2, M2)", () => {
  it.each([
    ["SIGTERM to crankpath alone", "SIGTERM", false],
    ["SIGINT to the process group (Ctrl-C)", "SIGINT", true],
  ] as const)("%s: the process ends by the signal within seconds, mid-render", async (_name, signal, group) => {
    const { repo, cache } = copy();
    fs.writeFileSync(path.join(repo, "charts", "web", "fake.json"), '{"mode":"sleep","ms":30000}');
    const child = spawn(process.execPath, [BIN, repo, "--repo-url", URL_, "--cache-dir", cache], {
      env: { PATH: fakePath() },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
      child.on("exit", (code, sig) => resolve({ code, signal: sig })),
    );
    const tmp = path.join(cache, "tmp");
    const t0 = Date.now();
    while (!(fs.existsSync(tmp) && fs.readdirSync(tmp).some((n) => n.startsWith("run-"))) && Date.now() - t0 < 20000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 300));
    const sentAt = Date.now();
    process.kill(group ? -(child.pid as number) : (child.pid as number), signal);
    const ended = await exited;
    expect(ended).toEqual({ code: null, signal });
    // derived, not picked: a crankpath that waited for the render would end only after the fake's 30 s sleep
    expect(Date.now() - sentAt).toBeLessThan(30_000);
    expect(stdout).toBe("");
    // the killed run's private directory is left, and the next run removes it (its process is gone)
    if (!group) {
      try {
        process.kill(-(child.pid as number), "SIGKILL");
      } catch {
        // the fake helm may already be gone
      }
    }
    expect(fs.readdirSync(tmp).some((n) => n.startsWith("run-"))).toBe(true);
    fs.rmSync(path.join(repo, "charts", "web", "fake.json"));
    expect(run([repo, "--repo-url", URL_, "--cache-dir", cache], "/", fakePath()).code).toBe(0);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });
});

describe("--help says what a signal does (M2)", () => {
  it("prints the signal behaviour after the options", () => {
    expect(run(["--help"], "/").stdout).toContain("Signals: SIGINT or SIGTERM ends crankpath at once");
    // a running tool is not stopped by a signal to crankpath alone (B2 review pass 3, m2)
    expect(run(["--help"], "/").stdout.replace(/\s+/g, " ")).toContain(
      "A helm or kustomize it is running is not stopped (a terminal's Ctrl-C reaches it too, a signal to crankpath alone does not) and runs on with no time limit",
    );
  });
});
