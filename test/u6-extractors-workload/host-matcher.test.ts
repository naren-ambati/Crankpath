import { describe, expect, it } from "vitest";
import {
  createHostMatcher,
  createHostMatching,
  hostMatchesPattern,
  labelMatches,
} from "../../src/u6-extractors-workload/host-matcher.js";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

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
      source: "extracted",
      rule: null,
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
      source: "extracted",
      rule: null,
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

describe("match: entries (US2.3, AC2.3.4, AC6.5.3, BR2.11)", () => {
  const rule = (order: number, host: string, node: string) => ({ host, node, order, keyPath: `match[${order}]` });
  const services = [{ id: "Service/vault/vault", name: "vault", namespace: "vault" }];
  it("uses the first matching entry in file order, before any Service, and marks the match declared", () => {
    const m = createHostMatching(services, [
      rule(1, "vault.vault", "Service/vault/second"),
      rule(0, "vault.*", "Service/vault/first"),
    ]);
    expect(m.match({ host: "vault.vault", field: "f", bareNamespace: null })).toEqual({
      outcome: "unique",
      node: "Service/vault/first",
      candidates: ["Service/vault/first"],
      source: "declared",
      rule: "match[0]",
    });
    expect(m.unusedRules().map((r) => r.keyPath)).toEqual(["match[1]"]);
    // without the entries the same host is the Service, extracted
    expect(createHostMatcher(services)({ host: "vault.vault", field: "f", bareNamespace: null })).toMatchObject({
      node: "Service/vault/vault",
      source: "extracted",
    });
  });
  it("names an external by its name and lists entries that matched nothing as unused", () => {
    const m = createHostMatching(
      [],
      [rule(0, "*.kms.us-east-1.amazonaws.com", "aws-kms/us-east-1"), rule(1, "never.example.org", "x")],
    );
    expect(m.unusedRules()).toHaveLength(2);
    expect(m.match({ host: "KMS-FIPS.kms.us-east-1.amazonaws.com.", field: "f", bareNamespace: null })).toMatchObject({
      node: "external:aws-kms/us-east-1",
      source: "declared",
    });
    expect(m.unusedRules().map((r) => r.keyPath)).toEqual(["match[1]"]);
  });
  it("lets `*` stand for one or more characters inside one label, never a dot or nothing", () => {
    const m = createHostMatcher([], [rule(0, "*.kms.example.org", "kms")]);
    const q2 = (host: string) => m({ host, field: "f", bareNamespace: null }).outcome;
    expect(q2("a.kms.example.org")).toBe("unique");
    expect(q2("kms.example.org")).toBe("none");
    expect(q2("a.b.kms.example.org")).toBe("none");
    expect(q2(".kms.example.org")).toBe("none");
    expect(q2("a.kms.example.org.evil.example.net")).toBe("none");
    expect(labelMatches("vault-*-a", "vault-x-y-a")).toBe(true);
    expect(labelMatches("vault-*-a", "vault--a")).toBe(false);
    expect(labelMatches("**", "a")).toBe(false);
    expect(labelMatches("**", "ab")).toBe(true);
    expect(hostMatchesPattern("GitHub.com", "github.COM")).toBe(true);
  });
  it("matches a long hostile label in linear time per pattern character", () => {
    const label = "a".repeat(63);
    const t0 = cpuStart();
    expect(labelMatches(`${"*".repeat(30)}b`, label)).toBe(false);
    expect(cpuSince(t0)).toBeLessThan(1000);
  });
});
