// The LimitSet every unit reads (OD-5, FR1.4, NFR5). No number here is picked: each derived
// limit carries what it protects, the dated lookup or measurement it comes from, and the date.
// A limit whose basis needs a real render or a measurement not made yet is `notYetDerived`:
// it carries no `value` field, so code that tries to use it as a number does not compile.
// docs/limits.md is the reader's copy of this table; a test keeps the two in step.

export type LimitUnit =
  | "bytes"
  | "documents"
  | "levels"
  | "nodes"
  | "characters"
  | "applications"
  | "edges"
  | "cycles"
  | "files"
  | "milliseconds"
  | "objects"
  | "lexemes"
  | "entries"
  | "steps"
  | "lines";

export interface DerivedLimit<U extends LimitUnit = LimitUnit> {
  readonly status: "derived";
  readonly value: number;
  readonly unit: U;
  /** What the limit protects. */
  readonly protects: string;
  /** The derivation: the dated lookup or measurement and the arithmetic. */
  readonly basis: string;
  /** Date of the lookup or measurement (ISO day). */
  readonly date: string;
}

export interface NotYetDerivedLimit<U extends LimitUnit = LimitUnit> {
  readonly status: "notYetDerived";
  readonly unit: U;
  readonly protects: string;
  /** The bolt step that derives it. */
  readonly derivedIn: string;
  /** Why it cannot be derived yet. */
  readonly why: string;
}

export type Limit<U extends LimitUnit = LimitUnit> = DerivedLimit<U> | NotYetDerivedLimit<U>;

export interface LimitSet {
  readonly fileBytes: DerivedLimit<"bytes">;
  readonly documentsPerFile: DerivedLimit<"documents">;
  readonly nestingDepth: DerivedLimit<"levels">;
  readonly expandedNodesPerDocument: DerivedLimit<"nodes">;
  readonly lexemesPerFile: DerivedLimit<"lexemes">;
  readonly quotedTextChars: DerivedLimit<"characters">;
  readonly generatedApplicationsPerApplicationSet: NotYetDerivedLimit<"applications">;
  readonly mermaidMaxEdges: DerivedLimit<"edges">;
  readonly mermaidMaxTextChars: DerivedLimit<"characters">;
  readonly explainElementaryCycles: DerivedLimit<"cycles">;
  readonly explainListEntries: DerivedLimit<"entries">;
  readonly explainEdgeEntries: DerivedLimit<"entries">;
  readonly explainOutputLines: DerivedLimit<"lines">;
  readonly declaredEntries: DerivedLimit<"entries">;
  readonly hostPatternComparisons: DerivedLimit<"steps">;
  readonly filesPerScan: NotYetDerivedLimit<"files">;
  readonly renderWallClock: NotYetDerivedLimit<"milliseconds">;
  readonly renderStdoutBytes: NotYetDerivedLimit<"bytes">;
  readonly renderStderrBytes: NotYetDerivedLimit<"bytes">;
  readonly renderedObjects: NotYetDerivedLimit<"objects">;
}

const DATE = "2026-11-15";

/** The measured inputs of lexemesPerFile (scripts/measure-limits.mjs, part 1, 2026-11-15). */
const MEASURED = Object.freeze({ baselineMiB: 45, worstBytesPerLexeme: 937 });

function freezeAll<T extends object>(set: T): T {
  for (const entry of Object.values(set)) Object.freeze(entry);
  return Object.freeze(set);
}

/** The shortest YAML document that can describe one named Kubernetes object, with its separator. */
export const MINIMAL_OBJECT_DOCUMENT = "---\napiVersion: v1\nkind: X\nmetadata:\n name: a\n";

// Argo CD v3.6.1 repo-server default for --max-combined-directory-manifests-size is "10M", a
// Kubernetes quantity (decimal suffix): 10 * 10^6 bytes.
const ARGO_COMBINED_DIRECTORY_MANIFESTS_BYTES = 10 * 1000 * 1000;
// k8s.io/apiserver pkg/server/config.go: MaxRequestBodyBytes: int64(3 * 1024 * 1024).
const APISERVER_MAX_REQUEST_BODY_BYTES = 3 * 1024 * 1024;
// The smallest JSON encoding of one node of a value: one character plus its separator (`0,`).
const MIN_JSON_BYTES_PER_NODE = 2;
// Kubernetes object names: a DNS-1123 subdomain (at most 253), a namespace: a DNS-1123 label (63),
// a CRD kind: lower-cased, a DNS-1035 label (63). Canonical id: Kind/namespace/name.
const KIND_CHARS = 63;
const NAMESPACE_CHARS = 63;
const NAME_CHARS = 253;
// VT100 User Guide, chapter 1: a screen of 24 lines (80 or 132 columns). The --explain listing of
// elementary cycles prints a heading line, a stop line, then one line per cycle; the shell prompt
// takes one more line after the output (B6).
const VT100_SCREEN_LINES = 24;
const EXPLAIN_CYCLE_LISTING_OWN_LINES = 3;
// xterm(1), resource saveLines: "the number of lines to save beyond the top of the screen when a
// scrollbar is turned on. The default is 1024" (B6 review m4).
const XTERM_DEFAULT_SAVE_LINES = 1024;
// An --explain edge entry prints four lines: the edge, its file and line, its field, its rendered
// path (more when a long value wraps).
const EXPLAIN_EDGE_ENTRY_LINES = 4;
// GitHub docs, standard hosted runners: the smallest is ubuntu-slim, 1 CPU, 5 GB. V8 12.4 (Node 22)
// sizes the old generation as physical memory / kPhysicalMemoryToOldGenerationRatio (4) x
// kHeapLimitMultiplier (kSystemPointerSize / 4 = 2 on 64-bit without pointer compression).
const SMALLEST_RUNNER_OLD_GENERATION_BYTES = ((5 * 1000 * 1000 * 1000) / 4) * 2;
// scripts/measure-limits.mjs, 2026-11-15 (part 1): the largest resident baseline of a parse child
// before its text exists, and the most resident bytes per lexeme over the shapes.
const READER_BASELINE_BYTES = MEASURED.baselineMiB * 1024 * 1024;
// The text itself, derived: the read buffer (fileBytes) plus the decoded string, which holds at most
// one UTF-16 code unit (2 bytes) per byte of UTF-8 input: 3 bytes per byte of the largest file.
const TEXT_RESERVE_BYTES = 3 * ARGO_COMBINED_DIRECTORY_MANIFESTS_BYTES;
const WORST_BYTES_PER_LEXEME = MEASURED.worstBytesPerLexeme;
const LEXEMES_BASIS = `(the default old-generation heap V8 12.4 gives Node 22 on the smallest GitHub-hosted runner, ubuntu-slim with 5 GB: 5,000,000,000 / 4 x 2 = 2,500,000,000 bytes; minus the reader's largest measured baseline before the text exists, ${MEASURED.baselineMiB} MiB; minus a reserve for the text, 3 x fileBytes: the read buffer plus a decoded string of at most 2 bytes per input byte) / ${MEASURED.worstBytesPerLexeme} bytes, the worst resident memory per lexeme of the 39 shapes measured (scripts/measure-limits.mjs, part 1: multi-document files, comments, whitespace, nested collections and invalid YAML included; the worst was a run of commas, which the parser refuses only after spending the memory). It is the worst of the shapes measured, not a proven maximum. Every lexeme counts, in every document of the file.`;

export const LIMITS: LimitSet = freezeAll({
  fileBytes: {
    status: "derived",
    value: ARGO_COMBINED_DIRECTORY_MANIFESTS_BYTES,
    unit: "bytes",
    protects: "memory and parse time of one repository file",
    basis:
      'Argo CD v3.6.1 repo-server default --max-combined-directory-manifests-size "10M" (10,000,000 bytes): no single file of a directory-type Application can exceed what Argo CD reads for the whole directory at its defaults. Helm 4.3.2 sets no per-file limit (MaxDecompressedFileSize "is no longer used"; 100 MiB per chart) and no Flux per-file limit was found, so a larger file there is a named limit outcome.',
    date: DATE,
  },
  documentsPerFile: {
    status: "derived",
    value: Math.floor(ARGO_COMBINED_DIRECTORY_MANIFESTS_BYTES / MINIMAL_OBJECT_DOCUMENT.length),
    unit: "documents",
    protects: "per-document parse cost in a file of many tiny or empty documents",
    basis: `fileBytes / ${MINIMAL_OBJECT_DOCUMENT.length} bytes, the shortest document that can describe one named object (separator, apiVersion, kind, metadata.name): a file within fileBytes cannot hold more object-bearing documents.`,
    date: DATE,
  },
  nestingDepth: {
    status: "derived",
    value: 287,
    unit: "levels",
    protects: "the parser's stack: a refusal by this count, never by stack exhaustion, so the outcome is deterministic",
    basis:
      "the smallest nesting the yaml package 2.9.1 composed over eight shapes with V8's interpreter only (--jitless: the largest frames, so the lowest capacity) and half of Node 22.23.2's default stack already in use (the half kept for crankpath's own callers): 287 levels (scripts/measure-limits.mjs). go-yaml v2.4.2, the decoder Kubernetes uses, allows 10,000; files between the two are refused by name.",
    date: DATE,
  },
  expandedNodesPerDocument: {
    status: "derived",
    value: Math.floor(APISERVER_MAX_REQUEST_BODY_BYTES / MIN_JSON_BYTES_PER_NODE),
    unit: "nodes",
    protects: "memory and walk time of a document after alias and merge-key expansion (alias bombs)",
    basis:
      "kube-apiserver MaxRequestBodyBytes 3 MiB (k8s.io/apiserver pkg/server/config.go) / 2 bytes, the smallest JSON encoding of one value node: an object with more nodes cannot be sent to the API server.",
    date: DATE,
  },
  lexemesPerFile: {
    status: "derived",
    value: Math.floor(
      (SMALLEST_RUNNER_OLD_GENERATION_BYTES - READER_BASELINE_BYTES - TEXT_RESERVE_BYTES) / WORST_BYTES_PER_LEXEME,
    ),
    unit: "lexemes",
    protects:
      "the reader's memory for one file: the yaml package's syntax trees and the converted values of all its documents",
    basis: LEXEMES_BASIS,
    date: DATE,
  },

  quotedTextChars: {
    status: "derived",
    value: KIND_CHARS + 1 + NAMESPACE_CHARS + 1 + NAME_CHARS,
    unit: "characters",
    protects: "line length and output size of quoted repository text",
    basis:
      "the longest canonical node id Kind/namespace/name: kind 63 (CRD kind, lower-cased, a DNS-1035 label: apiextensions validation.go), namespace 63 (DNS-1123 label), name 253 (DNS-1123 subdomain): 63 + 1 + 63 + 1 + 253, so no valid id is ever cut.",
    date: DATE,
  },
  generatedApplicationsPerApplicationSet: {
    status: "notYetDerived",
    unit: "applications",
    protects: "graph size from one ApplicationSet's generators",
    derivedIn: "B3 step 0",
    why: "no source ties a ceiling to what it protects (Argo CD's --max-resources-status-count 5000 is a status-recording default, not a generation ceiling); needs the measured cost of a generated Application in the graph.",
  },

  mermaidMaxEdges: {
    status: "derived",
    value: 500,
    unit: "edges",
    protects: "a Mermaid diagram that the renderer would refuse to draw",
    basis: "Mermaid 12.3.0 config schema: maxEdges default 500.",
    date: DATE,
  },
  mermaidMaxTextChars: {
    status: "derived",
    value: 50000,
    unit: "characters",
    protects: "a Mermaid diagram text that the renderer would refuse to parse",
    basis: "Mermaid 12.3.0 config schema: maxTextSize default 50000.",
    date: DATE,
  },
  explainElementaryCycles: {
    status: "derived",
    value: VT100_SCREEN_LINES - EXPLAIN_CYCLE_LISTING_OWN_LINES,
    unit: "cycles",
    protects:
      "readability of --explain (the elementary cycles of one component fit one screen) and the time spent finding them (each costs at most one pass over the component)",
    basis: `a VT100 screen is ${VT100_SCREEN_LINES} lines (VT100 User Guide, chapter 1); the --explain listing of one component's elementary cycles uses ${EXPLAIN_CYCLE_LISTING_OWN_LINES} of them for itself (its heading line, its stop line, and the shell prompt after the output): ${VT100_SCREEN_LINES} - ${EXPLAIN_CYCLE_LISTING_OWN_LINES}. The output is sized by this bound (review m5): it counts entries, one per cycle, and each cycle's line shows at most explainListEntries nodes, so a long cycle's line wraps to a few lines; the whole output is bounded separately by explainOutputLines.`,
    date: DATE,
  },
  explainListEntries: {
    status: "derived",
    value: VT100_SCREEN_LINES - EXPLAIN_CYCLE_LISTING_OWN_LINES,
    unit: "entries",
    protects:
      "readability and size of each list --explain prints (a cycle's nodes, its edges with their evidence, the nodes of one elementary cycle, a node's dependencies and its dependents)",
    basis: `the same basis as explainElementaryCycles: one VT100 screen of ${VT100_SCREEN_LINES} lines less the ${EXPLAIN_CYCLE_LISTING_OWN_LINES} a listing uses for itself, for lists of one-line entries (nodes, dependents, unresolved items, self-management notes as observations, cranks and blockers inline). Edge entries take four lines and have their own bound, explainEdgeEntries. A list over the bound shows its first entries and says how many it left out, and points to the JSON output only for what the JSON carries.`,
    date: DATE,
  },
  explainEdgeEntries: {
    status: "derived",
    value: Math.floor((VT100_SCREEN_LINES - EXPLAIN_CYCLE_LISTING_OWN_LINES) / EXPLAIN_EDGE_ENTRY_LINES),
    unit: "entries",
    protects:
      "readability of the evidence lists of --explain (a cycle's edges, a node's dependencies): they fit one screen",
    basis: `one VT100 screen of ${VT100_SCREEN_LINES} lines less the ${EXPLAIN_CYCLE_LISTING_OWN_LINES} a listing uses for itself, divided by the ${EXPLAIN_EDGE_ENTRY_LINES} lines an edge entry prints (the edge, its file and line, its field, its rendered path): (${VT100_SCREEN_LINES} - ${EXPLAIN_CYCLE_LISTING_OWN_LINES}) / ${EXPLAIN_EDGE_ENTRY_LINES}, rounded down (B6 review pass 2, m4). A wrapped long value can still push a list past the screen.`,
    date: DATE,
  },
  explainOutputLines: {
    status: "derived",
    value: XTERM_DEFAULT_SAVE_LINES,
    unit: "lines",
    protects:
      "the whole of one --explain output stays in a terminal's default scrollback, so it can be read back to its first line",
    basis: `xterm(1), resource saveLines: the lines kept above the screen default to ${XTERM_DEFAULT_SAVE_LINES} (lookup 2026-11-15). The output, counted at 80 columns (a wider terminal shows fewer lines, a narrower one more; a file has no scrollback at all), holds at most that many lines: whole explanations while they fit, then a stop line saying what was left out; an explanation's own closing lines, the plan's assumptions and the not-modelled list are always printed.`,
    date: DATE,
  },
  declaredEntries: {
    status: "derived",
    value: Math.floor(APISERVER_MAX_REQUEST_BODY_BYTES / MIN_JSON_BYTES_PER_NODE),
    unit: "entries",
    protects: "work and output size the scanned repo's crankpath.yaml can cause through the number of its entries",
    basis:
      "crankpath.yaml is one document of at most expandedNodesPerDocument nodes (kube-apiserver MaxRequestBodyBytes 3 MiB / 2 bytes), and every entry of every section (an external, a match entry, a repos entry, an edge, a crank, one creates or reroutes target, a cluster, one label or annotation) is at least one node of it: no admitted file can hold more. ConfigReader counts them and refuses a file over the limit by name.",
    date: DATE,
  },
  hostPatternComparisons: {
    status: "derived",
    value: Math.floor(APISERVER_MAX_REQUEST_BODY_BYTES / MIN_JSON_BYTES_PER_NODE),
    unit: "steps",
    protects: "the time a run spends comparing hosts with match: entries that hold a wildcard",
    basis:
      "the same basis as expandedNodesPerDocument: the wildcard work the match: entries of one admitted file may cause is held to the nodes one admitted document may hold, counted in steps actually done (one per entry consulted, a literal label's length, a wildcard label's pattern length times label length, the matcher's own table). Entries are indexed by literal suffix, so a host consults only those it ends in, and a host is compared once. A spent budget is a counted limit: the remaining wildcard work is not done, and every node is unverified.",
    date: DATE,
  },
  filesPerScan: {
    status: "notYetDerived",
    unit: "files",
    protects: "total read time of a scan",
    derivedIn: "B3 step 0",
    why: "no tool or host publishes a file-count ceiling for a repository (GitHub recommends at most 3,000 entries per directory and a depth of 50, which bound no total); the basis needs discovery's measured per-file cost.",
  },
  renderWallClock: {
    status: "notYetDerived",
    unit: "milliseconds",
    protects: "a render subprocess that never ends (backstop only, OD-30)",
    derivedIn: "B2 step 0",
    why: "needs real helm and kustomize renders to measure.",
  },
  renderStdoutBytes: {
    status: "notYetDerived",
    unit: "bytes",
    protects: "memory held by one render's standard output",
    derivedIn: "B2 step 0",
    why: "needs real helm and kustomize renders to measure.",
  },
  renderStderrBytes: {
    status: "notYetDerived",
    unit: "bytes",
    protects: "memory held by one render's standard error",
    derivedIn: "B2 step 0",
    why: "needs real helm and kustomize renders to measure.",
  },
  renderedObjects: {
    status: "notYetDerived",
    unit: "objects",
    protects: "graph size from one render",
    derivedIn: "B2 step 0",
    why: "needs real helm and kustomize renders to measure.",
  },
} satisfies LimitSet);

/** The value of a derived limit. A not-yet-derived limit is a type error here. */
export function limitValue(limit: DerivedLimit): number {
  if (limit.status !== "derived") throw new Error("not-yet-derived limit used as a number (a bug)");
  return limit.value;
}
