#!/usr/bin/env node
// The live-render lane (`npm run verify:live`, after `npm run build`): the built crankpath with the
// real helm and kustomize on PATH, on crankpath's own fixtures and, over the network (read-only),
// on one pinned public chart. Each check prints PASS, FAIL or SKIPPED with its reason; a SKIPPED
// check (a tool or the network missing) is never a pass, and the last line says how many were
// skipped. Exit 1 when any check fails, 2 when none failed but any was skipped, 0 only when all ran. Nothing is written outside a temporary directory (the
// fixtures are copied there, the caches live there) and nothing of the public chart is kept.
//
// Checks:
//   1. the toolchain is detected and recorded;
//   2. the render fixture with the real tools gives exactly the nodes and edges it gives with the
//      unit tests' fake tools (which replay recorded output of the same charts);
//   3. the hostile fixture fails closed with the real tools, naming each reason;
//   4. hashicorp/vault-helm 0.34.1 from its public repository renders as releases `vault` and
//      `platform-secrets` (network), then again from the chart cache with --no-network.

import { spawn, spawnSync } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const bin = path.join(root, "dist", "u9-cli-package", "cli.js");
const fixtures = path.join(root, "test", "fixtures");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-live-"));
// the unit tests' fake helm and kustomize, written with this node's absolute path as their
// interpreter (crankpath gives its children an empty PATH)
const fakeBin = path.join(tmp, "fake-bin");
fs.mkdirSync(fakeBin);
for (const [name, version] of /** @type {[string, string][]} */ ([
  ["helm", "v4.3.2"],
  ["kustomize", "v5.8.1"],
])) {
  const tool = pathToFileURL(path.join(fixtures, "fake-tools", "fake-tool.mjs")).href;
  fs.writeFileSync(
    path.join(fakeBin, name),
    `#!${process.execPath}\nimport(${JSON.stringify(tool)}).then((m) => m.run(${JSON.stringify(name)}, ${JSON.stringify(version)}));\n`,
    { mode: 0o755 },
  );
}
const fake = [fakeBin, path.dirname(process.execPath)].join(path.delimiter);

/** @type {{ name: string, result: "PASS" | "FAIL" | "SKIPPED", why: string }[]} */
const results = [];
/** @param {string} name @param {"PASS" | "FAIL" | "SKIPPED"} result @param {string} why */
function report(name, result, why) {
  results.push({ name, result, why });
  console.log(`${result}  ${name}${why === "" ? "" : `  (${why})`}`);
}

/** @param {string[]} args @param {string} toolPath @param {string} cwd */
function crankpath(args, toolPath, cwd = tmp) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    env: { PATH: toolPath },
    maxBuffer: 256 * 1024 * 1024,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ms: Math.round(performance.now() - t0) };
}

/** @param {string} name */
function onPath(name) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir === "" || !path.isAbsolute(dir)) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      if (st.isFile() && (st.mode & 0o111) !== 0) return true;
    } catch {
      // not here
    }
  }
  return false;
}

/** @param {string} from @param {string} name */
function copy(from, name) {
  const to = path.join(tmp, name);
  fs.cpSync(from, to, { recursive: true });
  return to;
}

/** @param {{ nodes: { id: string }[], edges: { from: string, to: string, kind: string }[] }} j */
const shape = (j) => ({
  nodes: j.nodes.map((n) => n.id),
  edges: j.edges.map((e) => `${e.from} ${e.kind} ${e.to}`),
});

/** @param {boolean} ok @param {string} name @param {string} why */
const check = (ok, name, why) => report(name, ok ? "PASS" : "FAIL", why);

try {
  if (!fs.existsSync(bin)) throw new Error("dist is missing: run npm run build first");
  const realPath = process.env.PATH ?? "";
  const tools = { helm: onPath("helm"), kustomize: onPath("kustomize") };
  console.log(`crankpath live-render lane, node ${process.version}, ${process.platform} ${process.arch}`);

  // 1. toolchain
  const version = crankpath(["--version"], realPath);
  console.log(version.stdout.trimEnd().replace(/^/gm, "  "));
  if (!tools.helm || !tools.kustomize) {
    report("toolchain detected", "SKIPPED", `${!tools.helm ? "helm" : "kustomize"} not found on PATH`);
  } else {
    check(
      /helm: v\d+\.\d+\.\d+/.test(version.stdout) && /kustomize: v\d+\.\d+\.\d+/.test(version.stdout),
      "toolchain detected",
      version.stdout.includes("(tested)\nkustomize") && version.stdout.endsWith("(tested)\n")
        ? "the tested pair"
        : "not the tested pair: see the note",
    );
  }

  // 2. the render fixture, real tools against the recorded output the fake tools replay
  if (!tools.helm || !tools.kustomize) {
    report("render fixture: real tools match the recorded output", "SKIPPED", "helm or kustomize not found on PATH");
  } else {
    const repo = copy(path.join(fixtures, "render", "repo"), "render");
    const args = [repo, "--repo-url", "https://example.org/ops/render-demo", "--format", "json", "--no-network"];
    const real = crankpath([...args, "--cache-dir", path.join(tmp, "c-real")], realPath);
    const replay = crankpath([...args, "--cache-dir", path.join(tmp, "c-fake")], fake);
    const a = JSON.parse(real.stdout);
    const b = JSON.parse(replay.stdout);
    console.log(
      `  real tools: exit ${real.code}, ${real.ms} ms, ${a.nodes.length} nodes, ${a.edges.length} edges, ${a.opaque.length} opaque; recorded: ${b.nodes.length} nodes, ${b.edges.length} edges`,
    );
    check(
      real.code === 0 && JSON.stringify(shape(a)) === JSON.stringify(shape(b)),
      "render fixture: real tools match the recorded output",
      `${a.toolchain.helm} and ${a.toolchain.kustomize}`,
    );
    const ids = a.nodes.map((/** @type {{ id: string }} */ n) => n.id);
    check(
      ["Deployment/web/web", "Deployment/platform/platform-agent", "Deployment/edge/edge-web"].every((id) =>
        ids.includes(id),
      ) &&
        !ids.some((/** @type {string} */ id) => id.endsWith("-test")) &&
        !real.stdout.includes("fixture-render-secret-not-printed"),
      "render fixture: chart, overlay and HelmRelease objects in the graph; test hook dropped; no Secret value",
      "",
    );
  }

  // 3. the hostile fixture, with a loopback listener (a separate process) the hostile URLs point
  // at and a logging `git` first on PATH: neither may ever be reached
  if (!tools.helm || !tools.kustomize) {
    report("hostile fixture fails closed", "SKIPPED", "helm or kustomize not found on PATH");
  } else {
    const repo = copy(path.join(fixtures, "render", "hostile"), "hostile");
    fs.symlinkSync("/etc/hosts", path.join(repo, "charts", "linked", "templates", "hosts.yaml"));
    const requests = path.join(tmp, "requests.log");
    const server = spawn(
      process.execPath,
      [
        "-e",
        `const fs=require("fs");const s=require("http").createServer((q,r)=>{fs.appendFileSync(${JSON.stringify(requests)},q.method+" "+q.url+"\\n");r.end("{}")});s.listen(0,"127.0.0.1",()=>console.log(s.address().port));`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const port = await new Promise((resolve) => server.stdout.once("data", (d) => resolve(String(d).trim())));
    for (const [file, from] of /** @type {[string, string][]} */ ([
      ["charts/req-http/requirements.yaml", "18765"],
      ["charts/schema-ref/values.schema.json", "18767"],
      ["kustomize/plugin-transformer/t.yaml", "18768"],
      ["kustomize/plugin-generator/g.yaml", "18768"],
      ["kustomize/tag-binary-patch/kustomization.yaml", "18768"],
      ["kustomize/tag-binary-config/t.yaml", "18768"],
      ["kustomize/tag-key/kustomization.yaml", "18768"],
    ])) {
      const f = path.join(repo, ...file.split("/"));
      // a `!!binary` value holds the URL as base64: decoded, given the port, encoded again
      const binary = (/** @type {string} */ _m, /** @type {string} */ b64) =>
        `!!binary ${Buffer.from(Buffer.from(b64, "base64").toString("utf8").replace(from, String(port))).toString("base64")}`;
      fs.writeFileSync(
        f,
        fs
          .readFileSync(f, "utf8")
          .replace(from, String(port))
          .replace(/!!binary (\S+)/g, binary),
      );
    }
    const gitBin = path.join(tmp, "git-bin");
    const gitLog = path.join(tmp, "git.log");
    fs.mkdirSync(gitBin);
    fs.writeFileSync(
      path.join(gitBin, "git"),
      `#!/bin/sh\necho "GIT CALLED: $*" >> ${JSON.stringify(gitLog)}\nexit 1\n`,
      { mode: 0o755 },
    );
    const r = crankpath(
      [
        repo,
        "--repo-url",
        "https://example.org/ops/hostile",
        "--format",
        "json",
        "--no-network",
        "--verbose",
        "--cache-dir",
        path.join(tmp, "c-h"),
      ],
      [gitBin, realPath].join(path.delimiter),
    );
    server.kill();
    const j = JSON.parse(r.stdout);
    /** @param {string} n */
    const reason = (n) =>
      j.opaque.find((/** @type {{ node: string }} */ o) => o.node === `Application/argocd/${n}`)?.reason ?? "none";
    /** @type {Record<string, string[]>} the reasons real helm and kustomize give (more than one where the tool decides) */
    const expected = {
      "outside-dep": ["unsupported-field"],
      "url-resource": ["remote-base"],
      escape: ["render-failed"],
      linked: ["unreadable-file"],
      bomb: ["render-failed", "limit"],
      lookup: ["none"],
      "case-repo": ["unsupported-field"],
      "req-http": ["unsupported-field"],
      "req-lock": ["unsupported-field"],
      "schema-ref": ["none"],
      random: ["render-failed"],
      "lookup-host": ["none"],
      "anchor-chart": ["unsupported-field"],
      "case-resources": ["unsupported-field"],
      "upper-resources": ["unsupported-field"],
      "unknown-key": ["unsupported-field"],
      "ssh-resources": ["unsupported-field"],
      "exec-generator": ["render-failed"],
      "helmcharts-case": ["unsupported-field"],
      "anchor-kz": ["unsupported-field"],
      "block-generator": ["unsupported-field"],
      "plugin-transformer": ["unsupported-field"],
      "plugin-generator": ["unsupported-field"],
      "tag-binary-patch": ["unsupported-field"],
      "tag-binary-config": ["unsupported-field"],
      "tag-key": ["unsupported-field"],
    };
    const got = Object.keys(expected).map((n) => `${n}=${reason(n)}`);
    const wrong = Object.entries(expected)
      .filter(([n, ok]) => !ok.includes(reason(n)))
      .map(([n]) => n);
    const reached = fs.existsSync(requests) ? fs.readFileSync(requests, "utf8").trim().split("\n").length : 0;
    const gitCalls = fs.existsSync(gitLog) ? fs.readFileSync(gitLog, "utf8").trim().split("\n").length : 0;
    const execRan = fs.existsSync(path.join(repo, "kustomize", "exec-generator", "EXEC-FUNCTION-RAN"));
    console.log(`  hostile: exit ${r.code}, ${r.ms} ms, ${got.join(" ")}`);
    console.log(
      `  loopback requests: ${reached}; git calls: ${gitCalls}; exec function ran: ${execRan ? "yes" : "no"}`,
    );
    check(
      r.code === 0 &&
        wrong.length === 0 &&
        reached === 0 &&
        gitCalls === 0 &&
        !execRan &&
        !r.stderr.includes("dependency build"),
      "hostile fixture fails closed",
      wrong.length > 0
        ? `unexpected: ${wrong.join(", ")}`
        : "26 sources: case-variant keys, a block-scalar generator, configuration files naming URLs, YAML tags, requirements files, schema $ref, random names, host lookups, anchors, URL, ssh and exec forms",
    );
  }

  // 3b. defence in depth (B2 review pass 2, M1): kustomize run through crankpath's own runner on a
  // kustomization the pre-read would refuse (a remote base), with a logging git first on
  // crankpath's PATH: the child's PATH is empty, so kustomize finds no git to fetch with
  if (!tools.kustomize) {
    report("no git for the tools, even past a pre-read", "SKIPPED", "kustomize not found on PATH");
  } else {
    const url = (/** @type {string} */ p) => pathToFileURL(path.join(root, "dist", p)).href;
    const { buildChildEnv, createCommandRunner } = await import(url("u4-render-engine/command-runner.js"));
    const { findTool } = await import(url("u4-render-engine/toolchain.js"));
    const { createWorkDir } = await import(url("u4-render-engine/work-dir.js"));
    const gitBin = path.join(tmp, "git-bin-2");
    const gitLog = path.join(tmp, "git-2.log");
    fs.mkdirSync(gitBin);
    fs.writeFileSync(
      path.join(gitBin, "git"),
      `#!/bin/sh\necho "GIT CALLED: $*" >> ${JSON.stringify(gitLog)}\nexit 1\n`,
      { mode: 0o755 },
    );
    const dir = path.join(tmp, "remote-base");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "kustomization.yaml"),
      "resources:\n  - https://127.0.0.1:1/org/repo.git//base?ref=main\n",
    );
    const work = createWorkDir(path.join(tmp, "c-dd"), true);
    work.ensureRun();
    const parentPath = [gitBin, realPath].join(path.delimiter);
    // crankpath's own PATH holds the logging git too, so a child that inherited it would reach it
    const savedPath = process.env.PATH;
    process.env.PATH = parentPath;
    const runner = createCommandRunner({
      binaries: { kustomize: findTool("kustomize", parentPath) },
      env: buildChildEnv(work.homes),
    });
    const r = runner.run({
      tool: "kustomize",
      subcommand: ["build"],
      args: ["--load-restrictor", "LoadRestrictionsRootOnly", "--", dir],
      cwd: dir,
    });
    process.env.PATH = savedPath;
    work.cleanup();
    const gitCalls = fs.existsSync(gitLog) ? fs.readFileSync(gitLog, "utf8").trim().split("\n").length : 0;
    console.log(`  kustomize on a remote base, pre-read skipped: ${r.outcome}; git calls: ${gitCalls}`);
    check(
      r.outcome !== "ok" && gitCalls === 0,
      "no git for the tools, even past a pre-read",
      "the child's PATH is an empty private directory",
    );
  }

  // 3c. defence in depth (B2 review pass 3, M1): kustomize run through crankpath's own runner on a
  // URL resource the pre-read would refuse: its fetch goes to the closed proxy and fails there,
  // before any name is resolved (so this check needs no network). A loopback URL is never proxied
  // by Go; the listener of check 3 covers that.
  if (!tools.kustomize) {
    report("the render commands' HTTP goes to a closed proxy", "SKIPPED", "kustomize not found on PATH");
  } else {
    const url = (/** @type {string} */ p) => pathToFileURL(path.join(root, "dist", p)).href;
    const { buildChildEnv, createCommandRunner } = await import(url("u4-render-engine/command-runner.js"));
    const { findTool } = await import(url("u4-render-engine/toolchain.js"));
    const { createWorkDir } = await import(url("u4-render-engine/work-dir.js"));
    const dir = path.join(tmp, "proxy-probe");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "kustomization.yaml"),
      "resources:\n  - https://example.org/crankpath-proxy-probe.yaml\n",
    );
    const work = createWorkDir(path.join(tmp, "c-px"), true);
    work.ensureRun();
    const runner = createCommandRunner({
      binaries: { kustomize: findTool("kustomize", realPath) },
      env: buildChildEnv(work.homes),
    });
    const r = runner.run({
      tool: "kustomize",
      subcommand: ["build"],
      args: ["--load-restrictor", "LoadRestrictionsRootOnly", "--", dir],
      cwd: dir,
    });
    work.cleanup();
    const atProxy = r.stderr.toString("utf8").includes("proxyconnect tcp: dial tcp 127.0.0.1:1");
    console.log(
      `  kustomize on a URL resource, pre-read skipped: ${r.outcome}; stopped at the closed proxy: ${atProxy ? "yes" : "no"}`,
    );
    check(
      r.outcome !== "ok" && atProxy,
      "the render commands' HTTP goes to a closed proxy",
      "HTTP_PROXY, HTTPS_PROXY and ALL_PROXY name a closed loopback port, NO_PROXY is empty",
    );
  }

  // 4. a pinned public chart over the network
  let network = true;
  try {
    await dns.lookup("helm.releases.hashicorp.com");
  } catch {
    network = false;
  }
  if (!tools.helm) report("public chart hashicorp/vault-helm 0.34.1", "SKIPPED", "helm not found on PATH");
  else if (!network)
    report(
      "public chart hashicorp/vault-helm 0.34.1",
      "SKIPPED",
      "no network (helm.releases.hashicorp.com does not resolve)",
    );
  else {
    const repo = path.join(tmp, "public");
    fs.mkdirSync(path.join(repo, "apps"), { recursive: true });
    for (const release of ["vault", "platform-secrets"]) {
      fs.writeFileSync(
        path.join(repo, "apps", `${release}.yaml`),
        [
          "apiVersion: argoproj.io/v1alpha1",
          "kind: Application",
          `metadata: {name: ${release}, namespace: argocd}`,
          "spec:",
          "  source: {repoURL: 'https://helm.releases.hashicorp.com', chart: vault, targetRevision: 0.34.1}",
          `  destination: {server: 'https://kubernetes.default.svc', namespace: ${release}}`,
          "",
        ].join("\n"),
      );
    }
    const cache = path.join(tmp, "c-public");
    const online = crankpath([repo, "--format", "json", "--verbose", "--cache-dir", cache], realPath);
    const offline = crankpath([repo, "--format", "json", "--no-network", "--verbose", "--cache-dir", cache], realPath);
    const a = JSON.parse(online.stdout);
    const b = JSON.parse(offline.stdout);
    const ids = a.nodes.map((/** @type {{ id: string }} */ n) => n.id);
    console.log(
      `  network: exit ${online.code}, ${online.ms} ms, ${a.nodes.length} nodes, ${a.edges.length} edges, ${a.opaque.length} opaque; from the cache with --no-network: ${offline.ms} ms, ${b.nodes.length} nodes`,
    );
    check(
      online.code === 0 &&
        a.opaque.length === 0 &&
        [
          "StatefulSet/vault/vault",
          "Service/vault/vault",
          "ConfigMap/vault/vault-config",
          "StatefulSet/platform-secrets/platform-secrets-vault",
          "ConfigMap/platform-secrets/platform-secrets-vault-config",
        ].every((id) => ids.includes(id)) &&
        online.stderr.includes("ran helm pull: ok: 1"),
      "public chart hashicorp/vault-helm 0.34.1 rendered as vault and platform-secrets",
      "",
    );
    check(
      offline.code === 0 &&
        !offline.stderr.includes("helm pull") &&
        JSON.stringify(shape(a)) === JSON.stringify(shape(b)),
      "public chart again from the chart cache with --no-network: same graph, nothing fetched",
      "",
    );
  }
} catch (e) {
  report("live lane", "FAIL", e instanceof Error ? e.message : "error");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const n = (/** @type {string} */ r) => results.filter((x) => x.result === r).length;
console.log(
  `live-render lane: ${n("PASS")} passed, ${n("FAIL")} failed, ${n("SKIPPED")} skipped${n("SKIPPED") > 0 ? " (a skipped check is not a pass)" : ""}`,
);
// 1: a check failed; 2: nothing failed but something was skipped (never reported as a pass); 0: all ran and passed
process.exitCode = n("FAIL") > 0 ? 1 : n("SKIPPED") > 0 ? 2 : 0;
