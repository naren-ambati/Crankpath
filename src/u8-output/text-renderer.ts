// TextRenderer (U8, contract C8; BR8.4 to BR8.6, BR8.13, FR8.2, FR4.4, FR8.6, FR8.7): the human
// report. Fixed section order: header, toolchain, scanned repo, run status, opacity statement,
// cycles, unreachable and unverified, external preconditions, plan, closing lines. Every string
// from the scanned repo goes through SafeText after a fixed label, so it is quoted, escaped and
// never starts a line; a Kubernetes kind prints bare only from the fixed vocabulary. No meaning is
// carried by colour (there is none). The not-startable section groups nodes by their named blocker;
// the plan states its disclaimer and its assumptions in every case, steps or none (BR7.18, BR7.20).
// Counts come from the Report; nothing here counts. Lines are built whole (logical lines) and then
// laid out at 80 columns by TextLayout, which never starts a line with repo text; the section
// builders are shared with the --explain and Mermaid renderers so every format says one thing.

import type { Evidence, NodeId } from "../u1-graph-model/graph-model.js";
import { parseNodeId } from "../u1-graph-model/graph-model.js";
import { quote, quoteUrl } from "../u1-graph-model/safe-text.js";
import type { GapReason, SourceKind } from "../u1-graph-model/status-model.js";
import { GAP_REASONS } from "../u1-graph-model/status-model.js";
import { EDGE_WORDS, PRINTABLE_KINDS } from "../u1-graph-model/vocabulary.js";
import type { NotComputed, PlanConflict } from "../u7-graph-analysis/analysis.js";
import { TOOL_PROBLEM_WORDS } from "../u4-render-engine/toolchain.js";
import type { EdgeRef } from "../u7-graph-analysis/cycle-finder.js";
import type { NotStartableGroup, NotVerifiedItem, OpaqueEntry, Report } from "./report-model.js";
import { wrapLines } from "./text-layout.js";

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

/** A crank as text: its position and its documented step, quoted (the scanned repo wrote it). */
export function crankRef(id: string, by: string): string {
  const n = /^crank:(\d+)$/.exec(id);
  return `${n ? `crank ${n[1]}` : quote("crank", id, T)} ${quote("by:", by, T)}`;
}

/**
 * An edge's evidence field, always quoted: a field path can hold repo keys (a map key, a seal
 * type), so no charset makes it crankpath's own text (B6; it printed bare when it looked plain).
 */
function fieldText(field: string): string {
  return quote("field:", field, T);
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
    case "declared-facts":
      return `${plural(c.declaredFacts, "declared fact changes", "declared facts change")} the graph read (crankpath.yaml, not verified)`;
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
    case "unverified-nodes":
      return `${plural(count, "node", "nodes")} unverified`;
    case "unspecified-externals":
      return `${plural(count, "external", "externals")} unspecified`;
    case "externals-declared":
      return `${plural(count, "external", "externals")} declared in crankpath.yaml (not verified)`;
    case "cranks-documented":
      return `${plural(count, "crank", "cranks")} documented (not verified)`;
    case "match-entries-relied":
      return `${plural(count, "match entry", "match entries")} relied on (not verified)`;
    case "repo-mappings":
      return `${plural(count, "repository", "repositories")} read through a crankpath.yaml repos: mapping (declared, not verified)`;
    case "match-unused":
      return `${plural(count, "match entry", "match entries")} unused`;
    case "cluster-provided":
      return `${plural(count, "object", "objects")} assumed provided by every cluster`;
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

function toolText(r: Report, tool: "helm" | "kustomize"): string {
  if (r.toolchain.missing.includes(tool)) return `${tool} not found on PATH`;
  const v = r.toolchain[tool];
  if (v !== null) return `${tool} ${v}`;
  const problem = r.toolchain.problems?.[tool];
  return problem === undefined
    ? `${tool} (version not recognised)`
    : `${tool} (version not recognised: ${TOOL_PROBLEM_WORDS[problem]})`;
}

function toolchainLines(r: Report, out: string[]): void {
  out.push(`toolchain: ${toolText(r, "helm")}, ${toolText(r, "kustomize")}`);
  const present = (["helm", "kustomize"] as const).filter((t) => !r.toolchain.missing.includes(t));
  const p = r.toolchain.testedPair;
  const offPair = present.some((t) => r.toolchain[t] !== p[t]);
  if (offPair) out.push(`  note: not the tested pair (helm ${p.helm}, kustomize ${p.kustomize}); rendering may differ`);
}

const TOOL_SOURCES = { helm: "Helm", kustomize: "Kustomize" } as const;

function toolMissingLines(r: Report, out: string[]): void {
  for (const tool of ["helm", "kustomize"] as const) {
    const n = r.toolMissing[tool];
    if (n === 0) continue;
    out.push(
      `${quote("tool missing:", tool, T)} (not found on PATH)  affected: ${n} ${TOOL_SOURCES[tool]} ${n === 1 ? "source" : "sources"} opaque, reason tool-missing`,
    );
  }
}

function floatingLines(r: Report, out: string[]): void {
  if (r.floating.length === 0) return;
  out.push("");
  out.push(
    `Floating revisions: ${r.floating.length} (a branch, tag, HEAD or version range: a rerun may read or render other content)`,
  );
  r.floating.forEach((f, i) => {
    const resolved = f.resolved === null ? "" : `  ${quote("rendered version:", f.resolved, T)}`;
    out.push(
      `  floating ${i + 1} of ${r.floating.length}  node: ${nodeRef(f.node)}  ${fieldText(f.field)}  ${quote("value:", f.value, T)}${resolved}`,
    );
  });
}

export function scannedLine(r: Report): string {
  // the commit is read only for a repository crankpath fetched itself (FR1.2, B3): a local
  // checkout's revision is taken as the files as read (a not-modelled item)
  const tail =
    r.repo.commit === null
      ? "  commit: not read in this build  floating: no"
      : `  ${quote("commit:", r.repo.commit, T)}  floating: ${r.repo.floating ? "yes (a branch, a tag or the default branch; the commit is the one fetched)" : "no"}`;
  if (r.repo.urlFrom === null) {
    return `scanned: repo URL unknown (no --repo-url and no origin in .git/config; only explicit mappings apply)${tail}`;
  }
  const from =
    r.repo.urlFrom === "flag"
      ? "from --repo-url"
      : r.repo.urlFrom === "fetched"
        ? "fetched read-only by crankpath"
        : "from the origin in .git/config";
  const url = r.repo.url === null ? "repo unparseable URL" : quoteUrl("repo", r.repo.url, T);
  const note = r.repo.comparable ? "" : "; not a URL crankpath can compare, so only explicit mappings apply";
  return `scanned: ${url} (${from}${note})${tail}`;
}

export function statusLines(r: Report, out: string[]): void {
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
  const u = r.undeployedKustomizeRoots;
  if (u.length > 0) {
    out.push(
      `  ${plural(u.length, "Kustomize root", "Kustomize roots")} no source deploys: ${u.length === 1 ? "its" : "their"} objects are not in the graph (each is built on its own unless it is a component)`,
    );
    u.forEach((d, i) => {
      out.push(`    undeployed ${i + 1} of ${u.length}  ${quote("Kustomize root:", d, T)}`);
    });
  }
  for (const m of r.repoMappings) {
    const how =
      m.from === "crankpath.yaml"
        ? m.used
          ? "crankpath.yaml repos:, declared, not verified"
          : "crankpath.yaml repos:, not used"
        : m.used
          ? "--repo-alias, your input"
          : "--repo-alias, your input, not used";
    const fetched =
      m.failure !== undefined && m.failure !== null
        ? `  not fetched: ${m.failure}`
        : m.commit !== undefined && m.commit !== null
          ? `  ${quote("commit:", m.commit, T)}  floating: ${m.floating === true ? "yes (the default branch)" : "no"}`
          : "";
    // a repos: fetch entry is the scanned repo's choice: it is fetched without a token (B3 review M2)
    const anonymous = m.from === "crankpath.yaml" && (m.root === "(fetch)" || m.root.startsWith("fetch:"));
    out.push(
      `  read through a mapping: ${quoteUrl("repo", m.url, T)}  ${quote("root:", m.root, T)}${fetched}${anonymous ? "  fetched without a token" : ""}  (${how})`,
    );
  }
  for (const c of r.clustersUsed) {
    out.push(
      `  expanded from a declared cluster: ${quote("cluster:", c, T)}  (crankpath.yaml clusters:, declared, not verified)`,
    );
  }
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

/** Cycles a match entry hides (review M1): listed after the cycles line, never silent. */
function hiddenLines(r: Report, out: string[]): void {
  const h = r.hiddenCycles;
  if (h.length === 0) return;
  out.push(
    `  ${plural(h.length, "cycle", "cycles")} not reported because a match entry overrode a host on ${h.length === 1 ? "it" : "them"}:`,
  );
  for (const x of h) {
    const by = x.hiddenBy.map((k) => quote("match entry", k, T)).join(", ");
    out.push(`    cycle ${x.id}  label: ${x.label}  nodes: ${x.nodes}  edges: ${x.edges}  hidden by: ${by}`);
  }
}

/** The cycles section: its headline and each cycle with its representative (shared with --explain). */
export function cycles(r: Report, out: string[]): void {
  const c = r.runStatus.counts;
  const dropped = c.runLimitEdges;
  if (r.cycles.length === 0 && dropped > 0) {
    // a dropped edge can be the one that closes a cycle: nothing can be said about cycles
    out.push(`Cycles: not determined (${plural(dropped, "edge", "edges")} not kept over the run limit)`);
    return;
  }
  if (r.cycles.length === 0 && r.hiddenCycles.length > 0) {
    // never a bare "none found": the graph read has match overrides applied, and they hide cycles
    const o = r.matchOverrides.length;
    const h = r.hiddenCycles.length;
    out.push(
      `Cycles: none found in the graph read with ${plural(o, "match override", "match overrides")} applied; ${plural(h, "cycle", "cycles")} hidden by the overrides (listed below)`,
    );
    hiddenLines(r, out);
    return;
  }
  if (r.cycles.length === 0) {
    const edges = c.edgesExtracted + c.edgesDeclared;
    const rests =
      c.declaredFacts + c.declaredAssumptions > 0
        ? `the result rests on ${plural(c.declaredFacts + c.declaredAssumptions, "declared fact", "declared facts")} from crankpath.yaml`
        : "";
    if (c.edgesExtracted === 0) {
      out.push(
        `Cycles: none found among ${plural(c.nodes, "node", "nodes")}; no dependency edges were extracted${rests === "" ? "" : `; ${rests}`}.`,
      );
      hiddenLines(r, out);
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
    if (rests !== "") tail.push(rests);
    out.push(
      `Cycles: none found among ${plural(c.nodes, "node", "nodes")} and ${plural(edges, "edge", "edges")} read (${tail.join("; ")})`,
    );
    hiddenLines(r, out);
    return;
  }
  const uncranked = r.cycles.filter((x) => x.label !== "cranked").length;
  const crankedCount = r.cycles.length - uncranked;
  out.push(`Cycles: ${uncranked} uncranked${crankedCount > 0 ? `, ${crankedCount} cranked` : ""}`);
  if (dropped > 0)
    out.push(`  (${plural(dropped, "edge", "edges")} not kept over the run limit: other cycles may exist)`);
  const index: EvidenceIndex = new Map(r.edges.map((e) => [edgeKey(e), e.evidence]));
  const crankById = new Map(r.cranks.map((c) => [c.crank, c]));
  const cranksText = (ids: readonly string[]) => ids.map((id) => crankRef(id, crankById.get(id)?.by ?? "")).join("; ");
  for (const cycle of r.cycles) {
    const label = cycle.label === "cranked" ? `cranked (was ${cycle.labelBeforeCranks})` : cycle.label;
    out.push(`  cycle ${cycle.id}  label: ${label}  nodes: ${cycle.nodes.length}  edges: ${cycle.edges.length}`);
    if (cycle.crankedBy.length > 0)
      out.push(`    cranked by: ${cranksText(cycle.crankedBy)}  (documented, not verified)`);
    if (cycle.residual !== null) {
      out.push(
        `    touched by: ${cranksText(cycle.touchedBy)}  (documented, not verified); not broken: ${plural(cycle.residual.length, "node is", "nodes are")} still on a cycle (residual label: ${cycle.residualLabel ?? cycle.label})`,
      );
    }
    if (cycle.introducedBy.length > 0)
      out.push(`    exists only once the cranks are applied; closed by: ${cranksText(cycle.introducedBy)}`);
    for (const e of cycle.representativeEdges) out.push(edgeLine(e, index));
    const more = cycle.edges.length - cycle.representativeEdges.length;
    if (more > 0) {
      out.push(
        `    shortest cycle shown; ${plural(more, "more edge", "more edges")} of this component ${more === 1 ? "is" : "are"} listed in the JSON output`,
      );
    }
  }
  hiddenLines(r, out);
}

function groupHeader(g: NotStartableGroup): string {
  const n = plural(g.nodes.length, "node", "nodes");
  switch (g.reason) {
    case "cycle":
      return `blocked by cycle ${g.blocker} (${g.cycleLabel ?? "label not known"}): ${n}`;
    case "external-unavailable":
      return `blocked by ${nodeRef(g.blocker)} (declared unavailable): ${n}`;
    case "external-unspecified":
      return `blocked by ${nodeRef(g.blocker)} (UNRESOLVED: its cold start is not declared): ${n}`;
    case "opaque":
      return `unverified, opaque or behind opaque ${nodeRef(g.blocker)}: ${n}`;
    case "undefined-reference":
      return `unverified, behind ${nodeRef(g.blocker)}, which no readable source defines: ${n}`;
    case "match-override":
      return `unverified, on cycle ${g.blocker}, which a match entry hides: ${n}`;
    case "unresolved":
      return g.blocker.startsWith("extractor:")
        ? `unverified, because ${quote("extractor", g.blocker.slice("extractor:".length), T)} failed: ${n}`
        : `unverified, behind an unresolved item on ${nodeRef(g.blocker)}: ${n}`;
  }
}

function unverified(r: Report, out: string[]): void {
  const crankBy = new Map(r.cranks.map((k) => [k.crank, k.by]));
  const c = r.statusCounts;
  const total = c.startable + c.blocked + c.unverified;
  const not = c.blocked + c.unverified;
  if (not === 0) {
    out.push(
      `Not startable from a cold start: 0 of ${plural(total, "node", "nodes")}; ${c.startable} startable, relative to the assumptions under the plan`,
    );
  } else {
    out.push(
      `Not startable from a cold start: ${not} of ${plural(total, "node", "nodes")} (${c.blocked} blocked, ${c.unverified} unverified); ${c.startable} startable`,
    );
  }
  for (const g of r.notStartable) {
    out.push(`  ${groupHeader(g)}`);
    for (const n of g.nodes) out.push(`    ${nodeRef(n.node)}${n.via === null ? "" : `  via ${nodeRef(n.via)}`}`);
  }
  out.push(`  unresolved items: ${r.unresolved.length}`);
  r.unresolved.forEach((u, i) => {
    const subject =
      u.why === "invalid-reference"
        ? quote("name:", u.subject, T)
        : u.why === "crank-unused" || u.why === "crank-target-unmatched"
          ? `subject: ${crankRef(u.subject, crankBy.get(u.subject) ?? "")}`
          : `subject: ${nodeRef(u.subject)}`;
    const field = u.field === null ? "" : `  ${quote("field:", u.field, T)}`;
    const value = u.value === null ? "" : `  ${quote(u.why.startsWith("host-") ? "host:" : "value:", u.value, T)}`;
    const owner = u.owner !== null && u.owner !== u.subject ? `  owner: ${nodeRef(u.owner)}` : "";
    out.push(`  unresolved ${i + 1} of ${r.unresolved.length}  why: ${u.why}  ${subject}${owner}`);
    out.push(`    ${quote("where:", u.where, T)}${field}${value}`);
    if (u.candidates.length > 0) {
      const lead = u.candidatesTruncated ? `first ${u.candidates.length} of more than ${u.candidates.length}: ` : "";
      out.push(`    candidates: ${lead}${u.candidates.map(nodeRef).join(", ")}`);
    }
  });
}

function externals(r: Report, out: string[]): void {
  if (r.externals.length === 0) {
    out.push("External preconditions: none declared in crankpath.yaml and none extracted from what was read.");
    unusedMatchLines(r, out);
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
  unusedMatchLines(r, out);
}

function extractedText(o: Report["matchOverrides"][number]["extracted"]): string {
  if (o.outcome === "unique" && o.node !== null) return nodeRef(o.node);
  if (o.outcome === "ambiguous") return `ambiguous among ${o.candidates.map(nodeRef).join(", ")}`;
  return "nothing";
}

function unusedMatchLines(r: Report, out: string[]): void {
  const provided = r.plan.assumes.clusterProvided;
  if (provided.length > 0)
    out.push(`  provided by every cluster (assumed, dated list): ${provided.map(nodeRef).join(", ")}`);
  for (const o of r.matchOverrides) {
    out.push(
      `  ${quote("match entry", o.keyPath, T)} overrides ${quote("host", o.host, T)}: extracted ${extractedText(o.extracted)}; declared ${nodeRef(o.declared)} (not verified)`,
    );
  }
  r.unusedMatches.forEach((m, i) => {
    out.push(
      `  unused match entry ${i + 1} of ${r.unusedMatches.length}  ${quote("key:", m.keyPath, T)}  ${quote("host:", m.host, T)}  ${quote("node:", m.node, T)}  (matched no host)`,
    );
  });
}

function aliasCount(r: Report): number {
  return r.repoMappings.filter((m) => m.from === "--repo-alias" && m.used).length;
}

function conflictLine(c: PlanConflict): string {
  if (c.kind === "sync-wave") {
    const hash = c.job.lastIndexOf("#");
    const owner = hash < 0 ? c.job : c.job.slice(0, hash);
    return `sync waves ${c.fromWave} to ${c.toWave} in what ${nodeRef(owner)} renders: on a cycle with hard dependencies (it or another dropped constraint of that cycle runs against one)`;
  }
  return `ordering edge ${nodeRef(c.from)} after ${nodeRef(c.to)}: on a cycle with hard dependencies (it or another dropped constraint of that cycle runs against one)`;
}

function stepNode(id: NodeId, waves: ReadonlyMap<NodeId, number | null>): string {
  const w = waves.get(id);
  return w === null || w === undefined ? nodeRef(id) : `${nodeRef(id)} (wave ${w})`;
}

function plan(r: Report, out: string[]): void {
  const p = r.plan;
  const unordered = p.listedUnordered.length;
  if (p.steps.length === 0) {
    const why =
      unordered > 0
        ? `no steps, because no node is startable; the ${plural(unordered, "node", "nodes")} not startable ${unordered === 1 ? "is" : "are"} listed above.`
        : "no steps, because the estate read has no node to start.";
    out.push(`Plan (${p.disclaimer}): ${why}`);
  } else {
    out.push(`Plan (${p.disclaimer}): ${plural(p.steps.length, "step", "steps")}`);
    const waves = new Map(r.nodes.map((n) => [n.id, n.syncWave]));
    const crankById = new Map(r.cranks.map((c) => [c.crank, c]));
    for (const s of p.steps) {
      if (s.kind === "crank") {
        const ref = s.ref === null ? "" : `  ${quote("ref:", s.ref, T)}`;
        out.push(`  step ${s.no}  manual  ${crankRef(s.crank ?? "", s.why)}${ref}`);
        if (s.nodes.length > 0) out.push(`    creates: ${s.nodes.map(nodeRef).join(", ")}`);
        const again = crankById.get(s.crank ?? "")?.alreadyCreated ?? 0;
        if (again > 0)
          out.push(`    names ${plural(again, "object", "objects")} already created by an earlier step or target`);
        for (const e of crankById.get(s.crank ?? "")?.reroutedEdges ?? [])
          out.push(`    reroutes: ${nodeRef(e.from)} to ${nodeRef(e.to)}`);
        continue;
      }
      out.push(`  step ${s.no}  start   ${s.nodes.map((n) => stepNode(n, waves)).join(", ")}`);
    }
    if (p.conflicts.length > 0) {
      out.push(`  ordering constraints dropped: ${p.conflicts.length}`);
      for (const c of p.conflicts) out.push(`    ${conflictLine(c)}`);
    }
    if (unordered > 0)
      out.push(
        `  not ordered: ${plural(unordered, "node", "nodes")} blocked or unverified, listed under Not startable from a cold start`,
      );
  }
  out.push(`  ${assumedLine(r)}`);
}

/** The plan's assumptions in one line (BR7.20), shared with --explain. */
export function assumedLine(r: Report): string {
  const a = r.plan.assumes;
  return `Assumed, not verified by crankpath: ${plural(a.externals.length, "external", "externals")} declared available; ${plural(a.servedBy.length, "external", "externals")} served by an in-estate node; ${plural(a.cranks.length, "crank", "cranks")} (documented); ${plural(a.matchEntries.length, "match entry", "match entries")}; ${plural(a.clusterProvided.length, "object", "objects")} every cluster provides;${aliasCount(r) > 0 ? ` ${plural(aliasCount(r), "repository", "repositories")} read through --repo-alias;` : ""}${a.argocdNamespace.length > 0 ? ` Argo CD's namespace taken to be ${a.argocdNamespace.map(nodeRef).join(", ")};` : ""} and the ${a.notModelled.length} not-modelled items below. Every start step is relative to these and to the edges read.`;
}

/** The closing lines: what was not verified, then the fixed not-modelled list (computed from the Report). */
export function closing(r: Report, out: string[]): void {
  const items = r.notVerified
    .filter((v) => v.item !== "declared-edges")
    .map((v) => notVerifiedPhrase(v.item, v.count, r));
  const declared = r.notVerified.find((v) => v.item === "declared-edges")?.count ?? 0;
  const list = items.length === 0 ? "nothing listed beyond the not-modelled items below" : items.join("; ");
  out.push(`Not verified: ${list}. Declared edges: ${declared} (unverified when present).`);
  out.push(`Not modelled (${r.notModelled.length} items): ${r.notModelled.join("; ")}.`);
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

/** The report's output lines at 80 columns, in the fixed order, without line ends. */
export function renderTextLines(r: Report): string[] {
  return wrapLines(textLogicalLines(r));
}

/** The report's logical lines before the 80-column layout (one per statement). */
export function textLogicalLines(r: Report): string[] {
  const out: string[] = [];
  header(r, out);
  if (r.runStatus.state === "NOTHING ANALYSED") {
    nothingAnalysed(r, out);
    return out;
  }
  toolchainLines(r, out);
  out.push(scannedLine(r));
  statusLines(r, out);
  toolMissingLines(r, out);
  out.push("");
  opacity(r, out);
  floatingLines(r, out);
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
