# Review record: golden case `homelab`

**State: pinned** (`expected.json`, `expected.txt`, reduced form) after the build lead's review for the
owner. khuedoan/homelab is GPL-3.0: this file, like the expected output, holds node ids, crankpath's
own words and counts only.

## The run

- **Input:** khuedoan/homelab at `8b9d40f51e528bcc642ea9d052eecfc7c23b5cda` (resolved from `8b9d40f`
  on 2026-11-16), cloned read-only into the golden cache, copied without `.git` for each run; scanned
  with `--repo-url https://github.com/khuedoan/homelab` and exactly one alias,
  `--repo-alias http://gitea-http.gitea:3000/ops/homelab=<the checkout>`; no crankpath.yaml, no
  declared edge. helm v4.3.2, kustomize v5.8.1, network up; crankpath at B7 with B3 merged.
- **Command:** `CRANKPATH_GOLDEN_CACHE=<cache> node scripts/golden.mjs --observe --case homelab`,
  2026-11-16. The full output is in the cache only (`runs/homelab/`).

## Observed (reduced form)

- Run status `NOTHING ANALYSED`, reason `no-sources`, exit 2; counts a floor (1 unreadable file).
- 0 nodes, 0 edges, 0 cycles. Not deployed by anything read: 31 chart directories, 0 Kustomize
  roots (each listed with the suggestion to declare a `creates: render:<path>` crank). The one
  repository mapping (the alias) is unused.

## Compared with the research's expectations (research section 6, part 1)

1. The research expects cycle 1 and cycle 2 `extracted` without the crank. The run analyses nothing:
   nothing in the estate deploys `system/argocd`, whose chart renders the root ApplicationSet. The
   research's uncranked expectation was a hand trace that rendered `system/argocd` by hand (lead
   decision for B7, FR7.4), not a crankpath bug.
2. The mutation `add-entry-application` (an Application of crankpath's own that deploys
   `system/argocd`) shows what the research traced: both cycles appear, `extracted`, in one strongly
   connected component of 13 nodes and 24 edges (with the added Application). The node set:
   `Application/argocd/argocd`, `Application/argocd/bootstrap` (the added one),
   `Application/argocd/gitea`, `Application/argocd/global-secrets`, `ApplicationSet/argocd/root`,
   `ClusterSecretStore/global-secrets`, `Deployment/gitea/gitea`, `ExternalSecret/gitea/gitea-admin-secret`,
   `Secret/gitea/gitea`, `Secret/gitea/gitea-admin-secret`, `Secret/gitea/gitea-init`,
   `Secret/gitea/gitea-inline-config`, `Service/gitea/gitea-http`.

## Mutations (each must change the result and meet its expectation)

- `add-entry-application`: ANALYSED WITH GAPS, 1 cycle, extracted.
- `remove-gitea`: still NOTHING ANALYSED, 30 chart directories listed.

## Review (BR11.6)

Reviewed by the build lead for the owner, 2026-11-16: approved as observed (NOTHING ANALYSED, 31 chart
directories listed, exit 2; the research's uncranked expectation was a hand trace that rendered
`system/argocd` by hand). Pinned with `node scripts/golden.mjs --pin homelab` on 2026-11-16.

## Edits

- 2026-11-16, B7 review fixes: the reduced form counts unreadable files by outcome (`parse-error`) instead of
  their wording (`not valid YAML`), and lists the opaque source nodes (`opaque.nodes`); a real run's
  diff against the pinned files is exactly those lines (review m1, m6). Re-pinned under the digests below;
  nothing the review checked changed.

## Pinned output (review m5)

`--pin` writes the expected files only when the run's output has these digests, which are those of the
output the review above saw:

expected.json sha-256: a58248217f44438c98522b887675f56ebb643c690e797ead29926fb53171bea0
expected.txt sha-256: f492d8ab15476381ddb646e35f946489cf94bff0f76d8a08a693c7136b542530
