// The schema freeze (B6; C7, BR8.1 to BR8.3, NFR19): the committed JSON Schema validates every
// committed expected JSON and the JSON of real runs; its word lists are the code's lists; a
// removed or retyped field fails the schema-diff test unless `schemaVersion` changes; the version is
// pinned by a golden; docs/json-output.md is the schema's own field table. Each check is shown able
// to fail on a broken input.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EDGE_KINDS, NODE_FLAGS, OPAQUE_REASONS } from "../../src/u1-graph-model/graph-model.js";
import { GAP_REASONS, SOURCE_KINDS, UNRESOLVED_WHY } from "../../src/u1-graph-model/status-model.js";
import { BLOCKED_REASONS, UNVERIFIED_REASONS } from "../../src/u7-graph-analysis/reachability.js";
import { PLAN_DISCLAIMER } from "../../src/u7-graph-analysis/plan-builder.js";
import { renderJson } from "../../src/u8-output/json-renderer.js";
import { NOT_VERIFIED_ITEMS, SCHEMA_VERSION } from "../../src/u8-output/report-model.js";
import { fieldRows, fieldTable, withTable } from "../../scripts/json-output-doc.mjs";
import { breakingChanges, type Schema, schemaFields, validate } from "../helpers/json-schema.js";
import { copyThinSlice, FIXTURE, run, THIN_SLICE_URL } from "../helpers/scan.js";
import { vaultReport } from "../helpers/reports.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCHEMA = JSON.parse(
  fs.readFileSync(path.join(ROOT, "schemas", "crankpath-report.schema.json"), "utf8"),
) as Schema;
const GOLDEN = JSON.parse(
  fs.readFileSync(path.join(ROOT, "test", "fixtures", "schema", "report-fields.golden.json"), "utf8"),
) as {
  schemaVersion: number;
  fields: Record<string, string>;
};

function expectedJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...expectedJsonFiles(full));
    else if (/^expected.*\.json$/.test(e.name)) out.push(full);
  }
  return out.sort();
}

type Obj = { [key: string]: unknown };
const prop = (s: unknown, ...keys: string[]): Obj => {
  let cur = s as Obj;
  for (const k of keys) cur = ((cur.properties as Obj)?.[k] ?? (cur.items as Obj)?.properties?.[k as never]) as Obj;
  return cur;
};
const defs = SCHEMA.$defs as Record<string, Obj>;

describe("the committed schema validates every committed expected JSON (BR8.1)", () => {
  const files = expectedJsonFiles(path.join(ROOT, "test", "fixtures"));
  it("finds the committed expected JSON files", () => {
    expect(files.map((f) => path.relative(ROOT, f))).toContain(
      path.join("test", "fixtures", "thin-slice", "expected.json"),
    );
  });
  for (const f of files) {
    it(`validates ${path.relative(ROOT, f)}`, () => {
      expect(validate(SCHEMA, JSON.parse(fs.readFileSync(f, "utf8")))).toEqual([]);
    });
  }
});

describe("the schema validates real runs and refuses broken reports", () => {
  it("validates the JSON of thin-slice variants with cranks, matches, mappings and externals", () => {
    const repo = copyThinSlice();
    fs.writeFileSync(
      path.join(repo, "crankpath.yaml"),
      [
        "external:",
        "  git.example.org: {cold_start: available}",
        "match:",
        '  - {host: "gitea-http.gitea", node: "external:git.example.org"}',
        '  - {host: "*.unused.example.org", node: "other"}',
        "cranks:",
        '  - {by: "restore the Gitea volume from backup", creates: [Secret/gitea/gitea-admin]}',
        '  - {by: "nothing matches this", creates: [Secret/none/none]}',
        "repos:",
        '  "https://github.com/acme/y": {read_from: platform}',
        "",
      ].join("\n"),
    );
    const r = run([repo, "--repo-url", THIN_SLICE_URL, "--format", "json"], process.cwd());
    expect(r.code, r.stderr).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.cranks.length + json.unusedMatches.length + json.repoMappings.length).toBeGreaterThan(3);
    expect(validate(SCHEMA, json)).toEqual([]);
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  });
  it("validates the Vault fixture's report (two cycles, three externals)", () => {
    const json = JSON.parse(renderJson(vaultReport([])));
    expect(json.cycles).toHaveLength(2);
    expect(json.externals).toHaveLength(3);
    expect(validate(SCHEMA, json)).toEqual([]);
  });
  it("refuses a removed field, an unknown field, a wrong type and an unknown word", () => {
    const good = JSON.parse(fs.readFileSync(path.join(FIXTURE, "expected.json"), "utf8"));
    const removed = structuredClone(good);
    delete removed.edges[0].evidence.renderedPath;
    expect(validate(SCHEMA, removed)).toEqual(["$.edges[0].evidence: lacks renderedPath"]);
    const extra = structuredClone(good);
    extra.cycles[0].verdict = "OK";
    expect(validate(SCHEMA, extra)).toEqual(["$.cycles[0]: has a field the schema does not list: verdict"]);
    const typed = structuredClone(good);
    typed.runStatus.counts.opaque = "1";
    expect(validate(SCHEMA, typed)).toEqual(["$.runStatus.counts.opaque: is string, expected integer"]);
    const word = structuredClone(good);
    word.runStatus.state = "OK";
    expect(validate(SCHEMA, word)).toEqual(['$.runStatus.state: "OK" is not one of the listed words']);
    const version = structuredClone(good);
    version.schemaVersion = 2;
    expect(validate(SCHEMA, version)).toEqual(["$.schemaVersion: is not the constant 1"]);
  });
  it("refuses a schema keyword the validator does not implement, so no rule is skipped silently", () => {
    expect(() => validate({ type: "string", pattern: "^a" }, "a")).toThrow(/unsupported keyword pattern/);
  });
});

describe("the schema's word lists are the code's lists", () => {
  it("edge kinds, opacity reasons, node flags, unresolved reasons, gap reasons, closing items, status reasons", () => {
    expect(defs.edgeKind?.enum).toEqual([...EDGE_KINDS]);
    expect(defs.opaqueReason?.enum).toEqual([...OPAQUE_REASONS]);
    expect(prop(SCHEMA, "nodes").items).toBeDefined();
    const nodeItem = (prop(SCHEMA, "nodes").items as Obj).properties as Obj;
    expect(((nodeItem.flags as Obj).items as Obj).enum).toEqual([...NODE_FLAGS]);
    const unresolvedItem = (prop(SCHEMA, "unresolved").items as Obj).properties as Obj;
    expect((unresolvedItem.why as Obj).enum).toEqual([...UNRESOLVED_WHY]);
    const reasons = ((prop(SCHEMA, "runStatus").properties as Obj).reasons as Obj).items as Obj;
    expect([...(reasons.enum as string[])].sort()).toEqual([...GAP_REASONS, "no-sources"].sort());
    const nv = (prop(SCHEMA, "notVerified").items as Obj).properties as Obj;
    expect((nv.item as Obj).enum).toEqual([...NOT_VERIFIED_ITEMS]);
    expect(defs.reasonClass?.enum).toEqual([...BLOCKED_REASONS, ...UNVERIFIED_REASONS]);
    const byKind = ((prop(SCHEMA, "runStatus").properties as Obj).counts as Obj).properties as Obj;
    expect(Object.keys((byKind.sourcesByKind as Obj).properties as Obj).sort()).toEqual([...SOURCE_KINDS].sort());
    const plan = prop(SCHEMA, "plan").properties as Obj;
    expect((plan.disclaimer as Obj).const).toBe(PLAN_DISCLAIMER);
  });
  it("lists every field of every object as required (a value that does not apply is null, never missing)", () => {
    const walk = (s: Obj, at: string) => {
      if (s.properties !== undefined) {
        expect([...((s.required as string[]) ?? [])].sort(), at).toEqual(Object.keys(s.properties as Obj).sort());
        expect(s.additionalProperties, at).toBe(false);
        for (const [k, p] of Object.entries(s.properties as Obj)) walk(p as Obj, `${at}.${k}`);
      }
      if (s.items !== undefined) walk(s.items as Obj, `${at}[]`);
      for (const o of (s.anyOf as Obj[] | undefined) ?? []) walk(o, at);
    };
    walk(SCHEMA as Obj, "$");
    for (const [k, d] of Object.entries(defs)) walk(d, `$defs.${k}`);
  });
});

describe("schemaVersion is pinned by a golden; a removed or retyped field needs a new version (BR8.3, NFR19)", () => {
  const current = schemaFields(SCHEMA);
  it("pins schemaVersion: the code, the schema, the golden and the committed expected JSON agree", () => {
    expect(GOLDEN.schemaVersion).toBe(1);
    expect(SCHEMA_VERSION).toBe(GOLDEN.schemaVersion);
    expect((prop(SCHEMA, "schemaVersion") as Obj).const).toBe(GOLDEN.schemaVersion);
    expect(JSON.parse(fs.readFileSync(path.join(FIXTURE, "expected.json"), "utf8")).schemaVersion).toBe(
      GOLDEN.schemaVersion,
    );
  });
  it("finds no removed or retyped field against the golden, unless schemaVersion was raised", () => {
    const breaking = breakingChanges(GOLDEN.fields, current);
    if (SCHEMA_VERSION === GOLDEN.schemaVersion) expect(breaking).toEqual([]);
  });
  it("keeps the golden complete: an additive field is added to it in the same change", () => {
    expect(Object.keys(current).filter((k) => !(k in GOLDEN.fields))).toEqual([]);
  });
  it("can fail: a removed field, a retyped field and a field that may no longer be null are each breaking", () => {
    const removed = { ...current };
    delete removed["cycles[].crankedBy"];
    expect(breakingChanges(GOLDEN.fields, removed)).toEqual(["removed: cycles[].crankedBy"]);
    expect(breakingChanges(GOLDEN.fields, { ...current, "runStatus.counts.opaque": "string" })).toEqual([
      "retyped: runStatus.counts.opaque (integer to string)",
    ]);
    expect(breakingChanges(GOLDEN.fields, { ...current, "repo.url": "string" })).toEqual([
      "retyped: repo.url (null|string to string)",
    ]);
    expect(breakingChanges(GOLDEN.fields, { ...current, "new.field": "string" })).toEqual([]);
  });
});

describe("docs/json-output.md is the schema's field table (C7 prose)", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs", "json-output.md"), "utf8");
  it("holds the table generated from the committed schema (run scripts/json-output-doc.mjs after a change)", () => {
    expect(doc).toContain(fieldTable(SCHEMA as Record<string, unknown>));
    expect(withTable(doc, SCHEMA as Record<string, unknown>)).toBe(doc);
  });
  it("names every field path of the schema with its type and a meaning", () => {
    const rows = fieldRows(SCHEMA as Record<string, unknown>);
    const fields = schemaFields(SCHEMA);
    expect(rows).toHaveLength(Object.keys(fields).length);
    for (const [p, t] of Object.entries(fields)) {
      const row = rows.find((r) => r.startsWith(`| \`${p}\` |`));
      expect(row, p).toBeDefined();
      expect(row, p).toContain(`| ${t.split("|").join(" or ")} |`);
      expect((row as string).split("|")[3]?.trim().length, p).toBeGreaterThan(3);
    }
  });
  it("states the compatibility rule", () => {
    expect(doc).toContain("**Additive changes keep `schemaVersion`**");
    expect(doc).toContain("**Breaking changes raise `schemaVersion`**");
  });
});
