# Bolt B4 review, second pass: the first review's fixes

- Bolt: B4 (extractors and the Vault fixture), branch `bolt/b4`, commit reviewed `b28973b` (fixes `5f71bba..b28973b`: `c6e7ab7` tests first, `b28973b` code and notes).
- Date: 2026-11-15
- Reviewer: Claude Sonnet 5.5, independent read-only review

Method: scratch clone of `b28973b`, `npm ci --ignore-scripts`, `npm run build`, full suite (35 files, 549 tests, green). 33 one-at-a-time code mutations against the new tests (script `mut2.sh`), repro tests for the seams (`repro-pass2.out`), the first pass's HCL mutation fuzz re-run (20,000 cases plus pathological inputs, 235 ms, no non-refusal exception), a 20,000-credential by 20,000-Application timing (512 ms). Repros are kept in `_scratch-crankpath/review-b4-repros/` (`mut2.sh`, `repro-pass2.out`, `fuzz2.out`). Commit identity of the two fix commits: `naren-ambati <32987080+naren-ambati@users.noreply.github.com>`, Opus 5.5 trailer; no personal path, hostname, employer or design-tool name in the added lines; no change to `NOTICE`, `LICENSE`, `package.json`.

## 1. Findings

Counts: Major 2, Minor 5, Nit 4.

| id | severity | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|---|
| M1 | Major | `credential-extractor.ts` `argoNamespaces` (the "Argo CD's own namespace" rule) | The first pass's M1 is only half closed. Argo CD's namespace is taken to be "any namespace where an Application or ApplicationSet lives", which is still repo-controlled. (a) Fabricated edge: `Application/kube-public/b` plus a labelled `Secret/kube-public/c` for the same URL gives `needs-credential` (repro C); one Application in any namespace legitimises every labelled Secret there. With apps in `argocd` and `team-a` and a labelled Secret in `team-a`, `Application/team-a/b` gets the edge (repro B). (b) Hidden edge, no item: with the real credential in `argocd` and an Application in `team-a` (or a child Application that took its parent's destination namespace, as the B1 pipeline test shows: `Application/root/child`), that Application gets no edge and no item (repro A). The credential-outside item fires only when NO Application shares the namespace. | CONFIRMED (`repro-pass2.out` A, B, C) | Derive the Argo CD namespace from the estate (the namespace of `argocd-cm`, or of the objects Argo CD's install ships), use it for every Application, and when the estate does not show it, list the credentials and the Applications' needs as an item rather than guess from the Applications' own namespaces. Add the two negative tests (Application and Secret together in `kube-public`; credential in `argocd`, Application in another namespace). |
| M2 | Major | `secret-store-extractor.ts` (`bare = store.kind === "SecretStore" ? store.namespace : null`), `cert-manager-extractor.ts` (`cluster ? null : issuer.namespace`); tests "a SecretStore in vault ... depends on Service vault/vault", "an Issuer in vault ... depends on Service vault/vault" | The first pass's m2 fix (my suggestion) is wrong. A bare host in a store or issuer is dialled by the controller's own pod (the External Secrets controller, the cert-manager controller), so a bare name resolves in the CONTROLLER's namespace through its DNS search path, not in the namespace of the SecretStore or Issuer. The code now makes an edge to `Service/<store ns>/<name>` that does not exist in the running cluster; the same file's rule for ClusterSecretStore, Argo CD and Flux ("the controller's namespace is not in the estate, so a bare name states none") contradicts it. A wrong edge can create a fabricated cycle (cycle B variant) or a false in-estate dependency. Only the Vault transit seal is right (the Vault pod itself dials). The new tests assert the mistaken behaviour as correct, and the old ambiguity test was switched to a ClusterIssuer to keep passing. | CONFIRMED (`repro-pass2.out` "store bare" and "issuer bare": edge to `Service/apps/vault`) | Pass `bareNamespace: null` for stores and issuers (an ambiguity item when any Service of that name exists, else unplaced), keep the StatefulSet's namespace for transit only, correct the header lines and replace the two tests. A bare name should resolve in a namespace only if the estate shows where the dialling controller runs. |
| m1 | Minor | `external-host.ts` `PUBLIC_TLDS` and `externalHostName` | The fixed ten-word list is disclosed in the source header and BUILD-NOTES only, not in `docs/limits.md`, the README or any output line. Consequences: real two-label public hosts outside the list (`sr.ht`, `gitea.xyz`, `charts.dev`) become `host-unplaced` items instead of externals (repro: output of the host table). A repo that declares a `Namespace` named `com`, `io` or `org` turns every `github.com`-style host into an unplaced item; it cannot create a wrong edge (HostMatcher still decides in-cluster matches first), only an item instead of an external. The estate-namespace override has no test: replacing its condition with `false` keeps all 324 extractor/output tests green. A derivable alternative exists: ship the registry's root-zone list as data with its date and source in `docs/lookups.md`, so the rule is "last label is a delegated top-level domain" rather than ten chosen words. | CONFIRMED (mutation survives; host table) | Add a test for the namespace override; document the rule where users read limits; prefer the dated root-zone list. |
| m2 | Minor | `vault-seal-extractor.ts` (`disabled` non-boolean refused) | The Vault seal documentation spells the migration flag as the string `disabled = "true"`. It is now `seal-unreadable` for that seal (no edge, an item), so a standard old-seal stanza is listed as unreadable on every migration estate. Honest, but a legitimate input refused; the first pass offered "treat the full ParseBool set as disabled or refuse". | CONFIRMED (`hcl disabledString` parses to the string; extractor refuses it) | Treat the strings `"true"` and `"false"` (case-sensitive set Vault accepts) as booleans, refuse anything else. |
| m3 | Minor | `external-host.ts` `urlHost` (`host.startsWith("[")` returns null) and the callers | An IPv6-literal host (`http://[fd00::1]:8200` as a store server) is dropped silently: no edge and no item. An IPv4 literal gets a `host-unplaced` item, so the seam is inconsistent, and a public or in-cluster address that matters for cold start vanishes without a trace. | CONFIRMED (`repro-pass2.out` "ipv6 literal": no edge, no item) | Return the literal and let `placeHost` list it as `host-unplaced`, like IPv4. |
| m4 | Minor | `credential-extractor.ts` `add` and docs claim "listed once" | An ExternalSecret-made credential and a plain labelled Secret of the same id in a foreign namespace give two `credential-outside-argocd` items (different `where`, same subject), so "listed once" is not true in that case. | CONFIRMED (`repro-pass2.out` F) | Dedupe by subject in the extractor or say "once per defining object". |
| m5 | Minor | `external-host.ts` | A name such as `<svc>.<ns>` with an unknown namespace is, by design, an item and not an external. For the common first-bolt case, a repo hosted by an in-cluster service whose Service is not in the estate, the "the repository itself lives in the cluster" external precondition (the black-start finding) is no longer produced; only an item remains (B5 must turn dependents unverified). This is the lead's recorded decision, but the thin-slice and pipeline tests now assert `host-unplaced` where they asserted the external, so the consequence is not visible in any output line. | PLAUSIBLE (traced; B1 test diffs) | When B5 lands, make the item text say "may be in-cluster, not placed" so a reader can tell it from an ambiguity. |
| n1 | Nit | `secret-store-extractor.ts` | A ClusterSecretStore with a bare host and exactly one same-named Service is `host-ambiguous` with one candidate (the item reads as an ambiguity of one). | CONFIRMED (the new test asserts it) | Use the unplaced word, or state "namespace not stated". |
| n2 | Nit | `hcl-seal-reader.ts` | The new refusals apply anywhere in the file, not only in seal stanzas: a bare word or a `\.` escape in an unrelated stanza (`telemetry`, `listener`) refuses the whole config and loses a readable seal. Honest (an item), never a crash; fuzz re-run clean. | CONFIRMED (`hcl escapeOther`, `identInOther`) | Fine to keep; mention it in the header. |
| n3 | Nit | tests | `PUBLIC_TLDS` entries other than `com` are not individually tested; removing `biz` keeps everything green. | CONFIRMED | One table-driven test over the list. |
| n4 | Nit | `credential-extractor.ts` | With no Application in the estate at all, every labelled Secret is `credential-outside-argocd`, even in the `argocd` namespace (repro D); the item text says it "may be a misconfiguration". | CONFIRMED | Word it as "no Application seen". |

## 2. First-pass findings, one by one

Re-run with the first pass's method (one mutation, then the extractor, output and fixture tests).

| first pass | status now | evidence |
|---|---|---|
| M1 foreign-namespace credential, namespace squat tie | Partly fixed: see new M1. The squat tie and the foreign-namespace case without an Application there are closed (mutation "argo-ns gate off": 2 red; "namespace index ignored": 1 red). | repro A, B, C |
| m1 in-cluster names become externals | Fixed for names with one label, `svc` label, `.local`, `.cluster`, two-label names with a non-listed last label (mutations `two-label`, `svc label`, `cluster suffix`, `ipv4`: red 10, 8, 1, 1). Fixed list disclosed only in source and notes: new m1. | host table |
| m2 bare host | Edge now created, but at the wrong namespace for stores and issuers: new M2. Transit and Argo/Flux correct (mutations red). | repro |
| m3 spread | Fixed: 20,000 credentials with 20,000 Applications in 512 ms; no `Math.max(...)` left. | `perf` |
| m4 unlabelled Secret | Fixed: mutation "label gate any": 20 red. | |
| m5 HCL | Fixed: bare word and unknown escape refused (mutations red 2 and 2); `disabled` non-boolean refused (4 red); but see m2 for `"true"`. | |
| m6 region-less and generic seal | Fixed: mutation "awskms regionless edge": 6 red; no `external:aws-kms` or `vault-transit` nodes remain. Fixture test expectation changed accordingly (see section 3). | |
| m7 StatefulSet index | Fixed in the code; mount corroboration still tested (2 red when removed). I did not re-time the 40,000 by 40,000 case. | |
| n1 Bucket endpoint | Fixed: mutation of line 108 red (2). | |
| n2 `{{` guard | Answered with a test; kept. Accepted. | |
| n3 backslash before newline | Fixed: mutation red (1). | |
| n4 Argo order claim | Fixed in the header text. | |

## 3. B1 and fixture test expectations the builder changed

- `pipeline-runner.test.ts` (three cases): the root and child Applications no longer have `reads-source external:gitea-http.gitea`; they have `host-unplaced` items; edge count 2 to 1 in the isolation test. Correct under the lead's decision; no B1 edge was lost (`deployed-by` edges still asserted). The item counts are asserted, so a silent drop would fail.
- `text-renderer.test.ts`: cases that counted externals now scan a public host (`git.example.org`). The wording under test is unchanged. The new `scanPublic` helper asserts exit code 0.
- `thin-slice.test.ts`: the mutation case now expects "2 unresolved items" and a `host-unplaced` line. The golden for the unmutated slice is unchanged and green. Correct.
- `vault-fixture.test.ts`: the region-less case now expects no `external:aws-kms` and one `region-unresolved` per Vault StatefulSet. Correct under m6.
- `fixture-kit.ts`: spread removals only.

None hides a regression; the cumulative effect (fewer edges, more items) is disclosed in BUILD-NOTES "What changed in meaning". The Vault fixture's cycles A (3 edges) and B (5) and its three externals are still asserted and green.

## 4. Tests that cannot fail (this pass)

- The estate-namespace override of `PUBLIC_TLDS`: survives mutation (`false` in place of `isValidNamespace(last) && namespaces.has(last)`). m1.
- Removing `biz` from the list survives (n3).
- "store bare always uses namespace" and "issuer bare always uses namespace" survive, but equivalently: a ClusterSecretStore or ClusterIssuer has no namespace, so the two forms coincide. Not a gap.
- The two bare-name tests for SecretStore and Issuer can fail but assert the wrong semantics (M2).

## 5. Checked and sound

- `placeHost`: every branch of the helper emits an edge, an ambiguity item or an unplaced item; mutations removing each (`unplaced no item`, `ambiguous no item`, `externals not pushed`) go red (7, 5, 9 tests). No path through it turns an in-cluster-possible name into an external: one label, IP literal, a `svc` label, `.local`, `.cluster` and two-label non-listed names are all refused. The only silent drop is the IPv6 literal inside `urlHost` before `placeHost` (m3).
- Credential choice per namespace map is linear; ApplicationSet template repoURL is correctly not matched (mutation red).
- Transit seal: bare host resolves in the Vault StatefulSet's namespace, which is right because Vault itself dials (mutation `transit bare null`: 2 red).
- HCL reader after the changes: fuzz and pathological inputs finish in under 40 ms each, only refusals; a realistic chart config (listener, raft storage, `service_registration`, `awskms`) still reads.
- `credential-outside-argocd` and `host-unplaced` are in the closed `UNRESOLVED_WHY` list, are printed through the existing item renderer, and are deduplicated by the graph builder.
- Hard rules: identity, independence, licence files, nothing from the design tool's workspace in the added lines.

## 6. Verdict

Not ready (ready to merge after fixes once M1 and M2 are fixed): both Majors are wrong analysis results (a fabricated or hidden `needs-credential` edge from repo-controlled namespaces; a fabricated dependency edge to a Service the controller cannot reach by a bare name), and M2 comes from the first pass's own suggestion.
