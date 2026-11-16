# Independent review: bolt B1 (thin slice)

- Bolt: B1 (U1 GraphModel/StatusModel, U2 ConfigReader/RepoIdentity, U3 discovery and plain sources, U4 RenderedSetBuilder, U5 ArgoExtractor core, U6 WorkloadRefExtractor/HostMatcher, U7 GraphBuilder/CycleFinder, U8 assembly/JSON/text, U9 CLI and exit codes)
- Branch: `bolt/b1`, commit reviewed `9ac9590`, diff `5e01fd2..9ac9590` (B0 reviewed separately; B0 modules are reviewed here only for how B1 uses them)
- Date: 2026-11-15
- Reviewer: Claude Sonnet 5.5, independent read-only review
- Method: read the whole diff (5,547 lines of source, 67 files); `npm run verify` re-run in a scratch clone (green: 26 files, 326 tests, check-tree 0 findings); about 75 source-code mutations in the scratch clone; hostile-input runs of the built CLI. Repros: `reviews`-adjacent scratch folder `repros/` (listed at the end).

## 1. Findings

Counts: **3 Major, 12 Minor, 5 Nit**.

### Major

| id | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|
| M1 | `src/u9-cli-package/pipeline-runner.ts:119` and `:135` (`roots.set(label, ...)` for `--repo-alias`, then `roots.set(m.readFrom, ...)` for `repos:`) | The root map is keyed by one flat label namespace. `--repo-alias` roots are labelled `alias:N`; a `repos:` mapping's root is labelled by its `read_from` path. The scanned repo supplies `crankpath.yaml`, so it can create a directory named `alias:1`, map any URL to `read_from: "alias:1"`, and the later `roots.set` silently replaces the user's own `--repo-alias` root. Everything the user mapped with `--repo-alias` is then read from the repo-supplied directory. Output shows only a path starting `alias:1/`, which looks like the user's alias. Repo-supplied config has overridden a command-line choice (the brief's "repo-supplied crankpath.yaml authority" class). | CONFIRMED: `repros/probes.sh` section M1. Without `crankpath.yaml` the node is `ConfigMap/x/from-user-dir`; with the repo's `crankpath.yaml` it is `ConfigMap/x/from-repo-dir`, evidence path `alias:1/p/forged.yaml`. No test covers it. | Give the two spaces disjoint labels (a `repos:` root labelled `repos:<path>`, never able to equal `alias:N`), or refuse a `repos:` `read_from` that collides with a label, and assert in the pipeline that `roots.set` never overwrites an existing key. Add a test. |
| M2 | `src/u4-render-engine/rendered-set-builder.ts:172-174` (`isTestHook` then `droppedHooks += 1`); `droppedHooks` is never read outside `plain-renderer.ts`/`render-job.ts` | An object annotated `helm.sh/hook: test` (annotation controlled by the scanned repo) is erased from the graph. BR4.6 says "dropped and counted", but the count stops at `RenderedSet.droppedHooks`: the pipeline discards it, so neither the text report nor the JSON says anything was dropped. For a plain directory there is no Helm render at all, so a hostile or careless manifest can remove a Deployment (and every `needs-secret`, `needs-config`, `selects` edge through it) from the analysis with no trace. This is a check trusting a field the checked party controls, and a wrong analysis result that reads as a normal run. | CONFIRMED: `repros/probes.sh` section M2. A Deployment with that annotation is absent from `nodes` (0 matches) and the text never mentions hooks. On the thin-slice fixture the same edit turns the cycle from 5 nodes and 8 edges into 2 nodes and 2 edges, with nothing else changed in the output. | Carry `droppedHooks` into the Report (a counted line in the opacity or closing section and a count in JSON) and make it a gap reason; for a plain-directory render do not drop at all, since a plain directory has no hooks (decide per source kind in the builder options). Add a test that the drop is visible in text and JSON. |
| M3 | `src/u9-cli-package/pipeline-runner.ts` (no object, edge or file-count bound; the worklist re-renders one directory per Application), `src/u8-output/json-renderer.ts:121` (`JSON.stringify` of the whole report), `src/u9-cli-package/cli.ts` (no top-level catch) | A 1.7 MB hostile tree (400 Applications with different destination namespaces, all pointing at one directory of 2,000 ConfigMaps) yields 800,400 nodes and 800,000 edges. The text format finishes in about 10 s. `--format json` throws an uncaught `RangeError: Invalid string length` after about 30 s, prints a Node stack trace, and exits 1, which the CLI contract reserves for usage errors. The rule is "a limit hit is a counted, named `limit` outcome, never a crash". The builder lists `filesPerScan` as not derived, but the crash is a missing bound on objects and output, and there is no isolation around assembly or rendering. | CONFIRMED: `repros/probes.sh` section M3 (exit 1, `RangeError`, real 29.6 s). | Derive and enforce a per-scan object bound and a per-job object bound (a counted `limit` opaque mark on the owner, as the plain renderer already does for file limits), and catch errors at `main` so a bug exits with a fixed, non-1 code and a one-line fixed message. B3's `filesPerScan` step 0 does not cover the object and output bound. |

### Minor

| id | location | scenario | status | fix |
|---|---|---|---|---|
| m1 | `src/u3-discovery-expansion/source-discovery.ts:98` (`isYamlFile`) versus `src/u4-render-engine/plain-renderer.ts` (`MANIFEST` reads `.json`) | An Application written as `apps/a.json` is never discovered; it is counted as an ignored file. The plain renderer does read `.json`, so the same Application inside a rendered directory is found (inconsistent), and at the top level a repo of JSON Applications reads `0 Applications ... 1 file ignored`, exit 2. A mixed repo gets `Opacity: 0 of N (nothing opaque, nothing skipped)` with unseen sources and no `at least`. | CONFIRMED (`probes.sh`, JSON section). | Classify `.json` the same way in discovery and the renderer, or make non-YAML manifest-looking files a counted floor. |
| m2 | `src/u9-cli-package/cli-shell.ts:75-92` (`writeOut`) | `--out` is refused only inside the main scanned root. A path inside a `--repo-alias` tree or a `repos: read_from` root (also scanned) is written (exit 0, file created). The stated rule is that crankpath never writes into scanned trees. | CONFIRMED (`probes.sh`, `--out` section). | Compare against every opened root (`roots` values), not only `rootReal`. |
| m3 | `src/u6-extractors-workload/workload-refs.ts:165-168` | `selects` filters every workload for every Service: O(S x W). 15,000 Services and 15,000 Deployments in one 3.9 MB file took 10.3 s. Together with M3 and the missing file-count limit, a hostile tree can hold the tool for a long time. | CONFIRMED (timed). | Index workloads by (namespace, bucket) and by label pair. |
| m4 | `src/u9-cli-package/pipeline-runner.ts:267` (Services of a foreign destination not offered to HostMatcher); text renderer has no word for `foreign-destination` | A Service rendered for a foreign destination is dropped from host matching. The only trace is a `flags` entry in JSON. The text reads `(nothing opaque, nothing skipped)` and `Cycles: none found among 2 nodes and 1 edge read (0 nodes opaque; ...)`. BR5.4 allows dropping the match; it does not allow silence in the text. | CONFIRMED (`probes.sh`, foreign section). | Count flagged nodes and print the count in the opacity statement or closing line. |
| m5 | `src/u8-output/text-renderer.ts:167` | `Math.floor` on the opacity percentage rounds in the optimistic direction: 1 of 1000 prints `(0%)`, 2 of 3 prints `(66%)`. | PLAUSIBLE (arithmetic). | Round up for the opaque share (or print one decimal, or print `less than 1%` only when the count is 0). |
| m6 | `src/u8-output/text-renderer.ts` `nothingAnalysed` (the `path:` line) | The exit-2 text prints the scanned path as typed. With an absolute path the text holds the machine path, so text output is not identical across checkout locations (JSON is). Quoted and escaped, so not an injection; it breaks "no absolute paths in any output". | CONFIRMED (the M4 run shows the home-directory path when invoked with an absolute path). | Print only a fixed label and the basename or nothing; the test at `cli.test.ts:53` pins the relative form only. |
| m7 | `src/u3-discovery-expansion/source-discovery.ts:99,113` and the opacity text `N files ignored` | `ignoredFiles` counts every file holding no source document, including the manifests the plain renderer reads: the thin-slice report says `5 files ignored` while four of the five are rendered. A reader takes "ignored" as "not read". | CONFIRMED (`expected.txt`: README plus four manifests). | Say `N files hold no source document` (fixed words), or subtract files a render read. |
| m8 | Test gap: `rendered-set-builder.ts:118` (the `Object.hasOwn(labels, ARGO_SECRET_TYPE_LABEL)` gate) | Replacing the gate with `true` leaves all 326 tests green, so no test shows that a Secret without the Argo label drops its `url` key. The retained `credentialUrl` is not printed in B1, so there is no live leak yet, but B4 will print it. | CONFIRMED (mutation survives). | Add a negative test: unlabelled Secret with `stringData.url` gives `credentialUrl: null`. |
| m9 | Test gap, sync waves (`argo-extractor.ts`, `test/u5-extractors-gitops/argo-extractor.test.ts:79-95`, `expected.json` one wave object `-1`) | Two mutations that turn waves into hard edges both survive all 326 tests: (a) a `depends-on` edge from each higher wave to the next lower wave (the test has exactly one valid-wave object, so no pair exists); (b) an edge from any positive wave object to every unannotated object (the fixture's only wave is `-1`). Only the extractor unit asserts `edges: []`, and only with one wave. BR5.3 is therefore guarded for the single-object case only. | CONFIRMED (mutations `wave-hard-edges`, `wave-default0-edges`). | A test with waves `-2`, `0`, `5` across several objects and a graph-level assertion that no edge has a wave as its reason, and that a cycle is not created by waves. |
| m10 | Test gap, HostMatcher (`host-matcher.ts` three-label branch) | Widening `parts.length === 3 && parts[2] === "svc"` to `parts.length === 3` leaves the suite green. A look-alike host such as `git.example.org` would then match Service `git` in namespace `example`. No test has a three-label external host. | CONFIRMED (mutation `host-ns-forms`). | Add `gitea-http.gitea.example.org` and `git.example.org` as no-match cases. |
| m11 | Test gap, vacuous end-to-end check (`test/u9-cli-package/thin-slice.test.ts`, "never prints a Secret value") | The reports never contain object bodies, so this test passes whether or not Secret data is stripped. Removing the `data`/`stringData` strip fails only the two unit tests in `rendered-set-builder.test.ts`. The protection is real, but the e2e test names a guarantee it does not exercise. | CONFIRMED (mutation `secret-keep-data`: only unit tests go red). | Either rename it ("reports hold no bodies") or assert on `RenderedObject.body` after the pipeline. |
| m12 | `src/u1-graph-model/graph-model.ts` (`CLUSTER_SCOPED_KINDS` fixed list; names must be DNS-1123 subdomains) | A cluster-scoped CRD kind not in the list, or an RBAC object named `system:...`, is skipped (`no-namespace` / `invalid-name`) rather than modelled. Counted and named, so honest, but real estates will carry many such skips, each a run gap. Deviation 9 is disclosed. | PLAUSIBLE. | Decide in B2 or B5 whether skipped cluster-scoped kinds should be nodes; at least list the kinds in the closing line. |

### Nit

| id | location | note |
|---|---|---|
| n1 | `repo-identity.ts` | `http://host:3000/p` and `ssh://git@host:3000/p` normalise equal (the scheme is dropped by design, FR2.3), and `https://example.org//a` equals `https://example.org/a` (leading slashes stripped). Scheme-less `host:3000/ops/x` is read as scp-style host `host`, path `3000/ops/x`. Conservative direction, but worth a line in the design record. |
| n2 | `pipeline-runner.ts` read cache key `` `${label}\n${rel}` `` | A directory name containing a newline can alias two cache keys (label `a\nb` + `c` versus label `a` + `b\nc`). Corner case; use a length-prefixed or tuple key. |
| n3 | `graph-model.ts` ids carry the kind but not the API group | A Knative `Service` and a core `Service` of one name in one namespace merge into one node. It is surfaced as `conflicting-definitions` (not silent), but two nodes would be truer. |
| n4 | README line added in B1 | It calls the JSON output and `schemaVersion` "the stable contract", while BUILD-NOTES deviation 4 says several C1/C7 shapes were chosen in B1 and are frozen only in B6. Soften until B6. |
| n5 | Deviation 20 | Tests were written alongside the implementation, not before it, against the brief's order (only the fixture and expected outputs came first). Disclosed; the expected files were then edited by hand after the first real run (recorded, with reasons, in `bae579e` and BUILD-NOTES). I checked the diff `a6ae7d1..bae579e`: it matches the recorded edits and nothing else. |

Inherited, not B1 (for the lead): the tree at `9ac9590` tracks 733 design-workspace files (the design workspace folders, the local settings folder and the design tool's start file) and a `CLAUDE.md` naming a personal path. They enter from `main`, not from this diff; B1 adds or edits none of them. They must not ship (hard rule).

## 2. Tests that cannot fail

I mutated the source in a scratch copy, rebuilt, and ran the whole suite for each. "Red" means at least one test failed.

| mutation (what I broke) | result |
|---|---|
| id syntax: name check accepts any string | red (14 tests; unit, builder, workload refs, e2e) |
| id syntax: namespace check, kind check accepts any string | red, but only the `graph-model` unit test (1 each); no pipeline test forges through a namespace or a kind |
| run status BR1.10: `not-computed`, `skipped-objects`, `opaque-sources`, `no-dependency-edges`, `unresolved-items`, `unreadable-files`, `timeouts` each no longer a gap reason; no-sources no longer NOTHING ANALYSED; state always ANALYSED | all red; the `unresolved-items`, `unreadable-files` and `timeouts` mutants are caught only by `status-model.test.ts`, the others also by pipeline and e2e tests |
| floor: always false; without `unreadableFiles`; without `skippedSources`; without opaque ApplicationSets | red (2 to 5 tests each) |
| "at least" wording removed from the opacity line | red (`text-renderer.test.ts`, 2) |
| Secret `data`/`stringData` kept; last-applied annotation kept; strip call skipped; credential `url` unredacted | red, only the unit tests in `rendered-set-builder.test.ts` (1-2 each) |
| Secret Argo-label gate replaced by `true` | **survives** (m8) |
| URL normalisation: path lower-cased; prefix equality (`startsWith`); reverse prefix; host substring; userinfo kept; `.git` not stripped; default port kept; all ports dropped; dot segments allowed; query allowed; control characters allowed; any scheme allowed; scp host not lower-cased | all red |
| host lower-case removed for `https`/`ssh` | survives, equivalent mutant (the WHATWG parser already lower-cases; the scp branch is covered) |
| precedence: `--repo-alias` ignored; suggestion applied as a mapping | red (3, 4) |
| HostMatcher: bare host resolves to first match; bare host never ambiguous; five-label form widened; ambiguity resolved to first | red (1-2 each) |
| HostMatcher: three-label form widened | **survives** (m10) |
| HostMatcher: IPv4 guard removed | survives, equivalent (a four-label host is already no match) |
| sync waves become hard edges (two variants) | **survive** (m9) |
| cycle labels swapped; declared labelled extracted; declared counted when finding extracted cycles; ordering-only edges counted; self-loops dropped; representative longest not shortest; id not from the sorted node set; cycle edge set cut to the representative | all red |
| SafeText: quote not escaped; backslash not escaped; control characters shown raw; invisible characters shown raw; no length cut | all red |
| exit codes: unknown flag gives 0; nothing analysed gives 0; invalid config gives 0 | all red (`cli.test.ts`, 2 to 3 tests each) |
| `--out` inside the tree allowed; `--out` follows a symlink (`O_NOFOLLOW` removed) | red (3 tests; 1 test) |
| `repos:` `read_from`: traversal allowed; environment variable allowed; symlink directory allowed | red (4, 3, 2 tests) |
| tree walk follows symlinks | red (3 tests) |

Note: the `--out`, `read_from`, tree-walk and unknown-flag mutants were re-run one at a time after my first batch was contaminated (the `--out`-inside-the-tree mutant leaves a file in the fixture tree, which turns later runs red for the wrong reason); the results in the table are the clean re-runs. The reviewed tree is unchanged (`git status` clean apart from my `repros/`).

Other vacuous or weak items found by reading: the e2e "never prints a Secret value" test (m11); `cli.test.ts` pins the exit-2 text with a relative path only (m6).

## 3. Definition of Done (bolt plan B1 and the bolt brief), item by item

| item | status | evidence |
|---|---|---|
| `npm run verify` green on the thin-slice fixture | met | re-run: typecheck, lint (71 files), build, 26 files / 326 tests, coverage lines 94.81% (above 80), check-tree 0 findings |
| byte-for-byte expected-output test, committed expected files, one uncranked `extracted` cycle | met | `thin-slice.test.ts` and `cli-e2e.test.ts` (built binary) compare `expected.txt` and `expected.json`; fixture and expected files committed in `a6ae7d1` before the implementation; edits after the first run recorded |
| opacity statement, run status, closing line present; statuses and plan stated as not computed | met | `expected.txt`; "not computed in this build" is a gap, so no B1 run can say ANALYSED (mutations red) |
| no-cycle result uses the M9 wording, never a bare `none` | met | `text-renderer.ts` `cycles()`; matches M9 and BR8.13 |
| hostile names quoted, control characters visible, nothing from the repo starts a line | met | fixture holds an ANSI name, a `x/../../Service/...` name and a hostile `spec.source.path`; line-start test can fail |
| plain mutation test (remove the Service or change the host) changes the output | met | two mutation tests in `thin-slice.test.ts` |
| determinism: twice, other working directory, other absolute checkout location, JSON identical | met for JSON; partly for text | JSON identical (no path in it); the exit-2 text prints the typed path (m6) |
| exit codes 0 / 1 / 2 as specified | met | `cli.test.ts`; mutations red |
| hostile input: forged id skipped and named | met | `objectId` regexes; also checked by hand: `\n`, `/`, `:`, `..`, ANSI, uppercase all refused |
| CycleFinder: 100,000 chain and ring, self-loops, SCC with several cycles, labels, stable ids | met | `cycle-finder.test.ts`; 8 label and finder mutations red |
| repo identity cases (look-alike host, prefix, case, userinfo, `.git`, slash, ssh/scp, suggestion not applied, `repos:` outside root or env refused) | met | `repo-identity.test.ts`, 13 URL mutations red; I also normalised 35 hostile spellings by hand (userinfo host tricks, `#@`, `:3000.evil.com`, backslash, percent-encoded dots) with no wrong equality |
| end-to-end test of the built binary | met | `cli-e2e.test.ts`, fails when `dist` is older than `src` |
| extension points written; render, extractor and analysis dispatch in one place each; report model complete | met, with caveats | `renderers.ts`, `*/index.ts`, `analysis.ts`, `report-model.ts` exist; caveats in section 5 |
| `bin`, `library.ts`, coverage list grown | met | `package.json`, `library.ts`, `vitest.config.ts` |
| honesty rules in code: unverified items named, counted, `at least` | partly | M2 (dropped hooks uncounted), m1 (JSON-format sources), m4 (foreign destination silent) |
| fail closed on hostile input; a limit hit is a counted outcome, never a crash | **not met** | M3 (crash, no object bound); the file-level limits behave (alias bomb, depth, FIFO, symlink, 5 MB annotation all counted) |
| repo-supplied config has no authority beyond its root | **not met** | M1 |

## 4. The 20 recorded deviations: is any an honesty or contract break?

None is an honesty break by itself; two are contract changes the lead should accept explicitly.

- Honesty-neutral or honesty-safe: 3 (not computed is a gap, `null` not `[]`), 11 (a bare host is an ambiguity), 12 (`optional: true` makes no edge), 13, 14, 15 (undefined references listed, gaps), 16, 17 (flags that would run silently without their stage exit 1), 18.
- Contract changes (disclosed, B6 freeze pending): 1 (a 15th opacity reason `not-in-this-build` joins the closed list of C1; every later bolt edits that shared constant, and nobody owns its removal), 2 (sync waves as a node attribute, not `orderingOnly` edges: BR5.3 holds, but B5's PlanBuilder must rebuild ordering from `syncWave` plus `origin.renderJob`, and `GraphNode.origin` keeps only the first origin of merged duplicates, so a duplicate rendered by two jobs loses the second job's wave scope), 4 and 5 (JSON shapes and byte layout chosen in B1; see n4), 6 (extractor interface additions), 7.
- Process: 20 (tests after code; n5).
- 8 (a Kustomize root that is also an Application path counts as two sources) inflates the opacity denominator and the opaque count together; with only Kustomize sources it is neutral, otherwise the percentage moves toward 100%. Minor, and B2 decides it.
- 9 is honest but noisy (m12).

## 5. What I checked and found sound

- Id integrity: `objectId` and `externalId` are the only id constructors; every id regex is anchored and JavaScript `$` does not accept a trailing newline; `external:` ids cannot collide with object ids; config-supplied ids pass `isNodeId`.
- Run status: derived from counts only; every gap reason mutation is red; `NOTHING ANALYSED` with zero sources; B1 cannot print ANALYSED because "not computed" is a gap. The text can read as clean in only one place, the `(nothing opaque, nothing skipped)` line, and it sits under a `gaps:` line in every B1 run.
- Secret handling: `data`, `stringData`, and the last-applied annotation are removed at build time; only the labelled credential `url` survives, with userinfo removed. No report holds an object body.
- URL identity: exact equality on the normal form; `repoURL` look-alikes (`evil.com#@host`, `host:3000.evil.com`, userinfo tricks, backslashes, dot segments in plain and percent-encoded form, query, fragment) are refused or differ; path case is significant; the suggestion is data and never applied.
- Repo-supplied `crankpath.yaml`: `read_from` outside the root, absolute paths, `..`, `$VAR`, `${VAR}`, `%VAR%`, `~`, symlink directories are all refused with the key path quoted; unknown keys, duplicate keys, wrong types are refused; `__proto__` as an external name is refused; keys are stored through `defineProperty`.
- Hostile files: alias bomb, 50,000-deep nesting, a FIFO, a symlink to `/etc/passwd`, a 5 MB annotation, a control-character object name: each counted and named, no crash.
- Output escaping: terminal text is quoted after fixed labels; control, format, separator and private-use characters become visible codes; a line never starts with repo text (the fixture and `OWN` word test); JSON strings pass the same escaping; the quote cut is derived (381 characters, the longest valid id), so no valid id is cut.
- Determinism: all sorted collections use code-point order; JSON holds no path, timestamp or machine name; two runs, another working directory and another absolute location give identical JSON.
- CycleFinder: iterative Tarjan, shortest representative from the smallest id, stable ids from the sorted node set, label rules; mutations red.
- `--out`: refused inside the main root, written with `O_NOFOLLOW` after resolving the directory (a symlink target is refused); `--config` resolves against the invoker's directory.
- Hard rules: commit identity on all nine commits (`naren-ambati`, noreply address, `Co-Authored-By: Claude Opus 5.5`); no design-workspace path, name or stage word, no personal path or machine name, in anything B1 adds or edits (grep of the diff); Apache-2.0 unchanged; no new dependency; no network in the tests; the pipeline never runs a subprocess.

## 6. Extension points for B2, B4 and B5 in parallel

Workable. Each later bolt mostly lands in its own folder, and the registries are single points (`RENDERERS`, `GITOPS_EXTRACTORS`, `WORKLOAD_EXTRACTORS`, `analyse`). Predictable textual overlaps the lead should plan the merge order for (B2, B4, B5 as already decided):

- `src/u9-cli-package/pipeline-runner.ts`: B2 (CommandRunner in `RenderIo`, `timedOut`, toolchain), B5 (the HostMatcher built from `config.matches`) both edit the composition root, in different regions.
- `src/u3-discovery-expansion/render-planner.ts`: B2 replaces the `chart`, `helm`, `kustomize` and `Chart.yaml` returns inside `planApplication`; B4 or B3 replace the `Kustomization`, `HelmRelease` and `ApplicationSet` cases in `planSource`. Same file, different functions.
- `src/u8-output/text-renderer.ts` and `report-assembler.ts`: B2 (toolchain: `toolchainLine()` takes no argument and the assembler hard-codes `helm: null`), B5 (statuses, plan). Different functions.
- Shared constants edited by several bolts: `OPAQUE_REASONS` (removal of `not-in-this-build` has no owner), `PRINTABLE_KINDS` (B4), `NOT_VERIFIED_ITEMS` and the `NotVerifiedItem` switch in `text-renderer.ts` (B2 and B5 add items).
- Not an extension problem but a B5 dependency: ordering edges must be rebuilt from node attributes (deviation 2).

## 7. Verdict

**Ready to merge after fixes.** The pipeline shape, the id discipline, the status derivation, the cycle finder and the output vocabulary are sound and well tested; I found no way to make a B1 text report read as a clean result. Fix M1 (disjoint root labels), M2 (surface or stop dropping hook-annotated objects), and M3 (object bound plus a top-level catch) before B2, B4 and B5 branch from it, add the tests named in m8 to m11, and re-run `npm run verify`.

## Repros (kept)

`_scratch-crankpath/review-b1/repros/`: `probes.sh` (M1, M2, M3, m1, m2, m4; run as `probes.sh <built checkout> <empty dir>`), `mut.sh` (the mutation harness), `batch2.sh`, `batch3.sh`, `batch4.sh` and their `.out` files (the mutation lists and raw results). Everything else in the scratch copy is removed.


_Edited by the B1 builder on 2026-11-15 when committing this file: two phrases (a home-directory path and the design workspace's folder and start-file names) replaced by neutral words so the file passes check-tree; on merging main, the local settings folder's name likewise, for B0's newer check-tree rule. No finding was changed._
