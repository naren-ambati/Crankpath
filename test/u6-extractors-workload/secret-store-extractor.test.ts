// SecretStoreExtractor (BR6.1 to BR6.3, OD-14): positive and negative cases per edge, each
// ambiguity or unknown with no edge and an item.

import { describe, expect, it } from "vitest";
import type { DataValue, RenderedObject } from "../../src/u1-graph-model/extractor.js";
import { secretStoreExtractor } from "../../src/u6-extractors-workload/secret-store-extractor.js";
import { HOSTILE_STRINGS, setPath } from "../helpers/fixture-kit.js";
import { context, obj } from "../helpers/objects.js";

const ESO = "external-secrets.io/v1";
function crd(kind: string, ns: string | null, name: string, spec: DataValue, apiVersion = ESO): RenderedObject {
  const metadata: Record<string, DataValue> = { name };
  if (ns !== null) metadata.namespace = ns;
  return obj({ apiVersion, kind, metadata, spec }, { file: `${kind}-${name}.yaml` });
}
function extract(objects: RenderedObject[]) {
  const r = secretStoreExtractor.extract(objects, context(objects));
  return {
    r,
    edges: r.edges.map((e) => `${e.from} ${e.kind} ${e.to} @${e.evidence.field}`).sort(),
    items: r.unresolved.map((u) => `${u.why} ${u.subject} @${u.field ?? ""}`).sort(),
  };
}
const es = (spec: DataValue, name = "db", ns = "apps") => crd("ExternalSecret", ns, name, spec);
const vaultStore = (server: string, extra: Record<string, DataValue> = {}) =>
  crd("ClusterSecretStore", null, "vault", { provider: { vault: { server, path: "secret", ...extra } } });
const svc = obj(
  {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "vault", namespace: "vault" },
    spec: { selector: { a: "b" } },
  },
  { file: "svc.yaml" },
);

describe("ExternalSecret (BR6.1)", () => {
  it("makes its target Secret depend on it and it depend on its store; the Secret node is made here", () => {
    const x = extract([es({ secretStoreRef: { name: "s" }, target: { name: "db-creds" } })]);
    expect(x.edges).toEqual([
      "ExternalSecret/apps/db uses-store SecretStore/apps/s @spec.secretStoreRef.name",
      "Secret/apps/db-creds produced-by ExternalSecret/apps/db @spec.target.name",
    ]);
    expect(x.r.nodes.map((n) => [n.id, n.origin.path])).toEqual([["Secret/apps/db-creds", "ExternalSecret-db.yaml"]]);
  });
  it("defaults the target name to its own name, and the store kind to SecretStore", () => {
    const x = extract([es({ secretStoreRef: { name: "s" } })]);
    expect(x.edges).toContain("Secret/apps/db produced-by ExternalSecret/apps/db @spec.target.name");
    expect(x.edges).toContain("ExternalSecret/apps/db uses-store SecretStore/apps/s @spec.secretStoreRef.name");
  });
  it("names a ClusterSecretStore by its cluster-scoped id, and reads per-entry store references", () => {
    const x = extract([
      es({
        secretStoreRef: { kind: "ClusterSecretStore", name: "global" },
        data: [{ secretKey: "a", remoteRef: { key: "k" }, sourceRef: { storeRef: { name: "other" } } }],
        dataFrom: [{ extract: { key: "k" }, sourceRef: { storeRef: { kind: "ClusterSecretStore", name: "g2" } } }],
      }),
    ]);
    expect(x.edges.filter((e) => e.includes("uses-store"))).toEqual([
      "ExternalSecret/apps/db uses-store ClusterSecretStore/g2 @spec.dataFrom[0].sourceRef.storeRef.name",
      "ExternalSecret/apps/db uses-store ClusterSecretStore/global @spec.secretStoreRef.name",
      "ExternalSecret/apps/db uses-store SecretStore/apps/other @spec.data[0].sourceRef.storeRef.name",
    ]);
  });
  it("with creationPolicy Merge, depends on a Secret it does not create (no node: it must exist)", () => {
    const x = extract([es({ secretStoreRef: { name: "s" }, target: { name: "t", creationPolicy: "Merge" } })]);
    expect(x.edges).toContain("Secret/apps/t produced-by ExternalSecret/apps/db @spec.target.name");
    expect(x.r.nodes).toEqual([]);
  });
  it("with creationPolicy None, produces nothing", () => {
    const x = extract([es({ secretStoreRef: { name: "s" }, target: { creationPolicy: "None" } })]);
    expect(x.edges).toEqual(["ExternalSecret/apps/db uses-store SecretStore/apps/s @spec.secretStoreRef.name"]);
    expect(x.r.nodes).toEqual([]);
  });
  it("lists a store kind it does not know and a target name that is not a Kubernetes name, with no edge", () => {
    const x = extract([es({ secretStoreRef: { kind: "Vault", name: "s" }, target: { name: "../Secret/x" } })]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([
      "invalid-reference ../Secret/x @spec.target.name",
      "invalid-reference ExternalSecret/apps/db @spec.secretStoreRef.kind",
    ]);
  });
  it("ignores an object of another API group with the same kind", () => {
    const other = crd("ExternalSecret", "apps", "db", { secretStoreRef: { name: "s" } }, "example.org/v1");
    const x = extract([other]);
    expect(x.edges).toEqual([]);
    expect(x.r.ignoredKinds).toBe(1);
  });
});

describe("stores (BR6.2, BR6.3)", () => {
  it("depends on the Service its provider server URL names", () => {
    const x = extract([svc, vaultStore("https://vault.vault.svc:8200")]);
    expect(x.edges).toEqual(["ClusterSecretStore/vault depends-on Service/vault/vault @spec.provider.vault.server"]);
  });
  it("depends on an external precondition when the server can only be outside the cluster", () => {
    const x = extract([vaultStore("https://vault.example.org")]);
    expect(x.edges).toEqual([
      "ClusterSecretStore/vault depends-on external:vault.example.org @spec.provider.vault.server",
    ]);
    expect(x.r.externals.map((e) => [e.id, e.coldStart])).toEqual([["external:vault.example.org", "unspecified"]]);
  });
  it("makes no edge for an in-cluster address with no Service, and none for a server matching two Services", () => {
    expect(extract([vaultStore("https://vault.vault.svc:8200")]).edges).toEqual([]);
    const other = obj(
      { apiVersion: "v1", kind: "Service", metadata: { name: "vault", namespace: "x" } },
      { file: "o.yaml" },
    );
    const x = extract([svc, other, vaultStore("https://vault:8200")]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.candidates])).toEqual([
      ["host-ambiguous", ["Service/vault/vault", "Service/x/vault"]],
    ]);
  });
  it("depends on each auth Secret and ServiceAccount, in the store's namespace for a SecretStore", () => {
    const store = crd("SecretStore", "apps", "s", {
      provider: {
        vault: {
          server: "https://vault.vault.svc:8200",
          auth: {
            appRole: { path: "approle", roleId: "r", secretRef: { name: "approle", key: "id" } },
            kubernetes: { mountPath: "k", role: "r", serviceAccountRef: { name: "reader" } },
            tokenSecretRef: { name: "token", key: "t", namespace: "ignored" },
          },
          caProvider: { type: "ConfigMap", name: "ca" },
        },
      },
    });
    expect(extract([store]).edges).toEqual([
      "SecretStore/apps/s needs-config ConfigMap/apps/ca @spec.provider.vault.caProvider.name",
      "SecretStore/apps/s needs-secret Secret/apps/approle @spec.provider.vault.auth.appRole.secretRef.name",
      "SecretStore/apps/s needs-secret Secret/apps/token @spec.provider.vault.auth.tokenSecretRef.name",
      "SecretStore/apps/s runs-as ServiceAccount/apps/reader @spec.provider.vault.auth.kubernetes.serviceAccountRef.name",
    ]);
  });
  it("reads a cloud provider's auth references, which name no server", () => {
    const store = crd("SecretStore", "apps", "aws", {
      provider: {
        aws: {
          service: "SecretsManager",
          region: "us-east-1",
          auth: { secretRef: { accessKeyIDSecretRef: { name: "aws", key: "id" } } },
        },
      },
    });
    expect(extract([store]).edges).toEqual([
      "SecretStore/apps/aws needs-secret Secret/apps/aws @spec.provider.aws.auth.secretRef.accessKeyIDSecretRef.name",
    ]);
  });
  it("needs a ClusterSecretStore's references to name a namespace, and lists one that does not", () => {
    const store = vaultStore("https://vault.example.org", {
      auth: { tokenSecretRef: { name: "token" }, kubernetes: { serviceAccountRef: { name: "r", namespace: "eso" } } },
    });
    const x = extract([store]);
    expect(x.edges).toContain(
      "ClusterSecretStore/vault runs-as ServiceAccount/eso/r @spec.provider.vault.auth.kubernetes.serviceAccountRef.name",
    );
    expect(x.items).toEqual([
      "namespace-unknown ClusterSecretStore/vault @spec.provider.vault.auth.tokenSecretRef.name",
    ]);
  });
  it("keeps the node of a provider outside the closed list, extracts nothing from it, and lists it", () => {
    const store = crd("SecretStore", "apps", "x", {
      provider: { madeup: { server: "https://vault.vault.svc", auth: { tokenSecretRef: { name: "t" } } } },
    });
    const x = extract([svc, store]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual(["unsupported-provider SecretStore/apps/x @spec.provider"]);
  });
  it("lists a store with no provider or two providers as unsupported", () => {
    const none = crd("SecretStore", "apps", "a", {});
    const two = crd("SecretStore", "apps", "b", { provider: { vault: {}, aws: {} } });
    expect(extract([none, two]).items).toEqual([
      "unsupported-provider SecretStore/apps/a @spec.provider",
      "unsupported-provider SecretStore/apps/b @spec.provider",
    ]);
  });
  it("reads no host from free text: a URL in an annotation or a remote key is no edge (BR6.16)", () => {
    const store = obj(
      {
        apiVersion: ESO,
        kind: "SecretStore",
        metadata: { name: "s", namespace: "apps", annotations: { docs: "https://vault.vault.svc:8200" } },
        spec: { provider: { aws: { service: "SecretsManager", region: "https://vault.vault.svc" } } },
      },
      { file: "s.yaml" },
    );
    const e = es({ secretStoreRef: { name: "s" }, data: [{ remoteRef: { key: "https://vault.vault.svc:8200" } }] });
    expect(extract([svc, store, e]).edges.filter((l) => l.includes("Service"))).toEqual([]);
  });
});

describe("hostile names and values", () => {
  it("never makes an edge to a forged id, and never throws", () => {
    const base = es({ secretStoreRef: { name: "s" }, target: { name: "t" } });
    for (const h of HOSTILE_STRINGS) {
      for (const at of [
        ["spec", "secretStoreRef", "name"],
        ["spec", "target", "name"],
        ["spec", "secretStoreRef", "kind"],
      ]) {
        const doc = setPath(base.body as DataValue, at, h);
        const x = extract([obj(doc, { file: "h.yaml" })]);
        for (const e of x.r.edges) expect([e.from, e.to].join(" ")).not.toContain(h);
        expect(x.r.unresolved.length).toBeGreaterThan(0);
      }
    }
  });
  it("reads a server URL that is not a URL as no edge", () => {
    for (const h of HOSTILE_STRINGS) expect(extract([svc, vaultStore(h)]).edges).toEqual([]);
  });
});

describe("pass 2: a bare host states no namespace: the controller dials it, not the store (M2, n1, m3)", () => {
  it("a SecretStore in vault with server http://vault:8200 makes no edge to Service vault/vault, and lists it", () => {
    const store = crd("SecretStore", "vault", "s", { provider: { vault: { server: "http://vault:8200" } } });
    const x = extract([svc, store]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.subject, u.candidates])).toEqual([
      ["host-unplaced", "SecretStore/vault/s", ["Service/vault/vault"]],
    ]);
  });
  it("a ClusterSecretStore with a bare host and one same-named Service is unplaced, not an ambiguity of one", () => {
    const x = extract([svc, vaultStore("http://vault:8200")]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual(["host-unplaced ClusterSecretStore/vault @spec.provider.vault.server"]);
  });
  it("an IPv6 literal server is listed, not dropped", () => {
    const x = extract([vaultStore("http://[fd00::1]:8200")]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.value])).toEqual([["host-unplaced", "[fd00::1]"]]);
  });
});

describe("pass 3: a server URL that is text but no host is listed (m2)", () => {
  it.each(["http://[fe80::1%25eth0]:8200", "http://", "vault server"])(
    "%j is an item with the text quoted",
    (server) => {
      const x = extract([vaultStore(server)]);
      expect(x.edges).toEqual([]);
      expect(x.r.unresolved.map((u) => [u.why, u.value])).toEqual([["host-unplaced", server]]);
    },
  );
});
