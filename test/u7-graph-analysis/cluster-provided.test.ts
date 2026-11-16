import { describe, expect, it } from "vitest";
import { isNodeId } from "../../src/u1-graph-model/graph-model.js";
import {
  CLUSTER_PROVIDED,
  CLUSTER_PROVIDED_DATE,
  isClusterProvided,
} from "../../src/u7-graph-analysis/cluster-provided.js";

describe("objects every cluster provides (BR7.19, OD-25)", () => {
  it("is a fixed, dated list of canonical ids", () => {
    expect(CLUSTER_PROVIDED_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const id of CLUSTER_PROVIDED) expect(isNodeId(id), id).toBe(true);
  });
  it.each([
    ["Namespace/kube-system", true],
    ["Service/default/kubernetes", true],
    ["ServiceAccount/kube-system/default", true],
    ["ConfigMap/default/kube-root-ca.crt", true],
    // per-namespace objects in a namespace the estate does not define (m5)
    ["ServiceAccount/any-namespace/default", false],
    ["ConfigMap/apps/kube-root-ca.crt", false],
    ["ClusterRole/cluster-admin", true],
    ["PriorityClass/system-node-critical", true],
    // look-alikes and objects a cluster does not create by itself
    ["Service/other/kubernetes", false],
    ["ServiceAccount/apps/builder", false],
    ["Secret/apps/default", false],
    ["Namespace/kube-systems", false],
    ["ClusterRole/admin2", false],
    ["external:default", false],
    ["not an id", false],
  ])("%s -> %s", (id, expected) => {
    expect(isClusterProvided(id)).toBe(expected);
  });
  it("exempts a per-namespace object in a namespace the estate defines", () => {
    expect(isClusterProvided("ServiceAccount/apps/default", new Set(["apps"]))).toBe(true);
    expect(isClusterProvided("ServiceAccount/apps/builder", new Set(["apps"]))).toBe(false);
  });
});
