// GraphModel (U1, contract C1; BR1.1 to BR1.3): nodes, edges, evidence, opaque marks and externals,
// with canonical ids and the construction invariants. The id functions here are the only way any
// unit makes a node id, so a name that is not a Kubernetes name can never forge another node's id:
// it is refused, and the caller skips and names the object.
//
// Edge direction (ADR-003): an edge points from the dependent to what it needs, so `deployed-by`
// points from a rendered object to its Application.

/** A canonical node id: `Kind/namespace/name`, cluster-scoped `Kind/name`, or `external:<name>`. */
export type NodeId = string;

export const EDGE_KINDS = Object.freeze([
  "deployed-by",
  "generated-by",
  "reads-source",
  "needs-credential",
  "needs-secret",
  "needs-config",
  "produced-by",
  "uses-store",
  "issued-by",
  "selects",
  "runs-as",
  "seals-with",
  "assumes-identity",
  "depends-on",
  "rerouted",
] as const);
export type EdgeKind = (typeof EDGE_KINDS)[number];

export type EdgeSource = "extracted" | "declared";

/**
 * The fixed opacity reasons (FR4.1) plus `not-in-this-build`: a source kind this build does not
 * render or expand yet (Helm, Kustomize, ApplicationSet generators, Flux objects). Each later bolt
 * stops producing it for what it adds; the last one removes it from this list.
 */
export const OPAQUE_REASONS = Object.freeze([
  "unreadable-repo",
  "private-chart",
  "encrypted-values",
  "cluster-created-values",
  "cluster-inputs-missing",
  "unsupported-template",
  "unsupported-field",
  "tool-missing",
  "render-failed",
  "limit",
  "offline",
  "remote-base",
  "foreign-destination",
  "unreadable-file",
  "not-in-this-build",
] as const);
export type OpaqueReason = (typeof OPAQUE_REASONS)[number];

/** Node flags (C1): fixed words, sorted on output. */
export const NODE_FLAGS = Object.freeze(["conflicting-definitions", "foreign-destination", "not-defined"] as const);
export type NodeFlag = (typeof NODE_FLAGS)[number];

/** Where an edge's claim can be checked (BR1.1): all three strings are required. */
export interface Evidence {
  /** The file (relative to the scanned root, or an `alias:N/` label) holding the field. */
  readonly file: string;
  /** The field path inside that object, in crankpath's own notation. */
  readonly field: string;
  /** The rendered object the edge was read from: `<file>#<document>` for plain sources. */
  readonly renderedPath: string;
  readonly line: number | null;
}

export interface Edge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly kind: EdgeKind;
  readonly source: EdgeSource;
  /** Ordering constraints are never part of a cycle (ADR-009). */
  readonly orderingOnly: boolean;
  readonly evidence: Evidence;
}

export interface Origin {
  /** The render job that produced the object, or null for an object read directly by discovery. */
  readonly renderJob: string | null;
  /** The file it was read from, relative to the scanned root or an `alias:N/` label. */
  readonly path: string | null;
  /** 1-based document number in that file. */
  readonly document: number | null;
}

/** A suggested `repos:` entry (FR2.4): data only, never applied by any code path. */
export interface RepoSuggestion {
  /** The repoURL with userinfo removed. */
  readonly url: string;
  readonly readFrom: string;
}

export interface OpaqueMark {
  readonly reason: OpaqueReason;
  /** crankpath's fixed wording for the detail, or null. */
  readonly detail: string | null;
  /** The field crankpath could not use, in its own notation (may hold repo keys: always quoted). */
  readonly field: string | null;
  /** The repo text in that field, when it is shown (always quoted and escaped on output). */
  readonly value: string | null;
  /** What could not be seen (BR3.16): never empty. */
  readonly lostEdges: readonly string[];
  readonly suggestion: RepoSuggestion | null;
}

export interface GraphNode {
  readonly id: NodeId;
  readonly kind: string;
  readonly namespace: string | null;
  readonly name: string;
  readonly origin: Origin;
  readonly opaque: OpaqueMark | null;
  readonly flags: readonly NodeFlag[];
  /** The Argo CD sync wave: an ordering attribute, never an edge (BR5.3). */
  readonly syncWave: number | null;
}

export type ColdStart = "available" | "unavailable" | "unspecified";

export interface ExternalNode {
  readonly id: NodeId;
  readonly name: string;
  readonly coldStart: ColdStart;
  readonly servedBy: NodeId | null;
}

/** A broken construction invariant: a bug in crankpath, never a property of the scanned repo. */
export class GraphConstructionError extends Error {}

/**
 * Kinds that are cluster-scoped (id `Kind/name`). Every other kind is namespaced. Kubernetes core
 * and the GitOps, secrets and certificate kinds crankpath reads; a cluster-scoped kind missing here
 * is treated as namespaced, which never merges two objects (its id only gains a namespace).
 */
export const CLUSTER_SCOPED_KINDS: ReadonlySet<string> = new Set([
  "APIService",
  "CSIDriver",
  "CSINode",
  "CertificateSigningRequest",
  "ClusterExternalSecret",
  "ClusterIssuer",
  "ClusterRole",
  "ClusterRoleBinding",
  "ClusterSecretStore",
  "CustomResourceDefinition",
  "IngressClass",
  "MutatingWebhookConfiguration",
  "Namespace",
  "Node",
  "PersistentVolume",
  "PriorityClass",
  "RuntimeClass",
  "StorageClass",
  "ValidatingAdmissionPolicy",
  "ValidatingAdmissionPolicyBinding",
  "ValidatingWebhookConfiguration",
  "VolumeAttachment",
  "VolumeSnapshotClass",
]);

// Kubernetes name syntax: a kind is an identifier (a CRD kind is a DNS-1035 label, 63 characters);
// a namespace is a DNS-1123 label (63); a name is a DNS-1123 subdomain (253). None holds `/` or `:`.
const KIND = /^[A-Za-z][A-Za-z0-9]{0,62}$/;
const NAMESPACE = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const LABEL = "[a-z0-9](?:[-a-z0-9]*[a-z0-9])?";
const NAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
const NAME_MAX = 253;
// An external's name: letters, digits, `.`, `_`, `-` and `/` (for example `aws-kms/us-east-1`).
const EXTERNAL = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,251}[A-Za-z0-9])?$/;

export type IdRefusal = "invalid-kind" | "invalid-name" | "invalid-namespace" | "no-namespace";

export type IdResult =
  | {
      readonly ok: true;
      readonly id: NodeId;
      readonly kind: string;
      readonly namespace: string | null;
      readonly name: string;
    }
  | { readonly ok: false; readonly refusal: IdRefusal };

export function isValidKind(kind: unknown): kind is string {
  return typeof kind === "string" && KIND.test(kind);
}

export function isValidName(name: unknown): name is string {
  return typeof name === "string" && name.length <= NAME_MAX && NAME.test(name);
}

export function isValidNamespace(namespace: unknown): namespace is string {
  return typeof namespace === "string" && NAMESPACE.test(namespace);
}

export function isClusterScoped(kind: string): boolean {
  return CLUSTER_SCOPED_KINDS.has(kind);
}

/**
 * The canonical id of a Kubernetes object (BR1.3). `namespace` is the object's effective
 * namespace (its own, else the default its render gives it); a cluster-scoped kind ignores it, as
 * the API server does. Refused when any part is not Kubernetes name syntax, or when a namespaced
 * object has no namespace.
 */
export function objectId(kind: unknown, namespace: unknown, name: unknown): IdResult {
  if (!isValidKind(kind)) return { ok: false, refusal: "invalid-kind" };
  if (!isValidName(name)) return { ok: false, refusal: "invalid-name" };
  if (isClusterScoped(kind)) return { ok: true, id: `${kind}/${name}`, kind, namespace: null, name };
  if (namespace === null || namespace === undefined) return { ok: false, refusal: "no-namespace" };
  if (!isValidNamespace(namespace)) return { ok: false, refusal: "invalid-namespace" };
  return { ok: true, id: `${kind}/${namespace}/${name}`, kind, namespace, name };
}

export function isValidExternalName(name: unknown): name is string {
  return typeof name === "string" && EXTERNAL.test(name) && !name.includes("//");
}

/** `external:<name>`, or undefined when the name is not a valid external name. */
export function externalId(name: unknown): NodeId | undefined {
  return isValidExternalName(name) ? `external:${name}` : undefined;
}

export type ParsedId =
  | { readonly external: false; readonly kind: string; readonly namespace: string | null; readonly name: string }
  | { readonly external: true; readonly name: string };

/** Parses a canonical id; undefined for anything that is not exactly a canonical id. */
export function parseNodeId(id: unknown): ParsedId | undefined {
  if (typeof id !== "string") return undefined;
  if (id.startsWith("external:")) {
    const name = id.slice("external:".length);
    return isValidExternalName(name) ? { external: true, name } : undefined;
  }
  const parts = id.split("/");
  if (parts.length === 2) {
    const [kind, name] = parts as [string, string];
    if (!isClusterScoped(kind)) return undefined;
    const r = objectId(kind, null, name);
    return r.ok ? { external: false, kind: r.kind, namespace: null, name: r.name } : undefined;
  }
  if (parts.length === 3) {
    const [kind, namespace, name] = parts as [string, string, string];
    if (isClusterScoped(kind)) return undefined;
    const r = objectId(kind, namespace, name);
    return r.ok ? { external: false, kind: r.kind, namespace: r.namespace, name: r.name } : undefined;
  }
  return undefined;
}

export function isNodeId(id: unknown): id is NodeId {
  return parseNodeId(id) !== undefined;
}

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.length > 0;
}

export interface EdgeInput {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly kind: EdgeKind;
  readonly source: EdgeSource;
  readonly evidence: Evidence;
  readonly orderingOnly?: boolean;
}

/** Builds an immutable edge; a missing evidence part, a bad id, kind or source is a bug (BR1.1, BR1.2). */
export function makeEdge(input: EdgeInput): Edge {
  const { from, to, kind, source, evidence } = input;
  if (!isNodeId(from) || !isNodeId(to)) throw new GraphConstructionError("edge endpoint is not a canonical id");
  if (!(EDGE_KINDS as readonly string[]).includes(kind)) throw new GraphConstructionError("unknown edge kind");
  if (source !== "extracted" && source !== "declared") throw new GraphConstructionError("edge source");
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    !nonEmpty(evidence.file) ||
    !nonEmpty(evidence.field) ||
    !nonEmpty(evidence.renderedPath)
  ) {
    throw new GraphConstructionError("edge without evidence (file, field and rendered path are required)");
  }
  const line = evidence.line;
  if (line !== null && !(Number.isInteger(line) && line > 0)) throw new GraphConstructionError("evidence line");
  return Object.freeze({
    from,
    to,
    kind,
    source,
    orderingOnly: input.orderingOnly === true,
    evidence: Object.freeze({ file: evidence.file, field: evidence.field, renderedPath: evidence.renderedPath, line }),
  });
}

export interface OpaqueInput {
  readonly reason: OpaqueReason;
  readonly lostEdges: readonly string[];
  readonly detail?: string | null;
  readonly field?: string | null;
  readonly value?: string | null;
  readonly suggestion?: RepoSuggestion | null;
}

/** Builds an opaque mark: exactly one reason from the fixed list, and what could not be seen (BR3.15, BR3.16). */
export function makeOpaqueMark(input: OpaqueInput): OpaqueMark {
  if (!(OPAQUE_REASONS as readonly string[]).includes(input.reason)) throw new GraphConstructionError("opaque reason");
  if (input.lostEdges.length === 0 || !input.lostEdges.every(nonEmpty)) {
    throw new GraphConstructionError("an opaque mark must say what could not be seen");
  }
  return Object.freeze({
    reason: input.reason,
    detail: input.detail ?? null,
    field: input.field ?? null,
    value: input.value ?? null,
    lostEdges: Object.freeze([...input.lostEdges]),
    suggestion: input.suggestion ? Object.freeze({ ...input.suggestion }) : null,
  });
}

/** The renderedPath of an object read from a plain file: `<file>#<document>`, plus `.items[i]` for a List item. */
export function renderedPathOf(file: string, document: number, item?: number): string {
  return item === undefined ? `${file}#${document}` : `${file}#${document}.items[${item}]`;
}

/** Why an object is skipped: its id would not be canonical, or the document is not an object. */
export type SkipReason = IdRefusal | "not-an-object";

/** An object that is not in the graph: named (its raw text quoted on output) and counted (BR1.3). */
export interface SkippedObject {
  readonly file: string;
  readonly document: number;
  /** `.items[i]` of a List, or null. */
  readonly item: number | null;
  /** The raw values as found (repo text), or null when absent or not a string. */
  readonly kind: string | null;
  readonly namespace: string | null;
  readonly name: string | null;
  readonly reason: SkipReason;
  /** The render job that produced it, or null when discovery read it directly. */
  readonly renderJob: string | null;
  /** True for a source document (Application, ApplicationSet, Kustomization, HelmRelease). */
  readonly source: boolean;
}

/** A file that could not be read: its display path, BoundedReader's outcome and fixed wording. */
export interface UnreadableFile {
  readonly path: string;
  readonly outcome: string;
  readonly reasonWord: string;
  readonly detail: string | null;
}
