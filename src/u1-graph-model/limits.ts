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
  | "lines"
  | "fetches";

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
  readonly generatedApplicationsPerApplicationSet: DerivedLimit<"applications">;
  readonly mermaidMaxEdges: DerivedLimit<"edges">;
  readonly mermaidMaxTextChars: DerivedLimit<"characters">;
  readonly explainElementaryCycles: DerivedLimit<"cycles">;
  readonly explainListEntries: DerivedLimit<"entries">;
  readonly explainEdgeEntries: DerivedLimit<"entries">;
  readonly explainOutputLines: DerivedLimit<"lines">;
  readonly declaredEntries: DerivedLimit<"entries">;
  readonly hostPatternComparisons: DerivedLimit<"steps">;
  readonly filesPerScan: DerivedLimit<"files">;
  readonly generatorPatternSteps: DerivedLimit<"steps">;
  readonly repoFetchWallClock: DerivedLimit<"milliseconds">;
  readonly gitOutputBytes: DerivedLimit<"bytes">;
  readonly fetchedRepoBytes: DerivedLimit<"bytes">;
  readonly fetchesPerRun: DerivedLimit<"fetches">;
  readonly generatorRenderSteps: DerivedLimit<"steps">;
  readonly renderWallClock: DerivedLimit<"milliseconds">;
  readonly renderStdoutBytes: DerivedLimit<"bytes">;
  readonly renderStderrBytes: DerivedLimit<"bytes">;
  readonly renderedObjects: DerivedLimit<"objects">;
  readonly renderedDocumentBytes: DerivedLimit<"bytes">;
  readonly lexemesPerRender: DerivedLimit<"lexemes">;
}

import { RUN_LIMITS, RUN_RATES, WALK_COST } from "./run-limits.js";

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
// Argo CD v3.6.1 util/exec/exec.go: the repo-server stops a helm or kustomize command after
// ARGOCD_EXEC_TIMEOUT, default `90 * time.Second`; git too (util/git/client.go runs git through it).
const ARGO_EXEC_TIMEOUT_MS = 90 * 1000;
// Argo CD v3.6.1 reposerver/apiclient/clientset.go: MaxGRPCMessageSize, ARGOCD_GRPC_MAX_SIZE_MB
// default 100, times 1024 * 1024: the largest manifest response the repo-server can send.
const ARGO_GRPC_MAX_MESSAGE_BYTES = 100 * 1024 * 1024;
// etcd v3.7.3 server/embed/config.go: DefaultMaxRequestBytes = 1.5 * 1024 * 1024, the largest
// object etcd stores at its default, so the largest status a controller can write.
const ETCD_MAX_REQUEST_BYTES = 1.5 * 1024 * 1024;
// The shortest entry of each controller's per-object status list, as JSON with its separator:
// Flux kustomize-controller v1.10.1 ResourceRef {id: "<namespace>_<name>_<group>_<kind>", v: version},
// a cluster-scoped core object: `{"id":"_a__X","v":"v1"},`; Argo CD v3.6.1 ResourceStatus with its
// required non-empty kind, name and version: `{"version":"v1","kind":"X","name":"a"},`.
const FLUX_MINIMAL_INVENTORY_ENTRY = '{"id":"_a__X","v":"v1"},';
const ARGO_MINIMAL_RESOURCE_STATUS = '{"version":"v1","kind":"X","name":"a"},';

// scripts/measure-scan-limits.mjs, 2026-11-15: what a walked file costs a run that charges it
// nothing (an empty `.yaml` file: walked, read, parsed, cached), the worst of three shapes
// (576.7 bytes per file), rounded up (run-limits.ts WALK_COST).
const WALKED_FILE_BYTES = WALK_COST.perFile;
// Linux <linux/limits.h> PATH_MAX, 4096 bytes: no path the walk lists is longer, and a JavaScript
// string holds a path of at most that many UTF-16 code units at 2 bytes each.
const PATH_RESERVE_BYTES = WALK_COST.perPathChar * 4096;
// Every generated Application is an object of the run, charged the per-object rate and its string
// values; every Application has at least four (apiVersion, kind, metadata.name, metadata.namespace).
const GENERATED_APPLICATION_MIN_STRINGS = 4;

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
    status: "derived",
    value: Math.floor(
      RUN_LIMITS.runMemory.value / (RUN_RATES.perObject + GENERATED_APPLICATION_MIN_STRINGS * RUN_RATES.perStringLeaf),
    ),
    unit: "applications",
    protects:
      "the run's memory and time spent on one ApplicationSet's generated Applications, counted while they are generated",
    basis: `every generated Application is an object of the run: runMemory (${RUN_LIMITS.runMemory.value.toLocaleString("en-US")} bytes) / (the measured ${RUN_RATES.perObject.toLocaleString("en-US")} bytes per object + ${GENERATED_APPLICATION_MIN_STRINGS} x ${RUN_RATES.perStringLeaf.toLocaleString("en-US")} bytes per string value, for the apiVersion, kind, name and namespace every Application has). One ApplicationSet cannot generate more than the whole run could hold; the generation stops there, before more are built. Argo CD's --max-resources-status-count (5000) is a status-recording default, not a generation ceiling.`,
    date: DATE,
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
    status: "derived",
    value: Math.floor(RUN_LIMITS.runMemory.value / (WALKED_FILE_BYTES + PATH_RESERVE_BYTES)),
    unit: "files",
    protects:
      "the memory and time of the file lists a scan holds: files the run budget does not charge by their bytes (empty files, files discovery does not read) still cost the walk",
    basis: `runMemory (${RUN_LIMITS.runMemory.value.toLocaleString("en-US")} bytes) / (${WALKED_FILE_BYTES} bytes, the measured worst cost of a walked file the budget charges nothing for: scripts/measure-scan-limits.mjs, an empty .yaml file walked, read and cached; + ${PATH_RESERVE_BYTES.toLocaleString("en-US")} bytes for its path at the longest a walk lists: Linux PATH_MAX, 4,096 bytes, at 2 bytes per UTF-16 code unit). Every walk of a scan counts against it (discovery, every render and every generator listing), and each walked file is also charged to the run budget at ${WALKED_FILE_BYTES} bytes plus 2 bytes per character of its path, so the run budget binds first when other things fill it. No tool or host publishes a file-count ceiling for a repository.`,
    date: DATE,
  },
  generatorPatternSteps: {
    status: "derived",
    value: Math.floor(APISERVER_MAX_REQUEST_BODY_BYTES / MIN_JSON_BYTES_PER_NODE),
    unit: "steps",
    protects:
      "the time one ApplicationSet's git generator spends matching its path patterns against the repository's paths",
    basis:
      "the same basis as expandedNodesPerDocument and hostPatternComparisons: the matching work the patterns of one admitted document may cause is held to the nodes one admitted document may hold, counted in steps actually done (one per pattern consulted, plus the matcher's table: pattern length times path length for each comparison). Directory patterns consult only the paths of their own depth whose first segment they name. A spent budget stops the expansion: the ApplicationSet is opaque limit.",
    date: DATE,
  },
  repoFetchWallClock: {
    status: "derived",
    value: ARGO_EXEC_TIMEOUT_MS,
    unit: "milliseconds",
    protects:
      "the time one fetch takes, all its git calls together (the clone, then the verification and checkout of what it got): past it the fetch is unreadable-repo, detail timed out. With fetchesPerRun it is the whole bound on the time a run spends fetching: at most fetchesPerRun x repoFetchWallClock",
    basis:
      "Argo CD v3.6.1 stops every command it runs, git included (util/git/client.go runs git through util/exec), after ARGOCD_EXEC_TIMEOUT, default 90 s (util/exec/exec.go). crankpath gives one fetch that time in all (each git call gets what is left), so a repository Argo CD at its defaults could fetch in one command is within it, and a run cannot spend more than this per fetch however many calls the fetch makes.",
    date: DATE,
  },
  generatorRenderSteps: {
    status: "derived",
    value: Math.floor(RUN_LIMITS.runMemory.value / 2),
    unit: "steps",
    protects:
      "the time and memory one ApplicationSet's template rendering takes: its parameter sets times its template's size (B3 review M1)",
    basis: `runMemory (${RUN_LIMITS.runMemory.value.toLocaleString("en-US")} bytes) / 2 bytes per UTF-16 code unit: the text the rendering of one set produces cannot be more than the run can hold as strings. Counted in steps actually done, shared by every Application of the set: one per template node visited, and one per character a templated string produces (checked while the string is built). Each generated Application is also charged to the run budget, with its string values, before it is built.`,
    date: DATE,
  },
  fetchedRepoBytes: {
    status: "derived",
    value: Math.floor(RUN_LIMITS.runMemory.value / RUN_RATES.perFileByte),
    unit: "bytes",
    protects:
      "the disk one fetched repository takes (the files a run writes from it, and while it is read its object store and their copy), and a run that could not read it anyway (B3 review m5; checked before anything is written since pass 3, M1)",
    basis: `runMemory (${RUN_LIMITS.runMemory.value.toLocaleString("en-US")} bytes) / ${RUN_RATES.perFileByte} bytes, the run budget's measured charge per byte of a file held parsed: a run cannot hold more of a repository's files than this, so a larger repository is refused (counted limit) rather than half-read. Measured against it, each on its own: the object store a clone wrote (after git ends; while it runs, repoFetchWallClock bounds it), the object files copied from a store before git verifies them, the sum of the sizes git lists for the commit's files (and the listing itself), before checkout-index writes a byte, and, as a backstop, the files checkout-index wrote.`,
    date: DATE,
  },
  fetchesPerRun: {
    status: "derived",
    value: Math.floor(RUN_LIMITS.runMemory.value / Math.floor(RUN_LIMITS.runMemory.value / RUN_RATES.perFileByte)),
    unit: "fetches",
    protects:
      "the disk and time one run's fetches take: the command line's URL and every repos: entry together, reads from the cache included, so a scanned repository naming many cannot make a run fetch or write without end (B3 review pass 2, M2; disk stated since pass 3, m5); a fetch past it is a counted limit",
    basis: `floor(runMemory / fetchedRepoBytes) = floor(${RUN_LIMITS.runMemory.value.toLocaleString("en-US")} / ${Math.floor(RUN_LIMITS.runMemory.value / RUN_RATES.perFileByte).toLocaleString("en-US")}): what a fetch keeps in the run directory for the rest of the run is its written files, at most fetchedRepoBytes (its object store and their copy are removed once the files are written, or the store moved to the cache), so the run directory holds at most fetchesPerRun x fetchedRepoBytes, about runMemory, the run's one size figure, taken as its disk bound too; while one fetch is read, at most two more fetchedRepoBytes (the store and the copy) are on disk. A trusted cache grows by at most the same per run (one store per fetch). Time: at most fetchesPerRun x repoFetchWallClock.`,
    date: DATE,
  },
  gitOutputBytes: {
    status: "derived",
    value: ARGO_COMBINED_DIRECTORY_MANIFESTS_BYTES,
    unit: "bytes",
    protects:
      "memory held by one git command's standard output and error (kept only to classify a failure, never shown)",
    basis:
      "fileBytes: the output of a git command is held like one repository file and is never larger than the largest file crankpath reads (git publishes no output size; its own packet lines are at most 65,520 bytes each, LARGE_PACKET_MAX in pkt-line.h, with no bound on their number).",
    date: DATE,
  },
  renderWallClock: {
    status: "derived",
    value: ARGO_EXEC_TIMEOUT_MS,
    unit: "milliseconds",
    protects:
      "a render subprocess that never ends (a backstop only, OD-30: a job it stops is opaque limit, detail timeout)",
    basis:
      "Argo CD v3.6.1 repo-server stops a helm or kustomize command after ARGOCD_EXEC_TIMEOUT, default 90 s (util/exec/exec.go; docs/operator-manual/high_availability.md): a render that takes longer fails in Argo CD itself at its defaults. First real renders on 2026-11-15 took 0.05 to 0.9 s (docs/limits.md).",
    date: DATE,
  },
  renderStdoutBytes: {
    status: "derived",
    value: ARGO_GRPC_MAX_MESSAGE_BYTES,
    unit: "bytes",
    protects: "memory held by one render's standard output",
    basis:
      "Argo CD v3.6.1 MaxGRPCMessageSize (reposerver/apiclient/clientset.go: ARGOCD_GRPC_MAX_SIZE_MB default 100, times 1024 * 1024): the repo-server cannot return a larger manifest response for one source at its defaults. The largest real render measured on 2026-11-15 was 5,308,974 bytes (kube-prometheus-stack 93.3.0 with CRDs).",
    date: DATE,
  },
  renderStderrBytes: {
    status: "derived",
    value: ARGO_GRPC_MAX_MESSAGE_BYTES,
    unit: "bytes",
    protects: "memory held by one render's standard error (read only to classify a failure, never shown)",
    basis:
      "the same bound as renderStdoutBytes: Node's spawnSync holds both streams under one maxBuffer, so the memory a call can hold for standard error is the standard-output bound whatever smaller number is written here; no tool publishes a standard-error size. Measured need on 2026-11-15: 0 bytes for every successful real render.",
    date: DATE,
  },
  renderedObjects: {
    status: "derived",
    value: Math.floor(ETCD_MAX_REQUEST_BYTES / FLUX_MINIMAL_INVENTORY_ENTRY.length),
    unit: "objects",
    protects: "graph size from one render",
    basis: `no GitOps controller can track more objects from one source than its status lists in one etcd object: etcd v3.7.3 DefaultMaxRequestBytes 1.5 MiB / ${FLUX_MINIMAL_INVENTORY_ENTRY.length} bytes, the shortest Flux kustomize-controller v1.10.1 inventory entry (Argo CD v3.6.1's shortest ResourceStatus is ${ARGO_MINIMAL_RESOURCE_STATUS.length} bytes, a smaller bound; the larger is kept so nothing either controller can apply is cut). The most objects in one real render on 2026-11-15 was 136.`,
    date: DATE,
  },
  renderedDocumentBytes: {
    status: "derived",
    value: APISERVER_MAX_REQUEST_BODY_BYTES,
    unit: "bytes",
    protects: "parse memory and time of one document of a render's output",
    basis:
      "kube-apiserver MaxRequestBodyBytes 3 MiB (k8s.io/apiserver pkg/server/config.go): a rendered object larger than this cannot be sent to the API server, so a larger document is a named limit outcome.",
    date: DATE,
  },
  lexemesPerRender: {
    status: "derived",
    value: Math.floor(
      (SMALLEST_RUNNER_OLD_GENERATION_BYTES - READER_BASELINE_BYTES - 3 * ARGO_GRPC_MAX_MESSAGE_BYTES) /
        WORST_BYTES_PER_LEXEME,
    ),
    unit: "lexemes",
    protects:
      "crankpath's own memory and time while it parses one render's output: the yaml package's syntax trees and the converted values of all its documents",
    basis: `lexemesPerFile's derivation with a render's output in place of a file: (2,500,000,000 bytes, the default old-generation heap V8 12.4 gives Node 22 on ubuntu-slim; minus the reader's measured baseline, ${MEASURED.baselineMiB} MiB; minus a reserve for the output text, 3 x renderStdoutBytes: the output buffer plus a decoded string of at most 2 bytes per byte) / ${MEASURED.worstBytesPerLexeme} bytes, the most resident memory per lexeme measured. Every lexeme of every document of the output counts.`,
    date: DATE,
  },
} satisfies LimitSet);

/** The value of a derived limit. A not-yet-derived limit is a type error here. */
export function limitValue(limit: DerivedLimit): number {
  if (limit.status !== "derived") throw new Error("not-yet-derived limit used as a number (a bug)");
  return limit.value;
}
