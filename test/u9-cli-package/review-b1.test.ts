// Regression tests for the B1 review (reviews/bolt-1-review.md): each failed before its fix.

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Extractor, RenderedObject } from "../../src/u1-graph-model/extractor.js";
import { emptyResult } from "../../src/u1-graph-model/extractor.js";
import { buildObjects } from "../../src/u4-render-engine/rendered-set-builder.js";
import { createHostMatcher } from "../../src/u6-extractors-workload/host-matcher.js";
import { writeJson } from "../../src/u8-output/json-renderer.js";
import { main } from "../../src/u9-cli-package/cli-shell.js";
import { EXTRACTORS, runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { app, estate, FIXTURE, run, THIN_SLICE_URL } from "../helpers/scan.js";
import { unwrapText } from "../helpers/text.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function make(files: Record<string, string>): string {
  const d = estate(files);
  cleanup.push(d);
  return d;
}
const CM = (name: string, annotations = "") =>
  `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${name}\n${annotations === "" ? "" : `  annotations: ${annotations}\n`}`;
function json(root: string, args: string[] = []) {
  const r = run([root, "--repo-url", THIN_SLICE_URL, "--format", "json", ...args], process.cwd());
  return { ...r, report: r.code === 0 ? JSON.parse(r.stdout) : null };
}

describe("M1: a repo-supplied repos: entry can never shadow a --repo-alias root", () => {
  it("keeps the user's alias root when the repo maps a directory named alias:1", () => {
    const user = make({ "p/r.yaml": CM("from-user-dir") });
    const root = make({
      "apps/a.yaml": app("a", "p", "https://example.org/other/repo"),
      "alias:1/p/f.yaml": CM("from-repo-dir"),
      "crankpath.yaml": 'repos:\n  "https://example.org/zzz":\n    read_from: "alias:1"\n',
    });
    const alias = ["--repo-alias", `https://example.org/other/repo=${user}`];
    const r = json(root, alias);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("(names a root label crankpath assigns (alias:N or fetch:N))");
    fs.rmSync(path.join(root, "crankpath.yaml"));
    const ids = json(root, alias).report.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain("ConfigMap/a/from-user-dir");
    expect(ids).not.toContain("ConfigMap/a/from-repo-dir");
  });
  it("refuses a repos: read_from spelled like an alias label, naming the key path", () => {
    const root = make({
      "apps/a.yaml": app("a", "p", "https://example.org/zzz"),
      "alias:1/p/f.yaml": CM("mapped"),
      "crankpath.yaml": 'repos:\n  "https://example.org/zzz":\n    read_from: "alias:1"\n',
    });
    expect(json(root).stderr).toBe(
      'error: invalid crankpath.yaml at key path "repos.\\"https://example.org/zzz\\".read_from" (names a root label crankpath assigns (alias:N or fetch:N))\n',
    );
  });
  it("shows a repo directory spelled like an alias label with ./, so it never reads as the user's alias", () => {
    const root = make({ "apps/a.yaml": app("a", "alias:1/p"), "alias:1/p/f.yaml": CM("inside") });
    const node = json(root).report.nodes.find((n: { id: string }) => n.id === "ConfigMap/a/inside");
    expect(node.origin.path).toBe("./alias:1/p/f.yaml");
  });
});

describe("M2: a plain directory object keeps its edges whatever its annotations; drops are counted and shown", () => {
  it("never drops a plain-directory object annotated as a Helm test", () => {
    const root = make({ "apps/a.yaml": app("a", "p"), "p/t.yaml": CM("t", '{"helm.sh/hook": test}') });
    const r = json(root);
    expect(r.report.nodes.map((n: { id: string }) => n.id)).toContain("ConfigMap/a/t");
    expect(r.report.runStatus.counts.droppedHooks).toBe(0);
  });
  it("drops test hooks only when the builder is told the documents are a Helm render, and counts them", () => {
    const doc = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: "t", namespace: "n", annotations: { "helm.sh/hook": "test" } },
    };
    const options = { renderJob: null, defaultNamespace: "n", destination: "in-cluster" } as const;
    expect(buildObjects([{ file: "f", document: 1, value: doc }], options).objects).toHaveLength(1);
    const helm = buildObjects([{ file: "f", document: 1, value: doc }], { ...options, dropTestHooks: true });
    expect([helm.objects.length, helm.droppedHooks]).toEqual([0, 1]);
  });
});

describe("M3: a hostile size never ends in an uncaught throw", () => {
  it("exits 1 with crankpath's own one-line message, no stack, when anything inside throws", () => {
    let out = "";
    let err = "";
    const code = main([path.join(FIXTURE, "repo")], {
      stdout: (t) => {
        out += t;
      },
      stderr: (t) => {
        err += t;
      },
      cwd: process.cwd(),
      run: () => {
        throw new RangeError("Invalid string length\n    at secret/stack/frame.js:1:1");
      },
    });
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe(
      "error: crankpath stopped on an internal error (a bug); any report on standard output is incomplete and no --out file was written\n",
    );
  });
  it("writes JSON in bounded chunks, never building the whole document as one string", () => {
    // no helm or kustomize on the tool PATH, so the toolchain in the expected output holds on every machine
    const outcome = runPipeline({
      path: path.join(FIXTURE, "repo"),
      cwd: process.cwd(),
      repoUrl: THIN_SLICE_URL,
      toolPath: "",
    });
    if (outcome.kind !== "report") throw new Error("run");
    const chunks: string[] = [];
    writeJson(outcome.report, (c) => chunks.push(c));
    expect(chunks.join("")).toBe(fs.readFileSync(path.join(FIXTURE, "expected.json"), "utf8"));
    expect(chunks.length).toBeGreaterThan(5);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThan(2000);
  });
});

describe("m1: an Application written as JSON is discovered like YAML", () => {
  it("finds apps/a.json", () => {
    const yaml = app("a", "p");
    const asJson = JSON.stringify({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name: "a", namespace: "argocd" },
      spec: {
        source: { repoURL: THIN_SLICE_URL, path: "p" },
        destination: { server: "https://kubernetes.default.svc", namespace: "a" },
      },
    });
    expect(yaml.length).toBeGreaterThan(0);
    const r = json(make({ "apps/a.json": asJson, "p/c.yaml": CM("c") }));
    expect(r.code).toBe(0);
    expect(r.report.runStatus.counts.sourcesByKind.Application).toBe(1);
  });
});

describe("m2: --out is refused inside every scanned tree, alias roots included", () => {
  it("refuses an --out inside a --repo-alias root", () => {
    const user = make({ "p/r.yaml": CM("r") });
    const root = make({ "apps/a.yaml": app("a", "p", "https://example.org/other/repo") });
    const target = path.join(user, "report.txt");
    const r = run(
      [root, "--repo-url", THIN_SLICE_URL, "--repo-alias", `https://example.org/other/repo=${user}`, "--out", target],
      process.cwd(),
    );
    expect(r.code).toBe(1);
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe("m4: objects of a foreign destination are named in the text", () => {
  it("counts them and does not say nothing opaque, nothing skipped", () => {
    const far = app("far", "p").replace("https://kubernetes.default.svc", "https://far.example.org");
    const r = run([make({ "apps/far.yaml": far, "p/c.yaml": CM("c") }), "--repo-url", THIN_SLICE_URL], process.cwd());
    expect(unwrapText(r.stdout)).toContain(
      "  foreign destination: 1 object deployed to another cluster, left out of Service and host matching",
    );
    expect(unwrapText(r.stdout)).not.toContain("(nothing opaque, nothing skipped)");
    expect(unwrapText(r.stdout)).toMatch(/Not verified: .*1 object of a foreign destination/);
  });
});

describe("m5: the opaque share never rounds toward clean", () => {
  it("rounds an exact share up", () => {
    const files: Record<string, string> = { "p/c.yaml": CM("c") };
    files["apps/bad.yaml"] = app("bad", "nope");
    for (const n of ["a", "b"]) files[`apps/${n}.yaml`] = app(n, "p");
    const r = run([make(files), "--repo-url", THIN_SLICE_URL], process.cwd());
    expect(unwrapText(r.stdout)).toContain("Opacity: 1 of 3 sources opaque (34%)");
  });
});

describe("m6: the exit-2 text holds no absolute path", () => {
  it("shows only the last segment of an absolute path", () => {
    const root = make({ "README.md": "x\n" });
    const r = run([root], "/");
    expect(r.code).toBe(2);
    expect(unwrapText(r.stdout)).not.toContain(root);
    expect(unwrapText(r.stdout)).toContain(`path: "${path.basename(root)}" (absolute path, last segment only)`);
  });
});

describe("m7: the files count says what it means", () => {
  it("says files hold no source document, not ignored", () => {
    const r = run([path.join(FIXTURE, "repo"), "--repo-url", THIN_SLICE_URL], process.cwd());
    expect(unwrapText(r.stdout)).toContain("; 5 files hold no source document");
    expect(unwrapText(r.stdout)).not.toContain("files ignored");
  });
});

describe("m8: only an Argo CD credential Secret keeps its url", () => {
  it("drops the url of an unlabelled Secret", () => {
    const b = buildObjects(
      [
        {
          file: "f",
          document: 1,
          value: {
            apiVersion: "v1",
            kind: "Secret",
            metadata: { name: "s", namespace: "n" },
            stringData: { url: "https://example.org/x" },
          },
        },
      ],
      { renderJob: null, defaultNamespace: null, destination: "in-cluster" },
    );
    expect(b.objects[0]?.credentialUrl).toBeNull();
  });
});

describe("m9: sync waves never become edges or cycles", () => {
  it("adds only deployed-by edges for objects in waves -2, 0, 5 and unannotated ones", () => {
    const wave = (w: string) => `{"argocd.argoproj.io/sync-wave": "${w}"}`;
    const root = make({
      "apps/a.yaml": app("a", "p"),
      "p/one.yaml": CM("one", wave("-2")),
      "p/two.yaml": CM("two", wave("0")),
      "p/three.yaml": CM("three", wave("5")),
      "p/four.yaml": CM("four", wave("5")),
      "p/plain.yaml": CM("plain"),
    });
    const r = json(root).report;
    expect(r.edges.map((e: { kind: string }) => e.kind)).toEqual(Array(5).fill("deployed-by"));
    expect(r.cycles).toEqual([]);
    expect(
      r.nodes
        .filter((n: { syncWave: number | null }) => n.syncWave !== null)
        .map((n: { syncWave: number }) => n.syncWave)
        .sort(),
    ).toEqual([-2, 0, 5, 5]);
  });
});

describe("m10: a three-label host matches only the .svc form", () => {
  it("never matches an outside host whose labels happen to name a Service", () => {
    const m = createHostMatcher([
      { id: "Service/example/git", name: "git", namespace: "example" },
      { id: "Service/gitea/gitea-http", name: "gitea-http", namespace: "gitea" },
    ]);
    for (const host of ["git.example.org", "gitea-http.gitea.example.org", "git.example.com"]) {
      expect(m({ host, field: "f", bareNamespace: null }).outcome, host).toBe("none");
    }
    expect(m({ host: "git.example.svc", field: "f", bareNamespace: null }).outcome).toBe("unique");
  });
});

describe("m11: no Secret value reaches any object the pipeline hands an extractor", () => {
  it("sees the thin-slice Secret without its data", () => {
    const seen: RenderedObject[] = [];
    const recorder: Extractor = {
      name: "recorder",
      extract: (objects) => {
        seen.push(...objects);
        return emptyResult();
      },
    };
    runPipeline({
      path: path.join(FIXTURE, "repo"),
      cwd: process.cwd(),
      repoUrl: THIN_SLICE_URL,
      extractors: [...EXTRACTORS, recorder],
    });
    const secret = seen.find((o) => o.id === "Secret/gitea/gitea-admin");
    expect(secret).toBeDefined();
    expect(JSON.stringify(seen)).not.toContain("fixture-value-that-must-not-be-printed");
    expect(Object.keys(secret?.body ?? {})).not.toContain("stringData");
  });
});
