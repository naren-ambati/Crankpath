# Vault fixture: the app-of-apps repository

A hand-written sample estate for crankpath's tests (FR11.3). Every file here was written for this
fixture; nothing is copied from any chart or project. The organisation `acme` and the account id
`111122223333` are placeholders.

- `bootstrap/root.yaml`: the root Application (applied by hand; Argo CD and cert-manager are
  installed outside this repository).
- `apps/`: the Applications `platform` (the private repository `git@github.com:acme/platform.git`),
  `vault` and `external-secrets` (public charts with values from the platform repository),
  `platform-secrets` (a second Vault release configured from this repository only), and the
  ClusterSecretStore that reads the platform-secrets Vault.

The private platform repository is `../platform` (read with
`--repo-alias git@github.com:acme/platform.git=<path to ../platform>`). What the two Helm charts
render is hand-written in the shape that matters under `../rendered`.
