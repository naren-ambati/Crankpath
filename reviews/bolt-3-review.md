# Independent review of bolt B3 (repo identity, ApplicationSet expansion, repo fetch)

- Bolt: B3. Branch: `bolt/b3`. Commit reviewed: `03e24d4`. Base: `main` `0a2e479` (reviewed as `git diff 0a2e479..03e24d4`; `main` has since moved to the B6 merge `1df4b0a`, see m9).
- Date: 2026-11-15. Reviewer: Claude Sonnet 5.5, independent read-only review.
- Method: read the whole diff; ran `npm run verify` on a copy (58 test files, 1,049 tests, green); ran the built CLI and the built fetcher on hostile inputs; ran the installed git 2.55.0 against a local listener I controlled (dummy token only, never a real one); ran 34 single-line mutations of the code and checked which tests turn red; one live read-only fetch of a public repository.

## 1. Findings

Counts: **2 Major, 9 Minor, 6 Nit.**

### Major

| Id | Location | Failure scenario | Status | Minimal general fix |
|---|---|---|---|---|
| M1 | `generator-expander.ts` (the generation loop, `renderValue` per parameter set, ~lines 800-880); `limits.ts` `generatedApplicationsPerApplicationSet`; `pipeline-runner.ts` `expand()` (`budget.objects` called only after the loop) | A hostile ApplicationSet crashes or freezes the tool. The only guard while generating is a count (96,638). Each generated Application is a full deep clone of the template, and nothing charges its bytes until all of them exist. A 1.8 MB file (a `list` generator of 90,000 elements and a template with 1,000 annotations, under the 10 MB file limit and under the count) makes the process die with `FATAL ERROR: ... JavaScript heap out of memory`, exit 134, no output, under the 2.5 GB old-generation heap that `run-limits.ts` itself names as the target runner. With the default heap it takes 351 s and 3.6 GB RSS, then the budget refuses it. The derived limit is also not what its basis says: "protects the run's memory ... counted while they are generated" is true only for a minimal 4-string Application; the real guard (the run budget) runs after the damage. | CONFIRMED. `amp-gen.mjs 90000 1000` then `node --max-old-space-size=2500 cli.js . --format json`: exit 134 after 150 s. At the default heap: 351 s, 3.6 GB, exit 0. | Charge the budget inside the loop: before cloning, compute the template's string-leaf count once and refuse the next Application when `count x (perObject + leaves x perStringLeaf)` no longer fits the remaining budget (counted `limit`, keep what was built). Re-derive the per-ApplicationSet limit from the template's real size, or drop it in favour of the in-loop charge. Add a test with a fat template and a small budget. |
| M2 | `pipeline-runner.ts` `fetchMapping` / `resolveRepo`; `repo-fetcher.ts` token read (`config.env(tokenVariable(host))`); `config-reader.ts` `repos:` | The scanned repository's own `crankpath.yaml` is untrusted input, yet `repos: {"<url>": {fetch: true}}` from it, with no flag, makes crankpath fetch any public-host URL it names and attach the invoker's `CRANKPATH_TOKEN_<HOST>` for that host. A hostile (for example forked) repo can therefore name a private repository on the same forge (`https://github.com/victim/private`), have it read with the invoker's token, and have its structure appear in the report (node ids, names, opaque and unreadable lines quoted from it), which in a CI comment goes back to the attacker. The token goes only to its own host (that part holds), but which repositories of that host it reads is chosen by the checked party. The builder disclosed this as an "owner item"; it ships default-on. The same applies to a fetched positional URL's own `crankpath.yaml`. | CONFIRMED by trace and by the builder's own test (`repo-fetch.test.ts`, token reaches the clone started by a `repos:` entry). | Do not attach a token to a fetch named by the scanned repo's config (token only for the positional URL, or for URLs the invoker passes with an explicit flag), or honour `fetch: true` only with `--allow-fetch` or from `--config`. State it in the docs either way. |

### Minor

| Id | Location | Failure scenario | Status | Minimal general fix |
|---|---|---|---|---|
| m1 | `repo-fetcher.ts` `tokenVariable`, `guardGitUrl` | The token variable names a host, but the URL may carry any port, and the header is scoped to `https://host:port/`. `https://git.example.org:8443/x` receives the token meant for `git.example.org:443`. Another service on the same host (a shared box) reads it. Brief: "go only to their own host". | PLAUSIBLE (traced; guard run shows `:8443` admitted, same variable) | Send a token only when the port is the default, or put the port in the variable name. |
| m2 | `git-runner.ts` `realGitSpawn` (`timeout`, `killSignal: SIGKILL`) | On the 90 s timeout only `git` is killed. Its `git-remote-https` child survives, still connected to the server and still holding `CRANKPATH_GIT_AUTH_HEADER` (the token) in its environment, after crankpath has exited and removed the work directory. | CONFIRMED with a dribbling local server and `spawnSync` timeout: the helper process was alive afterwards (killed by me). | Add `http.lowSpeedLimit` and `http.lowSpeedTime` and `http.connectTimeout` to the fixed options so the helper ends itself; or run git in its own process group and kill the group. |
| m3 | `repo-fetcher.ts` `classifyFailure` | Real git messages miss every classifier. With `credential.interactive=false` and an empty askPass, a 401 or a GitHub 404 prints `fatal: unable to get password from user`; a GitLab URL without `.git` prints `The requested URL returned error: 301`. Both fall to the generic "the fetch failed; unknown whether the repository exists". Still honest and never "gone", but the 401/403/404/redirect branches fire only on messages the tests invented; the redirect branch looks for the word "redirect", which git 2.55.0 never prints with `followRedirects=false`. The DoD asks for the detail. | CONFIRMED live (`repros/dbg.mjs`; `git ls-remote` on a GitLab URL with and without `.git`). | Match `unable to get password`, `error: 30[1278]` (say "add .git"), and test against captured real stderr. |
| m4 | `repo-fetcher.ts` `guardGitUrl` | The guard promises to refuse every name that can only resolve inside some network, but `*.home.arpa` and `*.in-addr.arpa` pass (`arpa` is a delegated TLD). Wildcard-DNS names (`127.0.0.1.nip.io`, `localtest.me`) pass by design (DNS rebinding is the stated residual risk). With M2 a hostile repo chooses the name. TLS verification limits the damage to hosts holding a valid certificate. | CONFIRMED (`repros/tld.mjs`, `guard.mjs`) | Refuse the `arpa` TLD; for rebinding, resolve first and refuse private addresses, or state it in the user docs, not only in a comment. |
| m5 | `repo-fetcher.ts` (no size cap), cache layout | A fetched repository is bounded only by the wall clock (disclosed). 90 s of a fast link is several GB on disk, kept forever under `.crankpath/repos/...@sha` (nothing prunes the cache). With M2 a hostile repo triggers it. Brief: fail closed on size limits. | PLAUSIBLE (traced) | Derive a byte ceiling from `fileBytes x filesPerScan`, check the checkout size after the clone and refuse (counted `limit`), delete it; add a cache prune or a `--cache-dir` size note. |
| m6 | tests (see section 3) | Several checks have no test that can fail: the pinned-sha mismatch refusal after clone, the `svc` label rule, the option-injection check in `isSafeRevision` at the allowlist layer, the Go-mode `in-cluster` server value, `startsWith` vs `includes` of the auth origin. The "lists exactly the options" test is a literal copy of the list: five options (`followRedirects`, `hooksPath`, `credential.helper`, `safe.bareRepository`, ...) are protected only by that copy, no behaviour test. | CONFIRMED by mutation | One behaviour test per option that matters (the listener lane in `repros/argv.mjs` shows how; the redirect and header-scope tests are easy). |
| m7 | `docs/limits.md` "B3 step 0", `limits.ts` basis texts | Doc claims the code does not back: "on ordinary path lengths the budget is what binds" is false for files (the budget charges 577 + 2 x path length, so about 3.6 million files fit; `filesPerScan` = 279,235 binds first). `generatorPatternSteps` (1,572,864) binds a git `directories` generator at about 28,000 directories, long before the 96,638 Application limit: 97,500 directories gave one opaque `limit` and zero Applications (61 s). When the run budget refuses a generated set, the expander's own more specific `limit` mark is discarded (`exp.mark` never recorded) and the generic "memory budget" mark replaces it. | CONFIRMED (arithmetic; `big` and `big2` runs) | Correct the sentences; record `exp.mark` before the budget check. |
| m8 | `repo-fetcher.ts` cache hit (`detachedHead`) | A fetch of a branch or the default branch caches under `repo@<sha>` with a symbolic HEAD, so a later `--rev <that sha>` (and `--no-network`) does not hit the cache: online it fetches again, offline it fails `offline` although the commit is on disk. | CONFIRMED (CLI run: `--rev main`, then `--rev <sha> --no-network`) | Accept a symbolic HEAD whose resolved commit equals the sha (read `.git/refs`/`packed-refs`), or write the checkout detached. |
| m9 | integration | `main` is now at B6 (`1df4b0a`): merging gives 10 conflicted files (`BUILD-NOTES.md`, `docs/limits.md`, `docs/lookups.md`, `report-assembler.ts`, `text-renderer.ts`, `cli-shell.ts`, `cli.ts`, `pipeline-runner.ts`, `limits.test.ts`, `cli.test.ts`). B6's frozen report schema has `additionalProperties: false`, so B3's new fields (`clustersUsed`, `repoMappings[].commit/floating/failure`) fail it until schema, golden and `docs/json-output.md` are extended (additive, so `schemaVersion` stays). B2's `render-io.ts` still passes `job.generatedBy` (disclosed by the builder). | CONFIRMED (`git merge-tree`, schema read) | Do these at the merge; add the plain-render `generated-by` assertion to the Helm and Kustomize paths too. |

### Nit

- n1. `normaliseRepoUrl` makes `https://h//ops/x` and `https://h///ops/x/` equal to `https://h/ops/x`, and `git@h:/ops/x` (absolute) equal to `git@h:ops/x` (home-relative). Matches FR2.3's "leading and trailing /" wording but is two spellings made equal; refusing a run of leading slashes is the stricter choice.
- n2. Redundant guard branches no test can kill (equivalent mutants): the second `.internal` and `.cluster.local` checks, the numeric-last-label check (the root-zone list already refuses them).
- n3. `.crankpath/tmp` is left as an empty directory after a run. A repository path `org/x@<sha>/y` is created inside a cached checkout `org/x@<sha>` of the same host (PLAUSIBLE cache pollution, contrived).
- n4. `test/fixtures/thin-slice/expected.json` was edited by hand (one line), not regenerated. Tests pass, so it equals a real run.
- n5. The homelab run reports the two cycles as one strongly connected component; the text shows only the shortest cycle and "7 more edges in the JSON". Both cycles are in the JSON (verified). The DoD wording "reproduces both cycles" is met in that sense only.
- n6. `review-b1-pass2.test.ts` "a closed output pipe ends quietly" failed in 2 of about 34 mutated runs under CPU load (flaky, not B3's).

Pre-existing, outside the bolt: `main` tracks 733 files under the design tool's workspace folders and its start file; the hard rule says they must never ship. Not in the B3 diff (checked: the diff adds none of those names or paths).

## 2. Hard rules, checked

- Independence and paths: no employer, company or hostname, no personal path in the added lines (grep clean); fixtures use `example.org`; the homelab fixture is original (no copied text).
- Design-tool names or paths in added or edited files: none.
- Licence/NOTICE: unchanged and still correct (no third-party copy added; Argo CD sources only read, hashes recorded).
- Commit identity: all four commits `naren-ambati <32987080+naren-ambati@users.noreply.github.com>` with the Opus 5.5 trailer.
- Local only: the fetcher is read-only; no remote writes. `docs/lookups.md` dates each lookup.

## 3. Tests that cannot fail (mutated in a copy; each restored)

Killed (red as it should be): `followRedirects` / `hooksPath` / `credential.helper` / `safe.bareRepository` removed (only the literal-copy test), `protocol.allow` removed (2 tests), token variable `-`/`.` swapped, auth-origin check removed, root-zone check, query, credential, non-ASCII, URL-host percent, host non-ASCII authority, `generatedBy` restored in the plain renderer (3 tests), limit `>=` to `>` (3), duplicate names (1), alias-to-scanned-root label (3), hidden directories, exclude as include, crank applier generator origin, abbreviated-sha leading dash in `planRevision`, `missingkey=error`, walk admission stop, matrix cap, untrusted-cache branch.

Survived (no test goes red):
- pinned `--rev <sha>` but the clone resolves to another commit (`sha !== plan.value`);
- the `svc` label refusal (`kubernetes.default.svc.example.com`);
- `isSafeRevision` leading `-` at the allowlist layer (the `planRevision` copy is tested, the allowlist copy is not);
- Go-mode `server` of the `in-cluster` cluster;
- `url.startsWith(origin)` weakened to `includes` (the guard refuses the inputs that would matter, so low value);
- `.internal`, `.cluster.local` duplicates, numeric last label (equivalent mutants, n2).

Behaviour of the fixed git options, which no unit test shows and I did show against git 2.55.0: every one of the 18 keys exists in `git help --config`; `protocol.allow=never` with only https allowed refuses http ("transport 'http' not allowed"); `http.followRedirects=false` turns a 301 into an error, and the token is not forwarded; `--config-env http.<origin>.extraHeader=VAR` (two-argument form) sends the header to the exact origin and not to `localhost` for `127.0.0.1`; `--revision <sha>` with `--single-branch --no-tags --depth 1` works, and so do `--revision refs/heads/main` and `--branch main`; a clone with the header in the environment holds no trace of the token. A live fetch with an empty PATH worked (the live lane printed RAN, pinned and matched); the token-as-base64 grep over cache, stdout and stderr found nothing.

## 4. Definition of Done, item by item

| Item | Verdict | Evidence |
|---|---|---|
| Homelab shape, one alias, no declared edges, both cycles | Met (n5) | one SCC of 5 nodes and 9 edges holds both; `Run status: ANALYSED`, declared edges 0; I ran it |
| Without the alias: opaque `unreadable-repo` ApplicationSet with the suggested entry (M3) | Met with `--repo-url` (the form the notes and fixture use). Without any URL known there is no suggestion, by the "never guesses" rule | I ran both |
| A look-alike URL is unreadable | Met | 49 spellings checked (`repros/ident.mjs`): case, `.git`, ports, ssh/scp, percent, non-ASCII, punycode, `\`, `@`, `//`; only the n1 spellings compare equal, by FR2.3 |
| No token reaches another host | Met for hosts, partly for ports (m1); also M2 | traced and tested |
| Token never in argv, output, cache, logs | Met (env only, never printed); orphan helper holds it in its env after a timeout (m2) | grep of cache/stdout/stderr; m2 |
| Git options real and doing what is claimed | Met (all real; behaviour shown above) | section 3 |
| 403/404/timeout/rate limit as `unreadable-repo` with detail, never "gone" | Partly: never "gone", but real messages mostly fall to the generic detail (m3) | live runs |
| Floating revisions flagged, sha recorded | Met | JSON `repo.commit`, `floating: true` for `--rev main` and the default branch |
| GeneratorExpander: list, git (directories, files), clusters, matrix, merge, both template forms, injection safety | Met for semantics; hostile names (`{{x}}`, spaces, newline, uppercase, leading `-`) are skipped as `invalid-name` and named, no id forging; duplicate names refused; a plain Application of the same name gives `conflicting-definitions` | `repros` fixtures |
| Generated-Applications limit as a counted `limit`; derived limits | Not met for the bytes (M1); counted but replaced by the generic mark when the budget refuses (m7) | section 1 |
| `clusters:` block as a declared fact and gap; matrix/merge without the block | Met; expanding matrix and merge with no `clusters` child without the block is safe (no cluster input is involved, and a `clusters` child without the block is `cluster-inputs-missing`) | code and tests |
| `generatedBy` bug fix | Met in the plain renderer; a test kills the mutant; the hazard in B2's `render-io.ts` is disclosed (m9) | mutation |
| Fetch cache layout `.crankpath/repos/<host>/<path>@<sha>/`, untrusted in-tree cache never read | Met (m8, n3) | tests, CLI run |
| Live read-only lane, SKIPPED offline | Met (I ran it: RAN) | `scripts/live-fetch.mjs` |
| `npm run verify` green | Met (58 files, 1,049 tests) | I ran it |
| BUILD-NOTES section, report | Met; it discloses the owner item behind M2 and the unrun mutations | |

## 5. Checked and found sound

- Token variable naming is injective: labels cannot start or end with `-`, so a run of `_` made of hyphens is always even and a dot is a lone `_` (checked on `a-b.c`, `a.b-c`, `a--b.c`, `xn--a.b`); the test table and a mutation back this up.
- The child environment is built from nothing (no proxy, no `GIT_*` from the user, no global or system config); `--config-env` keeps the token out of argv; the auth origin must be a prefix of the clone URL and a different origin is refused before a process.
- A redirect is an error (confirmed), so a token cannot follow one; a submodule or `.gitmodules`, hooks, `insteadOf` in a repo-local config cannot act: the clone writes its own `.git/config`, `submodule.recurse` and `fetch.recurseSubmodules` are false, hooks path is `/dev/null`, and `.git/config` of the scanned repo is only read as text (`insteadOf` is documented as not followed).
- IP literals in every form I tried (`127.1`, hex, octal, decimal integer, IPv6 and mapped IPv6, trailing dot, percent-encoded) and userinfo, port 0 and 99999, backslash, `#`, `?`, non-ASCII and zero-width characters are refused before any process; IDN look-alikes are non-ASCII and refused, punycode hosts compare as ASCII and never match the real host.
- Path params and Go-template and fasttemplate injection: one pass, values never re-scanned, `{{` in a map key refused, prototype-safe maps, unknown constructs refused by name, unknown fasttemplate tags kept literal (as the notes state); generated names are validated downstream so a `{{` or newline name cannot forge an id.
- Pattern matching is a non-backtracking table counted in steps; a spent budget is an opaque `limit`, never a hang (97,500 directories ended in 61 s with a counted limit).
- Cache root inside the scanned tree is untrusted, never read; a symlinked `.crankpath` or `tmp` is refused; the fetch work directory is removed at the end.

## 6. Verdict

**Not ready.** Two Majors: M1 (a hostile ApplicationSet can crash the tool or run it for minutes: the per-ApplicationSet limit counts Applications, not their size, and the budget is charged only after generation) and M2 (a scanned repo's config decides which private repositories the invoker's token reads, default-on). Both fixes are small and general. After them and m2/m3 (the orphaned token-holding helper, and failure words that real git never produces) it would be ready to merge after fixes, with the B6 merge work in m9 done at integration.

*Committed by the builder with one phrase of the pre-existing note above reworded (the design tool's start file is named in words, not by its file name, which check-tree refuses in a tracked file); nothing else changed.*
