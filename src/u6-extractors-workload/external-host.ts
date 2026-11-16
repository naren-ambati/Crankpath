// Where a host from a named field leads (FR5.9, BR6.13 to BR6.15): HostMatcher first (an in-estate
// Service, or after `match:` arrives a declared node); with no match, a name that cannot be the
// cluster's own DNS becomes an external precondition `external:<host>` (an Application reading
// `github.com`, an ACME issuer calling its CA). Every other unmatched host may be in-cluster and is
// no edge and a `host-unplaced` item naming the host: one label, an IP literal (IPv4 or IPv6), any
// name with a `svc` label after its first (`svc.ns.svc`, `kubernetes.default.svc`, a custom
// cluster domain) or ending in `.local` or `.cluster`, and every two-label name `<svc>.<ns>`
// (`kubernetes.default`, `prometheus.monitoring`) unless its last label is a delegated top-level
// domain of the DNS root zone (the registry's dated list, root-zone-tlds.ts) that no namespace of
// the estate is named after. Two or more candidates are an ambiguity (no edge, an item); a bare
// name with one same-named Service and no stated namespace is unplaced, listing that Service. Pure.

import type { ExtractContext, RenderedObject } from "../u1-graph-model/extractor.js";
import {
  type Edge,
  type EdgeKind,
  type EdgeSource,
  type ExternalNode,
  externalId,
  isValidNamespace,
  makeEdge,
  type NodeId,
} from "../u1-graph-model/graph-model.js";
import { type UnresolvedItem, unresolvedItem } from "../u1-graph-model/status-model.js";
import { evidenceOf } from "./references.js";
import { ROOT_ZONE_TLDS } from "./root-zone-tlds.js";

/** Every namespace the estate names: objects' namespaces and Namespace objects. */
export function estateNamespaces(objects: readonly RenderedObject[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const o of objects) {
    if (o.namespace !== null) out.add(o.namespace);
    if (o.kind === "Namespace" && o.apiVersion === "v1") out.add(o.name);
  }
  return out;
}

const DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const CLUSTER_SUFFIXES = Object.freeze([".local", ".cluster"]);

/**
 * The external name for a host that matched nothing, or null when the host is not a DNS name or
 * may be an in-cluster address. The host is lower-cased first; a trailing dot is dropped.
 */
export function externalHostName(rawHost: string, namespaces: ReadonlySet<string>): string | null {
  let host = rawHost.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.length === 0 || host.length > 253) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => DNS_LABEL.test(l))) return null;
  // An IPv4 literal is all-numeric labels: not a name.
  if (labels.every((l) => /^\d+$/.test(l))) return null;
  if (CLUSTER_SUFFIXES.some((s) => host.endsWith(s))) return null;
  if (labels.slice(1).includes("svc")) return null;
  const last = labels[labels.length - 1] as string;
  if (labels.length === 2 && (!ROOT_ZONE_TLDS.has(last) || (isValidNamespace(last) && namespaces.has(last))))
    return null;
  return externalId(host) === undefined ? null : host;
}

/** The host of a URL-valued named field (any scheme, or a bare `host[:port]`), lower-cased; null when unparseable. */
export function urlHost(raw: string): string | null {
  if (raw.length === 0 || /[\p{Cc}\p{Cf}\p{Z}\\]/u.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  // An IPv6 literal keeps its brackets: no Service or external matches it, so it is listed.
  const host = url.hostname.toLowerCase();
  return host === "" ? null : host;
}

export type HostTarget =
  | {
      readonly kind: "node";
      readonly id: NodeId;
      readonly external: ExternalNode | null;
      /** `declared` when a `match:` entry chose the node (B5): the edge is unverified. */
      readonly source: EdgeSource;
    }
  | { readonly kind: "ambiguous"; readonly candidates: readonly NodeId[] }
  | { readonly kind: "unplaced" };

/** An external node as an extractor names it: availability unspecified until crankpath.yaml says (B5). */
export function externalNode(name: string): ExternalNode | null {
  const id = externalId(name);
  if (id === undefined) return null;
  return Object.freeze({ id, name, coldStart: "unspecified", servedBy: null });
}

/**
 * Resolves a host from a named field: a unique match is that node; an ambiguous match is listed by
 * the caller; no match is an external when the name cannot be in-cluster, else unplaced.
 */
export function resolveHost(
  ctx: ExtractContext,
  host: string,
  field: string,
  bareNamespace: string | null = null,
): HostTarget {
  const match = ctx.matchHost({ host, field, bareNamespace });
  if (match.outcome === "unique" && match.node !== null)
    return { kind: "node", id: match.node, external: null, source: match.source };
  if (match.outcome === "ambiguous") return { kind: "ambiguous", candidates: match.candidates };
  // The one fallback the context carries, the same function the HostMatcher was given (B5 review
  // m5): an entry naming this external is agreement there because it is this external here.
  const id = ctx.externalOf(host);
  const name = id === null ? null : id.slice("external:".length);
  const ext = name === null ? null : externalNode(name);
  return ext === null ? { kind: "unplaced" } : { kind: "node", id: ext.id, external: ext, source: "extracted" };
}

export interface HostSink {
  readonly edges: Edge[];
  readonly externals: ExternalNode[];
  readonly unresolved: UnresolvedItem[];
}

export interface HostPlacement {
  /** The dependent node (the edge's `from`, the item's subject). */
  readonly from: NodeId;
  /** The object the field was read from (the edge's evidence). */
  readonly evidence: RenderedObject;
  readonly host: string;
  readonly field: string;
  readonly kind: EdgeKind;
  /** The namespace a bare `svc` host resolves in, when the field's owner states one. */
  readonly bareNamespace: string | null;
}

/** Places a host: an edge (and its external node), or no edge and an item (ambiguous or unplaced). */
export function placeHost(sink: HostSink, ctx: ExtractContext, p: HostPlacement): void {
  const t = resolveHost(ctx, p.host, p.field, p.bareNamespace);
  const where = p.evidence.renderedPath;
  if (t.kind === "node") {
    if (t.external !== null) sink.externals.push(t.external);
    sink.edges.push(
      makeEdge({
        from: p.from,
        to: t.id,
        kind: p.kind,
        source: t.source,
        evidence: evidenceOf(p.evidence, p.field),
      }),
    );
  } else if (t.kind === "ambiguous" && t.candidates.length > 1) {
    sink.unresolved.push(unresolvedItem(p.from, "host-ambiguous", where, p.field, t.candidates, { value: p.host }));
  } else {
    // A bare name with no stated namespace and one same-named Service is not a choice between
    // candidates: the namespace is unknown, so the Service is listed and the host is unplaced.
    const candidates = t.kind === "ambiguous" ? t.candidates : [];
    sink.unresolved.push(unresolvedItem(p.from, "host-unplaced", where, p.field, candidates, { value: p.host }));
  }
}

/**
 * Places the host of a URL-valued field: absent or empty text is nothing; text that yields no host
 * (unparseable, an IPv6 zone id) is no edge and a `host-unplaced` item quoting it, never silence.
 */
export function placeUrl(sink: HostSink, ctx: ExtractContext, p: Omit<HostPlacement, "host">, raw: unknown): void {
  if (typeof raw !== "string" || raw === "") return;
  const host = urlHost(raw);
  if (host === null) {
    sink.unresolved.push(unresolvedItem(p.from, "host-unplaced", p.evidence.renderedPath, p.field, [], { value: raw }));
    return;
  }
  placeHost(sink, ctx, { ...p, host });
}
