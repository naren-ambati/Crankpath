# The Vault fixture

A hand-written sample estate (FR11.3, FR11.4): an app-of-apps repository with a private
`platform` repository, Vault and the External Secrets Operator from public charts, Vault TLS from
a Vault-PKI ClusterIssuer, AWS KMS auto-unseal and IAM roles for service accounts. Nothing here is
copied from any chart or project; `acme`, `example.org` and the account id `111122223333` are
placeholders.

- `gitops/`: the scanned repository (`https://github.com/acme/platform-gitops`).
- `platform/`: the private repository `git@github.com:acme/platform.git`.
- `rendered/`: hand-written stand-ins for what the Helm Applications render, and `jobs.yaml`,
  which FixtureKit (`test/helpers/fixture-kit.ts`) reads to build each render job's objects.
- `variants/`: the two documented edits, as overlays.

What the tests over `rendered/` assert (`test/u11-validation-harness/vault-fixture.test.ts`):

- cycle A, 3 nodes and 3 edges: Application `argocd/platform` needs credential Secret
  `argocd/repo-platform`, produced by ExternalSecret `argocd/repo-platform`, deployed by
  Application `argocd/platform`;
- cycle B, 5 nodes and 5 edges: Certificate `vault/vault-tls` issued by ClusterIssuer `vault-pki`,
  which depends on Service `vault/vault` (its `spec.vault.server`), which selects StatefulSet
  `vault/vault`, which needs Secret `vault/vault-tls`, produced by the Certificate;
- three externals with unspecified cold-start availability: `github.com`, `aws-kms/us-east-1` and
  `aws-sts`, and nothing else unresolved except one item saying Argo CD's namespace is assumed to
  be `argocd` (Argo CD is installed outside this repository, and every Application sits there).

The ClusterSecretStore reads a second Vault release, `platform-secrets`, configured from the public
repository only, so cycles A and B stay separate strongly connected components.

The end-to-end golden over `gitops/` and `platform/` with real rendering is not here: the
`vault`, `platform-secrets` and `external-secrets` Applications name their charts as git sources on
github.com (so that github.com is the only host they need), which a run renders only with those
repositories fetched (`repos:` fetch entries) and helm installed.
