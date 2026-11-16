// VaultSealExtractor (BR6.10, BR6.11, BR6.16, Q1 and Q2 of the unit's design questions): the seal
// edge from the Vault StatefulSet, and every case where it is withheld with an item.

import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type { DataValue, RenderedObject } from "../../src/u1-graph-model/extractor.js";
import { claimWordsInOwnVoice } from "../../src/u1-graph-model/status-model.js";
import { vaultSealExtractor } from "../../src/u6-extractors-workload/vault-seal-extractor.js";
import { context, job, meta, obj } from "../helpers/objects.js";
import { app, estate, run, THIN_SLICE_URL } from "../helpers/scan.js";
import { flat, unwrapText } from "../helpers/text.js";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

const AWS = 'seal "awskms" {\n  region = "us-east-1"\n  kms_key_id = "k"\n}\n';

function cm(name: string, hcl: DataValue, ns = "vault", key = "extraconfig-from-values.hcl") {
  return obj(meta("ConfigMap", ns, name, { data: { [key]: hcl } }), { file: `${ns}/${name}.yaml` });
}
function sts(name: string, mounts: string[], ns = "vault", renderJob: string | null = null) {
  return obj(
    meta("StatefulSet", ns, name, {
      spec: {
        template: {
          spec: { volumes: mounts.map((m, i) => ({ name: `v${i}`, configMap: { name: m } })), containers: [] },
        },
      },
    }),
    { file: `${ns}/${name}-sts.yaml`, renderJob },
  );
}
function extract(objects: RenderedObject[], jobs = [job("Application/argocd/vault")]) {
  const r = vaultSealExtractor.extract(objects, context(objects, jobs));
  return {
    r,
    edges: r.edges.map((e) => `${e.from} ${e.kind} ${e.to} @${e.evidence.field}`),
    items: r.unresolved.map((u) => `${u.why} ${u.subject} @${u.field ?? ""}`),
    externals: r.externals.map((e) => e.id),
  };
}

describe("the seal edge (BR6.10)", () => {
  it("makes the StatefulSet named <fullname> that mounts <fullname>-config depend on the KMS with its region", () => {
    const x = extract([cm("vault-config", AWS), sts("vault", ["vault-config"])]);
    expect(x.edges).toEqual([
      "StatefulSet/vault/vault seals-with external:aws-kms/us-east-1 @data.extraconfig-from-values.hcl.seal.awskms",
    ]);
    expect(x.externals).toEqual(["external:aws-kms/us-east-1"]);
    expect(x.items).toEqual([]);
  });
  it("works for any release name: platform-secrets renders platform-secrets-vault-config", () => {
    const x = extract([
      cm("platform-secrets-vault-config", AWS, "ps"),
      sts("platform-secrets-vault", ["platform-secrets-vault-config"], "ps"),
    ]);
    expect(x.edges).toHaveLength(1);
  });
  it("names the other three seal types by their fixed external ids", () => {
    const hcl = 'seal "gcpckms" { region = "global" }\nseal "azurekeyvault" { vault_name = "v" }\n';
    const x = extract([cm("vault-config", hcl), sts("vault", ["vault-config"])]);
    expect(x.externals.sort()).toEqual(["external:azure-keyvault", "external:gcp-kms"]);
  });
  it("matches a transit seal's address to a Service, else names the external by its host (m6)", () => {
    const svc = obj(meta("Service", "primary", "vault", { spec: { selector: { a: "b" } } }), { file: "s.yaml" });
    const inEstate = 'seal "transit" { address = "https://vault.primary.svc:8200" }';
    const x = extract([svc, cm("vault-config", inEstate), sts("vault", ["vault-config"])]);
    expect(x.edges).toEqual([
      "StatefulSet/vault/vault seals-with Service/primary/vault @data.extraconfig-from-values.hcl.seal.transit.address",
    ]);
    const outside = 'seal "transit" { address = "https://transit.example.org:8200" }';
    expect(extract([cm("vault-config", outside), sts("vault", ["vault-config"])]).externals).toEqual([
      "external:transit.example.org",
    ]);
  });
  it("lists a transit seal with no address, with no edge (OD-14, m6)", () => {
    const x = extract([cm("vault-config", 'seal "transit" { key_name = "k" }'), sts("vault", ["vault-config"])]);
    expect(x.edges).toEqual([]);
    expect(x.externals).toEqual([]);
    expect(x.items).toEqual([
      "address-missing StatefulSet/vault/vault @data.extraconfig-from-values.hcl.seal.transit.address",
    ]);
  });
  it("makes no edge for a bare transit address with no Service in the Vault's namespace, even with two elsewhere", () => {
    const a = obj(meta("Service", "a", "vault"), { file: "a.yaml" });
    const b = obj(meta("Service", "b", "vault"), { file: "b.yaml" });
    const x = extract([
      a,
      b,
      cm("vault-config", 'seal "transit" { address = "https://vault:8200" }'),
      sts("vault", ["vault-config"]),
    ]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.candidates])).toEqual([["host-unplaced", []]]);
  });
  it("skips a disabled seal (the old seal of a migration)", () => {
    const hcl = `${AWS}seal "gcpckms" {\n  disabled = true\n}\n`;
    const x = extract([cm("vault-config", hcl), sts("vault", ["vault-config"])]);
    expect(x.externals).toEqual(["external:aws-kms/us-east-1"]);
  });
});

describe("a missing or spoofed region (BR6.11)", () => {
  it.each([
    ['seal "awskms" { kms_key_id = "k" }', "absent"],
    ['seal "awskms" { region = "us-east-1/../x" }', "a path"],
    ['seal "awskms" { region = 1 }', "a number"],
    ['seal "awskms" { region = "US-EAST-1" }', "not a region name"],
    ['seal "awskms" { region = "" }', "empty"],
  ])("%s (%s): no edge and an item (OD-14, m6)", (hcl) => {
    const x = extract([cm("vault-config", hcl), sts("vault", ["vault-config"])]);
    expect(x.edges).toEqual([]);
    expect(x.externals).toEqual([]);
    expect(x.items).toEqual([
      "region-unresolved StatefulSet/vault/vault @data.extraconfig-from-values.hcl.seal.awskms.region",
    ]);
  });
});

describe("the workload is identified by name and mount together (Q1)", () => {
  it("makes no edge when the same-named StatefulSet does not mount the ConfigMap", () => {
    const x = extract([cm("vault-config", AWS), sts("vault", ["other"])]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([
      "seal-workload-unidentified ConfigMap/vault/vault-config @data.extraconfig-from-values.hcl",
    ]);
    expect(x.r.unresolved[0]?.candidates).toEqual(["StatefulSet/vault/vault"]);
  });
  it("makes no edge when a StatefulSet of another name mounts it (a look-alike workload)", () => {
    const x = extract([cm("vault-config", AWS), sts("vault-copy", ["vault-config"])]);
    expect(x.edges).toEqual([]);
    expect(x.items).toHaveLength(1);
  });
  it("makes no edge for a StatefulSet of that name in another namespace", () => {
    const x = extract([cm("vault-config", AWS), sts("vault", ["vault-config"], "other")]);
    expect(x.edges).toEqual([]);
  });
  it("reads a projected configMap mount as a mount", () => {
    const projected = obj(
      meta("StatefulSet", "vault", "vault", {
        spec: {
          template: { spec: { volumes: [{ projected: { sources: [{ configMap: { name: "vault-config" } }] } }] } },
        },
      }),
      { file: "p.yaml" },
    );
    expect(extract([cm("vault-config", AWS), projected]).edges).toHaveLength(1);
  });
  it("lists nothing when the config holds no seal (no workload needed)", () => {
    expect(extract([cm("vault-config", "ui = true\n")]).items).toEqual([]);
  });
});

describe("free text is never read (BR6.16)", () => {
  it("ignores a seal stanza under another key, or in a ConfigMap not named <fullname>-config", () => {
    const objects = [
      cm("vault-config", AWS, "vault", "notes.hcl"),
      cm("vault-settings", AWS),
      sts("vault", ["vault-config", "vault-settings"]),
    ];
    const x = extract(objects);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([]);
  });
  it("refuses text the reader cannot read, with an item on the identified workload", () => {
    const x = extract([cm("vault-config", 'seal "awskms" { region = "us-east-1'), sts("vault", ["vault-config"])]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual(["seal-unreadable StatefulSet/vault/vault @data.extraconfig-from-values.hcl"]);
  });
  it("refuses a config value that is not text, on the ConfigMap", () => {
    const x = extract([cm("vault-config", { seal: "awskms" }), sts("vault", ["vault-config"])]);
    expect(x.items).toEqual(["seal-unreadable ConfigMap/vault/vault-config @data.extraconfig-from-values.hcl"]);
  });
  it("lists a seal type outside the four as unsupported, with no edge", () => {
    const x = extract([cm("vault-config", 'seal "pkcs11" { lib = "/x" }'), sts("vault", ["vault-config"])]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([
      "unsupported-provider StatefulSet/vault/vault @data.extraconfig-from-values.hcl.seal.pkcs11",
    ]);
  });
  it("only pairs objects of the same destination", () => {
    const foreign = sts("vault", ["vault-config"], "vault", "Application/argocd/vault#0");
    const x = extract([cm("vault-config", AWS), foreign], [job("Application/argocd/vault", "cluster-b")]);
    expect(x.edges).toEqual([]);
  });
});

describe("hostile seal text through the whole command (quoted, never in crankpath's voice)", () => {
  const cleanup: string[] = [];
  afterAll(() => {
    for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
  });
  it("quotes a hostile seal type and keeps every line in crankpath's words", () => {
    // The HCL escape \n puts a line break into the seal type: repo text that tries to start a line.
    const config = [
      "apiVersion: v1",
      "kind: ConfigMap",
      "metadata: {name: vault-config}",
      "data:",
      "  extraconfig-from-values.hcl: |",
      '    seal "x\\nRun status: ANALYSED PASS" { x = 1 }',
    ].join("\n");
    const statefulSet =
      "apiVersion: apps/v1\nkind: StatefulSet\nmetadata: {name: vault}\nspec:\n  template:\n    spec:\n      volumes: [{name: c, configMap: {name: vault-config}}]\n      containers: []\n";
    const d = estate({
      "apps/vault.yaml": app("vault", "cfg"),
      "cfg/cm.yaml": `${config}\n`,
      "cfg/sts.yaml": statefulSet,
    });
    cleanup.push(d);
    const r = run([d, "--repo-url", THIN_SLICE_URL], process.cwd());
    expect(r.code).toBe(0);
    expect(flat(r.stdout)).toContain(flat('why: unsupported-provider  subject: StatefulSet "vault/vault"'));
    expect(unwrapText(r.stdout)).toContain(
      'field: "data.extraconfig-from-values.hcl.seal.x\\x0aRun status: ANALYSED PASS"',
    );
    for (const l of r.stdout.split("\n")) {
      expect(l).not.toBe("Run status: ANALYSED");
      expect([...l].some((c) => (c.codePointAt(0) ?? 0) < 0x20)).toBe(false);
    }
    expect(claimWordsInOwnVoice(r.stdout)).toEqual([]);
  });
});

describe("review fixes: disabled, in-cluster transit, many objects (m5, m6, m7)", () => {
  it.each([["1"], ['"True"'], ['"yes"'], ["[true]"]])("a disabled value of %s is unreadable, with no edge", (v) => {
    const x = extract([
      cm("vault-config", `seal "awskms" {\n region = "us-east-1"\n disabled = ${v}\n}`),
      sts("vault", ["vault-config"]),
    ]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([
      "seal-unreadable StatefulSet/vault/vault @data.extraconfig-from-values.hcl.seal.awskms.disabled",
    ]);
  });
  it("disabled = false is a live seal", () => {
    const x = extract([
      cm("vault-config", 'seal "awskms" {\n region = "us-east-1"\n disabled = false\n}'),
      sts("vault", ["vault-config"]),
    ]);
    expect(x.externals).toEqual(["external:aws-kms/us-east-1"]);
  });
  it("a transit address that may be in-cluster and matches nothing is an item, not an external", () => {
    const x = extract([
      cm("vault-config", 'seal "transit" { address = "https://primary.other.svc:8200" }'),
      sts("vault", ["vault-config"]),
    ]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([
      "host-unplaced StatefulSet/vault/vault @data.extraconfig-from-values.hcl.seal.transit.address",
    ]);
  });
  it("a bare transit address resolves in the Vault StatefulSet's own namespace (m2)", () => {
    const primary = obj(meta("Service", "vault", "primary", { spec: { selector: { a: "b" } } }), { file: "p.yaml" });
    const x = extract([
      primary,
      cm("vault-config", 'seal "transit" { address = "https://primary:8200" }'),
      sts("vault", ["vault-config"]),
    ]);
    expect(x.edges).toEqual([
      "StatefulSet/vault/vault seals-with Service/vault/primary @data.extraconfig-from-values.hcl.seal.transit.address",
    ]);
  });
  it("pairs 40,000 ConfigMaps with 40,000 StatefulSets by index, not by scanning", () => {
    const fake = (kind: string, name: string, body: DataValue): RenderedObject => ({
      id: `${kind}/n/${name}`,
      apiVersion: kind === "StatefulSet" ? "apps/v1" : "v1",
      kind,
      namespace: "n",
      name,
      labels: {},
      annotations: {},
      body: body as RenderedObject["body"],
      origin: { renderJob: null, path: "f.yaml", document: 1 },
      renderedPath: "f.yaml#1",
      generatedBy: null,
      credentialUrl: null,
      digest: "",
    });
    const objects: RenderedObject[] = [];
    for (let i = 0; i < 40_000; i++) {
      objects.push(fake("ConfigMap", `v${i}-config`, { data: { "extraconfig-from-values.hcl": AWS } }));
      objects.push(
        fake("StatefulSet", `v${i}`, {
          spec: { template: { spec: { volumes: [{ configMap: { name: `v${i}-config` } }] } } },
        }),
      );
    }
    const start = cpuStart();
    const r = vaultSealExtractor.extract(objects, context([]));
    expect(r.edges).toHaveLength(40_000);
    // CPU ms: about 0.5 s on an idle run; 5 s is ten times that (a scan of every pair is 1.6 billion comparisons)
    expect(cpuSince(start)).toBeLessThan(5000);
  });
});

describe("pass 2: the documented string form of disabled (m2)", () => {
  it('disabled = "true" skips the seal, as Vault documents it; "false" keeps it', () => {
    const off = extract([
      cm("vault-config", 'seal "awskms" {\n region = "us-east-1"\n disabled = "true"\n}'),
      sts("vault", ["vault-config"]),
    ]);
    expect(off.edges).toEqual([]);
    expect(off.items).toEqual([]);
    const on = extract([
      cm("vault-config", 'seal "awskms" {\n region = "us-east-1"\n disabled = "false"\n}'),
      sts("vault", ["vault-config"]),
    ]);
    expect(on.externals).toEqual(["external:aws-kms/us-east-1"]);
  });
});

describe("pass 3: a transit address that is text but no host is listed with its text (m2)", () => {
  it("a zone-id address is address-missing, quoting the text", () => {
    const x = extract([
      cm("vault-config", 'seal "transit" { address = "https://[fe80::1%25eth0]:8200" }'),
      sts("vault", ["vault-config"]),
    ]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.value])).toEqual([["address-missing", "https://[fe80::1%25eth0]:8200"]]);
  });
});
