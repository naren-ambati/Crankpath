// Generated Applications through every render path (B3 with B2's engine): an ApplicationSet
// generates a Helm, a Kustomize and a plain-directory Application; each renders with the fake
// helm and kustomize, its objects are deployed by it, and only the Applications themselves are
// `generated-by` the ApplicationSet (B2's render-io passed the generator to every rendered object:
// the twin of the bug B3 fixed in the plain renderer; this test was red on the merge before the fix).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { fakePath } from "../helpers/render.js";
import { run, tempDir } from "../helpers/scan.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/render/repo/", import.meta.url));
const URL_ = "https://example.org/ops/render-demo";
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

const SET = `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: render-set
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - {name: gen-web, path: charts/web, ns: web}
          - {name: gen-platform, path: kustomize/platform/overlay, ns: platform}
          - {name: gen-plain, path: plain, ns: plain}
  template:
    metadata:
      name: "{{name}}"
    spec:
      project: default
      source:
        repoURL: ${URL_}
        path: "{{path}}"
        targetRevision: 0123456789abcdef0123456789abcdef01234567
      destination:
        server: https://kubernetes.default.svc
        namespace: "{{ns}}"
`;

function estate(): string {
  const dir = tempDir("generated-renders");
  cleanup.push(dir);
  const repo = path.join(dir, "repo");
  fs.cpSync(FIXTURE, repo, { recursive: true });
  // only the ApplicationSet deploys anything: the fixture's own Applications and Flux objects go
  fs.rmSync(path.join(repo, "apps"), { recursive: true, force: true });
  fs.rmSync(path.join(repo, "flux"), { recursive: true, force: true });
  fs.mkdirSync(path.join(repo, "sets"));
  fs.writeFileSync(path.join(repo, "sets", "set.yaml"), SET);
  fs.mkdirSync(path.join(repo, "plain"));
  fs.writeFileSync(
    path.join(repo, "plain", "cm.yaml"),
    "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: plain-config\ndata:\n  k: v\n",
  );
  return repo;
}

type E = { from: string; kind: string; to: string };

describe("generated Applications render through helm, kustomize and plain directories", () => {
  it("renders each, deploys its objects from it, and marks only the Applications generated-by", () => {
    const repo = estate();
    const r = run([repo, "--repo-url", URL_, "--format", "json"], path.dirname(repo), fakePath());
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const json = JSON.parse(r.stdout) as {
      nodes: { id: string; kind: string }[];
      edges: E[];
      opaque: { node: string | null; reason: string }[];
    };
    const apps = ["Application/argocd/gen-plain", "Application/argocd/gen-platform", "Application/argocd/gen-web"];
    expect(json.nodes.filter((n) => n.kind === "Application").map((n) => n.id)).toEqual(apps);
    // none of the three is opaque: each rendered
    for (const a of apps) expect(json.opaque.map((o) => o.node)).not.toContain(a);
    const deployedBy = (owner: string) =>
      json.edges.filter((e) => e.kind === "deployed-by" && e.to === owner).map((e) => e.from);
    expect(deployedBy("Application/argocd/gen-web").length).toBeGreaterThan(0);
    expect(deployedBy("Application/argocd/gen-platform").length).toBeGreaterThan(0);
    expect(deployedBy("Application/argocd/gen-plain")).toEqual(["ConfigMap/plain/plain-config"]);
    // generated-by: the three Applications only, never the objects they render
    expect(
      json.edges
        .filter((e) => e.kind === "generated-by")
        .map((e) => e.from)
        .sort(),
    ).toEqual(apps);
  });
});
