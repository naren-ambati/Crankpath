import { describe, expect, it } from "vitest";
import { createHostMatcher } from "../../src/u6-extractors-workload/host-matcher.js";

const match = createHostMatcher([
  { id: "Service/gitea/gitea-http", name: "gitea-http", namespace: "gitea" },
  { id: "Service/vault/vault", name: "vault", namespace: "vault" },
  { id: "Service/other/vault", name: "vault", namespace: "other" },
]);
const q = (host: string, bareNamespace: string | null = null) => match({ host, field: "spec.x", bareNamespace });

describe("host matching (BR6.13, BR6.14)", () => {
  it.each([
    "gitea-http.gitea",
    "gitea-http.gitea.svc",
    "gitea-http.gitea.svc.cluster.local",
    "GITEA-HTTP.gitea.svc.cluster.local.",
  ])("matches the Service by the DNS form %s", (host) => {
    expect(q(host)).toEqual({
      outcome: "unique",
      node: "Service/gitea/gitea-http",
      candidates: ["Service/gitea/gitea-http"],
    });
  });
  it("matches nothing for other hosts and look-alikes", () => {
    for (const host of [
      "gitea-http.gitea.example.org",
      "gitea-http.gitea.svc.cluster.local.evil.example.org",
      "gitea-http.other",
      "gitea-http.gitea.svc.cluster",
      "10.0.0.1",
      "[::1]",
      "",
      "a..b",
      "github.com",
    ]) {
      expect(q(host).outcome).toBe("none");
    }
  });
  it("resolves a bare name only in a stated namespace; otherwise it is ambiguous, never a guess", () => {
    expect(q("vault", "vault")).toMatchObject({ outcome: "unique", node: "Service/vault/vault" });
    expect(q("vault")).toEqual({
      outcome: "ambiguous",
      node: null,
      candidates: ["Service/other/vault", "Service/vault/vault"],
    });
    expect(q("gitea-http")).toMatchObject({ outcome: "ambiguous", candidates: ["Service/gitea/gitea-http"] });
    expect(q("nothing")).toMatchObject({ outcome: "none" });
  });
  it("is ambiguous when two Services answer one name", () => {
    const twice = createHostMatcher([
      { id: "Service/a/x", name: "x", namespace: "a" },
      { id: "Service/a/x2", name: "x", namespace: "a" },
    ]);
    expect(twice({ host: "x.a", field: "f", bareNamespace: null }).outcome).toBe("ambiguous");
  });
});
