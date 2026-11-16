// Test helpers: synthetic estate graphs for the analysis (U7), built from the real GraphModel
// constructors, so every edge has evidence and every id is canonical.

import type { ConfigDocument, CrankDecl, CrankTarget, ExternalDecl } from "../../src/u1-graph-model/declared-facts.js";
import { NO_DECLARED_FACTS } from "../../src/u1-graph-model/declared-facts.js";
import {
  type Edge,
  type EdgeKind,
  type EdgeSource,
  type ExternalNode,
  type GraphNode,
  makeEdge,
  makeOpaqueMark,
  type NodeFlag,
  type NodeId,
  parseNodeId,
} from "../../src/u1-graph-model/graph-model.js";
import { compareCodePoints } from "../../src/u1-graph-model/order.js";
import type { UnresolvedItem } from "../../src/u1-graph-model/status-model.js";
import { compareEdges, type EstateGraph } from "../../src/u7-graph-analysis/graph-builder.js";

/** `ConfigMap/ns/<name>`: a namespaced id for a short name. */
export const n = (name: string | number): NodeId => `ConfigMap/ns/${name}`;

export interface NodeOptions {
  readonly opaque?: boolean;
  readonly flags?: readonly NodeFlag[];
  readonly path?: string | null;
  readonly job?: string | null;
  readonly wave?: number | null;
}

export function node(id: NodeId, o: NodeOptions = {}): GraphNode {
  const p = parseNodeId(id);
  if (p === undefined) throw new Error(`test helper: not an id: ${id}`);
  return Object.freeze({
    id,
    kind: p.external ? "External" : p.kind,
    namespace: p.external ? null : p.namespace,
    name: p.name,
    origin: Object.freeze({ renderJob: o.job ?? null, path: o.path ?? null, document: o.path ? 1 : null }),
    opaque: o.opaque
      ? makeOpaqueMark({ reason: "unreadable-file", lostEdges: ["objects under its source path"] })
      : null,
    flags: Object.freeze([...(o.flags ?? [])]),
    syncWave: o.wave ?? null,
  });
}

export interface EdgeOptions {
  readonly kind?: EdgeKind;
  readonly source?: EdgeSource;
  readonly orderingOnly?: boolean;
}

/** `from` needs `to`. */
export function edge(from: NodeId, to: NodeId, o: EdgeOptions = {}): Edge {
  return makeEdge({
    from,
    to,
    kind: o.kind ?? "depends-on",
    source: o.source ?? "extracted",
    orderingOnly: o.orderingOnly ?? false,
    evidence: { file: "f.yaml", field: "spec.x", renderedPath: "f.yaml#1", line: null },
  });
}

export function external(
  name: string,
  coldStart: ExternalNode["coldStart"],
  servedBy: NodeId | null = null,
): ExternalNode {
  return Object.freeze({ id: `external:${name}`, name, coldStart, servedBy });
}

export interface GraphParts {
  readonly nodes: readonly GraphNode[];
  readonly edges?: readonly Edge[];
  readonly externals?: readonly ExternalNode[];
  readonly unresolved?: readonly UnresolvedItem[];
}

/** An EstateGraph from parts: externals become nodes; every collection sorted as GraphBuilder sorts it. */
export function graph(parts: GraphParts): EstateGraph {
  const externals = [...(parts.externals ?? [])].sort((a, b) => compareCodePoints(a.id, b.id));
  const nodes = [...parts.nodes, ...externals.map((e) => node(e.id))].sort((a, b) => compareCodePoints(a.id, b.id));
  return Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze([...(parts.edges ?? [])].sort(compareEdges)),
    externals: Object.freeze(externals),
    unresolved: Object.freeze([...(parts.unresolved ?? [])]),
  });
}

export function crank(
  position: number,
  creates: readonly (NodeId | { readonly render: string })[],
  reroutes: readonly { readonly node: NodeId; readonly to: string }[] = [],
  by = `step ${position}`,
): CrankDecl {
  const targets: CrankTarget[] = creates.map((c) =>
    typeof c === "string" ? { kind: "node", node: c } : { kind: "render", path: c.render },
  );
  return Object.freeze({
    id: `crank:${position}`,
    creates: targets,
    reroutes,
    by,
    ref: null,
    keyPath: `cranks[${position - 1}]`,
  });
}

export function facts(parts: Partial<ConfigDocument> = {}): ConfigDocument {
  return { ...NO_DECLARED_FACTS, file: "crankpath.yaml", ...parts };
}

export function externalDecl(
  name: string,
  coldStart: ExternalDecl["coldStart"],
  servedBy: NodeId | null = null,
): ExternalDecl {
  return { name, id: `external:${name}`, coldStart, servedBy, keyPath: `external.${name}` };
}
