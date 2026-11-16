# Independent review of bolt B3, second pass (repo identity, ApplicationSet expansion, repo fetch)

- Bolt: B3. Branch: `bolt/b3`. Commit reviewed: `9d1de5c` (diff `b735eb6..9d1de5c`, plus the first-pass fix commit `c40c4c5` it builds on). Pass 1 reviewed `03e24d4`.
- Date: 2026-11-16. Reviewer: Claude Sonnet 5.5, independent read-only review.
- Method: copied the worktree, built it, ran the full suite (89 files, 1,564 tests, green in the copy); re-ran the first-pass repros against the built CLI and fetcher; ran 41 single-line mutations against the FULL suite (the earlier killed attempt had used a subset; I re-ran every survivor against all 1,564 tests); drove the real git 2.55.0 and a stand-in process through the process-group helper; one live read-only fetch (a public repository that does not exist, and one that redirects). Dummy tokens only.

## 1. Findings

Counts: **2 Major, 4 Minor, 3 Nit.**

### Major

| Id | Location | Failure scenario | Status | Minimal general fix |
|---|---|---|---|---|
| M1 | `pipeline-runner.ts` `runPipeline` (`resolveCacheRoot(options.cwd, options.cacheDir, null)`), `work-dir.ts` `resolveCacheRoot` (trusted whenever `rootReal` is null), `repo-fetcher.ts` cache hit (`headCommit(hit) === plan.value`) | The integration item "an in-tree cache is never trusted for repositories" is not met for the positional URL. Its cache root defaults to `<cwd>/.crankpath` and is called trusted because no scanned tree exists yet. In CI, cwd is very often a checkout of the untrusted change. A planted `.crankpath/repos/github.com/acme-org/svc@<40 a>/` holding `.git/HEAD` (the sha) and any YAML is a cache hit for `crankpath https://github.com/acme-org/svc --rev <sha>`, online or with `--no-network`: nothing is fetched, only the text of `HEAD` is compared, and the report says `scanned: repo ... (fetched read-only by crankpath)`, `commit: "aaaa..."  floating: no`, then analyses the planted files (my plant yields a forged Application and a cycle). A checked-party-controlled file decides a "pinned and verified" result. | CONFIRMED: `repros/plant-cache-repro` (run `node dist/u9-cli-package/cli.js https://github.com/acme-org/svc --rev aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --no-network` inside it). Mutation 26 (positional WorkDir keyed to cwd) is killed, so the tests pin the arrangement and not the hazard. | Do not trust a default cache that sits under the current directory: either default the positional cache to a per-user directory outside cwd, or treat `<cwd>/.crankpath` as untrusted for repository reads (as for the scanned tree) unless `--cache-dir` is given explicitly; and on a hit, verify the checkout (for example `git rev-parse HEAD` through the git runner plus a clean `git status`), not only the text of `HEAD`. Add the planted-cache test. |
| M2 | `pipeline-runner.ts` `fetchMapping` (one fetch per distinct referenced `repos:` URL, serial); `repo-fetcher.ts`; `limits.ts` (`repoFetchWallClock` is per call; no count or total) | A hostile repository's config can name N `repos: {fetch: true}` entries and N Applications that reference them. Each is a separate git clone, each allowed 90 s and 74 MB, serial, with no run-level ceiling on the number, the total time or the total bytes kept in `.crankpath/repos`. With a git that fails after one second, 20 entries took 22.6 s, linearly. At the worst, 1,000 entries are about 25 hours and tens of GB of cache; against a real forge it is thousands of outbound requests from the invoker's address. Brief: fail closed on count and time limits; the integration list asks for a shared wall clock and all limits derived. `declaredEntries` (about 1.5 million) is the only bound on the count. | CONFIRMED: 20 `repos:` fetch entries and 20 Applications naming them, a fake `git` first on PATH that sleeps 1 s and fails (`time` 22.6 s for 20 fetches, 8% CPU). | One run-level fetch budget (a derived total wall clock, and a derived count and byte total for fetched checkouts): once spent, every further `repos:` fetch is an opaque `limit` mention, counted, never silent; state the basis. |

### Minor

| Id | Location | Failure scenario | Status | Minimal general fix |
|---|---|---|---|---|
| m1 | `git-runner.ts` `GROUP_HELPER`, `realGitSpawn` | The first-pass fix (kill the group on timeout) does not cover every way the helper ends. (a) Over the output cap: `spawnSync` kills only the helper with SIGKILL on `ENOBUFS`; the git group, detached, keeps running with the token header in its environment. A hostile server can fill standard error with sideband text and then stall. (b) Ctrl-C or SIGTERM to the helper: it has no handler, dies, and git (its own group, so it did not get the terminal's signal) survives. In both, nothing ever ends the process (git has no low-speed limit set). The fix claims "never outlives the call". | CONFIRMED with a stand-in command: `repros/ovcap.mjs` (`sleep` alive after `ENOBUFS`) and `repros/sig.mjs` (alive after the helper gets SIGINT). The wall-clock case itself is fixed (`repros/pgkill.mjs`: timed-out in 3,048 ms, no git process left). | Make the helper count output bytes itself and kill the group at the cap, and handle SIGINT, SIGTERM and SIGHUP by killing the group; add `http.lowSpeedLimit`/`http.lowSpeedTime` as a backstop. |
| m2 | tests | Several guards have no test that can fail (full-suite mutation, all 1,564 tests green with the guard removed): `PATH` made non-empty in the git environment (m28); `transfer.fsckObjects` removed (m34; the key test only checks that git knows the key); the `ORIGIN` regex loosened to `/./` (m35); `maxBuffer` cap lifted (m36); an empty token treated as a token (m39 and m37, sends `Basic x-access-token:`); `packed-refs` resolution of a floating fetch (m14 renamed path; only the loose-ref branch is tested); the positional fetch work directory not removed (m17: the CLI never checks the run directory is gone after a URL run; the stale-run sweep would remove it later). | CONFIRMED by mutation (`repros/mut.py`, `repros/mut.out`, `repros/mut14.out`) | One behaviour test each; the fsck and PATH ones can use the loopback listener lane the first-pass tests already have. |
| m3 | `docs/limits.md`, `BUILD-NOTES.md` (B3 "what changed in meaning") | The notes say fetch work directories are "covered by B2's stale-run cleanup" and that every limit is derived; `HELPER_GRACE_MS = 10_000` is a picked number with no basis, and the fetch total is not bounded (M2). | CONFIRMED (read) | Derive it (it is `wallClock` plus a backstop: say so in the limits table) or name it as a constant of the helper's contract. |
| m4 | `limits.ts` `repoFetchWallClock` basis | The basis says a slower fetch "fails in Argo CD itself". It protects a single call; as the only time limit on fetching it is described as a "backstop only" while M2 shows it is the whole bound. | CONFIRMED (read) | Rewrite with the run-level budget from M2. |

### Nit

- n1. `https://git.acme.dev/o/r%0d%0a` passes the guard (percent-encoded CR LF in the path). It reaches git as literal text in argv, no shell, so harmless, but the guard refuses other control spellings; refuse `%00` to `%1f` for symmetry.
- n2. A port written with leading zeros (`:00443`, `:0443`) gets no token (fail safe); `:08443` takes the `_8443` variable and the header is scoped to the literal `:08443` origin. Consistent but surprising; normalise the port first.
- n3. `.crankpath/` (with `.gitignore` and an empty `tmp/`) is left inside the scanned directory after every run with `repos:` fetches. Harmless, noted.

## 2. First-pass findings, re-checked

| First-pass id | Verdict | Evidence |
|---|---|---|
| M1 amplifying ApplicationSet | Fixed | the 90,000-element, 1,000-annotation file (1.7 MB) now ends in 1.9 s, 332 MB, exit 0 under `--max-old-space-size=2500`, 416 Applications and a counted `limit` ("the run's memory budget was reached while its Applications were generated"). Also tried: a 300 x 300 matrix with 500 annotations (0.85 s, 156 MB, 1,024 Applications then the limit) and 8 elements of a 900 KB value across 2,000 templated annotations (0.25 s, opaque `limit` on `generatorRenderSteps`). Mutations 20 and 21 (admit bypass, unbounded steps) are killed. |
| M2 token routing | Fixed as decided | token only to the positional URL: `repros/tok.mjs` shows the header for the positional fetch and none for an anonymous (`repos:`) fetch; mutations 1, 3, 4 killed. Port scoping: `:443` uses the host variable, `:8443` its own `_8443` variable, `:9000` none, host case folded. |
| m1 port scoping | Fixed | as above; mutation 2 killed |
| m2 process-group kill | Partly (m1 above) | timeout case fixed and tested; over-cap and signal paths still orphan git |
| m3 recorded git texts | Fixed | live: a missing GitHub repository gives `unable to get password from user`, classified as the 401 branch with "unknown whether the repository exists"; a GitLab URL without `.git` gives `error: 301`, classified with the `.git` hint. Mutations 12 and 13 killed. |
| m4 special-use names | Fixed | 40 spellings in `repros/guard2.mjs`: `home.arpa`, `in-addr.arpa`, `example.org`, `.test`, `.onion`, `.alt`, `.invalid`, `.localhost`, `.lan`, `.internal`, `.svc`, every IP spelling, trailing dot, `..`, `%2e%2e`, userinfo, port 0 and 65536 refused. Wildcard-DNS names still pass by the stated residual risk. Mutations 10 and 11 killed. |
| m5 clone size cap | Fixed per repository (not per run, see M2) | mutations 8 and 9 killed |
| m6 mutation survivors | Fixed: pinned-sha mismatch (15), trusted gate (16), auth origin prefix (22) are now killed; new survivors in m2 above | |
| m7, m8, m9 | Fixed | packed-refs branch untested (m2) |

## 3. Integration

- Git only through `git-runner.ts`: yes. The only `spawnSync` users are `command-runner.ts` (which throws `git runs only through the git runner`) and the runner's helper. The git forms are entries of the one closed list.
- Fetch directories inside the run WorkDir, removed with it: yes (`area.makeDir("fetch")`); the scan's WorkDir cleanup is tested (mutation 18 killed), the positional one is not (m2).
- Stale-run sweep covers them: B2's sweep is tested (mutation 24 killed by B2's tests).
- In-tree cache never trusted for repositories: met for a `repos:` fetch (mutation 25 killed), NOT met for the positional URL (M1).
- Positional URL has its own WorkDir resolved before a scanned tree exists: yes, with the M1 consequence.
- Generated Applications through Helm, Kustomize and plain renders; `generated-by` only on Applications: yes. In the homelab run all three `generated-by` edges go from an Application to the ApplicationSet; the Deployment and Service are `deployed-by`. Mutation 19's target no longer exists and mutation 23 (generatedBy dropped on generated Applications) is killed by 6 tests.
- Shared wall clock: one constant (`ARGO_EXEC_TIMEOUT_MS`) serves renders and fetches, but each call has its own clock, there is no run total (M2).
- All limits derived: yes except the helper grace (m3).

## 4. Definition of Done

| Item | Verdict | Evidence |
|---|---|---|
| Homelab shape with exactly one alias, no declared edges: both cycles | Met | I ran it: `ANALYSED`, 0 declared edges, one strongly connected component of 5 nodes (Application argocd, Application gitea, ApplicationSet root, Deployment gitea, Service gitea-http) holding both cycles; three runs and a run from a copied directory give the same hash |
| Without the alias: opaque `unreadable-repo` with the suggested entry | Met | `expected-without-alias.txt` matches the test; unaffected by the merge |
| Look-alike URLs unreadable | Met | with the alias spelt `.../homelab2`, `.../Ops/homelab` or on port 3001 the ApplicationSet stays opaque; `.git` and `http`/`https` spellings match by FR2.3 (scheme and `.git` dropped) |
| No token to another host or port; never in argv, output, cache, logs | Met | `repros/tok.mjs`; environment only; no token in the recorded failures |
| Git options real and effective | Met | behaviour tests (redirect, header scope, hooks, helper, protocol) are present and mutation-killed except m2 |
| 401, 403, 404, redirect, timeout, rate limit as `unreadable-repo`, never "gone" | Met | live runs above |
| Fetch cache layout and trust | Partly | M1 |
| Hostile ApplicationSet bounded, counted `limit` | Met | section 2 |
| Fetch bounded (size, time, count) | Partly | size and time per repository; no run total (M2) |
| `generatedBy` twin bug | Met | generated Applications render through Helm, Kustomize and plain with objects `deployed-by` |
| Live read-only lane, SKIPPED offline | Met | not re-run live beyond the two failure probes |
| `npm run verify` | Met | the suite was green in the copy (1,564 tests); I did not re-run lint or check-tree |

## 5. Hard rules

Independence: no employer or personal path, hostname or design-tool name in the added lines (grep of the diff clean). Licence and NOTICE unchanged. No design-workspace files in the diff. All nine commits `naren-ambati <32987080+naren-ambati@users.noreply.github.com>` with a Co-Authored-By trailer.

## 6. Checked and found sound

Token variable injectivity; auth origin as a prefix of the clone URL; redirects are errors; environment built from nothing; the wall-clock group kill (confirmed no `git-remote-http` left after a 3 s timeout against a listener that accepts and never answers); fail-closed on a hostile ApplicationSet of three shapes; determinism of the homelab JSON.

## 7. Verdict

**Not ready.** Two Majors: M1 (a trusted-by-default cache under the current directory lets a planted tree pass as a pinned fetch) and M2 (no run-level bound on `repos:` fetches). Both fixes are small. With M1 and M2 and the m1 group-kill gaps closed it is ready to merge after fixes.
