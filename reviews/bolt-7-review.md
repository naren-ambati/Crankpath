# Review of bolt B7 (goldens, the adversarial suite, mutation checks, the hand-applied-root rule)

- Bolt: B7. Branch: `bolt/b7`. Commit reviewed: `bc67813` (merge of B8 `8aba087`; review of `git diff main..bc67813`).
- Date: 2026-11-16. Reviewer: Claude Sonnet 5.5, independent read-only review.
- Run here: `npm run verify:golden` once with real helm v4.3.2, kustomize v5.8.1, git 2.55.0 and the network
  (exit 0, `golden lane: 19 passed, 0 failed, 0 skipped`); 15 further runs of the homelab cranked case (14 direct,
  1 under heavy CPU load); the whole vitest suite (1870 passed, 4 skipped), typecheck, lint and check-tree
  (0 findings), all green on a scratch copy; the offline lane; hostile repros and code mutations (below).

## 1. Findings

No Major finding. Eight Minor, four Nit.

| Id | Location | Failure scenario | Status | Minimal general fix |
|---|---|---|---|---|
| m1 | `test/u11-validation-harness/golden-harness.test.ts` "the reduced form holds node ids and counts only", `foreign()` | The leak check allows every string that is letters only ("the reduced form's own keys" filter `/^[a-zA-Z]+$/` is applied to all strings of the output, values included), and its planted-leak test uses a string with escapes. A reduced form that carried a one-word string from the repository would pass the offline check. Repro: in `reduce()` add `leak: (r.opaque[0]?.field ?? "x").split(".")[0]` (emits `spec`): the 16 offline tests still pass. The lane would still fail on the pinned file (extra key), but m11 (no text of the repo beyond ids and counts) is guarded only by that and by review. | CONFIRMED | Allow only the keys of the reduced form's own schema (a fixed key list, or take keys from the structure and values from the allowed sets), not any alphabetic string; plant a one-word leak in the negative test. |
| m2 | `test/adversarial/suite.test.ts` `quoted()` | The index is checked by "the title string occurs somewhere in the file". A referenced test turned into `it.skip(...)`, or commented out, or a title that only appears in a string, still passes. Repro: `it.skip` on "finds the extracted 2-node dependsOn cycle once the one patch is applied": `test/adversarial` 40 passed, 1 skipped, suite green. The README claim "the index cannot rot" is wider than the check. | CONFIRMED | Match `describe(<title>` / `it(<title>` / `it.each(...)(<title>` calls, require the `it` inside that describe, reject `.skip`/`.todo`/`.fails`. |
| m3 | `src/u3-discovery-expansion/source-discovery.ts:140` (`!inChartInternals(f)`) and `src/u9-cli-package/pipeline-runner.ts` (`!handCharts.has(d) &&` in `undeployedCharts`) | Two lines of the new hand-applied logic have no test: removing the vendored-chart exclusion, or removing the "applied by hand" exclusion from the undeployed list, leaves the whole suite green (1870 passed). In the fixture the hand-applied chart is also deployed by the Application it renders, so the second exclusion is never the deciding one. | CONFIRMED (mutants survive the full suite) | Tests: a chart under `charts/` or `templates/` of another chart is not listed undeployed; a hand-applied chart that no render deploys is not listed undeployed. |
| m4 | `pipeline-runner.ts` hand-applied loop (`handApplied.has(target.path)`) | Two cranks naming the same `render:` path with different `namespace:`/`release:` render once, with the first one's; the second's keys are silently ignored (no unresolved item, no note). Repro: `repros/h1` cranks 4 and 5 (`namespace: one` / `two`): one render, step 2 "names 1 object already created". Removing the guard also leaves the suite green. | CONFIRMED (code and surviving mutant) | When a later crank names an already rendered path with different keys, add an unresolved item (or refuse the file); test it. |
| m5 | `scripts/golden-lib.mjs` `--pin` | The gate on pinning is "reviewed.md exists and has no line `Pending.`". Any file passes; nothing ties the pin to the observed output that was reviewed (the pin re-runs and writes whatever the run gives, as happened for the floating-count re-pin). The brief's "cannot pin without review" is met in letter only. | CONFIRMED (code) | Record the sha-256 of the reduced output the review saw in `reviewed.md` and refuse to pin when the run's differs. |
| m6 | `input.json` mutations: `vault.remove-credential-label` and `vault.rename-vault-service` (both expect `{cycles:1, uncranked:1}`); `homelab-cranked.drop-alias` (expects `{cycles:0}`); `thin-slice.other-repo-url` (no `expect`) | The expectations are counts only. The two Vault mutations are interchangeable: a build in which each removed the other's cycle would pass. `drop-alias` passes for any failure that ends with no cycle; `other-repo-url` passes on any change at all. The mutation therefore proves "result changed", not "changed for the stated reason". | CONFIRMED (from the lane output) | Add the surviving cycle's node ids (or its id) and the opaque count to each `expect`. |
| m7 | `docs/limits.md` "Two renders per chart", `docs/json-output.md` line 7, B7 BUILD-NOTES | The golden lane is not load-robust: one of 11 lane runs of `homelab-cranked` failed (`expected.json differs at line 17`, `edgesExtracted` differs from 793) while a full vitest run and other helm runs were using the machine; the next two passed. I could not reproduce it in 14 quiet runs (nodes 614, edges 793, opaque 2, unresolved 22, skipped 12 every time; only the floating count moved, 33 or 34) or in one run under 20 busy loops, and the failed run's output was overwritten, so the cause (a render timeout under load is the likely one) is PLAUSIBLE, not shown. It fails closed (a FAIL, never a pass), but the docs say only one floating entry varies between runs on this estate. | PLAUSIBLE | Say in the lane's output and docs that the lane must run on an idle machine; on a failure, print which counts differ and whether any timeout or limit outcome was seen. |
| m8 | `test/golden/homelab/input.json` description and the bolt's expected result | The brief expects cycle 1 and cycle 2 `extracted` without the crank. The pinned `homelab` golden is `NOTHING ANALYSED`; the two cycles appear (extracted, one component of 13 nodes) only in the declared mutation `add-entry-application`, which adds an Application of crankpath's own. This follows the lead's decision and is explained in `reviewed.md`, but the headline expectation is held by a mutation, not by the golden. Likewise the research's one-line crank is shown incomplete (32 reroutes needed). | CONFIRMED (read) | None needed for the code; keep the sentence in the README that the uncranked golden proves the "nothing deploys system/argocd" behaviour, and the mutation proves the cycles. |
| n1 | `scripts/golden-lib.mjs` `loadCase` | A case that `needs` helm but omits `tools` is never version-checked (a mismatch would then run, not skip). All five committed cases declare `tools`. | CONFIRMED (read) | Require `tools.helm`/`tools.kustomize` whenever the case needs them. |
| n2 | `scripts/golden-lib.mjs` `ensureFetched` | A cached checkout is accepted when `git rev-parse HEAD` equals the pinned sha; a modified working tree in the cache is not detected. Local cache only. | CONFIRMED (read) | `git status --porcelain` must be empty. |
| n3 | `docs/limits.md`, reduced form | `reduce()` drops every floating entry whose field is `helm template` for all reduced cases, not just homelab; a real new nondeterministic chart would not change the golden. Documented in the code comment and `reviewed.md`. | CONFIRMED (read) | Fine as is; name the cases that use it in `input.json`. |
| n4 | tracked files on `main` (outside this diff) | The design workspace folders and the start file are tracked in the repository on `main` (hundreds of files), against the hard rule that they must not ship. B7 adds and edits none of them (checked the diff and the commit messages). Raised for the lead, not a B7 finding. | CONFIRMED (`git ls-files`) | Lead decision before any release. |

## 2. Tests that cannot fail

I mutated the code in a scratch copy and ran the tests.

Caught (test went red, as it should): no-op mutation accepted (`golden-harness` "fails a mutation that leaves the result unchanged..."); an unmet `expect` ignored; SKIPPED counted as a pass (2 tests); helm version mismatch ignored; pinning without `reviewed.md`; namespace dropped from the hand-applied job; release default ignored; release validity check removed; namespace/release accepted on a crank without a `render:` target; namespace validity removed.

Not caught (mutant survives, see m1 to m4): reduced form emitting a one-word repository string (m1); a referenced adversarial test skipped (m2); vendored charts counted as chart directories, and the hand-applied exclusion from the undeployed list (m3); a second render of the same hand-applied path (m4).

The `suite.test.ts` self-check ("would catch a reference to a test that does not exist") only tests `quoted()` on a string, not that a missing title fails the index; with m2 it is weaker than it reads.

## 3. The hand-applied-root rule (hostile crankpath.yaml `render:` crank)

Checked with real helm and kustomize (`repros/h1`, `h2`, `k1`):
- Confined to the root: only directories the guarded walk found (a `Chart.yaml` or a kustomization of the scanned root) can be rendered; `render:../outside` is refused at read (`outside the scanned root`); a symlinked directory is "symlink, not followed" and its crank is `crank-unused`; a symlinked template in a hand-applied chart makes it an opaque source `unreadable-file`, helm not run. Same job, same B2 guards as any other render (budget, timeouts, pre-read, `--skip-schema-validation`).
- Injection: `namespace:` must be a DNS label, `release:` must match the release-name rule (no leading dash or dot, at most 53); both are separate argv elements through the closed command runner. Invalid values are refused before anything runs (namespace) or give an opaque source (release); both tested.
- Silencing real cycles: a `render:` crank can only mark what its render produced as created by hand. A cycle through those objects is shown `cranked (was extracted)`, the crank is "documented, not verified", the plan assumes it, step 1 is a manual step. Same trust class as the existing crank-everything case, which the new `gaps.test.ts` covers through the whole command. It adds nodes (the render of a directory nothing deploys); it removes none.
- Hostile directory names in the new "not deployed by anything read" block are quoted and escaped (`\x1b`, `\x0a`, bidi `‮`), never at a line start.
- Remaining: m3 and m4 only.

## 4. GPL/MPL leakage (khuedoan/homelab, hashicorp/vault-helm)

- `test/golden/homelab*`: `expected.json`/`expected.txt` are the reduced form. I listed every string in the cranked expected JSON by field: only node ids, node kinds, edge kinds, cycle and crank ids, the two externals' ids (`external:github.com`, `external:acme-v02.api.letsencrypt.org`), crankpath's own enumerated words and tool versions. No path, value, annotation text, chart name field or file content. `input.json` holds the repository URL, the full sha, aliases and crankpath-written files; `crankpath.yaml` is crankpath's own text, citing `system/bootstrap.yml` and `system/argocd` as paths and describing the bootstrap behaviour in its own words (a description of a fact, not a copy). `reviewed.md` quotes ids and counts only. The clone and the full output are in the cache, outside the repository (the lane refuses a cache inside the checkout).
- `test/golden/vault*`: `expected.json`/`expected.txt` are the full form of crankpath's report: ids such as `Service/vault/vault-internal`, edge kinds, field paths, crankpath's fixed wording. No `{{`, no `helm.sh/chart`, no label or annotation text, no template or rendered manifest. Object names are ids, as the brief allows; the lead's reading of OD-6 stands.
- No file added or edited by B7 holds text from either chart. `docs/lookups.md` lists the clones with their dates.
- Independence: no employer or company name, no personal path or hostname in the diff; commit identity and trailers as required on all 10 commits; nothing of the design workspace referenced in any file or message of the diff.

## 5. The golden harness

- SKIPPED never passes: missing helm, kustomize, git or network, or another helm/kustomize version than the one reviewed, gives SKIPPED for the case and its mutations; the lane exits 2 (`laneExit`); verified offline: `golden lane: 4 passed, 0 failed, 15 skipped (a skipped golden is not a pass)`, exit 2. `--observe` and `--pin` exit 2 by construction. In vitest the four helm cases are `it.skip` with their reason, never passed.
- A version mismatch skips rather than passes (tested). A fetch or run failure is FAIL, never a pass.
- `--pin` cannot run without a `reviewed.md` (m5: that is all it requires).
- Reduced form: ids and counts only; see m1 for the weak guard.
- A mutation edit that does not apply (no file, no unique match, no argument) fails instead of running the unmutated input.
- Honest offline: yes. `npm run verify` runs the thin slice through the same code and shows four skipped goldens; `npm run verify:golden` without helm or network exits 2 and names each reason.

## 6. Determinism-limit wording

`docs/limits.md` and `docs/json-output.md` now state that the JSON is byte-identical for the same inputs and tool versions except where a chart's own rendering varies, and that the two-render check cannot catch every case; homelab at 8b9d40f is named. This matched what I saw (14 runs: full JSON had two variants, differing in the floating entries; all counts equal). The wording is accurate on an idle machine; see m7 for the one loaded-machine failure. The README writers' note is in BUILD-NOTES only (no README claim to check).

## 7. Definition of Done (bolt brief)

| Item | Verdict | Evidence |
|---|---|---|
| Both goldens ran, not SKIPPED, with command, date and summary in BUILD-NOTES | Met | The notes hold the commands, 2026-11-16, the outputs; I reproduced `19 passed, 0 skipped`. |
| Vault golden: before the edits A, B and the three externals, nothing else uncranked; after, A cranked, B gone, a fully ordered plan with one manual step | Met | `vault`: cycle A 3/3, cycle B 5/5 (the research's 4 is explained as a hand-trace error), three unspecified externals; `vault-edited`: A cranked by `crank:1`, B gone, step 1 the one manual step. |
| Homelab golden: cycles 1 and 2 extracted without the crank, cranked with it, step 1 the crank | Partly | Cranked case met (one component holding both, `cranked (was extracted)`, step 1 the crank, 32 reroutes). The uncranked golden is NOTHING ANALYSED; the extracted cycles are shown by a mutation (m8); lead decision, recorded. |
| m11: homelab expected output ids and counts only | Met | Section 4. Guard weak (m1). |
| Every golden fails under its mutation | Met, expectations weak | 14 mutations all change the result in the lane; m6. |
| Adversarial suite: one place, each case with an outcome | Partly | 16 classes indexed, 6 groups of new cases in `gaps.test.ts` (dormant cycle, crank everything, bombs, traversal, look-alikes, 403/404/429), each with a control; the index check is weaker than claimed (m2). The "dormant cycle" case compares two file sets, not a rendered patch (stated in the notes). |
| MutationChecker | Met | `checkCase` fails on no change, unmet expectation, edit that does not apply; mutants of it are caught. |
| Lead reviewed the real-run output | Met (recorded) | `reviewed.md` of each case. |
| `npm run verify` and `npm run verify:golden` green | Met | Typecheck, lint, check-tree, 1870 tests green on my copy; lane 19/19 once. The coverage floor was not re-run by me. See m7 for the one load failure. |

## 8. What I checked and found sound

- The `render:` crank's guards, namespace and release validation, and fail-closed behaviour with a symlink (section 3).
- The golden cache refusal inside the checkout; the fetch options (https only, no hooks, no submodules, no redirects, no credential helper, sha checked three times); full 40-hex shas required.
- Commit identity and trailers; no design-workspace or personal-path text in the diff.
- Hostile names in the new undeployed block; the NOTHING ANALYSED shape with directories listed.
- The schema, JSON docs and thin-slice golden changes are exactly the three additive keys the notes say.
- The vault goldens are stable across 2 B3 re-pins (diffs add only the named keys).

## 9. Verdict

Ready to merge after fixes. None of the findings is a Major; m1 to m4 are test-strength gaps (the guard on the GPL boundary, the adversarial index, two lines of the new rule, a silently ignored second crank), and m5 to m7 harden the golden lane. n4 (tracked design-workspace files on `main`) is a lead decision outside this diff.

Scratch repros: `review-b7/repros/` (`h1` hostile hand-applied charts and cranks, `h2` hostile directory names, `h3` opaque Application, `k1` hand-applied Kustomize root with a namespace).
