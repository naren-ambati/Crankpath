# Review record: golden case `vault`

**State: pinned** (`expected.json`, `expected.txt`) from the run reviewed below, after the build
lead's review for the owner (BR11.6).

## The run

- **Input:** the committed fixture `test/fixtures/vault` (`gitops/` scanned, `platform/` read
  through `--repo-alias git@github.com:acme/platform.git=<tree>/platform`), no crankpath.yaml, no
  declared edge. The two public charts are git sources on github.com; crankpath reads a git chart
  source only under the repo-identity rule, so each is read through `--repo-alias` from a
  read-only clone in the golden cache at its pinned commit: hashicorp/vault-helm `v0.34.1` =
  `aa1c92e4adddbce9660e536dfe5222a88eda6d52`, external-secrets/external-secrets
  `helm-chart-2.9.0` = `cc5bfbc2234ace9cb0caff4ea89c435cf517b27b` (sparse:
  `deploy/charts/external-secrets`). Nothing of either chart is committed (vault-helm is MPL-2.0).
- **Tools:** helm v4.3.2 and kustomize v5.8.1 (the tested pair), network up (helm runs
  `helm dependency build` for the external-secrets chart's OCI dependency).
- **Command:** `CRANKPATH_GOLDEN_CACHE=<cache> node scripts/golden.mjs --observe --case vault`,
  2026-11-16; the full output is in the cache (`runs/vault/observed.{json,txt}`). Two runs gave
  byte-identical JSON and text; neither holds a path of the machine.

## Observed (reduced summary)

- Run status `ANALYSED WITH GAPS`, reason `unresolved-items` (4); 5 sources (5 Applications), 0
  opaque, 0 unreadable files, 0 skipped objects, 2 Helm test hooks dropped; 5 floating revisions
  (the tags and `main`), listed, not a gap.
- 46 nodes (43 objects and 3 externals), 73 edges, all extracted.
- Cycle A `c-35505771`, extracted, 3 nodes, 3 edges: `Application/argocd/platform needs-credential
  Secret/argocd/repo-platform`, `Secret/argocd/repo-platform produced-by
  ExternalSecret/argocd/repo-platform`, `ExternalSecret/argocd/repo-platform deployed-by
  Application/argocd/platform`.
- Cycle B `c-ba4047ac`, extracted, 5 nodes, 5 edges: `Certificate/vault/vault-tls issued-by
  ClusterIssuer/vault-pki`, `ClusterIssuer/vault-pki depends-on Service/vault/vault`,
  `Service/vault/vault selects StatefulSet/vault/vault`, `StatefulSet/vault/vault needs-secret
  Secret/vault/vault-tls`, `Secret/vault/vault-tls produced-by Certificate/vault/vault-tls`.
- Externals: `external:aws-kms/us-east-1`, `external:aws-sts`, `external:github.com`, each cold
  start `unspecified` (UNRESOLVED, never available). Unresolved items: 3 `external-unspecified`
  and 1 `argocd-namespace-assumed`. Nothing else uncranked.
- Not startable: 43 of 43 objects blocked: 27 by cycle A, 6 by cycle B, 5 by `github.com`, 3 by
  `aws-kms/us-east-1`, 2 by `aws-sts`. Plan: no steps; 43 listed unordered.

## Compared with the research's expectations (research section 6, part 2; AC11.3.1)

1. Cycle A, 3 edges: **as expected.**
2. Cycle B: the research says 4 edges; the run has **5 nodes and 5 edges**. A hand-trace error in
   the research, not a crankpath bug: the research elided Secret `vault/vault-tls` in B while
   counting the Secret in A; with every object a node (OD-3) B is 5. The edges are the ones the
   research names, plus the Secret's two.
3. The three externals: **as expected**, each unspecified.
4. "Unreachable from cold start: everything behind either cycle": the run blocks every object,
   and names 10 of them as blocked by an unspecified external rather than by a cycle
   (`platform-secrets`'s Vault, which needs `aws-kms`, its ServiceAccounts, which need `aws-sts`,
   and `root`, `platform-secrets` and the store, which need `github.com`). Not a bug: an external
   with undeclared cold start is never available (BR7.13; the research's own crankpath.yaml
   declares them); the research's sentence names only the cycles.
5. "Nothing else uncranked": **as expected** (no other cycle, no opaque source). The one further
   unresolved item, the assumed Argo CD namespace, is B4's documented assumption (Argo CD is
   installed outside the fixture).
6. Object count: the real charts render 38 objects (vault 6, platform-secrets 6, external-secrets
   19, plus the platform repository's 6 and root's 1) where B4's hand-written stand-ins had fewer;
   B4 said the golden would differ in object count. The cycles, externals and seal and identity
   edges are the stand-ins' (`vault-fixture.test.ts`), so the stand-ins hold the shape that
   matters.

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

Before that, none to crankpath, the fixture or the expected output. The fixture's git chart sources render as
written (no fixture change needed).

## Mutations (each must change the result; observed 2026-11-16)

- `drop-platform-alias`: 0 cycles, 3 sources opaque.
- `remove-credential-label`: cycle A gone, 1 cycle left (B).
- `rename-vault-service` (`fullnameOverride: vault-main`): cycle B gone, 1 cycle left (A).

## Review (BR11.6)

Reviewed by the build lead for the owner, 2026-11-16. Checked: cycle A 3 nodes/3 edges and cycle B 5 nodes/5 edges, both extracted; the three externals with unspecified cold start; the assumed Argo CD namespace; nothing else uncranked; the five differences from the research (1 a hand-trace error in the research; 2, 4 and 5 correct behaviour; 3 the real charts). The full form is kept:
object names, kinds and field paths are not template text or rendered manifests, so OD-6 holds.
Approved as observed; pinned with `node scripts/golden.mjs --pin vault` on 2026-11-16.

## Pinned output (review m5)

`--pin` writes the expected files only when the run's output has these digests, which are those of the
output the review above saw:

expected.json sha-256: cfda59e07d190a480cf1654ed8036dfa3caf7ccdf7f3368d57d075b0c8511b6c
expected.txt sha-256: 34190c81fee13d72cc7c7f51fca850562395a0508900b44de6d46833dc7f9fd7
