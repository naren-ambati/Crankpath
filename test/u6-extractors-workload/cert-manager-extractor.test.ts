// CertManagerExtractor (BR6.4 to BR6.6): positive and negative cases, each unknown with no edge
// and an item.

import { describe, expect, it } from "vitest";
import type { DataValue, RenderedObject } from "../../src/u1-graph-model/extractor.js";
import { certManagerExtractor } from "../../src/u6-extractors-workload/cert-manager-extractor.js";
import { HOSTILE_STRINGS, setPath } from "../helpers/fixture-kit.js";
import { context, obj } from "../helpers/objects.js";

const CM = "cert-manager.io/v1";
function crd(kind: string, ns: string | null, name: string, spec: DataValue, apiVersion = CM): RenderedObject {
  const metadata: Record<string, DataValue> = { name };
  if (ns !== null) metadata.namespace = ns;
  return obj({ apiVersion, kind, metadata, spec }, { file: `${kind}-${name}.yaml` });
}
function extract(objects: RenderedObject[]) {
  const r = certManagerExtractor.extract(objects, context(objects));
  return {
    r,
    edges: r.edges.map((e) => `${e.from} ${e.kind} ${e.to} @${e.evidence.field}`).sort(),
    items: r.unresolved.map((u) => `${u.why} ${u.subject} @${u.field ?? ""}`).sort(),
  };
}
const svc = obj(
  {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "vault", namespace: "vault" },
    spec: { selector: { a: "b" } },
  },
  { file: "svc.yaml" },
);

describe("Certificates (BR6.4)", () => {
  it("depends on its issuer (Issuer by default) and its Secret depends on it; the Secret node is made here", () => {
    const x = extract([crd("Certificate", "web", "tls", { secretName: "web-tls", issuerRef: { name: "local" } })]);
    expect(x.edges).toEqual([
      "Certificate/web/tls issued-by Issuer/web/local @spec.issuerRef.name",
      "Secret/web/web-tls produced-by Certificate/web/tls @spec.secretName",
    ]);
    expect(x.r.nodes.map((n) => n.id)).toEqual(["Secret/web/web-tls"]);
  });
  it("names a ClusterIssuer by its cluster-scoped id", () => {
    const x = extract([
      crd("Certificate", "web", "tls", { secretName: "s", issuerRef: { name: "pki", kind: "ClusterIssuer" } }),
    ]);
    expect(x.edges).toContain("Certificate/web/tls issued-by ClusterIssuer/pki @spec.issuerRef.name");
  });
  it("lists an external issuer (another API group) and an unknown issuer kind, with no issuer edge", () => {
    const external = crd("Certificate", "web", "a", {
      secretName: "a",
      issuerRef: { name: "x", kind: "AWSPCAClusterIssuer", group: "awspca.cert-manager.io" },
    });
    const odd = crd("Certificate", "web", "b", { secretName: "b", issuerRef: { name: "x", kind: "Signer" } });
    const x = extract([external, odd]);
    expect(x.edges.filter((e) => e.includes("issued-by"))).toEqual([]);
    expect(x.items).toEqual([
      "invalid-reference Certificate/web/b @spec.issuerRef.kind",
      "unsupported-provider Certificate/web/a @spec.issuerRef.group",
    ]);
  });
  it("lists a secretName that is not a Kubernetes name, with no edge and no node", () => {
    const x = extract([crd("Certificate", "web", "tls", { secretName: "a/b", issuerRef: { name: "i" } })]);
    expect(x.r.nodes).toEqual([]);
    expect(x.items).toEqual(["invalid-reference a/b @spec.secretName"]);
  });
  it("reads no host from dnsNames or commonName (BR6.16)", () => {
    const x = extract([
      svc,
      crd("Certificate", "vault", "tls", {
        secretName: "t",
        commonName: "vault.vault.svc",
        dnsNames: ["vault.vault.svc"],
      }),
    ]);
    expect(x.edges.filter((e) => e.includes("Service"))).toEqual([]);
  });
});

describe("issuers (BR6.5, BR6.6)", () => {
  it("a CA issuer depends on its secretName Secret, in its own namespace", () => {
    expect(extract([crd("Issuer", "web", "ca", { ca: { secretName: "root" } })]).edges).toEqual([
      "Issuer/web/ca needs-secret Secret/web/root @spec.ca.secretName",
    ]);
  });
  it("a ClusterIssuer's Secrets are in cert-manager's cluster resource namespace", () => {
    expect(extract([crd("ClusterIssuer", null, "ca", { ca: { secretName: "root" } })]).edges).toEqual([
      "ClusterIssuer/ca needs-secret Secret/cert-manager/root @spec.ca.secretName",
    ]);
  });
  it("a Vault issuer depends on the Service its server names, its CA bundle and its auth references", () => {
    const issuer = crd("ClusterIssuer", null, "vault-pki", {
      vault: {
        server: "https://vault.vault.svc:8200",
        path: "pki/sign/x",
        caBundleSecretRef: { name: "vault-ca", key: "ca.crt" },
        auth: { kubernetes: { role: "r", serviceAccountRef: { name: "issuer" } }, tokenSecretRef: { name: "tok" } },
      },
    });
    expect(extract([svc, issuer]).edges).toEqual([
      "ClusterIssuer/vault-pki depends-on Service/vault/vault @spec.vault.server",
      "ClusterIssuer/vault-pki needs-secret Secret/cert-manager/tok @spec.vault.auth.tokenSecretRef.name",
      "ClusterIssuer/vault-pki needs-secret Secret/cert-manager/vault-ca @spec.vault.caBundleSecretRef.name",
      "ClusterIssuer/vault-pki runs-as ServiceAccount/cert-manager/issuer @spec.vault.auth.kubernetes.serviceAccountRef.name",
    ]);
  });
  it("an ACME issuer depends on its CA's host as an external, and on its solvers' Secrets, not its account key", () => {
    const issuer = crd("Issuer", "web", "acme", {
      acme: {
        server: "https://acme.example.org/directory",
        privateKeySecretRef: { name: "account-key" },
        externalAccountBinding: { keyID: "k", keySecretRef: { name: "eab" } },
        solvers: [
          { dns01: { route53: { region: "us-east-1", accessKeyIDSecretRef: { name: "r53" } } } },
          { http01: {} },
        ],
      },
    });
    const x = extract([issuer]);
    expect(x.edges).toEqual([
      "Issuer/web/acme depends-on external:acme.example.org @spec.acme.server",
      "Issuer/web/acme needs-secret Secret/web/eab @spec.acme.externalAccountBinding.keySecretRef.name",
      "Issuer/web/acme needs-secret Secret/web/r53 @spec.acme.solvers[0].dns01.route53.accessKeyIDSecretRef.name",
    ]);
    expect(x.r.externals.map((e) => e.id)).toEqual(["external:acme.example.org"]);
  });
  it("makes no edge for a server matching two Services, and lists the ambiguity", () => {
    const other = obj(
      { apiVersion: "v1", kind: "Service", metadata: { name: "vault", namespace: "b" } },
      { file: "b.yaml" },
    );
    const x = extract([svc, other, crd("Issuer", "web", "v", { vault: { server: "https://vault:8200" } })]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.candidates])).toEqual([
      ["host-ambiguous", ["Service/b/vault", "Service/vault/vault"]],
    ]);
  });
  it("a selfSigned issuer needs nothing", () => {
    const x = extract([crd("ClusterIssuer", null, "self", { selfSigned: {} })]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([]);
  });
  it("lists another issuer type, an issuer with none and one with two, as unsupported", () => {
    const x = extract([
      crd("Issuer", "web", "venafi", { venafi: { zone: "z" } }),
      crd("Issuer", "web", "empty", {}),
      crd("Issuer", "web", "two", { ca: { secretName: "a" }, selfSigned: {} }),
    ]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([
      "unsupported-provider Issuer/web/empty @spec",
      "unsupported-provider Issuer/web/two @spec",
      "unsupported-provider Issuer/web/venafi @spec",
    ]);
  });
  it("ignores an object of another API group", () => {
    const x = extract([crd("Issuer", "web", "ca", { ca: { secretName: "root" } }, "example.org/v1")]);
    expect(x.edges).toEqual([]);
    expect(x.r.ignoredKinds).toBe(1);
  });
});

describe("hostile names and values", () => {
  it("never makes an edge to a forged id, and never throws", () => {
    const base = crd("Certificate", "web", "tls", { secretName: "s", issuerRef: { name: "i", kind: "ClusterIssuer" } });
    for (const h of HOSTILE_STRINGS) {
      for (const at of [
        ["spec", "secretName"],
        ["spec", "issuerRef", "name"],
        ["spec", "issuerRef", "kind"],
      ]) {
        const x = extract([obj(setPath(base.body as DataValue, at, h), { file: "h.yaml" })]);
        for (const e of x.r.edges) expect(`${e.from} ${e.to}`).not.toContain(h);
        expect(x.r.unresolved.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("pass 2: a bare host states no namespace for an Issuer either (M2)", () => {
  it("an Issuer in vault with server https://vault:8200 makes no edge, and lists the one candidate", () => {
    const issuer = crd("Issuer", "vault", "pki", { vault: { server: "https://vault:8200" } });
    const x = extract([svc, issuer]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.candidates, u.value])).toEqual([
      ["host-unplaced", ["Service/vault/vault"], "vault"],
    ]);
  });
  it("an in-cluster-looking ACME server that matches nothing is an item, not an external (m1)", () => {
    const x = extract([crd("Issuer", "web", "a", { acme: { server: "https://step-ca.pki/acme" } })]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual(["host-unplaced Issuer/web/a @spec.acme.server"]);
  });
});

describe("pass 3: an issuer server that is text but no host is listed (m2)", () => {
  it("a zone-id IPv6 server is an item", () => {
    const x = extract([crd("ClusterIssuer", null, "v", { vault: { server: "https://[fe80::1%25eth0]:8200" } })]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.value])).toEqual([["host-unplaced", "https://[fe80::1%25eth0]:8200"]]);
  });
});
