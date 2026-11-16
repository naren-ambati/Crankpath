import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import { openRoot, readYaml, type ScanRoot } from "../../src/u2-intake-config/bounded-reader.js";
import { walkFiles } from "../../src/u2-intake-config/tree-walk.js";
import type { PlainJob } from "../../src/u3-discovery-expansion/render-job.js";
import { buildObjects } from "../../src/u4-render-engine/rendered-set-builder.js";
import { RENDERERS, type RenderIo, render } from "../../src/u4-render-engine/renderers.js";

function build(values: DataValue[], defaultNamespace: string | null = "gitea", dropTestHooks = false) {
  return buildObjects(
    values.map((value, i) => ({ file: "f.yaml", document: i + 1, value })),
    { renderJob: "Application/argocd/a#0", defaultNamespace, destination: "in-cluster", dropTestHooks },
  );
}

describe("rendered set builder (BR1.3, BR4.6, BR4.7, FR1.7)", () => {
  it("gives each object its canonical id, the default namespace and its origin", () => {
    const b = build([{ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "c" } }, null]);
    expect(b.objects.map((o) => [o.id, o.renderedPath, o.origin])).toEqual([
      ["ConfigMap/gitea/c", "f.yaml#1", { renderJob: "Application/argocd/a#0", path: "f.yaml", document: 1 }],
    ]);
    expect(b.skipped).toEqual([]);
  });
  it("skips and names an object whose name is not a Kubernetes name, never building its id", () => {
    const b = build([
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "x/../../Service/gitea/gitea-http", namespace: "gitea" },
      },
      { apiVersion: "v1", kind: "Service", metadata: { name: "gitea\x1b[2J" } },
      { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "ok" } },
      "a string document",
      { kind: "NoApiVersion", metadata: { name: "x" } },
    ]);
    expect(b.objects.map((o) => o.id)).toEqual(["ConfigMap/gitea/ok"]);
    expect(b.skipped.map((s) => [s.document, s.reason, s.name])).toEqual([
      [1, "invalid-name", "x/../../Service/gitea/gitea-http"],
      [2, "invalid-name", "gitea\x1b[2J"],
      [4, "not-an-object", null],
      [5, "not-an-object", "x"],
    ]);
  });
  it("needs a namespace for a namespaced object", () => {
    const b = build([{ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "c" } }], null);
    expect(b.skipped[0]?.reason).toBe("no-namespace");
    const cluster = build([{ apiVersion: "v1", kind: "Namespace", metadata: { name: "gitea" } }], null);
    expect(cluster.objects[0]?.id).toBe("Namespace/gitea");
  });
  it("expands List items with their own rendered path", () => {
    const b = build([
      { apiVersion: "v1", kind: "List", items: [{ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "a" } }, 3] },
    ]);
    expect(b.objects[0]?.renderedPath).toBe("f.yaml#1.items[0]");
    expect(b.skipped[0]).toMatchObject({ item: 1, reason: "not-an-object" });
  });
  it("discards every Secret value, and the annotation that repeats them", () => {
    const b = build([
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: "s",
          annotations: { "kubectl.kubernetes.io/last-applied-configuration": '{"data":{"p":"c2VjcmV0"}}', keep: "me" },
        },
        data: { p: "c2VjcmV0" },
        stringData: { q: "plain-secret" },
      },
    ]);
    const text = JSON.stringify(b.objects);
    expect(text).not.toContain("c2VjcmV0");
    expect(text).not.toContain("plain-secret");
    expect(b.objects[0]?.annotations).toEqual({ keep: "me" });
    expect(b.objects[0]?.credentialUrl).toBeNull();
  });
  it("keeps only the url of an Argo CD credential Secret, userinfo removed", () => {
    const labels = { "argocd.argoproj.io/secret-type": "repository" };
    const plain = build([
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "r", labels },
        stringData: { url: "https://u:tok@example.org/x", password: "pw" },
      },
    ]);
    expect(plain.objects[0]?.credentialUrl).toBe("https://example.org/x");
    expect(JSON.stringify(plain.objects)).not.toContain("tok");
    expect(JSON.stringify(plain.objects)).not.toContain("pw");
    const encoded = build([
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "r", labels },
        data: { url: Buffer.from("https://example.org/y").toString("base64") },
      },
    ]);
    expect(encoded.objects[0]?.credentialUrl).toBe("https://example.org/y");
    const notBase64 = build([
      { apiVersion: "v1", kind: "Secret", metadata: { name: "r", labels }, data: { url: "%%%" } },
    ]);
    expect(notBase64.objects[0]?.credentialUrl).toBeNull();
  });
  it("drops Helm test hooks from a Helm render and counts them; keeps other hooks", () => {
    const b = build(
      [
        {
          apiVersion: "v1",
          kind: "Pod",
          metadata: { name: "t", annotations: { "helm.sh/hook": "pre-install, test" } },
        },
        { apiVersion: "v1", kind: "Pod", metadata: { name: "u", annotations: { "helm.sh/hook": "pre-install" } } },
      ],
      "gitea",
      true,
    );
    expect(b.droppedHooks).toBe(1);
    expect(b.objects.map((o) => o.name)).toEqual(["u"]);
  });
  it("drops exactly helm's test hook values (BR4.6)", () => {
    const b = build(
      [
        { apiVersion: "v1", kind: "Pod", metadata: { name: "v", annotations: { "helm.sh/hook": "test-success" } } },
        {
          apiVersion: "v1",
          kind: "Pod",
          metadata: { name: "w", annotations: { "helm.sh/hook": "post-install,test-failure" } },
        },
        { apiVersion: "v1", kind: "Pod", metadata: { name: "x", annotations: { "helm.sh/hook": "testing" } } },
      ],
      "gitea",
      true,
    );
    expect(b.droppedHooks).toBe(2);
    expect(b.objects.map((o) => o.name)).toEqual(["x"]);
  });
  it("replaces every namespaced object's namespace with a Flux targetNamespace, never a cluster-scoped one's", () => {
    const b = buildObjects(
      [
        {
          file: "f",
          document: 1,
          value: { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "c", namespace: "own" } },
        },
        { file: "f", document: 2, value: { apiVersion: "v1", kind: "Namespace", metadata: { name: "n" } } },
      ],
      { renderJob: "j", defaultNamespace: "d", namespaceOverride: "target", destination: "in-cluster" },
    );
    expect(b.objects.map((o) => o.id)).toEqual(["ConfigMap/target/c", "Namespace/n"]);
  });
  it("gives one digest to one content and another to a change or another destination", () => {
    const doc = { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "c" }, data: { a: "1" } };
    const a = build([doc]).objects[0]?.digest;
    expect(build([{ ...doc }]).objects[0]?.digest).toBe(a);
    expect(build([{ ...doc, data: { a: "2" } }]).objects[0]?.digest).not.toBe(a);
    const foreign = buildObjects([{ file: "f.yaml", document: 1, value: doc }], {
      renderJob: null,
      defaultNamespace: "gitea",
      destination: "server:https://other",
    });
    expect(foreign.objects[0]?.digest).not.toBe(a);
  });
});

describe("plain renderer (FR3.11)", () => {
  let base: string;
  let root: ScanRoot;
  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-plain-"));
    const r = path.join(base, "root");
    fs.mkdirSync(path.join(r, "app", "sub"), { recursive: true });
    fs.writeFileSync(path.join(r, "app", "a.yaml"), "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: a}\n");
    fs.writeFileSync(path.join(r, "app", "b.json"), '{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"b"}}');
    fs.writeFileSync(path.join(r, "app", "notes.txt"), "not a manifest\n");
    fs.writeFileSync(path.join(r, "app", "sub", "c.yml"), "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\n");
    fs.writeFileSync(path.join(r, "app", "sub", "bad.yaml"), "a: [unclosed\n");
    fs.writeFileSync(path.join(base, "outside.yaml"), "apiVersion: v1\nkind: Secret\nmetadata: {name: leak}\n");
    fs.symlinkSync(path.join(base, "outside.yaml"), path.join(r, "app", "link.yaml"));
    const opened = openRoot(r);
    if (!opened.ok) throw new Error("root");
    root = opened.root;
  });
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  const io = (): RenderIo => ({
    walk: (_label, dir, options) => walkFiles(root, dir, options),
    read: (_label, p) => readYaml(root, p),
    readText: (_label, p) => ({ outcome: "not-found", path: p, reasonWord: "not found" }),
    readBytes: (_label, p) => ({ outcome: "not-found", path: p, reasonWord: "not found" }),
    kind: () => "missing",
    display: (_label, p) => p,
    // a plain job runs nothing and writes nothing: no runtime is needed
    runtime: {} as RenderIo["runtime"],
  });
  const job = (recurse: boolean): PlainJob => ({
    kind: "plain",
    jobId: "Application/argocd/a#0",
    owner: "Application/argocd/a",
    ownerFile: "apps/a.yaml",
    ownerField: "spec.source.path",
    ownerRenderedPath: "apps/a.yaml#1",
    destination: "in-cluster",
    namespace: "ns",
    namespaceOverride: null,
    releaseName: null,
    valuesInputs: [],
    source: { repo: null, path: "app", chart: null, version: null, floating: false },
    generatedBy: null,
    substitute: null,
    floating: [],
    root: ".",
    dir: "app",
    recurse,
  });

  it("reads .yaml, .yml and .json manifests, recursing only when asked, and never follows a symlink", () => {
    const flat = render(job(false), io());
    expect(flat.objects.map((o) => o.id)).toEqual(["ConfigMap/ns/a", "ConfigMap/ns/b"]);
    expect(flat.unreadable.map((u) => [u.path, u.outcome])).toEqual([["app/link.yaml", "symlink"]]);
    expect(flat.opaque).toMatchObject({
      reason: "unreadable-file",
      lostEdges: ["objects in the files it could not read"],
    });
    expect(JSON.stringify(flat)).not.toContain("leak");
    const deep = render(job(true), io());
    expect(deep.objects.map((o) => o.id)).toEqual(["ConfigMap/ns/a", "ConfigMap/ns/b", "ConfigMap/ns/c"]);
    expect(deep.unreadable.map((u) => u.outcome).sort()).toEqual(["parse-error", "symlink"]);
  });
  it("is dispatched from the one renderer table", () => {
    expect(Object.keys(RENDERERS)).toEqual(["plain", "helm", "kustomize"]);
  });
  it("marks the owner limit when a limit stopped a read", () => {
    const limited: RenderIo = {
      ...io(),
      read: (_l, p) => ({ outcome: "too-large", path: p, reasonWord: "too large" }),
    };
    expect(render(job(false), limited)).toMatchObject({ outcome: "limit", opaque: { reason: "limit" } });
  });
});
