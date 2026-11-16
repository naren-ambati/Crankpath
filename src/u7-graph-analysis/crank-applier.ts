// CrankApplier (U7; BR7.7 to BR7.9, FR7.4, FR6.5, OD-15, ADR-012): a crank is a documented manual
// step crankpath cannot verify, applied as a graph transformation. `creates` makes the named node,
// or every node rendered from `render:<path>`, available at bootstrap: the crank is taken to satisfy
// that node's own dependencies, so its outgoing dependency edges are removed. `reroutes` removes the
// node's `reads-source` edges to in-estate nodes and adds one `rerouted` edge to the named external
// (declared, because crankpath.yaml says so). Crank prerequisites are not modelled; cranks apply in
// file order (OD-15). A target that matches no node is an unresolved item; a crank none of whose
// targets matches is unused. A node belongs to the first crank that creates it (a later crank naming
// it again creates nothing new), so the work is linear in nodes plus targets. Pure: the graph as
// read is not changed.
//
// `render:<path>` (NFR1.1: a path is data, never a pattern) matches a node whose origin file is the
// path or lies under it as a directory, in the scanned root only: objects read from a repository
// mapped by `--repo-alias` carry an `alias:N/` origin (a fetched `repos:` entry `fetch:N/`) and
// never match, so a path of another repository cannot crank this one's objects. An Application an
// ApplicationSet generates (origin render job `generator:<id>`, B3) is made by the ApplicationSet
// controller, not by applying a file, so a `render:` crank never creates it. A path that names a
// Helm chart or Kustomize directory applied by hand (FR7.4; the pipeline renders it as a
// hand-applied root) also matches every object that root rendered, whatever origin the graph keeps
// for an object several renders produce.

import type { CrankDecl } from "../u1-graph-model/declared-facts.js";
import { type Edge, externalId, type GraphNode, makeEdge, type NodeId } from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import { type UnresolvedItem, unresolvedItem } from "../u1-graph-model/status-model.js";

export interface CrankEffect {
  /** `crank:<n>`, the 1-based position in crankpath.yaml. */
  readonly crank: string;
  /** The documented step (repo text, quoted on output). */
  readonly by: string;
  readonly ref: string | null;
  readonly keyPath: string;
  /** Nodes this crank creates first (an earlier crank's nodes are not repeated), sorted. */
  readonly createdNodes: readonly NodeId[];
  /** Nodes its targets name that were already created (by an earlier crank, or another of its own targets). */
  readonly alreadyCreated: number;
  /** One `rerouted` edge per reroute that matched, sorted. */
  readonly reroutedEdges: readonly { readonly from: NodeId; readonly to: NodeId }[];
  /** Edges of the graph as read that the crank removes. */
  readonly removedEdges: number;
  /** False when no target of the crank matched a node (BR7.9). */
  readonly matched: boolean;
}

export interface CrankApplied {
  /** The crank-applied graph's edges. */
  readonly edges: readonly Edge[];
  /** Every node a matched crank creates. */
  readonly created: ReadonlySet<NodeId>;
  /** For each edge of the graph as read that a crank removes (by `edgeKey`), the crank that removes it. */
  readonly removedBy: ReadonlyMap<string, string>;
  /** For each `rerouted` edge a crank adds (by `edgeKey`), the crank that adds it. */
  readonly addedBy: ReadonlyMap<string, string>;
  /** In file order. */
  readonly effects: readonly CrankEffect[];
  /** Unmatched targets and unused cranks. */
  readonly unresolved: readonly UnresolvedItem[];
}

export function edgeKey(e: {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly source: string;
}): string {
  return `${e.from}\n${e.to}\n${e.kind}\n${e.source}`;
}

const ALIAS_SEGMENT = /^(?:alias|fetch):\d+$/;
/** The origin render job of an Application generated from an ApplicationSet. */
export const GENERATOR_JOB_PREFIX = "generator:";

/**
 * The scanned root's nodes sorted by origin file, so a `render:<path>` target is one binary search
 * plus its own matches, and a "next not yet created" pointer per position, so each node is visited
 * once however many targets name it (the scanned repo controls the number of targets: review M3).
 */
class PathIndex {
  private readonly ids: NodeId[];
  private readonly paths: string[];
  private readonly next: Int32Array;
  constructor(nodes: readonly GraphNode[]) {
    const inRoot = nodes
      .filter(
        (n) =>
          n.kind !== "External" &&
          n.origin.path !== null &&
          !ALIAS_SEGMENT.test(n.origin.path.split("/")[0] ?? "") &&
          !(n.origin.renderJob ?? "").startsWith(GENERATOR_JOB_PREFIX),
      )
      .map((n) => ({ id: n.id, path: n.origin.path as string }))
      .sort((a, b) => compareCodePoints(a.path, b.path) || compareCodePoints(a.id, b.id));
    this.ids = inRoot.map((x) => x.id);
    this.paths = inRoot.map((x) => x.path);
    this.next = new Int32Array(inRoot.length + 1).map((_, i) => i);
  }
  private lowerBound(key: string): number {
    let lo = 0;
    let hi = this.paths.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compareCodePoints(this.paths[mid] as string, key) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  /** The first position at or after `i` not yet taken (path-compressed). */
  private find(i: number): number {
    let r = i;
    while (this.next[r] !== r) r = this.next[r] as number;
    let j = i;
    while (this.next[j] !== r) {
      const k = this.next[j] as number;
      this.next[j] = r;
      j = k;
    }
    return r;
  }
  /** Ranges of positions a path names: the file itself, and everything under it as a directory. */
  private ranges(path: string): [number, number][] {
    if (path === "") return [[0, this.paths.length]];
    const exactLo = this.lowerBound(path);
    const exactHi = this.lowerBound(`${path}\u0000`);
    // "<path>/" up to "<path>0" ('0' follows '/' in code-point order): every file under the directory
    return [
      [exactLo, exactHi],
      [this.lowerBound(`${path}/`), this.lowerBound(`${path}0`)],
    ];
  }
  /** Calls `take` for every not-yet-taken node the path names and marks it taken; returns how many it names. */
  take(path: string, take: (id: NodeId) => void): number {
    let named = 0;
    for (const [lo, hi] of this.ranges(path)) {
      if (lo >= hi) continue;
      named += hi - lo;
      for (let i = this.find(lo); i < hi; i = this.find(i)) {
        take(this.ids[i] as NodeId);
        this.next[i] = i + 1;
      }
    }
    return named;
  }
}

export function applyCranks(
  nodes: readonly GraphNode[],
  edges: readonly Edge[],
  cranks: readonly CrankDecl[],
  configFile: string,
  handApplied: ReadonlyMap<string, readonly NodeId[]> = new Map(),
): CrankApplied {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = new PathIndex(nodes);
  const creatorOf = new Map<NodeId, string>();
  const reroutedBy = new Map<NodeId, string>();
  const addedBy = new Map<string, string>();
  const added: Edge[] = [];
  const unresolved: UnresolvedItem[] = [];
  const drafts: { decl: CrankDecl; created: NodeId[]; already: number; rerouted: { from: NodeId; to: NodeId }[] }[] =
    [];

  for (const c of cranks) {
    const misses: string[] = [];
    const made: NodeId[] = [];
    let already = 0;
    const seenTargets = new Set<string>();
    c.creates.forEach((t, j) => {
      const at = c.creates.length === 1 ? `${c.keyPath}.creates` : `${c.keyPath}.creates[${j}]`;
      const key = t.kind === "node" ? `node:${t.node}` : `render:${t.path}`;
      if (seenTargets.has(key)) return;
      seenTargets.add(key);
      if (t.kind === "node") {
        const n = byId.get(t.node);
        if (n === undefined || n.kind === "External") {
          misses.push(at);
          return;
        }
        if (creatorOf.has(n.id)) already += 1;
        else {
          creatorOf.set(n.id, c.id);
          made.push(n.id);
        }
        return;
      }
      let fresh = 0;
      const seen = new Set<NodeId>();
      const claim = (id: NodeId) => {
        seen.add(id);
        if (creatorOf.has(id)) return; // taken by a node target of an earlier crank
        creatorOf.set(id, c.id);
        made.push(id);
        fresh += 1;
      };
      let named = index.take(t.path, claim);
      // a hand-applied root's objects that the path index did not name already
      for (const id of handApplied.get(t.path) ?? []) {
        if (!byId.has(id) || seen.has(id)) continue;
        named += 1;
        claim(id);
      }
      if (named === 0) misses.push(at);
      already += named - fresh;
    });
    const routes: { from: NodeId; to: NodeId }[] = [];
    c.reroutes.forEach((r, j) => {
      const to = externalId(r.to);
      const from = byId.get(r.node);
      const at = c.reroutes.length === 1 ? `${c.keyPath}.reroutes` : `${c.keyPath}.reroutes[${j}]`;
      if (from === undefined || to === undefined) {
        misses.push(at);
        return;
      }
      routes.push({ from: from.id, to });
      if (!reroutedBy.has(from.id)) reroutedBy.set(from.id, c.id);
      const e = makeEdge({
        from: from.id,
        to,
        kind: "rerouted",
        source: "declared",
        evidence: { file: configFile, field: at, renderedPath: c.keyPath, line: null },
      });
      if (!addedBy.has(edgeKey(e))) {
        addedBy.set(edgeKey(e), c.id);
        added.push(e);
      }
    });
    const matched = made.length > 0 || already > 0 || routes.length > 0;
    if (!matched) unresolved.push(unresolvedItem(c.id, "crank-unused", configFile, c.keyPath));
    else for (const m of misses) unresolved.push(unresolvedItem(c.id, "crank-target-unmatched", configFile, m));
    drafts.push({ decl: c, created: made, already, rerouted: routes });
  }

  const isExternal = (id: NodeId) => byId.get(id)?.kind === "External" || id.startsWith("external:");
  const removedBy = new Map<string, string>();
  const removedCount = new Map<string, number>();
  const kept: Edge[] = [];
  for (const e of edges) {
    let remover = creatorOf.get(e.from);
    if (remover === undefined && e.kind === "reads-source" && !isExternal(e.to)) remover = reroutedBy.get(e.from);
    if (remover === undefined) {
      kept.push(e);
      continue;
    }
    removedBy.set(edgeKey(e), remover);
    removedCount.set(remover, (removedCount.get(remover) ?? 0) + 1);
  }

  const effects: CrankEffect[] = drafts.map((d) =>
    Object.freeze({
      crank: d.decl.id,
      by: d.decl.by,
      ref: d.decl.ref,
      keyPath: d.decl.keyPath,
      createdNodes: Object.freeze([...d.created].sort(compareCodePoints)),
      alreadyCreated: d.already,
      reroutedEdges: Object.freeze(
        [...d.rerouted].sort((a, b) => compareCodePoints(a.from, b.from) || compareCodePoints(a.to, b.to)),
      ),
      removedEdges: removedCount.get(d.decl.id) ?? 0,
      matched: d.created.length > 0 || d.already > 0 || d.rerouted.length > 0,
    }),
  );
  return Object.freeze({
    edges: Object.freeze([...kept, ...added]),
    created: new Set(creatorOf.keys()),
    removedBy,
    addedBy,
    effects: Object.freeze(effects),
    unresolved: Object.freeze(unresolved),
  });
}
