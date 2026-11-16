// A directory applied by hand at bootstrap (FR7.4, BR7.7; lead decision for B7, option (a)): a
// `creates: render:<path>` crank that names a Helm chart or Kustomize directory nothing in the
// estate deploys makes crankpath render it, through the normal guarded Helm or Kustomize path, as a
// hand-applied root whose objects the crank creates; everything those objects lead to is planned,
// rendered and graphed as usual. Without such a crank, a chart or Kustomize directory nothing
// deploys is never graphed, and the report lists it with the suggestion to declare the crank.
// Fixture: test/fixtures/hand-applied (crankpath's own), rendered with the tests' fake helm and
// kustomize (real processes; the chart's templates are plain YAML, so real helm renders the same).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { claimWordsInOwnVoice } from "../../src/u1-graph-model/status-model.js";
import { fakePath } from "../helpers/render.js";
import { run, tempDir } from "../helpers/scan.js";
import { flat } from "../helpers/text.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/hand-applied/repo/", import.meta.url));
const URL_ = "http://gitea-http.gitea:3000/ops/estate";
const CRANK = [
  "cranks:",
  "  - creates: render:system/argocd",
  "    namespace: argocd",
  '    by: "render system/argocd and apply it, before Argo CD runs"',
  "    ref: runbooks/bootstrap.md",
  "",
].join("\n");
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

/** Adds a Kustomize root nothing deploys, `extras/kustomize`. */
function addKustomizeRoot(repo: string): void {
  const d = path.join(repo, "extras", "kustomize");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, "kustomization.yaml"),
    "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: extras\nresources:\n  - cm.yaml\n",
  );
  fs.writeFileSync(path.join(d, "cm.yaml"), "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: extras\n");
}

function copy(config?: string, edit?: (repo: string) => void): string {
  const dir = tempDir("hand-applied");
  cleanup.push(dir);
  const repo = path.join(dir, "repo");
  fs.cpSync(FIXTURE, repo, { recursive: true });
  if (config !== undefined) fs.writeFileSync(path.join(repo, "crankpath.yaml"), config);
  edit?.(repo);
  return repo;
}

interface Json {
  nodes: { id: string; origin: { renderJob: string | null } }[];
  edges: { from: string; to: string; kind: string }[];
  cycles: { label: string; labelBeforeCranks: string; nodes: string[]; crankedBy: string[] }[];
  cranks: { id: string; matched: boolean; createdNodes: string[] }[];
  opaque: { node: string | null; chartRoot: string | null; reason: string }[];
  plan: { steps: { no: number; kind: string; manual: boolean; nodes: string[] }[] };
  runStatus: { state: string; reasons: string[]; counts: Record<string, unknown> };
  undeployedCharts: string[];
  undeployedKustomizeRoots: string[];
  unresolved: { why: string; subject: string }[];
}

function scan(repo: string, toolPath = fakePath()) {
  const cache = tempDir("hand-applied-cache");
  cleanup.push(cache);
  const args = [repo, "--repo-url", URL_, "--cache-dir", cache];
  const j = run([...args, "--format", "json"], path.dirname(repo), toolPath);
  const t = run(args, path.dirname(repo), toolPath);
  return { code: j.code, json: JSON.parse(j.stdout) as Json, text: t.stdout, flat: flat(t.stdout), textCode: t.code };
}

describe("without a crank: nothing deploys the chart, so nothing is analysed, and the report says what to declare", () => {
  const r = scan(copy());
  it("is NOTHING ANALYSED, exit 2, and graphs nothing", () => {
    expect([r.code, r.textCode]).toEqual([2, 2]);
    expect(r.json.runStatus.state).toBe("NOTHING ANALYSED");
    expect(r.json.nodes).toEqual([]);
  });
  it("lists every chart directory nothing deploys, with the crank to declare", () => {
    expect(r.json.undeployedCharts).toEqual(["system/argocd", "tools/unused"]);
    expect(r.json.undeployedKustomizeRoots).toEqual([]);
    expect(r.flat).toContain(
      "not deployed by anything read: 2 chart directories, 0 Kustomize roots; their objects are not in the graph; if one is applied by hand at bootstrap, declare it as a crank: creates: render:<path>",
    );
    expect(r.flat).toContain('undeployed 1 of 2 chart directory: "system/argocd"');
    expect(r.flat).toContain('undeployed 2 of 2 chart directory: "tools/unused"');
    expect(claimWordsInOwnVoice(r.text)).toEqual([]);
  });
  it("lists a Kustomize root nothing deploys in the same block (built on its own, not graphed)", () => {
    const k = scan(copy(undefined, addKustomizeRoot));
    expect(k.json.undeployedKustomizeRoots).toEqual(["extras/kustomize"]);
    expect(k.flat).toContain("not deployed by anything read: 2 chart directories, 1 Kustomize root;");
    expect(k.flat).toContain(
      'undeployed 3 of 3 Kustomize root: "extras/kustomize" (built on its own unless it is a component)',
    );
    expect(k.json.nodes.map((n) => n.id)).not.toContain("ConfigMap/extras/extras");
  });
});

describe("with the crank: the chart is a hand-applied root, and what it renders is graphed", () => {
  const r = scan(copy(CRANK));
  const ids = r.json.nodes.map((n) => n.id);
  it("renders the chart in the crank's namespace and plans the Applications it renders", () => {
    expect(r.code).toBe(0);
    expect(ids).toEqual(
      expect.arrayContaining([
        "Application/argocd/argocd",
        "Application/argocd/gitea",
        "Deployment/argocd/argocd-server",
        "Service/gitea/gitea-http",
        "Deployment/gitea/gitea",
      ]),
    );
    // platform/gitea is rendered by the Application the chart renders, not read on its own
    const gitea = r.json.nodes.find((n) => n.id === "Deployment/gitea/gitea");
    expect(gitea?.origin.renderJob).toBe("Application/argocd/gitea#0");
  });
  it("counts the hand-applied chart as a source, and lists only the directories still undeployed", () => {
    expect((r.json.runStatus.counts.sourcesByKind as Record<string, number>).HandAppliedChart).toBe(1);
    expect(r.json.undeployedCharts).toEqual(["tools/unused"]);
    expect(r.flat).toContain("1 Helm chart applied by hand");
  });
  it("shows the cycle through Gitea cranked by the crank, which creates the chart's objects (plan step 1)", () => {
    expect(r.json.cycles.map((c) => [c.label, c.labelBeforeCranks, c.crankedBy])).toEqual([
      ["cranked", "extracted", ["crank:1"]],
    ]);
    expect(r.json.cycles[0]?.nodes).toEqual(
      expect.arrayContaining(["Application/argocd/gitea", "Service/gitea/gitea-http"]),
    );
    expect(r.json.cranks[0]).toMatchObject({
      matched: true,
      createdNodes: ["Application/argocd/argocd", "Application/argocd/gitea", "Deployment/argocd/argocd-server"],
    });
    expect(r.json.plan.steps[0]).toMatchObject({ no: 1, kind: "crank", manual: true });
  });
  it("a crank of a path that is neither a chart nor a Kustomize directory renders nothing and is unused", () => {
    const other = scan(copy(CRANK.replace("render:system/argocd", "render:platform/nowhere")));
    expect(other.code).toBe(2);
    expect(other.json.cranks[0]?.matched).toBe(false);
  });
});

describe("a hand-applied root fails closed like any render", () => {
  it("is an opaque source when its render fails, named, and the crank creates nothing", () => {
    const repo = copy(CRANK, (d) =>
      fs.writeFileSync(path.join(d, "system", "argocd", "fake.json"), JSON.stringify({ mode: "fail" })),
    );
    const r = scan(repo);
    expect(r.code).toBe(0);
    expect(r.json.runStatus.state).toBe("ANALYSED WITH GAPS");
    expect(r.json.opaque).toEqual([
      expect.objectContaining({ node: null, chartRoot: "system/argocd", reason: "render-failed" }),
    ]);
    expect(r.json.cranks[0]?.matched).toBe(false);
    expect(r.flat).toContain('opaque 1 of 1 Helm chart applied by hand: "system/argocd" reason: render-failed');
  });
  it("is opaque tool-missing without helm, never silently skipped", () => {
    const r = scan(copy(CRANK), "");
    expect(r.json.opaque.map((o) => [o.chartRoot, o.reason])).toEqual([["system/argocd", "tool-missing"]]);
  });
});

describe("a hand-applied Kustomize root", () => {
  it("is built and graphed with the crank, its objects created by it; without the crank it is built but not graphed", () => {
    const config = 'cranks:\n  - {creates: "render:extras/kustomize", by: "kubectl apply -k extras/kustomize"}\n';
    const r = scan(copy(config, addKustomizeRoot));
    expect(r.json.nodes.map((n) => n.id)).toContain("ConfigMap/extras/extras");
    expect(r.json.undeployedKustomizeRoots).toEqual([]);
    expect(r.json.cranks[0]).toMatchObject({ matched: true, createdNodes: ["ConfigMap/extras/extras"] });
    const plain = scan(copy(undefined, addKustomizeRoot));
    expect(plain.json.nodes.map((n) => n.id)).not.toContain("ConfigMap/extras/extras");
  });
});

describe("a crank's namespace and release are checked before anything runs", () => {
  const bad = (config: string) => {
    const repo = copy(config);
    return run([repo, "--repo-url", URL_], path.dirname(repo), "");
  };
  it("refuses a namespace that is not a namespace name, and either key on a crank with no render: target", () => {
    expect(bad(CRANK.replace("namespace: argocd", "namespace: Not_A_Namespace")).stderr).toBe(
      'error: invalid crankpath.yaml at key path "cranks[0].namespace" (not a namespace name)\n',
    );
    expect(bad('cranks:\n  - {creates: Application/argocd/argocd, namespace: argocd, by: "x"}\n').stderr).toBe(
      'error: invalid crankpath.yaml at key path "cranks[0].namespace" (applies to a render: target only)\n',
    );
    expect(bad('cranks:\n  - {creates: Application/argocd/argocd, release: argocd, by: "x"}\n').code).toBe(1);
  });
  it("renders a chart under the crank's release name, and refuses one helm would refuse (opaque, named)", () => {
    const named = scan(copy(CRANK.replace("namespace: argocd", "namespace: argocd\n    release: bootstrap")));
    expect(named.json.cranks[0]?.matched).toBe(true);
    const refused = scan(copy(CRANK.replace("namespace: argocd", "namespace: argocd\n    release: Not.A.Release")));
    expect(refused.json.opaque).toEqual([
      expect.objectContaining({ chartRoot: "system/argocd", reason: "unsupported-field" }),
    ]);
  });
});

describe("a chart some source deploys is not listed as undeployed", () => {
  const unusedApp = (repoURL: string) =>
    [
      "apiVersion: argoproj.io/v1alpha1",
      "kind: Application",
      "metadata: {name: unused, namespace: argocd}",
      "spec:",
      "  source:",
      `    repoURL: ${repoURL}`,
      "    targetRevision: 0123456789abcdef0123456789abcdef01234567",
      "    path: tools/unused",
      "  destination: {server: https://kubernetes.default.svc, namespace: tools}",
      "",
    ].join("\n");
  it("leaves out a chart an Application of the scanned repo renders", () => {
    const repo = copy(undefined, (d) => {
      fs.mkdirSync(path.join(d, "apps"));
      fs.writeFileSync(path.join(d, "apps", "unused.yaml"), unusedApp(URL_));
    });
    const r = scan(repo);
    expect(r.json.nodes.map((n) => n.id)).toContain("ConfigMap/tools/unused");
    expect(r.json.undeployedCharts).toEqual(["system/argocd"]);
  });
  it("leaves it out when the Application reads the same checkout through --repo-alias (compared by real path)", () => {
    const other = "https://git.acme.dev/ops/estate-mirror";
    const repo = copy(undefined, (d) => {
      fs.mkdirSync(path.join(d, "apps"));
      fs.writeFileSync(path.join(d, "apps", "unused.yaml"), unusedApp(other));
    });
    const cache = tempDir("hand-applied-cache");
    cleanup.push(cache);
    const j = run(
      [repo, "--repo-url", URL_, "--repo-alias", `${other}=${repo}`, "--cache-dir", cache, "--format", "json"],
      path.dirname(repo),
      fakePath(),
    );
    const json = JSON.parse(j.stdout) as Json;
    expect(json.nodes.map((n) => n.id)).toContain("ConfigMap/tools/unused");
    expect(json.undeployedCharts).toEqual(["system/argocd"]);
  });
});

describe("review m4: a render: path named by two cranks that apply it differently", () => {
  const two = (second: string) =>
    [
      "cranks:",
      '  - {creates: "render:system/argocd", namespace: argocd, by: "first"}',
      `  - {creates: "render:system/argocd", ${second}by: "second"}`,
      "",
    ].join("\n");
  const exec = (config: string) => {
    const repo = copy(config);
    return run([repo, "--repo-url", URL_], path.dirname(repo), "");
  };
  it("is refused, naming the later crank's key path, when the namespace or release differs", () => {
    expect(exec(two("namespace: other, ")).stderr).toBe(
      'error: invalid crankpath.yaml at key path "cranks[1].creates" (names a render: path an earlier crank applies with another namespace or release)\n',
    );
    expect(exec(two("release: other, ")).code).toBe(1);
    expect(exec(two("")).code).toBe(1);
  });
  it("is accepted when both apply it the same way (the later crank names objects already created)", () => {
    const r = scan(copy(two("namespace: argocd, ")));
    expect(r.code).toBe(0);
    expect(r.json.cranks.map((c) => c.matched)).toEqual([true, true]);
  });
});

describe("review m3: the two exclusions of the undeployed list", () => {
  it("never lists a chart vendored under another chart's charts/ or templates/", () => {
    const repo = copy(undefined, (d) => {
      for (const sub of ["charts/vendored", "templates/odd"]) {
        fs.mkdirSync(path.join(d, "system", "argocd", ...sub.split("/")), { recursive: true });
        fs.writeFileSync(
          path.join(d, "system", "argocd", ...sub.split("/"), "Chart.yaml"),
          "apiVersion: v2\nname: x\nversion: 0.1.0\n",
        );
      }
    });
    expect(scan(repo).json.undeployedCharts).toEqual(["system/argocd", "tools/unused"]);
  });
  it("never lists a chart a crank applies by hand that no render deploys", () => {
    const crank =
      'cranks:\n  - {creates: "render:tools/unused", namespace: tools, by: "helm template tools/unused, then apply"}\n';
    const r = scan(copy(crank));
    expect(r.json.nodes.map((n) => n.id)).toContain("ConfigMap/tools/unused");
    expect(r.json.undeployedCharts).toEqual(["system/argocd"]);
  });
});
