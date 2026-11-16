// HostMatcher (U6; BR6.13 to BR6.16, BR2.11, FR5.9, FR6.3, FR2.5, ADR-016): matches a host taken
// from a named field to a node. `match:` entries from crankpath.yaml are tried first, in file
// order, and the first whose pattern matches wins (AC6.5.3, AC2.3.4); the node it names is used,
// and the match says `declared`, because the scanned repo supplies that file: an edge made from it
// is unverified. Otherwise the host is compared with in-estate Services by the cluster DNS forms
// `svc`, `svc.ns`, `svc.ns.svc` and `svc.ns.svc.cluster.local`: exactly one match is an edge; none
// is no edge; more than one is no edge and an ambiguity. A bare `svc` resolves only in a namespace
// the field's rules state; without one, a Service of that name anywhere makes it ambiguous, never a
// guess. Services of a foreign destination are never offered here (the caller leaves them out,
// BR5.4). Patterns are data: `*` stands for one or more characters inside one DNS label (never a
// `.`), compared case-insensitively by a small matcher, never compiled into a regular expression.
// An entry that names what the Service rules find adds nothing declared (the edge stays extracted);
// one that names something else is an override, listed per host with both targets (review M1).
// Entries without a wildcard are looked up by host; wildcard entries are compared label by label
// from the right, within a derived budget (hostPatternComparisons): a spent budget is a counted
// limit, never a hang (review M3).

import type { MatchRule } from "../u1-graph-model/declared-facts.js";
import type { HostMatch, HostQuery, MatchOverride, RenderedObject } from "../u1-graph-model/extractor.js";
import { externalId, isNodeId, type NodeId } from "../u1-graph-model/graph-model.js";
import { estateNamespaces, externalHostName } from "./external-host.js";

export type { MatchOverride } from "../u1-graph-model/extractor.js";
import { type DerivedLimit, LIMITS, limitValue } from "../u1-graph-model/limits.js";
import { compareCodePoints, sortedUnique } from "../u1-graph-model/order.js";

export interface ServiceEntry {
  readonly id: NodeId;
  readonly name: string;
  readonly namespace: string;
}

const NONE: HostMatch = Object.freeze({
  outcome: "none",
  node: null,
  candidates: Object.freeze([]),
  source: "extracted",
  rule: null,
});

function result(candidates: readonly NodeId[]): HostMatch {
  const sorted = sortedUnique(candidates);
  if (sorted.length === 0) return NONE;
  if (sorted.length === 1)
    return Object.freeze({
      outcome: "unique",
      node: sorted[0] as NodeId,
      candidates: Object.freeze(sorted),
      source: "extracted",
      rule: null,
    });
  return Object.freeze({
    outcome: "ambiguous",
    node: null,
    candidates: Object.freeze(sorted),
    source: "extracted",
    rule: null,
  });
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** One DNS label against one pattern label: `*` is one or more characters (dynamic programming, no regex). */
export function labelMatches(pattern: string, label: string): boolean {
  // reach[j]: the first i pattern characters can consume exactly j label characters.
  let reach = new Uint8Array(label.length + 1);
  reach[0] = 1;
  for (const p of pattern) {
    const next = new Uint8Array(label.length + 1);
    if (p === "*") {
      let seen = false;
      for (let j = 0; j <= label.length; j++) {
        if (seen) next[j] = 1;
        if (reach[j] === 1) seen = true;
      }
    } else {
      for (let j = 0; j < label.length; j++) if (reach[j] === 1 && label[j] === p) next[j + 1] = 1;
    }
    reach = next;
  }
  return reach[label.length] === 1;
}

/** A host against a `match:` pattern: the same number of labels, each matched; case-insensitive. */
export function hostMatchesPattern(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase().split(".");
  const h = host.toLowerCase().split(".");
  if (p.length !== h.length) return false;
  return p.every((label, i) => labelMatches(label, h[i] as string));
}

/** The node a `match:` entry names: a node id as written, else `external:<name>`. */
export function ruleTarget(rule: MatchRule): NodeId | undefined {
  return isNodeId(rule.node) ? rule.node : externalId(rule.node);
}

export type HostMatcher = (query: HostQuery) => HostMatch;

export interface HostMatching {
  readonly match: HostMatcher;
  /** The `match:` entries that matched no host so far, in file order (AC2.3.4). */
  unusedRules(): readonly MatchRule[];
  /** Hosts a `match:` entry resolved otherwise than the extracted rules, sorted by (key path order, host). */
  overrides(): readonly MatchOverride[];
  /** True when the wildcard comparison budget was spent (a counted limit: the run is unverified). */
  limitHit(): boolean;
}

interface IndexedRule {
  readonly rule: MatchRule;
  readonly target: NodeId;
  /** Pattern labels, lower-cased, compared from the right. */
  readonly labels: readonly string[];
  /** How many leading labels are left to compare once the literal suffix matched (the index did that). */
  readonly wild: number;
}

export function createHostMatching(
  services: readonly ServiceEntry[],
  rules: readonly MatchRule[] = [],
  budget: DerivedLimit<"steps"> = LIMITS.hostPatternComparisons,
  /**
   * The external a host names when no Service answers it (the extractors' own fallback, B4), so an
   * entry naming that same external is agreement, not an override. Default: none.
   */
  externalOf: (host: string) => NodeId | null = () => null,
): HostMatching {
  const byNameNs = new Map<string, NodeId[]>();
  const byName = new Map<string, NodeId[]>();
  for (const s of services) {
    const key = `${s.name}.${s.namespace}`;
    const a = byNameNs.get(key);
    if (a === undefined) byNameNs.set(key, [s.id]);
    else a.push(s.id);
    const b = byName.get(s.name);
    if (b === undefined) byName.set(s.name, [s.id]);
    else b.push(s.id);
  }
  // Entries without a wildcard are looked up by host (the first in file order per host). Entries
  // with one are indexed by label count and their literal suffix (the rightmost labels without a
  // `*`), so a host consults only the entries whose literal suffix it ends in (B5 review M3); the
  // labels left are compared right to left. Nothing is compiled into a pattern.
  const literal = new Map<string, IndexedRule>();
  const buckets = new Map<string, IndexedRule[]>();
  const suffixLengths = new Map<number, number[]>();
  for (const rule of [...rules].sort((a, b) => a.order - b.order)) {
    const target = ruleTarget(rule);
    if (target === undefined) continue;
    const host = rule.host.toLowerCase();
    const labels = host.split(".");
    if (!host.includes("*")) {
      if (!literal.has(host)) literal.set(host, { rule, target, labels, wild: 0 });
      continue;
    }
    let k = 0;
    while (k < labels.length && !(labels[labels.length - 1 - k] as string).includes("*")) k += 1;
    const key = `${labels.length}\n${labels.slice(labels.length - k).join(".")}`;
    const bucket = buckets.get(key);
    const entry: IndexedRule = { rule, target, labels, wild: labels.length - k };
    if (bucket === undefined) buckets.set(key, [entry]);
    else bucket.push(entry);
    const lengths = suffixLengths.get(labels.length) ?? [];
    if (!lengths.includes(k)) lengths.push(k);
    suffixLengths.set(labels.length, lengths);
  }
  // The budget is charged per step actually done: one per candidate entry consulted, the length of
  // a literal label compared, and pattern length times label length for a label with a `*` (the
  // matcher's own table). A spent budget stops the remaining wildcard work: a counted limit.
  const allowed = limitValue(budget);
  let spent = 0;
  let exhausted = false;
  const charge = (steps: number): boolean => {
    if (exhausted || spent + steps > allowed) {
      exhausted = true;
      return false;
    }
    spent += steps;
    return true;
  };
  const used = new Set<number>();
  const ruleOfHost = new Map<string, IndexedRule | null>();
  const overrides = new Map<string, MatchOverride>();

  const fits = (entry: IndexedRule, parts: readonly string[]): boolean | null => {
    for (let i = entry.wild - 1; i >= 0; i--) {
      const p = entry.labels[i] as string;
      const l = parts[i] as string;
      const literalLabel = !p.includes("*");
      if (!charge(literalLabel ? Math.max(1, Math.min(p.length, l.length)) : Math.max(1, p.length * l.length)))
        return null;
      if (literalLabel ? p !== l : !labelMatches(p, l)) return false;
    }
    return true;
  };

  const firstRule = (host: string, parts: readonly string[]): IndexedRule | null => {
    const cached = ruleOfHost.get(host);
    if (cached !== undefined) return cached;
    let best = literal.get(host) ?? null;
    // the candidate buckets: one per literal-suffix length present for this label count
    const lists: IndexedRule[][] = [];
    for (const k of suffixLengths.get(parts.length) ?? []) {
      const list = buckets.get(`${parts.length}\n${parts.slice(parts.length - k).join(".")}`);
      if (list !== undefined) lists.push(list);
    }
    const heads = lists.map(() => 0);
    for (;;) {
      // the next candidate in file order across the buckets
      let pick = -1;
      for (let b = 0; b < lists.length; b++) {
        const e = (lists[b] as IndexedRule[])[heads[b] as number];
        if (e === undefined) continue;
        if (
          pick < 0 ||
          e.rule.order < ((lists[pick] as IndexedRule[])[heads[pick] as number] as IndexedRule).rule.order
        )
          pick = b;
      }
      if (pick < 0) break;
      const entry = (lists[pick] as IndexedRule[])[heads[pick] as number] as IndexedRule;
      heads[pick] = (heads[pick] as number) + 1;
      if (best !== null && entry.rule.order > best.rule.order) break;
      if (!charge(1)) break;
      const ok = fits(entry, parts);
      if (ok === null) break;
      if (ok) {
        best = entry;
        break;
      }
    }
    ruleOfHost.set(host, best);
    return best;
  };

  const lookup = (svc: string, ns: string) => result(byNameNs.get(`${svc}.${ns}`) ?? []);
  const extracted = (host: string, parts: readonly string[], bareNamespace: string | null): HostMatch => {
    if (IPV4.test(host)) return NONE;
    const [svc, ns] = parts as [string, string | undefined];
    if (parts.length === 1) {
      if (bareNamespace !== null) return lookup(svc, bareNamespace);
      const anywhere = byName.get(svc) ?? [];
      return anywhere.length === 0 ? NONE : Object.freeze({ ...result(anywhere), outcome: "ambiguous", node: null });
    }
    if (ns === undefined) return NONE;
    if (parts.length === 2) return lookup(svc, ns);
    if (parts.length === 3 && parts[2] === "svc") return lookup(svc, ns);
    if (parts.length === 5 && parts.slice(2).join(".") === "svc.cluster.local") return lookup(svc, ns);
    return NONE;
  };

  const match = (query: HostQuery): HostMatch => {
    let host = query.host.toLowerCase();
    if (host.endsWith(".")) host = host.slice(0, -1);
    if (host === "" || host.includes(":") || host.includes("[")) return NONE;
    const parts = host.split(".");
    if (parts.some((p) => p === "")) return NONE;
    const plain = extracted(host, parts, query.bareNamespace);
    const entry = firstRule(host, parts);
    if (entry === null) return plain;
    used.add(entry.rule.order);
    // An entry that names what the extracted rules find adds nothing declared: the edge stays extracted.
    if (plain.outcome === "unique" && plain.node === entry.target) return plain;
    const fallback = plain.outcome === "none" ? externalOf(host) : null;
    if (fallback !== null && fallback === entry.target) return plain;
    const seen: HostMatch =
      fallback === null
        ? plain
        : Object.freeze({ ...plain, outcome: "unique", node: fallback, candidates: Object.freeze([fallback]) });
    const key = `${entry.rule.order}\n${host}\n${seen.outcome}\n${seen.node ?? ""}`;
    if (!overrides.has(key)) {
      overrides.set(
        key,
        Object.freeze({
          keyPath: entry.rule.keyPath,
          host,
          extracted: Object.freeze({ outcome: seen.outcome, node: seen.node, candidates: seen.candidates }),
          declared: entry.target,
        }),
      );
    }
    return Object.freeze({
      outcome: "unique",
      node: entry.target,
      candidates: Object.freeze([entry.target]),
      source: "declared",
      rule: entry.rule.keyPath,
    });
  };
  const orderOf = new Map(rules.map((r) => [r.keyPath, r.order]));
  return Object.freeze({
    match,
    unusedRules: () => Object.freeze([...rules].sort((a, b) => a.order - b.order).filter((r) => !used.has(r.order))),
    overrides: () =>
      Object.freeze(
        [...overrides.values()].sort(
          (a, b) =>
            (orderOf.get(a.keyPath) ?? 0) - (orderOf.get(b.keyPath) ?? 0) ||
            compareCodePoints(a.host, b.host) ||
            compareCodePoints(a.extracted.node ?? "", b.extracted.node ?? ""),
        ),
      ),
    limitHit: () => exhausted,
  });
}

export function createHostMatcher(
  services: readonly ServiceEntry[],
  rules: readonly MatchRule[] = [],
  externalOf?: (host: string) => NodeId | null,
): HostMatcher {
  return createHostMatching(services, rules, LIMITS.hostPatternComparisons, externalOf).match;
}

/**
 * The one way a run builds host resolution (B5 review m5): the matcher and the fallback external
 * naming share one namespace set, taken from the objects once. The pipeline and the test contexts
 * all call this, and extractors read the fallback from the context only.
 */
export function hostResolution(
  objects: readonly RenderedObject[],
  services: readonly ServiceEntry[],
  rules: readonly MatchRule[],
  budget: DerivedLimit<"steps"> = LIMITS.hostPatternComparisons,
): { readonly matching: HostMatching; readonly externalOf: (host: string) => NodeId | null } {
  const externalOf = externalFallback(estateNamespaces(objects));
  return { matching: createHostMatching(services, rules, budget, externalOf), externalOf };
}

/** The extractors' fallback for a host no Service answers: the external it names, given the estate's namespaces. */
export function externalFallback(namespaces: ReadonlySet<string>): (host: string) => NodeId | null {
  return (host) => {
    const name = externalHostName(host, namespaces);
    return name === null ? null : (externalId(name) ?? null);
  };
}
