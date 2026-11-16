# Review of bolt B8 (the GitHub Action), third and last pass

- Bolt: B8, the GitHub Action (U10, C10, US10.1 to US10.3)
- Branch: `bolt/b8`; commit reviewed: `de901ae` (main `ede1900` is an ancestor); reviewed as `git diff main..de901ae`, focus on the pass-2 fixes `6aad6f1..de901ae` (merges excluded)
- Previous passes: `reviews/bolt-8-review.md`, `reviews/bolt-8-review-pass-2.md`
- Date: 2026-11-16
- Reviewer: Claude Sonnet 5.5, independent read-only review
- Method: scratch clone of `de901ae`, `npm ci --ignore-scripts && npm run build`; 140 Action tests green; re-ran every pass-2 repro that still applies; new probes for the places the fixes meet (per-item gap keys, cycles-first order, the partial copy, links, the four bounds); 25 single-line mutations of the Action and its differ, tests re-run after each; the local harness run twice (second under another locale and time zone). Probes and mutation scripts: scratch folder `review-b8-pass3/repros/` (`s1` to `s10`, `mut3.py`, `mut3b.py`; they expect to sit next to a checkout of the branch, one level up).

## 1. Pass-2 findings: fixed?

| id | status on `de901ae` | evidence |
|---|---|---|
| m1 (same-count gap swap) | fixed for different subjects; see M1 below for the same-subject case | `p7.mjs`: hide plus fix an unrelated gap is `NOT_CHECKED`, "the head has 1 gap the base did not have" |
| m2 (declared-fact wording, FR10.5 listing) | fixed | `p10.mjs`: "the head relies on 1 declared fact the base did not (crankpath.yaml; documented by the PR author, not verified; listed below)"; `s8.mjs`: a declared two-edge cycle is `FAILED`, label `declared (unverified)`, both edges listed `[declared, not verified]`, warning annotation for the declared facts |
| m3 (link in an ancestor of path, config, alias) | fixed | `p3.mjs` (base side) and `p4.mjs` (head side config): `NOT_CHECKED`, "leads outside the copy (through a symbolic link)"; mutation of the link check turns 1 test red, of the realpath check on the scan directory 1 red |
| m4 (tests that cannot fail) | fixed | mutations: `.git` segment (1 red), `..` segment (1), head-before-base (the order test), copy chunk size, scan-directory check (1 red); `p14.mjs`: the `..` tree entry is `unsafe-tree`, nothing written above the copy |
| m5 (unbounded copy, wrong wording) | fixed, one residue (m2 below) | four bounds read from the build; each bound's mutation turns 1 to 4 tests red; an I/O failure is worded as one (`copy-io`) |
| n1 to n3 | unchanged, documented | |

## 2. Findings

Counts: Major 1, Minor 3, Nit 2.

### Major

| id | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|
| M1 | `action/base-head-differ.mjs` `newGapItems` (keys: unresolved by subject, why, where; opaque by node, root, reason) | The key leaves out `field`, `value` and `candidates`, so a SECOND item on the same object in the same document with the same reason is "equal" to the base's and is not new. Multi-source Applications are the ordinary case (`spec.sources[i].repoURL`, one `host-unplaced` item per source, same subject and same `where`). Probe `s6.mjs` case 1: base Application with one bare-host source (1 unresolved item for it); head adds a second source with another bare host. Result `NO_NEW_CYCLES_FOUND`, exit 0, `unresolved items 2 -> 3` printed in the summary's own lines, no "new in the head" line. Pass 2's count rule would have made this `NOT_CHECKED` (2 -> 3), so for this shape the per-item rule is weaker than the rule it replaced, and it breaks the lead decision "any head gap item absent from the base gives NOT_CHECKED": the item is absent, and is matched anyway. The control (same Application newly added) is `NOT_CHECKED` as expected. What it can hide: any unread source or reference added to an object that already carries a gap of the same reason (the dropped item loses its edges, so a cycle through it is not seen); I could not build a full hidden cycle on the shipped extractors (an unplaced source reads nothing, so the cycle needs a second route in), hence PLAUSIBLE for the cycle, CONFIRMED for the unflagged new gap and the green exit. The first line still says "Not a pass: the head has 1 opaque source", but that line is identical to the one printed for a head that only keeps the base's gaps. `docs/action.md` ("a head with more gaps than the base never gets this far") is false for this shape. | CONFIRMED for the gap and the exit (`repros/s6.mjs`); PLAUSIBLE for a hidden cycle | Compare per key as a multiset: a key is new when the head holds more items with it than the base does (keeps the key stable across line moves, catches the second item). Or add `field` to the unresolved and opaque keys (inserting a source at index 0 then shifts later indices: more NOT CHECKED, the safe direction). Fix the doc sentence. |

### Minor

| id | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|
| m1 | `test/u10-github-action/*` (tests that cannot fail) | Five mutations of the gap keys survive all 140 tests: unresolved key reduced to subject only, opaque key reduced to node only, match-override key to host only, repo-mapping key to url only, and the `status === "derived"` check dropped from `copyBounds`. So the part of the key that decides what counts as "the same item" is unpinned, which is how M1 went unnoticed. (Order is pinned: `NOT_CHECKED` before `FAILED` turns 5 tests red; `seen` removal 14 red; `key-skipped` 1 red.) | CONFIRMED (`repros/mut3.py`) | One differ test per key part: same subject with another `why`, another `where`, another `kustomizeRoot`, another `declared` text must each be new; a limit with status other than `derived` is not a bound (or drop the check). |
| m2 | `action/action-entry.mjs` `copyCommitTree` with `path: "."` (the default) | With the repository root as `path` the whole tree is copied and the whole-copy bounds apply to files crankpath never scans. An 11 MB `docs/demo.mp4` makes every run `NOT_CHECKED` ("the base commit is over a bound of the Action's copy: a file over fileBytes"); likewise any repository over 74,200,599 bytes of blobs in total. The CLI would count such a file as ignored or limit just that file. Fails closed and is worded, but the message names neither the file nor the way out (set `path` to the estate directory: probe `s10.mjs`, same repository with `path: e` is analysed). The docs say a monorepo is bounded by its estate only when `path` is set. | CONFIRMED (`repros/s10.mjs`) | Say in the message "set `path` to the directory crankpath should read"; better, skip blobs whose extension or size crankpath would not read when `path` is the root, or name the first offending path. |
| m3 | `newGapItems` keys by `where` (file and document index) and `subject` | A gap that moves is a new gap: renaming the file that holds a standing gap (`s7.mjs` T2), or inserting a document before it in a multi-document file (T3), ends `NOT_CHECKED` with the gap listed as new. Safe direction (never a hidden cycle; the reverse, a new gap matching a moved one, needs the same object, which is M1), but a refactoring pull request in a gapped estate can never be green, and the docs list only "a pull request that adds a source carrying its own gap". | CONFIRMED (`repros/s7.mjs`) | State it in the docs; optionally key by subject, why and field and compare the file only as evidence. |

### Nit

| id | note |
|---|---|
| n1 | `copyCommitTree` reads the whole `ls-tree` listing into memory and parses it before the entries bound is applied (as in pass 2, n3); the wall clock is checked after each chunk, not inside it. Both bounded by the git timeout and the hosting service. |
| n2 | An opaque item is keyed without its `field`: a second opaque reason of the same kind on an already opaque node is not new. The node is already opaque as a whole (`lostEdges` names everything it renders), so nothing more is lost; noted with M1 because the fix is the same multiset. |

## 3. Where the fixes meet: what I tried

- **Cycles before gaps.** A new uncranked cycle is `FAILED` whatever else is new (`s8`: declared two-edge cycle plus a declared-facts warning, still `FAILED`; mutation making NOT CHECKED outrank it turns 5 tests red). Making a real new cycle look old: cycle identity is (from, to, kind) of every edge, independent of file, label and source; a cycle is old only when every edge is in the base graph (ordering-only edges excluded) and its base component was not cranked. A moved file, a renamed file, a declared edge duplicating an extracted base edge, a base crank the head removes or re-keys: each ends new or `FAILED`, none old. I found no way to move a real cycle into a base-matched shape.
- **Declared facts.** A declared edge that closes a cycle is `FAILED` and listed with its label (`s8`); one that closes none is `NOT_CHECKED` in its own words (`p10`, `s7`), never worded as reading less; cranks, externals and match entries the head adds are listed as documented, not verified (unchanged, by design OD-27 b).
- **Partial copy.** Only the scanned subtree, a relative config and relative alias paths are copied. A scanned estate that points outside `path` (a Helm `valueFiles` entry `../../shared/vals.yaml`, a Kustomize base `../../base`, a chart dependency `file://../../shared/sub`, a `repos:` `read_from` outside the root, an own-repository `path:` outside the scan root): the CLI refuses each as "outside the scanned root" itself, so the result is identical to a run on a full checkout (`s3.mjs`: the full and the partial tree gave byte-equal counts, opaque and unresolved lists), and the outside reference is a named opaque item (`unsupported-field`, `render-failed`, `unreadable-file`) or a tool error (`i.mjs`, `repos:` with an outside `read_from`: `NOT_CHECKED` quoting the CLI). Honest, not silent. The own repository's root is the scan root, not the git top level (`s1.mjs`: with `path: e` an Application `path: platform/gitea` resolves under `e`; with `path: .` it is a named gap): the same as a CLI run, stated in the docs.
- **Subset edge cases.** `path` with spaces, glob characters and non-ASCII; a sibling directory `e2` and a file `e.yaml` next to `e`; a config inside `path`; aliases equal to or inside `path`; a config outside `path` (`s9.mjs`): all copied and analysed, no duplicate-entry stop, nothing from `e2` copied.
- **Links on the path.** A link in an ancestor of `path` on the base (`p3`) or of a relative `config` on the head (`p4`) is `NOT_CHECKED`; links inside the tree are recreated and refused by name by the CLI (`a2`: symlink as the hider is `NOT_CHECKED`).
- **The four bounds.** Each is read from the build (`filesPerScan` 279,235, `fetchedRepoBytes` 74,200,599, `fileBytes` 10,000,000, `repoFetchWallClock` 90,000); removing any pick, any comparison or the clock turns 1 to 4 tests red; the comparisons run before anything is written. Residue: m2, n1.
- **`.git` never copied.** Any `.git` segment in any case, an empty, `.` or `..` segment stops the copy as `unsafe-tree` (mutations red); the CLI is given `--repo-url`, so it reads no git configuration.
- **Determinism.** Two full harness runs (the second under `de_DE.UTF-8` and `Asia/Tokyo`): 286 lines each, byte-identical, no home path.
- **Hard rules.** 16 commits, all `naren-ambati <32987080+naren-ambati@users.noreply.github.com>` with the Opus 5.5 trailer; no added line names the design tool, its folders or a personal path; no path of the design workspace, the local settings folder or the start file in the diff; `NOTICE`, `LICENSE` and `package.json` untouched.

## 4. Tests that cannot fail

25 mutations, one at a time, reverted. Red: `.git` segment, `..` segment, entries bound, total bytes bound, largest blob bound (4), wall clock, each of the four `pick` lines (1 to 2), the link check, subset-all (3), subset-path-only (1), cycles-first order (5), `seen` removal (14), key by file only for skipped items, run-limit edges, scan-directory realpath check. Survivors, all in m1: unresolved key, opaque key, match-override key, repo-mapping key, `derived` check. The earlier `if (true)` variant of the order mutation also survives, but it changes only the list of reasons beside a `FAILED`, not the result, so it is equivalent.

## 5. Definition of done (the lead's decisions for this pass)

| decision | state |
|---|---|
| Per-item gap matching; any head gap item absent from the base gives NOT_CHECKED | partly: items are matched one by one, but the key is too coarse (M1); a second item on the same object is matched |
| A new uncranked cycle is FAILED before gap checks | met (`s8`, mutation) |
| Declared facts worded as their own reason, listed | met (`p10`, `s8`) |
| Copy only the scanned subtree, the config and relative alias paths | met; outside references are honest named gaps or tool errors (`s3`, `i`) |
| Four build limits bound the copy | met; default `path: .` over-refuses (m2) |
| Merge base as base | met (unchanged from pass 2) |
| `.git` never copied; determinism; links on the path | met |

## 6. Verdict

Ready to merge after fixes. The one Major is a narrow, confirmed weakening of the per-item rule (a second gap item on an object that already has one of the same reason is not new, job green); the fix is one comparison (multiset or `field` in the key) plus one doc sentence and the missing key tests. Nothing else I tried hides a cycle.

*Note added by the builder on commit: one phrase in section 3 ("Hard rules") named the design workspace's folder, the local settings folder and the start file by their literal names, which the repository's tree check refuses in a tracked file; it is reworded to name them by role. Nothing else is changed.*
