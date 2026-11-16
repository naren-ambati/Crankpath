import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_DECLARED_FACTS } from "../../src/u1-graph-model/declared-facts.js";
import { openRoot, type ScanRoot } from "../../src/u2-intake-config/bounded-reader.js";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { withValue } from "../support/limits.js";
import { configLocation, readConfig, validateConfig } from "../../src/u2-intake-config/config-reader.js";

let base: string;
let root: ScanRoot;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-config-"));
  fs.mkdirSync(path.join(base, "root", "vendor", "ops"), { recursive: true });
  fs.mkdirSync(path.join(base, "outside"));
  fs.symlinkSync(path.join(base, "outside"), path.join(base, "root", "linked"));
  const r = openRoot(path.join(base, "root"));
  if (!r.ok) throw new Error("root");
  root = r.root;
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

function write(text: string): void {
  fs.writeFileSync(path.join(root.real, "crankpath.yaml"), text);
}

function read(text: string) {
  write(text);
  const loc = configLocation(root, undefined, base);
  if (!("dir" in loc)) throw new Error("location");
  return readConfig(loc, root);
}

const FULL = `
external:
  github.com: {cold_start: available}
  aws-kms/us-east-1: {served_by: "Service/vault/vault"}
  unknown-one:
match:
  - {host: "*.svc.cluster.local", node: "Service/gitea/gitea-http"}
  - {host: "github.com", node: "github.com"}
repos:
  "https://example.org/ops/vendor.git": {read_from: vendor/ops}
  "https://example.org/ops/remote": {fetch: true}
edges:
  - {from: "Application/argocd/a", to: "Service/gitea/gitea-http", why: "runbook says so"}
cranks:
  - {creates: "Secret/argocd/repo", by: "kubectl create secret from the vault, runbook DR-3", ref: DR-3}
  - {creates: ["render:bootstrap", "Namespace/vault"], reroutes: {node: "Application/argocd/root", to: github.com}, by: "seed"}
clusters:
  in-cluster: {labels: {env: prod}, annotations: {}}
`;

describe("crankpath.yaml: the full C2 key set (BR2.5 to BR2.7)", () => {
  it("parses every key, keeping file order for match, edges and cranks", () => {
    const r = read(FULL);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const c = r.config;
    expect(c.file).toBe("crankpath.yaml");
    expect(c.externals.map((e) => [e.name, e.coldStart, e.servedBy])).toEqual([
      ["aws-kms/us-east-1", "unspecified", "Service/vault/vault"],
      ["github.com", "available", null],
      ["unknown-one", "unspecified", null],
    ]);
    expect(c.matches.map((m) => [m.order, m.host])).toEqual([
      [0, "*.svc.cluster.local"],
      [1, "github.com"],
    ]);
    expect(c.repos.map((m) => [m.normalised, m.readFrom, m.fetch])).toEqual([
      ["example.org/ops/remote", null, true],
      ["example.org/ops/vendor", "vendor/ops", false],
    ]);
    expect(c.edges[0]).toMatchObject({ from: "Application/argocd/a", keyPath: "edges[0]" });
    expect(c.cranks.map((k) => [k.id, k.creates.length, k.reroutes.length, k.ref])).toEqual([
      ["crank:1", 1, 0, "DR-3"],
      ["crank:2", 2, 1, null],
    ]);
    expect(c.cranks[1]?.creates[0]).toEqual({ kind: "render", path: "bootstrap" });
    expect(c.clusters[0]).toMatchObject({ name: "in-cluster", labels: { env: "prod" } });
  });
  it("means no declared facts when absent or empty (BR2.6)", () => {
    fs.rmSync(path.join(root.real, "crankpath.yaml"), { force: true });
    const loc = configLocation(root, undefined, base);
    if (!("dir" in loc)) throw new Error("location");
    expect(readConfig(loc, root)).toEqual({ ok: true, config: NO_DECLARED_FACTS });
    expect(read("")).toMatchObject({ ok: true, config: { externals: [], edges: [] } });
  });
  it.each([
    ["an unknown top-level key", "extras: {}\n", "extras", "unknown key"],
    [
      "an unknown nested key",
      "external:\n  a: {cold_start: available, token_env: X}\n",
      "external.a.token_env",
      "unknown key",
    ],
    ["a duplicate key", "edges: []\nedges: []\n", "edges", "duplicate key"],
    [
      "a nested duplicate key",
      "external:\n  a: {cold_start: available}\n  a: {cold_start: unavailable}\n",
      "external.a",
      "duplicate key",
    ],
    ["a wrong type", "edges: {}\n", "edges", "expected a list"],
    [
      "a wrong cold_start",
      "external:\n  a: {cold_start: maybe}\n",
      "external.a.cold_start",
      "expected available or unavailable",
    ],
    [
      "an external with both cold_start and served_by",
      "external:\n  a: {cold_start: available, served_by: 'Service/a/b'}\n",
      "external.a",
      "needs cold_start or served_by, not both",
    ],
    ["a bad node id", "edges:\n  - {from: 'Service/x', to: 'Service/a/b', why: w}\n", "edges[0].from", "not a node id"],
    ["a missing why", "edges:\n  - {from: 'Service/a/b', to: 'Service/a/c'}\n", "edges[0].why", "expected a string"],
    ["a crank without by", "cranks:\n  - {creates: 'Secret/a/b'}\n", "cranks[0]", "a crank needs by"],
    ["a crank with nothing to do", "cranks:\n  - {by: someone}\n", "cranks[0]", "a crank needs creates or reroutes"],
    [
      "repos with both forms",
      "repos:\n  'https://example.org/a': {read_from: vendor, fetch: true}\n",
      'repos."https://example.org/a"',
      "needs read_from or fetch, not both",
    ],
    [
      "fetch not true",
      "repos:\n  'https://example.org/a': {fetch: yes please}\n",
      'repos."https://example.org/a".fetch',
      "expected true",
    ],
    [
      "an uncomparable repos URL",
      "repos:\n  'file:///etc': {read_from: vendor}\n",
      'repos."file:///etc"',
      "not a URL crankpath can compare",
    ],
    [
      "two spellings of one repo",
      "repos:\n  'https://example.org/a': {fetch: true}\n  'https://example.org/a.git': {fetch: true}\n",
      'repos."https://example.org/a.git"',
      "same repository as another entry",
    ],
    ["a bad host pattern", "match:\n  - {host: 'a b', node: x}\n", "match[0].host", "not a host pattern"],
    ["a label that is not a string", "clusters:\n  c: {labels: {a: 1}}\n", "clusters.c.labels.a", "expected a string"],
  ])("names the key path of %s", (_name, text, keyPath, problem) => {
    expect(read(text)).toEqual({ ok: false, error: { keyPath, problem } });
  });
  it.each([
    ["a parent segment", "../outside", "outside the scanned root"],
    ["an absolute path", "/etc", "outside the scanned root"],
    // built at run time so the repository holds no home-relative path literal (check-tree)
    ["an environment variable", `${"$"}HOME/x`, "names an environment variable"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal text a hostile config would hold
    ["a braced environment variable", "${GITHUB_WORKSPACE}", "names an environment variable"],
    ["a home directory", `${"~"}/checkout`, "names an environment variable"],
    ["a symlinked directory", "linked", "not a directory inside the scanned root"],
    ["a missing directory", "nope", "not a directory inside the scanned root"],
  ])("refuses a repos read_from naming %s (FR2.6, FR6.7)", (_name, readFrom, problem) => {
    const r = read(`repos:\n  "https://example.org/ops/x": {read_from: "${readFrom}"}\n`);
    expect(r).toEqual({ ok: false, error: { keyPath: 'repos."https://example.org/ops/x".read_from', problem } });
  });
  it("refuses a repos URL that names an environment variable, and a render path outside the root", () => {
    expect(read('repos:\n  "https://$TOKEN@example.org/x": {fetch: true}\n')).toMatchObject({
      ok: false,
      error: { problem: "names an environment variable" },
    });
    expect(read('cranks:\n  - {creates: "render:../up", by: me}\n')).toEqual({
      ok: false,
      error: { keyPath: "cranks[0].creates", problem: "outside the scanned root" },
    });
    // an absolute path, a parent segment inside a list, and a reroute target that is not an external name
    expect(read('cranks:\n  - {creates: "render:/etc", by: me}\n')).toEqual({
      ok: false,
      error: { keyPath: "cranks[0].creates", problem: "outside the scanned root" },
    });
    expect(read('cranks:\n  - {creates: ["Secret/a/b", "render:x/../../y"], by: me}\n')).toEqual({
      ok: false,
      error: { keyPath: "cranks[0].creates[1]", problem: "outside the scanned root" },
    });
    expect(read('cranks:\n  - {reroutes: {node: "Application/a/b", to: "a b"}, by: me}\n')).toEqual({
      ok: false,
      error: { keyPath: "cranks[0].reroutes.to", problem: "not an external name" },
    });
  });
  it("names a file-level problem with crankpath's words, never the parser's", () => {
    const bad = read("edges: [unclosed\n");
    expect(bad).toEqual({ ok: false, error: { keyPath: null, problem: "not readable", reasonWord: "not valid YAML" } });
    expect(read("a: 1\n---\nb: 2\n")).toEqual({
      ok: false,
      error: { keyPath: null, problem: "more than one document" },
    });
    expect(validateConfig(["a"], "crankpath.yaml", root)).toEqual({
      ok: false,
      error: { keyPath: "", problem: "expected a mapping" },
    });
  });
  it("reads --config from another directory, and an absent --config file is an error", () => {
    const other = path.join(base, "outside", "facts.yaml");
    fs.writeFileSync(other, "edges: []\n");
    const loc = configLocation(root, path.relative(base, other), base);
    if (!("dir" in loc)) throw new Error("location");
    expect(readConfig(loc, root)).toMatchObject({ ok: true, config: { file: "facts.yaml" } });
    const missing = configLocation(root, path.join(base, "outside", "missing.yaml"), base);
    if (!("dir" in missing)) throw new Error("location");
    expect(readConfig(missing, root)).toMatchObject({
      ok: false,
      error: { problem: "not readable", reasonWord: "not found" },
    });
    expect(configLocation(root, path.join(base, "nowhere", "x.yaml"), base)).toMatchObject({ problem: "not readable" });
  });
});

describe("crankpath.yaml entry count (review M3, declaredEntries)", () => {
  it("refuses a file with more entries than the derived limit, by name, and admits one at the limit", () => {
    write(
      'cranks:\n  - {creates: ["Secret/a/b", "Secret/a/c"], by: me}\nedges:\n  - {from: "Secret/a/b", to: "Secret/a/c", why: w}\n',
    );
    const loc = configLocation(root, undefined, base);
    if (!("dir" in loc)) throw new Error("location");
    // 1 crank + 2 creates + 1 edge = 4 entries
    expect(readConfig(loc, root, withValue(LIMITS.declaredEntries, 4, "test")).ok).toBe(true);
    expect(readConfig(loc, root, withValue(LIMITS.declaredEntries, 3, "test"))).toEqual({
      ok: false,
      error: { keyPath: null, problem: "more entries than the limit" },
    });
  });
});
