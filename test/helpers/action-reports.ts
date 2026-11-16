// Report builders for the Action's tests: the thin slice's committed JSON with fields replaced, so
// every input has the shape the CLI writes.

import fs from "node:fs";
import { type ActionReport, readReport } from "../../action/base-head-differ.mjs";

export const THIN = JSON.parse(
  fs.readFileSync(new URL("../fixtures/thin-slice/expected.json", import.meta.url), "utf8"),
);

export type Json = Record<string, unknown>;
export interface E {
  from: string;
  to: string;
  kind: string;
  source?: string;
}

export function edge(e: E, file = "apps/a.yaml"): Json {
  return {
    evidence: { field: "spec.x", file, line: null, renderedPath: `${file}#1` },
    from: e.from,
    kind: e.kind,
    orderingOnly: false,
    source: e.source ?? "extracted",
    to: e.to,
  };
}

export function cycle(id: string, edges: E[], label = "extracted", extra: Json = {}): Json {
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort();
  return {
    crankedBy: [],
    edges: edges.map((e) => ({ from: e.from, kind: e.kind, source: e.source ?? "extracted", to: e.to })),
    id,
    introducedBy: [],
    label,
    labelBeforeCranks: label === "cranked" ? "extracted" : label,
    nodes,
    representative: nodes,
    residual: null,
    residualLabel: null,
    touchedBy: [],
    ...extra,
  };
}

export function report(parts: Json = {}, counts: Json = {}, run: Json = {}): Json {
  const r = structuredClone(THIN) as Json;
  const rs = r.runStatus as Json;
  Object.assign(rs, { state: "ANALYSED", reasons: [], floor: false, ...run });
  Object.assign(rs.counts as Json, {
    opaque: 0,
    skipped: 0,
    unresolved: 0,
    unreadableFiles: 0,
    timeouts: 0,
    ...counts,
  });
  return Object.assign(
    r,
    { cycles: [], edges: [], cranks: [], externals: [], hiddenCycles: [], matchOverrides: [], repoMappings: [] },
    parts,
  );
}

export function read(r: Json): ActionReport {
  const out = readReport(r);
  if (out === undefined) throw new Error("test report not readable");
  return out;
}

export const A = "Application/argocd/gitea";
export const S = "Service/gitea/gitea-http";
export const D = "Deployment/gitea/gitea";
export const RING: E[] = [
  { from: A, to: S, kind: "reads-source" },
  { from: S, to: D, kind: "selects" },
  { from: D, to: A, kind: "deployed-by" },
];
export const RING_REPORT = (label = "extracted", extra: Json = {}, more: Json = {}) =>
  report({ edges: RING.map((e) => edge(e)), cycles: [cycle("c-ring", RING, label, extra)], ...more });
