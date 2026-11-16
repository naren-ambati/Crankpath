// The Vault fixture (FR11.3, FR11.4, US11.3, US11.4, BR11.7 to BR11.9, OD-3, OD-6) over its
// hand-written rendered objects, the real extractors, GraphBuilder and CycleFinder, with no helm
// and no network. The node and edge sets of cycle A and cycle B, and the three externals listed
// UNRESOLVED, are the run's own output, written down after the first run and checked against the
// design's hand trace (see BUILD-NOTES, B4). Each case also breaks the fixture and sees the result
// change. The end-to-end golden over the repository trees with real rendering is B7's.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { argoExtractor } from "../../src/u5-extractors-gitops/argo-extractor.js";
import { vaultSealExtractor } from "../../src/u6-extractors-workload/vault-seal-extractor.js";
import { EXTRACTORS } from "../../src/u9-cli-package/pipeline-runner.js";
import {
  analyseFixture,
  edgeLines,
  fixtureConfig,
  fixtureContext,
  loadFixture,
  withEdits,
  withOverlays,
} from "../helpers/fixture-kit.js";

const VAULT = fileURLToPath(new URL("../fixtures/vault/", import.meta.url));
const VARIANT = (name: string) => fileURLToPath(new URL(`../fixtures/vault/variants/${name}/`, import.meta.url));
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});
function copy(dir: string): string {
  cleanup.push(dir);
  return dir;
}

const CYCLE_A_NODES = [
  "Application/argocd/platform",
  "ExternalSecret/argocd/repo-platform",
  "Secret/argocd/repo-platform",
];
const CYCLE_A_EDGES = [
  "Application/argocd/platform needs-credential Secret/argocd/repo-platform",
  "ExternalSecret/argocd/repo-platform deployed-by Application/argocd/platform",
  "Secret/argocd/repo-platform produced-by ExternalSecret/argocd/repo-platform",
];
const CYCLE_B_NODES = [
  "Certificate/vault/vault-tls",
  "ClusterIssuer/vault-pki",
  "Secret/vault/vault-tls",
  "Service/vault/vault",
  "StatefulSet/vault/vault",
];
const CYCLE_B_EDGES = [
  "Certificate/vault/vault-tls issued-by ClusterIssuer/vault-pki",
  "ClusterIssuer/vault-pki depends-on Service/vault/vault",
  "Secret/vault/vault-tls produced-by Certificate/vault/vault-tls",
  "Service/vault/vault selects StatefulSet/vault/vault",
  "StatefulSet/vault/vault needs-secret Secret/vault/vault-tls",
];
const EXTERNALS = ["external:aws-kms/us-east-1", "external:aws-sts", "external:github.com"];

function cyclesOf(root: string) {
  const f = loadFixture(root);
  const { graph, analysis } = analyseFixture(f);
  return { f, graph, cycles: analysis.cycles.map((c) => ({ ...c, lines: edgeLines(c.edges) })) };
}

describe("the Vault fixture: cycle A, cycle B and three externals (BR11.7, OD-3)", () => {
  const { f, graph, cycles } = cyclesOf(VAULT);

  it("reads every file of the fixture, skips nothing and reads the sources and render jobs it names", () => {
    expect(f.refused).toEqual([]);
    expect(f.skipped).toEqual([]);
    expect(f.jobs.map((j) => j.owner)).toEqual([
      "Application/argocd/root",
      "Application/argocd/platform",
      "Application/argocd/vault",
      "Application/argocd/platform-secrets",
      "Application/argocd/external-secrets",
    ]);
  });
  it("finds exactly two cycles, both extracted", () => {
    expect(cycles.map((c) => [c.nodes.length, c.edges.length, c.label])).toEqual([
      [3, 3, "extracted"],
      [5, 5, "extracted"],
    ]);
  });
  it("cycle A: the platform Application needs the credential its own ExternalSecret produces (3 edges)", () => {
    const a = cycles.find((c) => c.nodes.includes("Application/argocd/platform"));
    expect(a?.nodes).toEqual(CYCLE_A_NODES);
    expect(a?.lines).toEqual(CYCLE_A_EDGES);
  });
  it("cycle B: Vault's certificate is issued through Vault's own Service (5 edges, the Secret explicit)", () => {
    const b = cycles.find((c) => c.nodes.includes("StatefulSet/vault/vault"));
    expect(b?.nodes).toEqual(CYCLE_B_NODES);
    expect(b?.lines).toEqual(CYCLE_B_EDGES);
  });
  it("lists github.com, aws-kms/us-east-1 and aws-sts as externals with unspecified cold-start availability", () => {
    expect(graph.externals.map((e) => [e.id, e.coldStart, e.servedBy])).toEqual(
      EXTERNALS.map((id) => [id, "unspecified", null]),
    );
    expect(graph.unresolved.filter((u) => u.why === "external-unspecified").map((u) => u.subject)).toEqual(EXTERNALS);
  });
  it("leaves nothing else unresolved but the assumed Argo CD namespace: no stub, no ambiguity, no refused seal", () => {
    // Argo CD is installed outside the fixture, so its namespace is assumed from the Applications (M1, pass 2).
    expect(graph.unresolved.map((u) => `${u.why} ${u.subject}`)).toEqual([
      "argocd-namespace-assumed Namespace/argocd",
      ...EXTERNALS.map((id) => `external-unspecified ${id}`),
    ]);
    expect(graph.nodes.filter((n) => n.flags.length > 0).map((n) => n.id)).toEqual([]);
  });
  it("names where each external comes from", () => {
    const into = (id: string) => edgeLines(graph.edges.filter((e) => e.to === id));
    expect(into("external:aws-kms/us-east-1")).toEqual([
      "StatefulSet/platform-secrets/platform-secrets-vault seals-with external:aws-kms/us-east-1",
      "StatefulSet/vault/vault seals-with external:aws-kms/us-east-1",
    ]);
    expect(into("external:aws-sts")).toEqual([
      "ServiceAccount/platform-secrets/platform-secrets-vault assumes-identity external:aws-sts",
      "ServiceAccount/vault/vault assumes-identity external:aws-sts",
    ]);
    expect(into("external:github.com")).toEqual([
      "Application/argocd/external-secrets reads-source external:github.com",
      "Application/argocd/platform reads-source external:github.com",
      "Application/argocd/platform-secrets reads-source external:github.com",
      "Application/argocd/root reads-source external:github.com",
      "Application/argocd/vault reads-source external:github.com",
    ]);
  });
  it("links every Application that reads the private repo to its credential, and no other", () => {
    expect(edgeLines(graph.edges.filter((e) => e.kind === "needs-credential"))).toEqual([
      "Application/argocd/external-secrets needs-credential Secret/argocd/repo-platform",
      "Application/argocd/platform needs-credential Secret/argocd/repo-platform",
      "Application/argocd/vault needs-credential Secret/argocd/repo-platform",
    ]);
  });
  it("puts evidence on every edge", () => {
    for (const e of graph.edges) {
      expect([e.evidence.file, e.evidence.field, e.evidence.renderedPath].every((s) => s.length > 0)).toBe(true);
    }
  });
});

describe("the vault-helm ConfigMap shape for both release names (BR11.9, AC11.4.1)", () => {
  const f = loadFixture(VAULT);
  const r = vaultSealExtractor.extract(f.objects, fixtureContext(f.objects, f.jobs));
  it("reads the seal edge from vault-config and from platform-secrets-vault-config", () => {
    expect(r.edges.map((e) => [e.from, e.to, e.evidence.renderedPath])).toEqual([
      [
        "StatefulSet/platform-secrets/platform-secrets-vault",
        "external:aws-kms/us-east-1",
        "rendered/platform-secrets/configmap.yaml#1",
      ],
      ["StatefulSet/vault/vault", "external:aws-kms/us-east-1", "rendered/vault/configmap.yaml#1"],
    ]);
    expect(r.unresolved).toEqual([]);
  });
});

describe("the fixture's tests fail when the fixture is broken", () => {
  it("loses cycle A when the ExternalSecret no longer carries the credential label", () => {
    const text = fs
      .readFileSync(`${VAULT}platform/manifests/argocd/repo-platform.yaml`, "utf8")
      .replace("argocd.argoproj.io/secret-type: repository", "example.org/kind: repository");
    const { cycles } = cyclesOf(copy(withEdits(VAULT, { "platform/manifests/argocd/repo-platform.yaml": text })));
    expect(cycles.map((c) => c.nodes)).toEqual([CYCLE_B_NODES]);
  });
  it("loses cycle A when the credential is templated (BR5.14): no edge, an item", () => {
    const text = fs
      .readFileSync(`${VAULT}platform/manifests/argocd/repo-platform.yaml`, "utf8")
      .replace("url: git@github.com:acme/platform.git", 'url: "{{ .url }}"');
    const root = copy(withEdits(VAULT, { "platform/manifests/argocd/repo-platform.yaml": text }));
    const { cycles, graph } = cyclesOf(root);
    expect(cycles.map((c) => c.nodes)).toEqual([CYCLE_B_NODES]);
    expect(graph.unresolved.filter((u) => u.why === "credential-url-unresolved").map((u) => u.subject)).toEqual([
      "Secret/argocd/repo-platform",
    ]);
  });
  it("loses cycle B when the issuer's server names another host, and the host becomes an external", () => {
    const text = fs
      .readFileSync(`${VAULT}platform/manifests/cert-manager/vault-pki.yaml`, "utf8")
      .replace("https://vault.vault.svc:8200", "https://pki.example.org:8200");
    const { cycles, graph } = cyclesOf(
      copy(withEdits(VAULT, { "platform/manifests/cert-manager/vault-pki.yaml": text })),
    );
    expect(cycles.map((c) => c.nodes)).toEqual([CYCLE_A_NODES]);
    expect(graph.externals.map((e) => e.id)).toContain("external:pki.example.org");
  });
  it("loses the seal external of the main Vault when its StatefulSet stops mounting the ConfigMap", () => {
    const text = fs
      .readFileSync(`${VAULT}rendered/vault/statefulset.yaml`, "utf8")
      .replace("name: vault-config", "name: other-config");
    const { graph } = cyclesOf(copy(withEdits(VAULT, { "rendered/vault/statefulset.yaml": text })));
    expect(edgeLines(graph.edges.filter((e) => e.kind === "seals-with"))).toEqual([
      "StatefulSet/platform-secrets/platform-secrets-vault seals-with external:aws-kms/us-east-1",
    ]);
    expect(graph.unresolved.map((u) => `${u.why} ${u.subject}`)).toContain(
      "seal-workload-unidentified ConfigMap/vault/vault-config",
    );
  });
  it("makes no KMS edge and lists the region when the seal names no region (BR6.11, OD-14)", () => {
    const edits: Record<string, string> = {};
    for (const rel of ["rendered/vault/configmap.yaml", "rendered/platform-secrets/configmap.yaml"]) {
      edits[rel] = fs.readFileSync(`${VAULT}${rel}`, "utf8").replace(/ {6}region {5}= "us-east-1"\n/, "");
    }
    const { graph } = cyclesOf(copy(withEdits(VAULT, edits)));
    expect(graph.externals.map((e) => e.id)).toEqual(["external:aws-sts", "external:github.com"]);
    expect(graph.unresolved.filter((u) => u.why === "region-unresolved").map((u) => u.subject)).toEqual([
      "StatefulSet/platform-secrets/platform-secrets-vault",
      "StatefulSet/vault/vault",
    ]);
  });
  it("loses aws-sts when no ServiceAccount carries an identity annotation", () => {
    const edits: Record<string, string> = {};
    for (const rel of ["rendered/vault/serviceaccount.yaml", "rendered/platform-secrets/serviceaccount.yaml"]) {
      edits[rel] = fs.readFileSync(`${VAULT}${rel}`, "utf8").replace("eks.amazonaws.com/role-arn", "example.org/role");
    }
    const { graph } = cyclesOf(copy(withEdits(VAULT, edits)));
    expect(graph.externals.map((e) => e.id)).toEqual(["external:aws-kms/us-east-1", "external:github.com"]);
  });
  it("loses github.com when no repoURL names it (the externals are read, not listed by name)", () => {
    const f = loadFixture(VAULT);
    const without = EXTRACTORS.filter((e) => e !== argoExtractor);
    const { graph } = analyseFixture(f, undefined, without);
    expect(graph.externals.map((e) => e.id)).toEqual(["external:aws-kms/us-east-1", "external:aws-sts"]);
  });
});

describe("the two documented edits (BR11.8; statuses and the crank's effect are B5's)", () => {
  it("crank-a: the crankpath.yaml crank parses and names the credential Secret of cycle A", () => {
    const root = copy(withOverlays(VAULT, [VARIANT("crank-a")]));
    const config = fixtureConfig(`${root}/gitops`);
    expect(config.cranks.map((c) => [c.creates, c.by])).toEqual([
      [
        [{ kind: "node", node: "Secret/argocd/repo-platform" }],
        "kubectl create secret from the offline key backup, runbook DR-3",
      ],
    ]);
    // This build does not apply cranks: cycle A is still found, holds the crank's node, and the
    // analysis says cranks are not computed. B5 makes it `cranked`.
    const { analysis } = analyseFixture(loadFixture(root), config);
    expect(analysis.notComputed).toContain("cranks");
    const a = analysis.cycles.find((c) => c.nodes.includes("Application/argocd/platform"));
    expect(a?.nodes).toEqual(CYCLE_A_NODES);
    expect(a?.label).toBe("extracted");
  });
  it("ca-issuer: cycle B is gone and cycle A stays; the bootstrap CA comes from the platform-secrets store", () => {
    const root = copy(withOverlays(VAULT, [VARIANT("ca-issuer")]));
    const { cycles, graph } = cyclesOf(root);
    expect(cycles.map((c) => c.nodes)).toEqual([CYCLE_A_NODES]);
    expect(
      edgeLines(
        graph.edges.filter((e) =>
          ["Certificate/vault/vault-tls", "ClusterIssuer/bootstrap-ca", "Secret/cert-manager/bootstrap-ca"].includes(
            e.from,
          ),
        ),
      ),
    ).toEqual([
      "Certificate/vault/vault-tls deployed-by Application/argocd/platform",
      "Certificate/vault/vault-tls issued-by ClusterIssuer/bootstrap-ca",
      "ClusterIssuer/bootstrap-ca deployed-by Application/argocd/platform",
      "ClusterIssuer/bootstrap-ca needs-secret Secret/cert-manager/bootstrap-ca",
      "Secret/cert-manager/bootstrap-ca produced-by ExternalSecret/cert-manager/bootstrap-ca",
    ]);
    expect(graph.unresolved.map((u) => u.why)).toEqual([
      "argocd-namespace-assumed",
      ...EXTERNALS.map(() => "external-unspecified"),
    ]);
  });
});
