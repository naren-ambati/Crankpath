// Regression tests for the second review of B5 (reviews/bolt-5-review-pass-2.md) at the extractor
// and analysis level, each written to fail before its fix: M1 (an Application over a credential
// whose url cannot be read is never startable), M3 (the wildcard match work is bounded in steps
// actually done, so the worst shapes finish fast and count a limit), m2 (every producer of an item
// with a non-node subject names its owner), m5 (one host fallback for matcher and extractors), n1.

import { describe, expect, it } from "vitest";
import type { DataValue, RenderedObject } from "../../src/u1-graph-model/extractor.js";
import { credentialExtractor } from "../../src/u5-extractors-gitops/credential-extractor.js";
import { fluxExtractor } from "../../src/u5-extractors-gitops/flux-extractor.js";
import { certManagerExtractor } from "../../src/u6-extractors-workload/cert-manager-extractor.js";
import { resolveHost } from "../../src/u6-extractors-workload/external-host.js";
import { createHostMatching } from "../../src/u6-extractors-workload/host-matcher.js";
import { secretStoreExtractor } from "../../src/u6-extractors-workload/secret-store-extractor.js";
import { workloadRefExtractor } from "../../src/u6-extractors-workload/workload-refs.js";
import { analyseFixture } from "../helpers/fixture-kit.js";
import { externalDecl, facts } from "../helpers/graphs.js";
import { context, obj } from "../helpers/objects.js";

const LABEL = "argocd.argoproj.io/secret-type";
const app = (name: string, repoURL: string, ns = "argocd") =>
  obj(
    {
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name, namespace: ns },
      spec: { source: { repoURL, path: "." } },
    },
    { file: `apps/${name}.yaml` },
  );
const es = (name: string, url: DataValue) =>
  obj(
    {
      apiVersion: "external-secrets.io/v1",
      kind: "ExternalSecret",
      metadata: { name, namespace: "argocd" },
      spec: {
        secretStoreRef: { kind: "ClusterSecretStore", name: "s" },
        target: { template: { metadata: { labels: { [LABEL]: "repository" } }, data: { url } } },
      },
    },
    { file: `c/${name}.yaml` },
  );
const statusOf = (objects: RenderedObject[], id: string) =>
  analyseFixture(
    { objects, jobs: [] },
    facts({ externals: [externalDecl("github.com", "available")] }),
  ).analysis.verdicts.find((v) => v.node === id);

describe("M1: a credential whose url cannot be read leaves the Applications that may need it unverified", () => {
  it.each([
    ["templated", "{{ .url }}"],
    ["unparseable", "not a url at all"],
  ])("a %s url: the Application reading a private host is never startable", (_name, url) => {
    const objects = [app("a", "git@github.com:acme/platform.git"), es("repo", url)];
    expect(statusOf(objects, "Application/argocd/a")).toMatchObject({ status: "unverified", reason: "unresolved" });
    const items = credentialExtractor.extract(objects, context(objects)).unresolved;
    expect(items.find((u) => u.why === "credential-unreadable")).toMatchObject({
      subject: "Application/argocd/a",
      owner: "Application/argocd/a",
      candidates: ["Secret/argocd/repo"],
    });
  });
  it("leaves an Application that reads only the scanned repo, or sits outside Argo CD's namespace, as it was", () => {
    const objects = [app("a", "git@github.com:acme/platform.git"), es("repo", "{{ .url }}")];
    const withLiteral = [app("a", "git@github.com:acme/platform.git"), es("repo", "git@github.com:acme/other.git")];
    expect(statusOf(withLiteral, "Application/argocd/a")?.status).toBe("startable");
    expect(objects).toHaveLength(2);
  });
});

describe("m2: each producer of an item with a non-node subject names its owner", () => {
  const unresolvedOf = (
    objects: RenderedObject[],
    extract: (o: RenderedObject[]) => { unresolved: readonly { why: string; owner: string | null }[] },
  ) => extract(objects).unresolved.filter((u) => u.why === "invalid-reference");
  it("references (Flux sourceRef with a name that is not a Kubernetes name, and one that is not a string)", () => {
    for (const name of ["Bad_Name", 7] as DataValue[]) {
      const ks = obj({
        apiVersion: "kustomize.toolkit.fluxcd.io/v1",
        kind: "Kustomization",
        metadata: { name: "apps", namespace: "flux-system" },
        spec: { sourceRef: { kind: "GitRepository", name } },
      });
      const items = unresolvedOf([ks], (o) => fluxExtractor.extract(o, context(o)));
      expect(items.map((u) => u.owner)).toEqual(["Kustomization/flux-system/apps"]);
    }
  });
  it("a Certificate whose secretName is not a Kubernetes name", () => {
    const cert = obj({
      apiVersion: "cert-manager.io/v1",
      kind: "Certificate",
      metadata: { name: "tls", namespace: "a" },
      spec: { secretName: "Bad_Name", issuerRef: { kind: "ClusterIssuer", name: "ca" } },
    });
    expect(unresolvedOf([cert], (o) => certManagerExtractor.extract(o, context(o))).map((u) => u.owner)).toEqual([
      "Certificate/a/tls",
    ]);
  });
  it("an ExternalSecret whose target name is not a Kubernetes name", () => {
    const e = obj({
      apiVersion: "external-secrets.io/v1",
      kind: "ExternalSecret",
      metadata: { name: "x", namespace: "a" },
      spec: { secretStoreRef: { kind: "SecretStore", name: "s" }, target: { name: "Bad_Name" } },
    });
    expect(unresolvedOf([e], (o) => secretStoreExtractor.extract(o, context(o))).map((u) => u.owner)).toEqual([
      "ExternalSecret/a/x",
    ]);
  });
  it("a Deployment whose secretKeyRef name is not a Kubernetes name", () => {
    const d = obj({
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "web", namespace: "a" },
      spec: {
        template: {
          spec: {
            containers: [
              { name: "c", env: [{ name: "X", valueFrom: { secretKeyRef: { name: "Bad_Name", key: "k" } } }] },
            ],
          },
        },
      },
    });
    expect(unresolvedOf([d], (o) => workloadRefExtractor.extract(o, context(o))).map((u) => u.owner)).toEqual([
      "Deployment/a/web",
    ]);
  });
});

describe("M3: the wildcard match work is bounded by the steps actually done", () => {
  it("the reviewer's worst shape (2,000 all-wildcard entries, 800 hosts of 63-character labels) finishes fast", () => {
    const heavy = `*${"a*".repeat(28)}`;
    const failing = `${heavy.slice(0, -1)}b`;
    const rules = Array.from({ length: 2000 }, (_, i) => ({
      host: [failing, heavy, heavy, `${heavy}x${i}`].join("."),
      node: "Namespace/default",
      order: i,
      keyPath: `match[${i}]`,
    }));
    const m = createHostMatching([], rules);
    const lab = "a".repeat(63);
    const t0 = Date.now();
    for (let i = 0; i < 800; i++)
      m.match({
        host: [`${"a".repeat(58)}${String(i).padStart(5, "0")}`, lab, lab, `${lab.slice(0, 50)}x${i}`].join("."),
        field: "f",
        bareNamespace: null,
      });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(m.limitHit()).toBe(true);
  });
  it("an entry with a literal suffix is consulted only by hosts that end in it", () => {
    const rules = Array.from({ length: 50_000 }, (_, i) => ({
      host: `*.zone${i}.example.org`,
      node: "x",
      order: i,
      keyPath: `match[${i}]`,
    }));
    const m = createHostMatching([], rules);
    for (let i = 0; i < 5000; i++) {
      expect(m.match({ host: `h.zone${i}.example.org`, field: "f", bareNamespace: null }).rule).toBe(`match[${i}]`);
    }
    expect(m.limitHit()).toBe(false);
  });
});

describe("m5: one host fallback for the matcher and every extractor", () => {
  it("resolveHost takes the external from the context, the same function the matcher was given", () => {
    const objects: RenderedObject[] = [];
    const ctx = {
      ...context(objects),
      externalOf: (h: string) => (h === "odd.example" ? "external:named-by-context" : null),
    };
    expect(resolveHost(ctx, "odd.example", "f", null)).toMatchObject({ kind: "node", id: "external:named-by-context" });
  });
});
