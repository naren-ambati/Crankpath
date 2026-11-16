// JsonRenderer (U8, contract C7; BR8.1 to BR8.3, FR8.1, NFR2): the stable JSON contract. The byte
// layout, chosen in B1 and pinned by the thin-slice expected output: keys sorted in code-point
// order at every level, arrays in the Report's defined order, two-space indentation, one trailing
// newline; no timestamp, absolute path or machine name. Every string value passes SafeText's JSON
// form (visible codes for control and format characters, the length cut), so repo text arrives as
// data, never as terminal control. The projection below is the contract: a field is in the JSON
// because it is listed here.

import { jsonText } from "../u1-graph-model/safe-text.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import type { Report } from "./report-model.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function project(report: Report): Json {
  const r = report;
  return {
    schemaVersion: r.schemaVersion,
    repo: { url: r.repo.url, urlFrom: r.repo.urlFrom, commit: r.repo.commit, floating: r.repo.floating },
    toolchain: {
      crankpath: r.toolchain.crankpath,
      helm: r.toolchain.helm,
      kustomize: r.toolchain.kustomize,
      tested: r.toolchain.tested,
      testedPair: { ...r.toolchain.testedPair },
      missing: [...r.toolchain.missing],
      unrecognised: [...r.toolchain.unrecognised],
    },
    floating: r.floating.map((f) => ({ node: f.node, field: f.field, value: f.value, resolved: f.resolved })),
    undeployedKustomizeRoots: [...r.undeployedKustomizeRoots],
    toolMissing: { ...r.toolMissing },
    runStatus: {
      state: r.runStatus.state,
      reasons: [...r.runStatus.reasons],
      floor: r.runStatus.floor,
      counts: { ...r.runStatus.counts, sourcesByKind: { ...r.runStatus.counts.sourcesByKind } },
    },
    nodes: r.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      namespace: n.namespace,
      name: n.name,
      origin: { renderJob: n.origin.renderJob, path: n.origin.path, document: n.origin.document },
      opaque:
        n.opaque === null
          ? null
          : {
              reason: n.opaque.reason,
              detail: n.opaque.detail,
              field: n.opaque.field,
              value: n.opaque.value,
              lostEdges: [...n.opaque.lostEdges],
              suggestion: n.opaque.suggestion === null ? null : { ...n.opaque.suggestion },
            },
      flags: [...n.flags],
      syncWave: n.syncWave,
    })),
    edges: r.edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      source: e.source,
      orderingOnly: e.orderingOnly,
      evidence: { ...e.evidence },
    })),
    opaque: r.opaque.map((o) => ({
      node: o.node,
      kustomizeRoot: o.kustomizeRoot,
      reason: o.reason,
      detail: o.detail,
      field: o.field,
      value: o.value,
      lostEdges: [...o.lostEdges],
      suggestion: o.suggestion === null ? null : { ...o.suggestion },
    })),
    cycles: r.cycles.map((c) => ({
      id: c.id,
      label: c.label,
      labelBeforeCranks: c.labelBeforeCranks,
      nodes: [...c.nodes],
      edges: c.edges.map((e) => ({ ...e })),
      representative: [...c.representative],
      residual: c.residual === null ? null : [...c.residual],
      residualLabel: c.residualLabel,
      crankedBy: [...c.crankedBy],
      touchedBy: [...c.touchedBy],
      introducedBy: [...c.introducedBy],
    })),
    statuses: r.statuses.map((s) => ({
      node: s.node,
      status: s.status,
      reason: s.reason,
      blockers: [...s.blockers],
      via: s.via,
    })),
    statusCounts: { ...r.statusCounts },
    externals: r.externals.map((e) => ({ id: e.id, coldStart: e.coldStart, servedBy: e.servedBy })),
    cranks: r.cranks.map((c) => ({
      id: c.crank,
      by: c.by,
      ref: c.ref,
      keyPath: c.keyPath,
      matched: c.matched,
      createdNodes: [...c.createdNodes],
      alreadyCreated: c.alreadyCreated,
      reroutedEdges: c.reroutedEdges.map((e) => ({ from: e.from, to: e.to })),
      removedEdges: c.removedEdges,
    })),
    unusedMatches: r.unusedMatches.map((m) => ({ keyPath: m.keyPath, host: m.host, node: m.node })),
    matchOverrides: r.matchOverrides.map((o) => ({
      keyPath: o.keyPath,
      host: o.host,
      extracted: { outcome: o.extracted.outcome, node: o.extracted.node, candidates: [...o.extracted.candidates] },
      declared: o.declared,
    })),
    repoMappings: r.repoMappings.map((m) => ({
      url: m.url,
      root: m.root,
      from: m.from,
      used: m.used,
      commit: m.commit ?? null,
      floating: m.floating ?? false,
      failure: m.failure ?? null,
    })),
    clustersUsed: [...r.clustersUsed],
    hiddenCycles: r.hiddenCycles.map((h) => ({
      id: h.id,
      label: h.label,
      nodes: h.nodes,
      edges: h.edges,
      nodeIds: [...h.nodeIds],
      hiddenBy: [...h.hiddenBy],
    })),
    plan: {
      assumes: {
        externals: [...r.plan.assumes.externals],
        cranks: [...r.plan.assumes.cranks],
        clusterProvided: [...r.plan.assumes.clusterProvided],
        servedBy: [...r.plan.assumes.servedBy],
        matchEntries: [...r.plan.assumes.matchEntries],
        argocdNamespace: [...r.plan.assumes.argocdNamespace],
        notModelled: [...r.plan.assumes.notModelled],
      },
      steps: r.plan.steps.map((st) => ({
        no: st.no,
        kind: st.kind,
        nodes: [...st.nodes],
        manual: st.manual,
        why: st.why,
        crank: st.crank,
        ref: st.ref,
      })),
      conflicts: r.plan.conflicts.map((c) =>
        c.kind === "sync-wave"
          ? { kind: c.kind, job: c.job, fromWave: c.fromWave, toWave: c.toWave, from: null, to: null }
          : { kind: c.kind, job: null, fromWave: null, toWave: null, from: c.from, to: c.to },
      ),
      disclaimer: r.plan.disclaimer,
      listedUnordered: r.plan.listedUnordered.map((l) => ({
        node: l.node,
        status: l.status,
        reason: l.reason,
        blockers: [...l.blockers],
      })),
    },
    unresolved: r.unresolved.map((u) => ({
      subject: u.subject,
      why: u.why,
      where: u.where,
      field: u.field,
      candidates: [...u.candidates],
      candidatesTruncated: u.candidatesTruncated,
      owner: u.owner,
      value: u.value,
    })),
    skipped: r.skipped.map((s) => ({ ...s })),
    unreadable: r.unreadable.map((u) => ({ ...u })),
    notComputed: [...r.notComputed],
    notModelled: [...r.notModelled],
    notVerified: r.notVerified.map((v) => ({ item: v.item, count: v.count })),
  };
}

/** Sorts keys at every level and passes every string through SafeText's JSON form (the Report is shallow). */
function canonical(value: Json): Json {
  if (typeof value === "string") return jsonText(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  const out: { [key: string]: Json } = {};
  for (const k of Object.keys(value).sort(compareCodePoints)) {
    Object.defineProperty(out, k, { value: canonical(value[k] as Json), enumerable: true });
  }
  return out;
}

/** Chunks written at most this long (characters): a bound on one write, not on the document. */
const CHUNK = 1024;

/**
 * Writes the JSON in bounded chunks, byte-identical to `JSON.stringify(value, null, 2)` plus one
 * newline, so no single string ever holds the whole document: a report of any size can be written
 * without reaching the runtime's string-length ceiling (B1 review M3).
 */
export function writeJson(report: Report, write: (chunk: string) => void): void {
  let buffer = "";
  const emit = (text: string) => {
    buffer += text;
    if (buffer.length >= CHUNK) {
      write(buffer);
      buffer = "";
    }
  };
  const value = canonical(project(report));
  // An explicit stack of work items: a value to write at an indent, or literal text.
  const stack: ({ v: Json; indent: string } | string)[] = [{ v: value, indent: "" }];
  while (stack.length > 0) {
    const item = stack.pop() as { v: Json; indent: string } | string;
    if (typeof item === "string") {
      emit(item);
      continue;
    }
    const { v, indent } = item;
    if (v === null || typeof v !== "object") {
      emit(JSON.stringify(v));
      continue;
    }
    const inner = `${indent}  `;
    const entries: [string | null, Json][] = Array.isArray(v) ? v.map((x) => [null, x]) : Object.entries(v);
    if (entries.length === 0) {
      emit(Array.isArray(v) ? "[]" : "{}");
      continue;
    }
    const close = `\n${indent}${Array.isArray(v) ? "]" : "}"}`;
    const parts: ({ v: Json; indent: string } | string)[] = [Array.isArray(v) ? "[" : "{"];
    entries.forEach(([k, x], i) => {
      parts.push(`${i === 0 ? "" : ","}\n${inner}${k === null ? "" : `${JSON.stringify(k)}: `}`);
      parts.push({ v: x, indent: inner });
    });
    parts.push(close);
    for (let i = parts.length - 1; i >= 0; i--) stack.push(parts[i] as { v: Json; indent: string } | string);
  }
  emit("\n");
  if (buffer.length > 0) write(buffer);
}

/** The whole JSON as one string (tests and the library); the CLI streams with writeJson. */
export function renderJson(report: Report): string {
  const chunks: string[] = [];
  writeJson(report, (c) => chunks.push(c));
  return chunks.join("");
}
