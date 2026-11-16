// External hosts, URL hosts, auth-reference walking and cloud identity (BR6.12, BR6.13 to BR6.16).

import { describe, expect, it } from "vitest";
import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import { argoExtractor } from "../../src/u5-extractors-gitops/argo-extractor.js";
import { cloudIdentityExtractor } from "../../src/u6-extractors-workload/cloud-identity.js";
import { externalHostName, urlHost } from "../../src/u6-extractors-workload/external-host.js";
import { ROOT_ZONE_TLDS, ROOT_ZONE_VERSION } from "../../src/u6-extractors-workload/root-zone-tlds.js";
import { authReferences } from "../../src/u6-extractors-workload/references.js";
import { context, meta, obj } from "../helpers/objects.js";

describe("which unmatched hosts are external preconditions", () => {
  const ns = new Set(["gitea", "vault"]);
  it.each([
    ["github.com", "github.com"],
    ["GitHub.COM.", "github.com"],
    ["charts.example.org", "charts.example.org"],
    ["kms.us-east-1.amazonaws.com", "kms.us-east-1.amazonaws.com"],
  ])("%s is external %s", (host, name) => {
    expect(externalHostName(host, ns)).toBe(name);
  });
  it.each([
    ["gitea", "one label: a bare Service name"],
    ["gitea-http.gitea", "<svc>.<ns> with a namespace of the estate"],
    ["gitea-http.other", "<svc>.<ns> with a namespace outside the estate (m1)"],
    ["vault.vault.svc", "a .svc form"],
    ["vault.vault.svc.cluster.local", "a cluster.local form"],
    ["printer.local", "mDNS"],
    ["10.0.0.1", "an IPv4 literal"],
    ["", "empty"],
    ["a..b", "an empty label"],
    ["exa mple.org", "a space"],
    ["-x.org", "a label starting with a hyphen"],
    [`${"a".repeat(64)}.org`, "a label over 63 characters"],
  ])("%s is not external (%s)", (host) => {
    expect(externalHostName(host, ns)).toBeNull();
  });
});

describe("the host of a URL-valued field", () => {
  it.each([
    ["https://vault.vault.svc:8200", "vault.vault.svc"],
    ["http://user:pw@Example.ORG/x", "example.org"],
    ["oci://ghcr.io/acme/charts", "ghcr.io"],
    ["ssh://git@github.com/acme/x", "github.com"],
    ["minio.minio.svc:9000", "minio.minio.svc"],
  ])("%s has host %s", (url, host) => {
    expect(urlHost(url)).toBe(host);
  });
  it("keeps an IPv6 literal, brackets and all, so it is listed rather than dropped (m3)", () => {
    expect(urlHost("https://[::1]:8200")).toBe("[::1]");
  });
  it.each(["", "https://", "https://a b", "https://x\u001b.org", "http://exa\\mple.org"])(
    "%j has no host crankpath uses",
    (url) => {
      expect(urlHost(url)).toBeNull();
    },
  );
});

describe("auth references, found by key name only", () => {
  it("finds Secret, ServiceAccount and CA references at any depth up to the bound, in field order", () => {
    const block: DataValue = {
      kubernetes: { serviceAccountRef: { name: "sa" }, secretRef: { name: "s1" } },
      list: [{ tokenSecretRef: { name: "s2", namespace: "n" } }],
      secretRef: { accessKeyIDSecretRef: { name: "s3" } },
      caProvider: { type: "Secret", name: "ca" },
      url: "https://vault.vault.svc",
      note: { secretName: "not-a-ref" },
    };
    expect(authReferences(block, "a").map((r) => [r.targetKind, r.name, r.namespace ?? null, r.field])).toEqual([
      ["Secret", "ca", null, "a.caProvider.name"],
      ["Secret", "s1", null, "a.kubernetes.secretRef.name"],
      ["ServiceAccount", "sa", null, "a.kubernetes.serviceAccountRef.name"],
      ["Secret", "s2", "n", "a.list[0].tokenSecretRef.name"],
      ["Secret", "s3", null, "a.secretRef.accessKeyIDSecretRef.name"],
    ]);
  });
  it("stops at a fixed depth, so a deeply nested hostile block is not walked forever", () => {
    let deep: DataValue = { secretRef: { name: "bottom" } };
    for (let i = 0; i < 10_000; i++) deep = { x: deep };
    expect(authReferences(deep, "a")).toEqual([]);
    let shallow: DataValue = { secretRef: { name: "s" } };
    for (let i = 0; i < 5; i++) shallow = { x: shallow };
    expect(authReferences(shallow, "a").map((r) => r.name)).toEqual(["s"]);
  });
});

describe("cloud identity (BR6.12)", () => {
  const sa = (annotations: Record<string, string>) =>
    obj(meta("ServiceAccount", "vault", "vault", { metadata: { name: "vault", namespace: "vault", annotations } }), {
      file: "sa.yaml",
    });
  const extract = (annotations: Record<string, string>) => {
    const o = sa(annotations);
    const r = cloudIdentityExtractor.extract([o], context([o]));
    return { r, edges: r.edges.map((e) => `${e.from} ${e.kind} ${e.to} @${e.evidence.field}`) };
  };
  it("an IRSA role makes the ServiceAccount depend on aws-sts", () => {
    const x = extract({ "eks.amazonaws.com/role-arn": "arn:aws:iam::111122223333:role/x" });
    expect(x.edges).toEqual([
      "ServiceAccount/vault/vault assumes-identity external:aws-sts @metadata.annotations.eks.amazonaws.com/role-arn",
    ]);
    expect(x.r.externals.map((e) => [e.id, e.coldStart])).toEqual([["external:aws-sts", "unspecified"]]);
  });
  it("a GKE workload identity makes it depend on gcp-iam", () => {
    expect(extract({ "iam.gke.io/gcp-service-account": "x@p.iam.gserviceaccount.com" }).edges).toEqual([
      "ServiceAccount/vault/vault assumes-identity external:gcp-iam @metadata.annotations.iam.gke.io/gcp-service-account",
    ]);
  });
  it("an empty value, another annotation or a label is no edge", () => {
    expect(extract({ "eks.amazonaws.com/role-arn": " " }).edges).toEqual([]);
    expect(extract({ "example.org/role-arn": "arn" }).edges).toEqual([]);
    const labelled = obj(
      {
        apiVersion: "v1",
        kind: "ServiceAccount",
        metadata: { name: "x", namespace: "a", labels: { "eks.amazonaws.com/role-arn": "arn" } },
      },
      { file: "l.yaml" },
    );
    expect(cloudIdentityExtractor.extract([labelled], context([labelled])).edges).toEqual([]);
  });
});

describe("review fixes: a name that may be in-cluster is never an external (m1)", () => {
  const ns = new Set(["argocd"]);
  it.each([
    ["kubernetes.default", "the API server's short form"],
    ["kubernetes.default.svc", "the API server's .svc form"],
    ["prometheus.monitoring", "<svc>.<ns> with a namespace made outside the estate"],
    ["my-svc.team-ns", "<svc>.<ns>"],
    ["svc.ns.cluster", "a custom cluster domain"],
    ["vault.vault.svc.corp.example", "a .svc label inside a longer cluster domain"],
    ["x.local", "a .local name"],
  ])("%s is not external (%s)", (host) => {
    expect(externalHostName(host, ns)).toBeNull();
  });
  it.each([["github.com"], ["ghcr.io"], ["charts.example.org"], ["metadata.google.internal"]])(
    "%s, which cannot be a cluster name, is external",
    (host) => {
      expect(externalHostName(host, ns)).toBe(host);
    },
  );
  it("an unmatched name that may be in-cluster is no edge and one host-unplaced item", () => {
    const a = obj(
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "a", namespace: "argocd" },
        spec: { source: { repoURL: "http://prometheus.monitoring:9090/x", path: "." } },
      },
      { file: "a.yaml" },
    );
    const r = argoExtractor.extract([a], context([a]));
    expect(r.edges).toEqual([]);
    expect(r.externals).toEqual([]);
    expect(r.unresolved.map((u) => [u.why, u.subject, u.field])).toEqual([
      ["host-unplaced", "Application/argocd/a", "spec.source.repoURL"],
    ]);
  });
});

describe("pass 2: the dated root-zone list decides two-label names (m1, n3)", () => {
  it("is the registry's list: 1,436 lower-case DNS labels, with its version", () => {
    expect(ROOT_ZONE_VERSION).toBe("Version 2026111500, Last Updated Sun Nov 15 07:07:01 2026 UTC");
    expect(ROOT_ZONE_TLDS.size).toBe(1436);
    for (const t of ROOT_ZONE_TLDS) expect(t).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    for (const not of ["svc", "local", "cluster", "default", "monitoring", "internal"]) {
      expect(ROOT_ZONE_TLDS.has(not)).toBe(false);
    }
  });
  it.each(["github.com", "sr.ht", "gitea.xyz", "charts.dev", "ghcr.io", "acme.biz", "x.xn--p1ai"])(
    "%s, ending in a delegated top-level domain, is external",
    (host) => {
      expect(externalHostName(host, new Set(["argocd"]))).toBe(host);
    },
  );
  it.each(["kubernetes.default", "api.team-ns", "vault.platform"])(
    "%s, ending in no top-level domain, is not",
    (host) => {
      expect(externalHostName(host, new Set())).toBeNull();
    },
  );
  it("a namespace of the estate named like a top-level domain overrides the list", () => {
    expect(externalHostName("github.com", new Set(["com"]))).toBeNull();
    expect(externalHostName("api.dev", new Set(["dev"]))).toBeNull();
    expect(externalHostName("api.dev", new Set(["prod"]))).toBe("api.dev");
  });
});
