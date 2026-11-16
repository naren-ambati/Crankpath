# The hand-applied root fixture

A hand-written estate for crankpath's tests (FR7.4, the `render:<path>` crank of a directory applied
by hand at bootstrap). Nothing here is copied from any project.

- `repo/system/argocd/`: a Helm chart nothing in the repository deploys; its templates are plain
  YAML (no template functions), so real helm and the tests' fake helm render the same objects:
  the Applications `argocd/argocd` (which renders this same chart) and `argocd/gitea`, and a
  Deployment `argocd-server` with no namespace of its own.
- `repo/platform/gitea/`: plain manifests, the in-cluster Git server's Service and Deployment that
  both Applications read their repository from (`http://gitea-http.gitea:3000/ops/estate`).
- `repo/tools/unused/`: a second chart nothing deploys and no crank names.

Scanned with `--repo-url http://gitea-http.gitea:3000/ops/estate`. With no crankpath.yaml the
repository holds no source document: the run is NOTHING ANALYSED and lists the two chart
directories. (The tests add a Kustomize root where they need one.) With the crank `creates: render:system/argocd` (namespace
`argocd`), the chart is rendered as a hand-applied root, the Applications it renders are planned
and rendered in turn, and the cycle through Gitea is `cranked`.
