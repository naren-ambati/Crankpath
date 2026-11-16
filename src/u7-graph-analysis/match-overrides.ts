// Cycles a `match:` entry hides (review M1). A `match:` entry wins over the Service rules, so a
// one-line entry in the scanned repo's crankpath.yaml can replace an extracted edge and make a real
// cycle disappear. The pipeline therefore also finds the cycles of the graph built without the
// entries, whenever an entry overrode a host; every such cycle whose node set the report does not
// hold is listed with the entries that overrode a host on it, so it can never vanish silently.

import type { MatchOverride } from "../u1-graph-model/extractor.js";
import type { NodeId } from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import type { CycleLabel } from "../u1-graph-model/status-model.js";
import type { Cycle } from "./cycle-finder.js";

export interface HiddenCycle {
  /** The id the cycle has on the graph without the entries. */
  readonly id: string;
  readonly label: Exclude<CycleLabel, "cranked">;
  readonly nodes: number;
  readonly edges: number;
  /** The cycle's nodes, sorted: they are unverified, since the graph read hides the cycle. */
  readonly nodeIds: readonly NodeId[];
  /** Key paths of the entries that overrode a host on it, in file order. */
  readonly hiddenBy: readonly string[];
}

export function cyclesHiddenByOverrides(
  reported: readonly Cycle[],
  withoutEntries: readonly Cycle[],
  overrides: readonly MatchOverride[],
): HiddenCycle[] {
  if (overrides.length === 0) return [];
  const sets = new Set(reported.map((c) => c.nodes.join("\n")));
  const order = new Map<string, number>();
  overrides.forEach((o, i) => {
    if (!order.has(o.keyPath)) order.set(o.keyPath, i);
  });
  const out: HiddenCycle[] = [];
  for (const c of withoutEntries) {
    if (sets.has(c.nodes.join("\n"))) continue;
    const members = new Set<NodeId>(c.nodes);
    const by = new Set<string>();
    for (const o of overrides) if (o.extracted.candidates.some((n) => members.has(n))) by.add(o.keyPath);
    if (by.size === 0) for (const o of overrides) by.add(o.keyPath);
    out.push(
      Object.freeze({
        id: c.id,
        label: c.labelBeforeCranks,
        nodes: c.nodes.length,
        edges: c.edges.length,
        nodeIds: c.nodes,
        hiddenBy: Object.freeze([...by].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))),
      }),
    );
  }
  return out.sort((a, b) => compareCodePoints(a.id, b.id));
}
