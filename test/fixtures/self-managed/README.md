# Self-managed Argo CD fixture (B6, US5.4)

A small app-of-apps estate in FixtureKit's form (`rendered/jobs.yaml`): the root Application renders the
`system/` directory, which holds the Gitea Application and Argo CD's own install (its application
controller StatefulSet and repo server Deployment, with the upstream install's labels); Gitea serves the
repository every Application reads. The root Application, the Gitea Application and the Gitea Service
form a cycle, and the root Application renders Argo CD's controller: `--explain` names the
self-management pattern, and nothing else in any output changes because of it (BR5.13).

Hand-written: no upstream manifest is copied; the labels are the ones the upstream install sets
(`app.kubernetes.io/part-of: argocd` and the component label, read-only lookup recorded in
`docs/lookups.md`).
