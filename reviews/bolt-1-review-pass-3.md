# Independent review, third pass: bolt B1 (thin slice)

- Bolt: B1; branch `bolt/b1`; commit reviewed `2c54c48` (second pass reviewed `ada4372`; fixes `ada4372..2c54c48`)
- Date: 2026-11-15
- Reviewer: Claude Sonnet 5.5, independent read-only review
- Scope: the pass-2 fixes and where they meet, above all the new per-run memory limits (they change what a result means).
- Method: read the fix diff (21 files, 895 insertions) and the review-pass-2 test file; built `2c54c48` in a scratch clone; ran the built CLI on four new hostile trees and the pass-2 tree; ran the pass-2 test file against `ada4372` (with only the two new source files copied in so it loads) to see which tests fail there; 14 source mutants (13 in the table below plus the share-root one) against the full suite (table in section 3). Repro generators: `review-b1-pass3/repros/` in the scratch area (listed at the end).

## 1. Were the pass-2 findings fixed?

| id | verdict | evidence |
|---|---|---|
| N1 (two `repos:` entries, one directory, internal error) | fixed | `sub`/`sub`, `sub`/`./sub/`, `sub`/`sub/.` give one shared root and an analysis; the three tests fail on `ada4372` (exit 1, internal-error line); mutant `share-root-off` is covered in section 3 |
| N2 (no run bound, heap abort) | fixed for the reviewer's tree, with findings M1, m1, m2, m3 below | the 1,500 x 3,000 tree: exit 0, 312 MB peak resident, `ANALYSED WITH GAPS`, 1,476 jobs `limit`; the five N2 tests fail on `ada4372` |
| m1 (hook display untested, wide match) | fixed | tests fail on `ada4372` for `tester` and `test-other`; the display mutants (line, count, assembler) are red |
| m2 (EPIPE stack) | fixed | `crankpath ... \| head -2`: exit 1 from the pipeline's crankpath side, stderr empty; test fails on `ada4372` after a build; removing the `EPIPE` branch goes red |
| m3 (`--out` truncated before the report exists) | fixed | the report is produced to chunks, then the file is opened; the test fails on `ada4372` |
| m4 (selector O(S x W)) | fixed for the speed; see m4 below for what it costs in wording | stops at two matches; candidates are the first two in id order (checked with four matches in two files: `aa`, `xx`) |
| n1 (`.json` wording), n3 (`at least 0%`), n4 (counts) | fixed, with n1 below | `not valid JSON or YAML`; `at least 0.8%` and `more than 0%` computed exactly (no float edge: checked every count under 3,000 files, 0 mismatches) |

Old-source check: copied `review-b1-pass2.test.ts` onto `ada4372`: 15 of 21 fail (the six that pass are the display tests that guard code which already existed, the same ones pass 2 named), so the new tests do fail on the broken code. The closed-pipe test needs `dist/` built; it reads the build, not the source (see n2).

## 2. Findings

Counts: **1 Major, 5 Minor, 3 Nit** (m5 also records that two mutants survive: the rates are unpinned, and the cycle tail and the nothing-opaque guard are untested).

### Major

| id | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|
| M1 | `status-model.ts` `deriveRunStatus` (`floor` omits `runLimitJobs`), `text-renderer.ts` `opacity` | When the run budget refuses a render job, the objects of that job are never seen, and so neither are the Applications, Kustomizations or HelmReleases it would have produced. The count of sources found and the opaque share are then lower bounds, but `floor` stays false: the 1,500 x 3,000 tree prints `Opacity: 1476 of 1500 sources opaque (99%)` and `found: 1500 Applications` as exact numbers; JSON has `"floor": false`. The run-limit line and the gap reason are present, but the share and the found count are the figures a reader keeps, and the opacity rule says the line is a floor (`at least`) when anything was not seen. Only the edge-drop case sets the floor. | CONFIRMED: `repros/gen.sh` tree `n2`, text and JSON. | Set `floor` when `runLimitJobs > 0` (a refused job hides sources, as an unreadable file does); then the text says `at least`, and JSON `floor` is true. Add a test that a refused job gives `at least` and `floor: true`. |

### Minor

| id | location | scenario | status | fix |
|---|---|---|---|---|
| m1 | `run-budget.ts` `charge` (sticky `stoppedAt`), `pipeline-runner.ts` job loop, `tree-walk.ts` order | Once any charge fails, every later charge fails, even a one-object job or a 700-byte file. Who is refused is decided by code-point order of file names and by queue order, which is canonical and the same on every machine (counts times constants only; no measured memory at run time), so results are deterministic. But a hostile repo chooses its own names: seven 8.5 MB files named `0big0..6` use the budget, and the honest `zz-honest.yaml` (one Application) is refused: `NOTHING ANALYSED`, exit 2. In the 1,500-Application tree the honest one-object Application `zzhonest` is `opaque ... reason: limit` because it sorts after the big ones. Counted and named, never silent, so not an honesty break; but a hostile file can make the whole analysis nothing, and nothing in `docs/limits.md` says that the order decides. | CONFIRMED (`t1`, `n2`) | Do not stick: refuse only the charge that does not fit, so later small items still enter; state in `docs/limits.md` that who is refused depends on name order; consider a per-owner share in B2. |
| m2 | `pipeline-runner.ts` `charged` and the `NOTHING ANALYSED` text path (`text-renderer.ts` near line 370) | A file refused only because the budget was spent reads `(too large)`: the detail `run budget` is in JSON but not in the text, and on the `NOTHING ANALYSED` path no `run limit:` line is printed and the reasons list is only `no-sources` (JSON counts do carry `runLimitFiles: 3`). A 700-byte honest file shown as `too large` misleads. | CONFIRMED (`t1`, text vs JSON) | Print the detail for a `run budget` refusal (`(run budget reached)`), and print the `run limit:` line on every path that has `runLimitFiles > 0`. |
| m3 | `pipeline-runner.ts` edge drop (`all.slice(0, maxEdges)` after `compareEdges`) and `text-renderer.ts` `cycles` | With the edge cap reached, the edges kept are the first by `from` id, so a hostile object named to sort early keeps its edges and honest later ones go; a dropped edge can be the one that closes a cycle. With a two-Application cycle and `maxEdges` 1 the text reads `Cycles: none found among 2 nodes and 1 edge read (0 nodes opaque; 2 unresolved items; 1 edge not kept over the run limit)`; the count is there, the run is `WITH GAPS`, `floor` true, so it is not a bare none, but a cycle that exists is reported as `none found`. The edge-count tail is not tested: removing the `not kept` tail from the line leaves all 364 tests green (mutant `no-cycle-tail`). Reaching it needs more than 346,542 edges (the cap), so it is far off for real estates. | CONFIRMED with an injected cap (`repros/cyc.mjs`) | When edges were dropped, print `Cycles: not determined (N edges not kept over the run limit)` instead of `none found`; add a test for the line. |
| m4 | `workload-refs.ts` selector stop | An ambiguous selector lists `candidates: Deployment "ns/d0", Deployment "ns/d1"` for five matching Deployments; nothing says there are more. A reader reads the list as the whole set; `extractor.ts` still documents candidates as `Every candidate`. A two-match selector and a five-match selector print the same. | CONFIRMED (tree `t3`) | Say `first 2 of more than 2` (or carry the fact in the unresolved item) and fix the doc comment. |
| m5 | `run-limits.ts` / `docs/limits.md` | Doc claims that are not backed: `docs/limits.md` says the budget never lets extraction allocate more edges than were paid for ("exact in the direction that matters"), but the leaf charge covers only string values; a body of numbers, booleans and keys is charged the flat 6,678 bytes per object (in B1 the file charge of 33 bytes per byte already covers it, in B2 a Helm render will not). Measured on one macOS machine (RSS), Linux not measured; the note says so. The 832,000,000 reserve is the B0 one-file peak (derived, and a file is parsed before it is charged, so the reserve is correctly placed); with the reserve set to 0 a test goes red, so it is guarded. | PLAUSIBLE (traced) | Say in the doc that B2 must charge rendered bytes, not only leaves, before enabling helm output. |

### Nit

| id | note |
|---|---|
| n1 | `at least more than 0%` is printed for one opaque source in 1,501 with `floor` true (`Opacity: at least 1 of 1501 ... (at least more than 0%)`); the phrase doubles the qualifier. Print `more than 0%` alone. Also `at least 0 of 2 sources opaque (at least 0%)` appears whenever the floor is set by something else and nothing is opaque: true, vacuous. |
| n2 | The closed-pipe test runs the built `dist/` copy, so under `npx vitest run` without a build it tests whatever is in `dist/` (stale or absent). `npm run verify` builds first, so the gate is sound; a lone `vitest run` is not. |
| n3 | `docs/limits.md` and the run-limit line cite `docs/limits.md` in tool output; the path is relative to the package and not present in a bare `npm` install unless `docs` is shipped (the `files` field lists `dist` only). Check what the package ships. |

## 3. Tests that cannot fail (mutants on `2c54c48`, full suite, 364 tests)

| mutant | result |
|---|---|
| leaf charge removed (`stringLeaves * perStringLeaf` -> 0) | 1 red |
| edge drop disabled | 1 red |
| `charged()` always passes the file | 3 red |
| `floor` without `runLimitEdges` | 1 red |
| discovered sources not charged | 1 red |
| `run limit:` text line disabled | 1 red |
| `EPIPE` branch removed | 1 red |
| reader reserve set to 0 | 1 red |
| `if (budget.stopped)` in the job loop disabled | survives; equivalent (the charge itself is sticky, so later jobs are refused by `objects()`); only the counter path differs |
| `not kept over the run limit` tail of the no-cycle line removed | survives (m3) |
| `(nothing opaque, nothing skipped)` guard ignoring the run-limit counts | survives: a run where only edges were dropped would print that line beside the `run limit:` line; untested |
| `perFileByte` 33 -> 16 (rate halved) | survives: no test pins the measured rates, only the doc does; a wrong rate changes every limit silently |
| selector stop at two removed | 1 red |
| shared `repos:` root removed | 3 red |

## 4. Definition of Done (changes since the second pass)

| item | status |
|---|---|
| a limit hit is a counted, named `limit` outcome, never a crash | met for the run budget: the reviewer's tree, a 50 MB file set and the order tests end counted and named; at a 2,500 MB heap cap (`--max-old-space-size=2500` and 2000) the six-file 57 MB tree passes, at 1,250 MB it aborts (the budget assumes the V8 old-generation size B0 looked up: physical / 4 x 2; the x 2 is from the V8 source in B0's lookups, Linux not measured) |
| nothing says complete or clean when something was unseen | partly: M1 (share and found count exact after refused jobs), m3 (`none found` after dropped edges, with the count beside it) |
| counts and the `run limit:` line always shown | partly: shown in JSON counts always and in the text when the run is analysed; missing from the text on the `NOTHING ANALYSED` path (m2) |
| results deterministic | met: charges are counts times constants, order is code-point order, edges sort by canonical key; two runs of the 1,500-tree give identical output |
| hard rules (independence, licence, workspace, identity) | met for the added files: no design-tool name, no personal path in `src`, `test`, `docs`, `scripts`; this file follows the same rule |

## 5. What I checked and found sound

- The derivation of the budget: 5 GB / 4 x 2 follows the V8 formula B0 recorded; baseline and reserve are measured values; the reserve sits where the parse happens (before the charge), and removing it fails a test; at heap caps of 2,500 MB and 2,000 MB the 57 MB six-file tree completes with the first five files held.
- Order: file walk is code-point sorted and tested by name; jobs follow the sorted source list; edges drop in `compareEdges` order; no wall-clock or machine value enters a charge.
- Shared root (N1), exact hook values, closed pipe, `--out` after the report, selector order and speed, the `0.8%` / `more than 0%` arithmetic (every count under 3,000 files; the float path never overstates).
- Memory of the reviewer's tree: 312 MB peak against the 342 MB the notes record.

## 6. Verdict

**Ready to merge after fixes.** M1 is a one-line change plus a test. m1 to m3 are about how a limit reads and who it hits; none hides that a limit fired.

## Repros

`review-b1-pass3/repros/gen.sh` (generators for the 1,500-Application tree with an honest last Application, the seven-big-files tree, the six-file heap tree) and `repros/cyc.mjs` (two-Application cycle with an injected edge cap). Scratch clones deleted at the end.
