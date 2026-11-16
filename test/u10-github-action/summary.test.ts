// The Action's summary, annotations and outputs (BR10.4, BR10.8, BR10.10, NFR4.1, M7): repo text
// quoted and inert in every destination, the workflow-command encoding, the M7 wording, the words
// it never uses, the bounds GitHub sets on summaries and annotations.

import { describe, expect, it } from "vitest";
import {
  type DiffResult,
  type NewCycle,
  notCheckedResult,
  type ReportCycle,
  type ReportEdge,
  type RunSummary,
} from "../../action/base-head-differ.mjs";
import {
  ANNOTATIONS_PER_KIND,
  annotationFile,
  EDGE_WORDS,
  escapeData,
  escapeProperty,
  exitStatus,
  MAX_ESCAPED_CHARS,
  nodeRef,
  PRINTABLE_KINDS,
  quoted,
  renderAnnotations,
  renderOutputs,
  renderSummary,
  SAFE_TEXT_QUOTED_CHARS,
  safe,
  workflowCommand,
} from "../../action/summary.mjs";
import { LIMITS } from "../../src/u1-graph-model/limits.js";
import { jsonText } from "../../src/u1-graph-model/safe-text.js";
import { EDGE_WORDS as CLI_EDGE_WORDS, PRINTABLE_KINDS as CLI_KINDS } from "../../src/u1-graph-model/vocabulary.js";

const CTX = { crankpathVersion: "0.1.0", baseCommit: "a".repeat(40), headCommit: "b".repeat(40), pathPrefix: "" };
const RUN: RunSummary = {
  state: "ANALYSED",
  floor: false,
  reasons: [],
  opaque: 0,
  skipped: 0,
  unreadableFiles: 0,
  unresolved: 0,
  timeouts: 0,
  runLimitFiles: 0,
  runLimitJobs: 0,
  runLimitEdges: 0,
  declaredFacts: 0,
  submodules: 0,
};
const HOSTILE =
  '::error::x%0A\n\r# H [l](https://example.org) ![i](https://example.org/i.png) <img src=x> `code` |t| *b* _i_ ~s~ & "q" \\ \u001b[31m\u202e';

function edge(from: string, to: string, kind: string, file = "apps/a.yaml", source = "extracted"): ReportEdge {
  return { from, to, kind, source, orderingOnly: false, evidence: { file, line: null } };
}
function cyc(id: string, edges: ReportEdge[], label = "extracted"): ReportCycle {
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort();
  return {
    id,
    label,
    labelBeforeCranks: label,
    nodes,
    edges: edges.map(({ from, to, kind, source }) => ({ from, to, kind, source })),
    crankedBy: [],
    touchedBy: [],
    introducedBy: [],
    residual: null,
  };
}
function newCycle(c: ReportCycle, newEdges: ReportEdge[]): NewCycle {
  return {
    cycle: c,
    why: "new-edges",
    newEdges,
    baseEdgesPresent: c.edges.length - newEdges.length,
    baseCycle: null,
    baseCranks: [],
  };
}
function diff(parts: Partial<DiffResult>): DiffResult {
  return {
    result: "NO_NEW_CYCLES_FOUND",
    notChecked: [],
    newCycles: [],
    unchangedCycles: [],
    crankedInHead: [],
    headCranks: [],
    declared: { cranks: [], declaredEdges: [], externals: [], matchOverrides: [], repoMappings: [] },
    hiddenNew: [],
    newGaps: [],
    newDeclared: [],
    base: RUN,
    head: RUN,
    ...parts,
  };
}
const RING = [
  edge("Application/argocd/app-a", "Secret/argocd/app-a-creds", "needs-secret"),
  edge("Secret/argocd/app-a-creds", "Application/argocd/app-a", "deployed-by"),
];

/** The lines inside the summary's text fence. */
function fenced(md: string): string[] {
  const lines = md.split("\n");
  const open = lines.indexOf("```text");
  const close = lines.lastIndexOf("```");
  expect(open).toBeGreaterThan(0);
  expect(close).toBeGreaterThan(open);
  return lines.slice(open + 1, close);
}

describe("safe and quoted", () => {
  it("keeps the CLI's escape pairs and printable ASCII, shows everything else as a code", () => {
    expect(safe(jsonText('a"b\\c\u001bd'), "annotation")).toBe(jsonText('a"b\\c\u001bd'));
    expect(safe("tab\there\u00e9\u202e", "annotation")).toBe("tab\\x09here\\xe9\\u202e");
    expect(safe('lone " quote and trailing \\', "annotation")).toBe('lone \\" quote and trailing \\\\');
    expect(safe("\u{1F600}", "annotation")).toBe("\\u{1f600}");
  });
  it("shows each destination's specials as \\xNN", () => {
    expect(safe("<b>[x](y)`#|*_~!&", "markdown")).toBe(
      "\\x3cb\\x3e\\x5bx\\x5d(y)\\x60\\x23\\x7c\\x2a\\x5f\\x7e\\x21\\x26",
    );
    expect(safe("100%", "annotation")).toBe("100\\x25");
    expect(safe("100%", "markdown")).toBe("100%");
    // an escape pair whose second character is special is not kept as a pair
    expect(safe("\\<", "markdown")).toBe("\\\\\\x3c");
  });
  it("output is printable ASCII for any input, and inert for both destinations", () => {
    for (const d of ["markdown", "annotation"] as const) {
      const out = safe(HOSTILE, d);
      expect(out).toMatch(/^[\x20-\x7e]*$/);
      expect(out).not.toMatch(/(^|[^\\])"/);
    }
    expect(safe(HOSTILE, "markdown")).not.toMatch(/[<>[\]`#|*_~!&]/);
    expect(safe(HOSTILE, "annotation")).not.toContain("%");
  });
  it("cuts text longer than the CLI can write, with a stated marker", () => {
    const out = safe("x".repeat(MAX_ESCAPED_CHARS + 5), "annotation");
    expect(out).toBe(
      `${"x".repeat(MAX_ESCAPED_CHARS)}... (cut at ${MAX_ESCAPED_CHARS} of ${MAX_ESCAPED_CHARS + 5} characters by the Action)`,
    );
    expect(safe("x".repeat(MAX_ESCAPED_CHARS), "annotation")).toBe("x".repeat(MAX_ESCAPED_CHARS));
  });
  it("the bound is derived from the CLI's own: its longest escaped string fits uncut", () => {
    expect(SAFE_TEXT_QUOTED_CHARS).toBe(LIMITS.quotedTextChars.value);
    const worst = jsonText("\u{10ffff}".repeat(10 * SAFE_TEXT_QUOTED_CHARS));
    expect(Array.from(worst).length).toBeLessThanOrEqual(MAX_ESCAPED_CHARS);
    expect(safe(worst, "annotation")).toBe(worst);
  });
  it("needs a fixed label", () => {
    expect(quoted("by:", "x", "markdown")).toBe('by: "x"');
    expect(() => quoted('"', "x", "markdown")).toThrow(/fixed label/);
    expect(() => quoted("", "x", "markdown")).toThrow(/fixed label/);
  });
  it("prints kinds bare only from the CLI's vocabulary, and the vocabularies equal the CLI's", () => {
    expect([...PRINTABLE_KINDS].sort()).toEqual([...CLI_KINDS].sort());
    expect(EDGE_WORDS).toEqual(CLI_EDGE_WORDS);
    expect(nodeRef("Secret/argocd/x", "markdown")).toBe('Secret "argocd/x"');
    expect(nodeRef("ClusterIssuer/vault-pki", "markdown")).toBe('ClusterIssuer "vault-pki"');
    expect(nodeRef("Widget/argocd/x", "markdown")).toBe('object "Widget/argocd/x"');
    expect(nodeRef("external:github.com", "markdown")).toBe('external "github.com"');
  });
});

describe("workflow commands (annotation-safe escaping)", () => {
  it("encodes messages and properties as the runner decodes them", () => {
    expect(escapeData("a%b\rc\nd:e,f")).toBe("a%25b%0Dc%0Ad:e,f");
    expect(escapeProperty("a%b\rc\nd:e,f")).toBe("a%25b%0Dc%0Ad%3Ae%2Cf");
    const line = workflowCommand("error", { title: "t:1,2", file: "a,b\nc" }, "m\n::error::x");
    expect(line).toBe("::error file=a%2Cb%0Ac,title=t%3A1%2C2::m%0A::error::x");
    expect(line.split("\n")).toHaveLength(1);
  });
  it("names a file only for a plain repository path", () => {
    expect(annotationFile("apps/a.yaml", "")).toBe("apps/a.yaml");
    expect(annotationFile("apps/a.yaml", "estate")).toBe("estate/apps/a.yaml");
    for (const f of [
      "alias:1/a.yaml",
      "a/../b.yaml",
      "/etc/passwd",
      "a\\x0ab.yaml",
      "a,line=1.yaml",
      "a:b.yaml",
      "",
      "a//b",
    ]) {
      expect(annotationFile(f, "")).toBeUndefined();
    }
  });
  it("a new cycle is one error with its first new edge, quoted; hostile text cannot end the command", () => {
    const c = cyc("c-71d0", RING);
    const hostileEdge = {
      ...edge("Application/argocd/app-a", "Secret/argocd/app-a-creds", "needs-secret", jsonText(HOSTILE)),
    };
    const out = renderAnnotations(diff({ result: "FAILED", newCycles: [newCycle(c, [hostileEdge])] }), CTX);
    expect(out).toHaveLength(1);
    const line = out[0] as string;
    expect(line.startsWith("::error title=crankpath new uncranked cycle::New uncranked cycle c-71d0")).toBe(true);
    expect(line).toMatch(/^[\x20-\x7e]*$/);
    expect(line).not.toContain("file=");
    expect(line.indexOf("::", 2)).toBe(line.indexOf("::New uncranked"));
  });
  it("a plain evidence file becomes the file property", () => {
    const c = cyc("c-71d0", RING);
    const out = renderAnnotations(
      diff({
        result: "FAILED",
        newCycles: [newCycle(c, [{ ...(RING[0] as ReportEdge), evidence: { file: "apps/a.yaml", line: 7 } }])],
      }),
      { ...CTX, pathPrefix: "estate" },
    );
    expect(out[0]).toMatch(/^::error file=estate\/apps\/a\.yaml,line=7,title=/);
  });
  it("writes at most 10 errors per step (GitHub's limit), the last counting the rest", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      newCycle(cyc(`c-${String(i).padStart(2, "0")}`, RING), [RING[0] as ReportEdge]),
    );
    const out = renderAnnotations(diff({ result: "FAILED", newCycles: many }), CTX);
    expect(out.filter((l) => l.startsWith("::error"))).toHaveLength(ANNOTATIONS_PER_KIND);
    expect(out.at(-1)).toContain("6 more new uncranked cycles are listed in the job summary");
    const ten = renderAnnotations(diff({ result: "FAILED", newCycles: many.slice(0, 10) }), CTX);
    expect(ten.filter((l) => l.startsWith("::error"))).toHaveLength(10);
    expect(ten.join("\n")).not.toContain("more new uncranked");
  });
  it("warns on declared facts, hidden cycles and gaps, and errors on NOT CHECKED", () => {
    const crank = {
      id: "crank:1",
      by: "b",
      ref: null,
      createdNodes: ["Secret/a/b"],
      reroutedEdges: [],
      matched: true,
      keyPath: "cranks[0]",
    };
    const gaps = { ...RUN, state: "ANALYSED WITH GAPS", opaque: 3, reasons: ["opaque-sources"] };
    const out = renderAnnotations(
      diff({
        declared: { cranks: [crank], declaredEdges: [], externals: [], matchOverrides: [], repoMappings: [] },
        hiddenNew: [{ id: "c-h", label: "extracted", nodeIds: [], hiddenBy: ["match[0]"] }],
        head: gaps,
      }),
      CTX,
    );
    expect(out.map((l) => l.slice(0, l.indexOf("::", 2)))).toEqual([
      "::warning title=crankpath declared facts",
      "::warning title=crankpath hidden cycles",
      "::warning title=crankpath gaps",
    ]);
    expect(out[0]).toContain("documented by the PR author, not verified");
    const baseOnly = renderAnnotations(diff({ base: gaps }), CTX);
    expect(baseOnly[0]).toContain("The base analysis has gaps");
    const nc = renderAnnotations(notCheckedResult([{ side: "base", code: "no-base" }]), CTX);
    expect(nc).toEqual([
      "::error title=crankpath NOT CHECKED::NOT CHECKED: no base commit (this is not a pull_request event and no base-ref was given). This job is not green.",
    ]);
  });
});

describe("the job summary (M7)", () => {
  it("FAILED: the new cycle, its new edges, the counts side by side, the result", () => {
    const md = renderSummary(
      diff({
        result: "FAILED",
        newCycles: [newCycle(cyc("c-71d0", RING), RING)],
        base: { ...RUN, state: "ANALYSED WITH GAPS", opaque: 2 },
        head: { ...RUN, state: "ANALYSED WITH GAPS", opaque: 2 },
      }),
      CTX,
    );
    expect(
      md.startsWith(
        "## crankpath: FAILED\n\ncrankpath 0.1.0; base commit aaaaaaaaaaaa; head commit bbbbbbbbbbbb.\n\n```text\n",
      ),
    ).toBe(true);
    expect(fenced(md)).toEqual([
      "New uncranked cycles: 1",
      "  cycle c-71d0  label: extracted  edges: 2   (head only; base has 0 of its edges)",
      '    Application "argocd/app-a" needs Secret "argocd/app-a-creds"  [file: "apps/a.yaml"]',
      '    Secret "argocd/app-a-creds" deployed by Application "argocd/app-a"  [file: "apps/a.yaml"]',
      "Cranks, declared edges and externals added by this pull request: 0",
      "Base: ANALYSED WITH GAPS (2 opaque, 0 skipped).  Head: ANALYSED WITH GAPS (2 opaque, 0 skipped).",
      "  base gaps: none listed by crankpath",
      "  head gaps: none listed by crankpath",
      "Result: FAILED (new uncranked cycle)",
    ]);
  });
  it("NO_NEW_CYCLES_FOUND is never a pass, and more head opacity is never worded clean (BR10.10)", () => {
    const crank = {
      id: "crank:1",
      by: "kubectl create secret from 1Password, runbook DR-3",
      ref: null,
      createdNodes: ["Secret/a/b"],
      reroutedEdges: [],
      matched: true,
      keyPath: "cranks[0]",
    };
    const md = renderSummary(
      diff({
        base: { ...RUN, state: "ANALYSED WITH GAPS", opaque: 2, reasons: ["opaque-sources"] },
        head: { ...RUN, state: "ANALYSED WITH GAPS", opaque: 3, reasons: ["opaque-sources"] },
        declared: { cranks: [crank], declaredEdges: [], externals: [], matchOverrides: [], repoMappings: [] },
      }),
      CTX,
    );
    const lines = fenced(md);
    expect(lines[0]).toBe(
      "No new uncranked cycle found. Not a pass: the head has 3 opaque sources (base 2), so cycles inside them could not be seen; it rests on 1 declared fact this pull request added or changed, which crankpath does not verify; the head analysis has gaps (listed below).",
    );
    expect(lines).toContain(
      '  crank 1 by: "kubectl create secret from 1Password, runbook DR-3"  (creates 1 node; documented by the PR author, not verified)',
    );
    expect(lines).toContain("  the head has more opaque sources than the base (3 against 2)");
    expect(lines.at(-1)).toBe("Result: NO_NEW_CYCLES_FOUND (not a pass; see the first line)");
    expect(md.split("\n")[0]).toBe("## crankpath: NO_NEW_CYCLES_FOUND (not a pass)");
    // twin: the same opacity on both sides drops the comparison but keeps the opacity clause
    const same = fenced(
      renderSummary(diff({ base: { ...RUN, opaque: 2 }, head: { ...RUN, opaque: 2, floor: true } }), CTX),
    );
    expect(same[0]).toBe(
      "No new uncranked cycle found. Not a pass: the head has at least 2 opaque sources, so cycles inside them could not be seen.",
    );
    const bare = fenced(renderSummary(diff({}), CTX));
    expect(bare[0]).toMatch(/^No new uncranked cycle found\. Not a pass: it says only that/);
  });
  it("NOT CHECKED: the M7 shallow-clone line, and the job is not green", () => {
    const md = renderSummary(
      notCheckedResult([{ side: "base", code: "base-not-in-checkout-shallow", value: "abc123" }]),
      { ...CTX, baseCommit: null },
    );
    expect(fenced(md)).toEqual([
      'NOT CHECKED: base commit "abc123" not in checkout (shallow clone). This job is not green.',
      "Result: NOT CHECKED (no comparison was made; the job is not green)",
    ]);
    expect(md.split("\n")[0]).toBe("## crankpath: NOT CHECKED");
    expect(renderOutputs(notCheckedResult([{ side: "base", code: "no-base" }]))).toBe(
      "result=NOT_CHECKED\nnew-cycles=\n",
    );
    expect(exitStatus(notCheckedResult([{ side: "base", code: "no-base" }]))).toBe(1);
  });
  it("every NOT CHECKED reason has crankpath's own wording", () => {
    const codes = [
      "no-base",
      "base-not-in-checkout",
      "head-unreadable",
      "not-a-checkout",
      "path-missing",
      "config-missing",
      "invalid-input",
      "export-failed",
      "tool-error",
      "nothing-analysed",
      "timeout",
      "report-unreadable",
      "something-new",
    ];
    const lines = fenced(
      renderSummary(
        notCheckedResult(codes.map((code) => ({ side: "head" as const, code, value: HOSTILE, exit: 1, count: 2 }))),
        CTX,
      ),
    );
    expect(
      lines.slice(0, -1).every((l) => l.startsWith("NOT CHECKED: ") && l.endsWith(" This job is not green.")),
    ).toBe(true);
    expect(lines).toContain('NOT CHECKED: reason "something-new". This job is not green.');
    expect(lines).toContain(
      "NOT CHECKED: 2 renders timed out on the head, so its output may differ on a rerun. This job is not green.",
    );
  });
  it("hostile repo text stays inside quotes and the fence: no link, image, HTML, heading or fence", () => {
    const h = jsonText(HOSTILE);
    const crank = {
      id: "crank:1",
      by: h,
      ref: h,
      createdNodes: [],
      reroutedEdges: [],
      matched: false,
      keyPath: "cranks[0]",
    };
    const md = renderSummary(
      diff({
        result: "FAILED",
        newCycles: [
          newCycle(cyc("c-71d0", RING), [
            edge("Application/argocd/app-a", "Secret/argocd/app-a-creds", "needs-secret", h),
          ]),
        ],
        declared: {
          cranks: [crank],
          declaredEdges: [edge("Application/argocd/app-a", "external:git.example.org", "depends-on", h, "declared")],
          externals: [{ id: `external:${h}`, coldStart: "available", servedBy: null }],
          matchOverrides: [{ host: h, keyPath: h, declared: "Service/a/b", key: "m" }],
          repoMappings: [{ from: "crankpath.yaml", url: h, root: h, used: true, key: "r" }],
        },
        hiddenNew: [{ id: "c-h", label: "extracted", nodeIds: ["Service/a/b"], hiddenBy: [h] }],
      }),
      { ...CTX, pathPrefix: h },
    );
    const lines = md.split("\n");
    expect(lines.filter((l) => l.startsWith("#"))).toEqual(["## crankpath: FAILED"]);
    expect(lines.filter((l) => l.startsWith("```"))).toEqual(["```text", "```"]);
    expect(md).toMatch(/^[\x20-\x7e\n]*$/);
    for (const bad of ["<img", "](", "![", "`code`", "|t|", "\u001b", "\r"]) expect(md).not.toContain(bad);
    for (const l of fenced(md)) {
      expect(l).not.toMatch(/^\s*"/);
      // every quote holds an escaped string: quotes are balanced on each line
      expect((l.replace(/\\./g, "").match(/"/g) ?? []).length % 2).toBe(0);
    }
  });
  it("never says passed, OK or green; pass and green appear only negated", () => {
    const all = [
      renderSummary(diff({}), CTX),
      renderSummary(diff({ result: "FAILED", newCycles: [newCycle(cyc("c-1", RING), RING)] }), CTX),
      renderSummary(notCheckedResult([{ side: "base", code: "no-base" }]), CTX),
      ...renderAnnotations(notCheckedResult([{ side: "base", code: "no-base" }]), CTX),
    ].join("\n");
    expect(all).not.toMatch(/\bpassed\b|\bOK\b|\bclean\b|\bsafe\b/i);
    expect(all.replace(/not a pass|not green/gi, "")).not.toMatch(/\bpass\b|\bgreen\b/i);
  });
  it("the summary stays within GitHub's 1 MiB per step and counts what it leaves out", () => {
    const many = Array.from({ length: 30000 }, (_, i) => newCycle(cyc(`c-${i}`, RING), RING));
    const md = renderSummary(diff({ result: "FAILED", newCycles: many }), CTX);
    expect(new TextEncoder().encode(md).length).toBeLessThanOrEqual(1024 * 1024);
    expect(md).toMatch(/\.\.\. \d+ more lines not shown: the job summary holds at most 1048576 bytes/);
    expect(fenced(md).at(-1)).toBe("Result: FAILED (new uncranked cycle)");
    const small = renderSummary(diff({ result: "FAILED", newCycles: many.slice(0, 3) }), CTX, 900);
    expect(new TextEncoder().encode(small).length).toBeLessThanOrEqual(900);
    expect(small).toContain("more lines not shown");
    const whole = renderSummary(diff({ result: "FAILED", newCycles: many.slice(0, 3) }), CTX);
    expect(whole).not.toContain("not shown");
  });
  it("outputs and exit status", () => {
    expect(renderOutputs(diff({}))).toBe("result=NO_NEW_CYCLES_FOUND\nnew-cycles=0\n");
    expect(exitStatus(diff({}))).toBe(0);
    const failed = diff({ result: "FAILED", newCycles: [newCycle(cyc("c-1", RING), RING)] });
    expect(renderOutputs(failed)).toBe("result=FAILED\nnew-cycles=1\n");
    expect(exitStatus(failed)).toBe(1);
  });
});
