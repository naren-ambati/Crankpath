// Regression tests for the independent review of B5 (reviews/bolt-5-review.md), each written to
// fail before its fix: M1 (a match entry silently replacing an extracted resolution), M2 (a dropped
// reference leaving its owner startable), m2 to m5 (closing counts, assumptions, declared cycles in
// blocked-by, the per-namespace cluster-provided exemption).

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { app, copyThinSlice, estate, run, THIN_SLICE_URL } from "../helpers/scan.js";
import { unwrapText } from "../helpers/text.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
const line = (text: string, prefix: string) => text.split("\n").find((l) => l.startsWith(prefix)) ?? "";

function thin(config: string) {
  const repo = copyThinSlice();
  cleanup.push(path.dirname(repo));
  fs.writeFileSync(path.join(repo, "crankpath.yaml"), config);
  return both(repo);
}
function both(repo: string) {
  const t = run([repo, "--repo-url", THIN_SLICE_URL], process.cwd());
  const j = run([repo, "--repo-url", THIN_SLICE_URL, "--format", "json"], process.cwd());
  expect(t.code).toBe(0);
  return { text: unwrapText(t.stdout), json: JSON.parse(j.stdout) };
}
function scan(files: Record<string, string>) {
  const d = estate(files);
  cleanup.push(d);
  return both(d);
}

describe("M1: a match entry that overrides an extracted resolution is listed, and the cycle it hides is shown", () => {
  const r = thin('match:\n  - {host: "gitea-http.gitea", node: "Namespace/default"}\n');
  it("lists the override per host: the host, the extracted target and the declared target", () => {
    expect(r.text).toContain(
      '  match entry "match[0]" overrides host "gitea-http.gitea": extracted Service "gitea/gitea-http"; declared Namespace "default" (not verified)\n',
    );
    expect(r.json.matchOverrides).toEqual([
      {
        declared: "Namespace/default",
        extracted: { candidates: ["Service/gitea/gitea-http"], node: "Service/gitea/gitea-http", outcome: "unique" },
        host: "gitea-http.gitea",
        keyPath: "match[0]",
      },
    ]);
  });
  it("shows the extracted cycle the override hides, naming the entry", () => {
    expect(r.text).toContain(
      [
        "  1 cycle not reported because a match entry overrode a host on it:",
        '    cycle c-d8197e7d  label: extracted  nodes: 5  edges: 8  hidden by: match entry "match[0]"',
      ].join("\n"),
    );
    expect(r.json.hiddenCycles).toEqual([
      {
        edges: 8,
        hiddenBy: ["match[0]"],
        id: "c-d8197e7d",
        label: "extracted",
        nodeIds: [
          "Application/argocd/gitea",
          "ConfigMap/gitea/gitea-config",
          "Deployment/gitea/gitea",
          "Secret/gitea/gitea-admin",
          "Service/gitea/gitea-http",
        ],
        nodes: 5,
      },
    ]);
  });
  it("makes reliance on declared facts a gap, and says so on the no-cycle line", () => {
    expect(line(r.text, "  gaps:")).toContain("1 declared fact changes the graph read (crankpath.yaml, not verified)");
    // with cycles hidden, the headline says so (B5 review pass 2, m1), never a bare "none found"
    expect(line(r.text, "Cycles:")).toBe(
      "Cycles: none found in the graph read with 1 match override applied; 1 cycle hidden by the overrides (listed below)",
    );
    expect(r.json.runStatus.reasons).toContain("declared-facts");
  });
  it("keeps an entry that agrees with the extracted resolution extracted: no override, no hidden cycle, no gap", () => {
    const agree = thin('match:\n  - {host: "gitea-http.gitea", node: "Service/gitea/gitea-http"}\n');
    expect(agree.json.cycles[0].label).toBe("extracted");
    expect(agree.json.matchOverrides).toEqual([]);
    expect(agree.json.hiddenCycles).toEqual([]);
    expect(agree.json.unusedMatches).toEqual([]);
    expect(agree.json.runStatus.reasons).not.toContain("declared-facts");
  });
});

describe("M1, m3: declared facts that change the graph are a gap; those the plan assumes are listed", () => {
  // the thin slice without its hostile files: one extracted cycle, every input read, ANALYSED
  const clean = (config: string, edit?: (repo: string) => void) => {
    const repo = copyThinSlice();
    cleanup.push(path.dirname(repo));
    fs.rmSync(path.join(repo, "apps", "notes.yaml"));
    fs.rmSync(path.join(repo, "platform", "gitea", "hostile.yaml"));
    fs.writeFileSync(path.join(repo, "crankpath.yaml"), config);
    edit?.(repo);
    return both(repo);
  };
  it("still says ANALYSED with no declared fact and no gap (the guard can pass)", () => {
    const r = clean("");
    expect(line(r.text, "Run status:")).toBe("Run status: ANALYSED");
    expect(r.json.runStatus.counts.declaredFacts).toBe(0);
  });
  it.each([
    [
      "an external declared available",
      "external:\n  github.com: {cold_start: available}\n",
      "1 external declared in crankpath.yaml",
    ],
    [
      "a documented crank",
      'cranks:\n  - {creates: "Application/argocd/gitea", by: "hand"}\n',
      "1 crank documented (not verified)",
    ],
  ])("keeps ANALYSED with %s, and names it as not verified", (_name, config, named) => {
    const r = clean(config);
    expect(line(r.text, "Run status:")).toBe("Run status: ANALYSED");
    expect(line(r.text, "Not verified:")).toContain(named);
    expect(r.json.runStatus.counts.declaredAssumptions).toBe(1);
  });
  it.each([
    [
      "a declared edge",
      'edges:\n  - {from: "Secret/gitea/gitea-admin", to: "ConfigMap/gitea/gitea-config", why: "runbook"}\n',
    ],
    ["a match entry that overrides a host", 'match:\n  - {host: "gitea-http.gitea", node: "Namespace/default"}\n'],
  ])("gives the declared-facts gap with %s, which changes the graph read", (_name, config) => {
    const r = clean(config);
    expect(line(r.text, "Run status:")).toBe("Run status: ANALYSED WITH GAPS");
    expect(line(r.text, "  gaps:")).toContain("1 declared fact changes the graph read (crankpath.yaml, not verified)");
    expect(r.json.runStatus.reasons).toContain("declared-facts");
  });
  it("says on the no-cycle line when the result rests on declared facts of any kind", () => {
    const r = clean('cranks:\n  - {creates: "Application/argocd/gitea", by: "hand"}\n');
    expect(line(r.text, "Cycles:")).toBe("Cycles: 0 uncranked, 1 cranked");
    const noCycle = clean("external:\n  github.com: {cold_start: available}\n", (repo) =>
      fs.rmSync(path.join(repo, "platform", "gitea", "service.yaml")),
    );
    expect(line(noCycle.text, "Cycles:")).toContain("the result rests on 1 declared fact from crankpath.yaml");
  });
  it("names served_by and match entries in the plan's assumptions", () => {
    const r = thin(
      'external:\n  mirror: {served_by: "Service/gitea/gitea-http"}\nmatch:\n  - {host: "gitea-http.gitea", node: mirror}\n',
    );
    expect(line(r.text, "  Assumed,")).toContain("1 external served by an in-estate node");
    expect(line(r.text, "  Assumed,")).toContain("1 match entry");
    expect(r.json.plan.assumes.servedBy).toEqual(["external:mirror"]);
    expect(r.json.plan.assumes.matchEntries).toEqual(["match[0]"]);
  });
});

describe("M2: a dropped reference makes the object that holds it unverified", () => {
  it("never makes a Deployment with an invalid Secret name startable", () => {
    const dep = [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata: {name: web, namespace: a}",
      "spec:",
      "  template:",
      "    spec:",
      "      containers:",
      "        - name: c",
      "          env:",
      "            - name: X",
      "              valueFrom: {secretKeyRef: {name: Bad_Name, key: k}}",
      "",
    ].join("\n");
    const r = scan({ "apps/a.yaml": app("a", "p"), "p/d.yaml": dep });
    const web = r.json.statuses.find((s: { node: string }) => s.node === "Deployment/a/web");
    expect(web).toMatchObject({ status: "unverified", reason: "unresolved" });
    expect(r.json.unresolved.find((u: { why: string }) => u.why === "invalid-reference")).toMatchObject({
      owner: "Deployment/a/web",
    });
    expect(r.json.plan.steps.flatMap((s: { nodes: string[] }) => s.nodes)).not.toContain("Deployment/a/web");
  });
});

describe("m2: the closing line counts only what the analysis used", () => {
  it("does not count a crank that matched nothing as documented", () => {
    const r = thin('cranks:\n  - {creates: "Secret/gitea/nothing", by: "x"}\n');
    expect(line(r.text, "Not verified:")).not.toContain("crank documented");
    expect(line(r.text, "  Assumed,")).toContain("0 cranks (documented)");
  });
});

describe("m4: a blocked-by group names the cycle's label", () => {
  it("says which kind of cycle blocks the nodes", () => {
    const r = thin("");
    expect(r.text).toContain("  blocked by cycle c-d8197e7d (extracted): 6 nodes\n");
  });
});

describe("m5: the per-namespace cluster-provided exemption needs the namespace", () => {
  const dep = (ns: string) =>
    [
      "apiVersion: apps/v1",
      "kind: Deployment",
      `metadata: {name: web, namespace: ${ns}}`,
      "spec:",
      "  template:",
      "    spec:",
      "      serviceAccountName: default",
      "      containers: [{name: c}]",
      "",
    ].join("\n");
  const status = (files: Record<string, string>) =>
    scan(files).json.statuses.find((s: { node: string }) => s.node.startsWith("ServiceAccount/"));
  it("keeps a default ServiceAccount in a namespace no readable object defines not-defined", () => {
    expect(status({ "apps/a.yaml": app("a", "p"), "p/d.yaml": dep("apps") })).toMatchObject({
      status: "unverified",
      reason: "undefined-reference",
    });
  });
  it("exempts it when the estate defines the namespace, or the namespace is one every cluster has", () => {
    const ns = "apiVersion: v1\nkind: Namespace\nmetadata: {name: apps}\n";
    expect(status({ "apps/a.yaml": app("a", "p"), "p/d.yaml": dep("apps"), "p/ns.yaml": ns })).toMatchObject({
      status: "startable",
    });
    expect(status({ "apps/a.yaml": app("a", "p"), "p/d.yaml": dep("kube-system") })).toMatchObject({
      status: "startable",
    });
  });
});
