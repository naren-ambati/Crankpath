// FixtureKit v1 (FR11.4): the loader goes through the real reader (a symlink or bad YAML in a
// fixture is reported, never read), overlays and edits work on a copy, and hostile variants put
// each hostile string at the field asked for.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { DataValue } from "../../src/u1-graph-model/extractor.js";
import {
  HOSTILE_STRINGS,
  hostileVariants,
  loadFixture,
  setPath,
  withEdits,
  withOverlays,
} from "../helpers/fixture-kit.js";
import { tempDir } from "../helpers/scan.js";

const VAULT = fileURLToPath(new URL("../fixtures/vault/", import.meta.url));
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

const MANIFEST = [
  "sources: [repo]",
  "jobs:",
  "  - {owner: Application/argocd/a, ownerFile: a.yaml, ownerField: spec.source.path, namespace: a, read: out}",
  "",
].join("\n");

function small(files: Record<string, string>): string {
  const d = tempDir("kit");
  cleanup.push(d);
  for (const [rel, text] of Object.entries({ "rendered/jobs.yaml": MANIFEST, "repo/README.md": "x\n", ...files })) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    fs.writeFileSync(path.join(d, rel), text);
  }
  return d;
}

describe("loading a fixture", () => {
  it("reads sources as discovery does (source kinds only) and job output with the job's namespace", () => {
    const d = small({
      "repo/a.yaml":
        "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata: {name: a, namespace: argocd}\n---\napiVersion: v1\nkind: ConfigMap\nmetadata: {name: ignored}\n",
      "out/cm.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\n",
    });
    const f = loadFixture(d);
    expect(f.objects.map((o) => [o.id, o.origin.renderJob])).toEqual([
      ["Application/argocd/a", null],
      ["ConfigMap/a/c", "Application/argocd/a#0"],
    ]);
    expect(f.jobs.map((j) => [j.owner, j.ownerFile, j.destination])).toEqual([
      ["Application/argocd/a", "a.yaml", "in-cluster"],
    ]);
  });
  it("reports a file the reader refuses and a symlink, and reads neither", () => {
    const d = small({
      "out/bad.yaml": "kind: [\n",
      "out/ok.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\n",
    });
    fs.symlinkSync(path.join(d, "out", "ok.yaml"), path.join(d, "out", "link.yaml"));
    const f = loadFixture(d);
    expect(f.objects.map((o) => o.id)).toEqual(["ConfigMap/a/c"]);
    expect(f.refused.map((r) => r.split(":")[0]).sort()).toEqual(["out/bad.yaml", "out/link.yaml"]);
  });
  it("names a skipped object", () => {
    const f = loadFixture(small({ "out/x.yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: a/b}\n" }));
    expect(f.skipped.map((s) => [s.name, s.reason])).toEqual([["a/b", "invalid-name"]]);
  });
  it("refuses a manifest job without its fields", () => {
    const d = small({});
    fs.writeFileSync(path.join(d, "rendered/jobs.yaml"), "jobs:\n  - {owner: Application/argocd/a}\n");
    expect(() => loadFixture(d)).toThrow(/ownerFile/);
  });
});

describe("variants on a copy", () => {
  it("an overlay replaces and adds files in a copy and leaves the fixture alone", () => {
    const before = fs.readFileSync(path.join(VAULT, "platform/manifests/vault/certificate.yaml"), "utf8");
    const copy = withOverlays(VAULT, [path.join(VAULT, "variants/ca-issuer")]);
    cleanup.push(copy);
    expect(fs.readFileSync(path.join(copy, "platform/manifests/vault/certificate.yaml"), "utf8")).toContain(
      "bootstrap-ca",
    );
    expect(fs.existsSync(path.join(copy, "platform/manifests/cert-manager/bootstrap-ca.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(copy, "variants"))).toBe(false);
    expect(fs.readFileSync(path.join(VAULT, "platform/manifests/vault/certificate.yaml"), "utf8")).toBe(before);
  });
  it("an edit replaces or deletes one file of a copy", () => {
    const copy = withEdits(VAULT, { "rendered/vault/service.yaml": null, "rendered/vault/new.yaml": "x: 1\n" });
    cleanup.push(copy);
    expect(fs.existsSync(path.join(copy, "rendered/vault/service.yaml"))).toBe(false);
    expect(fs.readFileSync(path.join(copy, "rendered/vault/new.yaml"), "utf8")).toBe("x: 1\n");
  });
});

describe("hostile variants", () => {
  it("puts each hostile string at the path, on a deep copy, creating maps on the way", () => {
    const doc: DataValue = { spec: { list: [{ name: "a" }] } };
    const variants = hostileVariants(doc, ["spec", "list", 0, "name"]);
    expect(variants.map((v) => (v as { spec: { list: { name: string }[] } }).spec.list[0]?.name)).toEqual([
      ...HOSTILE_STRINGS,
    ]);
    expect(doc).toEqual({ spec: { list: [{ name: "a" }] } });
    expect(setPath({}, ["a", "b"], 1)).toEqual({ a: { b: 1 } });
    expect(() => setPath({ a: 1 }, [0], 1)).toThrow(/not a list/);
  });
  it("covers terminal escapes, line starts, claim words, separators, NUL, bidi and length", () => {
    const all = HOSTILE_STRINGS.join("");
    for (const needle of ["\u001b[", "\nRun status", "PASS", "../", "/", ":", "\u0000", "‮"]) {
      expect(all).toContain(needle);
    }
    expect(Math.max(...HOSTILE_STRINGS.map((s) => s.length))).toBeGreaterThan(1000);
  });
});
