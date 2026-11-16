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
  | "lexemes";

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
  readonly explainElementaryCycles: NotYetDerivedLimit<"cycles">;
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
    status: "notYetDerived",
    unit: "cycles",
    protects: "readability of --explain: the elementary cycles of one component fit one screen",
    derivedIn: "B6 step 0",
    why: "a VT100 screen is 24 lines (VT100 User Guide, chapter 1), but the lines the --explain listing itself uses are not designed yet.",
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
