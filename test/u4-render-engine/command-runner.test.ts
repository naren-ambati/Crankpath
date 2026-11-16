import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { withValue } from "../support/limits.js";
import {
  ALLOWED_COMMANDS,
  buildChildEnv,
  CHILD_ENV_KEYS,
  CommandRefused,
  type CommandRequest,
  checkAllowed,
  createCommandRunner,
  OUTCOME_WORDS,
  type Spawn,
} from "../../src/u4-render-engine/command-runner.js";
import { findTool } from "../../src/u4-render-engine/toolchain.js";
import { createWorkDir } from "../../src/u4-render-engine/work-dir.js";
import { fakePath } from "../helpers/render.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-runner-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const work = createWorkDir(path.join(tmp, "cache"), true);
const req = (tool: string, subcommand: string[], args: string[] = []): CommandRequest =>
  ({ tool, subcommand, args, cwd: tmp }) as CommandRequest;

describe("CommandRunner allowlist (BR4.17, C12)", () => {
  it("allows exactly the six (tool, subcommand) pairs of FR3.8 and the six git forms of C12 (B3)", () => {
    expect(ALLOWED_COMMANDS.map((c) => `${c.tool} ${c.subcommand.join(" ")}`)).toEqual([
      "helm template",
      "helm dependency build",
      "helm pull",
      "helm version",
      "kustomize build",
      "kustomize version",
      "git clone",
      "git fsck --strict --no-dangling --no-progress",
      "git rev-parse --verify HEAD^{commit}",
      "git ls-tree -r -l -z HEAD",
      "git read-tree HEAD",
      "git checkout-index --all --force --quiet",
    ]);
  });
  it("refuses git: it runs only through the git runner, with its fixed options and process group (B3)", () => {
    const runner = createCommandRunner({ binaries: { git: "/usr/bin/git" }, env: {} });
    expect(() =>
      runner.run({ tool: "git", subcommand: ["rev-parse", "--verify", "HEAD"], args: [], cwd: "/tmp" }),
    ).toThrow(CommandRefused);
  });
  it.each([
    ["helm", ["install"]],
    ["helm", ["upgrade"]],
    ["helm", ["uninstall"]],
    ["helm", ["rollback"]],
    ["helm", ["dependency", "update"]],
    ["helm", ["plugin", "install"]],
    ["helm", ["repo", "add"]],
    ["helm", ["registry", "login"]],
    ["helm", ["get"]],
    ["kubectl", ["apply"]],
    ["kubectl", ["get"]],
    ["kustomize", ["edit"]],
    ["kustomize", ["create"]],
    ["git", ["fetch"]],
    ["git", ["clone"]],
    ["sh", ["-c"]],
  ])("refuses %s %s before any process exists", (tool, sub) => {
    expect(() => checkAllowed(req(tool, sub, []))).toThrow(CommandRefused);
  });
  it.each([
    [["--dry-run=server", "--", "r", "/c"]],
    [["--dry-run", "server", "--", "r", "/c"]],
    [["--kubeconfig", "/k", "--", "r", "/c"]],
    [["--kube-context", "x", "--", "r", "/c"]],
    [["--kube-apiserver", "https://x", "--", "r", "/c"]],
    [["--validate", "--", "r", "/c"]],
    [["--post-renderer", "/bin/sh", "--", "r", "/c"]],
    [["--set", "a=b", "--", "r", "/c"]],
    [["--set-file", "a=/etc/passwd", "--", "r", "/c"]],
    [["-f", "v.yaml", "--", "r", "/c"]],
    [["--values=v.yaml", "--", "r", "/c"]],
    [["--namespace", "--", "r", "/c"]],
    [["r", "/c"]],
    [["--", "r"]],
    [["--", "r", "/c", "extra"]],
    [["--", "", "/c"]],
  ])("refuses helm template %j", (args) => {
    expect(() => checkAllowed(req("helm", ["template"], args))).toThrow(CommandRefused);
  });
  it.each([
    [["--enable-helm", "--", "/d"]],
    [["--enable-alpha-plugins", "--", "/d"]],
    [["--enable-exec", "--", "/d"]],
    [["--network", "--", "/d"]],
    [["--load-restrictor", "LoadRestrictionsNone", "--", "/d"]],
    [["--load-restrictor=LoadRestrictionsRootOnly", "--", "/d"]],
    [["--output", "/tmp/x", "--", "/d"]],
  ])("refuses kustomize build %j", (args) => {
    expect(() => checkAllowed(req("kustomize", ["build"], args))).toThrow(CommandRefused);
  });
  it.each([
    [["--repo", "http://charts.example.org", "--", "x"]],
    [["--repo", "https://127.0.0.1", "--", "x"]],
    [["--repo", "https://u:p@charts.example.org", "--", "x"]],
    [["--", "oci://10.0.0.1/charts/x"]],
    [["--", "https://charts.example.org/x"]],
    [["--repo", "https://charts.example.org", "--", "oci://registry.example.org/x"]],
    [["--username", "u", "--", "oci://registry.example.org/x"]],
    [["--pass-credentials", "--repo", "https://charts.example.org", "--", "x"]],
  ])("refuses helm pull %j", (args) => {
    expect(() => checkAllowed(req("helm", ["pull"], args))).toThrow(CommandRefused);
  });
  it("accepts the forms crankpath builds", () => {
    expect(() =>
      checkAllowed(
        req("helm", ["template"], ["--namespace", "a", "--include-crds", "--values", "/v", "--", "r", "/c"]),
      ),
    ).not.toThrow();
    expect(() =>
      checkAllowed(req("kustomize", ["build"], ["--load-restrictor", "LoadRestrictionsRootOnly", "--", "/d"])),
    ).not.toThrow();
    expect(() =>
      checkAllowed(
        req(
          "helm",
          ["pull"],
          ["--repo", "https://charts.example.org", "--version", "1.0.0", "--untar", "--untardir", "/d", "--", "x"],
        ),
      ),
    ).not.toThrow();
    expect(() =>
      checkAllowed(req("helm", ["pull"], ["--untar", "--untardir", "/d", "--", "oci://registry.example.org/c/x"])),
    ).not.toThrow();
    expect(() => checkAllowed(req("helm", ["version"], ["--template", "{{.Version}}"]))).not.toThrow();
    expect(() => checkAllowed(req("helm", ["version"], ["--template", "{{.GitCommit}}"]))).toThrow(CommandRefused);
  });
  it("refuses through run() too, so no code path can start a forbidden process", () => {
    let spawned = 0;
    const spawn: Spawn = () => {
      spawned += 1;
      return { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    };
    const runner = createCommandRunner({ binaries: { helm: "/x/helm" }, env: {}, spawn });
    expect(() => runner.run(req("helm", ["install"], ["--", "r", "/c"]))).toThrow(CommandRefused);
    expect(() => runner.run(req("helm", ["template"], ["--dry-run=server", "--", "r", "/c"]))).toThrow(CommandRefused);
    expect(spawned).toBe(0);
    runner.run(req("helm", ["version"], ["--template", "{{.Version}}"]));
    expect(spawned).toBe(1);
  });
});

describe("the child environment (BR4.18, C12)", () => {
  it("is exactly the allowlist, with helm's homes under the private directory and no cluster", () => {
    const env = buildChildEnv(work.homes);
    expect(Object.keys(env)).toEqual([...CHILD_ENV_KEYS]);
    expect(env.KUBECONFIG).toBe("/dev/null");
    for (const k of [
      "HOME",
      "HELM_CONFIG_HOME",
      "HELM_CACHE_HOME",
      "HELM_DATA_HOME",
      "HELM_PLUGINS",
      "DOCKER_CONFIG",
    ] as const) {
      expect(String(env[k]).startsWith(work.runDir + path.sep), k).toBe(true);
    }
    expect(env.HELM_NO_PLUGINS).toBe("1");
  });
  it("never reaches a real child with a planted credential, token, kubeconfig or proxy", () => {
    const planted = {
      AWS_ACCESS_KEY_ID: "AKIAPLANTED",
      AWS_SECRET_ACCESS_KEY: "planted-secret",
      GOOGLE_APPLICATION_CREDENTIALS: "/planted/gcp.json",
      AZURE_CLIENT_SECRET: "planted-azure",
      GITHUB_TOKEN: "ghp_planted",
      ACTIONS_RUNTIME_TOKEN: "planted-actions",
      CRANKPATH_TOKEN_EXAMPLE_ORG: "planted-crankpath-token",
      KUBECONFIG: "/planted/kubeconfig",
      HELM_REGISTRY_CONFIG: "/planted/registry.json",
      HELM_KUBECONTEXT: "planted",
      DOCKER_CONFIG: "/planted/docker",
      HTTPS_PROXY: "https://user:pass@proxy.example.org",
      SSH_AUTH_SOCK: "/planted/ssh.sock",
    };
    const saved = { ...process.env };
    Object.assign(process.env, planted);
    try {
      const toolPath = fakePath("garbled");
      fs.mkdirSync(path.dirname(work.homes.home), { recursive: true });
      const runner = createCommandRunner({
        binaries: { kustomize: findTool("kustomize", toolPath) },
        env: buildChildEnv(work.homes),
      });
      // the garbled fake kustomize prints its whole environment as its "version"
      const r = runner.run(req("kustomize", ["version"]));
      expect(r.outcome).toBe("ok");
      const childEnv = JSON.parse(r.stdout.toString("utf8")) as Record<string, string>;
      const extra = Object.keys(childEnv).filter((k) => !(CHILD_ENV_KEYS as readonly string[]).includes(k));
      // the only names a child may add itself are the shell's own bookkeeping of `env`
      expect(extra.filter((k) => !["_", "PWD", "SHLVL", "OLDPWD", "__CF_USER_TEXT_ENCODING"].includes(k))).toEqual([]);
      const text = JSON.stringify(childEnv);
      for (const value of Object.values(planted)) expect(text).not.toContain(value);
      expect(childEnv.KUBECONFIG).toBe("/dev/null");
    } finally {
      for (const k of Object.keys(planted)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe("caps and the wall clock (BR4.19, BR4.2, OD-30)", () => {
  const chart = (cfg: object) => {
    const d = fs.mkdtempSync(path.join(tmp, "chart-"));
    fs.writeFileSync(path.join(d, "fake.json"), JSON.stringify(cfg));
    return d;
  };
  const runnerWith = (limits: Partial<{ wall: number; out: number; err: number }>) =>
    createCommandRunner({
      binaries: { helm: findTool("helm", fakePath()) },
      env: buildChildEnv(work.homes),
      limits: {
        wallClock: withValue(LIMITS.renderWallClock, limits.wall ?? 30_000, "test"),
        stdoutBytes: withValue(LIMITS.renderStdoutBytes, limits.out ?? 1_000_000, "test"),
        stderrBytes: withValue(LIMITS.renderStderrBytes, limits.err ?? 1_000_000, "test"),
      },
    });
  const template = (dir: string) => req("helm", ["template"], ["--", "r", dir]);
  it("stops a child past the wall clock: timed out, never retried", () => {
    const t0 = Date.now();
    const r = runnerWith({ wall: 1500 }).run(template(chart({ mode: "sleep", ms: 20000 })));
    expect(r.outcome).toBe("timed-out");
    expect(r.timedOut).toBe(true);
    expect(OUTCOME_WORDS[r.outcome]).toBe("timed out");
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(r.stdout.length).toBe(0);
  });
  it("stops a child over the standard-output cap: over cap, nothing kept", () => {
    const r = runnerWith({ out: 10_000 }).run(template(chart({ mode: "flood", kib: 64 })));
    expect(r).toMatchObject({ outcome: "over-cap", overCap: "stdout", timedOut: false });
    expect(OUTCOME_WORDS[r.outcome]).toBe("over cap");
    expect(r.stdout.length).toBe(0);
  });
  it("names standard error when it is the stream over its cap", () => {
    const r = runnerWith({ out: 1_000_000, err: 10_000 }).run(
      template(chart({ mode: "flood", stream: "stderr", kib: 64 })),
    );
    expect(r).toMatchObject({ outcome: "over-cap", overCap: "stderr" });
  });
  it("reports a non-zero exit as failed, and an absent binary as not started", () => {
    const failed = runnerWith({}).run(template(chart({ mode: "fail", code: 3 })));
    expect(failed).toMatchObject({ outcome: "failed", exitCode: 3 });
    const absent = createCommandRunner({ binaries: {}, env: {} }).run(template("/c"));
    expect(absent.outcome).toBe("not-started");
    const gone = createCommandRunner({ binaries: { helm: path.join(tmp, "no-such-helm") }, env: {} }).run(
      template("/c"),
    );
    expect(gone.outcome).toBe("not-started");
  });
  it("passes arguments as an array: a shell metacharacter is only text", () => {
    const d = chart({ mode: "render" });
    fs.writeFileSync(path.join(d, "fake-render.yaml"), "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: RELEASE}\n");
    const r = runnerWith({}).run(req("helm", ["template"], ["--", "a;touch-x", d]));
    expect(r.outcome).toBe("ok");
    expect(r.stdout.toString()).toContain("name: a;touch-x");
    expect(fs.existsSync(path.join(tmp, "touch-x"))).toBe(false);
  });
});
