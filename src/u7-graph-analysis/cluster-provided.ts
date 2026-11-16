// Objects every cluster provides (BR7.19, FR7.9, OD-25): a reference to one of them is not a
// `not-defined` stub and not an unresolved item; the stub stays in the graph, is taken as present
// at a cold start, and is named in the plan's assumptions (it is an assumption crankpath does not
// verify). The list is fixed and dated: each entry comes from a read-only lookup of the Kubernetes
// documentation or source on 2026-11-15, recorded in `docs/lookups.md`. Ids are compared by string
// equality only; nothing here is a pattern.

import { type NodeId, parseNodeId } from "../u1-graph-model/graph-model.js";

/** The date of the lookups the list rests on. */
export const CLUSTER_PROVIDED_DATE = "2026-11-15";

/** Cluster-scoped and fixed-namespace objects, by canonical id. */
export const CLUSTER_PROVIDED: ReadonlySet<NodeId> = new Set<NodeId>([
  // "Kubernetes starts with four initial namespaces" (concepts/overview/working-with-objects/namespaces.md)
  "Namespace/default",
  "Namespace/kube-node-lease",
  "Namespace/kube-public",
  "Namespace/kube-system",
  // the API server's own Service, kept by the control plane (pkg/controlplane/controller/kubernetesservice)
  "Service/default/kubernetes",
  // user-facing default ClusterRoles (reference/access-authn-authz/rbac.md) and the super-user binding
  // (plugin/pkg/auth/authorizer/rbac/bootstrappolicy/policy.go)
  "ClusterRole/admin",
  "ClusterRole/cluster-admin",
  "ClusterRole/edit",
  "ClusterRole/view",
  "ClusterRoleBinding/cluster-admin",
  // built-in PriorityClasses (concepts/scheduling-eviction/pod-priority-preemption.md)
  "PriorityClass/system-cluster-critical",
  "PriorityClass/system-node-critical",
]);

/** The four initial namespaces, which every cluster has. */
export const INITIAL_NAMESPACES: ReadonlySet<string> = new Set([
  "default",
  "kube-node-lease",
  "kube-public",
  "kube-system",
]);

/**
 * Objects the control plane creates in every namespace, by kind and name: the `default`
 * ServiceAccount (concepts/security/service-accounts.md, "Default service accounts") and the
 * `kube-root-ca.crt` ConfigMap (the root CA publisher, pkg/controller/certificates/rootcacertpublisher).
 * They exist only in a namespace that exists, so the exemption holds only in one of the four
 * initial namespaces or one the estate itself defines (a `Namespace` object read from the repo).
 */
export const PER_NAMESPACE_PROVIDED: ReadonlyMap<string, string> = new Map([
  ["ServiceAccount", "default"],
  ["ConfigMap", "kube-root-ca.crt"],
]);

/**
 * True when the id names an object every cluster provides. `definedNamespaces` are the namespaces
 * the estate defines; a per-namespace object elsewhere is not exempt.
 */
export function isClusterProvided(id: NodeId, definedNamespaces: ReadonlySet<string> = new Set()): boolean {
  if (CLUSTER_PROVIDED.has(id)) return true;
  const p = parseNodeId(id);
  if (p === undefined || p.external || p.namespace === null) return false;
  if (PER_NAMESPACE_PROVIDED.get(p.kind) !== p.name) return false;
  return INITIAL_NAMESPACES.has(p.namespace) || definedNamespaces.has(p.namespace);
}
