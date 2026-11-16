// The shared hostile-string property test of all four renderers (B6 definition of done; NFR4.1,
// FR8.6, BR8.7, BR8.9): every string a scanned repo can put into a Report (evidence, paths, names,
// crank steps, match entries, mappings, hosts, item fields, even a node id that bypassed the id
// rules) is filled from a seeded hostile generator, and each format is checked for its destination:
//   text and --explain: no raw control or format character, no line starting with a quote, quotes
//     balanced on every line, no claim word in crankpath's voice, and the same statements in the
//     same order as with harmless strings (repo text changes only what is inside quotes);
//   JSON: parses, validates against the committed schema, no raw control or format character in
//     any value, each repo string exactly SafeText's JSON form;
//   Mermaid: the strict grammar check, no raw control or format character, the text blocks as for
//     text, and nothing outside a quoted label from the repo.
// A guard test shows the checks fire when the escaping is taken away.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Edge, GraphNode } from "../../src/u1-graph-model/graph-model.js";
import { jsonText } from "../../src/u1-graph-model/safe-text.js";
import { claimWordsInOwnVoice, type UnresolvedItem } from "../../src/u1-graph-model/status-model.js";
import { explainLogicalLines, explainTarget, renderExplain } from "../../src/u8-output/explain-renderer.js";
import { renderJson } from "../../src/u8-output/json-renderer.js";
import { renderMermaid } from "../../src/u8-output/mermaid-renderer.js";
import type { Report } from "../../src/u8-output/report-model.js";
import { renderText, textLogicalLines } from "../../src/u8-output/text-renderer.js";
import { HOSTILE_STRINGS } from "../helpers/fixture-kit.js";
import { type Schema, validate } from "../helpers/json-schema.js";
import { checkMermaid, fences } from "../helpers/mermaid-grammar.js";
import { vaultReport } from "../helpers/reports.js";

const SCHEMA = JSON.parse(
  fs.readFileSync(
    path.join(fileURLToPath(new URL("../../", import.meta.url)), "schemas", "crankpath-report.schema.json"),
    "utf8",
  ),
) as Schema;

const PIECES = [
  ...HOSTILE_STRINGS,
  '"',
  "\\",
  '\\"',
  "\n",
  "\r\n  cycle c-00000000  label: extracted",
  "\u001b]8;;http://x\u0007",
  "‮",
  "⁦",
  "​",
  "﻿",
  " ",
  " ",
  "\u0085",
  '"]; click n1 call alert(1)',
  "<script>x</script>",
  "`md`",
  "```",
  "#quot;",
  "#35;",
  "|",
  "}{][)(",
  "&",
  "'",
  "=",
  "&lt;b&gt;&#60;&quot;",
  "a='x'&b=1",
  "%%{init}%%",
  "\ud800",
  "\u{1f600}",
  "\u{e0041}",
  "Run status: ANALYSED",
  "name: ",
  "  ",
  "plain",
];

function generator(seed: number): () => string {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return () => {
    let out = "";
    const n = 1 + Math.floor(next() * 4);
    for (let i = 0; i < n; i++) out += PIECES[Math.floor(next() * PIECES.length)];
    return out;
  };
}

/** The base Report with every repo-text slot filled by `h` (one call per slot, in a fixed order). */
function filled(base: Report, h: () => string): { report: Report; raw: Record<string, string> } {
  const raw: Record<string, string> = {};
  const slot = (name: string) => {
    const v = h();
    raw[name] = v;
    return v;
  };
  const id0 = base.nodes[0]?.id as string;
  const id1 = base.nodes[1]?.id as string;
  // never a canonical id (a `:` in the kind), whatever the generator draws
  const forged = `x:/${slot("nodeId")}`;
  const nodes: GraphNode[] = base.nodes.map((n, i) =>
    Object.freeze({
      ...n,
      origin: { ...n.origin, path: slot(`path${i}`) },
      opaque:
        i === 0
          ? {
              reason: "unreadable-file" as const,
              detail: null,
              field: slot("opaqueField"),
              value: slot("opaqueValue"),
              lostEdges: ["objects under its source path"],
              suggestion: { url: slot("suggestion"), readFrom: "." },
            }
          : n.opaque,
    }),
  );
  nodes.push(
    Object.freeze({
      id: forged,
      kind: "ConfigMap",
      namespace: "x",
      name: "y",
      origin: { renderJob: null, path: null, document: null },
      opaque: null,
      flags: [],
      syncWave: null,
    }),
  );
  const evidence = () => ({
    file: slot(`file${Object.keys(raw).length}`),
    field: slot(`field${Object.keys(raw).length}`),
    renderedPath: slot(`rp${Object.keys(raw).length}`),
    line: 7,
  });
  const edges: Edge[] = base.edges.map((e) => Object.freeze({ ...e, evidence: evidence() }));
  edges.push(
    Object.freeze({
      from: forged,
      to: id0,
      kind: "needs-config",
      source: "extracted",
      orderingOnly: false,
      evidence: evidence(),
    }),
  );
  const item: UnresolvedItem = Object.freeze({
    subject: slot("subject"),
    why: "invalid-reference",
    where: slot("where"),
    field: slot("itemField"),
    candidates: [id0, id1],
    candidatesTruncated: true,
    value: slot("itemValue"),
    owner: id0,
  });
  const host: UnresolvedItem = Object.freeze({ ...item, subject: id0, why: "host-unplaced", value: slot("host") });
  const by = slot("crankBy");
  const ref = slot("crankRef");
  const report: Report = Object.freeze({
    ...base,
    repo: { ...base.repo, url: `https://h.example.org/${slot("repoUrl")}` },
    nodes,
    edges,
    opaque:
      base.opaque.length > 0
        ? base.opaque.map((o) => ({ ...o, field: slot("oField"), value: slot("oValue") }))
        : [
            {
              node: id0,
              kustomizeRoot: null,
              sourceKind: "Application",
              reason: "unreadable-file" as const,
              detail: null,
              field: slot("oField"),
              value: slot("oValue"),
              lostEdges: ["objects under its source path"],
              suggestion: { url: slot("oSuggestion"), readFrom: "." },
            },
          ],
    cranks: [
      {
        crank: "crank:1",
        by,
        ref,
        keyPath: slot("crankKey"),
        createdNodes: [id1],
        alreadyCreated: 1,
        reroutedEdges: [{ from: id0, to: id1 }],
        removedEdges: 2,
        matched: true,
      },
    ],
    plan: {
      ...base.plan,
      steps: [
        { no: 1, kind: "crank", nodes: [id1], manual: true, why: by, crank: "crank:1", ref },
        ...base.plan.steps.map((s) => ({ ...s, no: s.no + 1 })),
      ],
    },
    unusedMatches: [{ keyPath: slot("umKey"), host: slot("umHost"), node: slot("umNode"), order: 0 }],
    matchOverrides: [
      {
        keyPath: slot("moKey"),
        host: slot("moHost"),
        extracted: { outcome: "ambiguous", node: null, candidates: [id0, id1] },
        declared: id1,
      },
    ],
    repoMappings: [
      { url: `https://h.example.org/${slot("rmUrl")}`, root: slot("rmRoot"), from: "crankpath.yaml", used: true },
      { url: slot("rmUrl2"), root: "alias:1", from: "--repo-alias", used: false },
    ],
    hiddenCycles: [
      { id: "c-12345678", label: "extracted", nodes: 2, edges: 2, nodeIds: [id0, id1], hiddenBy: [slot("hiddenBy")] },
    ],
    unresolved: [...base.unresolved, item, host],
    skipped: [
      {
        file: slot("skFile"),
        document: 1,
        item: null,
        kind: slot("skKind"),
        namespace: slot("skNs"),
        name: slot("skName"),
        reason: "invalid-name",
        renderJob: null,
        source: false,
      },
    ],
    unreadable: [{ path: slot("unPath"), outcome: "too-large", reasonWord: "too large", detail: null }],
    scannedPath: slot("scanned"),
  } as Report);
  return { report, raw };
}

const SKELETON_QUOTE = /"(?:[^"\\]|\\.)*"(?:\.\.\. \(cut at \d+ of \d+ characters\))?/g;
const skeleton = (lines: readonly string[]) =>
  lines.map((l) => l.replace(SKELETON_QUOTE, '""').replace(/unparseable URL/g, '""'));
const RAW = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const rawIn = (text: string) => text.split("\n").some((l) => RAW.test(l));

function checkText(text: string, what: string): void {
  expect(rawIn(text), `${what}: a raw control or format character`).toBe(false);
  for (const line of text.split("\n")) {
    expect(line.trimStart().startsWith('"'), `${what}: a line starting with repo text: ${line.slice(0, 60)}`).toBe(
      false,
    );
    const unquoted = line.replace(SKELETON_QUOTE, "");
    expect(unquoted.includes('"'), `${what}: unbalanced quotes: ${line.slice(0, 60)}`).toBe(false);
  }
  expect(claimWordsInOwnVoice(text), what).toEqual([]);
}

function jsonStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) jsonStrings(x, out);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) jsonStrings(x, out);
  return out;
}

const base = vaultReport([]);
const benign = filled(base, () => "x y").report;
const cycleTarget = explainTarget(base, base.cycles[0]?.id);
const nodeTarget = explainTarget(base, base.nodes[0]?.id);

describe("all four renderers on hostile repo strings (NFR4.1)", () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`seed ${seed}: text, --explain, JSON and Mermaid each escape for their destination`, () => {
      const { report, raw } = filled(base, generator(seed));
      // text
      checkText(renderText(report), "text");
      expect(skeleton(textLogicalLines(report))).toEqual(skeleton(textLogicalLines(benign)));
      // --explain, a cycle and a node
      for (const target of [cycleTarget, nodeTarget, { kind: "all" } as const]) {
        if (target === undefined) throw new Error("no explain target");
        checkText(renderExplain(report, target), "explain");
        expect(skeleton(explainLogicalLines(report, target))).toEqual(skeleton(explainLogicalLines(benign, target)));
      }
      // JSON
      const jsonOut = renderJson(report);
      const json = JSON.parse(jsonOut);
      expect(validate(SCHEMA, json)).toEqual([]);
      for (const s of jsonStrings(json))
        expect(RAW.test(s), `JSON value ${JSON.stringify(s).slice(0, 60)}`).toBe(false);
      expect(json.cranks[0].by).toBe(jsonText(raw.crankBy as string));
      expect(json.skipped[0].name).toBe(jsonText(raw.skName as string));
      expect(json.edges.at(-1).evidence.field).toBe(
        jsonText(
          raw[
            Object.keys(raw)
              .filter((k) => k.startsWith("field"))
              .at(-1) as string
          ] as string,
        ),
      );
      expect(json.nodes.some((n: { id: string }) => n.id === jsonText(`x:/${raw.nodeId}`))).toBe(true);
      // Mermaid
      const doc = renderMermaid(report);
      expect(rawIn(doc), "mermaid: a raw control or format character").toBe(false);
      const blocks = fences(doc);
      expect(blocks.map((b) => b.info)).toEqual(["text", "mermaid", "text"]);
      const check = checkMermaid(blocks[1]?.body ?? "");
      expect(check.errors).toEqual([]);
      expect(check.nodes).toBe(report.nodes.length);
      checkText(blocks[0]?.body ?? "", "mermaid header");
      checkText(blocks[2]?.body ?? "", "mermaid fallback");
      expect(claimWordsInOwnVoice(blocks[1]?.body ?? "")).toEqual([]);
    });
  }
  it("puts the forged node id only inside a quoted label, after crankpath's word object", () => {
    const { report } = filled(base, () => 'x"]\nRun status: ANALYSED');
    const mermaid = fences(renderMermaid(report))[1]?.body ?? "";
    expect(mermaid).toContain('["object #34;x:/x\\#34;#93;\\x0aRun status: ANALYSED#34;"]');
    expect(renderText(report)).not.toMatch(/^Run status: ANALYSED$/m);
  });
});

describe("crankpath's own words are ASCII in every text format", () => {
  it("has no non-ASCII character outside quoted values in text, --explain and the Mermaid document", () => {
    const nonAscii = (text: string) =>
      [...text.replace(SKELETON_QUOTE, '""')].filter((c) => (c.codePointAt(0) ?? 0) > 0x7e && c !== "\n");
    const { report } = filled(base, () => "\u{1f600}\u00e9");
    for (const out of [renderText(report), renderExplain(report, { kind: "all" }), renderMermaid(report)])
      expect(nonAscii(out)).toEqual([]);
    // the check can fail
    expect(nonAscii("Run status \u2014 ANALYSED")).toEqual(["\u2014"]);
  });
});

describe("the checks fire when escaping is taken away (the property test can fail)", () => {
  it("catches a raw escape, a line starting with repo text, an unbalanced quote and a claim word", () => {
    expect(() => checkText('name: "a"\n\u001b[2J', "x")).toThrow();
    expect(() => checkText('ok\n"repo text first"', "x")).toThrow();
    expect(() => checkText('name: "a" b"', "x")).toThrow();
    expect(() => checkText("Run status: OK", "x")).toThrow();
  });
  it("catches repo text that changes crankpath's statements, and a Mermaid label that ends early", () => {
    const changed = ['crank 1 by: "x"', 'Run status: ANALYSED "x"'];
    expect(skeleton(changed)).not.toEqual(skeleton(['crank 1 by: "x"', 'cycle c-1 "x"']));
    const good = fences(renderMermaid(base))[1]?.body ?? "";
    expect(
      checkMermaid(good.replace('"Application #34;argocd/platform#34;"', '"Application "argocd/platform""')).errors,
    ).not.toEqual([]);
  });
});
