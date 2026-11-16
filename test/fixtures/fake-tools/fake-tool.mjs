// A fake helm and kustomize for the unit tests: real processes started by crankpath's own
// CommandRunner, whose behaviour is driven by the files of the chart or directory they are given
// (the child environment is crankpath's allowlist, so nothing else can configure them). Output is
// hand-written here or in the fixtures; nothing is copied from any published chart.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function parseArgs(args) {
  const opts = {};
  const values = [];
  let i = 0;
  while (i < args.length && args[i] !== "--") {
    const a = args[i];
    if (a === "--values") {
      values.push(args[i + 1]);
      i += 2;
    } else if (["--namespace", "--repo", "--version", "--untardir", "--template", "--load-restrictor"].includes(a)) {
      opts[a] = args[i + 1];
      i += 2;
    } else {
      opts[a] = true;
      i += 1;
    }
  }
  return { opts, values, positionals: args.slice(i + 1) };
}

function where(dir) {
  const run = path.dirname(process.env.HOME ?? "/nonexistent");
  return path.resolve(dir).startsWith(`${run}${path.sep}`) ? "private" : "elsewhere";
}

function config(dir) {
  const f = path.join(dir, "fake.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
}

/** How many times this directory was rendered before (a counter file in crankpath's private copy). */
function renderCount(dir) {
  const f = path.join(dir, ".fake-render-count");
  const n = fs.existsSync(f) ? Number(fs.readFileSync(f, "utf8")) : 0;
  fs.writeFileSync(f, String(n + 1));
  return n;
}

function behave(cfg, normal, dir) {
  switch (cfg.mode) {
    case "spawn-git": {
      // what a tool that shells out to git would reach: crankpath's child PATH decides
      const r = spawnSync("git", ["--version"], { encoding: "utf8" });
      process.stdout.write(
        `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: git-probe\ndata:\n  git: "${r.error ? "not found" : "found"}"\n  path: "${process.env.PATH ?? ""}"\n`,
      );
      return 0;
    }
    case "proxy-env": {
      const e = process.env;
      process.stdout.write(
        `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: proxy-probe\ndata:\n  HTTP_PROXY: "${e.HTTP_PROXY}"\n  HTTPS_PROXY: "${e.HTTPS_PROXY}"\n  ALL_PROXY: "${e.ALL_PROXY}"\n  NO_PROXY: "${e.NO_PROXY === "" ? "(empty)" : e.NO_PROXY}"\n`,
      );
      return 0;
    }
    case "count-content":
      process.stdout.write(
        `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: counted\ndata:\n  render: "${renderCount(dir)}"\n`,
      );
      return 0;
    case "random-content":
      process.stdout.write(
        `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: stable-name\ndata:\n  v: "${Math.random().toString(16).slice(2, 10)}"\n`,
      );
      return 0;
    case "second-fails":
      if (renderCount(dir) > 0) {
        process.stderr.write("Error: second render failed\n");
        return 1;
      }
      return normal();
    case "second-sleeps":
      if (renderCount(dir) > 0) sleep(cfg.ms ?? 20000);
      return normal();
    case "sleep":
      sleep(cfg.ms ?? 10000);
      return normal();
    case "flood":
      (cfg.stream === "stderr" ? process.stderr : process.stdout).write(`${"#".repeat(1023)}\n`.repeat(cfg.kib ?? 64));
      return 0;
    case "random":
      process.stdout.write(
        `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: r-${Math.random().toString(16).slice(2, 10)}\n`,
      );
      return 0;
    case "fail":
      process.stderr.write(cfg.stderr ?? "Error: failed\n");
      return cfg.code ?? 1;
    case "bomb":
      process.stdout.write(
        `apiVersion: v1\nkind: ConfigMap\nmetadata: {name: bomb}\ndata:\n  a: &a ["x","x","x","x","x","x","x","x","x","x"]\n  b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\n  c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\n  d: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]\n  e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]\n  f: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e,*e]\n  g: &g [*f,*f,*f,*f,*f,*f,*f,*f,*f,*f]\n  h: [*g,*g,*g,*g,*g,*g,*g,*g,*g,*g]\n---\napiVersion: v1\nkind: ConfigMap\nmetadata: {name: after-bomb}\n`,
      );
      return 0;
    default:
      return normal();
  }
}

function helmTemplate(args) {
  const { opts, values, positionals } = parseArgs(args);
  const [release, chartDir] = positionals;
  const cfg = config(chartDir);
  return behave(cfg, () => {
    if (cfg.mode === "echo") {
      const data = {
        release,
        namespace: opts["--namespace"] ?? "",
        chart: where(chartDir),
        includeCrds: String(opts["--include-crds"] === true),
        skipSchemaValidation: String(opts["--skip-schema-validation"] === true),
        envKeys: Object.keys(process.env).sort().join(","),
        kubeconfig: process.env.KUBECONFIG ?? "",
        valuesCount: String(values.length),
      };
      values.forEach((v, i) => {
        data[`values-${i + 1}`] = fs.readFileSync(v, "utf8");
        data[`mode-${i + 1}`] = (fs.statSync(v).mode & 0o777).toString(8);
        data[`where-${i + 1}`] = where(v);
      });
      const charts = path.join(chartDir, "charts");
      data.vendored = fs.existsSync(charts) ? fs.readdirSync(charts).sort().join(",") : "";
      process.stdout.write(`---\n# Source: echo\n${YAML.stringify({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "echo" }, data })}`);
      return 0;
    }
    const f = path.join(chartDir, "fake-render.yaml");
    if (!fs.existsSync(f)) {
      // a chart whose templates are plain YAML (no template functions): helm renders them as written
      const templates = path.join(chartDir, "templates");
      const plain = fs.existsSync(path.join(chartDir, "fake-plain-templates"))
        ? fs.readdirSync(templates).filter((n) => n.endsWith(".yaml")).sort()
        : [];
      if (plain.length === 0) {
        process.stderr.write("Error: fake helm has nothing to render\n");
        return 1;
      }
      for (const n of plain)
        process.stdout.write(`---\n# Source: ${n}\n${fs.readFileSync(path.join(templates, n), "utf8")}`);
      return 0;
    }
    process.stdout.write(fs.readFileSync(f, "utf8").replaceAll("RELEASE", release));
    return 0;
  }, chartDir);
}

function helmPull(args) {
  const { opts, positionals } = parseArgs(args);
  const target = positionals[0];
  const url = opts["--repo"] ?? target;
  const host = new URL(url.replace(/^oci:/, "https:")).host;
  const name = opts["--repo"] === undefined ? target.slice(target.lastIndexOf("/") + 1) : target;
  if (host === "forbidden.example.org") {
    process.stderr.write("Error: failed to fetch https://forbidden.example.org/index.yaml : 403 Forbidden\n");
    return 1;
  }
  if (host === "missing.example.org") {
    process.stderr.write("Error: chart \"x\" version \"1.0.0\" not found in https://missing.example.org repository\n");
    return 1;
  }
  if (host === "unreachable.example.org") {
    process.stderr.write("Error: Get \"https://unreachable.example.org/index.yaml\": dial tcp: lookup unreachable.example.org: no such host\n");
    return 1;
  }
  if (host === "slow.example.org") sleep(10000);
  const v = opts["--version"];
  // helm resolves an exact version with or without a leading v to the chart's own version
  const version = v !== undefined && /^v?\d+\.\d+\.\d+$/.test(v) ? v.replace(/^v/, "") : "1.2.3";
  // an OCI chart whose own name differs from the last segment of its reference
  const own = host === "ocirename.example.org" ? "internal" : name;
  const dir = path.join(opts["--untardir"], host === "renamed.example.org" ? "other" : own);
  fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Chart.yaml"), `apiVersion: v2\nname: ${own}\nversion: ${version}\n`);
  fs.writeFileSync(path.join(dir, "values-extra.yaml"), "extra: true\n");
  fs.writeFileSync(
    path.join(dir, "fake-render.yaml"),
    `---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: RELEASE-${name}\n  labels: {chart-version: "${version}"}\ndata: {pulled: "yes"}\n`,
  );
  if (host === "symlink.example.org") fs.symlinkSync("/etc/hosts", path.join(dir, "templates", "link.yaml"));
  return 0;
}

function helmDependencyBuild(args) {
  const { positionals } = parseArgs(args);
  const chartDir = positionals[0];
  const cfg = config(chartDir);
  if (cfg.depBuild === "fail") {
    process.stderr.write("Error: no repository definition\n");
    return 1;
  }
  fs.mkdirSync(path.join(chartDir, "charts"), { recursive: true });
  fs.writeFileSync(path.join(chartDir, "charts", "built.tgz"), "fake archive");
  return 0;
}

function kustomizeObjects(dir) {
  const kfile = ["kustomization.yaml", "kustomization.yml", "Kustomization"].map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
  const k = YAML.parse(fs.readFileSync(kfile, "utf8")) ?? {};
  const out = [];
  for (const r of k.resources ?? []) {
    const p = path.join(dir, r);
    if (fs.statSync(p).isDirectory()) out.push(...kustomizeObjects(p));
    else out.push(...YAML.parseAllDocuments(fs.readFileSync(p, "utf8")).map((d) => d.toJS()).filter(Boolean));
  }
  for (const o of out) {
    o.metadata ??= {};
    if (k.namespace) o.metadata.namespace = k.namespace;
    o.metadata.annotations = { ...(o.metadata.annotations ?? {}), "fake/dir": where(dir) };
  }
  return out;
}

function kustomizeBuild(args) {
  const { opts, positionals } = parseArgs(args);
  const dir = positionals[0];
  if (opts["--load-restrictor"] !== "LoadRestrictionsRootOnly") return 3;
  const cfg = config(dir);
  return behave(cfg, () => {
    const f = path.join(dir, "fake-render.yaml");
    if (fs.existsSync(f)) {
      process.stdout.write(fs.readFileSync(f, "utf8"));
      return 0;
    }
    process.stdout.write(kustomizeObjects(dir).map((o) => `---\n${YAML.stringify(o)}`).join(""));
    return 0;
  }, dir);
}

export function run(tool, version) {
  const args = process.argv.slice(2);
  let code = 0;
  if (args[0] === "version") {
    if (version === "ENV") process.stdout.write(JSON.stringify(process.env));
    else process.stdout.write(`${version}\n`);
  } else if (tool === "helm" && args[0] === "template") code = helmTemplate(args.slice(1));
  else if (tool === "helm" && args[0] === "pull") code = helmPull(args.slice(1));
  else if (tool === "helm" && args[0] === "dependency" && args[1] === "build") code = helmDependencyBuild(args.slice(2));
  else if (tool === "kustomize" && args[0] === "build") code = kustomizeBuild(args.slice(1));
  else {
    process.stderr.write(`fake ${tool}: unexpected command\n`);
    code = 2;
  }
  process.exitCode = code;
}
