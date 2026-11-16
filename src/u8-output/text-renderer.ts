// TextRenderer (U8, contract C8; BR8.4 to BR8.6, BR8.13, FR8.2, FR4.4, FR8.6, FR8.7): the human
// report. Fixed section order: header, toolchain, scanned repo, run status, opacity statement,
// cycles, unreachable and unverified, external preconditions, plan, closing lines. Every string
// from the scanned repo goes through SafeText after a fixed label, so it is quoted, escaped and
// never starts a line; a Kubernetes kind prints bare only from the fixed vocabulary. No meaning is
// carried by colour (there is none). Sections a build does not compute say so in fixed words.
// Counts come from the Report; nothing here counts.

import type { Evidence, NodeId } from "../u1-graph-model/graph-model.js";
import { parseNodeId } from "../u1-graph-model/graph-model.js";
import { quote, quoteUrl } from "../u1-graph-model/safe-text.js";
import type { GapReason, SourceKind } from "../u1-graph-model/status-model.js";
import { GAP_REASONS } from "../u1-graph-model/status-model.js";
import { EDGE_WORDS, PRINTABLE_KINDS } from "../u1-graph-model/vocabulary.js";
import type { NotComputed } from "../u7-graph-analysis/analysis.js";
import type { EdgeRef } from "../u7-graph-analysis/cycle-finder.js";
import type { NotVerifiedItem, OpaqueEntry, Report } from "./report-model.js";

const T = "terminal";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A node as text: a fixed-vocabulary kind before its quoted `namespace/name`, else `object "<id>"`. */
export function nodeRef(id: NodeId): string {
  const p = parseNodeId(id);
  if (p === undefined) return quote("object", id, T);
  if (p.external) return quote("external", p.name, T);
  const rest = p.namespace === null ? p.name : `${p.namespace}/${p.name}`;
  return PRINTABLE_KINDS.has(p.kind) ? quote(p.kind, rest, T) : quote("object", id, T);
}

const SAFE_FIELD = /^[A-Za-z0-9_.[\]/-]+$/;

function fieldText(field: string): string {
  return SAFE_FIELD.test(field) ? `field: ${field}` : quote("field:", field, T);
}

const NOT_COMPUTED_WORDS: Readonly<Record<NotComputed, string>> = Object.freeze({
  cranks: "cranks",
  statuses: "node statuses",
  plan: "the restoration plan",
});

function notComputedPhrase(items: readonly NotComputed[]): string {
  const order: NotComputed[] = ["cranks", "statuses", "plan"];
  const words = order.filter((i) => items.includes(i)).map((i) => NOT_COMPUTED_WORDS[i]);
  const list = words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `${list} not computed in this build`;
}

function gapPhrase(reason: GapReason, r: Report): string {
  const c = r.runStatus.counts;
  switch (reason) {
    case "opaque-sources":
      return `${plural(c.opaque, "source", "sources")} opaque`;
    case "unreadable-files":
      return `${plural(c.unreadableFiles, "file", "files")} unreadable`;
    case "skipped-objects":
      return `${plural(c.skipped, "object", "objects")} skipped`;
    case "unresolved-items":
      return plural(c.unresolved, "unresolved item", "unresolved items");
    case "timeouts":
      return `${plural(c.timeouts, "job", "jobs")} stopped by a time limit (the output may differ on a rerun)`;
    case "no-dependency-edges":
      return "no dependency edges were extracted";
    case "run-limit":
      return "the run's memory budget was reached";
    case "not-computed":
      return notComputedPhrase(r.notComputed);
    case "no-sources":
      return "no source was found";
  }
}

function notVerifiedPhrase(item: NotVerifiedItem, count: number, r: Report): string {
  switch (item) {
    case "opaque-sources":
      return `${plural(count, "source", "sources")} opaque`;
    case "unreadable-files":
      return `${plural(count, "file", "files")} unreadable`;
    case "skipped-objects":
      return `${plural(count, "object", "objects")} skipped`;
    case "foreign-destination-objects":
      return `${plural(count, "object", "objects")} of a foreign destination left out of host matching`;
    case "run-limit":
      return `the run's memory budget was reached (${runLimitParts(r).join(", ")})`;
    case "unresolved-items":
      return plural(count, "unresolved item", "unresolved items");
    case "timeouts":
      return `${plural(count, "job", "jobs")} stopped by a time limit`;
    case "uncranked-cycles":
      return `${plural(count, "cycle", "cycles")} uncranked`;
    case "unspecified-externals":
      return `${plural(count, "external", "externals")} unspecified`;
    case "cranks-not-applied":
      return `${plural(count, "crank", "cranks")} declared and not applied in this build`;
    case "match-not-used":
      return `${plural(count, "match entry", "match entries")} declared and not used in this build`;
    case "clusters-not-used":
      return `${plural(count, "cluster", "clusters")} declared and not used in this build`;
    case "fetch-not-used":
      return `${plural(count, "repos fetch entry", "repos fetch entries")} not fetched in this build`;
    case "not-computed":
      return notComputedPhrase(r.notComputed);
    case "declared-edges":
      return "";
  }
}

function runLimitParts(r: Report): string[] {
  const c = r.runStatus.counts;
  const parts: string[] = [];
  if (c.runLimitJobs > 0) parts.push(`${plural(c.runLimitJobs, "render job", "render jobs")} not taken in`);
  if (c.runLimitFiles > 0) parts.push(`${plural(c.runLimitFiles, "file", "files")} not read`);
  if (c.runLimitEdges > 0) parts.push(`${plural(c.runLimitEdges, "edge", "edges")} not kept`);
  return parts;
}

const KIND_WORDS: Readonly<Record<SourceKind, [string, string]>> = Object.freeze({
  Application: ["Application", "Applications"],
  ApplicationSet: ["ApplicationSet", "ApplicationSets"],
  Kustomization: ["Kustomization", "Kustomizations"],
  HelmRelease: ["HelmRelease", "HelmReleases"],
  KustomizeRoot: ["Kustomize root", "Kustomize roots"],
});

function foundLine(r: Report): string {
  const k = r.runStatus.counts.sourcesByKind;
  const parts = (Object.keys(KIND_WORDS) as SourceKind[]).map((kind) => {
    const [one, many] = KIND_WORDS[kind];
    return plural(k[kind], one, many);
  });
  const n = r.runStatus.counts.ignoredFiles;
  return `found: ${parts.join(", ")}; ${plural(n, "file holds", "files hold")} no source document`;
}

function header(r: Report, out: string[]): void {
  out.push(`crankpath ${r.toolchain.crankpath}`);
}

function toolchainLine(): string {
  return "toolchain: helm not detected, kustomize not detected (this build runs neither tool)";
}

function scannedLine(r: Report): string {
  const tail = "  commit: not read in this build  floating: no";
  if (r.repo.urlFrom === null) {
    return `scanned: repo URL unknown (no --repo-url and no origin in .git/config; only explicit mappings apply)${tail}`;
  }
  const from = r.repo.urlFrom === "flag" ? "from --repo-url" : "from the origin in .git/config";
  const url = r.repo.url === null ? "repo unparseable URL" : quoteUrl("repo", r.repo.url, T);
  const note = r.repo.comparable ? "" : "; not a URL crankpath can compare, so only explicit mappings apply";
  return `scanned: ${url} (${from}${note})${tail}`;
}

function statusLines(r: Report, out: string[]): void {
  out.push(`Run status: ${r.runStatus.state}`);
  const gaps = GAP_REASONS.filter((g) => r.runStatus.reasons.includes(g)).map((g) => gapPhrase(g, r));
  if (gaps.length > 0) out.push(`  gaps: ${gaps.join("; ")}`);
}

function opaqueLines(o: OpaqueEntry, i: number, n: number, out: string[]): void {
  const subject = o.node !== null ? `node: ${nodeRef(o.node)}` : quote("Kustomize root:", o.kustomizeRoot ?? "", T);
  out.push(`  opaque ${i} of ${n}  ${subject}  reason: ${o.reason}`);
  out.push(`    could not see: ${o.lostEdges.join("; ")}`);
  const detail = o.detail === null ? "" : `  (${o.detail})`;
  if (o.field !== null && o.value !== null)
    out.push(`    ${quote("field:", o.field, T)}  ${quote("value:", o.value, T)}${detail}`);
  else if (o.field !== null) out.push(`    ${quote("field:", o.field, T)}${detail}`);
  else if (o.detail !== null) out.push(`    detail: ${o.detail}`);
  if (o.suggestion !== null) {
    out.push(
      `    ${quoteUrl("suggested repos entry (not applied):", o.suggestion.url, T)}: {read_from: ${o.suggestion.readFrom}}`,
    );
  }
}

function opacity(r: Report, out: string[]): void {
  const c = r.runStatus.counts;
  const least = r.runStatus.floor ? "at least " : "";
  // A lower bound rounds down, an exact share rounds up: neither direction reads cleaner than it is.
  const share = c.sourcesFound === 0 ? 0 : (100 * c.opaque) / c.sourcesFound;
  // `at least` once: a share that rounds below 0.1% under a lower bound reads `more than 0%`.
  // A lower bound under 1% is shown to one decimal (rounded down), never as `at least 0%`.
  const down = Math.floor(share) > 0 || c.opaque === 0 ? `${Math.floor(share)}` : `${Math.floor(share * 10) / 10}`;
  const percent = r.runStatus.floor ? (down === "0" && c.opaque > 0 ? "more than 0" : down) : `${Math.ceil(share)}`;
  // no percentage over zero sources; one qualifier only
  const shareText = c.sourcesFound === 0 ? "" : percent === "more than 0" ? ` (${percent}%)` : ` (${least}${percent}%)`;
  const extra: string[] = [];
  if (c.opaqueApplicationSets > 0) {
    extra.push(
      `${plural(c.opaqueApplicationSets, "ApplicationSet is", "ApplicationSets are")} not expanded, so the Applications ${c.opaqueApplicationSets === 1 ? "it" : "they"} would generate are not counted`,
    );
  }
  if (c.skippedSources > 0)
    extra.push(`${plural(c.skippedSources, "source document was", "source documents were")} skipped and not counted`);
  out.push(
    `Opacity: ${least}${c.opaque} of ${plural(c.sourcesFound, "source", "sources")} opaque${shareText}; sources are Applications, ApplicationSets, Kustomizations, HelmReleases and Kustomize roots; ${extra.map((e) => `${e}; `).join("")}${plural(c.unreadableFiles, "file", "files")} unreadable.`,
  );
  out.push(`  ${foundLine(r)}`);
  if (c.foreignDestination > 0) {
    out.push(
      `  foreign destination: ${plural(c.foreignDestination, "object", "objects")} deployed to another cluster, left out of Service and host matching`,
    );
  }
  if (c.droppedHooks > 0)
    out.push(
      `  dropped: ${plural(c.droppedHooks, "Helm test hook", "Helm test hooks")} (not deployed by a GitOps controller)`,
    );
  if (c.runLimitFiles + c.runLimitJobs + c.runLimitEdges > 0) {
    out.push(
      `  run limit: the run's memory budget was reached: ${runLimitParts(r).join(", ")}; which items are refused follows the code-point order of file names and sources`,
    );
  }
  if (
    c.opaque === 0 &&
    c.unreadableFiles === 0 &&
    c.skipped === 0 &&
    c.foreignDestination === 0 &&
    c.droppedHooks === 0 &&
    c.runLimitFiles + c.runLimitJobs + c.runLimitEdges === 0
  ) {
    out.push("  (nothing opaque, nothing skipped)");
  }
  r.opaque.forEach((o, i) => {
    opaqueLines(o, i + 1, r.opaque.length, out);
  });
  r.unreadable.forEach((u, i) => {
    out.push(`  unreadable ${i + 1} of ${r.unreadable.length}  ${quote("file:", u.path, T)}  (${u.reasonWord})`);
  });
  r.skipped.forEach((s, i) => {
    const parts = [`reason: ${s.reason}`];
    if (s.kind !== null) parts.push(quote("kind:", s.kind, T));
    if (s.namespace !== null) parts.push(quote("namespace:", s.namespace, T));
    if (s.name !== null) parts.push(quote("name:", s.name, T));
    out.push(`  skipped ${i + 1} of ${r.skipped.length}  ${parts.join("  ")}`);
    const item = s.item === null ? "" : `  item: ${s.item}`;
    out.push(`    ${quote("file:", s.file, T)}  document: ${s.document}${item}`);
  });
}

type EvidenceIndex = ReadonlyMap<string, Evidence>;

function edgeKey(e: { from: string; to: string; kind: string; source: string }): string {
  return `${e.from}\n${e.to}\n${e.kind}\n${e.source}`;
}

function edgeLine(e: EdgeRef, index: EvidenceIndex): string {
  const evidence = index.get(edgeKey(e));
  const declared = e.source === "declared" ? "  (declared, unverified)" : "";
  const field = evidence === undefined ? "" : `  [${fieldText(evidence.field)}]`;
  return `    ${nodeRef(e.from)} ${EDGE_WORDS[e.kind] ?? e.kind} ${nodeRef(e.to)}${field}${declared}`;
}

function cycles(r: Report, out: string[]): void {
  const c = r.runStatus.counts;
  const dropped = c.runLimitEdges;
  if (r.cycles.length === 0 && dropped > 0) {
    // a dropped edge can be the one that closes a cycle: nothing can be said about cycles
    out.push(`Cycles: not determined (${plural(dropped, "edge", "edges")} not kept over the run limit)`);
    return;
  }
  if (r.cycles.length === 0) {
    const edges = c.edgesExtracted + c.edgesDeclared;
    if (c.edgesExtracted === 0) {
      out.push(`Cycles: none found among ${plural(c.nodes, "node", "nodes")}; no dependency edges were extracted.`);
      return;
    }
    const tail = [
      c.opaque > 0
        ? `${plural(c.opaque, "node", "nodes")} opaque, so cycles inside ${c.opaque === 1 ? "it" : "them"} cannot be seen`
        : "0 nodes opaque",
      plural(c.unresolved, "unresolved item", "unresolved items"),
    ];
    if (c.skipped > 0) tail.push(`${plural(c.skipped, "object", "objects")} skipped`);
    if (c.unreadableFiles > 0) tail.push(`${plural(c.unreadableFiles, "file", "files")} unreadable`);
    out.push(
      `Cycles: none found among ${plural(c.nodes, "node", "nodes")} and ${plural(edges, "edge", "edges")} read (${tail.join("; ")})`,
    );
    return;
  }
  const uncranked = r.cycles.filter((x) => x.label !== "cranked").length;
  const note =
    r.cranksDeclared > 0 && r.notComputed.includes("cranks") ? " (cranks are not applied in this build)" : "";
  out.push(`Cycles: ${uncranked} uncranked${note}`);
  if (dropped > 0)
    out.push(`  (${plural(dropped, "edge", "edges")} not kept over the run limit: other cycles may exist)`);
  const index: EvidenceIndex = new Map(r.edges.map((e) => [edgeKey(e), e.evidence]));
  for (const cycle of r.cycles) {
    out.push(`  cycle ${cycle.id}  label: ${cycle.label}  nodes: ${cycle.nodes.length}  edges: ${cycle.edges.length}`);
    for (const e of cycle.representativeEdges) out.push(edgeLine(e, index));
    const more = cycle.edges.length - cycle.representativeEdges.length;
    if (more > 0) {
      out.push(
        `    shortest cycle shown; ${plural(more, "more edge", "more edges")} of this component ${more === 1 ? "is" : "are"} listed in the JSON output`,
      );
    }
  }
}

function unverified(r: Report, out: string[]): void {
  if (r.statuses === null) out.push("Not startable from a cold start: not computed in this build.");
  out.push(`  unresolved items: ${r.unresolved.length}`);
  r.unresolved.forEach((u, i) => {
    const subject = u.why === "invalid-reference" ? quote("name:", u.subject, T) : `subject: ${nodeRef(u.subject)}`;
    const field = u.field === null ? "" : `  ${quote("field:", u.field, T)}`;
    const value = u.value === null ? "" : `  ${quote(u.why.startsWith("host-") ? "host:" : "value:", u.value, T)}`;
    out.push(`  unresolved ${i + 1} of ${r.unresolved.length}  why: ${u.why}  ${subject}`);
    out.push(`    ${quote("where:", u.where, T)}${field}${value}`);
    if (u.candidates.length > 0) {
      const lead = u.candidatesTruncated ? `first ${u.candidates.length} of more than ${u.candidates.length}: ` : "";
      out.push(`    candidates: ${lead}${u.candidates.map(nodeRef).join(", ")}`);
    }
  });
}

function externals(r: Report, out: string[]): void {
  if (r.externals.length === 0) {
    out.push("External preconditions: none declared in crankpath.yaml; none extracted in this build.");
    return;
  }
  out.push("External preconditions (declared cold-start availability):");
  for (const e of r.externals) {
    const state =
      e.coldStart === "available"
        ? "available (declared, not verified)"
        : e.coldStart === "unavailable"
          ? "unavailable (declared)"
          : e.servedBy !== null
            ? `served by ${nodeRef(e.servedBy)} (declared, not verified)`
            : "UNRESOLVED (not declared in crankpath.yaml)";
    out.push(`  ${quote("external", e.name, T)}  ${state}`);
  }
}

function plan(r: Report, out: string[]): void {
  if (r.plan === null) {
    out.push("Plan: not computed in this build; no restoration order is given.");
    return;
  }
  out.push(`Plan (${r.plan.disclaimer}):`);
  for (const s of r.plan.steps) {
    out.push(`  step ${s.no}  ${s.manual ? "manual" : "start"}  ${s.nodes.map(nodeRef).join(", ")}`);
  }
}

function closing(r: Report, out: string[]): void {
  const items = r.notVerified
    .filter((v) => v.item !== "declared-edges")
    .map((v) => notVerifiedPhrase(v.item, v.count, r));
  const declared = r.notVerified.find((v) => v.item === "declared-edges")?.count ?? 0;
  const list = items.length === 0 ? "nothing listed beyond the not-modelled items below" : items.join("; ");
  out.push(`Not verified: ${list}. Declared edges: ${declared} (unverified when present).`);
  out.push(`Not modelled: ${r.notModelled.join("; ")}.`);
}

function nothingAnalysed(r: Report, out: string[]): void {
  out.push(`Run status: ${r.runStatus.state}`);
  const u = r.runStatus.counts.unreadableFiles;
  const unreadable = u > 0 ? `; ${plural(u, "file", "files")} unreadable` : "";
  const absolute = r.scannedPathAbsolute ? " (absolute path, last segment only)" : "";
  out.push(`${quote("path:", r.scannedPath, T)}${absolute}  ${foundLine(r)}${unreadable}`);
  r.unreadable.forEach((f, i) => {
    out.push(`  unreadable ${i + 1} of ${r.unreadable.length}  ${quote("file:", f.path, T)}  (${f.reasonWord})`);
  });
  r.skipped.forEach((s, i) => {
    const name = s.name === null ? "" : `  ${quote("name:", s.name, T)}`;
    out.push(
      `  skipped ${i + 1} of ${r.skipped.length}  reason: ${s.reason}${name}  ${quote("file:", s.file, T)}  document: ${s.document}`,
    );
  });
  out.push("exit code 2");
}

/** The report as one string (tests and the library); the CLI writes renderTextLines line by line. */
export function renderText(r: Report): string {
  return `${renderTextLines(r).join("\n")}\n`;
}

/** The report's lines, in the fixed order, without line ends. */
export function renderTextLines(r: Report): string[] {
  const out: string[] = [];
  header(r, out);
  if (r.runStatus.state === "NOTHING ANALYSED") {
    nothingAnalysed(r, out);
    return out;
  }
  out.push(toolchainLine());
  out.push(scannedLine(r));
  statusLines(r, out);
  out.push("");
  opacity(r, out);
  out.push("");
  cycles(r, out);
  out.push("");
  unverified(r, out);
  out.push("");
  externals(r, out);
  out.push("");
  plan(r, out);
  out.push("");
  closing(r, out);
  return out;
}
