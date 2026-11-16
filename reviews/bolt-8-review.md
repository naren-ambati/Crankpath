# Review of bolt B8 (the GitHub Action)

- Bolt: B8, the GitHub Action (U10, C10, US10.1 to US10.3)
- Branch: `bolt/b8`; commit reviewed: `1f55063`; base: `main` `1df4b0a` (reviewed as `git diff main..1f55063`)
- Date: 2026-11-15
- Reviewer: Claude Sonnet 5.5, independent read-only review
- Method: read the diff and the design rules (BR10.1 to BR10.10, OD-11, OD-24, OD-27, OD-30, M7); ran `npm run verify` on a scratch clone (exit 0: 69 files, 1140 tests, 97.28% lines, check-tree 0 findings); ran the local harness twice (byte-identical); drove `action/action-entry.mjs` with hostile repositories (repro scripts kept in the scratch folder `review-b8/repros/`, run from a clone of `1f55063` after `npm ci --ignore-scripts && npm run build`); applied 26 single-line mutations to the Action's code and re-ran `test/u10-github-action` after each; read the pinned action commits from the public API.

## 1. Findings

Counts: Major 1, Minor 6, Nit 4.

### Major

| id | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|
| M1 | `action/base-head-differ.mjs` `diffReports` (only `timeouts` and NOTHING ANALYSED are blocking); `action/summary.mjs` `notAPassClauses`; `exitStatus` | A pull request hides a cycle by making the file that carries it unreadable, or a symlink, or a source opaque. The head loses the cycle, the head's gaps rise, and the result is `NO_NEW_CYCLES_FOUND`, exit 0, so the job shows as success. The gap is worded in the first summary line and as a warning annotation only. Repro: base = full estate (Gitea cycle); head = the same tree with `apps/gitea.yaml` replaced by `a: [unclosed\n  b: {` gives exit 0, `result=NO_NEW_CYCLES_FOUND`, "head analysis has gaps (listed below)". The same with `platform/gitea/service.yaml` (head "at least 1 opaque (base 0)") and with `apps/gitea.yaml` replaced by a symlink: all exit 0. Only the opaque count is compared base against head; unreadable files, skipped objects and unresolved items are not. Per AC10.3.2 and BR10.10 the wording is honest, but the job conclusion is a green check for a head that read less than the base, and the checked party controls that. The design's own component note says an incomparable side (error or gaps) is NOT CHECKED, and BUILD-NOTES deviation 7 chose the other reading. | CONFIRMED (`repros/a2.mjs`) | When the head's gaps exceed the base's in any counted dimension (opaque, skipped, unreadableFiles, unresolved, run limits), end `NOT_CHECKED` (job not green) with the named rise, or add an input (default strict) that does so. Owner decision: AC10.3.2 as written permits the current behaviour, so state the decision in OPEN-DECISIONS and in `docs/action.md` either way. |

### Minor

| id | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|
| m1 | `action/action-entry.mjs` `compare` (no base-equals-head check) | `base-ref: HEAD` (or any ref resolving to the head commit, for example `${{ github.sha }}` on a push) compares a commit with itself: exit 0, `NO_NEW_CYCLES_FOUND`, summary shows the same 12-character id twice. No real comparison was made. Not PR-controlled, so not Major. | CONFIRMED (`repros/g.mjs`, case G1) | If `baseCommit === headCommit`, add a reason `base-is-head` (NOT CHECKED). |
| m2 | `action/action-entry.mjs` `GIT_OPTIONS`; `docs/action.md` "What it writes" | `checkout-index` applies `.gitattributes` from the working tree, which for a pull request checkout is the head's: a head `.gitattributes` line `*.yaml filter=<name>` runs any filter driver defined in the runner's global or system git config (Git LFS on hosted runners) while the copy is made, for the base copy too. With a driver configured the command ran (marker file written). Impact on a hosted runner is an LFS pointer download or other installed filter, not arbitrary code; `protocol.allow=never` does not cover it. The guide's claim that an earlier step's or the checkout's edits "change nothing" is also not true for attributes. BUILD-NOTES "Unverified" lists LFS, but not that the head controls the trigger. | CONFIRMED mechanism (`repros/f.mjs`); runner impact PLAUSIBLE | Make the copy attribute-free: pass `-c core.attributesFile=/dev/null`, set `GIT_ATTR_NOSYSTEM=1`, and use `--attr-source=<empty tree id>` (git 2.40 and later), or write blobs from `git cat-file --batch`. Add a test with a global filter driver and a marker. |
| m3 | `action/action-entry.mjs` copy-out | A submodule (gitlink) in the head becomes an empty directory; nothing is counted or listed as a gap, so manifests behind a submodule are never read and the summary does not say so. | CONFIRMED (`repros/e.mjs`, E5: exit 0, no gap annotation) | Count tree entries of mode 160000 per side (`git ls-tree -r`) and add a named gap line and a counted reason (or NOT CHECKED under the M1 rule). |
| m4 | `action/summary.mjs` `reportLines` ("Cycles cranked in the head") | A pull request that adds a new cycle and a crank for it is rendered the same as one that adds a crank to an old cycle: the cranked head cycle is listed as `label: cranked` with no mark that its edges are absent from the base. The reviewer cannot see that the crank covers something the PR introduced. BR10.3 is met; the information BR10.10 exists for is thin. | PLAUSIBLE (traced; `crankedInHead` is not diffed against the base edges) | Add `(edges new in this pull request: N)` for each cranked head cycle whose edges are not all in the base graph. |
| m5 | tests | Two mutations survive all 88 tests: removing `-c core.hooksPath=/dev/null` from `GIT_OPTIONS` (88 pass), and changing the CLI's `stdio` from `["ignore","ignore","pipe"]` to `["ignore","inherit","pipe"]` (88 pass). The second is the one that matters: if the CLI's standard output reached the runner it could carry `::` commands built from repo text, and no test pins that the CLI's stdout is discarded. | CONFIRMED (mutations `m15`, `m18`) | A probe CLI (as in the token test) that writes `::error::x` to stdout must produce no such line in the Action's stdout; a test with a hooks directory in the repo config. |
| m6 | `action/action-entry.mjs` `compare`; `docs/action.md` Inputs | The default base is `github.event.pull_request.base.sha`, the base tip when the event fired; the head `HEAD` is the merge commit, which contains whatever base commits landed later. A cycle another PR added to the base branch in between is reported as new in this PR. The summary prints the merge commit as "head commit". Not exercised (no hosted run). | PLAUSIBLE | When `HEAD` has two parents, compare with `HEAD^1` (the merge's own base side) or state in `docs/action.md` that a stale base can attribute main's cycles to the PR; say "merge commit" in the summary. |
| m7 | `docs/action.md` Inputs (`config`, `repo-alias`) | "Absolute: the same file for both" has no warning that an absolute path inside the workspace is the head's checked-out file, so one PR-controlled file then drives both sides and a PR can edit the "base" config. | PLAUSIBLE | One sentence: absolute paths must be outside the workspace (a trusted file), else the base is not independent of the PR. |

### Nit

| id | location | note |
|---|---|---|
| n1 | `action/action-entry.mjs` `runAction` | With `GITHUB_STEP_SUMMARY` or `GITHUB_OUTPUT` unset, the Action skips the write silently and exits 0 for `NO_NEW_CYCLES_FOUND` with no outputs (`repros/g.mjs` G2). Always set on a hosted runner; failing closed would be consistent with the write-failure branch. |
| n2 | `action/action-entry.mjs` `runCli` | No timer: a hung CLI holds the runner until the job's `timeout-minutes` (the platform default is 360 minutes if the workflow omits it). Documented; a generous backstop (say 20 minutes, then NOT CHECKED "timeout") would cap hostile-input cost. |
| n3 | `docs/action.md` | The harness proves the entry script, not `action.yml`, `build.sh`, `setup-node` or the `base-ref` default expression; the guide and BUILD-NOTES say so. The `action-yml.test.ts` checks pin the env names, so the mapping cannot drift silently. No action needed. |
| n4 | `test/fixtures/action` | Cases cover the brief's seven plus `shallow`, `tool-error`, `unrelated-change`; none covers a head gap rise (M1) or a combined new cycle plus crank. Add both. |

## 2. Tests that cannot fail

I mutated the code in a scratch copy, one line at a time, and ran `test/u10-github-action` after each (restored afterwards).

Went red (the tests can fail): new-edge check off (10 red); `GITHUB_TOKEN` added to the CLI allowlist (2); workflow-token value filter removed (2); crank-removed branch off (4); `:` not encoded in properties (1); `\n` and `\r` not encoded (1 each); backtick not escaped for Markdown (3); exit status 0 for every result (13); CLI exit codes not checked (3); base-ref option and `..` guards (1 each); annotation `file` guard off (3); base cycle edges not counted as base edges (1); ordering-only edges counted as base edges (1); timeouts ignored (1); NOTHING ANALYSED ignored (4); path missing from a side not checked (1); `--show-prefix` ignored (1); `new-cycles=0` instead of empty on NOT CHECKED (8); hidden-cycle bookkeeping (1); opaque-rise clause off (1); summary byte budget off (1); declared-edge label not treated as uncranked (1).

Survived (cannot fail): `core.hooksPath=/dev/null` removal; CLI stdout `ignore` to `inherit` (see m5).

## 3. Definition of Done, item by item

| Item | Status | Evidence |
|---|---|---|
| A fixture PR adding a cycle fails | met | harness `add-cycle`: exit 1, `result=FAILED`, `new-cycles=1`, `::error file=apps/gitea.yaml,...`; test asserts it |
| A crank in the PR gives NO_NEW_CYCLES_FOUND with the crank listed unverified | met | harness `add-crank`: exit 0; crank line "documented by the PR author, not verified"; warning annotation. See m4 (new-vs-old not shown) |
| No base gives NOT CHECKED, not green | met | `no-base` and `shallow`: exit 1, `result=NOT_CHECKED`, `new-cycles=` empty; the same for NOTHING ANALYSED, tool error, path missing |
| Crank removed fails (OD-27 a) | met | `remove-crank`: FAILED; mutation m6 turns 4 tests red |
| Cycles from a newly readable source count as new (OD-27 d) | met by construction | their edges are absent from the base; BR10.1 test |
| NOT CHECKED on timeout either side (OD-27 c, OD-30) | met on synthetic reports only | unit test; B2's timers not on `main` |
| Summary and annotations safe (BR10.4) | met | hostile-name case, 4 destination mutations red; I found no breakout (see section 4) |
| Token never reaches the CLI (BR10.5) | met | probe test; 3 mutations red |
| Built from own checkout, `npm ci --ignore-scripts`, no registry (BR10.6) | met in files, never run on a runner | `action-yml.test.ts`; stated in the guide |
| Gaps beside the result (BR10.8, BR10.10) | met in wording, not in conclusion | see M1 |
| Pinned SHAs real, dated, in `docs/lookups.md` | met | `setup-node` `949feb24...` is the commit of tag v7.1.0 and `checkout` `3d3c42e5...` the commit of v7.0.1 (public API read, 2026-11-15) |
| `docs/action.md` (D11), harness, determinism | met | two harness runs byte-identical; real output quoted and test-checked against the doc |
| `npm run verify` green | met | exit 0; 1140 tests; lines 97.28%; check-tree 0 findings |
| BUILD-NOTES section | met | present, with deviations, owner decisions, unverified |
| Hard rules: independence, no design-tool names or personal paths, licence, commit identity | met | grep of the added lines found none; all five commits by the required identity with the Opus co-author line; no `NOTICE` change needed (no third-party copy) |

## 4. Checked and found sound

- Summary injection: every repo string passes `safe()` (printable ASCII only; backtick, `<`, `>`, `&`, `[`, `]`, `!`, `|`, `*`, `_`, `~`, `#` become `\xNN`), sits after a fixed label inside quotes, inside one `text` fence whose closing run cannot be produced. The hostile-name harness case (workflow commands, Markdown links and images, HTML, newline, terminal escape in file names and in crank text) renders inert in summary and annotations. Emoji shortcodes and `@mentions` stay inside the fence.
- Annotations: `escapeData` and `escapeProperty` match the runner's rules (`%`, `\r`, `\n`; plus `:` and `,` in properties); `file=` only for plain repository paths; `line=` is an integer; titles are fixed; counts capped at 10 per kind with a counted last line.
- `GITHUB_OUTPUT` carries only `result` and `new-cycles` (fixed values), so no delimiter injection; `GITHUB_STEP_SUMMARY` receives only the rendered text.
- Token isolation: the CLI gets the allowlist, `NO_COLOR` and `CRANKPATH_TOKEN_*`; git gets `PATH` and `HOME`; the CLI runs with its working directory in the copied tree, which has no `.git`.
- `action.yml`: inputs are environment variables only; no `${{` in any `run:`; the `setup-node` cache is off, so the workspace's `package.json` cannot select a package manager.
- git copy-out: `read-tree` plus `checkout-index --prefix` under `RUNNER_TEMP`; hooks and fsmonitor off; symlinks in the head (to `/etc`, to the workspace `.git`) are recreated as links and the CLI refuses them (gap, no read); case-colliding paths make `checkout-index` fail so the result is NOT CHECKED (`repros/h.mjs`, on a case-insensitive filesystem); a head `crankpath.yaml` with `repos: read_from` outside the tree (`/etc`, `../../..`) stops the CLI and gives NOT CHECKED with the quoted message (`repros/i.mjs`).
- Input validation: `path`, `config`, aliases and `base-ref` reject traversal, options and revision expressions; `--end-of-options` is used.
- New-cycle definition: edge identity (from, to, kind); rename gives a new cycle (documented false positive direction); base crank-rerouted edges count as base edges; crank removed fails; declared-edge cycles fail; per-cycle judgement means a crank covering one cycle cannot excuse another new cycle.
- Every uncaught error ends NOT CHECKED and exit 1; temp files are removed (test).
- Wording: no "passed", "OK", "clean", "safe"; "pass" and "green" only negated; `NO_NEW_CYCLES_FOUND` always opens with "Not a pass".

## 5. Verdict

Ready to merge after fixes. M1 needs an owner decision or a fix (the check can be made green by a PR that makes its own cycle unreadable); m1 to m3 and m5 are small and local; the rest are documentation and polish.
