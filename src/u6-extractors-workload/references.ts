// Shared pieces of the reference extractors (U6, and U5's FluxExtractor): evidence from a rendered
// object, an edge to a named object that is refused (and listed as `invalid-reference`) when the
// name is not Kubernetes name syntax, the node of an object another object produces (a Secret an
// ExternalSecret or a Certificate writes), and a bounded walk of an `auth` block for its Secret and
// ServiceAccount references. Pure: no I/O, nothing kept between calls.

import { type DataValue, getPath, isDataMap, type RenderedObject } from "../u1-graph-model/extractor.js";
import {
  type Edge,
  type EdgeKind,
  type Evidence,
  type GraphNode,
  makeEdge,
  type NodeId,
  objectId,
} from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import { type UnresolvedItem, unresolvedItem } from "../u1-graph-model/status-model.js";

/** The evidence of a claim read from one field of a rendered object. */
export function evidenceOf(object: RenderedObject, field: string): Evidence {
  return { file: object.origin.path ?? object.renderedPath, field, renderedPath: object.renderedPath, line: null };
}

/** An extracted edge from `object` to `to`, with the object's field as evidence. */
export function edgeFrom(object: RenderedObject, to: NodeId, kind: EdgeKind, field: string): Edge {
  return makeEdge({ from: object.id, to, kind, source: "extracted", evidence: evidenceOf(object, field) });
}

/** Where a reference's result goes: edges and unresolved items of one extractor run. */
export interface Sink {
  readonly edges: Edge[];
  readonly unresolved: UnresolvedItem[];
}

/**
 * An edge from `object` to the `targetKind` object named `name` in `namespace` (ignored for a
 * cluster-scoped kind). A missing name is no edge; a name that is not Kubernetes syntax is no edge
 * and an `invalid-reference` item quoting it. Returns the target id when an edge was made.
 */
export function referTo(
  sink: Sink,
  object: RenderedObject,
  kind: EdgeKind,
  targetKind: string,
  namespace: string | null,
  name: DataValue | undefined,
  field: string,
): NodeId | null {
  if (name === undefined || name === null) return null;
  if (typeof name !== "string") {
    sink.unresolved.push(unresolvedItem(String(name), "invalid-reference", object.renderedPath, field));
    return null;
  }
  const id = objectId(targetKind, namespace, name);
  if (!id.ok) {
    sink.unresolved.push(unresolvedItem(name, "invalid-reference", object.renderedPath, field));
    return null;
  }
  sink.edges.push(edgeFrom(object, id.id, kind, field));
  return id.id;
}

/** The node of an object that `producer` writes (its origin is the producer's), or null for a bad name. */
export function producedNode(producer: RenderedObject, kind: string, name: string): GraphNode | null {
  const id = objectId(kind, producer.namespace, name);
  if (!id.ok) return null;
  return Object.freeze({
    id: id.id,
    kind: id.kind,
    namespace: id.namespace,
    name: id.name,
    origin: producer.origin,
    opaque: null,
    flags: Object.freeze([]),
    syncWave: null,
  });
}

export interface AuthRef {
  readonly targetKind: "Secret" | "ServiceAccount" | "ConfigMap";
  readonly name: DataValue | undefined;
  /** The reference's own `namespace` field, when it has one (repo text). */
  readonly namespace: DataValue | undefined;
  readonly field: string;
}

// The reference shapes of the secrets-operator and cert-manager APIs: a key ending in `SecretRef`
// (or `secretRef`) holds a Secret selector, one ending in `serviceAccountRef` a ServiceAccount
// selector; both carry `name` and, for cluster-scoped owners, `namespace`. A `caProvider` names a
// Secret or a ConfigMap by `type`. Nothing else in the block is read (BR6.16).
const SECRET_REF = /(?:^s|S)ecretRef$/;
const SA_REF = /(?:^s|S)erviceAccountRef$/;
/** The deepest auth block the walk reads: the APIs nest a selector at most four levels down. */
const AUTH_WALK_DEPTH = 6;

/**
 * Every Secret and ServiceAccount reference inside an auth block, found by key name, in a fixed
 * order (field path). The walk is iterative and bounded by depth, so a hostile block cannot run
 * the stack out or loop.
 */
export function authReferences(block: DataValue | undefined, at: string): AuthRef[] {
  const out: AuthRef[] = [];
  const stack: { value: DataValue; path: string; depth: number }[] = [];
  if (block !== undefined) stack.push({ value: block, path: at, depth: 0 });
  while (stack.length > 0) {
    const { value, path, depth } = stack.pop() as { value: DataValue; path: string; depth: number };
    if (depth > AUTH_WALK_DEPTH) continue;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        stack.push({ value: v, path: `${path}[${i}]`, depth: depth + 1 });
      });
      continue;
    }
    if (!isDataMap(value)) continue;
    for (const key of Object.keys(value)) {
      const v = value[key] as DataValue;
      const field = `${path}.${key}`;
      // A selector has a `name`; a key of that shape without one (aws `auth.secretRef`) groups
      // selectors, so the walk goes into it.
      const selector = isDataMap(v) && Object.hasOwn(v, "name");
      if (selector && SECRET_REF.test(key)) {
        out.push({ targetKind: "Secret", name: v.name, namespace: v.namespace, field: `${field}.name` });
      } else if (selector && SA_REF.test(key)) {
        out.push({ targetKind: "ServiceAccount", name: v.name, namespace: v.namespace, field: `${field}.name` });
      } else if (isDataMap(v) && key === "caProvider") {
        const type = getPath(v, ["type"]);
        if (type === "Secret" || type === "ConfigMap") {
          out.push({ targetKind: type, name: v.name, namespace: v.namespace, field: `${field}.name` });
        }
      } else if (typeof v === "object" && v !== null) {
        stack.push({ value: v, path: field, depth: depth + 1 });
      }
    }
  }
  return out.sort((a, b) => compareCodePoints(a.field, b.field));
}

/** The edge kind for a reference to an object of this kind. */
export function kindOfReference(targetKind: AuthRef["targetKind"]): EdgeKind {
  return targetKind === "Secret" ? "needs-secret" : targetKind === "ConfigMap" ? "needs-config" : "runs-as";
}
