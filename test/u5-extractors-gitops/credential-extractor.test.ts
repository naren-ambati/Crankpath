// Argo CD repository credentials (BR5.5 to BR5.8, BR5.14, NFR1.1): exact and path-prefix matching
// on RepoIdentity's normal form, a table of look-alike URLs, ambiguity, templated URLs, label
// spoofing and foreign destinations.

import { describe, expect, it } from "vitest";
import type { DataValue, RenderedObject } from "../../src/u1-graph-model/extractor.js";
import {
  chooseCredential,
  credentialExtractor,
  transportOf,
} from "../../src/u5-extractors-gitops/credential-extractor.js";
import { EXTRACTORS } from "../../src/u9-cli-package/pipeline-runner.js";
import { analyseFixture, edgeLines } from "../helpers/fixture-kit.js";
import { context, job, obj } from "../helpers/objects.js";

const LABEL = "argocd.argoproj.io/secret-type";

function secret(name: string, type: string, url: string | null, options: { renderJob?: string } = {}) {
  const doc: Record<string, DataValue> = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name, namespace: "argocd", labels: { [LABEL]: type } },
  };
  if (url !== null) doc.stringData = { url, password: "never-kept" };
  return obj(doc, { file: `creds/${name}.yaml`, renderJob: options.renderJob ?? null });
}
function externalSecret(name: string, template: DataValue, target: Record<string, DataValue> = {}) {
  return obj(
    {
      apiVersion: "external-secrets.io/v1",
      kind: "ExternalSecret",
      metadata: { name, namespace: "argocd" },
      spec: { secretStoreRef: { kind: "ClusterSecretStore", name: "s" }, target: { template, ...target } },
    },
    { file: `creds/${name}-es.yaml` },
  );
}
function app(name: string, repoURL: string, kind = "Application"): RenderedObject {
  const spec: DataValue =
    kind === "Application"
      ? { source: { repoURL, path: "." } }
      : { generators: [{ git: { repoURL } }], template: { spec: { source: { repoURL } } } };
  return obj(
    { apiVersion: "argoproj.io/v1alpha1", kind, metadata: { name, namespace: "argocd" }, spec },
    {
      file: `apps/${name}.yaml`,
    },
  );
}
function extract(objects: RenderedObject[], jobs = [job("Application/argocd/x", "cluster-b")]) {
  const r = credentialExtractor.extract(objects, context(objects, jobs));
  return {
    r,
    edges: r.edges.map((e) => `${e.from} ${e.kind} ${e.to} @${e.evidence.field}`).sort(),
    // The assumption that Argo CD runs where every Application sits is its own case below.
    items: r.unresolved
      .filter((u) => u.why !== "argocd-namespace-assumed" && u.why !== "argocd-namespace-derived")
      .map((u) => `${u.why} ${u.subject} @${u.field ?? ""}`)
      .sort(),
    all: r.unresolved.map((u) => `${u.why} ${u.subject}`).sort(),
  };
}

describe("repository credentials (BR5.5, BR5.8)", () => {
  it("links an Application to the credential whose url equals its repoURL after normalisation", () => {
    const x = extract([
      secret("repo", "repository", "https://github.com/acme/platform.git"),
      app("a", "https://GitHub.com/acme/platform/"),
    ]);
    expect(x.edges).toEqual(["Application/argocd/a needs-credential Secret/argocd/repo @spec.source.repoURL"]);
  });
  it("treats ssh and scp-style URLs as one transport, and never offers an ssh credential to https", () => {
    const ssh = secret("repo", "repository", "git@github.com:acme/platform.git");
    expect(extract([ssh, app("a", "ssh://git@github.com/acme/platform")]).edges).toHaveLength(1);
    expect(extract([ssh, app("a", "https://github.com/acme/platform")]).edges).toEqual([]);
    expect(transportOf("git@github.com:a/b")).toBe("ssh");
    expect(transportOf("HTTPS://x")).toBe("https");
    expect(transportOf("relative/path")).toBeNull();
  });
  it.each([
    ["https://github.com/acme/platform-extra", "a longer last segment"],
    ["https://github.com/acme/platform/sub", "a deeper path (repository is exact)"],
    ["https://github.com/acme", "a parent path"],
    ["https://github.com.evil.example/acme/platform", "a look-alike host"],
    ["https://github.com:8443/acme/platform", "another port"],
    ["https://github.com/Acme/platform", "path case"],
  ])("makes no edge for %s (%s)", (repoURL) => {
    const x = extract([secret("repo", "repository", "https://github.com/acme/platform"), app("a", repoURL)]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([]);
  });
  it("makes no edge from a credential that matches no Application (BR5.8)", () => {
    expect(extract([secret("repo", "repository", "https://github.com/acme/other")]).edges).toEqual([]);
  });
  it("never keeps the password: only the url reaches the object", () => {
    const s = secret("repo", "repository", "https://user:pw@github.com/acme/platform");
    expect(s.credentialUrl).toBe("https://github.com/acme/platform");
    expect(JSON.stringify(s.body)).not.toContain("never-kept");
  });
});

describe("repo-creds templates (BR5.6)", () => {
  const creds = secret("org", "repo-creds", "https://github.com/acme");
  it.each([
    ["https://github.com/acme/platform", true],
    ["https://github.com/acme", true],
    ["https://github.com/acme/a/b.git", true],
    ["https://github.com/acme-corp/platform", false],
    ["https://github.com/acmeplatform", false],
    ["https://github.com/other/acme", false],
  ])("%s matches: %s (a path-segment prefix, never a substring)", (repoURL, matches) => {
    expect(extract([creds, app("a", repoURL)]).edges.length).toBe(matches ? 1 : 0);
  });
  it("prefers an exact repository credential over a template, and the longest template over a shorter one", () => {
    const exact = secret("exact", "repository", "https://github.com/acme/platform");
    const longer = secret("team", "repo-creds", "https://github.com/acme/team");
    expect(extract([creds, exact, app("a", "https://github.com/acme/platform")]).edges).toEqual([
      "Application/argocd/a needs-credential Secret/argocd/exact @spec.source.repoURL",
    ]);
    expect(extract([creds, longer, app("a", "https://github.com/acme/team/x")]).edges).toEqual([
      "Application/argocd/a needs-credential Secret/argocd/team @spec.source.repoURL",
    ]);
  });
  it("makes no edge when two credentials tie, and lists the ambiguity with both (OD-14)", () => {
    const twin = secret("twin", "repo-creds", "https://github.com/acme/");
    const x = extract([creds, twin, app("a", "https://github.com/acme/platform")]);
    expect(x.edges).toEqual([]);
    expect(
      x.r.unresolved.filter((u) => u.why !== "argocd-namespace-assumed").map((u) => [u.why, u.subject, u.candidates]),
    ).toEqual([["credential-ambiguous", "Application/argocd/a", ["Secret/argocd/org", "Secret/argocd/twin"]]]);
  });
});

describe("credentials made by an ExternalSecret (BR5.7, BR5.14)", () => {
  const template = (url: DataValue, type = "repository") => ({
    metadata: { labels: { [LABEL]: type } },
    data: { url, sshPrivateKey: "{{ .key }}" },
  });
  it("uses a literal spec.target.template.data.url and links to the Secret the ExternalSecret makes", () => {
    const x = extract([
      externalSecret("repo-platform", template("git@github.com:acme/platform.git"), { name: "repo-creds" }),
      app("a", "git@github.com:acme/platform.git"),
    ]);
    expect(x.edges).toEqual(["Application/argocd/a needs-credential Secret/argocd/repo-creds @spec.source.repoURL"]);
  });
  it.each<[string | null, string]>([
    ["{{ .url }}", "templated"],
    [null, "absent"],
    ["not a url", "not a comparable URL"],
  ])("lists a url that is %s (%s) as unresolved, with no edge", (url) => {
    const x = extract([externalSecret("repo", template(url)), app("a", "git@github.com:acme/platform.git")]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual(["credential-url-unresolved Secret/argocd/repo @spec.target.template.data.url"]);
  });
  it("lists a plain credential Secret with no url key as unresolved", () => {
    expect(extract([secret("repo", "repository", null), app("a", "https://github.com/acme/platform")]).items).toEqual([
      "credential-url-unresolved Secret/argocd/repo @data.url",
    ]);
  });
  it("is not fooled by the label on the ExternalSecret itself, a label of another value, or another kind", () => {
    const onSelf = obj(
      {
        apiVersion: "external-secrets.io/v1",
        kind: "ExternalSecret",
        metadata: { name: "x", namespace: "argocd", labels: { [LABEL]: "repository" } },
        spec: { target: { template: { data: { url: "git@github.com:acme/platform.git" } } } },
      },
      { file: "x.yaml" },
    );
    const cluster = externalSecret("c", template("git@github.com:acme/platform.git", "cluster"));
    const configMap = obj(
      {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "y", namespace: "argocd", labels: { [LABEL]: "repository" } },
        data: { url: "git@github.com:acme/platform.git" },
      },
      { file: "y.yaml" },
    );
    const x = extract([onSelf, cluster, configMap, app("a", "git@github.com:acme/platform.git")]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([]);
  });
});

describe("who needs a credential", () => {
  it("an ApplicationSet needs one for its git generators, not for its template", () => {
    const x = extract([
      secret("repo", "repository", "https://github.com/acme/platform"),
      app("set", "https://github.com/acme/platform", "ApplicationSet"),
    ]);
    expect(x.edges).toEqual([
      "ApplicationSet/argocd/set needs-credential Secret/argocd/repo @spec.generators[0].git.repoURL",
    ]);
  });
  it("a credential deployed to a foreign destination is not this Argo CD's (BR5.4)", () => {
    const foreign = secret("repo", "repository", "https://github.com/acme/platform", {
      renderJob: "Application/argocd/x#0",
    });
    expect(extract([foreign, app("a", "https://github.com/acme/platform")]).edges).toEqual([]);
  });
  it("every source of a multi-source Application", () => {
    const multi = obj(
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "m", namespace: "argocd" },
        spec: {
          sources: [
            { repoURL: "https://charts.example.org", chart: "c" },
            { repoURL: "https://github.com/acme/platform", ref: "values" },
          ],
        },
      },
      { file: "m.yaml" },
    );
    expect(extract([secret("repo", "repository", "https://github.com/acme/platform"), multi]).edges).toEqual([
      "Application/argocd/m needs-credential Secret/argocd/repo @spec.sources[1].repoURL",
    ]);
  });
});

describe("with every extractor: the credential cycle (US5.2)", () => {
  it("an Application that delivers the ExternalSecret making its own credential is a 3-edge cycle", () => {
    const appJob = job("Application/argocd/platform", "in-cluster", "apps/platform.yaml");
    const es = obj(
      {
        apiVersion: "external-secrets.io/v1",
        kind: "ExternalSecret",
        metadata: { name: "repo", namespace: "argocd" },
        spec: {
          secretStoreRef: { kind: "ClusterSecretStore", name: "s" },
          target: {
            template: { metadata: { labels: { [LABEL]: "repository" } }, data: { url: "git@github.com:acme/p.git" } },
          },
        },
      },
      { file: "manifests/es.yaml", renderJob: appJob.jobId },
    );
    const store = obj(
      {
        apiVersion: "external-secrets.io/v1",
        kind: "ClusterSecretStore",
        metadata: { name: "s" },
        spec: { provider: { fake: { data: [] } } },
      },
      { file: "store.yaml" },
    );
    const platform = app("platform", "git@github.com:acme/p.git");
    const { analysis } = analyseFixture({ objects: [es, store, platform], jobs: [appJob] }, undefined, EXTRACTORS);
    expect(analysis.cycles.map((c) => edgeLines(c.edges))).toEqual([
      [
        "Application/argocd/platform needs-credential Secret/argocd/repo",
        "ExternalSecret/argocd/repo deployed-by Application/argocd/platform",
        "Secret/argocd/repo produced-by ExternalSecret/argocd/repo",
      ],
    ]);
  });
});

describe("review fixes: Argo CD's own namespace, unlabelled Secrets, size (M1, m3, m4, n2)", () => {
  it("does not offer a credential from a namespace no Application or ApplicationSet lives in, and lists it once", () => {
    const foreign = obj(
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "c", namespace: "default", labels: { [LABEL]: "repository" } },
        stringData: { url: "https://github.com/acme/platform" },
      },
      { file: "default/c.yaml" },
    );
    const x = extract([
      foreign,
      app("a", "https://github.com/acme/platform"),
      app("b", "https://github.com/acme/platform"),
    ]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual(["credential-outside-argocd Secret/default/c @data.url"]);
  });
  it("a labelled Secret in another namespace cannot tie with, and so hide, the real credential", () => {
    const real = secret("org", "repo-creds", "https://github.com/acme");
    const squat = obj(
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "org", namespace: "kube-public", labels: { [LABEL]: "repo-creds" } },
        stringData: { url: "https://github.com/acme" },
      },
      { file: "kube-public/org.yaml" },
    );
    const x = extract([real, squat, app("a", "https://github.com/acme/platform")]);
    expect(x.edges).toEqual(["Application/argocd/a needs-credential Secret/argocd/org @spec.source.repoURL"]);
    expect(x.items).toEqual(["credential-outside-argocd Secret/kube-public/org @data.url"]);
  });
  it("an unlabelled Secret with a url, or one labelled cluster, is no credential and no item", () => {
    const plain = obj(
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "p", namespace: "argocd" },
        stringData: { url: "https://github.com/acme/platform" },
      },
      { file: "p.yaml" },
    );
    const cluster = secret("k", "cluster", "https://github.com/acme/platform");
    const x = extract([plain, cluster, app("a", "https://github.com/acme/platform")]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual([]);
  });
  it("chooses among 300,000 repo-creds without running the stack out", () => {
    const many = Array.from({ length: 300_000 }, (_, i) => ({
      secret: `Secret/argocd/c${i}`,
      type: "repo-creds" as const,
      normalised: i === 7 ? "github.com/acme/team" : "github.com/acme",
      transport: "https",
    }));
    expect(chooseCredential(many, "github.com/acme/team/x", "https")).toEqual({ chosen: "Secret/argocd/c7", tied: [] });
  });
  it("refuses a partly templated ExternalSecret url that would otherwise normalise", () => {
    const es = externalSecret("r", {
      metadata: { labels: { [LABEL]: "repository" } },
      data: { url: "https://github.com/acme/{{.repo}}" },
    });
    const x = extract([es, app("a", "https://github.com/acme/%7B%7B.repo%7D%7D")]);
    expect(x.edges).toEqual([]);
    expect(x.items).toEqual(["credential-url-unresolved Secret/argocd/r @spec.target.template.data.url"]);
  });
});

describe("pass 2: Argo CD's control-plane namespace from the estate (M1, m4, n4)", () => {
  const labelled = (ns: string, name: string, type = "repository", url = "https://github.com/acme/platform") =>
    obj(
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name, namespace: ns, labels: { [LABEL]: type } },
        stringData: { url },
      },
      { file: `${ns}/${name}.yaml` },
    );
  const appIn = (ns: string, name: string, repoURL = "https://github.com/acme/platform") =>
    obj(
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name, namespace: ns },
        spec: { source: { repoURL, path: "." } },
      },
      { file: `${ns}/${name}-app.yaml` },
    );
  const argocdCm = (ns: string) =>
    obj(
      { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "argocd-cm", namespace: ns } },
      { file: `${ns}/cm.yaml` },
    );
  const workload = (kind: string, ns: string, name: string) =>
    obj({ apiVersion: "apps/v1", kind, metadata: { name, namespace: ns }, spec: {} }, { file: `${ns}/${name}.yaml` });

  it("takes the namespace of Argo CD's own install (argocd-cm) when the Applications sit there, and lists how", () => {
    const x = extract([argocdCm("argocd"), labelled("argocd", "repo"), appIn("argocd", "b")]);
    expect(x.edges).toEqual(["Application/argocd/b needs-credential Secret/argocd/repo @spec.source.repoURL"]);
    expect(x.r.unresolved.map((u) => [u.why, u.subject, u.candidates])).toEqual([
      ["argocd-namespace-derived", "Namespace/argocd", ["ConfigMap/argocd/argocd-cm"]],
    ]);
  });
  it("an install whose namespace disagrees with the Applications' is not believed: unknown, no edge (pass 3, M1)", () => {
    const x = extract([argocdCm("argocd"), labelled("argocd", "repo"), appIn("team-a", "b")]);
    expect(x.edges).toEqual([]);
    expect(x.all).toEqual(["argocd-namespace-unknown argocd-namespace"]);
  });
  it("takes it from the repo server or application controller workload too", () => {
    for (const w of [
      workload("Deployment", "gitops", "argocd-repo-server"),
      workload("StatefulSet", "gitops", "argocd-application-controller"),
    ]) {
      const x = extract([w, labelled("gitops", "repo"), labelled("argocd", "other"), appIn("gitops", "a")]);
      expect(x.edges).toEqual(["Application/gitops/a needs-credential Secret/gitops/repo @spec.source.repoURL"]);
      expect(x.all).toEqual([
        "argocd-namespace-derived Namespace/gitops",
        "credential-outside-argocd Secret/argocd/other",
      ]);
    }
  });
  it("never offers a labelled Secret beside an Application outside that namespace", () => {
    const x = extract([
      argocdCm("argocd"),
      labelled("kube-public", "c"),
      appIn("argocd", "a"),
      appIn("argocd", "b", "https://github.com/acme/other"),
    ]);
    expect(x.edges).toEqual([]);
    expect(x.all).toEqual([
      "argocd-namespace-derived Namespace/argocd",
      "credential-outside-argocd Secret/kube-public/c",
    ]);
  });
  it("with no install, assumes the one namespace every Application sits in, and lists the assumption", () => {
    const x = extract([labelled("argocd", "repo"), appIn("argocd", "a"), appIn("argocd", "b")]);
    expect(x.edges).toHaveLength(2);
    expect(x.r.unresolved.map((u) => [u.why, u.subject, u.field])).toEqual([
      ["argocd-namespace-assumed", "Namespace/argocd", null],
    ]);
  });
  it("with no install and Applications in two namespaces, makes no credential edge and lists one item", () => {
    const x = extract([labelled("argocd", "repo"), appIn("argocd", "a"), appIn("team-a", "b")]);
    expect(x.edges).toEqual([]);
    expect(x.r.unresolved.map((u) => [u.why, u.candidates])).toEqual([
      ["argocd-namespace-unknown", ["Namespace/argocd", "Namespace/team-a"]],
    ]);
  });
  it("with installs in two namespaces, the namespace is unknown", () => {
    const x = extract([argocdCm("a"), argocdCm("b"), labelled("a", "repo"), appIn("a", "x")]);
    expect(x.edges).toEqual([]);
    expect(x.all).toEqual(["argocd-namespace-unknown argocd-namespace"]);
  });
  it("with no Application at all, a labelled Secret is listed under the unknown namespace, once (n4)", () => {
    const x = extract([labelled("argocd", "repo")]);
    expect(x.all).toEqual(["argocd-namespace-unknown argocd-namespace"]);
  });
  it("with no credential at all, no namespace item is made", () => {
    expect(extract([appIn("argocd", "a"), appIn("team", "b")]).all).toEqual([]);
  });
  it("lists a foreign credential once per Secret, however many objects define it (m4)", () => {
    const es = obj(
      {
        apiVersion: "external-secrets.io/v1",
        kind: "ExternalSecret",
        metadata: { name: "c", namespace: "kube-public" },
        spec: {
          target: {
            template: {
              metadata: { labels: { [LABEL]: "repository" } },
              data: { url: "https://github.com/acme/platform" },
            },
          },
        },
      },
      { file: "kube-public/es.yaml" },
    );
    const x = extract([argocdCm("argocd"), labelled("kube-public", "c"), es, appIn("argocd", "a")]);
    expect(x.all).toEqual([
      "argocd-namespace-derived Namespace/argocd",
      "credential-outside-argocd Secret/kube-public/c",
    ]);
  });
});

describe("pass 3: install objects by Argo CD's exact names, corroborated, always listed (M1, m1)", () => {
  const labelled = (ns: string, name: string) =>
    obj(
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name, namespace: ns, labels: { [LABEL]: "repository" } },
        stringData: { url: "https://github.com/acme/platform" },
      },
      { file: `${ns}/${name}.yaml` },
    );
  const appIn = (ns: string, name: string) =>
    obj(
      {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name, namespace: ns },
        spec: { source: { repoURL: "https://github.com/acme/platform", path: "." } },
      },
      { file: `${ns}/${name}-app.yaml` },
    );
  const workload = (ns: string, name: string, labels: Record<string, string> = {}, renderJob: string | null = null) =>
    obj(
      { apiVersion: "apps/v1", kind: "Deployment", metadata: { name, namespace: ns, labels }, spec: {} },
      {
        file: `${ns}/${name}.yaml`,
        renderJob,
      },
    );
  const cm = (ns: string, renderJob: string | null = null) =>
    obj(
      { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "argocd-cm", namespace: ns } },
      { file: `${ns}/cm.yaml`, renderJob },
    );

  it("a decoy whose name only ends like the repo server is no install: the Applications' namespace is assumed", () => {
    const x = extract([
      workload("kube-public", "evil-argocd-repo-server"),
      labelled("kube-public", "c"),
      labelled("argocd", "real"),
      appIn("argocd", "a"),
    ]);
    expect(x.edges).toEqual(["Application/argocd/a needs-credential Secret/argocd/real @spec.source.repoURL"]);
    expect(x.all).toEqual([
      "argocd-namespace-assumed Namespace/argocd",
      "credential-outside-argocd Secret/kube-public/c",
    ]);
  });
  it("a lone argocd-cm elsewhere than the Applications makes the namespace unknown, never a credential edge", () => {
    const x = extract([
      cm("kube-public"),
      labelled("kube-public", "c"),
      labelled("argocd", "real"),
      appIn("argocd", "a"),
    ]);
    expect(x.edges).toEqual([]);
    expect(x.all).toEqual(["argocd-namespace-unknown argocd-namespace"]);
  });
  it("argocd-server counts by its exact name; a release-prefixed name counts only with the part-of label", () => {
    const exact = extract([workload("argocd", "argocd-server"), labelled("argocd", "r"), appIn("argocd", "a")]);
    expect(exact.all).toEqual(["argocd-namespace-derived Namespace/argocd"]);
    const prefixed = extract([
      workload("argocd", "rel-argocd-application-controller", { "app.kubernetes.io/part-of": "argocd" }),
      labelled("argocd", "r"),
      appIn("argocd", "a"),
    ]);
    expect(prefixed.r.unresolved.map((u) => [u.why, u.candidates])).toEqual([
      ["argocd-namespace-derived", ["Deployment/argocd/rel-argocd-application-controller"]],
    ]);
    const unlabelled = extract([
      workload("argocd", "rel-argocd-application-controller"),
      labelled("argocd", "r"),
      appIn("argocd", "a"),
    ]);
    expect(unlabelled.all).toEqual(["argocd-namespace-assumed Namespace/argocd"]);
  });
  it("an install object rendered for a foreign destination is another cluster's, and is not read (m1)", () => {
    const foreignJob = job("Application/argocd/x", "cluster-b");
    const x = extract([cm("team", foreignJob.jobId), labelled("argocd", "r"), appIn("argocd", "a")], [foreignJob]);
    expect(x.edges).toHaveLength(1);
    expect(x.all).toEqual(["argocd-namespace-assumed Namespace/argocd"]);
  });
});
