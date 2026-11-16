# Review record: golden case `vault-edited`

**State: pinned** (`expected.json`, `expected.txt`) from the run reviewed below, after the build
lead's review for the owner (BR11.6).

## The run

- **Input:** the Vault fixture with the overlays `variants/ca-issuer` (Vault's Certificate from
  a `ca` ClusterIssuer whose CA Secret an ExternalSecret seeds from the platform-secrets Vault) and
  `variants/both-edits` (the `creates: Secret/argocd/repo-platform` crank, and the three externals
  declared available as a runbook would state them), copied in that order over `gitops/` and
  `platform/`. Charts, aliases, tools and cache as in `test/golden/vault/reviewed.md`.
- **Command:** `CRANKPATH_GOLDEN_CACHE=<cache> node scripts/golden.mjs --observe --case
  vault-edited`, 2026-11-16; full output in the cache (`runs/vault-edited/`).

## Observed (reduced summary)

- Run status `ANALYSED WITH GAPS`, reason `unresolved-items` (1: `argocd-namespace-assumed`); 5
  sources, 0 opaque; 49 nodes (46 objects, 3 externals), 78 edges, all extracted.
- Cycle A `c-35505771`, **cranked (was extracted)**, cranked by `crank:1`, 3 nodes, 3 edges.
  Cycle B: **gone**. No other cycle.
- Externals: the three, each `available` (declared, not verified).
- Statuses: 46 of 46 objects startable. Plan: **15 steps, one manual**: step 1 `crank:1` creates
  `Secret/argocd/repo-platform`; step 2 `Application/argocd/root`; step 3 the four Applications; …;
  step 8 the two ExternalSecrets; step 9 `Secret/cert-manager/bootstrap-ca`; step 10
  `ClusterIssuer/bootstrap-ca`; step 11 `Certificate/vault/vault-tls`; step 12
  `Secret/vault/vault-tls`; step 13 `StatefulSet/vault/vault`; step 14 Vault's two Services;
  step 15 `ClusterIssuer/vault-pki`. 0 listed unordered, 0 conflicts. The plan assumes the three
  externals and `crank:1`.

## Compared with the research's expectations (research section 6, part 2; AC11.3.2)

1. A `cranked` as plan step 1: **as expected.**
2. B gone after the `ca` switch: **as expected.**
3. "A fully ordered plan with one marked manual step": **as expected**, given the three externals
   declared available. The research's two edits alone leave the externals unspecified, and then
   the plan stops at what needs them (the B5 test shows it); the research's own crankpath.yaml
   declares them available, so `both-edits` does too. Recorded as a deviation (the fixture's
   second variant carries a third declaration).
4. `ClusterIssuer/vault-pki` remains (step 15): the edit switches the Certificate's issuer and
   leaves the Vault-PKI issuer defined, as the research describes the edit.
5. The run is `ANALYSED WITH GAPS`, not `ANALYSED`: the assumed Argo CD namespace is an
   unresolved item. The research does not state the run status here; this is B4's and B5's
   documented behaviour.

## Edits

- 2026-11-16, after the review: the hand-applied-root change (B7, FR7.4; a `render:<path>` crank of a chart
  or Kustomize directory) adds two JSON keys, `runStatus.counts.sourcesByKind.HandAppliedChart` (0) and
  `undeployedCharts` (`[]`). Re-pinned with `--pin` from a real run whose diff against the reviewed
  `expected.json` is exactly those two lines; `expected.txt` is byte-identical to the reviewed one.
  Nothing the review checked changed.
- 2026-11-16, after the merge of B3 (`ede1900`): B3's additive JSON keys `clustersUsed` (`[]`) and, on each
  repository mapping, `commit`, `failure` (null) and `floating` (false). Re-pinned from a real run whose
  diff against the pinned `expected.json` adds exactly those lines and removes none; `expected.txt` is
  byte-identical. Nothing the review checked changed.

Before that, none.

## Mutations (each must change the result; observed 2026-11-16)

- `remove-crank`: cycle A extracted and uncranked again; the plan's first step is no crank.
- `undo-ca-issuer`: cycle B back (2 cycles: A cranked, B extracted).
- `drop-platform-alias`: 0 cycles, 3 sources opaque; the crank matches no object.

## Review (BR11.6)

Reviewed by the build lead for the owner, 2026-11-16. Checked: cycle A cranked by `crank:1`, cycle B gone, a 15-step plan with one manual step (the crank, step 1), given the three externals declared available; the differences from the research as explained above. The full form is kept:
object names, kinds and field paths are not template text or rendered manifests, so OD-6 holds.
Approved as observed; pinned with `node scripts/golden.mjs --pin vault-edited` on 2026-11-16.

## Pinned output (review m5)

`--pin` writes the expected files only when the run's output has these digests, which are those of the
output the review above saw:

expected.json sha-256: c2899a698315b11210a0b6079eece0093fc3bc69bfe04831ba592cdceb1e587f
expected.txt sha-256: fb734042660570bec946d19a3208c1c182f116502d830b931a64b8a8a7f90e8d
