# Vault fixture: the two documented edits

Each variant is an overlay: its files replace or add files of the base fixture (`../gitops`,
`../platform`), and nothing else changes.

- `crank-a/`: `gitops/crankpath.yaml` declares the manual step that breaks cycle A, a crank that
  creates the platform repository credential Secret before Argo CD needs it.
- `ca-issuer/`: Vault's Certificate is issued by a `ca` ClusterIssuer whose CA Secret is seeded at
  bootstrap from the platform-secrets Vault, so cycle B is gone.
