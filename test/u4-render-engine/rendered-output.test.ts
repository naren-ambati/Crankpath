// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Flux substitution variables are written ${name} in the inputs under test
import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { withValue } from "../support/limits.js";
import { READER_LIMITS } from "../../src/u2-intake-config/bounded-reader.js";
import { substituteDocument } from "../../src/u4-render-engine/flux-substitution.js";
import { OUTPUT_LIMITS, parseRenderedOutput, splitDocuments } from "../../src/u4-render-engine/rendered-output.js";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

const cm = (name: string) => `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${name}\n`;

describe("rendered output splitting (FR1.4)", () => {
  it("splits at --- and ... lines only, keeping `--- value` content and dropping comment-only pieces", () => {
    expect(splitDocuments(`---\n# Source: a\n${cm("a")}---\n${cm("b")}...\n---\n# only a comment\n`)).toEqual([
      `# Source: a\n${cm("a")}`.replace(/\n$/, ""),
      cm("b").replace(/\n$/, ""),
    ]);
    expect(splitDocuments("--- |\n  text\n")).toEqual(["|\n  text\n"]);
    expect(splitDocuments("a: |\n  ---not a marker\n  x\n")).toHaveLength(1);
    expect(splitDocuments("----\na: 1\n")).toEqual(["----\na: 1\n"]);
  });
});

describe("rendered output parsing under the limits", () => {
  it("parses each document on its own and numbers documents from 1", () => {
    const r = parseRenderedOutput(Buffer.from(`---\n${cm("a")}---\n\n---\n${cm("b")}`), "render:j");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.documents.map((d) => [d.file, d.document])).toEqual([
      ["render:j", 1],
      ["render:j", 2],
    ]);
  });
  it("refuses a document over renderedDocumentBytes by name, and keeps the others", () => {
    const limits = { ...OUTPUT_LIMITS, documentBytes: withValue(LIMITS.renderedDocumentBytes, 60, "test") };
    const r = parseRenderedOutput(
      Buffer.from(`${cm("a")}---\n${cm("b")}data:\n  x: ${"y".repeat(100)}\n`),
      "render:j",
      limits,
    );
    expect(r).toMatchObject({ ok: true, refused: [{ document: 2, outcome: "too-large", detail: "document" }] });
    if (r.ok) expect(r.documents).toHaveLength(1);
  });
  it("refuses an alias bomb in one document, keeps the next", () => {
    const bomb = `a: &a [x,x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]\ne: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]\nf: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e,*e]\ng: &g [*f,*f,*f,*f,*f,*f,*f,*f,*f,*f]\nh: [*g,*g,*g,*g,*g,*g,*g,*g,*g,*g]\n`;
    const t0 = cpuStart();
    const r = parseRenderedOutput(Buffer.from(`${bomb}---\n${cm("after")}`), "render:j");
    expect(cpuSince(t0)).toBeLessThan(5000);
    expect(r).toMatchObject({ ok: true, refused: [{ document: 1, outcome: "alias-limit" }] });
    if (r.ok) expect(r.documents).toHaveLength(1);
  });
  it("refuses deep nesting and invalid YAML per document", () => {
    const deep = `${"[".repeat(20000)}${"]".repeat(20000)}`;
    const r = parseRenderedOutput(Buffer.from(`${deep}\n---\n: : :\n  - [\n---\n${cm("ok")}`), "render:j");
    expect(r.ok && r.refused.map((x) => x.outcome)).toEqual(["too-deep", "parse-error"]);
  });
  it("stops at the object limit, counting List items", () => {
    const limits = { ...OUTPUT_LIMITS, objects: withValue(LIMITS.renderedObjects, 2, "test") };
    expect(parseRenderedOutput(Buffer.from(`${cm("a")}---\n${cm("b")}`), "r", limits).ok).toBe(true);
    expect(parseRenderedOutput(Buffer.from(`${cm("a")}---\n${cm("b")}---\n${cm("c")}`), "r", limits)).toEqual({
      ok: false,
      problem: "too-many-objects",
    });
    const list = "apiVersion: v1\nkind: List\nitems:\n- {kind: A}\n- {kind: B}\n- {kind: C}\n";
    expect(parseRenderedOutput(Buffer.from(list), "r", limits)).toMatchObject({
      ok: false,
      problem: "too-many-objects",
    });
  });
  it("is a failed render, not a guess, when the output is not UTF-8", () => {
    expect(parseRenderedOutput(Buffer.from([0x61, 0x3a, 0x20, 0xff, 0xfe]), "r")).toEqual({
      ok: false,
      problem: "not-utf8",
    });
  });
  it("uses the reader's nesting and node limits", () => {
    expect(OUTPUT_LIMITS.reader).toBe(READER_LIMITS);
    expect(OUTPUT_LIMITS.documentBytes.value).toBe(3 * 1024 * 1024);
  });
});

describe("Flux post-build substitution (FR3.6)", () => {
  const vars = new Map([
    ["cluster", "prod"],
    ["empty", ""],
  ]);
  it("replaces ${name} and the default forms in keys and strings", () => {
    const r = substituteDocument(
      {
        kind: "ConfigMap",
        metadata: { name: "app-${cluster}" },
        data: {
          a: "${missing:=fallback}",
          b: "${empty:-dflt}",
          c: "${empty-dflt}",
          d: "${missing}",
          "${cluster}-key": "x",
          e: "$${cluster}",
          f: "$cluster stays",
          n: 3,
        },
      },
      vars,
    );
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "ConfigMap",
        metadata: { name: "app-prod" },
        data: { a: "fallback", b: "dflt", c: "", d: "", "prod-key": "x", e: "${cluster}", f: "$cluster stays", n: 3 },
      },
    });
  });
  it("refuses a form it does not read instead of guessing", () => {
    for (const s of ["${cluster:0:2}", "${cluster/prod/dev}", "${#cluster}", "${a${b}}", "${unterminated", "${1x}"]) {
      expect(substituteDocument({ kind: "X", data: { a: s } }, vars).ok, s).toBe(false);
    }
  });
  it("leaves an object with substitution disabled as it is, also inside a List", () => {
    const off = {
      kind: "X",
      metadata: { annotations: { "kustomize.toolkit.fluxcd.io/substitute": "disabled" } },
      a: "${cluster}",
    };
    expect(substituteDocument(off, vars)).toEqual({ ok: true, value: off });
    const list = substituteDocument({ kind: "List", items: [off, { kind: "Y", a: "${cluster}" }] }, vars);
    expect(list).toEqual({ ok: true, value: { kind: "List", items: [off, { kind: "Y", a: "prod" }] } });
  });
});
