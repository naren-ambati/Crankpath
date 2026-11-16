# Bolt B4 review, third pass: the second review's fixes

- Bolt: B4, branch `bolt/b4`, commit reviewed `314e01a` (fixes `b28973b..314e01a`: `2bdd371` tests first and the root-zone data, `314e01a` code and notes).
- Date: 2026-11-15
- Reviewer: Claude Sonnet 5.5, independent read-only review

Scope: only the pass-2 fixes and where they meet existing logic. Method: scratch clone, repro tests through the extractors, 11 one-at-a-time code mutations against the u5, u6, u8 and u11 tests, the tests-first commit run against the old code, and a byte comparison of the root-zone data with the registry file (read-only GET, same version line and sha256 as the one recorded).

## 1. Findings

Counts: Major 1, Minor 3, Nit 3.

| id | severity | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|---|
| M1 | Major | `credential-extractor.ts` `isArgoInstallObject` and `argoNamespace` | The install is recognised by object names the repo controls, and a lone decoy is believed with no item. With no real Argo CD install in the estate, a Deployment `evil-argocd-repo-server` (the suffix test) or a ConfigMap `argocd-cm` in `kube-public`, plus a labelled Secret there for the same URL, gives `Application/argocd/a needs-credential Secret/kube-public/c`, the real credential in `argocd` becomes `credential-outside-argocd`, and no `argocd-namespace-assumed` item appears (how is `install`, which prints nothing). Same wrong result as pass 2 M1, now reached through the install rule. Two decoys or a decoy beside the real install fall to `unknown` (safe: one item, no credential edge), so only the lone decoy is silent. | CONFIRMED (repro A: edge to `Secret/kube-public/c`, one `credential-outside-argocd` for `argocd/real`, no assumption item; repro D with a lone decoy `argocd-cm` is the same) | Treat the install rule as an assumption too: always list the namespace used and how (`install`, from which object), and require two kinds of install object in one namespace (or match the exact upstream names or the `app.kubernetes.io/part-of: argocd` label) before it outranks the Applications' own namespace. |
| m1 | Minor | `credential-extractor.ts` `argoNamespace`, the `bucketOf(o, ctx) !== IN_CLUSTER` skip | The skip of objects with a foreign destination has no test: replacing it with `false` keeps all 340 tests green (mutation `foreign`). A repo's install object rendered for another cluster would then count as this cluster's Argo CD. | CONFIRMED (mutation survives) | Add a test with an `argocd-cm` that a foreign-destination job renders; expect it ignored. |
| m2 | Minor | `external-host.ts` `urlHost` (callers in `secret-store-extractor.ts`, `cert-manager-extractor.ts`, `vault-seal-extractor.ts`) | An IPv6 literal with a zone id (`http://[fe80::1%25eth0]`) fails URL parsing, so `urlHost` returns null and the callers make no edge and no item: the pass-2 m3 silent drop remains for this form (and for any unparseable server URL). | CONFIRMED (`urlHost` null, caller skips on null) | Where a field holds text but `urlHost` is null, list `address-missing` or `host-unplaced` with the quoted raw text. |
| m3 | Minor | `docs/limits.md`, README | The root-zone rule (a two-label name is public only when its last label is a delegated top-level domain) is in the source header and BUILD-NOTES only; reserved names (`x.example`, `x.test`, `x.internal`, `x.localhost`) are correctly unplaced but a reader cannot learn that. | CONFIRMED (grep) | One line in the limits doc. |
| n1 | Nit | `vault-seal-extractor.ts` `disabledOf` | Vault also accepts `"TRUE"`, `"True"`, `"t"`, `"1"` and the like for a string boolean; those are `seal-unreadable` (honest, listed, never a crash). | CONFIRMED | Fine; say so in the header. |
| n2 | Nit | `docs/lookups.md`, `NOTICE` | The registry list is committed without a NOTICE line (the lead is asked in BUILD-NOTES). The data is a list of public facts; a one-line provenance entry in NOTICE costs nothing. | PLAUSIBLE | Add one line, or record the decision. |
| n3 | Nit | `argoNamespace` | A Deployment of the install named like `argocd-repo-server` in `apps/v1` only; `argoproj.io` objects such as `AppProject` are not used. Fine; a lone `argocd-cm` in a Helm release with a prefix is not recognised and falls to the assumption, which is listed. | CONFIRMED | None. |

## 2. Pass-2 findings, one by one

| pass 2 | status | evidence |
|---|---|---|
| M1 Argo CD's namespace | Mostly fixed. Two installs, a decoy beside the real install, Applications in two namespaces, no Application: all `unknown` with no credential edge and one item (repros B, C and the new tests). The assumption item always appears when the Applications' namespace is used (the code pushes it before any edge). No credential edge appears when the namespace is unknown. Remaining hole: a lone decoy install, new M1. A decoy `argocd-cm` in another namespace beside real Applications and no real install is the same case. | repros A to E; mutations `install2` (1 red), `suffix` (1 red) |
| M2 bare hosts of stores and issuers | Fixed. `bareNamespace` is null in the store, issuer, Argo and Flux callers; only the Vault transit seal passes the StatefulSet's namespace (the Vault pod dials). No other path resolves a bare name: `HostMatcher` uses a namespace only when given one. | grep of `bareNamespace`; mutation `ambig1` (4 red) |
| m1 root-zone list | Fixed. 1,436 entries, identical to the registry file (same version line, same sha256, no missing or extra entry, sorted, no duplicates). The version is recorded in the data module, `docs/lookups.md` and a test. Used only by `externalHostName`. A namespace named like a top-level domain (`com`) makes that host unplaced, tested (mutation `override`: 1 red; mutation `tldset`: 10 red). It cannot make an edge. | byte comparison |
| m2 `disabled` strings | Fixed for `"true"` and `"false"` (two mutations, 1 red each); other strings refused, new n1. | |
| m3 IPv6 | Fixed for bracketed literals (`[fd00::1]`, `[::1]`, mapped addresses are normalised to hex and kept): none is external, each is a `host-unplaced` item. Zone-id form still dropped: new m2. | repro host table |
| m4 once per secret | Fixed (mutation `dedupe`: 1 red). | |
| m5 unplaced, in-cluster | Fixed: items carry the host. | |
| value on items | Text: `quote("host:", value)` after a label on the indented `where:` line, never at a line start, escaped like every other quoted field (mutations `textvalue`, `hostlabel`: 1 red each). JSON: the canonical pass runs every string, `value` included, through the JSON text escaper; null when absent. The only producer is `placeHost`, whose host comes from `urlHost` (URL-normalised, no control characters). No other renderer prints items. | code read, mutations |

Tests-first commit `2bdd371` against the old code: 28 failed, 544 passed (the four `cli-e2e` failures need `dist`; the rest are the new tests), so the pass-2 tests do fail on the old behaviour.

## 3. Tests that cannot fail

- The foreign-destination skip inside `argoNamespace` (m1).
- No other new test survived a mutation of its code.

## 4. Checked and sound

- `argoNamespace` precedence, the `unknown` fallbacks and the item subjects; `found.length === 0` returns before any namespace item, so a repo without credentials gets no noise.
- Reserved and private names (`.example`, `.test`, `.internal`, `.localhost`, `.invalid`, `.local`) are not external.
- IPv4 forms (`127.1`, `0x7f.1`, decimal) are normalised by the URL parser to dotted quads and refused as externals.
- Hard rules for the added lines: identity (`naren-ambati` noreply, Opus trailer), no personal path, no design-tool name, no change to `LICENSE` or `package.json`.

## 5. Verdict

Ready to merge after fixes: M1 (a lone decoy install object silently fixes Argo CD's namespace) is the same class of wrong analysis result as pass 2's M1; the rest are Minor and Nit.
