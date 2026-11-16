// Objects every cluster provides (BR7.19, OD-25): a reference to one of them is not a `not-defined`
// stub. The list is written, with its dated lookup, in B4; until then it is empty, so every
// reference to an object no readable source defines is a stub and an unresolved item.

import type { NodeId } from "../u1-graph-model/graph-model.js";

export const CLUSTER_PROVIDED: ReadonlySet<NodeId> = new Set<NodeId>();

/** True when the id names an object every cluster provides. */
export function isClusterProvided(id: NodeId): boolean {
  return CLUSTER_PROVIDED.has(id);
}
