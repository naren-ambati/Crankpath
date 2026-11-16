// ReportAssembler (U8; BR8.11, BR8.12, BR8.5, FR8.5): combines the graph, the analysis, the opacity
// of each source, skipped objects, unreadable files, toolchain and repo identity into one sorted
// Report. Counts are computed here once; the run status is derived from them (StatusModel) and the
// closing line's items are listed from them. Renderers format; they never count.

import path from "node:path";
import type { ConfigDocument, MatchRule } from "../u1-graph-model/declared-facts.js";
import type { MatchOverride } from "../u1-graph-model/extractor.js";
import type { NodeId, OpaqueMark, SkippedObject, UnreadableFile } from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import { redactUrl } from "../u1-graph-model/safe-text.js";
import {
  deriveRunStatus,
  type NodeStatusKind,
  type RunCounts,
  SOURCE_KINDS,
  type SourceKind,
} from "../u1-graph-model/status-model.js";
import type { ScannedRepo } from "../u2-intake-config/repo-identity.js";
import { type AnalysisResult, type HiddenCycle, NOT_MODELLED } from "../u7-graph-analysis/analysis.js";
import type { EstateGraph } from "../u7-graph-analysis/graph-builder.js";
import { BLOCKED_REASONS, UNVERIFIED_REASONS } from "../u7-graph-analysis/reachability.js";
import {
  NOT_VERIFIED_ITEMS,
  type NotStartableGroup,
  type RepoMappingEntry,
  type NotVerifiedItem,
  type OpaqueEntry,
  type Report,
  SCHEMA_VERSION,
} from "./report-model.js";

export const CRANKPATH_VERSION = "0.1.0";

export interface SourceOutcome {
  readonly kind: SourceKind;
  readonly node: NodeId | null;
  readonly kustomizeRoot: string | null;
  readonly mark: OpaqueMark | null;
}

export interface AssemblyInput {
  readonly scanned: ScannedRepo;
  readonly scannedPath: string;
  readonly graph: EstateGraph;
  readonly analysis: AnalysisResult;
  readonly config: ConfigDocument;
  readonly sources: readonly SourceOutcome[];
  readonly skipped: readonly SkippedObject[];
  readonly unreadable: readonly UnreadableFile[];
  readonly ignoredFiles: number;
  readonly droppedHooks: number;
  readonly timeouts: number;
  /** What the run's memory budget refused (all zero when it was not reached). */
  readonly limits: { readonly refusedFiles: number; readonly refusedJobs: number; readonly droppedEdges: number };
  /** `match:` entries that matched no host (from the run's HostMatcher). */
  readonly unusedMatches?: readonly MatchRule[];
  /** Hosts a `match:` entry resolved otherwise than the extracted rules. */
  readonly matchOverrides?: readonly MatchOverride[];
  /** Cycles the overrides hide. */
  readonly hiddenCycles?: readonly HiddenCycle[];
  /** Repository mappings and whether a source was read through each. */
  readonly repoMappings?: readonly RepoMappingEntry[];
}

const REASON_ORDER: readonly string[] = [...BLOCKED_REASONS, ...UNVERIFIED_REASONS];

function compareSkipped(a: SkippedObject, b: SkippedObject): number {
  return (
    compareCodePoints(a.file, b.file) ||
    a.document - b.document ||
    (a.item ?? -1) - (b.item ?? -1) ||
    compareCodePoints(a.renderJob ?? "", b.renderJob ?? "")
  );
}

export function assembleReport(input: AssemblyInput): Report {
  const { graph, analysis, config } = input;
  const byKind = Object.fromEntries(SOURCE_KINDS.map((k) => [k, 0])) as Record<SourceKind, number>;
  for (const s of input.sources) byKind[s.kind] += 1;
  const opaque: OpaqueEntry[] = input.sources
    .filter((s): s is SourceOutcome & { mark: OpaqueMark } => s.mark !== null)
    .map((s) => Object.freeze({ ...s.mark, node: s.node, kustomizeRoot: s.kustomizeRoot, sourceKind: s.kind }))
    .sort((a, b) => compareCodePoints(a.node ?? a.kustomizeRoot ?? "", b.node ?? b.kustomizeRoot ?? ""));
  // The analysis's list is the final one (it drops stubs a crank creates and adds crank items).
  const unresolved = analysis.unresolved;
  const skipped = [...input.skipped].sort(compareSkipped);
  const unreadableByPath = new Map<string, UnreadableFile>();
  for (const u of input.unreadable) if (!unreadableByPath.has(u.path)) unreadableByPath.set(u.path, u);
  const unreadable = [...unreadableByPath.values()].sort((a, b) => compareCodePoints(a.path, b.path));
  // Declared facts (lead decision after the B4 merge): those that change the extracted graph are a
  // gap; those the plan assumes are listed and counted, never a gap by themselves.
  const overrides = input.matchOverrides ?? [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const repoMappings = [...(input.repoMappings ?? [])]
    .map((m) => Object.freeze({ ...m, url: redactUrl(m.url) ?? "unparseable URL" }))
    .sort((a, b) => compareCodePoints(a.from, b.from) || compareCodePoints(a.url, b.url));
  const mappingsRelied = repoMappings.filter((m) => m.from === "crankpath.yaml" && m.used).length;
  const declaredFacts =
    mappingsRelied +
    new Set(overrides.map((o) => o.keyPath)).size +
    config.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)).length;
  const declaredAssumptions =
    config.externals.filter((e) => e.coldStart !== "unspecified" || e.servedBy !== null).length +
    analysis.crankEffects.filter((c) => c.matched).length;
  const counts: RunCounts = Object.freeze({
    sourcesFound: input.sources.length,
    sourcesByKind: Object.freeze(byKind),
    rendered: input.sources.length - opaque.length,
    opaque: opaque.length,
    opaqueApplicationSets: opaque.filter((o) => o.sourceKind === "ApplicationSet").length,
    unresolved: unresolved.length,
    skipped: skipped.length,
    skippedSources: skipped.filter((s) => s.source).length,
    unreadableFiles: unreadable.length,
    ignoredFiles: input.ignoredFiles,
    droppedHooks: input.droppedHooks,
    foreignDestination: graph.nodes.filter((n) => n.flags.includes("foreign-destination")).length,
    runLimitFiles: input.limits.refusedFiles,
    runLimitJobs: input.limits.refusedJobs,
    runLimitEdges: input.limits.droppedEdges,
    timeouts: input.timeouts,
    edgesExtracted: graph.edges.filter((e) => e.source === "extracted").length,
    edgesDeclared: graph.edges.filter((e) => e.source === "declared").length,
    nodes: graph.nodes.length,
    declaredFacts,
    declaredAssumptions,
  });
  const runStatus = deriveRunStatus(counts, analysis.notComputed);
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const estate = analysis.verdicts.filter((v) => kindOf.get(v.node) !== "External");
  const statusCounts: Record<NodeStatusKind, number> = { startable: 0, blocked: 0, unverified: 0 };
  for (const v of estate) statusCounts[v.status] += 1;
  const cycleLabels = new Map(
    analysis.cycles.map((c) => [c.id, c.introducedBy.length > 0 ? `${c.label}, introduced by a reroute` : c.label]),
  );
  const groups = new Map<
    string,
    {
      status: "blocked" | "unverified";
      reason: string;
      blocker: string;
      cycleLabel: string | null;
      nodes: { node: NodeId; via: NodeId | null }[];
    }
  >();
  for (const v of estate) {
    if (v.status === "startable" || v.reason === null) continue;
    const blocker = v.blockers[0] as string;
    const key = `${v.status}\n${v.reason}\n${blocker}`;
    const g = groups.get(key) ?? {
      status: v.status,
      reason: v.reason,
      blocker,
      cycleLabel: v.reason === "cycle" ? (cycleLabels.get(blocker) ?? null) : null,
      nodes: [],
    };
    g.nodes.push({ node: v.node, via: v.via });
    groups.set(key, g);
  }
  const notStartable = [...groups.values()]
    .sort(
      (a, b) =>
        (a.status === b.status ? 0 : a.status === "blocked" ? -1 : 1) ||
        REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason) ||
        compareCodePoints(a.blocker, b.blocker),
    )
    .map((g) =>
      Object.freeze({
        ...g,
        nodes: Object.freeze(g.nodes.sort((x, y) => compareCodePoints(x.node, y.node)).map((n) => Object.freeze(n))),
      }),
    ) as NotStartableGroup[];
  const value: Record<NotVerifiedItem, number> = {
    "opaque-sources": counts.opaque,
    "unreadable-files": counts.unreadableFiles,
    "skipped-objects": counts.skipped,
    "foreign-destination-objects": counts.foreignDestination,
    "run-limit": counts.runLimitFiles + counts.runLimitJobs + counts.runLimitEdges,
    "unresolved-items": counts.unresolved,
    timeouts: counts.timeouts,
    "uncranked-cycles": analysis.cycles.filter((c) => c.label !== "cranked").length,
    "unverified-nodes": statusCounts.unverified,
    "unspecified-externals": graph.externals.filter((e) => e.coldStart === "unspecified" && e.servedBy === null).length,
    "externals-declared": config.externals.filter((e) => e.coldStart !== "unspecified" || e.servedBy !== null).length,
    "cranks-documented": analysis.crankEffects.filter((c) => c.matched).length,
    "match-entries-relied": new Set(overrides.map((o) => o.keyPath)).size,
    "repo-mappings": mappingsRelied,
    "match-unused": (input.unusedMatches ?? []).length,
    "cluster-provided": analysis.plan.assumes.clusterProvided.length,
    "clusters-not-used": config.clusters.length,
    "fetch-not-used": config.repos.filter((r) => r.fetch).length,
    "not-computed": analysis.notComputed.length,
    "declared-edges": counts.edgesDeclared,
  };
  const notVerified = NOT_VERIFIED_ITEMS.filter((i) => i === "declared-edges" || value[i] > 0).map((item) =>
    Object.freeze({ item, count: value[item] }),
  );
  const url = input.scanned.url === null ? null : (redactUrl(input.scanned.url) ?? null);
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    repo: Object.freeze({
      url,
      urlFrom: input.scanned.from,
      comparable: input.scanned.normalised !== null,
      commit: null,
      floating: false,
    }),
    toolchain: Object.freeze({ crankpath: CRANKPATH_VERSION, helm: null, kustomize: null, tested: false }),
    runStatus,
    nodes: graph.nodes,
    edges: graph.edges,
    opaque: Object.freeze(opaque),
    cycles: analysis.cycles,
    statuses: analysis.verdicts,
    statusCounts: Object.freeze(statusCounts),
    notStartable: Object.freeze(notStartable),
    externals: graph.externals,
    plan: analysis.plan,
    cranks: analysis.crankEffects,
    unusedMatches: Object.freeze([...(input.unusedMatches ?? [])]),
    matchOverrides: Object.freeze([...overrides]),
    hiddenCycles: Object.freeze([...(input.hiddenCycles ?? [])]),
    repoMappings: Object.freeze(repoMappings),
    unresolved: Object.freeze(unresolved),
    skipped: Object.freeze(skipped),
    unreadable: Object.freeze(unreadable),
    notComputed: analysis.notComputed,
    notModelled: NOT_MODELLED,
    notVerified: Object.freeze(notVerified),
    scannedPath: path.isAbsolute(input.scannedPath) ? path.basename(input.scannedPath) : input.scannedPath,
    scannedPathAbsolute: path.isAbsolute(input.scannedPath),
    cranksDeclared: config.cranks.length,
  });
}
