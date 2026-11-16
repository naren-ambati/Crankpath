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
    toolchain: { ...r.toolchain },
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
      nodes: [...c.nodes],
      edges: c.edges.map((e) => ({ ...e })),
      representative: [...c.representative],
      residual: c.residual === null ? null : [...c.residual],
      crankedBy: [...c.crankedBy],
    })),
    statuses:
      r.statuses === null
        ? null
        : r.statuses.map((s) => ({ node: s.node, status: s.status, blockers: [...s.blockers] })),
    externals: r.externals.map((e) => ({ id: e.id, coldStart: e.coldStart, servedBy: e.servedBy })),
    plan:
      r.plan === null
        ? null
        : {
            assumes: {
              externals: [...r.plan.assumes.externals],
              cranks: [...r.plan.assumes.cranks],
              notModelled: [...r.plan.assumes.notModelled],
            },
            steps: r.plan.steps.map((s) => ({ ...s, nodes: [...s.nodes] })),
            conflicts: [...r.plan.conflicts],
            disclaimer: r.plan.disclaimer,
            listedUnordered: r.plan.listedUnordered.map((l) => ({ ...l })),
          },
    unresolved: r.unresolved.map((u) => ({
      subject: u.subject,
      why: u.why,
      where: u.where,
      field: u.field,
      candidates: [...u.candidates],
      candidatesTruncated: u.candidatesTruncated,
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
