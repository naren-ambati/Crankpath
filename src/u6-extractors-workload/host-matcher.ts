// HostMatcher (U6; BR6.13 to BR6.16, FR5.9, FR2.5, ADR-016): matches a host taken from a named
// field to an in-estate Service by the cluster DNS forms `svc`, `svc.ns`, `svc.ns.svc` and
// `svc.ns.svc.cluster.local`. Exactly one match is an edge; none is no edge; more than one is no
// edge and an ambiguity. A bare `svc` resolves only in a namespace the field's rules state; without
// one, a Service of that name anywhere makes it ambiguous, never a guess. Services of a foreign
// destination are never offered here (the caller leaves them out, BR5.4). `match:` entries from
// crankpath.yaml are tried first in file order once B5 adds them (US2.3); this build has none.

import type { HostMatch, HostQuery } from "../u1-graph-model/extractor.js";
import type { NodeId } from "../u1-graph-model/graph-model.js";
import { sortedUnique } from "../u1-graph-model/order.js";

export interface ServiceEntry {
  readonly id: NodeId;
  readonly name: string;
  readonly namespace: string;
}

const NONE: HostMatch = Object.freeze({ outcome: "none", node: null, candidates: Object.freeze([]) });

function result(candidates: readonly NodeId[]): HostMatch {
  const sorted = sortedUnique(candidates);
  if (sorted.length === 0) return NONE;
  if (sorted.length === 1)
    return Object.freeze({ outcome: "unique", node: sorted[0] as NodeId, candidates: Object.freeze(sorted) });
  return Object.freeze({ outcome: "ambiguous", node: null, candidates: Object.freeze(sorted) });
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export type HostMatcher = (query: HostQuery) => HostMatch;

export function createHostMatcher(services: readonly ServiceEntry[]): HostMatcher {
  const byNameNs = new Map<string, NodeId[]>();
  const byName = new Map<string, NodeId[]>();
  for (const s of services) {
    const key = `${s.name}.${s.namespace}`;
    byNameNs.set(key, [...(byNameNs.get(key) ?? []), s.id]);
    byName.set(s.name, [...(byName.get(s.name) ?? []), s.id]);
  }
  const lookup = (svc: string, ns: string) => result(byNameNs.get(`${svc}.${ns}`) ?? []);
  return (query: HostQuery): HostMatch => {
    let host = query.host.toLowerCase();
    if (host.endsWith(".")) host = host.slice(0, -1);
    if (host === "" || IPV4.test(host) || host.includes(":") || host.includes("[")) return NONE;
    const parts = host.split(".");
    if (parts.some((p) => p === "")) return NONE;
    const [svc, ns] = parts as [string, string | undefined];
    if (parts.length === 1) {
      if (query.bareNamespace !== null) return lookup(svc, query.bareNamespace);
      const anywhere = byName.get(svc) ?? [];
      return anywhere.length === 0 ? NONE : Object.freeze({ ...result(anywhere), outcome: "ambiguous", node: null });
    }
    if (ns === undefined) return NONE;
    if (parts.length === 2) return lookup(svc, ns);
    if (parts.length === 3 && parts[2] === "svc") return lookup(svc, ns);
    if (parts.length === 5 && parts.slice(2).join(".") === "svc.cluster.local") return lookup(svc, ns);
    return NONE;
  };
}
