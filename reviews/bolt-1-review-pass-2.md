# Independent review, second pass: bolt B1 (thin slice)

- Bolt: B1; branch `bolt/b1`; commit reviewed `ada4372` (first pass reviewed `9ac9590`; fixes `9ac9590..ada4372`)
- Date: 2026-11-15
- Reviewer: Claude Sonnet 5.5, independent read-only review
- Method: read the whole fix diff (22 files, 670 insertions); `npm run verify` re-run in a scratch clone (green: 27 files, 343 tests, coverage 93.33% lines, check-tree 0 findings); re-ran every first-pass surviving mutant plus 11 new mutants against the new tests; ran the built CLI on hostile and large inputs; ran old build and new build on the same trees and diffed JSON and text. Repros: `review-b1-pass2/repros/` in the scratch area (listed at the end).

## 1. Were the first-pass findings fixed?

| first-pass id | verdict | evidence |
|---|---|---|
| M1 (repo config shadows `--repo-alias` root) | fixed, but the fix opened N1 below | disjoint label spaces `.` / `alias:N` / `repos:<path>`; the original probe now shows `ConfigMap/x/from-user-dir` with and without the repo's config; `read_from` spelled `alias:1`, `./alias:1`, `alias:1/`, `alias:1/p`, `alias:01` is refused with the key path quoted; `sub/../alias:1` is refused as outside the root; a repo directory `alias:1` is shown as `./alias:1/p/r.yaml` while the user's alias root shows `alias:1/p/r.yaml` (both seen in one run). Mutants `repos-label-flat` and `alias-read-from-allowed` go red |
| M2 (hook annotation erases an object) | fixed for what B1 can do; the counted-and-shown half is untested (m1) | no code path in B1 sets `dropTestHooks`, so a plain directory now keeps every object (probe: the Deployment is back, 6 matches); mutant `drop-hooks-always` goes red |
| M3 (hostile size ends in an uncaught throw) | NOT fixed (N2, m4): the JSON `RangeError` is gone and replaced by a slow success; the missing bound now ends in a heap-out-of-memory abort | see N2 |
| m1 (`.json` discovery) | fixed | `a.json` Application discovered; mutant `json-ignored` red; hostile JSON checked below |
| m2 (`--out` inside alias or `repos:` tree) | fixed | refused for scanned root, alias root, `repos:` root, a symlinked directory that resolves into either, and a differently-cased spelling of the path (`realpathSync.native`); a final-component symlink is refused by `O_NOFOLLOW`; mutant `out-main-root-only` red |
| m3 (selector O(S x W)) | partly: only for selectors that include a rare label pair (m4) | |
| m4 (foreign destination silent) | fixed | counted from node flags, shown in the opacity section, the closing line and JSON; suppresses `(nothing opaque, nothing skipped)`; mutant `foreign-count-zero` red |
| m5 (rounding) | fixed in the stated direction | exact share rounds up, a lower bound rounds down; the integer arithmetic is exact (no float edge); see n3 for `at least 0%` |
| m6 (absolute path in exit-2 text) | fixed | only the last segment, marked `(absolute path, last segment only)` |
| m7 (`files ignored` wording) | fixed | `hold no source document`; expected files edited exactly as recorded (my diff of both files: two lines each) |
| m8 to m11 (test gaps) | fixed, all four old survivors now red | `secret-gate-true`, `host-ns-forms`, `wave-hard-edges`, `wave-default0-edges` each fail one test in `review-b1.test.ts`; `secret-keep-data` (m11) fails 3 tests |
| n2 (cache key), n4 (README) | fixed | key is length-prefixed; README wording softened |

Old-source check of the new tests: copied `review-b1.test.ts` onto `9ac9590`: 13 of 17 fail there and 4 pass (m8 to m11, the mutation-survivor tests), so the tests do fail on the broken code.

## 2. Findings

Counts: **2 Major, 4 Minor, 4 Nit**.

### Major

| id | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|
| N1 | `src/u9-cli-package/pipeline-runner.ts` `setRoot` (throws on a second `repos:<path>` label) fed by `config.repos` | Two `repos:` entries that name one directory (two mirror URLs of one checkout, or `sub` and `sub/`, or `sub` and `sub/.`) set the label `repos:sub` twice. The fix's own assertion ("a bug") throws, and the new top-level guard turns it into `error: crankpath stopped on an internal error (a bug, ...)`, exit 1, no analysis. The config is valid and was analysed at `9ac9590`. The repo-supplied `crankpath.yaml` can therefore decide that an analysis is not produced and that it is reported as a crankpath bug (usage exit code). The guard comment calls this "a bug"; it is reachable from input. No test covers it: removing the assertion leaves all 343 tests green (mutant `root-overwrite`). | CONFIRMED: `repros/probes-pass2.sh` N1 (exit 1 for `sub`/`sub`, `sub`/`./sub/`, `sub`/`sub/.`); a different-case URL pair, a different directory pair and `.git` URL pair behave correctly (the last is refused by config validation). | Key the root map by resolved directory, not by label count: reuse the existing root when `read_from` resolves to a directory already opened under `repos:` (map both URLs to one label), and keep the assertion only for labels no input can produce. Add a test with two URLs and one `read_from`. |
| N2 | `pipeline-runner.ts` (hook comment where each RenderedSet is taken in; no object, node or edge bound), `cli-shell.ts` `main` guard | The first-pass M3 asked for a derived object bound so a limit hit is a counted `limit` outcome. It was deferred to B2, so the Definition-of-Done line "a limit hit is a counted, named `limit` outcome, never a crash" is still not met. The guard added in its place cannot catch the real failure: a 6 MB hostile tree (1,500 Applications with distinct destination namespaces all pointing at one directory of 3,000 ConfigMaps, 4.5 million nodes) ends in `FATAL ERROR: Reached heap limit ... JavaScript heap out of memory`, a native stack on stderr and exit 134 (peak 4.7 GB). The guard message claims to cover "input beyond what it can hold"; it covers only a catchable exception. The 1.7 MB variant of the first pass now succeeds in 46 s (JSON) instead of throwing, which is slow, not bounded. | CONFIRMED: `repros/probes-pass2.sh` N2. | Derive a per-scan node bound from the memory the run may use, count a `limit` opaque mark on the owner when a job would exceed it, and stop expanding Applications once reached (B2 step 0 as noted, but it must land before the DoD line is claimed; until then say in BUILD-NOTES that the DoD line is open). Do not describe the guard as covering size. |

### Minor

| id | location | scenario | status | fix |
|---|---|---|---|---|
| m1 | `report-assembler.ts` (`droppedHooks: input.droppedHooks`), `pipeline-runner.ts` (`droppedHooks += set.droppedHooks`), `text-renderer.ts` (`dropped:` line) | The "counted and shown" half of the M2 fix has no test: zeroing the assembler field, removing the pipeline accumulation, and disabling the `dropped:` line each leave all 343 tests green. Nothing in B1 produces a drop, so nothing is silent today; B2 will set `dropTestHooks` and the only guard for the display path is untested code. The first pass asked for a test that the drop is visible in text and JSON. Also `isTestHook` uses `startsWith("test")`, wider than the hook values Helm defines (`test`, `test-success`, `test-failure`): a value such as `tester` would drop an object. It is counted, not silent, but B2 should narrow it. | CONFIRMED (three surviving mutants) | A unit test that assembles a report with `droppedHooks: 2` and checks the text line and the JSON count; match exact hook names. |
| m2 | `cli-shell.ts` `main`, `cli.ts` | The guard wraps only synchronous errors. A closed pipe (`crankpath ... | head -1` on a report of 24,000 lines) raises an asynchronous `EPIPE` on stdout that is not caught: Node prints `Unhandled 'error' event` with a full stack, naming the build's absolute path, contrary to "no stack". Writing line by line makes this more likely than the old single write. | CONFIRMED (text run piped to `head -2`) | Handle `error` on `process.stdout` in `cli.ts` and exit quietly. |
| m3 | `cli-shell.ts` `writeOut` | The output file is opened with `O_TRUNC` before the report is rendered (`produce` runs after the open). An internal error, or a write failure part-way, leaves a truncated or empty file where a previous good report was, and the guard line says "no report was written" although a partial file or partial stdout exists. | PLAUSIBLE (traced; the render step runs inside `produce`) | Render fully to chunks (or open after the lines/value exist), or write to a temporary name and rename; reword the message ("report incomplete"). |
| m4 | `workload-refs.ts` selector index (first-pass m3) | The index picks the rarest pair, so a selector whose pairs are common is still O(S x W). 8,000 Services with `selector: {app: x}` and 8,000 Deployments labelled `app: x` (1.7 MB, ambiguous everywhere): 151 s, 1.8 GB. Timing is quadratic: 1,000 each 2.3 s, 2,000 each 8.4 s, the same as `9ac9590` (2.6 s, 8.3 s). The index only helps the selective case the first pass timed. | CONFIRMED (timed, both builds) | For a Service whose candidate list exceeds the ambiguity threshold, stop at the second match (a count above one is already "ambiguous") and list at most a bounded sample of ids; bound total work through N2. |

### Nit

| id | note |
|---|---|
| n1 | A JSON file with a duplicate key is reported as `not valid YAML` (the reason word is the YAML reader's). Counted and named, so honest; the word is misleading for a `.json` file. |
| n2 | Only `.json` and `.yaml`/`.yml` are manifests, so any other repo `.json` (a lock file, a tsconfig) is now read and parsed at discovery. Hostile cases checked: a 200,000-deep array is `too deep`, a 6 MB file is read and counted as holding no source document, `__proto__` keys and duplicate keys are handled, a comment-bearing tsconfig is read. No crash and no hang. A JSON file that cannot be parsed now makes the run `at least` (a new, honest gap). |
| n3 | With a lower bound the text prints `at least 1 of 1000 ... (at least 0%)`: true, and the count is printed beside it, but `0%` is what a quick reader keeps. Print `less than 1%` or one decimal when the count is above zero. |
| n4 | BUILD-NOTES says "11 of 17 red; the other six are the mutation-survivor tests"; measured 13 red and 4 pass (the four are m8 to m11). The fixes section also records no `npm run verify` result for `ada4372` (mine: 27 files, 343 tests, coverage 93.33%). Separately, `foreign-destination-objects` is a not-verified item, not a gap reason; when B5 removes `not-computed`, a run with foreign-destination objects could read `ANALYSED` with the count only in the closing line. Decide in B5 whether it is a gap. |

## 3. Where the fixes meet (the questions asked)

- **Root labels.** A repo directory, config entry or URL cannot reach an `alias:N` root: `repos:` labels carry a prefix, `read_from` spelled like an alias label is refused in every normalised spelling I tried, and a repo directory spelled like one is shown with `./`. The cache key is unambiguous (length prefix). The one hole is N1 (duplicate label crashes instead of sharing a root). Display of an object at the same path from the scanned root and from a `repos:` root is identical, which is correct because `read_from` must be a real directory inside the scanned root.
- **Test hooks.** Dropped only when `dropTestHooks === true`; nothing in B1 sets it (grep: the option exists only in the builder and tests), so repo content cannot switch it on today. In B2 the switch will follow the source kind, which repo content chooses (`chart:`, `Chart.yaml`); that is Helm's own rule, and each drop is counted, but the display path is untested (m1) and the match is wider than Helm's values.
- **Top-level guard.** It never changes a 0 or 2 into 1 for ordinary hostile fields: 228 runs with every Application field replaced by 12 hostile values (null, `[]`, `{}`, scalar, nested, `__proto__`, newline) produced no internal error. The reachable false exit-1 is N1; a render error after analysis would also give exit 1 with no report (by design). The fixed message holds no repo text. It does not cover asynchronous stream errors (m2) or fatal out-of-memory (N2).
- **Chunked JSON writer.** Byte-identical to the previous layout: old build versus new build on five trees gives only the intended additions (`droppedHooks`, `foreignDestination`, the new wording); output parses as JSON, ends in exactly one newline, and two runs are identical. Chunks end between emitted values, so no surrogate pair is split. It still builds the whole value first (no memory saving there; N2).
- **`.json` discovery.** See n1, n2. Same set as the plain renderer.
- **`--out`.** Refused for every opened root and for symlinked directories resolving into one; written without following a final symlink. Truncation order is m3.
- **Rounding.** Exact `ceil`, lower bound `floor`; integers only, so no float edge; mutant `rounding-floor` red.
- **Foreign destination.** Counted from graph nodes carrying the flag (all objects of the destination, not only Services); text says what it means; JSON and closing line carry it.

## 4. Tests that cannot fail

| mutant | result |
|---|---|
| remove the `setRoot` duplicate assertion | survives (N1: neither the assertion nor the duplicate case is tested) |
| `droppedHooks += set.droppedHooks` removed; assembler field zeroed; `dropped:` line disabled | all survive (m1) |
| selector index always takes the first candidate list | survives; equivalent for results (the exact label filter after it decides), changes only speed |
| Secret gate always true; three-label host widened; two wave-as-edge variants; Secret data kept | all red (the four first-pass survivors now caught) |
| repo `read_from` flat label; alias-label `read_from` allowed; `--out` checks only the main root; `.json` ignored; foreign count zeroed; rounding floor; hooks dropped everywhere; guard returns 0 | all red |

## 5. Definition of Done (changes since the first pass)

| item | status |
|---|---|
| `npm run verify` green | met (27 files, 343 tests, 93.33% lines, check-tree 0) |
| fail closed on hostile input; a limit hit is a counted outcome, never a crash | **not met** (N2; N1 adds a repo-triggered false internal error) |
| repo-supplied config has no authority beyond its root | met for labels; N1 shows config can still choose between analysis and exit 1 |
| honesty rules in code: unverified items named, counted, `at least` | met (drops, JSON sources, foreign destination now counted and shown; m1 is test coverage only) |
| every other item from the first pass | unchanged: met |
| hard rules (identity, independence, no workspace paths) | met: three new commits by `naren-ambati` with the Opus trailer; check-tree 0 findings; README and BUILD-NOTES edits checked against the code |

## 6. What I checked and found sound

- Label spaces, display, cache key, and the config refusal in all spellings above.
- Chunked writer identity and determinism; JSON validity; one trailing newline.
- `--out` across scanned, alias and `repos:` roots, symlinked directories, final symlink, differing case.
- Foreign-destination count, text lines, `(nothing opaque, nothing skipped)` suppression.
- Hostile JSON: deep, huge, duplicate key, `__proto__`, comment-bearing.
- 228-case field fuzz of Application documents: no internal error, exit only 0 or 2.
- Expected-file edits equal the recorded edits; BUILD-NOTES describes the code accurately except n4 and the "a bug" wording of N1.

## 7. Verdict

**Ready to merge after fixes.** Fix N1 (a duplicate `repos:` directory must share a root, with a test) before merge; it is a small change and a regression from the first-pass fix. N2 is the first-pass M3 still open: either land the node bound now or record in BUILD-NOTES that the Definition-of-Done line is open and that the guard does not cover memory, and make sure B2 does it as step 0 before B2, B4 and B5 widen the inputs. Add the m1 test before B2 wires `dropTestHooks`.

## Repros (kept)

`review-b1-pass2/repros/` in the scratch area: `probes-pass2.sh` (N1 to N4 trees and commands), `mut.sh` (mutation harness; edit its `cd` line to the clone), `cmp-old-new.sh` (old versus new build diff). The scratch clones are removed.
