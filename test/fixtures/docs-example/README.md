# The documentation example

A small estate written for crankpath's documentation (crankpath's own work, no upstream): an Argo CD
Application `argocd/gitea` deploys Gitea from `platform/gitea` and reads its own Git source from
that Gitea, and a second Application `argocd/notes` reads from the same Gitea. The documents quote
crankpath's output over `repo/`, with and without `cranked.yaml` (passed with `--config`);
`test/u12-docs-release/doc-claims.test.ts` re-runs each quoted command and compares the quote
with the output.
