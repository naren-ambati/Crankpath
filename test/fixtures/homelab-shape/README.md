# The homelab shape (B3 definition of done)

A hand-written fixture of one estate shape: a root ApplicationSet whose git generator reads an
in-cluster forge (`http://gitea-http.gitea:3000/ops/homelab`) and generates one Application per
directory under `system/*`, `platform/*` and `apps/*`; `platform/gitea` holds the forge's Service and
Deployment; `system/argocd` holds the root ApplicationSet itself (and a stand-in controller). It is
written from the general Argo CD pattern for this research's description of the shape; nothing is
copied from any repository.

- `repo/` is the scanned checkout.
- `expected-without-alias.txt`: `crankpath . --repo-url https://git.example.org/ops/homelab`, run in
  `repo/`: the ApplicationSet is opaque `unreadable-repo` with the suggested `repos:` entry.
- `expected-with-alias.txt`: the same with `--repo-alias http://gitea-http.gitea:3000/ops/homelab=.`
  (one declared repo identity, no declared edges): both cycles (the forge serving its own
  ApplicationSet, and the ApplicationSet generating the Application that deploys it) lie in one
  strongly connected component.
