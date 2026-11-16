// GraphBuilder (U7; BR7.1, BR7.2, BR7.19, BR2.9): one graph from everything extracted and
// declared. Objects with one id become one node; two with one id and different content are a
// named conflict (flagged and listed, never merged silently). Declared edges are tagged `declared`
// and need both ends to exist (an unknown end is listed, no node is made). Externals are nodes. An
// extracted reference to an object no readable source defines keeps its edge to a stub flagged
// `not-defined` and is listed. Every collection is sorted, so the graph is the same however the
// inputs arrived.

import type { ConfigDocument } from "../u1-graph-model/declared-facts.js";
import type { ExtractResult, RenderedObject } from "../u1-graph-model/extractor.js";
import {
  type Edge,
  type ExternalNode,
  type GraphNode,
  makeEdge,
  type NodeFlag,
  type NodeId,
  type OpaqueMark,
  type Origin,
  parseNodeId,
} from "../u1-graph-model/graph-model.js";
import { compareCodePoints, compareTuples } from "../u1-graph-model/order.js";
import { type UnresolvedItem, unresolvedItem } from "../u1-graph-model/status-model.js";
import { isClusterProvided } from "./cluster-provided.js";

export interface EstateGraph {
  /** Every node (objects, stubs, externals), sorted by id. */
  readonly nodes: readonly GraphNode[];
  /** Sorted by (from, to, kind, source). */
  readonly edges: readonly Edge[];
  /** Sorted by id. */
  readonly externals: readonly ExternalNode[];
  /** Conflicts, stubs, declared edges with an unknown end, unspecified externals, extractor items; sorted. */
  readonly unresolved: readonly UnresolvedItem[];
}

export interface GraphInput {
  readonly objects: readonly RenderedObject[];
  readonly extracted: readonly ExtractResult[];
  readonly config: ConfigDocument;
  /** Opaque marks in precedence order: the first mark for a node is its one reason (BR3.15). */
  readonly opaque: readonly { readonly node: NodeId; readonly mark: OpaqueMark }[];
}

interface NodeDraft {
  id: NodeId;
  kind: string;
  namespace: string | null;
  name: string;
  origin: Origin;
  opaque: OpaqueMark | null;
  flags: Set<NodeFlag>;
  syncWave: number | null;
}

function compareOrigin(a: Origin, b: Origin): number {
  return (
    compareCodePoints(a.path ?? "", b.path ?? "") ||
    (a.document ?? 0) - (b.document ?? 0) ||
    compareCodePoints(a.renderJob ?? "", b.renderJob ?? "")
  );
}

export function compareEdges(a: Edge, b: Edge): number {
  return (
    compareTuples([a.from, a.to, a.kind, a.source], [b.from, b.to, b.kind, b.source]) ||
    compareTuples(
      [a.evidence.file, a.evidence.field, a.evidence.renderedPath],
      [b.evidence.file, b.evidence.field, b.evidence.renderedPath],
    )
  );
}

export function compareUnresolved(a: UnresolvedItem, b: UnresolvedItem): number {
  return compareTuples([a.subject, a.why, a.where, a.field ?? ""], [b.subject, b.why, b.where, b.field ?? ""]);
}

function freezeNode(d: NodeDraft): GraphNode {
  return Object.freeze({
    id: d.id,
    kind: d.kind,
    namespace: d.namespace,
    name: d.name,
    origin: d.origin,
    opaque: d.opaque,
    flags: Object.freeze([...d.flags].sort(compareCodePoints)),
    syncWave: d.syncWave,
  });
}

const NO_ORIGIN: Origin = Object.freeze({ renderJob: null, path: null, document: null });

export function buildGraph(input: GraphInput): EstateGraph {
  const drafts = new Map<NodeId, NodeDraft>();
  const digests = new Map<NodeId, string>();
  const unresolved: UnresolvedItem[] = [];

  const ordered = [...input.objects].sort((a, b) => compareCodePoints(a.id, b.id) || compareOrigin(a.origin, b.origin));
  for (const o of ordered) {
    const existing = drafts.get(o.id);
    if (existing === undefined) {
      drafts.set(o.id, {
        id: o.id,
        kind: o.kind,
        namespace: o.namespace,
        name: o.name,
        origin: o.origin,
        opaque: null,
        flags: new Set(),
        syncWave: null,
      });
      digests.set(o.id, o.digest);
      continue;
    }
    if (digests.get(o.id) !== o.digest && !existing.flags.has("conflicting-definitions")) {
      existing.flags.add("conflicting-definitions");
      unresolved.push(unresolvedItem(o.id, "conflicting-definitions", o.renderedPath, null));
    }
  }

  const externals = new Map<NodeId, ExternalNode>();
  for (const e of input.config.externals) {
    externals.set(e.id, Object.freeze({ id: e.id, name: e.name, coldStart: e.coldStart, servedBy: e.servedBy }));
    if (e.coldStart === "unspecified" && e.servedBy === null) {
      unresolved.push(unresolvedItem(e.id, "external-unspecified", input.config.file ?? "crankpath.yaml", e.keyPath));
    }
  }
  for (const r of input.extracted) {
    for (const e of r.externals) {
      if (externals.has(e.id)) continue;
      externals.set(e.id, Object.freeze({ id: e.id, name: e.name, coldStart: "unspecified", servedBy: null }));
      unresolved.push(unresolvedItem(e.id, "external-unspecified", "crankpath.yaml", null));
    }
    for (const n of r.nodes) {
      if (!drafts.has(n.id)) {
        drafts.set(n.id, { ...n, flags: new Set(n.flags), opaque: n.opaque, origin: n.origin });
      }
    }
  }
  for (const e of externals.values()) {
    const configured = input.config.externals.find((x) => x.id === e.id);
    drafts.set(e.id, {
      id: e.id,
      kind: "External",
      namespace: null,
      name: e.name,
      origin: configured ? Object.freeze({ renderJob: null, path: input.config.file, document: null }) : NO_ORIGIN,
      opaque: null,
      flags: new Set(),
      syncWave: null,
    });
  }
  for (const e of externals.values()) {
    if (e.servedBy !== null && !drafts.has(e.servedBy)) {
      const decl = input.config.externals.find((x) => x.id === e.id);
      unresolved.push(
        unresolvedItem(e.id, "served-by-missing", input.config.file ?? "crankpath.yaml", decl?.keyPath ?? null),
      );
    }
  }

  for (const r of input.extracted) {
    for (const f of r.flags) drafts.get(f.node)?.flags.add(f.flag);
    for (const w of r.syncWaves) {
      const d = drafts.get(w.node);
      if (d !== undefined) d.syncWave = w.wave;
    }
    for (const u of r.unresolved) unresolved.push(u);
  }
  for (const { node, mark } of input.opaque) {
    const d = drafts.get(node);
    if (d !== undefined && d.opaque === null) d.opaque = mark;
  }
  for (const r of input.extracted) {
    for (const { node, mark } of r.opaque) {
      const d = drafts.get(node);
      if (d !== undefined && d.opaque === null) d.opaque = mark;
    }
  }

  const edges = new Map<string, Edge>();
  const keep = (e: Edge) => {
    const key = `${e.from}\n${e.to}\n${e.kind}\n${e.source}`;
    const prior = edges.get(key);
    if (prior === undefined || compareEdges(e, prior) < 0) edges.set(key, e);
  };
  const extractedEdges = input.extracted.flatMap((r) => r.edges).sort(compareEdges);
  const stubbed = new Set<NodeId>();
  for (const e of extractedEdges) {
    for (const end of [e.from, e.to]) {
      if (drafts.has(end)) continue;
      const parsed = parseNodeId(end);
      if (parsed === undefined || parsed.external) continue;
      drafts.set(end, {
        id: end,
        kind: parsed.kind,
        namespace: parsed.namespace,
        name: parsed.name,
        origin: NO_ORIGIN,
        opaque: null,
        flags: new Set<NodeFlag>(["not-defined"]),
        syncWave: null,
      });
      if (!isClusterProvided(end) && !stubbed.has(end)) {
        stubbed.add(end);
        unresolved.push(unresolvedItem(end, "not-defined", e.evidence.renderedPath, e.evidence.field));
      }
    }
    keep(e);
  }
  input.config.edges.forEach((d) => {
    const missing = [d.from, d.to].filter((end) => !drafts.has(end));
    if (missing.length > 0) {
      for (const end of missing) {
        unresolved.push(
          unresolvedItem(end, "declared-edge-endpoint-missing", input.config.file ?? "crankpath.yaml", d.keyPath),
        );
      }
      return;
    }
    keep(
      makeEdge({
        from: d.from,
        to: d.to,
        kind: "depends-on",
        source: "declared",
        evidence: {
          file: input.config.file ?? "crankpath.yaml",
          field: d.keyPath,
          renderedPath: d.keyPath,
          line: null,
        },
      }),
    );
  });

  const seen = new Set<string>();
  const uniqueUnresolved = unresolved.sort(compareUnresolved).filter((u) => {
    const key = `${u.subject}\n${u.why}\n${u.where}\n${u.field ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return Object.freeze({
    nodes: Object.freeze([...drafts.values()].map(freezeNode).sort((a, b) => compareCodePoints(a.id, b.id))),
    edges: Object.freeze([...edges.values()].sort(compareEdges)),
    externals: Object.freeze([...externals.values()].sort((a, b) => compareCodePoints(a.id, b.id))),
    unresolved: Object.freeze(uniqueUnresolved),
  });
}
