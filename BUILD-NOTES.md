# crankpath build notes

Working log for crankpath v0.1: what each bolt built, what was verified (command and output), where the build departs from the design and why, and what stays unverified. The design (requirements, rules, contracts, open decisions OD-1 to OD-30, all recommendations accepted) is kept outside the repository; the decisions it rests on are `docs/design/decisions.md`, `docs/design/vision.md` and `docs/design/tech-env.md`.

## B0 (day-1 census, limits and the scaffold)

*Lines marked "Superseded" below were overtaken by the review fixes that follow; the later sections are the current state.*

### Built
- **Package scaffold (U9 scaffold only).** `package.json` (crankpath 0.1.0, Apache-2.0, not private, no `bin` yet), exact-pinned `commander` 15.1.0 and `yaml` 2.9.1, dev tools pinned as the sibling project pins them; `package-lock.json` from `npm install --ignore-scripts`; `.npmrc` `ignore-scripts=true`; strict NodeNext `tsconfig.json` over `src`, `test`, `scripts` and `vitest.config.ts` (the `.mjs` scripts are type-checked through `checkJs`); `tsconfig.build.json` (`src` to `dist`); `biome.json`; `vitest.config.ts` with `test/setup/no-network.ts` (any non-loopback socket throws) and an 80% line floor over `src/u1-graph-model` and `src/u2-intake-config`; `npm run verify` version 0 = typecheck, Biome, vitest with coverage, build, `node scripts/check-tree.mjs`. `LICENSE` is byte-identical to the sibling project's Apache-2.0 text (`cmp`); `NOTICE` says no third-party files yet; `.gitignore` holds the project lines only.
- **check-tree** (`scripts/check-tree.mjs`, importable `checkTree`): reads tracked and untracked-not-ignored files except the design workspace folders and start file; fails on a home path, the design tool's name or folder name, its start file name, and this machine's hostname read at run time.
- **Plain-words design copies** `docs/design/decisions.md` (D9 now Apache-2.0), `vision.md`, `tech-env.md`; `CLAUDE.md` and `README.md` updated as the bolt asked.
- **SafeText v1** (`src/u1-graph-model/safe-text.ts`): `quote(label, raw, "terminal" | "mermaid")`, `jsonText(raw)`, `redactUrl`, `quoteUrl`; fixed label first, quote and backslash escaped, C0, DEL, C1, format (bidi, zero-width, tags), separators, non-ASCII spaces, private use and lone surrogates shown as `\xNN`, `\uNNNN` or `\u{N}`; cut on a code-point boundary after 381 characters with `... (cut at N of M characters)`; Mermaid output is one quoted label with every syntax character as `#<decimal>;`; userinfo removed from every URL, `unparseable URL` for anything else (including a URL holding a control or space character, which the WHATWG parser would silently drop).
- **The LimitSet type** (`src/u1-graph-model/limits.ts`): each limit is `derived` (value, unit, what it protects, basis, date) or `notYetDerived` (unit, protects, the bolt step, why) with no `value`, so code cannot use it as a number (a `@ts-expect-error` test holds this under the typecheck).
- **BoundedReader v1** (`src/u2-intake-config/bounded-reader.ts`): `openRoot`, `canonicalPath`, `readText`, `readYaml`, `parseYamlBounded`. Confinement by an lstat walk of every component, `O_NOFOLLOW | O_NONBLOCK`, fstat identity check and a final realpath equality check; size from lstat, fstat and a bounded read; documents, depth and document node count checked while lexing and parsing, before composing; its own iterative converter resolves aliases in one pass (shared, never copied), counts the expanded size, refuses cycles, duplicate keys and collection keys, and never changes a prototype. Outcomes: `ok`, or `symlink`, `traversal`, `not-found`, `not-regular-file`, `io-error`, `too-large`, `too-deep`, `too-many-documents`, `alias-limit`, `parse-error`, each with crankpath's fixed wording and a fixed detail word, never the parser's message.
- **Limit derivations** (`docs/limits.md`, `docs/lookups.md`): nine limits derived from dated lookups; five named as not yet derived; need measured on the census estates (`node scripts/census.mjs --need`) and cost measured at the limits (`scripts/measure-limits.mjs`). *(Superseded: after both reviews eight limits are derived and seven not yet derived; see the B0 second review fixes.)*
- **The census** (U11 CensusRunner, dev-only): `docs/census.md` (the OD-26 estates and the classifier's rules, committed before the first count in `af5985f`, amended once still before it in `0119daf`, results after), `scripts/census-lib.mjs` (pure classifier), `scripts/census.mjs` (fixed-form shallow git fetches into a cache outside the repository, reads only through the built BoundedReader), `docs/census-2026-11-15-static.json`.

### Verified
- `npm run verify` on 2026-11-15 (Node v22.23.2, macOS arm64), exit 0:
  ```
  Checked 17 files in 20ms. No fixes applied.
   Test Files  6 passed (6)
        Tests  140 passed (140)
  Statements   : 92.43% ( 403/436 )
  Branches     : 86.36% ( 285/330 )
  Functions    : 100% ( 36/36 )
  Lines        : 95.75% ( 338/353 )
  check-tree: 36 files read, 0 finding(s)
  ```
- `cmp LICENSE <sibling>/LICENSE`: identical.
- Adversarial reader tests: a billion-laughs bomb (alias-limit, under 2 s), 10,000- and 10,001-deep nesting (too-deep, from the parser's stack and from the pre-scan), a file one byte over a limit and the 10,000,001-byte file (too-large), symlinks to outside and to inside the root, a symlinked directory, a symlink loop, `../` and absolute paths, a FIFO and a directory where a file is expected (not-regular-file, without blocking), invalid UTF-8, malformed and truncated YAML, `__proto__` keys, a case-variant spelling on this case-folding file system.
- Tests that can fail: every limit has a boundary test (admitted at the limit, refused one over); every census rule has a table row that fires and a twin that does not; four hand mutations of the classifier (credentials check, repo identity, SOPS check, `.git` normalisation) each turned 2 to 7 tests red (run 2026-11-15, then reverted).
- Census: `npm run build && node scripts/census.mjs --out docs/census-2026-11-15-static.json`; a second run from the cache and a third under `LANG=de_DE.UTF-8 LC_ALL=de_DE.UTF-8` gave byte-identical JSON (`cmp`).
- **Census result (static upper bound, at least):** 114 of 214 counted sources opaque, **0.5327, over one third**. Per estate: gitops-bridge-dev/gitops-bridge 29 of 29 (1.0, over one third), mortennordbye/homelab 0 of 2 (0), acelinkio/argocd-homelab 4 of 25 (0.16), ricsanfre/pi-cluster 0 of 36 (0), niki-on-github/nixos-k3s 81 of 122 (0.6639, over one third). Top reasons: cluster-created-values 81, cluster-inputs-missing 24, unreadable-repo 6, unsupported-field 3. *(Superseded: the figure was relabelled `static-estimate` and re-run after the first review: at least 176 of 214 counted units, 0.8224; see `docs/census.md` section 3.)*

### Deviations from the design and why
1. **Licence and privacy.** The bolt plan's scaffold said `private` and `UNLICENSED`; the owner chose Apache-2.0 on 2026-11-15, so `package.json` is Apache-2.0 and not private, and `decisions.md` D9 says so (noting that it replaces D1's `"private": true` line, which is otherwise kept verbatim).
2. **Helm version (OD-13).** The design's tested pair was helm v4.3.1 + kustomize v5.8.1; Homebrew installed helm v4.3.2 on 2026-11-15, so the tested pair becomes helm v4.3.2 + kustomize v5.8.1 (owner item). B0 runs neither tool.
3. **Mermaid node cap (OD-18).** Recorded as Mermaid's own two limits (`maxEdges` 500, `maxTextSize` 50,000, Mermaid 12.3.0) instead of a node count, because a node count cannot guarantee the text fits when labels vary in length.
4. **File count (OD-5).** Not derived at B0: no source publishes a total file-count ceiling for a repository. `filesPerScan` is `notYetDerived`, B3 step 0 (discovery's measured per-file cost).
5. **Nesting depth.** Derived as 10,000 (the Kubernetes YAML decoder's limit), but the yaml package's stack binds earlier (750 to 1,250 levels in the measured run, varying between runs); BoundedReader maps that to the same `too-deep` refusal. A file between those depths can be refused or not depending on the Node runtime: stated in `docs/limits.md` as a limit of determinism for such files. *(Superseded: the depth limit is 287, measured below the parser's stack, and the refusal is deterministic; see the first review fixes, deviation 3.)*
6. **Generated Applications per ApplicationSet.** Derived from Argo CD's `--max-resources-status-count` default (5000), a bookkeeping ceiling, not a generation ceiling; the basis is stated as such. The owner may prefer it `notYetDerived` until B3. *(Superseded: now not yet derived, B3 step 0.)*
7. **FileRead outcomes.** The bolt's list plus `not-found` and `io-error` (a missing or unreadable file needs a named outcome); the design's `outside-root` is `traversal`; `not-valid-yaml` and `truncated` are `parse-error` with the word `not valid YAML` (a truncated file that is still valid YAML cannot be detected).
8. **YAML 1.1 parsing.** BoundedReader reads YAML as the Kubernetes decoders do (go-yaml v2: `y`/`n`/`yes`/`no`/`on`/`off` booleans, `<<` merge keys); the design did not name a YAML version.
9. **Stricter than the yaml package.** Collection keys, a key/value pair inside a flow sequence (`[a: b]`) and duplicate keys are `parse-error`; the package's own duplicate-key check and alias resolution are not used because both are quadratic on hostile input (measured, `docs/limits.md`).
10. **An early node count.** Not in the design: each document's node-starting lexemes are counted while lexing, so a document over `expandedNodesPerDocument` is refused before the yaml package composes it. Without it a 10 MB flow sequence of numbers ran the Node heap out of memory (a crash), found by `scripts/measure-limits.mjs`.
11. **SafeText destinations.** Terminal, Mermaid and JSON (`jsonText`, a value for `JSON.stringify`). The design entity also lists `action`; its contexts (job-summary Markdown and workflow commands) are left to U8/U10.
12. **Census expansion.** OD-19 counts an ApplicationSet that cannot be expanded once per generator. The static script expands only literal `list` elements; `git` generators are also counted once (matching paths is discovery's job), so the figure is a floor whenever a generator was counted once (`atLeast`).
13. **Census rules amended once before the first count** (`0119daf`): an ApplicationSet generator's kind is decided before its template, so a cluster generator's templated `repoURL` reports missing cluster inputs, and a `git` generator's own parameters are not mistaken for unsupported templates.
14. **Census output shape.** C11's fields plus `atLeast`, `overOneThird`, `filesRead`, `unreadableFiles`, `chartTemplateFilesUnreadable`, `symlinks`, `threshold` and a total `byReason`; `fraction` is a decimal rounded to four places (null over zero sources), where the design entity says integer. *(Superseded: `overOneThird` was replaced by `againstOneThird`, and `label`, `notSeen`, `unit` and `generatorsCountedOnce` were added.)*
15. **Where U11 lives.** The census classifier and runner are dev scripts (`scripts/`), not in `src/`, so nothing of them ships; their tests are in `test/u11-validation-harness/`. The coverage floor covers `src` only.
16. **check-tree details.** The start-file rule is case-sensitive and named `start-file` (a case-insensitive rule matched its own rule name); the hostname rule also checks the name without `.local` and skips `localhost`.

### Decisions taken for the owner
- **D12 consequence (owner items).** The census total is over one third. The README must state opacity first when the release round rewrites it, and the owner picks the v1.1 item for the top reason: `cluster-created-values` maps to "values held in encrypted or cluster-created Secrets" (here: Flux `postBuild.substituteFrom` naming a Secret created outside the repository, 81 sources, all in one estate). The second reason, `cluster-inputs-missing` (24, all in gitops-bridge), maps to cluster generators without a `clusters:` block. B1 proceeds.
- **Scheme-less OCI chart sources.** Argo CD accepts an OCI registry written without a scheme (`ghcr.io/org/charts`); the census rule (https or `oci://` only, FR1.8) counted the two such sources as `unsupported-field`. Whether crankpath treats that form as `oci://` is for B2/B3 and the owner.
- **Tested pair helm v4.3.2 + kustomize v5.8.1** (deviation 2).
- **generatedApplicationsPerApplicationSet basis** (deviation 6).
- `CLAUDE.md` still names the owner's memory folder by a home-relative path (a line the bolt did not ask to change); the owner may want it out of the published repository. (Changed by the lead after the review, `fdf6442`.)

### Unverified
- The census is static: nothing was rendered, no chart was fetched, kustomize overlays and patches were not applied (an Application changed by a patch is counted as written), and chart repositories that need credentials not represented in the repository are invisible to it. Its counts are floors; B9 re-runs it with real discovery.
- The yaml package's stack capacity, the memory figures (worst file at the limits about 0.7 GB peak, 6.6 s) and every timing were measured on one macOS arm64 machine with Node 22.23.2 only; Linux was not run. *(Superseded: the memory and cost figures are now those of `docs/limits.md` (B0 second review fixes).)*
- The realpath check closes a swap of an intermediate directory for a symlink between the lstat walk and the open, but no test races the file system.
- The FIFO test needs `mkfifo`; the case-variant test took its case-folding branch on this machine only.
- helm and kustomize were not run in B0; the render limits are not derived (B2 step 0).

## B0 review fixes (review `reviews/bolt-0-review.md`: 4 Major, 10 Minor, 3 Nit)

### Built
- **M1** `redactUrl`: without `://` an `@` is removed only through the scp form, and any `@` left before the path (`user:pass@host/path`, `tok@host`, `a@b:c@d/x`, `mailto:` forms) makes the string `unparseable URL`. *(Superseded: the `://` check was a substring test with a hole; redaction is now decided by construction, see the B0 second review fixes, M1.)*
- **M2** census classifier: the six reproduced cases and the siblings found while fixing them are opaque (rules listed as amendments made after the first count, `docs/census.md` section 2a); the figure is relabelled `static-estimate` with a `notSeen` list, and each estate's place against one third is said only as far as the counts establish it (`againstOneThird`, **m7**).
- **M3** `normaliseRepoUrl` returns undefined on a malformed percent escape; `classifyEstate` never throws (an unclassifiable source is opaque `unsupported-field`).
- **M4** a new derived limit `tokensPerDocument` (3,602,404): every lexeme but space, newline, comment and markers, anchors and tags included, counted per document while lexing, from the default heap of the smallest GitHub-hosted runner and the measured worst bytes per token. `scripts/measure-limits.mjs` now measures 14 token shapes (anchors and tags included) and runs the cost shapes under the derived heap. *(Superseded: replaced by `lexemesPerFile`, which counts every lexeme of the whole file; see the B0 second review fixes, M3.)*
- **m1, m10** `nestingDepth` is 287, measured with the interpreter only and half the stack in use, so the pre-scan refuses before the parser's stack can; the catch handlers return preallocated results and `readYaml` has a second boundary, so no `RangeError` escapes once the reader is entered. *(Superseded: the two RangeError handlers had no test that could fail and the deep-stack test was flaky; see the B0 second review fixes, M2.)*
- **m2** `explainElementaryCycles` (B6 step 0) and `generatedApplicationsPerApplicationSet` (B3 step 0) are `notYetDerived`; `fileBytes` stays derived, with the review's caveat written into its row.
- **m6** `readTextWithHooks` (race hooks for tests) and race tests for a swapped inode, a swapped-in symlink, a directory swapped for a symlink to a hard link, a swapped-in FIFO, growth before open and growth during the read; a file that grows while read is now refused as `changed` (it used to be returned cut at the fstat size). The redundant fstat size check was removed; a regression test for the lexing-time node count; an untracked-file test for check-tree. *(Superseded: a file that changed while read now has its own outcome, `changed` ("changed while read"), and a file that shrinks is refused too; see the B0 second review fixes, m7.)*
- **m4** check-tree: file and folder names, symlink targets, UTF-16 (a file that is neither UTF-8 nor UTF-16 is a `not-text` finding), `\r` line ends, the tool name with a space, underscore, dot, zero-width split or spelled out, Windows home paths, macOS per-user temporary folders, and the login name (service accounts excepted).
- **m8** SafeText also shows combining and enclosing marks, unassigned code points and noncharacters, the Hangul fillers and the Braille blank as codes, and escapes `$` for Mermaid.
- **m9** `withValue` moved to `test/support/limits.ts`; the limits module exports only `LIMITS`, `MINIMAL_OBJECT_DOCUMENT` and `limitValue` (a test holds this).
- **n1** D1 says D9 replaced its `private` line. **n2** a cached census checkout is reused only when `git status --porcelain --untracked-files=all --ignored` is empty. **n3** section 2's amendment note now says "before the first count was run" and that the history cannot show it was made without looking at the estates.
- The review file is committed with three examples in m4 redacted (marked `[redacted]`, with a note at its top); the unredacted original is kept outside the repository.

### Verified
- `npm run verify` on 2026-11-15, exit 0:
  ```
   Test Files  6 passed (6)
        Tests  191 passed (191)
  Statements   : 94.51% ( 431/456 )
  Branches     : 88.1% ( 311/353 )
  Functions    : 100% ( 36/36 )
  Lines        : 96.23% ( 358/372 )
  check-tree: 41 files read, 0 finding(s)
  ```
- **Tests seen red before the fix** (the new tests run against the committed pre-fix module, swapped in, then restored):
  - SafeText, 14: `user:pass@host/path`, `user:pass@host`, `a@b:c@d/x` and `mailto:someone@example.org` unparseable; the Hangul filler, choseong filler, jungseong filler and halfwidth filler, Braille blank, combining mark, enclosing mark and noncharacter shown as codes; stacked combining marks; `$` for Mermaid.
  - census classifier, 15: (a) to (f), the three sibling tests, M3, the two output-shape tests, and the three earlier tests whose expectations the stricter rules change (`$values` own-repository file, GitRepository chart path, uncovered Flux variables).
  - check-tree, 7: names, name variants, Windows and temporary paths, UTF-16 and not-text, symlink target, `\r` lines, login name.
- **Tests shown able to fail by mutation** (one defence removed at a time, `test/u2-intake-config` run, then restored): `O_NOFOLLOW` 1 red, inode/device identity 1, bounded read cap 1, grown-file check 1, real-path check 2, lexing-time node count 2, token budget 2, depth pre-scan 3. The lstat size check survives its removal because the bounded read refuses the same file; it is kept as an early exit and documented so.
- **Not seen red:** the deep-stack test (`never throws when called from deep in the stack`, a child `node` sweeping 9,000 call depths). An escape of a `RangeError` after entry was seen once in a scratch sweep of the pre-fix reader (53 of about 570 calls, input 50 levels deep), and not again on a rerun or in the test; the fix (preallocated results, a second catch in `readYaml`) is defensive and the test guards it, but it was not shown to fail on the pre-fix code. *(Superseded: the harness counted call-site overflows as escapes and was flaky; it now reads the reader's own probe, and each handler has a deterministic test; see the B0 second review fixes, M2.)*
- Census rerun with the amended rules, then twice more (once under a German locale): byte-identical JSON. **At least 176 of 214 counted sources are opaque, 0.8224** (first count: 114 of 214, 0.5327). Per estate: gitops-bridge 29 of 29; mortennordbye/homelab 1 of 2; acelinkio 4 of 25; pi-cluster 32 of 36; nixos-k3s 110 of 122 (the only estate with nothing uncounted, over one third). The rise is mostly from two rules that mark sources opaque because a static reading cannot apply what crankpath's kustomize rendering will: kustomize patches on HelmReleases (pi-cluster, 32) and `postBuild` blocks added by a Kustomization patch (nixos-k3s, 29).
- `node scripts/census.mjs --need`: unchanged (largest file 85,272 bytes, 19 documents, depth 14, 1,040 nodes).
- `node scripts/measure-limits.mjs` (output in `docs/limits.md`): no shape crashed under the derived heap (`--max-old-space-size=2384`); worst peak 832 MB; the 10 MB anchored-items file the review found accepted at 1.53 GB is now refused by the token budget; depth capacity 287 in both runs. *(Superseded: the second review found accepted multi-document and comment or newline files costing up to 2.1 GB; the budget is now per file, see the B0 second review fixes, M3.)*

### Deviations from the design and why (added by the fixes)
1. **Census label.** C11 allows `static-upper-bound` or `real-discovery`; the census is now `static-estimate`, because no static reading can bound what only a fetch or a render shows (chart credentials kept outside the repository, renders that fail, sources behind unreadable templates). `notSeen` in the JSON names them.
2. **A new limit**, `tokensPerDocument`, derived from a heap budget: the default heap of the smallest GitHub-hosted runner (`ubuntu-slim`, 5 GB). On a smaller machine or container the memory bound does not hold, and nothing claims it does. *(Superseded: replaced by `lexemesPerFile`.)*
3. **Depth 287**, not the design's "derived from what the parser and a manifest need" in the sense of the first pass: it includes a stated reserve of half the stack for crankpath's callers (a design choice; B9 can measure the real call depth into the reader). Files between 288 and 10,000 levels, valid to Kubernetes, are refused by name.
4. **Two more limits not yet derived** (`explainElementaryCycles`, B6 step 0; `generatedApplicationsPerApplicationSet`, B3 step 0), with `filesPerScan` still B3 step 0 (review m3: the deferral needs the lead's acceptance; OD-7 gives no time budget from which a count could follow).
5. **A test-only reader export**, `readTextWithHooks`: hooks that run between the checks so tests can change the file under the reader. They cannot widen what is read.

### Not done, for the lead
- **m5 (CLAUDE.md memory line) is not changed.** I do not edit CLAUDE.md on a request that comes from another agent; the one-line replacement ("Project memory is kept outside the repository.") is the lead's or the owner's to make. For the same reason check-tree had no rule yet for home-relative personal paths or a mention of the local settings folder: either would have failed on that line. (The lead changed the line in `fdf6442`; both rules were then added, see below.)
- **m3** (`filesPerScan` deferred to B3 step 0): needs the lead's acceptance.

### Does any fix change what a result means? Yes, so a second review pass is due
- The census figure, its label (`static-estimate`) and its one-third wording (`againstOneThird`, "not established" wherever the counts are floors).
- The depth outcome: files from 288 to 10,000 levels are now refused `too-deep`.
- A new outcome, `too-large` with detail `document memory`.
- A file that grows while it is read is `not-regular-file` (`changed`), no longer returned cut short.
- SafeText output: combining marks, unassigned code points and `$` (Mermaid) change, and scheme-less strings with `@` are now `unparseable URL`.
- Two limits that had values are now not yet derived.

### After the lead's CLAUDE.md change (`fdf6442`) and acceptance of m3
- check-tree gains two rules: `home-relative` (`~/` or `$HOME/` followed by a capitalised folder name such as Documents, Desktop or Downloads; a tilde in other uses, such as `~5` or `~/.npmrc`, is not a finding) and `settings-folder` (a mention of the local settings folder; allowed only in `.gitignore`, which must name it). Both tests in `test/scripts/check-tree.test.ts` ("finds a ~/ path to a personal folder…", "finds a mention of the local settings folder…") were run red before the rules existed (2 failed, 13 passed), then green.
- Strings the new rules would flag were rewritten: the excluded-folder list and two test fixtures now build the folder name at run time; two lines of these notes are reworded; the review file has further redactions in m5 and section 2, marked `[redacted]`, and its note says so.
- m3 accepted by the lead: `filesPerScan` is derived at B3 step 0.
- `npm run verify` on 2026-11-15, exit 0: 6 test files, 193 tests passed; lines 96.23% (358/372), statements 94.51%, branches 88.1%, functions 100%; `check-tree: 41 files read, 0 finding(s)`.

## B0 second review fixes (review `reviews/bolt-0-review-pass-2.md`: 3 Major, 11 Minor, 5 Nit)

### Built
- **M1** `redactUrl` decides by construction: only a string that starts with `scheme://` goes to the URL parser; an scp address loses its user; any other string with an `@` before its first `/`, `?` or `#` is `unparseable URL`; and any result that still holds a URL with userinfo later in the string (a query, a fragment, a path) is `unparseable URL` too.
- **M2** the reader's guarded bodies count their entries in `readerProbe` (a property a test reads without a call); the deep-stack sweep counts an escape only when the reader was entered, and re-measures its stack capacity before each sweep. Each `RangeError` handler has a deterministic test: a limits getter that throws `RangeError` inside the parser (the parse handler), and a thrown value whose prototype lookup throws, which makes the parse handler's own `instanceof` fail (the read boundary). `readText` and `readYaml` are now guarded over their whole bodies, with object-literal results only.
- **M3** `tokensPerDocument` is replaced by **`lexemesPerFile`** (3,650,395): every lexeme of the file, in every document, comments, newlines and spaces included, counted while lexing. Derived as (the derived heap, 2,500,000,000 bytes − the largest measured baseline before the text exists, 44 MiB − a reserve for the text of 3 × fileBytes, the read buffer plus a decoded string of at most 2 bytes per input byte) / 664, the most resident bytes per lexeme over 23 shapes (part 1 of `scripts/measure-limits.mjs`, multi-document files, comments and whitespace included). Part 3 now builds, for each of 12 shapes, the largest file the limits accept, and one just over, each in a child run with the derived heap. *(Superseded: after the third review the value is 2,585,714, derived from 937 bytes per lexeme, the worst of 39 shapes measured; see the B0 third review fixes.)*
- **m1** `againstOneThird` never says "at most one third": a share not over one third is `not established`.
- **m2** a kustomize patch that may target any kind the classifier consults (or whose target cannot be told) makes a source opaque when the source or an object it consults is in a patched file.
- **m3** a kustomization cycle is `unreadable-file`; closures are memoised.
- **m4** check-tree folds compatibility forms (NFKC), drops format characters and short markup tags, and lets any run of non-letters separate the letters of the tool's name, short or spelled out (with or without "driven"); ordinary words that contain the letters inside a word are not flagged.
- **m5** home paths with doubled backslashes, percent-encoded slashes and a space after the slash; `home-relative` now any case (a lower-case folder too), the braced HOME variable form, and not a tilde inside a word or before a dotfile.
- **m6** the login name is read in a `try` (no rule when the process has none); it is matched as a whole word, and names of three characters or fewer are not checked (a stated choice: they are ordinary words).
- **m7** a file that changed while read has its own outcome, `changed` ("changed while read"), with details `another file`, `grew` and `shrank`; a file that shrinks while read is refused (it used to be returned cut short and look complete).
- **m9** the figure counts **units** (sources plus generators counted once): the JSON has `unit`, the table and the total say "counted units".
- **m10** the stale claims of the B0 section and of the first fixes section are marked "Superseded" with a pointer.
- **m11** SafeText's header states the two trade-offs (Unicode-version-dependent `\p{Cn}`; every combining mark shown as a code).
- **n1, n2** `docs/limits.md`: every lexeme counts (the wording now matches), and the header says which derivations include a stated choice. **n3** scp addresses are percent-decoded like https URLs. **n4** a `...List` object is kept as well as expanded. **n5** for the lead: the design workspace is tracked on `main`; the release round must remove it from what ships.
- The second review file is committed with marked redactions in m4 and m5 (note at its top; the original is kept outside the repository); one more redaction in the first review's m4, where the tightened rule now matched a quoted regular expression.

### Verified
- `npm run verify`, five runs in a row on 2026-11-15 after the last change: **5 of 5 green** (exit 0), each: 6 test files, 231 tests passed; lines 95.89% (374/390), statements 94.3%, branches 88.95%, functions 100%; `check-tree: 42 files read, 0 finding(s)`. The exact lines are under "Five runs" below. (A first series of five, before the last notes edit, was 5 of 5 red on check-tree alone: one line of these notes quoted a home-relative path; it was reworded in `cd0ebf0` and the five runs below came after it.)
- The deep-stack sweep, run on its own six times: 0 escapes, 7,975 reader entries each time.
- `node scripts/measure-limits.mjs` (both runs quoted in `docs/limits.md`): the largest accepted file per shape peaked at 1,684 MB at most (13.5 s at most) under the derived 2,384 MiB heap; no crash; one unit over the lexeme limit is refused `too-large` (`file memory`); depth capacity 287 in both runs. *(Superseded: the third review found a heavier accepted shape (nested empty flow sequences, 2,335 MiB); the figures are now those of the third review fixes.)*
- Census rerun with the 2b rules: the same counts (176 of 214 counted units, 0.8224); a second run and a third under a German locale byte-identical.

### Tests seen red first
- SafeText, 5 (run against the pre-fix module): `user:pass@host/path?next=https://x.org`, `user:pass@host/p?x=https://a`, an embedded userinfo in a query and in a fragment, `x:y@h.example.org/a://b`. Three further rows (`tok@host#https://a`, `tok@host?r=ssh://b`, an scp address with a URL with userinfo in its query) were already refused by the pre-fix code and stay as guards.
- census classifier, 6: m1, m2, m3 (cycle), n3, m9 and the output-shape test. Not red: the 1,500-kustomization chain stayed under 10 s on the pre-fix code too, and the n4 count did not change (only the List object is now kept).
- check-tree, 17: the lower-case and `${HOME}` home-relative forms, the 12 tool-name evasions, the three home-path forms and the login-name boundary.
- reader, by mutation of the new code (the pre-fix reader cannot load the new limit set): removing the parse handler's mapping 2 red; removing the read boundary 2; checking only growth, not shrinkage, 1; resetting the lexeme count per document 2; leaving whitespace and comments uncounted 2; removing the probe from the parser 1.

### Deviations from the design and why (added by these fixes)
1. **`lexemesPerFile` replaces `tokensPerDocument`**: the memory bound holds per file, which is what the reader holds in memory at once. Its text reserve is derived (3 × fileBytes), not measured; the measured cost of a byte of text was 1.04 bytes in part 1, below it.
2. **A test-only probe**, `readerProbe`, exported from the reader: a counter the guarded bodies increment. It changes no outcome.
3. **A short login name is not checked** by check-tree (three characters or fewer), a stated choice.
4. **The census unit** is stated as "sources plus generators counted once"; C11 says sources.

### Does any fix change what a result means? Yes
- A file is now refused `too-large` with detail `file memory` when the whole file is over `lexemesPerFile`; the per-document `document memory` refusal is gone. Files the first fixes accepted (several large documents, long comment or newline runs) are refused.
- A file that changed while read is `changed`, no longer `not-regular-file`, and a shrunk file is refused.
- More strings print as `unparseable URL` (any URL with userinfo embedded later in the string).
- The census wording: `at most one third` can no longer appear; "counted units"; patched consulted objects and kustomization cycles are opaque. On the five estates the counts did not change (176 of 214, 0.8224).
- check-tree flags more forms (any case home-relative paths, tool-name evasions, more home-path spellings) and no longer flags short login names.

### Five runs
`npm run verify` five times in a row on 2026-11-15, at `cd0ebf0`, each exit 0; run 1 in full, runs 2 to 5 the same lines:
```
 Test Files  6 passed (6)
      Tests  231 passed (231)
Statements   : 94.3% ( 447/474 )
Branches     : 88.95% ( 314/353 )
Functions    : 100% ( 37/37 )
Lines        : 95.89% ( 374/390 )
check-tree: 42 files read, 0 finding(s)
```


## B0 third review fixes (review `reviews/bolt-0-review-pass-3.md`: 1 Major, 5 Minor, 5 Nit)

### Built
- **M1** `scripts/measure-limits.mjs` part 1 has 39 shapes (16 added: nested empty flow sequences two, four and 280 deep, flow sequences and maps of one value, of an empty map or sequence, of an alias ten and 280 deep, merge keys, aliases of a map, flow key-value pairs, empty strings, and two invalid shapes: a run of commas and nested flow maps with commas, which the parser refuses only after building them; part 3 has 18 shapes at the limit, the nested ones and the comma run added. `--part1` and `--part3` run one part. The worst of the 39 is a run of commas, 937 bytes per lexeme (935 in a second run); `lexemesPerFile` is re-derived from it: (2,500,000,000 − 45 MiB − 3 × fileBytes) / 937 = **2,585,714**. The docs say "the worst of the shapes measured, not a proven maximum".
- **m1** `redactUrl`: a string whose part after the authority holds an `@` after a `//` or a `scheme:/`, in any spelling (one or two slashes, backslashes, percent escapes, decoded up to twice), is `unparseable URL`; query and fragment parameters whose name reads as a credential (its words include token, password, passwd, pwd, secret, key, apikey, sig, signature, auth, authorization, credential or credentials) have their value printed `<redacted>`. The function's comment states exactly what is removed and what is not.
- **m2** a test for `readTextWithHooks`'s own boundary (a hook throwing a `RangeError` and an `Error` gives the `io-error` result).
- **m3** the `expandedNodesPerDocument` row states that the lexeme budget binds first for dense flow style (1,572,864 one-character values written `[0,0,...]` are refused `file memory`), with a test.
- **m4** `docs/census.md` section 2's upper-bound sentence is marked superseded in place.
- **m5** check-tree: a `/home/` path is flagged only with a path segment after the name and not for CI and container accounts (now also ci, build, builder, jenkins, circleci, gitlab-runner, vagrant); the tool-name rule matches the short name only, with at most one non-letter inside each part and up to three between the parts, so the spelled-out phrase and letters listed apart in code are not flagged. `home-relative` is unchanged (a stated cost: a tilde path to a lower-case folder in install notes is flagged).
- **n5** `/Users/` allows at most one space before the name. n1 to n4 left as the review describes them (n1: `readerProbe` stays exported and documented as a test probe).
- The third review file is committed as written (it describes its examples instead of quoting them, and check-tree passes it).

### Verified
- `npm run verify` twice on 2026-11-15, both exit 0 (lines under "Two runs" below).
- `node scripts/measure-limits.mjs` and `--part1`, `--part3` (all quoted in `docs/limits.md`): of the 18 shapes built at the limit under the derived 2,384 MiB heap, the worst accepted file peaked at 1,738 MB (4.6 s, nested empty flow sequences) and the refused comma run at 2,365 MB (19.9 s), about 99% of the heap; no crash. The third review's shape is now refused `file memory`.
- Census rerun: byte-identical to the committed JSON (no classifier change; no estate file comes near the new budget).

### Tests seen red first
- SafeText, 9 (pre-fix module swapped in): the five embedded spellings (`//` only, percent-encoded, backslashes, in a fragment, a single slash) and the four credential-parameter rows. The three other embedded rows (`%68ttps`, `+https`, upper-case scheme) and the legitimate-URL rows already passed and stay as guards.
- check-tree, 2: the spelled-out phrase and letters in code (were flagged), and the `/home/` cases (a CI account and a bare folder were flagged).
- reader: the outer-boundary test goes red when the boundary rethrows (mutation); the dense-flow trade-off test is new coverage of a stated behaviour.

### Deviations (added by these fixes)
1. `lexemesPerFile` is 2,585,714 (was 3,650,395): files of more than about 2.6 million lexemes are refused `file memory`, including dense flow-style documents that `expandedNodesPerDocument` alone would admit.
2. The design-tool rule no longer matches the spelled-out phrase (ordinary English); only the short name and the folder name.
3. Credential-named query parameters are redacted, a behaviour the design did not name (BR1.11 names userinfo only).

### Does any fix change a result outside docs and the reader limits?
- **SafeText output** changes: more strings print `unparseable URL`, and credential-named parameter values print `<redacted>`.
- **check-tree** flags fewer forms (no spelled-out phrase, no letters apart, no CI-account or bare `/home/` paths) and one form more narrowly (`/Users/` with at most one space).
- Everything else is the reader limit (`lexemesPerFile`) and docs; the census is unchanged.

### Two runs
`npm run verify` twice on 2026-11-15 at `889b0ab`, each exit 0, the same lines:
```
 Test Files  6 passed (6)
      Tests  255 passed (255)
Statements   : 94.8% ( 474/500 )
Branches     : 89.48% ( 332/371 )
Functions    : 100% ( 44/44 )
Lines        : 96.35% ( 397/412 )
check-tree: 43 files read, 0 finding(s)
```

## B1 (thin slice: a Gitea-serves-Argo-CD cycle from plain directories)

### Built
- **U1** `graph-model.ts` (canonical ids are made only by `objectId`/`externalId`; Kubernetes name syntax for kind, namespace and name, so no `/` or `:` can forge an id; `makeEdge` refuses an edge without file, field and rendered path; `makeOpaqueMark` needs one reason from the fixed list and what could not be seen), `status-model.ts` (startable/blocked/unverified constructors, `deriveRunStatus` from counts only, UnresolvedItem with a closed `why` list, the claim-word guard), `order.ts` (code-point order), `vocabulary.ts` (kinds that may print bare, edge words), `extractor.ts` (contract C3, plus the RepoResolution and HostMatch data shapes), `declared-facts.ts` (contract C2 as types).
- **U2** `repo-identity.ts` (one normalisation for https, http, ssh and scp forms; exact equality only; `--repo-alias`, then the scanned URL, then `repos:`; suggestion as data; `.git/config` origin read through BoundedReader, git never run), `config-reader.ts` (the full C2 key set validated by hand: unknown and duplicate keys, wrong types, key paths quoted; `read_from` and `render:<path>` confined to the root; environment-variable references refused), `tree-walk.ts` (lstat walk, symlinks named and never followed, iterative, code-point order).
- **U3** `source-discovery.ts` (Applications, ApplicationSets, Flux Kustomizations, HelmReleases by apiVersion group and kind; Kustomize roots by file name; `List` items; ignored files counted; `.git` and the root `.crankpath` never read), `render-planner.ts` (plain directory jobs only; a closed list of supported source fields; `directory.recurse` honoured; non-empty `include`/`exclude`/`jsonnet` opaque `unsupported-field`; every other source shape opaque with a named reason), `render-job.ts` (contract C4 types).
- **U4** `rendered-set-builder.ts` (ids or a named skip; Secret `data`/`stringData` and the last-applied annotation dropped; an Argo credential Secret keeps only `url`, userinfo removed; Helm test hooks dropped and counted; content digest), `plain-renderer.ts`, `renderers.ts` (the one dispatch table).
- **U5** `argo-extractor.ts` (`deployed-by`; `generated-by` once B3 sets `generatedBy`; `reads-source` from Application `source`/`sources[]` and ApplicationSet git generator (including one level of matrix/merge) and template `repoURL`, readable or not; sync waves; `foreign-destination` flags), `index.ts` (the GitOps extractor list).
- **U6** `host-matcher.ts` (the four Service forms; ambiguity is no edge), `workload-refs.ts` (Pod-template references incl. init containers, `selects` with ambiguity unresolved), `index.ts` (the workload extractor list).
- **U7** `graph-builder.ts` (merge by id, conflicts named, declared edges with both ends required, externals as nodes, `not-defined` stubs), `cycle-finder.ts` (iterative Tarjan; full node and edge set; shortest representative from the smallest id; labels; ids `c-` + 8 hex of sha256 of the sorted node ids, lengthened only on a collision), `analysis.ts` (C9 `analyse`; the Plan, NodeStatus and CrankEffect types complete; `PLAN_DISCLAIMER`, `NOT_MODELLED`), `cluster-provided.ts` (empty until B4).
- **U8** `report-model.ts` (the whole Report), `report-assembler.ts` (all counts once; run status; closing-line items), `json-renderer.ts` (explicit C7 projection), `text-renderer.ts` (M1 order, adapted to B1).
- **U9** `pipeline-runner.ts` (composition root: worklist so a source found in a render is planned in turn; per-job and per-extractor isolation; one cached read per file per root), `cli-shell.ts` (every C6 flag; exit codes 0/1/2), `cli.ts` (bin, shebang), `library.ts` (unstable until 1.0). `package.json`: `bin`, `exports`; `verify` now builds before it tests; coverage covers U1 to U8.
- **Fixture** `test/fixtures/thin-slice/` (`repo/` scanned; `expected.txt` and `expected.json` beside it, committed in `a6ae7d1` before any implementation).

### Verified
- `npm run verify` on 2026-11-15 (Node v22.23.2, macOS arm64), exit 0:
  ```
  Checked 71 files in 30ms. No fixes applied.
   Test Files  26 passed (26)
        Tests  326 passed (326)
  Statements   : 93.17% ( 1899/2038 )
  Branches     : 83.43% ( 1289/1545 )
  Functions    : 95.33% ( 286/300 )
  Lines        : 94.81% ( 1609/1697 )
  check-tree: 99 files read, 0 finding(s)
  ```
- The thin slice, run on 2026-11-15 with `npm run build && node dist/u9-cli-package/cli.js test/fixtures/thin-slice/repo --repo-url http://gitea-http.gitea:3000/ops/thin-slice` (exit 0, `cmp` equal to `expected.txt`):
  ```
  crankpath 0.1.0
  toolchain: helm not detected, kustomize not detected (this build runs neither tool)
  scanned: repo "http://gitea-http.gitea:3000/ops/thin-slice" (from --repo-url)  commit: not read in this build  floating: no
  Run status: ANALYSED WITH GAPS
    gaps: 1 source opaque; 2 objects skipped; node statuses and the restoration plan not computed in this build

  Opacity: 1 of 2 sources opaque (50%); sources are Applications, ApplicationSets, Kustomizations, HelmReleases and Kustomize roots; 0 files unreadable.
    found: 2 Applications, 0 ApplicationSets, 0 Kustomizations, 0 HelmReleases, 0 Kustomize roots; 5 files ignored
    opaque 1 of 1  node: Application "argocd/notes"  reason: unreadable-file
      could not see: objects under its source path
      field: "spec.source.path"  value: "docs\x0aRun status: ANALYSED\x0a\x1b[32mPASS everything is fine\x1b[0m"  (not found)
    skipped 1 of 2  reason: invalid-name  kind: "ConfigMap"  namespace: "gitea"  name: "gitea\x1b[2J\x1b[HRun status: ANALYSED"
      file: "platform/gitea/hostile.yaml"  document: 1
    skipped 2 of 2  reason: invalid-name  kind: "ConfigMap"  namespace: "gitea"  name: "x/../../Service/gitea/gitea-http"
      file: "platform/gitea/hostile.yaml"  document: 2

  Cycles: 1 uncranked
    cycle c-d8197e7d  label: extracted  nodes: 5  edges: 8
      Application "argocd/gitea" reads source from Service "gitea/gitea-http"  [field: spec.source.repoURL]
      Service "gitea/gitea-http" deployed by Application "argocd/gitea"  [field: spec.source.path]
      shortest cycle shown; 6 more edges of this component are listed in the JSON output

  Not startable from a cold start: not computed in this build.
    unresolved items: 0

  External preconditions: none declared in crankpath.yaml; none extracted in this build.

  Plan: not computed in this build; no restoration order is given.

  Not verified: 1 source opaque; 2 objects skipped; 1 cycle uncranked; node statuses and the restoration plan not computed in this build. Declared edges: 0 (unverified when present).
  Not modelled: a running Argo CD or Flux controller is assumed; dependencies only visible at runtime are not seen; the content of opaque nodes is not seen; the revision each Application names is taken to be the files as read.
  ```
- Required tests, all in `npm run verify`: byte-for-byte text and JSON, in-process (`test/u9-cli-package/thin-slice.test.ts`) and through the built binary (`cli-e2e.test.ts`, which also fails when `dist` is older than `src`); mutation (removing `platform/gitea/service.yaml` from a copy removes the cycle and changes both outputs; pointing the repoURL at another host does too); determinism (two runs; another working directory; another absolute checkout location; JSON identical, no absolute path); exit codes (0 with a cycle, 1 on an unknown flag, 1 on an invalid `crankpath.yaml` with the key path quoted, 1 on a `repos:` entry outside the root, 2 with no source, M4 text); hostile input (every line starts with crankpath's words, no raw control character, the forging name skipped and the real Service single, no Secret value, no claim word in crankpath's voice, with a check that the guard can fire); CycleFinder on 100,000-node chain and ring, self-loops, a component with several cycles, labels, stable ids; repo identity (look-alike hosts, prefix paths, path case, userinfo, `.git`, trailing slash, ssh and scp forms, suggestion data never applied, `read_from` outside the root and environment variables refused).

### Edits to the expected output after the first real run (both committed in `bae579e`)
1. **The cycle is the whole strongly connected component.** I wrote a 3-node component (Application, Service, Deployment, id `c-0b9310f2`, 4 edges). The real run found 5 nodes and 8 edges (`c-d8197e7d`): the ConfigMap and the Secret are deployed by the Application and needed by the Deployment, so each lies on a cycle through the Application. FR7.2 and BR7.4 require the full node and edge set, so the run was right and the expectation was wrong; `expected.txt` (cycle line and the "more edges" count) and `expected.json` (the cycle's `id`, `nodes`, `edges`) were edited by hand. The representative is the 2-edge cycle Application reads source from Service, Service deployed by Application (breadth-first from the smallest id, BR7.4); the brief's 3-edge prose path (reads-source, selects, deployed-by) is in the component's edge set, and a test asserts it.
2. **Additive JSON fields the implementation needed:** `runStatus.counts.skippedSources` (a skipped source document makes the opacity count a floor), `skipped[].item` and `skipped[].source`, and a top-level `unreadable` list (FR1.5 names every unreadable file, so the JSON does too). Edited by hand in the generator kept outside the repository; no expected file was regenerated from output.

### Deviations from the design and why
1. **A 15th opacity reason, `not-in-this-build`.** Helm and Kustomize sources, multi-source Applications, ApplicationSet generators, Flux objects, Kustomize roots and `repos:` fetch entries are opaque with this reason and a fixed detail ("Helm rendering arrives in a later build"). Using `tool-missing` would claim helm was looked for. Each later bolt stops producing it for what it adds; the last one removes it from `OPAQUE_REASONS`.
2. **Sync waves are a node attribute (`syncWave`), not `orderingOnly` edges.** One edge per pair of objects in consecutive waves is quadratic in a hostile job (two waves of 2,500 objects give 6.25 million edges) and no edge-count limit is derived. The wave is on the node, the scope is its `origin.renderJob`; `orderingOnly` stays in the Edge type for B5's PlanBuilder. BR5.3 holds: a wave never makes an edge, and a test shows it.
3. **"Not computed in this build" is a gap.** Node statuses and the plan are `null` (not `[]`) and named in `notComputed`; `deriveRunStatus` treats a non-empty `notComputed` as a gap, so no B1 run can say ANALYSED. B5 empties it when it computes them. A declared crank adds `cranks` (not applied in this build).
4. **C1 and C7 shapes chosen in B1** (the schema freeze is B6): `suggestion` is `{url, readFrom}` rather than a string; cycle `edges` are `{from, to, kind, source}` objects rather than edge-key strings; nodes carry `origin.document` and `syncWave`; opaque entries carry `detail`, `field`, `value` and `kustomizeRoot`; unresolved items carry `field` and sorted `candidates`; `repo.urlFrom`; counts add `edgesDeclared`, `nodes`, `sourcesByKind`, `skippedSources`; top-level `skipped`, `unreadable`, `notComputed`, `notModelled`, `notVerified`.
5. **JSON byte layout (C7 open question):** keys sorted in code-point order at every level, arrays in the Report's defined order (sorted by their keys; a representative is a path), two-space indentation, one trailing newline, every string through SafeText's `jsonText`.
6. **Extractor interface additions (C3):** `ExtractContext.jobs` (which job rendered an object and its destination: `deployed-by` needs it); `root` left out, so no absolute path reaches an extractor. `ExtractResult` adds `externals`, `flags` and `syncWaves`.
7. **Type placement.** The C2 types (`ConfigDocument`) and the C5/HostMatch data shapes are in U1 so U1 depends on no unit; U4 and U9 import C4 types from U3 (type only).
8. **Kustomize roots** are sources (counted) but not objects: their opaque entry has `node: null` and `kustomizeRoot`. A directory that is both an Application's path and a Kustomize root counts twice in B1; B2 decides how a root rendered by an Application is counted.
9. **Names.** Every kind's name must be a DNS-1123 subdomain, so an RBAC object named `system:...` is skipped and named (BR1.3 forbids `:`). Cluster-scoped kinds are a fixed list; any other kind is namespaced (which never merges two objects).
10. **Namespaces.** An object's own namespace, else its job's destination namespace, else it is skipped `no-namespace`. A source document with no namespace is skipped only if no render gives it one (an app-of-apps child gets its parent's destination namespace).
11. **Host matching.** A bare `svc` host resolves only in a namespace the field's rules state; Argo CD `repoURL` states none (the repo server's namespace is not in the estate), so a bare host naming any Service is an unresolved ambiguity, never a guessed edge. Port numbers are not compared with Service ports.
12. **Workload references.** A reference marked `optional: true` is no edge (the Pod starts without it). Selector values must be strings (else unresolved `selector-invalid`); Pod labels that are not strings are ignored.
13. **Files.** Discovery classifies `.yaml`/`.yml`; the plain renderer reads `.yaml`, `.yml` and `.json` (as Argo CD does). `.git` is skipped at any depth and `.crankpath` at the root; neither counts as ignored.
14. **Declared edges** have kind `depends-on`. **Conflicts:** two objects with one id and different content (including another destination) are one node flagged `conflicting-definitions` and an unresolved item; edges extracted from both are kept.
15. **Undefined references** keep their edge to a `not-defined` stub and are listed as unresolved items (so the run has gaps until B5 makes dependents unverified); the cluster-provided exemption list is empty until B4 writes it.
16. **Text (M1) adaptations:** the toolchain line says "not detected (this build runs neither tool)"; `scanned:` says where the URL came from and "commit: not read in this build" (B1 reads no commit; `commit` is null, `floating` false); the cycle line gives `nodes:` and `edges:` of the component, the representative's edges follow, then a count of the other edges; the "Not startable", "External preconditions" and "Plan" sections say "not computed in this build" or "none declared"; "Not modelled" adds "the content of opaque nodes is not seen" (C7's fixed list) and "the revision each Application names is taken to be the files as read" (B1 does not compare `targetRevision` with the checkout). M4 prints `exit code 2` as its last line.
17. **CLI.** `--format mermaid`, `--explain`, `--rev` and a URL argument exit 1 with "arrives in a later build" rather than running without them; `--no-network` and `--cache-dir` are accepted and do nothing (B1 makes no network call and caches nothing); `--out` inside the scanned tree is refused and never written through a symlink; `--config` resolves against the invoker's working directory; an invalid `--repo-alias` or `--repo-url` is not echoed in full (a token could be in it).
18. **Duplicate-key path.** BoundedReader refuses a duplicate key without a path; ConfigReader then finds the key path by one linear walk of `parseDocument` with `uniqueKeys: false` (the text has already passed the reader's limits).
19. **Coverage** also covers U4 (the brief's list left it out); **`verify`** is typecheck, Biome, build, vitest with coverage, check-tree (build before tests, for the binary test).
20. **Tests were written alongside the implementation, not before it.** Only the fixture and expected outputs came first (`a6ae7d1`).

### Extension points (for B2, B4 and B5, built in parallel)
- **B2 (render engine):** add `HelmJob` and `KustomizeJob` to the `RenderJob` union in `src/u3-discovery-expansion/render-job.ts`; plan them in `src/u3-discovery-expansion/render-planner.ts` (replace the `not-in-this-build` returns for `chart`, `helm`, `kustomize`, `Chart.yaml`, kustomization files and `KustomizeRoot`); add their renderers, CommandRunner, Toolchain and ChartCache in `src/u4-render-engine/`, registered in `RENDERERS` (`renderers.ts`); feed rendered output to `buildObjects` (`rendered-set-builder.ts`); fill `toolchain` in `src/u8-output/report-assembler.ts` and the toolchain line and `--version` (`text-renderer.ts`, `src/u9-cli-package/cli-shell.ts`); `timedOut` on `RenderedSet` feeds `counts.timeouts` (`pipeline-runner.ts` passes 0 today).
- **B4 (extractors):** new pure extractors in `src/u5-extractors-gitops/` (credentials, Flux) and `src/u6-extractors-workload/` (secret stores, cert-manager, Vault seal, cloud identity), appended to `GITOPS_EXTRACTORS` / `WORKLOAD_EXTRACTORS` in each folder's `index.ts`; `RenderedObject.credentialUrl` is already kept; new kinds go in `PRINTABLE_KINDS` (`src/u1-graph-model/vocabulary.ts`); the cluster-provided list in `src/u7-graph-analysis/cluster-provided.ts`; Flux sources stop being `not-in-this-build` in `render-planner.ts`.
- **B5 (analysis):** CrankApplier, ReachabilityAnalyzer and PlanBuilder in `src/u7-graph-analysis/`, called from `analyse` in `analysis.ts`, filling `verdicts`, `plan` and `crankEffects` and shrinking `notComputed`; `match:` rules in `createHostMatcher` (`src/u6-extractors-workload/host-matcher.ts`, built in `pipeline-runner.ts`); the report sections already exist (`statuses`, `plan` in `report-model.ts`; the "Not startable" and "Plan" sections in `text-renderer.ts`).
- B3 sets `generatedBy` on generated Applications (`RenderedObject`, `JobBase`) and handles `repos-fetch` resolutions; B6 adds `--format mermaid` and `--explain` in `cli-shell.ts` and the renderers in `src/u8-output/`.

### Decisions taken for the owner
- RBAC objects named `system:...` are skipped as invalid names (deviation 9); the owner may prefer a wider name syntax for those kinds.
- A bare-host `repoURL` is an ambiguity, not an edge (deviation 11).
- `optional: true` references make no edge (deviation 12).
- `targetRevision` is not compared with the checkout; it is a fixed not-modelled item (deviation 16).

### Unverified
- **Hand mutations of the code were not run in this session**: the attempt was refused by the session's permission rules. Every test that pins an honesty rule asserts the exact output, and the falsifiability checks inside the suite (removing the Service, changing the host, a claim word put into crankpath's voice) do fail as they should; a reviewer should still break the code (id syntax, run-status derivation, Secret stripping, bare-host matching, path case, prefix equality, ordering edges, labels, `at least`, quoting) and see tests turn red.
- `filesPerScan` is not derived (B3 step 0): discovery has per-file limits only, no file-count or directory-entry bound; a huge tree is read in full.
- One macOS arm64 machine, Node 22.23.2; Linux not run. No test races the file system (a directory swapped for a symlink during a walk is checked by a realpath comparison only).
- No lookup was made in B1 (`docs/lookups.md` unchanged).

### B1 review fixes (review `reviews/bolt-1-review.md`: 3 Major, 12 Minor, 5 Nit)
Each fix has a regression test in `test/u9-cli-package/review-b1.test.ts` (or the unit test named). Corrected in pass 2 (review n4): the reviewer copied the file onto `9ac9590` and measured 13 of 17 red and 4 passing (the four mutation-survivor tests m8 to m11, which pass on unmutated code by design); my own count before the fixes was 11 of 17, taken while some tests were still being written. `npm run verify` at `ada4372`: 27 files, 343 tests, coverage 93.33% statements, 94.87% lines, check-tree 0 findings.
- **Lead decisions recorded as accepted:** the `not-in-this-build` opacity reason (deviation 1; each later bolt removes its own uses, and the reason must be gone before release) and sync waves as a node attribute (deviation 2).
- **M1 (repo config could shadow a `--repo-alias` root).** Root labels are now disjoint spaces: `.` the scanned root, `alias:N` a `--repo-alias` root, `repos:<path>` a `crankpath.yaml` mapping (`RepoResolution.root` for a `repos:` entry is now `repos:<path>`); `setRoot` refuses a label set twice (a bug); a `read_from` whose first segment is spelled like an alias label is refused (`names a --repo-alias label`); a repo directory spelled like one is shown as `./alias:1/...`, never as an alias. Display paths of `repos:` roots are unchanged (`<read_from>/<path>`).
- **M2 (a repo annotation could erase an object).** Helm test hooks are dropped only when the builder is told the documents are a Helm render (`BuildOptions.dropTestHooks`, false for discovery and plain directories; B2 sets it for helm). Every drop is counted: `runStatus.counts.droppedHooks` in JSON and a `dropped:` line in the text (not a gap: a Helm test is not deployed by a GitOps controller).
- **M3 (a hostile size ended in an uncaught throw).** `main` has a top-level guard: any error crankpath did not expect exits 1 with one fixed line (`error: crankpath stopped on an internal error (a bug, or input beyond what it can hold); no report was written`), no stack and no runtime message. The CLI writes JSON through `writeJson` (an explicit-stack writer emitting chunks of about 1 KB, byte-identical to the earlier layout) and text line by line, so no single string holds the whole report. The rendered-object and edge bounds stay with B2 step 0; the hook is marked in `pipeline-runner.ts` where each RenderedSet is taken in.
- **m1** discovery classifies `.json` manifests as the plain renderer does; **m2** `--out` is refused inside every root read (scanned, aliases, `repos:`); **m3** Service selectors use an index by (namespace, destination, label pair); **m4** objects of a foreign destination are counted (`counts.foreignDestination`), shown in the opacity section and the closing line, and suppress `(nothing opaque, nothing skipped)`; **m5** an exact opaque share rounds up, an `at least` share rounds down; **m6** the exit-2 text shows only the last segment of an absolute path, marked so; **m7** `N files ignored` now reads `N files hold no source document`; **m8** to **m11** tests added: an unlabelled Secret keeps no `url`; waves -2, 0, 5, 5 make only `deployed-by` edges and no cycle; `git.example.org` and `gitea-http.gitea.example.org` match no Service; a recording extractor sees the thin-slice Secret with no data (non-vacuous). **m12** (skipped RBAC and unlisted cluster-scoped kinds) left as recorded owner item: each is already named with its kind.
- **Nits:** n2 the read cache key is length-prefixed; n4 the README no longer calls the JSON the stable contract before the B6 freeze; n1, n3 (scheme dropped by FR2.3; ids carry no API group, so a same-named Service of another group is a named conflict) and n5 recorded here, no code change.
- **Expected-output edits (recorded):** `expected.txt` `5 files ignored` to `5 files hold no source document` (m7); `expected.json` adds `counts.droppedHooks: 0` and `counts.foreignDestination: 0` (M2, m4). Edited by hand, not regenerated.
- **What changed in meaning:** a plain-directory object annotated `helm.sh/hook: test` is now in the graph with its edges (before: silently absent); a `.json` Application is now a source (a JSON-only repo was NOTHING ANALYSED, exit 2, and is now analysed, exit 0); a `repos:` `read_from` beginning with `alias:N` is now an invalid config (exit 1); an internal error now exits 1 with a fixed line instead of a stack; the exact opaque percentage rounds up; foreign-destination objects are now listed as not verified. No cycle, label, edge rule or run-status rule changed.
- **The review file** is committed as delivered except two phrases (a home-directory path and the design workspace's names) that check-tree refuses; the file says so at its end.
- **Still not run here:** source mutations by this builder (refused by the session's permission rules in the first pass); the reviewer's own mutation run covers them, and the four survivors now have the tests above. Whether those four mutants now go red was not re-run by me.

### B1 review pass 2 fixes (review `reviews/bolt-1-review-pass-2.md`: 2 Major, 4 Minor, 4 Nit)
Tests in `test/u9-cli-package/review-b1-pass2.test.ts`, written first: before the fixes, 10 of the first 16 failed (N1 three spellings, the two too-wide hook values, the closed pipe, the truncated `--out`, the stopped selector, the JSON wording, `at least 0%`); the m1 display test passed on the code and now guards the three surviving mutants the reviewer listed. The N2 tests were added with the budget.
- **N1 (decision: share the root).** Two `repos:` entries whose `read_from` is one directory (`sub`, `./sub/`, `sub/.`: config validation already canonicalises them to one path) now share one root and are analysed, as at `9ac9590`. The `setRoot` check remains for labels no input can produce (`alias:N` is numbered by crankpath, a `repos:` label is set only once). No repo-supplied config reaches it.
- **N2 (decision: derive now).** Per-run limits derived from the heap they protect and measured rates (`src/u1-graph-model/run-limits.ts`, `docs/limits.md` "Per-run limits", `scripts/measure-run-limits.mjs`): `runMemory` 1,616,619,776 bytes (2,500,000,000 minus the measured baseline 51,380,224 minus a reserve of 832,000,000 for the one file being parsed), `objectsPerRun` 242,081, `edgesPerRun` 346,542, `nodesPerRun` 588,623 (bounded by the other two). Enforced while building (`src/u9-cli-package/run-budget.ts`): every file held parsed is charged 33 bytes per byte (over: a counted `too-large` refusal, detail `run budget`); every render's objects are charged 6,678 bytes each plus 4,665 bytes per string value (over: the owner and every later owner opaque `limit`); edges over `edgesPerRun` are dropped in canonical order and counted. A hit is a new gap reason `run-limit`, counted in `runLimitFiles`, `runLimitJobs`, `runLimitEdges` and shown in the text. The reviewer's tree (1,500 Applications x 3,000 ConfigMaps) now exits 0 in 5.4 s with a 342 MB peak and `ANALYSED WITH GAPS` (1,476 jobs `limit`); before it aborted out of memory at 4.7 GB. The string-value charge is the worst case (each value an edge with a stub), so on that tree the run used 342 MB of a 1.6 GB budget: pessimistic, stated in `docs/limits.md`. The guard's message no longer claims to cover size. B2 still derives the per-render limits at its step 0.
- **m1** the dropped-hook count, JSON field and text line are tested; the hook match is Helm's exact values `test`, `test-success`, `test-failure`. **m2** a closed standard output (`EPIPE`) ends the run quietly with exit 1 (the report was not delivered whole; documented in `cli.ts`); any other stream error prints the fixed line. **m3** `--out` is opened only after the whole report exists as chunks, so a failure while producing it leaves an earlier file untouched; a write failure part-way says the file may be incomplete; the internal-error line now reads `... (a bug); any report on standard output is incomplete and no --out file was written`. **m4** a selector stops at its second match; the ambiguity lists those two (in id order), not every match.
- **Nits:** n1 a `.json` file that fails to parse reads `not valid JSON or YAML`; n3 a lower-bound share under 1% is shown to one decimal (`at least 0.8%`), or `more than 0%`, never `at least 0%`; n4 corrected above; n4's open question recorded for B5: `foreign-destination-objects` is a not-verified item, not a gap reason, so once B5 removes `not-computed` a run with such objects could read `ANALYSED` with them only in the closing line; B5 decides whether it is a gap. n2 (other `.json` files are now read at discovery) needs no change: hostile cases were checked by the reviewer.
- **Expected-output edit (recorded):** `expected.json` adds `counts.runLimitEdges`, `runLimitFiles`, `runLimitJobs` (all 0). Edited by hand.
- **What changed in meaning:** a large estate now ends in counted `limit` outcomes and the new `run-limit` gap instead of an out-of-memory abort (on the smallest runner a big but honest estate can now show `run limit` gaps); two `repos:` entries for one directory are analysed again (pass 1 made them an internal error); an ambiguous selector's `candidates` now holds the first two matches, not all; a closed pipe exits 1 quietly; the `--out` file is no longer truncated on failure; the hook match is narrower (no effect in B1, which renders no Helm). No cycle, label or edge rule changed.
- **Verified:** `npm run verify` on 2026-11-15: 28 files, 364 tests, coverage 93.47% statements, 95.08% lines, check-tree 0 findings. The review file is committed unchanged (it passes check-tree).
- **Unverified:** the rates were measured on one macOS arm64 machine (resident memory, which overstates the heap); Linux not measured; no run with the 2.5 GB heap cap itself (`--max-old-space-size=2384`) was made.

### B1 review pass 3 fixes (review `reviews/bolt-1-review-pass-3.md`: 1 Major, 5 Minor, 3 Nit)
Tests in `test/u9-cli-package/review-b1-pass3.test.ts`, written first: 13 of 16 failed on `2c54c48`; the three that passed guard code that already behaved and turn the reviewer's surviving mutants red (the measured rates pinned to the measurement output in `docs/limits.md`, the `(nothing opaque, nothing skipped)` guard under an edge-only run limit, the floor for dropped edges).
- **M1 (lead decision).** Any run-limit refusal (files, jobs, edges) sets `floor`, so the opacity line and its share say `at least` and JSON `floor` is true.
- **m1 (lead decision).** The budget is not sticky: an item that does not fit is refused, and later items that fit are still charged and taken in, in canonical order (files in code-point order of their paths, sources in queue order, edges in canonical edge order). Which item is refused depends on that order; `docs/limits.md` and the run-limit line say so (`... ; which items are refused follows the code-point order of file names and sources`). Discovered sources are always held (their files are already read and charged). Cost: a refused job is rendered before its size is known, so the 1,500 x 3,000 tree now takes 18.4 s and 450 MB peak (was 5.4 s, 342 MB), exit 0, `ANALYSED WITH GAPS`, `floor` true, 1,476 jobs `limit`, and an honest one-object Application sorting last is now analysed.
- **m2 (lead decision).** A run where the budget refused anything is never `NOTHING ANALYSED`: with no source counted it is `ANALYSED WITH GAPS`, exit 0, and the text names the refusal (`unreadable ... (run budget reached)` and the `run limit:` line). A budget refusal of a file now reads `run budget reached` (detail `run budget`), not `too large`.
- **m3.** With edges dropped and no cycle left, the cycles line is `Cycles: not determined (N edges not kept over the run limit)`; with cycles left, a line follows: `(N edges not kept over the run limit: other cycles may exist)`.
- **m4.** An ambiguous selector stops at its third match; the unresolved item carries `candidatesTruncated` (JSON) and the text says `candidates: first 2 of more than 2: ...`. Decision: "more than 2", not an exact N, because counting every match is the quadratic work the stop removed. The HostMatch and UnresolvedItem doc comments say what they hold.
- **m5.** `docs/limits.md` now says exactly what is charged (file bytes, objects, string values; numbers, booleans and keys covered only through the file charge) and no longer claims the charge is exact; it holds a note for B2: charge each render's output bytes at `perFileByte` before taking its objects in, and pass `stringLeaves` on the RenderedSet.
- **Nits.** n1: one qualifier only (`(more than 0%)`, never `at least more than 0%`), and no percentage over zero sources. n2: a vitest global setup (`test/setup/build-dist.ts`) builds `dist` when it is older than `src`, so the closed-pipe and binary tests never run a stale build. n3: tool output no longer cites `docs/limits.md` (the package ships only `dist`); the opaque detail is `the run's memory budget was reached`.
- **What changed in meaning:** after a run-limit refusal the counts are a floor (`at least`); later items that fit are now analysed instead of refused; a run whose sources were all refused by the budget is `ANALYSED WITH GAPS` (exit 0), not `NOTHING ANALYSED` (exit 2); `none found` is never printed when edges were dropped; a truncated candidate list says so. The thin-slice expected outputs did not change (no edit).
- **Verified:** `npm run verify` on 2026-11-15: 29 files, 380 tests, coverage 93.54% statements, 95.11% lines, check-tree 0 findings. The review file is committed unchanged.

### Merge of main (B0 squash-merged as `82c9a27`)
- Main merged into `bolt/b1`. Every B0 file came in as an add/add conflict (the squash shares no history with the B0 commits B1 was based on). Files B1 never changed since `5e01fd2` take main's version: the reader, its limits (`lexemesPerFile` and the rest), SafeText, check-tree, census, their tests, `docs/lookups.md`, `docs/census*`, `docs/design/decisions.md`. Files both changed were merged three-way against `5e01fd2`: `README.md`, `package.json` (`bin`, `exports`, the `verify` order), `vitest.config.ts` (coverage list, `globalSetup`), `docs/limits.md` (B0's final text, then the per-run section), and this file (B0's sections first, then B1's).
- B0's newer check-tree rules flagged three things, fixed without changing behaviour: the two home-relative path literals (an environment-variable form and a tilde form) in `test/u2-intake-config/config-reader.test.ts` are built at run time; one phrase of `reviews/bolt-1-review.md` named the local settings folder and is reworded (the file says so).
- **Open conflict for the owner (no behaviour changed; resolved by the lead's decision in the next section):** the per-run budget reserves 832,000,000 bytes for the one file being parsed, the reader's worst one-file peak measured in B0's second review. B0's final `lexemesPerFile` is derived so that one file may use up to the whole 2,500,000,000-byte heap (937 bytes per lexeme), so the reserve no longer covers the worst admitted file: while parsing such a file, a run already holding its full 1.6 GB budget could exceed the heap. Taking B0's final figure as the reserve would leave the run budget at about zero. The values are kept and the stated basis now says this is open (`run-limits.ts`, `docs/limits.md`); the owner decides how the two budgets share the heap (for example, derive `lexemesPerFile` from the heap less the run's budget, or charge the parse transient to the run budget before reading).
- `npm run verify` after the merge, 2026-11-15: 29 files, 495 tests, coverage 94.05% statements, 95.26% lines, check-tree 0 findings.
- **Intermittent, unexplained:** in one `npm run verify` run after the merge, the closed-pipe test (`review-b1-pass2.test.ts`) failed once; it then passed in 3 isolated runs, 5 full-suite runs (3 with coverage) and 2 more `npm run verify` runs. The failure detail was not captured; its assertion now reports the exit code and stderr together, so a recurrence says what happened.

### Run budget and the parse transient (lead decision, after the merge)
- **Decision (option 2):** one heap figure is the only budget: `runMemory` = 2,500,000,000 minus the measured run baseline 51,380,224 = 2,448,619,776 bytes (`objectsPerRun` 366,669, `edgesPerRun` 524,891, `nodesPerRun` 891,560). The 832,000,000-byte reserve is dropped. Before a file is parsed, its transient parse cost, in `lexemesPerFile`'s own terms (its lexemes from a pre-scan x 937 bytes, plus its bytes x 3), must fit in what the run has not yet held; if not, it is refused `run budget reached` (counted, a floor) without being parsed. The transient is released after the parse; only the held cost (33 bytes per file byte) stays charged. `lexemesPerFile` stays as B0 derived it.
- **Code:** `countLexemes` (a pre-scan counting as the reader does) and an optional `beforeParse` hook on `readYaml` in `bounded-reader.ts`; `READER_PARSE_COST` in `run-limits.ts` (937 bytes per lexeme and 3 bytes per byte, the constants `lexemesPerFile` is derived from; a test checks `lexemesPerFile` against them, and `limits.ts` is unchanged); `RunBudget.fitsTransient`; `BudgetSpec.parse`; the reserve removed from `run-limits.ts`; `docs/limits.md` updated, with the same rule stated for B2 (a render's output: its transient parse cost checked before parsing, then its held cost charged).
- **Tests** (`review-b1-pass3.test.ts`): a run near its budget refuses a file whose transient does not fit beside what it holds and admits the same file in a fresh run; a second large file is admitted when only held costs accumulate (the transient is released). These were written after the code this time, not before; with the transient check removed the first would fail (the near-budget run would admit the file), which I reasoned from the budget arithmetic and did not run. Earlier budget tests pass a zero parse cost so their meaning is unchanged.
- **What changed in meaning:** the run budget is larger (no reserve: 2.45 GB instead of 1.62 GB, so more files and objects fit before a limit), and a file can now also be refused because its parse would not fit beside what the run already holds.
- **Verified:** `npm run verify` on 2026-11-15: 29 files, 497 tests, coverage 94.03% statements, 95.28% lines, check-tree 0 findings. `limits.ts` and `lexemesPerFile` are unchanged from B0.

## B4 (remaining extractors, FixtureKit v1 and the Vault fixture)

Branch `bolt/b4`, started at the tip of `bolt/b1` (9ac9590).

### Built
- **U5** `credential-extractor.ts` (`needs-credential` from Applications, and ApplicationSets through their git generators, to the Argo CD credential Secret their repoURL uses: `repository` exact, `repo-creds` a `/`-boundary prefix, on RepoIdentity's normal form with the transport agreeing; exact first, then the longest prefix, a tie is `credential-ambiguous`; the url is the plain Secret's kept `url` or a literal `spec.target.template.data.url`, else `credential-url-unresolved`; credentials of a foreign destination are not offered), `flux-extractor.ts` (Kustomization and HelmRelease `dependsOn` as `depends-on`, namespace defaulting to the object's; `sourceRef`, chart `sourceRef`, `chartRef` as `reads-source`; `valuesFrom` and `postBuild.substituteFrom` as `needs-config`/`needs-secret`, `optional: true` no edge; GitRepository, HelmRepository, OCIRepository and Bucket hosts through HostMatcher; their `spec.secretRef`), `argo-extractor.ts` (a repoURL host that matches nothing and can only be outside the cluster is `external:<host>`, deviation 1), `index.ts`.
- **U6** `secret-store-extractor.ts` (`produced-by`, `uses-store` incl. per-entry store references, `creationPolicy` Merge and None; stores: a closed provider list with each provider's server field, auth Secret, ServiceAccount and CA references, ClusterSecretStore references needing a namespace; `unsupported-provider` otherwise), `cert-manager-extractor.ts` (`issued-by`, `produced-by` with the Secret node, `ca`, `vault` and `acme` issuers, `selfSigned`; an external issuer group and other types `unsupported-provider`), `hcl-seal-reader.ts` (the bounded reader: one linear pass, a byte-per-level stack, no recursion, no evaluation; refusals named), `vault-seal-extractor.ts` (the `<fullname>-config` ConfigMap's `extraconfig-from-values.hcl`; the StatefulSet named `<fullname>` that mounts it; `seals-with` to `aws-kms/<region>`, `gcp-kms`, `azure-keyvault`, a transit Service or `vault-transit`), `cloud-identity.ts` (`assumes-identity` to `aws-sts` / `gcp-iam`), `external-host.ts` (which unmatched hosts are externals; the host of a URL field), `references.ts` (evidence, edges to named objects with `invalid-reference` for bad names, produced nodes, a bounded walk of auth blocks), `index.ts`.
- **U1** (minimal, named): eight unresolved reasons in `UNRESOLVED_WHY` (`address-missing`, `credential-ambiguous`, `credential-url-unresolved`, `namespace-unknown`, `region-unresolved`, `seal-unreadable`, `seal-workload-unidentified`, `unsupported-provider`) in `status-model.ts`; `Bucket` in `PRINTABLE_KINDS` (`vocabulary.ts`).
- **U11** FixtureKit v1 `test/helpers/fixture-kit.ts`: `loadFixture` (a fixture's source trees and render jobs read through the real BoundedReader, tree walk and RenderedSetBuilder; refused files and skipped objects reported), `fixtureContext` (the pipeline's extract context), `analyseFixture` (the real extractors, GraphBuilder and analysis), `fixtureConfig` (the real ConfigReader), `withOverlays` / `withEdits` (variants on a temporary copy), `HOSTILE_STRINGS`, `setPath`, `hostileVariants`, `edgeLines`.
- **The Vault fixture** `test/fixtures/vault/`: `gitops/` (the scanned app-of-apps repo: root, platform, vault, platform-secrets, external-secrets Applications and the ClusterSecretStore), `platform/` (the private repo: the credential ExternalSecret, the Vault-PKI ClusterIssuer and its ServiceAccount, Vault's Certificate, the values), `rendered/` (hand-written stand-ins for the vault, platform-secrets and external-secrets renders in the shape that matters, never copied from vault-helm, and `jobs.yaml`), `variants/crank-a` (the `creates:` crank in `gitops/crankpath.yaml`) and `variants/ca-issuer` (Vault's Certificate from a `ca` ClusterIssuer whose CA Secret an ExternalSecret seeds from the platform-secrets Vault). READMEs in each part.
- Tests: `test/u5-extractors-gitops/{credential,flux}-extractor.test.ts`, `test/u6-extractors-workload/{secret-store,cert-manager,vault-seal}-extractor.test.ts`, `hcl-seal-reader.test.ts`, `external-host.test.ts` (with cloud identity and the auth walk), `test/u11-validation-harness/{fixture-kit,vault-fixture}.test.ts`; B1 tests edited for deviation 1 (below).
- `docs/lookups.md`: the B4 rows.

### Verified
- `npm run verify` on 2026-11-15 (Node v22.23.2, macOS arm64), exit 0:
  ```
  Checked 90 files in 64ms. No fixes applied.
   Test Files  35 passed (35)
        Tests  511 passed (511)
  Statements   : 94.66% ( 2589/2735 )
  Branches     : 87.09% ( 1850/2124 )
  Functions    : 97.01% ( 358/369 )
  Lines        : 96.33% ( 2208/2292 )
  check-tree: 147 files read, 0 finding(s)
  ```
- **The Vault fixture, as the tests assert it** (plain tests over `rendered/` with the real extractors, GraphBuilder and CycleFinder; no helm, no network). Two cycles, both `extracted`:
  - cycle A, 3 nodes, 3 edges: nodes `Application/argocd/platform`, `ExternalSecret/argocd/repo-platform`, `Secret/argocd/repo-platform`; edges `Application/argocd/platform needs-credential Secret/argocd/repo-platform`, `ExternalSecret/argocd/repo-platform deployed-by Application/argocd/platform`, `Secret/argocd/repo-platform produced-by ExternalSecret/argocd/repo-platform`.
  - cycle B, 5 nodes, 5 edges: nodes `Certificate/vault/vault-tls`, `ClusterIssuer/vault-pki`, `Secret/vault/vault-tls`, `Service/vault/vault`, `StatefulSet/vault/vault`; edges `Certificate/vault/vault-tls issued-by ClusterIssuer/vault-pki`, `ClusterIssuer/vault-pki depends-on Service/vault/vault`, `Secret/vault/vault-tls produced-by Certificate/vault/vault-tls`, `Service/vault/vault selects StatefulSet/vault/vault`, `StatefulSet/vault/vault needs-secret Secret/vault/vault-tls`.
  - externals, each `coldStart: unspecified`, `servedBy: null`, each an `external-unspecified` item: `external:aws-kms/us-east-1` (both Vault StatefulSets, `seals-with`), `external:aws-sts` (both Vault ServiceAccounts, `assumes-identity`), `external:github.com` (all five Applications, `reads-source`). No other unresolved item, no flagged node, no refused file, no skipped object.
  - These are OD-3's counts with Secrets explicit (A 3, B 5). The sets were written in the test before the first run, from the design's trace; the first run matched them (the one failing assertion on that run was the shape of a parsed crank, a test bug).
  - The seal edge appears for both release names, `vault-config` and `platform-secrets-vault-config` (BR11.9).
  - Mutations in the suite: removing the credential label or templating the url removes cycle A (and lists `credential-url-unresolved`); pointing the issuer at another host removes cycle B and adds that host as an external; un-mounting the ConfigMap drops the main Vault's seal edge and lists `seal-workload-unidentified`; dropping the regions removes both KMS edges and lists two `region-unresolved` (after the review: no region-less external); dropping the IRSA annotations drops `aws-sts`; leaving out ArgoExtractor drops `github.com`. Variant `ca-issuer` leaves only cycle A; variant `crank-a` parses (`creates: Secret/argocd/repo-platform`), cycle A is still found because this build does not apply cranks (`notComputed` holds `cranks`).
- A real run over the repository trees (B1 rendering only), on 2026-11-15: `npm run build && node dist/u9-cli-package/cli.js test/fixtures/vault/gitops --repo-url https://github.com/acme/platform-gitops --repo-alias git@github.com:acme/platform.git=test/fixtures/vault/platform` (exit 0) prints, among its lines:
  ```
  Run status: ANALYSED WITH GAPS
    gaps: 3 sources opaque; 1 unresolved item; node statuses and the restoration plan not computed in this build
  Cycles: 1 uncranked
    cycle c-35505771  label: extracted  nodes: 3  edges: 3
      Application "argocd/platform" needs credential Secret "argocd/repo-platform"  [field: spec.source.repoURL]
      Secret "argocd/repo-platform" produced by ExternalSecret "argocd/repo-platform"  [field: spec.target.name]
  ```
  (the vault, platform-secrets and external-secrets Applications are opaque `not-in-this-build`, so cycle B and the two KMS/STS externals need B2's rendering; the end-to-end golden with real rendering is B7's).
- Hostile input: every extractor's reference fields take each of FixtureKit's hostile strings without an edge to a forged id and with an item; the HCL reader ends in a named refusal on unterminated strings, comments and heredocs, unbalanced brackets, a megabyte of `{`, 200,000 nested blocks and 300,000 open lists, each in under 5 s, and refuses over 1 MiB (by bytes); a seal type carrying a line break prints quoted (`\x0a`) through the whole command with no claim word in crankpath's voice.

### Deviations from the design and why
1. **Unmatched hosts that cannot be in-cluster become external preconditions** (rule as amended by the review, see "Review fixes" below). A host from a named field (Application and ApplicationSet repoURL, Flux source `spec.url`/`spec.endpoint`, store provider server, Vault and ACME issuer server, transit seal address) that matches no Service is `external:<host>` with `coldStart: unspecified` (so `github.com` appears, as the design's fixture expects) only when it cannot be the cluster's own DNS; every other unmatched host is no edge and a `host-unplaced` item. The design names no rule for where `github.com` comes from; this one is general (a Helm chart repository host is an external too). B1 test expectations changed (final state after the review fixes): `test/u5-extractors-gitops/argo-extractor.test.ts` (one case: `github.com/x/y` is an external edge); `test/u9-cli-package/pipeline-runner.test.ts` (app of apps, extractor isolation, `.git` not read: the original nodes and edges, plus a `host-unplaced` item per Application, because `gitea-http.gitea` with no `gitea` namespace may be in-cluster); `test/u9-cli-package/thin-slice.test.ts` (the Service-removed mutation now lists 2 unresolved items, `host-unplaced` for both Applications, instead of 0); `test/u8-output/text-renderer.test.ts` (four wording cases scan a repo at `https://git.example.org/ops/thin-slice` and declare `git.example.org: {cold_start: available}`, so the wording under test is unchanged; the no-edges case uses an in-cluster `.svc` URL). The thin-slice expected outputs are unchanged.
2. **The fixture's charts are git sources on github.com** (`hashicorp/vault-helm` at `v0.34.1`, path `.`; `external-secrets/external-secrets` at `helm-chart-2.9.0`, path `deploy/charts/external-secrets`), so the three externals of AC11.3.1 hold under deviation 1; Helm-repository chart hosts would each be a fourth external. cert-manager, like Argo CD, is installed outside the fixture.
3. **Two Vault releases.** The ClusterSecretStore reads the `platform-secrets` Vault (configured from the public repo only) and is delivered by the root Application, not the platform one; otherwise the store's chain would join A and B into one strongly connected component and A would grow. This also gives the second release name of FR11.4 a role.
4. **Host-matched server edges are `depends-on`** (store and issuer servers): C1 has no dedicated kind; the mockup's "reads Service" is not an edge kind. Flux sources' host edges are `reads-source`.
5. **The mockup's `ExternalSecret "platform/repo-platform"` is `argocd/repo-platform`:** an ExternalSecret writes its Secret in its own namespace.
6. **Credential matching also requires the transport to agree** (ssh and scp-style are one; https; http): RepoIdentity's normal form drops the scheme, and Argo CD does not offer an ssh key to an https URL. Precedence (exact `repository`, then the longest `repo-creds`) and a tie as `credential-ambiguous` are the design's ambiguity rule (OD-14) applied to credentials. ApplicationSet git generators need credentials too (the template's repoURL does not: the generated Applications read it). The credential `type` (git or helm) is stripped with the rest of the Secret and is not compared.
7. **Eight new unresolved reasons in U1** (listed above), and `Bucket` printable. `seal-unreadable` is an unresolved item, not an opaque mark: an opaque mark on a ConfigMap is not a source and would not reach the opacity statement.
8. **Namespaces of references.** A ClusterIssuer's Secrets and ServiceAccounts are in `cert-manager`, cert-manager's default `--cluster-resource-namespace` (a controller flag outside the estate: if the controller runs with another one, the edge points at a `not-defined` stub, or at a same-named object in `cert-manager`; recorded for the owner). A ClusterSecretStore reference without a namespace is `namespace-unknown` and no edge (ESO would use each ExternalSecret's namespace). A SecretStore's and an Issuer's references are in their own namespace.
9. **ExternalSecret `creationPolicy`:** `Merge` keeps `produced-by` but makes no Secret node (the Secret must exist; an undefined one becomes a stub); `None` produces nothing.
10. **Vault seal:** gcpckms is `gcp-kms` without a region (the design's Q2 spelling); after the review, a transit seal with no Service match is `external:<host>` when the host cannot be in-cluster (not Q2's `vault-transit`), else no edge and an item; a region must look like an AWS region name, else no edge and `region-unresolved` (no region-less `external:aws-kms`, OD-14); only `disabled = true` skips a seal, and a non-boolean `disabled` is `seal-unreadable`; other seal types are `unsupported-provider`; a JSON-form configuration (the chart renders a map value as JSON) is refused as `seal-unreadable`, never guessed.
11. **`HCL_VALUE_BYTES` (1 MiB) lives in the reader, not in LimitSet**, to keep U1 edits to vocabulary; its basis is the B0 ConfigMap lookup. The lead may move it into `LIMITS` and `docs/limits.md` at integration. The reader needs no depth limit: its stack is one byte per level and the text is bounded. The auth walk stops at depth 6 (the APIs nest a selector at most four levels down).
12. **Store providers:** a closed list (`akeyless`, `aws`, `azurekv`, `conjur`, `fake`, `gcpsm`, `gitlab`, `kubernetes`, `onepassword`, `vault`, `webhook`) with each one's server field; aws and gcpsm name no server, so the cloud secret service behind them is not an external (not modelled). Auth references are found by key name (`*SecretRef`, `*serviceAccountRef`, `caProvider`), so one walk serves every provider and cert-manager; an ACME solver's webhook `config` keys of that shape are read too.
13. **ACME** `privateKeySecretRef` is no dependency (cert-manager creates the account key).
14. **Flux:** source `spec.secretRef` is read (the fetch credential, Flux's counterpart of the Argo credential; FR5.3 does not list it); `spec.decryption.secretRef` and `kubeConfig` are not. Flux objects stay `not-in-this-build` for rendering (`render-planner.ts` is B2's and was not touched), so in a Flux estate a `sourceRef` to a GitRepository that only a Flux render would produce is a `not-defined` stub until Flux rendering lands.
15. **Cloud identity is its own extractor** (`cloud-identity.ts`), not part of WorkloadRefExtractor; the workload's `runs-as` edge is WorkloadRefExtractor's as before.
16. **FixtureKit** is a test helper (`test/helpers/fixture-kit.ts`), not shipped code.
17. **Tests were written alongside the implementation**; only the fixture tree came first (`b831862`), and the Vault fixture test's expected sets were written before its first run.

### Files touched outside U5, U6, U11 and test/
- `src/u1-graph-model/status-model.ts` (`UNRESOLVED_WHY`, eight words), `src/u1-graph-model/vocabulary.ts` (`Bucket`), `docs/lookups.md` (B4 rows), `BUILD-NOTES.md` (this section). No change to `src/u2-*`, `src/u3-*`, `src/u4-*`, `src/u7-*`, `src/u8-*`, `src/u9-*`, nor to `host-matcher.ts` (called through its existing API). Integration order B2, B4, B5: the U1 lists are the likely textual conflicts; the extractor registration is the two `index.ts` files.

### Decisions taken for the owner
- Unmatched public hosts are externals (deviation 1), including Helm chart repository hosts.
- A ClusterIssuer's references resolve in `cert-manager` (deviation 8).
- Transport must agree for credentials (deviation 6).
- JSON-form Vault configuration is refused, not read (deviation 10).

### Notes for later bolts
- **B5:** externals made by extractors list their `external-unspecified` item with `where: "crankpath.yaml"` (GraphBuilder's B1 wording) though they come from a rendered object; the text "External preconditions: none declared in crankpath.yaml; none extracted in this build." is printed only when there is none, but "in this build" no longer fits. The cluster-provided list (OD-25) is B5's, as the lead moved it. Each ambiguity here is an unresolved item whose subject B5 should make `unverified`.
- **B7:** the end-to-end golden over `gitops/` and `platform/` with real rendering needs the chart repositories fetched (`repos:` fetch entries in a crankpath.yaml, or a change of the three Applications to Helm-repository sources, which would add their hosts as externals under deviation 1) and helm; the hand-written `rendered/` objects are the shape, not the chart's output, so the golden will differ in object count.

### Unverified
- **Hand mutations of the code were not run in this session**: the attempt was refused by the session's permission rules (as in B1). The suite's own falsifiability checks (the fixture mutations above, the look-alike URL table, the hostile-string sweeps) fail as they should when the input is broken; a reviewer should still break the code (the `/` boundary of `repo-creds`, the transport check, the templated-url check, the tie rule, the in-cluster host exclusions, the mount corroboration, the region pattern, the HCL duplicate and depth-0 checks, the ClusterSecretStore namespace rule, `creationPolicy`, the cluster resource namespace, the ACME account key exclusion, `optional: true`) and see tests turn red.
- No real helm render of the fixture; the rendered stand-ins follow the chart's names and keys as research section 5 records them, not a fresh render.
- Flux extraction is tested on hand-written objects only, not on a real Flux estate.
- One macOS arm64 machine, Node 22.23.2; Linux not run.

### Review fixes (bolt-4-review, 2026-11-15)

The independent review (`reviews/bolt-4-review.md`, committed with these fixes; one line of it rewords the design tool's folder names, which check-tree refuses in a tracked file) found 1 Major, 7 Minor, 4 Nit. The lead's decisions were applied. Every fix has a test that was added first and failed on the reviewed code: 32 of the new or changed tests failed before the fix (`npx vitest run test/u5-extractors-gitops test/u6-extractors-workload test/u11-validation-harness`: "32 failed | 270 passed (302)"; the m7 size test took 124,242 ms there and fails its 3,000 ms bound), and all pass after it.

- **M1 (credentials in Argo CD's namespace).** A credential counts only in the namespace of the Application or ApplicationSet that needs it, taken as Argo CD's own namespace (Argo CD reads credentials from its control-plane namespace; Applications in any namespace are not modelled). A labelled Secret, or an ExternalSecret-made one, in a namespace where no Application or ApplicationSet lives makes no edge, cannot tie with the real credential, and is listed once as `credential-outside-argocd` (it may be a misconfiguration). Credentials are indexed by namespace. Tests: a foreign-namespace credential, a namespace squat that used to hide the real one, a credential serving the Applications beside it.
- **m1 (in-cluster names never external).** `external-host.ts`: unmatched hosts that may be in-cluster are no edge and a `host-unplaced` item (a new unresolved reason): one label, IP literals, any name with a `svc` label after its first, names ending `.local` or `.cluster`, and every two-label `<svc>.<ns>` name (`kubernetes.default`, `prometheus.monitoring`, `gitea-http.gitea` with no such namespace), unless its last label is one of a fixed list of public top-level domains (`biz`, `com`, `edu`, `gov`, `info`, `int`, `io`, `mil`, `net`, `org`) that is not also a namespace of the estate. **Superseded in pass 2 by the dated root-zone list (below).** Read strictly, "`<svc>.<ns>` where ns is not an estate namespace is never external" would also make `github.com` a possible Service `github` in namespace `com` and break the Vault fixture's three externals (the Definition of Done); the fixed TLD list reconciles the two, and it is a judgement, not a derivation: a namespace named after one of those ten words, made outside the estate, would be misread as public. A placement helper (`placeHost`) now serves ArgoExtractor, FluxExtractor, the store and issuer servers and the transit seal.
- **m2 (bare names).** A transit seal gives the Vault StatefulSet's namespace as the bare-host namespace. (This pass also gave SecretStores and Issuers their own namespace; the second review showed that wrong and pass 2 reverted it: see below.)
- **m3 (no spread over unbounded arrays).** `Math.max(...)` in credential choice is a loop (300,000 `repo-creds` in 156 ms); the remaining array spreads in B4's code (including FixtureKit's `push(...)`) are `Array.from`, `concat` or loops.
- **m4.** An unlabelled Secret with a `url`, and one labelled `cluster`, are no credential and no item (test added; the label gate was untested).
- **m5 (HCL reader).** A bare word as a value is refused (`bare-identifier`); escapes other than `\"`, `\\`, `\n`, `\t`, `\r` are refused (`bad-escape`), so `\u0075` is no longer read as text; `disabled` only skips a seal for the HCL boolean `true`, and any non-boolean value (`"true"`, `1`, `"false"`, a list) is `seal-unreadable` with no edge.
- **m6.** An awskms seal without a usable region is no edge and `region-unresolved` (no region-less `external:aws-kms`); a transit address with no Service match keeps its host as the external's name (`external:<host>`) when it cannot be in-cluster, else no edge and `host-unplaced`; a transit seal with no address is no edge and `address-missing` (no `vault-transit` node). `gcp-kms` and `azure-keyvault` keep Q2's fixed names. The transit edge's evidence field is now `…seal.transit.address`.
- **m7.** StatefulSets are indexed once by namespace, destination and name (40,000 ConfigMaps with 40,000 StatefulSets in 321 ms).
- **Nits.** n1: a Bucket `spec.endpoint` positive test. n2: the `{{` guard is not dead (a partly templated url such as `https://github.com/acme/{{.repo}}` still normalises, the braces percent-encoded); a test now shows it, and the file header says why. n3: a backslash before a line break is tested. n4: the header says Argo CD takes the first matching `repo-creds` in its own order and crankpath, not modelling that order, takes the most specific and calls a tie ambiguous.

**What changed in meaning:** results now differ from the reviewed commit in these ways, all towards fewer edges and more items:
- Hosts that may be in-cluster (`<svc>.<ns>`, `kubernetes.default` and the like) are `host-unplaced` items instead of externals.
- Bare names in namespaced stores and issuers now resolve to their own namespace's Service: a new edge where there was an ambiguity item.
- Credentials outside Argo CD's namespace no longer make edges or ties.
- The region-less KMS and generic transit nodes are gone.
- Unquoted values, unknown escapes and non-boolean `disabled` make a seal unreadable.

The Vault fixture's results (cycle A 3/3, cycle B 5/5, the three externals, nothing else unresolved) are unchanged.

Outside B4's diff, the review notes that the base branch already tracks the design tool's workspace files (since the initial commit on `main`); B4 adds none. That is for the lead.

`npm run verify` after the fixes, 2026-11-15 (Node v22.23.2), exit 0:
```
Checked 90 files in 113ms. No fixes applied.
 Test Files  35 passed (35)
      Tests  549 passed (549)
Statements   : 94.68% ( 2603/2749 )
Branches     : 87.21% ( 1862/2135 )
Functions    : 96.99% ( 355/366 )
Lines        : 96.31% ( 2221/2306 )
check-tree: 148 files read, 0 finding(s)
```

### Review fixes, pass 2 (bolt-4-review-pass-2, 2026-11-15)

The second review (`reviews/bolt-4-review-pass-2.md`, committed) found 2 Major, 5 Minor, 4 Nit in the first pass's fixes. The lead's decisions were applied, tests first: 23 new or changed tests failed on `b28973b` ("23 failed | 317 passed (340)" over u5, u6, u8 and u11) and pass after the fixes.

- **M1 (Argo CD's namespace from the estate).** `argoNamespace` in `credential-extractor.ts` derives Argo CD's control-plane namespace in this order:
  1. the one namespace where the estate renders Argo CD's install (`argocd-cm`, or a Deployment or StatefulSet whose name ends `argocd-repo-server` or `argocd-application-controller`);
  2. else, when every Application and ApplicationSet sits in one namespace, that one, listed as an assumption (`argocd-namespace-assumed`, subject `Namespace/<ns>`);
  3. else unknown: no credential edge at all, and one `argocd-namespace-unknown` item (subject `argocd-namespace`, candidates the namespaces seen).

  Credentials count only in that namespace, for every Application wherever it sits. Objects of a foreign destination are not read. Items are made only when the estate holds a credential. With no Application at all, the namespace is unknown (n4).
- **M2 (bare hosts of stores and issuers).** These revert to `bareNamespace: null`: the operator's or cert-manager's controller dials the server, from a namespace the estate does not show. Only the transit seal resolves a bare name in the Vault pod's namespace. The two tests that asserted the wrong edge are replaced.
- **m1 (dated root-zone list).** The fixed ten-word list is replaced by the registry's root-zone list (1,436 entries, version line recorded, `docs/lookups.md`), committed as data in `root-zone-tlds.ts`. A two-label name is external only when its last label is a delegated top-level domain and no estate namespace has that name. The override is tested (`github.com` with a `com` namespace is unplaced).
  - **For the lead:** the list is a copy of a public registry file of facts with no stated licence, so it has no licence file or NOTICE line; please confirm that is acceptable.
- **m2.** `disabled = "true"` and `"false"` are read as Vault's seal migration documentation writes them; any other non-boolean value is `seal-unreadable`.
- **m3.** An IPv6 literal host keeps its brackets and is a `host-unplaced` item, as an IPv4 literal is.
- **m4.** `credential-outside-argocd` is listed once per Secret.
- **m5.** Unresolved items carry an optional `value` (repo text: the host of a `host-unplaced` or `host-ambiguous` item). The text report prints it quoted after `host:` on the item's `where:` line, and the JSON adds `value` to every item (null when absent). This touched `src/u1-graph-model/status-model.ts`, `src/u8-output/text-renderer.ts` and `src/u8-output/json-renderer.ts`. The JSON change is additive; the thin-slice golden has no unresolved item and is unchanged.
- **n1.** A bare name with no stated namespace and exactly one same-named Service is `host-unplaced` listing that Service, not a one-candidate ambiguity (a B1 Argo test now expects this).
- **n2.** The reader's header says its refusals hold anywhere in the text.
- **n3.** The root-zone list is tested as data (size, version, label syntax, absent cluster words) and by a table of hosts.

**What changed in meaning (pass 2):**
- `needs-credential` edges now depend on the estate showing Argo CD's namespace. The Vault fixture gains one item, `argocd-namespace-assumed Namespace/argocd`; its cycles and externals are unchanged.
- Bare store and issuer hosts no longer make edges.
- Two-label hosts ending in a delegated top-level domain outside the old ten (`sr.ht`, `charts.dev`) are externals again.
- IPv6 hosts and in-cluster repo hosts are now visible in the report.
- One-candidate "ambiguities" read as unplaced.

`npm run verify` after pass 2, 2026-11-15 (Node v22.23.2), exit 0:
```
Checked 91 files in 67ms. No fixes applied.
 Test Files  35 passed (35)
      Tests  572 passed (572)
Statements   : 94.74% ( 2632/2778 )
Branches     : 87.47% ( 1892/2163 )
Functions    : 97.03% ( 360/371 )
Lines        : 96.35% ( 2247/2332 )
check-tree: 150 files read, 0 finding(s)
```

### Review fixes, pass 3 (bolt-4-review-pass-3, 2026-11-15)

The third review (`reviews/bolt-4-review-pass-3.md`, committed) found 1 Major, 3 Minor and 3 Nit. The lead's decisions are applied, tests first: 14 new or changed tests failed on `314e01a` ("14 failed | 321 passed (335)" over u5, u6 and u11). The foreign-destination test passed there; it pins a skip that already existed. All pass after the fixes.

- **M1 (install objects).**
  - An install object counts only under Argo CD's exact upstream names: the ConfigMap `argocd-cm`, and a Deployment or StatefulSet named `argocd-repo-server`, `argocd-application-controller` or `argocd-server`. The Helm release form `<release>-argocd-...` counts only when the object carries `app.kubernetes.io/part-of: argocd`.
  - The install must be corroborated: every Application and ApplicationSet must sit in the install's namespace. Otherwise the namespace is unknown, with one item and no credential edge.
  - **Decision:** I read "the Applications that need credentials" as all Applications and ApplicationSets. Which ones "need" a credential is itself computed from repo-controlled URLs, so all of them is the stricter reading.
  - How the namespace was found is always listed:
    - `argocd-namespace-derived`: subject `Namespace/<ns>`, candidates the install objects;
    - `argocd-namespace-assumed`: from the Applications' namespace.

  A lone decoy (`evil-argocd-repo-server`, or `argocd-cm` in another namespace) now gives the assumption or the unknown namespace, never a credential edge to the decoy's namespace.
- **m1.** A test shows that an install object rendered for a foreign destination is not read.
- **m2.** `placeUrl` handles every URL-valued server and source field: text that yields no host (unparseable, an IPv6 zone id such as `[fe80::1%25eth0]`) is a `host-unplaced` item quoting the text. A transit seal's address of that kind is `address-missing` quoting the text.
- **m3.** `docs/host-placement.md` states the placement rules, the root-zone rule and its source, and that reserved names such as `x.example`, `x.test`, `x.internal` and `x.localhost` are unplaced. `docs/limits.md` (B0's, read by a test) is unchanged.
  - **The IANA list is a factual data source:** the registry's list of delegated top-level domains, committed lower-cased with its version line, with no stated licence. The lead lists it in `NOTICE` in B9.
- **n1.** The `disabledOf` header says other spellings Vault's boolean parsing accepts ("TRUE", "t", "1") are listed as unreadable, not read.
- **n2.** NOTICE is left to B9, as the lead decided.
- **n3.** No change.

**What changed in meaning (pass 3):**
- A namespace from install objects is used only with Argo CD's exact names (or a prefixed name with the part-of label) and when the Applications agree; otherwise it is unknown.
- Every derived namespace is now an item, where pass 2 printed nothing.
- Unparseable server, source and transit URLs are now items quoting the text, where they were silent.

The Vault fixture's results are unchanged: cycles A and B, the three externals, and the `argocd-namespace-assumed` item.

`npm run verify` after pass 3, 2026-11-15 (Node v22.23.2), exit 0:
```
Checked 91 files in 101ms. No fixes applied.
 Test Files  35 passed (35)
      Tests  583 passed (583)
Statements   : 94.73% ( 2646/2793 )
Branches     : 87.64% ( 1902/2170 )
Functions    : 97.05% ( 362/373 )
Lines        : 96.32% ( 2257/2343 )
check-tree: 152 files read, 0 finding(s)
```

### Merge of main (B0 `82c9a27`, B1 `df1724c`), 2026-11-15
- `main` merged into `bolt/b4` (a merge commit). Both bolts were squash-merged, so git saw add/add conflicts on 53 files. Each was re-merged three-way with the B1 tip `9ac9590` as base: 40 files B4 never touched take main's version; the other 13 merge B4's changes onto main's (8 cleanly).
- Five files had real conflicts, resolved by keeping both sides:
  - `UnresolvedItem` has B1's `candidatesTruncated` (the optional 6th parameter of `unresolvedItem`) and B4's `value` (now the optional 7th; B4's four callers pass `false` before it). The JSON renderer emits both. The text renderer prints B1's truncated-candidates lead and B4's `host:`/`value:` label.
  - `docs/lookups.md`: B0's review rows, then B4's.
  - `BUILD-NOTES.md`: B0 and B1 (with their review sections), then B4.
- No B4 behaviour changed in the merge. `npm run verify` after it, exit 0:
  ```
  Checked 102 files in 46ms. No fixes applied.
   Test Files  38 passed (38)
        Tests  754 passed (754)
  Statements   : 95.27% ( 2842/2983 )
  Branches     : 88.53% ( 2054/2320 )
  Functions    : 97.15% ( 376/387 )
  Lines        : 96.57% ( 2427/2513 )
  check-tree: 169 files read, 0 finding(s)
  ```

## B5 (analysis completion: cranks, reachability, statuses and the plan)

Built on `bolt/b1` (9ac9590) on 2026-11-15, on synthetic graphs and copies of the thin slice; the Vault-fixture part of the definition of done waits for B4 (see "Not done yet").

### Built
- **Declared facts (US2.3, C2).** `match:` entries in HostMatcher (`createHostMatching`): tried first, in file order, the first whose pattern matches wins (before any Service); `*` is one or more characters inside one DNS label, compared case-insensitively by a small dynamic-programming matcher (never a regular expression built from the pattern); the node is a node id as written or `external:<name>`; the match carries `source: "declared"` and the entry's key path, and entries that matched no host are listed (`unusedMatches`). `served_by` joins the external to the node serving it by a declared `depends-on` edge, so a cycle through it is never `extracted`. Externals named by a crank reroute, or by an edge no `external:` entry states, are nodes with an unspecified cold start and an `external-unspecified` unresolved item (never available). ConfigReader refuses an external with both `cold_start` and `served_by`.
- **Cluster-provided list (OD-25, BR7.19).** `src/u7-graph-analysis/cluster-provided.ts`, dated 2026-11-15 (lookups in `docs/lookups.md`): the four initial namespaces, `Service/default/kubernetes`, ClusterRoles `cluster-admin`, `admin`, `edit`, `view`, ClusterRoleBinding `cluster-admin`, PriorityClasses `system-cluster-critical` and `system-node-critical`, and in every namespace the `default` ServiceAccount and the `kube-root-ca.crt` ConfigMap. A reference to one is a stub flagged `cluster-provided` (not `not-defined`), with no unresolved item; it is startable and named in the plan's assumptions.
- **CrankApplier** (`crank-applier.ts`, BR7.7 to BR7.9): `creates` removes every outgoing edge of each created node (FR7.4: the crank satisfies the node's own dependencies); `render:<path>` matches nodes whose origin file is the path or lies under it as a directory, in the scanned root only (an `alias:N/` origin never matches); `reroutes` removes the node's `reads-source` edges to in-estate nodes and adds one `rerouted` edge, source `declared`, to the external. Targets that match nothing are `crank-target-unmatched`; a crank none of whose targets matches is `crank-unused` (both unresolved items). A crank cannot create an external.
- **Cycle relabelling** (`relabelAfterCranks` in `cycle-finder.ts`, BR7.10, BR7.11, US7.4): components are found again on the crank-applied graph. A cycle none of whose nodes is still on a cycle is `cranked` (`crankedBy`, `labelBeforeCranks`); one a crank touched but did not break keeps its label and names `residual`, `residualLabel` and `touchedBy`; a cycle that exists only once cranks are applied (a reroute to an external `served_by` an in-estate node) is reported `declared (unverified)` with `introducedBy`.
- **ReachabilityAnalyzer** (`reachability.ts`, BR7.12 to BR7.14, BR7.19): one pass over the Tarjan components of the crank-applied graph in dependency order. Local causes: on a cycle, external unavailable, external unspecified (blocked); opaque, `not-defined` stub not created by a crank, subject of an unresolved item, the node of a declared edge to nothing, any node when an extractor failed (unverified). A blocker outranks a gap; each node names its nearest root cause (fewest edges, then reason class, then id) and the dependency it comes through (`via`). `startable` is built only through StatusModel's `startable(node, false)` when nothing in the closure is a cause.
- **PlanBuilder** (`plan-builder.ts`, BR7.15 to BR7.18, BR7.20): crank steps first in file order, manual, holding the created nodes; then layers of startable nodes (not externals, not created, not cluster-provided) by earliest start over hard edges plus ordering constraints; within a layer by sync wave then id. Sync waves (per render job; no wave = 0) are encoded with one barrier node per pair of consecutive waves, so the work is linear; ordering-only edges are constraints too. A constraint on a cycle of the combined graph contradicts a hard dependency and is dropped and listed (`conflicts`, structured). Blocked and unverified nodes follow in `listedUnordered` with status, reason and blocker; a start step holding a non-startable node throws (a bug). `assumes`: externals declared available, matched cranks, cluster-provided objects referenced, the fixed not-modelled list; `disclaimer` is the fixed order-not-schedule text.
- **analyse** (C9) composes them and returns the final unresolved list (the graph's, less `not-defined` items for stubs a crank creates, plus crank items); `notComputed` is now always empty, so a run with no gap can be `ANALYSED`.
- **Report and text (M1, M2).** Report: `statuses` (NodeVerdict), `statusCounts`, `notStartable` groups, `plan`, `cranks` (effects), `unusedMatches`; the closing line's items gain `unverified-nodes`, `externals-declared`, `cranks-documented`, `match-entries`, `match-unused`, `cluster-provided` (`cranks-not-applied` and `match-not-used` are gone). Text: "Not startable from a cold start" with a count line and one group per named blocker (each node with `via`); externals; unused match entries; the plan with crank steps (`by`, `ref`, creates, reroutes), start steps with waves, dropped constraints, the not-ordered count and the "Assumed, not verified by crankpath" line; `Not modelled (4 items)`. JSON adds the same fields (statuses with `reason` and `via`, `statusCounts`, `cranks`, `unusedMatches`, cycle `labelBeforeCranks`, `residualLabel`, `touchedBy`, `introducedBy`, plan `assumes.clusterProvided`, steps `crank` and `ref`, structured `conflicts`, `listedUnordered` with status and blockers).

### Verified
- `npm run verify` on 2026-11-15 (Node v22.23.2, macOS arm64), exit 0:
  ```
  Checked 83 files in 65ms. No fixes applied.
   Test Files  34 passed (34)
        Tests  398 passed (398)
  Statements   : 94.18% ( 2446/2597 )
  Branches     : 85.48% ( 1631/1908 )
  Functions    : 96.89% ( 406/419 )
  Lines        : 95.78% ( 2043/2133 )
  check-tree: 111 files read, 0 finding(s)
  ```
- The expected thin-slice text and JSON were written by hand first (`bfdbae9`) and the first real run matched both byte for byte; no expected file was edited after a run. Run on 2026-11-15, `npm run build && node dist/u9-cli-package/cli.js test/fixtures/thin-slice/repo --repo-url http://gitea-http.gitea:3000/ops/thin-slice` (exit 0, `cmp` equal to `expected.txt`; the JSON form also `cmp` equal under `LANG=de_DE.UTF-8 LC_ALL=de_DE.UTF-8`); the sections after the cycles read:
  ```
  Not startable from a cold start: 6 of 6 nodes (6 blocked, 0 unverified); 0 startable
    blocked by cycle c-d8197e7d: 6 nodes
      Application "argocd/gitea"
      Application "argocd/notes"  via Service "gitea/gitea-http"
      ConfigMap "gitea/gitea-config"
      Deployment "gitea/gitea"
      Secret "gitea/gitea-admin"
      Service "gitea/gitea-http"
    unresolved items: 0

  External preconditions: none declared in crankpath.yaml and none extracted from what was read.

  Plan (an order, not a schedule; cold-load pickup is not modelled): no steps, because no node is startable; the 6 nodes not startable are listed above.
    Assumed, not verified by crankpath: 0 externals declared available; 0 cranks (documented); 0 objects every cluster provides; and the 4 not-modelled items below. Every start step is relative to these and to the edges read.

  Not verified: 1 source opaque; 2 objects skipped; 1 cycle uncranked. Declared edges: 0 (unverified when present).
  Not modelled (4 items): a running Argo CD or Flux controller is assumed; dependencies only visible at runtime are not seen; the content of opaque nodes is not seen; the revision each Application names is taken to be the files as read.
  ```
  The status line is now `Run status: ANALYSED WITH GAPS` with `gaps: 1 source opaque; 2 objects skipped` (no "not computed").
- Tests, all in `npm run verify`: a test per rule BR7.7 to BR7.20 on synthetic graphs (`test/u7-graph-analysis/crank-applier`, `crank-labels`, `reachability`, `plan-builder`, `cluster-provided`, `graph-builder`); a brute-force closure property over 300 random graphs (status equals blocked/unverified/startable as the closure says, never startable over a gap); a plan property over 200 random graphs (no start step holds a non-startable node; every hard dependency starts earlier); 100,000-node chain, ring (and the ring cranked), dense acyclic (about 1,000,000 edges), 50,000 small cycles, and one job with two waves of 50,000 objects (1.6 s, 2.6 s, 5.2 s, 2.2 s, 0.9 s on this machine); determinism under reversed input order; end to end on thin-slice copies (`test/u9-cli-package/declared-facts.test.ts`): a crank that breaks the cycle, a reroute blocked by its UNRESOLVED external and freed once it is declared available, an unused crank leaving the cycle uncranked, a `render:` path outside the root refused (exit 1, key path quoted), a match entry making the cycle `declared (unverified)` with an unused entry listed, a hostile crank `by` quoted with visible codes and no claim word in crankpath's voice; text sections from synthetic reports (`test/u8-output/statuses-and-plan-text.test.ts`).
- **Hand mutations, run 2026-11-15 and reverted** (each turned tests red): unspecified external not blocking (4 red); a gap outranking a blocker (2); opacity ignored (4); "touched means cranked" (1); unverified nodes admitted to the plan (9); `render:` prefix without a directory boundary (1); `render:` matching an `alias:N/` origin (1); a contradicted wave kept (2); a match edge marked extracted (4); the `served_by` edge marked extracted (1); a crank-created stub kept as unresolved (1).

### Deviations from the design and why
1. **A crank's `creates` removes all of the node's outgoing edges**, as FR7.4 says ("the crank is taken to satisfy that node's own dependencies"); BR7.7 names only `deployed-by`. With `deployed-by` alone, cycle A of the Vault shape (Application needs Secret, Secret produced by ExternalSecret, ExternalSecret deployed by Application) would never be cranked by creating the Secret.
2. **`render:<path>`** matches a node whose origin file equals the path or lies under it as a directory (BR7.7 says "equals"; plain objects carry file paths, and the research's `render:system/argocd` names a directory). Objects from a `--repo-alias` repository (`alias:N/` origin) never match. How B2's Helm and Kustomize objects set `origin.path` decides what a `render:` names for them (integration item).
3. **Blockers name the nearest root cause, one per node, with `via`.** Listing every root cause in the closure is quadratic on hostile graphs (50,000 cycles in a chain); the chain can be followed node by node. A blocker outranks a gap (a node behind a cycle and an opaque node is `blocked`). In the thin slice the opaque `notes` Application is therefore `blocked` (its source Service is on the cycle), not `unverified`.
4. **Statuses of externals.** An unspecified external is itself `blocked` (reason `external-unspecified`), like what needs it (FR7.5, BR7.13), not `unverified` as "subject of an unresolved item" would make it; it is never available and never `external-unavailable`. Externals are not counted in the text's "Not startable" count (M1 lists them under External preconditions); JSON `statuses` holds them.
5. **Every node is unverified when an extractor failed** (its edges were not read), naming `extractor:<name>`; not in the design.
6. **A declared edge to nothing** (AC2.3.2) also makes its existing end `unverified`, naming the missing end.
7. **`cold_start` with `served_by` is a ConfigReader error** ("needs cold_start or served_by, not both"): C2 does not forbid both, and they say two things at once.
8. **Cycles a reroute introduces** are reported (`declared (unverified)`, `introducedBy`); a cycle a crank only shrinks keeps its original label and names its residual on the same entry (`residual`, `residualLabel`, `touchedBy`) rather than as a second cycle. Cranked cycles keep `labelBeforeCranks`.
9. **Plan shape.** Crank steps hold the created nodes only (reroutes are shown from the crank's effect); created nodes, externals and cluster-provided objects are never start steps; `conflicts` are objects (`kind`, `job`, `fromWave`, `toWave`, `from`, `to`) rather than strings; `listedUnordered` adds `status` and `blockers`; steps add `crank` and `ref`; `assumes` adds `clusterProvided`. A node with no sync-wave annotation is wave 0 within its job, as Argo CD treats it; nodes no job rendered have no wave constraint. Within a layer nodes sort by wave across jobs, then id.
10. **Unused match entries are listed, not unresolved items** (AC2.3.4 says "listed as unused"; an unused crank is unresolved because BR7.9 says so). They appear under External preconditions and in the closing line.
11. **Cluster-provided stubs carry a new node flag `cluster-provided`** (instead of `not-defined`), and the closing line and the plan's assumptions count them.
12. **Text (M1, M2) adaptations:** the "Not startable" header gives `N of M nodes (B blocked, U unverified); S startable` and lists every node of each group, one per line with `via`; the plan header carries the disclaimer and a step count (or why there are no steps); a crank is written `crank <n> by: "<by>"`; a wave is `(wave N)` after the node; the "Assumed" line is printed for every plan, steps or none; `Not modelled (4 items):`.
13. **Tests were written alongside the implementation**, except the thin-slice expected text and JSON, which came first (`bfdbae9`).

### Files touched outside U7, U2 (ConfigReader), HostMatcher and U8
- `src/u1-graph-model/extractor.ts`: `HostMatch` gains `source` and `rule`. **Every extractor that calls `matchHost` must set its edge's `source` from `match.source`** (B4's secret-store and cert-manager extractors when they merge; the Argo extractor does now).
- `src/u1-graph-model/graph-model.ts`: node flag `cluster-provided`. `src/u1-graph-model/status-model.ts`: unresolved whys `crank-target-unmatched`, `crank-unused`.
- `src/u5-extractors-gitops/argo-extractor.ts`: the `reads-source` edge takes `match.source`.
- `src/u7-graph-analysis/graph-builder.ts` (B1's): externals from reroutes and edges, `served_by` edges, the `cluster-provided` flag.
- `src/u9-cli-package/pipeline-runner.ts`: `createHostMatching` with `config.matches`, unused entries to the report; `src/u9-cli-package/library.ts`: exports the new types.
- `test/helpers/objects.ts` (match entries reach the test context), new `test/helpers/graphs.ts`; B1 tests updated where B1 asserted "not computed in this build" (`text-renderer`, `graph-builder`, `thin-slice`, `host-matcher`); `docs/lookups.md` (B5 section); the thin-slice expected outputs.

### Decisions taken for the owner
- Precedence: a blocker outranks a gap (deviation 3); the owner may prefer `unverified` to win, or both reasons listed.
- `cold_start` plus `served_by` refused (deviation 7).
- An extractor failure makes every node unverified (deviation 5).
- The cluster-provided list (OD-25) as recorded; the owner may widen it (for example default StorageClass or IngressClass, which not every cluster has, so they are left out).
- `render:.` names every object of the scanned root; it is allowed (documented, not verified), which lets a hostile `crankpath.yaml` crank every cycle. The Action (OD-27) lists cranks a pull request adds.

### Not done yet (lead to schedule)
- **The Vault-fixture part of the definition of done** (the two documented edits give `cranked` and no cycle; three UNRESOLVED externals) waits for B4's fixture and extractors in `main`; after the rebase the plain tests go in `test/u9-cli-package/` beside `declared-facts.test.ts`.
- B4's extractors must pass `match.source` through (above); B2's origin paths decide `render:` for rendered objects.

### Unverified
- One macOS arm64 machine, Node 22.23.2; Linux not run. The 100,000-node timings are this machine's, not a promise (OD-7).
- Flux `dependsOn` as ordering-only edges: the PlanBuilder honours `orderingOnly` edges, but no extractor emits them yet (B4), so the path is tested only on synthetic graphs.
- `render:` on Helm and Kustomize output (B2) and the cluster-provided list against a real estate's references were not exercised.

### Review fixes (reviews/bolt-5-review.md, 3 Major, 6 Minor, 3 Nit; lead decisions of 2026-11-15)
Every fix has a regression test that was run red before the fix (`test/u9-cli-package/review-b5-regressions.test.ts`: 12 of 14 red; `test/u7-graph-analysis/review-b5-regressions.test.ts`: did not load, the `match-limit` reason and owner field missing; the 50,000-wave test below: 41 s before, 0.5 s after), and hand mutations of each fix turned tests red (silent override 6, subject instead of owner 4, no comparison budget 2, cranks not counted as declared facts 1, per-namespace exemption anywhere 3, crediting every crank 2; all reverted).
- **M1, a match entry overriding an extracted resolution.** An entry that names what the Service rules find adds nothing declared: the edge stays `extracted`, no gap. An entry that resolves a host otherwise (to another node, where the rules find nothing, or where they are ambiguous) is an override: the edge is `declared`, and each override is listed per host with the host (quoted), the extracted target and the declared target (text under External preconditions, JSON `matchOverrides`). When any entry overrode a host, the pipeline also builds the graph without the entries and lists every cycle of it the report does not hold, with the entries that overrode a host on it (text after the cycles line, `N cycles not reported because a match entry overrode a host on them`; JSON `hiddenCycles`). On the reviewer's case the thin-slice cycle `c-d8197e7d` is now shown as hidden by `match[0]`.
- **Reliance on declared facts is a gap** (lead decision): a new gap reason `declared-facts` and count `runStatus.counts.declaredFacts` (overriding match entries, declared externals, `served_by` included, declared edges kept in the graph, matched cranks). The run can no longer be `ANALYSED` with any of them; the gap line says `N declared facts relied on (crankpath.yaml, not verified)` and the no-cycle line adds `the result rests on N declared facts from crankpath.yaml`.
- **M2, owners.** `UnresolvedItem` gains `owner` (the node that holds what is unresolved; it defaults to the subject when the subject is a node id). `invalid-reference` now names the object with the dropped reference; `declared-edge-endpoint-missing` names the end that exists. Reachability makes the owner unverified (the previous special path for declared edges is gone). Run-level items with no node of their own: `crank-unused`, `crank-target-unmatched` (owner null, no node) and `extractor-failed`, `match-limit` (every node unverified). A table test covers every reason in `UNRESOLVED_WHY`. The text prints `owner:` when it differs from the subject; JSON `unresolved[].owner`.
- **M3, hostile declared-fact counts.** Indexed throughout: declared externals in a map; `render:` targets resolved through the scanned root's nodes sorted by origin path (a binary search per target) with a "next not yet created" pointer, so each node is visited once however many targets name it; a node belongs to the first crank that creates it (later cranks report `alreadyCreated`); literal match entries looked up by host, wildcard entries grouped by label count and compared from the right, once per distinct host; sync waves bucketed per job (a 50,000-wave job took 41 s through a per-wave filter, found while fixing this). Two derived limits (`docs/limits.md`, `src/u1-graph-model/limits.ts`), both from the same basis as `expandedNodesPerDocument` (1,572,864): `declaredEntries` (ConfigReader counts every entry and refuses the file by name) and `hostPatternComparisons` (a spent budget is a counted `match-limit` item that leaves every node unverified). Measured at 100,000 nodes: 1,000 `render:` cranks then one crank of 10,000 targets 2.8 s (reviewer: 25 s and 280 s), 50,000 externals with 100,000 declared edges 0.6 s (39 s), 20,000 wildcard entries against 2,000 hosts 0.6 s with the budget spent (25 s); the whole budget at the worst label shape 0.6 s.
- **m1** crank credit: `crankedBy`, `touchedBy` and `introducedBy` name only the cranks that removed (or added) an edge of the cycle itself. **m2** the closing line counts matched cranks (`cranks-documented`) and match entries relied on (`match-entries-relied`, replacing `match-entries`), from the analysis. **m3** `plan.assumes` adds `servedBy` and `matchEntries`; the Assumed line names externals served by an in-estate node and match entries. **m4** a blocked-by group names the cycle's label (`blocked by cycle c-... (extracted)`, or `..., introduced by a reroute`). **m5** the per-namespace exemption (`default` ServiceAccount, `kube-root-ca.crt`) holds only in the four initial namespaces or a namespace the estate defines with a `Namespace` object. **m6** (Flux `dependsOn` end to end) waits for B4. **n1** a dropped constraint's line now says it lies on a cycle with hard dependencies and that it or another dropped constraint of that cycle runs against one. **n2** not changed in code: C7 needs updating at the schema freeze (B6) for the structured `conflicts`, the extra `listedUnordered` fields, `matchOverrides`, `hiddenCycles`, `unresolved[].owner`, `declaredFacts` and `alreadyCreated`. **n3** none.
- **Expected thin-slice output, edited by hand before the fix** (in this commit): the group header gains `(extracted)`, the Assumed line gains `0 externals served by an in-estate node` and `0 match entries`, and the JSON gains `runStatus.counts.declaredFacts`, `matchOverrides`, `hiddenCycles`, `plan.assumes.servedBy` and `plan.assumes.matchEntries`. The first run after the fix matched both files byte for byte.
- **Files touched outside the bolt's units in this pass:** `src/u1-graph-model/status-model.ts` (owner, `match-limit`, the `declared-facts` gap, `declaredFacts` count), `src/u1-graph-model/limits.ts` and `docs/limits.md` (two limits), `src/u1-graph-model/extractor.ts` (the `MatchOverride` shape), `src/u6-extractors-workload/workload-refs.ts` (the owner of `invalid-reference`), `src/u9-cli-package/pipeline-runner.ts` (the second graph without match entries, the `match-limit` item), `test/u1-graph-model/status-model.test.ts`. **Integration items for B4:** an extractor that files an unresolved item whose subject is not the owning node must pass the owner (`unresolvedItem(subject, why, where, field, candidates, { owner })`; after the merge of main the sixth argument is one options object `{ owner?, candidatesTruncated? }`).

### Merge of main (B0 `82c9a27`, B1 `df1724c`) into `bolt/b5`
- Main's B0 and B1 are squashes that share no history with the B1 commits B5 was built on, so a plain merge was add/add everywhere. Done as: a merge with main's tree, then B5's own diff (`9ac9590..50d2a8e`) re-applied three-way on top; eleven files needed a hand resolution (BUILD-NOTES, `docs/limits.md`, `docs/lookups.md`, `limits.ts`, `status-model.ts`, the JSON and text renderers, the report model and assembler, the pipeline, the thin-slice JSON).
- **`unresolvedItem` (lead decision):** B1's sixth parameter `candidatesTruncated` and B5's `owner` are now one options object, `unresolvedItem(subject, why, where, field, candidates, { owner?, candidatesTruncated? })`; callers updated (`workload-refs.ts` both ways, `graph-builder.ts`, tests).
- Kept from both: B1's `run-limit` gap beside B5's `declared-facts`; B1's edge cap (`edgesPerRun`) applies to the graph without match entries too; `withValue` now comes from `test/support/limits.ts` (B0 moved it out of `src`); `AssemblyInput.unusedMatches` is optional (B1's tests assemble reports without it); B1's `review-b1-pass3` counts fixture gains `declaredFacts: 0`; `explainElementaryCycles` stays not yet derived as main has it. B1's display of a scanned-root directory spelled like an alias label (`./alias:1/...`) means a `render:alias:1/...` target never matches it (fail closed).
- The thin-slice text and JSON after the merge are byte-identical to the committed expected files (no edit). `npm run verify` on 2026-11-15: 39 files, 612 tests, coverage 94.86% statements, 96.26% lines, check-tree 132 files, 0 findings.

### Merge of main (B4 `23e6f95`) into `bolt/b5`, and the Vault-fixture definition of done
- **Merge.** A normal merge (base `df1724c`). Resolved: `unresolvedItem` now takes B4's `value` in the same options object, `{ owner?, candidatesTruncated?, value? }`, and B4's callers are updated (`external-host.ts`, `vault-seal-extractor.ts`); the unresolved-reason list holds both sets; text and JSON print both `value` and `owner`. BUILD-NOTES and `docs/lookups.md` were rebuilt as main's file followed by the B5 section (order B0, B1, B4, B5).
- **B4's host placement and declared match entries.** B4 places hosts through `resolveHost`/`placeHost` (`external-host.ts`), which made every edge `extracted`; it now takes the match's `source`, so an edge a `match:` entry chose is `declared`. B4 also names an external for a host no Service answers; HostMatcher is given that fallback (`externalFallback(estateNamespaces(objects))`, in the pipeline and the test context), so an entry naming the same external is agreement, not an override, and an override's "extracted" target is the external B4 would have named.
- **Owners of B4's unresolved items (review M2 applied to B4).** `invalid-reference` items whose subject is a name now name their owner (`references.ts`, the ExternalSecret target, the Certificate's `secretName`); the owner table test covers all 27 reasons. Decisions on B4's Argo CD namespace items: `argocd-namespace-assumed` and `argocd-namespace-derived` are assumptions about the estate, owned by no node (no status changes; the item is listed, the run has gaps, and `plan.assumes.argocdNamespace` and the Assumed line name the namespace); `argocd-namespace-unknown` (no credential edge was made at all) makes every Application and ApplicationSet unverified.
- **What B4 changes for B5's meaning:** an in-cluster repo host with no Service is now `host-unplaced` (the owner unverified), and a public host is an external whose cold start must be declared; with the lead's rule that relying on declared facts is a gap, a run whose Applications read from a public host can no longer be `ANALYSED`. B1's two text tests that expected `ANALYSED` with a declared-available external now expect the declared-facts gap; B5's "the guard can pass" test uses the thin slice without its hostile files (one extracted cycle, no external, no declared fact), which is `ANALYSED`.
- **Vault-fixture definition of done** (`test/u11-validation-harness/vault-dod.test.ts`, B4's rendered objects through the real extractors, GraphBuilder and the analysis): before the edits, A and B uncranked, nothing startable, the three externals blocked `external-unspecified`; the crank variant, A `cranked` by `crank:1` and plan step 1 the manual crank creating `Secret/argocd/repo-platform` (without the crank file, not cranked); the ca-issuer variant, B gone and the Vault StatefulSet blocked by an external instead; both edits with the three externals declared available (a new overlay `test/fixtures/vault/variants/both-edits/gitops/crankpath.yaml`, applied over ca-issuer), every one of the 30 objects in the plan, one manual step (step 1) then 14 start steps, every hard dependency earlier, nothing unordered, and `assumes` naming the three externals, the crank and `Namespace/argocd`; leaving `aws-sts` unspecified blocks what needs it. B4's own crank-a test now expects `cranked`. Hand mutations (creates removing nothing 5 red, the assumption owned by its Namespace 1, unspecified externals available 5) turned these tests red and were reverted.
- **m6, Flux `dependsOn`** (`test/u7-graph-analysis/flux-depends-on.test.ts`): B4 extracts each entry as a hard `depends-on` edge (not an ordering-only constraint), so the plan starts each Kustomization after what it depends on, and a dependsOn loop is an extracted cycle that blocks its members and what depends on them. The ordering-only path of the PlanBuilder stays exercised on synthetic graphs only (no extractor emits ordering-only edges).
- `npm run verify` on 2026-11-15: 50 files, 896 tests, coverage 95.63% statements, 96.99% lines, check-tree 188 files, 0 findings. The thin-slice expected JSON gained `plan.assumes.argocdNamespace: []` (edited by hand before the run); the text is unchanged.

### Declared facts and the run status (lead decision, after the B4 merge; refines the review-fix decision, matches BR1.10)
- The run status is about how completely the estate was read and analysed. The `declared-facts` gap (`runStatus.counts.declaredFacts`) now counts only declared facts that change the extracted graph: `match:` entries that override a host, and declared edges kept in the graph. The gap line reads `N declared fact(s) change(s) the graph read (crankpath.yaml, not verified)`.
- Externals declared available or unavailable, `served_by`, and matched cranks are plan assumptions (`runStatus.counts.declaredAssumptions`): never a gap by themselves, always listed (the Assumed line, the closing "Not verified" line with counts, each crank `documented, not verified` on its cycle and plan step). The no-cycle line still says `the result rests on N declared facts from crankpath.yaml`, counting both kinds. An unspecified external stays an unresolved item (a gap).
- Tests: B1's two text tests are back to `ANALYSED` with only a declared-available external; `review-b5-regressions.test.ts` shows on the thin slice without its hostile files that a declared-available external or a crank keeps `ANALYSED` and is named, while a declared edge or a match override gives the gap, and that the no-cycle line names declared facts of any kind. Mutating the rule either way (assumptions counted as a gap; overrides not counted) turned 5 and 2 tests red. The thin-slice JSON gains `counts.declaredAssumptions: 0` (edited by hand before the run).
- `npm run verify` on 2026-11-15: 50 files, 898 tests, coverage 95.63% statements, 96.99% lines, check-tree 188 files, 0 findings.

### Second review fixes (reviews/bolt-5-review-pass-2.md: 3 Major, 5 Minor, 3 Nit; lead decisions of 2026-11-15)
Tests written first: `test/u7-graph-analysis/review-b5-pass2.test.ts` and `test/u9-cli-package/review-b5-pass2.test.ts` (11 of 16 red before the fixes; the four producer-owner tests passed because the code was already right, and are now shown able to fail by mutation). Hand mutations, each reverted: the owner removed in each producer (`references.ts` both branches, the Certificate `secretName`, the ExternalSecret target, `workload-refs.ts`: 1 red each), no `credential-unreadable` item (2 red). Charging nothing per candidate consulted survives: every wildcard entry consulted has at least one label left to compare, which is charged, so the mutant is equivalent.
- **M1 (decision).** A credential whose url cannot be read (templated, absent, unparseable) makes each Application and ApplicationSet in Argo CD's namespace that reads a repository other than the scanned one own a new item, `credential-unreadable` (subject and owner the Application, candidates the unreadable credentials, field its first such repoURL): it is unverified, never startable. `credential-outside-argocd` stays ownerless and listed; `argocd-namespace-assumed` stays a listed assumption. B4's credential tests now expect the extra item.
- **M2 (decision).** `repos:` mappings from the scanned repo's own crankpath.yaml that a source was read through count in the `declared-facts` gap; `--repo-alias` mappings are the user's input, listed as an assumption (the Assumed line names `N repositories read through --repo-alias`). Every mapping is listed in the text after the opacity `found:` line (`read through a mapping: repo "<url>"  root: "<root>"  (crankpath.yaml repos:, declared, not verified)`, `(--repo-alias, your input)`, or `not used`) and in JSON `repoMappings` (`url` with userinfo removed, `root`, `from`, `used`); the closing line counts `repositories read through a crankpath.yaml repos: mapping`. The pipeline records which mappings a resolution went through by wrapping RepoIdentity's `resolve`.
- **M3.** The wildcard match budget is now a time bound: `hostPatternComparisons` counts steps actually done (one per entry consulted, a literal label's length, a wildcard label's pattern length times label length), still 1,572,864 on the `expandedNodesPerDocument` basis, unit `steps`. Wildcard entries are indexed by label count and literal suffix, so a host consults only the entries whose suffix it ends in, merged in file order; results are memoised per host. Re-measured (`docs/limits.md`): the reviewer's shape 13.5 s before the fix in the regression test, 9 to 21 ms after; the whole budget at every worst shape found about 10 ms; 300,000 literal-suffix entries against 100,000 hosts 236 ms with nothing spent. The doc's earlier "619 ms" figure is corrected there.
- **m1.** Nodes on a cycle that a match entry hides are unverified, new reason class `match-override`, blocker the hidden cycle's id (the pipeline analyses again with the hidden cycles; JSON `hiddenCycles[].nodeIds`); the group reads `unverified, on cycle c-..., which a match entry hides`. With no reported cycle the headline is `Cycles: none found in the graph read with N match overrides applied; N cycles hidden by the overrides (listed below)`.
- **m2.** One test per producer of an item with a non-node subject (Flux `sourceRef` with a bad and a non-string name, Certificate `secretName`, ExternalSecret target, workload `secretKeyRef`), each red under its mutation.
- **m3.** The objects every cluster provides that the estate relies on are named under External preconditions (`provided by every cluster (assumed, dated list): ...`).
- **m4.** A fifth not-modelled item: `repository credentials not defined in the estate are not seen` (text, JSON, the plan's assumptions).
- **m5.** One host fallback: `ExtractContext.externalOf`, built with the matcher by `hostResolution(objects, services, rules)` (one namespace set, computed once) in the pipeline and in both test contexts; `resolveHost` takes the external from the context only, and `HostPlacement` no longer carries a namespace set, so no extractor can pass another (the five B4 extractors updated).
- **n1** not changed: when an override's extracted side is a placed host the attribution uses its candidate; when the host was unplaced there is nothing to attribute and every overriding entry is named (the safe direction). **n2**: `fixtureContext` now builds the matcher through `hostResolution` with `config.matches`, so fixture tests see match entries as the pipeline does; the Vault tests still use no `match:` entries. **n3**: none.
- **Expected outputs, edited by hand before the fixes:** the thin-slice text says `and the 5 not-modelled items` and lists the fifth item; the JSON adds it to `notModelled` and `plan.assumes.notModelled`, and adds `repoMappings: []`. The first run after the fixes matched both files.
- **Files outside the bolt's units:** `src/u1-graph-model/extractor.ts` (`externalOf`), `status-model.ts` (`credential-unreadable`), `src/u5-extractors-gitops/credential-extractor.ts`, `flux-extractor.ts`, `argo-extractor.ts`, `src/u6-extractors-workload/external-host.ts`, `cert-manager-extractor.ts`, `secret-store-extractor.ts`, `vault-seal-extractor.ts`, `src/u9-cli-package/pipeline-runner.ts`, `test/helpers/fixture-kit.ts`, `test/helpers/objects.ts`, B4's `credential-extractor.test.ts`.
- `npm run verify` on 2026-11-15: 52 files, 915 tests, coverage 95.77% statements, 97.11% lines, check-tree 191 files, 0 findings.

## B6 (output completion: Mermaid, explain, the text report and the schema freeze)

Branch `bolt/b6`, started at `main` 0a2e479 (B0, B1, B4, B5). B2 had not landed on `main` when this section was written, so `main` was not merged.

### Built
- **Expected outputs first** (`5ef3254`, before any renderer): the thin-slice text report wrapped at 80 columns (`expected.txt`), `--explain c-d8197e7d` (`expected-explain.txt`) and `--format mermaid` (`expected-mermaid.md`), written by hand.
- **TextLayout** (`src/u8-output/text-layout.ts`): every logical line wrapped at 80 columns with a hanging indent of four; a break only at a run of spaces outside a quoted value, never right after a label ending in `:` and never right before a quote, so no line (continuation lines included) starts with repo text; a label with a value longer than the width is never cut. Colour (`colourLine`): SGR codes on a few of crankpath's own words (`ANALYSED WITH GAPS`, `NOTHING ANALYSED`, `ANALYSED`, `UNRESOLVED`, `uncranked`, `blocked`, `unverified`), never inside a quoted value, never green; on only for a terminal with `NO_COLOR` unset or empty and no `--no-color`, never for `--out`, JSON or Mermaid; stripping the codes gives the plain bytes.
- **TextRenderer finalisation**: renders logical lines (`textLogicalLines`) laid out by TextLayout (`renderTextLines`); its section builders (scanned line, status lines, cycles section, the Assumed line, the closing lines) are exported and shared with explain and Mermaid; evidence fields are always quoted (`[field: "spec.source.repoURL"]`); one phrase of crankpath's own text no longer uses quotes (`listed under Not startable from a cold start`), so a quote always means repo text.
- **MermaidRenderer** (`src/u8-output/mermaid-renderer.ts`): a Markdown document of three fences: `text` (version, scanned repo, run status and gaps, the cycles line, what is drawn), `mermaid` (`flowchart LR`; one node per graph node, every label one quoted SafeText Mermaid string, crankpath's notes from a closed alphabet inside it; edges thick `==>` and `on cycle c-...` on a cycle, dotted `-.->` and `declared, unverified` when declared, thin `-->` otherwise; opaque nodes `:::opaque` with a dashed border and `opaque: <reason>` in the label; a legend subgraph), `text` (the fallback: every drawn node and every drawn edge as `from -> to  kind  source`, names quoted). The cap: the whole graph is drawn only within `mermaidMaxEdges` (500) and `mermaidMaxTextChars` (50,000); otherwise whole cycle components in cycle-id order while they fit, and the header says how many of how many nodes, edges and components are drawn, why, and where the rest is.
- **ExplainRenderer** (`src/u8-output/explain-renderer.ts`) and **elementary cycles** (`src/u8-output/elementary-cycles.ts`): `--explain [id]`; for a cycle its nodes numbered, every edge with `file:`, `line:`, `field:` and `rendered path:` quoted after fixed labels, its elementary cycles (an iterative Johnson search, stopped after `explainElementaryCycles`, with `stopped at the bound` and a stop line), cranks documented, not verified, the self-management pattern, the nodes it blocks (the Report's group count); for a node where it was read, flags, status, reason, blockers and `via`, opacity, the cycles it is on, its dependencies with evidence, its dependents, its unresolved items, the self-management pattern for a source, its plan step; every explanation ends with the Assumed line and the not-modelled list. No id: every cycle (or the cycles line and how to name a node when there is none).
- **`explainElementaryCycles` derived** (B6 step 0, `src/u1-graph-model/limits.ts`, `docs/limits.md`): 21 = a 24-line VT100 screen less the listing's heading, its stop line and the shell prompt.
- **ControllerSignatures** (`src/u5-extractors-gitops/controller-signatures.ts`, US5.4): a frozen table (Argo CD application controller as StatefulSet and Deployment, repo server, ApplicationSet controller; Flux helm-, kustomize- and source-controller), each a workload kind, `apps/v1` and the upstream install's two labels (`app.kubernetes.io/part-of` and `app.kubernetes.io/component`); `matchControllerSignatures` names the render job's owner of each matching object (objects read by discovery and objects of a foreign destination have no owner). The pipeline puts the matches in `Report.controllerMatches`, read only by --explain; the analysis never sees them. Fixture `test/fixtures/self-managed/` (FixtureKit form): a root Application renders Argo CD's own workloads and the Gitea Application, Gitea serves every repoURL, so the root Application is on a cycle and is named self-managed.
- **CLI**: `--format mermaid`, `--explain [id]`, `--no-color`; `cli.ts` passes whether standard output is a terminal and `NO_COLOR`. The "arrives in a later build" refusals for Mermaid and explain are gone (a URL and `--rev` keep theirs). `library.ts` exports the new renderers and types.
- **Schema freeze**: `schemas/crankpath-report.schema.json` (JSON Schema 2020-12; every object `additionalProperties: false` with every field required, word lists closed, `schemaVersion` const 1, the plan disclaimer const); `test/helpers/json-schema.ts` (a strict hand-written validator that refuses any keyword it does not implement, the field list of a schema, and the breaking-change diff); `test/fixtures/schema/report-fields.golden.json` (schemaVersion 1 and its 256 field paths with their JSON types: the frozen release's field list and the version golden); `docs/json-output.md` (C7's reference: layout, guarantees, compatibility rule, what is not in the JSON, the changes from the design's C7 sketch, and the field table generated from the schema by `scripts/json-output-doc.mjs`).
- **Tests**: `test/u8-output/{text-layout,elementary-cycles,mermaid-renderer,explain-renderer,json-schema,hostile-renderers}.test.ts`, `test/u5-extractors-gitops/controller-signatures.test.ts`, `test/u9-cli-package/b6-cli.test.ts`, goldens added to `thin-slice.test.ts` and `cli-e2e.test.ts`; helpers `test/helpers/{text,reports,mermaid-grammar,json-schema}.ts`.

### Verified
- `npm run verify` on 2026-11-15 (Node v22.23.2, macOS arm64), exit 0:
  ```
  Checked 140 files in 69ms. No fixes applied.
   Test Files  60 passed (60)
        Tests  1029 passed (1029)
  Statements   : 96.12% ( 4172/4340 )
  Branches     : 89.21% ( 2855/3200 )
  Functions    : 97.84% ( 635/649 )
  Lines        : 97.49% ( 3501/3591 )
  check-tree: 222 files read, 0 finding(s)
  ```
- The thin slice through the CLI on 2026-11-15, `npm run build && node dist/u9-cli-package/cli.js test/fixtures/thin-slice/repo --repo-url http://gitea-http.gitea:3000/ops/thin-slice` with no format, with `--explain c-d8197e7d` and with `--format mermaid`, each `diff`-equal to `expected.txt`, `expected-explain.txt` and `expected-mermaid.md` (the tests compare byte for byte in-process and through the built binary). The Mermaid diagram begins:
  ```
  flowchart LR
    n1["Application #34;argocd/gitea#34;"]
    n2["Application #34;argocd/notes#34;, opaque: unreadable-file"]:::opaque
  ```
- **The demo, `--explain` on the Vault cycles**: the Vault fixture has no real render yet (B2, B7), so it was explained from a Report assembled over FixtureKit's hand-written rendered objects (`vaultReport([])` in `test/helpers/reports.ts`, written to a scratch file by a throwaway vitest file on 2026-11-15). Both cycles are explained: `c-35505771` (3 nodes, 3 edges, one elementary cycle `node 1 -> node 3 -> node 2 -> node 1`) and `c-ba4047ac` (5 nodes, 5 edges, one elementary cycle), every edge with its file, field and rendered path, `self-management: none named` for both (Argo CD is installed outside the fixture), and `Argo CD's namespace taken to be Namespace "argocd"` in the Assumed line. `explain-renderer.test.ts` asserts these lines.
- **Expected outputs against the first real run**: `expected.txt` and `expected-mermaid.md` matched the first run byte for byte. `expected-explain.txt` differed in one line: the code said `no source here renders` for a cycle with one source (a bug in the code, fixed; the expected file was right and was not edited). After the property test found the bare evidence field (below), `expected.txt` was edited by hand in two lines (`[field: spec.source.repoURL]` to `[field: "spec.source.repoURL"]`, and the same for `spec.source.path`).
- **The hostile-string property test found a real leak.** With every repo-text slot of the Vault Report filled from a seeded generator, 10 of the first 40 seeds failed the statement-skeleton check: the text renderer printed an evidence field bare when it matched a plain-character pattern, so a field holding repo text such as `../../Secret/argocd/repo-platform` read as crankpath's own text. Fixed by always quoting evidence fields; all 40 seeds pass.
- **Hand mutations, run 2026-11-15 and reverted (each by a scratch script that restores the file from a copy)**: break before a quote allowed (41 red), Mermaid kind label unescaped (3), a forged node id unescaped in Mermaid (27), Johnson without unblocking (3), explain without the field line (3), signatures without the `apps/v1` check (1), explain ignoring Argo CD matches (2), an extra JSON field (42), Mermaid never capping edges (1), `NO_COLOR` ignored (2), evidence fields bare again (10), colour inside quoted values (1). One mutant survived at first: removing the no-break-after-a-colon rule changed no output any test made; a test where that break is the last one that fits was added and turns it red.

### Deviations from the design and why
1. **`--format mermaid` writes a Markdown document**, not bare Mermaid: the header (run status and gaps, the cycles line, what is drawn) and the text fallback must reach the reader (FR8.3, NFR14), and fencing both as `text` keeps a Markdown renderer from reading repo text as markup. The `mermaid` fence holds only the flowchart.
2. **The node cap is the two Mermaid limits** B0 derived (OD-18, `docs/limits.md`): edges and diagram characters, not a node count. Over the cap, whole cycle components are drawn in cycle-id order while they fit; if even those do not fit, the header counts the components left out.
3. **The text fallback lists what is drawn** (it is the diagram's text alternative); over the cap it says the rest is in the JSON.
4. **No Mermaid parser is pinned**: `@mermaid-js/parser` 2.0.1 (MIT) has no flowchart grammar and the `mermaid` package (12.3.0, MIT) is the whole renderer with 23 runtime dependencies and a browser DOM (lookups recorded). The output is checked by a strict structural test of the grammar crankpath emits (`test/helpers/mermaid-grammar.ts`), which accepts only the lines the renderer writes and labels that cannot end early, and is shown able to fail.
5. **Elementary cycles live in U8** (`src/u8-output/elementary-cycles.ts`), not in U7: they are explanation only and never feed a count, label, status or verdict; the Report's cycles stay components (ADR-011). Cycles are node sequences (two edges of different kinds between two nodes are one step).
6. **80 columns**: a break drops the run of spaces it replaces (a test helper, `test/helpers/text.ts`, undoes the layout; a double space at a break reads back as one). A label with a quoted value longer than the width stays on one line (at most the 381-character SafeText bound plus its label), so such a line exceeds 80 columns. Columns are counted in code points; a wide character in a quoted value counts as one.
7. **ASCII**: every character crankpath writes is ASCII (a test checks text, explain and Mermaid outside quoted values); quoted repo text keeps printable non-ASCII characters as SafeText (U1) prints them, so the text and the JSON still show the same value.
8. **`--no-color`** is a new flag (C6 lists only `NO_COLOR`). Colour never marks anything a word does not already say.
9. **`--explain` prints text only**: with an explicit `--format json` or `mermaid` it is a usage error (exit 1); an id that names no cycle and no node is a usage error (exit 1, the id quoted, nothing on standard output); with nothing analysed it prints the M4 text and exits 2.
10. **Signatures match labels, not names**: the kind, `apps/v1`, and both `part-of` and `component` labels (the upstream install and the argo-cd chart set both; Flux's install sets both). A Helm release prefix in the name does not matter. A Flux Kustomization or HelmRelease is named as the owner the same way once Flux rendering produces jobs (no Flux job exists yet).
11. **The schema is strict** (`additionalProperties: false`, every field required) so a field added without a schema update fails the tests; consumers are still told to ignore unknown fields. `unreadable[].outcome` is an open string (several producers); every other word list is closed and equal to the code's list (a test). Adding a word is additive; a word no build produces any more may leave its list without a version change (`not-in-this-build` will).
12. **`notComputed` stays in the JSON**, always empty since B5, documented as such; the text renderer's "not computed in this build" phrases are unreachable and left in place for the field's sake.

### Files touched outside U8, `src/u5-*/controller-signatures*`, the CLI wiring and the schema files
- `src/u1-graph-model/limits.ts`, `docs/limits.md`, `test/u1-graph-model/limits.test.ts`: `explainElementaryCycles` derived; the Mermaid rows say B6 enforces them.
- `src/u9-cli-package/pipeline-runner.ts`: one call, `matchControllerSignatures(objects, [...jobs.values()])`, passed to the assembler. `src/u9-cli-package/library.ts`: exports.
- `README.md` (the status sentence: the JSON contract is frozen; the formats), `docs/lookups.md` (B6 rows).
- Earlier bolts' tests, for the 80-column layout only (no expectation changed in meaning): `test/u6-extractors-workload/vault-seal-extractor.test.ts`, `test/u8-output/statuses-and-plan-text.test.ts`, `test/u8-output/text-renderer.test.ts`, `test/u9-cli-package/{cli,cli-e2e,declared-facts,review-b1,review-b1-pass3,review-b5-pass2,review-b5-regressions,thin-slice}.test.ts`. They read whole statements through `unwrapText`; seven assertions whose statement wraps at a double space compare with whitespace runs collapsed (`flat`); `cli.test.ts` drops Mermaid and explain from the "later build" list; the thin-slice first-word test checks each unwrapped statement and that no output line starts with a quote; `declared-facts.test.ts` follows the two wording changes (quoted field, unquoted section name).

### Decisions taken for the owner
- The Mermaid output is a Markdown document with two text fences (deviation 1) and its fallback lists what is drawn (3).
- Wrapping drops the spaces at a break; an over-long quoted value is never split (6).
- The ASCII rule covers crankpath's own words, not quoted repo text (7).
- Colour words and colours as listed above, never green; `--no-color` added (8).
- `--explain` exit codes and its refusal of JSON and Mermaid (9).
- **The schema is not packed**: `package.json` `files` is unchanged (`dist`, README, CHANGELOG, NOTICE); the lead decides whether `schemas/` ships.
- Unknown words in a word list are additive; consumers treat them as not verified (11).

### Unverified
- **The Mermaid output was not rendered or parsed by Mermaid itself**: installing `mermaid@12.3.0` in the scratch folder worked, but running it was refused by this session's permission rules. The structural test and the 12.3.0 flowchart documentation (entity codes, `==>`, `-.->`, `:::`, `direction`, `classDef`) are the evidence; a reviewer with a Mermaid renderer should paste `expected-mermaid.md` into one.
- The Vault explanation is over FixtureKit's hand-written renders, not a real helm render (B2, B7).
- The signature labels were checked against the upstream install files and the chart's templates, not against a rendered chart.
- Terminal colour was tested through the `isTTY` and `NO_COLOR` inputs, not on a real terminal.
- **Integration with B2 and B3** (not merged): the toolchain line and `--version` (B2) change the first lines of `expected.txt` and their wrapping, and possibly `toolchain` in the schema; any field B2 or B3 adds to the JSON must be added to the schema, the field golden (and, if it removes or retypes one, `schemaVersion`), then `node scripts/json-output-doc.mjs` regenerates the doc table.
- One macOS arm64 machine, Node 22.23.2; Linux not run.

### Review fixes (reviews/bolt-6-review.md: 2 Major, 6 Minor, 3 Nit; lead decisions of 2026-11-15)
Tests written first: `test/u8-output/review-b6.test.ts` and `test/u9-cli-package/review-b6.test.ts` (10 of 11 red on `7484d56`; the one that passed, a match whose owner is off the cycle naming nothing, guards behaviour that was already right), plus new cases in `controller-signatures.test.ts` (2 red: the name check, the new wording) and `safe-text.test.ts`. Each fix was then broken by hand and turned tests red (reverted from a copy): `&`, `'` or `=` dropped from the Mermaid escape set (3, 5, 2 red), the text cap removed from the component loop (1), the name check removed (2), the M4 shape skipped (1), "the whole graph read" on a run with gaps (2), no total line budget (1), no edge-list cap (1), no path cap (1), the node form ignoring whether it is on a cycle (1).
- **M1 (decision).** The self-management note is a labelled observation, never a conclusion: `self-management: pattern: an object this cycle's Application "argocd/root" renders, StatefulSet "argocd/argocd-application-controller", carries the name and labels Argo CD's application controller uses (labels set by the repo, not verified); if this is the controller's own install, a first-install crank breaks it`. "black-start unit", "not a defect" and "deploys itself" are gone. A match now needs the upstream workload name (exactly, or with a Helm release prefix `<release>-<name>`, as B4's install detection accepts) as well as the kind, `apps/v1` and both labels, and its owner must be a source on the cycle. The node form names the pattern only for a node on a cycle. The reviewer's case (the Gitea Deployment given the repo-server labels) now names nothing.
- **M2 (decision).** `--format mermaid` on a NOTHING ANALYSED run prints the M4 text (the text report's lines) in one `text` fence: no cycles line, no "drawn" line, no diagram; exit 2 as before.
- **m6 (decision).** `drawn: the whole graph read (...)` only when the run is ANALYSED; otherwise `drawn: every node and edge of the graph as read (N nodes, E edges); the run has gaps, listed above, so the estate may hold more`. Over the cap the header says `the graph as read (...) is over what Mermaid draws by default`. `expected-mermaid.md` was edited by hand for the thin slice's `drawn:` line before the fix; the first run after it matched.
- **m1.** The node form of "none named" now reads `it renders no object matching ...`, or `it is on no cycle`.
- **m2.** A unit test per Mermaid special character (all 18, each its own entity code) and `&`, `'`, `=`, `&lt;b&gt;&#60;&quot;` and `a='x'&b=1` among the hostile pieces. The forged node id of the property test now always carries a `:` in its kind (with the new pieces the generator drew a valid id, which is not a leak).
- **m3.** `renderMermaid` takes the two Mermaid limits as an optional argument (default `LIMITS`); a test draws ten two-node components under a text cap one character short of the whole diagram and gets nine.
- **m4 and m5 (decision: the output is sized by the derived bounds).** Two new derived limits (`src/u1-graph-model/limits.ts`, `docs/limits.md`): `explainListEntries` 21 (the screenful basis of `explainElementaryCycles`, counted in entries: a cycle's nodes, its edges with evidence, the nodes shown for one elementary cycle, a node's dependencies and dependents; an edge entry takes four lines) and `explainOutputLines` 1,024 (xterm's default `saveLines`, so one explanation stays in a terminal's default scrollback; lookup recorded). A longer list shows its first 21 entries and says how many more are in the JSON output; an elementary cycle longer than 21 nodes ends `... and N more nodes back to node 1`; an every-cycle explanation takes whole cycles while they fit at 80 columns and then says `stopped: the explanation reached its bound of 1,024 lines; K of C cycles are not explained here (--explain <cycle id> explains one)`; the assumptions and the not-modelled list always close it. `explainElementaryCycles`' basis now says the output is sized by it (it counts entries, and the whole output is bounded by `explainOutputLines`). A 20,000-node ring now explains in under 1,024 lines. The thin-slice explanation (5 nodes, 8 edges, 4 paths) is unchanged.
- **n1.** `docs/json-output.md` says the schema-diff test does not flag a word removed from a list. **n2.** `--help` ends with the order of the path and `--explain [id]`. **n3.** No change (extractors record no line numbers; extractor work).
- **The real Mermaid parser.** I did not add `mermaid` as a dev-only check: with jsdom it is well over a hundred packages, not a clean pin, and running it in this session was refused earlier. The structural grammar test stays. The reviewer's run of `mermaid@12.3.0` under jsdom parsed 301 of 301 documents (300 seeded hostile Reports and the Vault document), and its negative control failed to parse; rendering to SVG (and so the display of the entity codes) was not verified by either of us.
- **What changed in meaning:** the self-management note names fewer matches (name and owner on the cycle now required) and never concludes; Mermaid on nothing analysed no longer claims a no-cycle result; Mermaid with gaps no longer says "the whole graph read"; `--explain` output is bounded and says what it left out; the controller names are possessive (`Argo CD's repo server`). No count, label, status, verdict or JSON field changed; the schema and its golden are unchanged.
- **Files outside the bolt's units:** `src/u1-graph-model/limits.ts`, `docs/limits.md` (two limits), `src/u9-cli-package/cli-shell.ts` (help), `docs/lookups.md` (xterm), `test/u1-graph-model/safe-text.test.ts`. The review file is committed unchanged.
- `npm run verify` on 2026-11-15, exit 0:
  ```
  Checked 142 files in 159ms. No fixes applied.
   Test Files  62 passed (62)
        Tests  1041 passed (1041)
  Statements   : 96.04% ( 4222/4396 )
  Branches     : 89.27% ( 2887/3234 )
  Functions    : 97.84% ( 635/649 )
  Lines        : 97.36% ( 3551/3647 )
  check-tree: 225 files read, 0 finding(s)
  ```

### Review fixes, pass 2 (reviews/bolt-6-review-pass-2.md: 1 Major, 5 Minor, 2 Nit; lead decisions of 2026-11-15)
Tests written first: `test/u8-output/review-b6-pass2.test.ts` and `test/u9-cli-package/review-b6-pass2.test.ts` (all 12 new tests red on `eee6fc2`), and the thin-slice `expected-explain.txt` edited by hand before the fix (the evidence list now shows the first 5 of 8 edges; the first run after the fix matched). Each fix was then broken by hand and turned tests red (reverted from a copy): self-management notes uncapped (2 red), the closing lines not reserved (1), paths numbering unlisted nodes (1), the node form hardcoding `Application` (1), the edge cap set to the list cap (4), unresolved items uncapped (1), blockers uncapped (1), cranks uncapped (1), the single-explanation stop pointing to the JSON output (1), no off-cycle note (2), the empty over-cap diagram not saying so (1).
- **M1 (decision).** Every list `--explain` prints goes through one helper, `capped` (`src/u8-output/explain-renderer.ts`): a cycle's nodes and edges, the nodes shown for an elementary cycle, the self-management notes, `cranked by`, `touched by`, `closed by`, a node's blockers, the cycles it is on, its dependencies, dependents and unresolved items (now a list, one `unresolved: <why>  where: "..."` line each, instead of one parenthesis of words). Each shows at most its bound and says how many it left out; it points to the JSON output only for what the JSON carries. The self-management observations are not in the JSON, so the rest of them reads `and N more objects match a controller signature; not printed (the JSON output does not carry these observations)`. An explanation is now a body and its closing lines (self-management, the nodes the cycle blocks, a node's plan step); the closing lines are reserved before the body fills the output bound, so a planted list can no longer cut them. One explanation too large for the bound says `stopped: the explanation reached its bound of N lines; M more lines of this explanation are not printed here`, never "the rest is in the JSON output". The reviewer's two shapes are tests: 300 planted controller-shaped Deployments (21 notes, the rest counted, the cycle's closing line and the close kept) and 800 unresolved items on one Deployment (21 listed, the rest pointed to the JSON, under 200 lines).
- **m1 (decision).** The note says `(name and labels set by the repo, not verified)` and adds `; this object is not on the cycle` when the matching object is not a node of the cycle.
- **m2.** The node form names the owner's own kind (`this Kustomization renders ...`).
- **m3.** An elementary cycle names the nodes the list shows by number and any other by its id; the capped node heading says so (`elementary cycles name the others by id`).
- **m4 (decision: re-derived per entry kind).** A new derived limit `explainEdgeEntries` = (24 - 3) / 4 = 5: one screen less the listing's own lines, divided by the four lines an edge entry prints. It bounds a cycle's evidence list and a node's dependencies; `explainListEntries` (21) now covers only lists of one-line entries, and says so. The thin slice's explanation lists 5 of its 8 edges and points to the JSON for the other 3.
- **m5.** The single-explanation stop has a test (an injected 60-line bound: the body is cut, the closing lines and the close are kept, the stop line counts the lines not printed). `explainLogicalLines`, `renderExplainLines` and `renderExplain` take an optional `{ outputLines }`.
- **n1.** Over the cap with no cycle component that fits, the Mermaid header says `drawn: nothing: ...`. **n2.** `explainOutputLines`' basis says it is counted at 80 columns, and that a wider terminal shows fewer lines, a narrower one more, and a file has no scrollback.
- **What changed in meaning:** `--explain` prints fewer edges per list (5), names unlisted nodes by id, counts and labels everything it leaves out, and never points to the JSON for what the JSON does not hold; a planted repo can no longer remove a cycle's closing lines; the self-management note also disclaims the name and says when the object is off the cycle. No count, label, status, verdict, JSON field, the schema or its golden changed.
- **Files outside the bolt's units:** `src/u1-graph-model/limits.ts` and `docs/limits.md` (`explainEdgeEntries`; the wording of the two explain limits). The review file is committed unchanged. `main` had not moved (still 0a2e479), so there was nothing to merge.
- `npm run verify` on 2026-11-15, exit 0:
  ```
  Checked 144 files in 87ms. No fixes applied.
   Test Files  64 passed (64)
        Tests  1052 passed (1052)
  Statements   : 96.22% ( 4253/4420 )
  Branches     : 89.43% ( 2919/3264 )
  Functions    : 97.84% ( 636/650 )
  Lines        : 97.54% ( 3582/3672 )
  check-tree: 228 files read, 0 finding(s)
  ```

## B2 (render engine: helm and kustomize behind the allowlisted runner)

### Built
- **Step 0, the render limits (OD-5, OD-7)** (`src/u1-graph-model/limits.ts`, `docs/limits.md`, `docs/lookups.md`, `scripts/measure-renders.mjs`): `renderWallClock` 90,000 ms (Argo CD v3.6.1 `ARGOCD_EXEC_TIMEOUT` default), `renderStdoutBytes` 104,857,600 (Argo CD v3.6.1 repo-server `MaxGRPCMessageSize` default 100 MiB), `renderStderrBytes` the same (one `spawnSync` buffer bounds both streams), `renderedObjects` 65,536 (etcd v3.7.3 1.5 MiB request / 24 bytes, the shortest Flux kustomize-controller v1.10.1 inventory entry; Argo CD's shortest `ResourceStatus` gives the smaller 40,329), and a new `renderedDocumentBytes` 3,145,728 (kube-apiserver request body). First real renders of hashicorp/vault-helm 0.34.1 (as `vault` and `platform-secrets`) and five large public charts, fetched read-only into the shared cache outside the repository; nothing of them committed. `filesPerScan` is the only limit still not derived (B3).
- **U4** `command-runner.ts` (closed allowlist keyed by (tool, subcommand), a closed option list per command, `--` before positionals, the `--repo` and OCI references through the URL guard, a refusal is a thrown construction error before any process exists; `spawnSync` with no shell, SIGKILL at the wall clock, byte caps per stream; fixed outcome words `ok`, `exited with an error`, `timed out`, `over cap`, `could not start`; standard error kept only for classification; no retry; the environment built from nothing: PATH, `LANG=C`/`LC_ALL=C`, private HOME, TMPDIR, XDG and HELM homes under the run directory, `HELM_NO_PLUGINS=1`, empty plugin and Docker config directories, registry and repository config files that do not exist, `KUBECONFIG=/dev/null`), `toolchain.ts` (absolute PATH entries only; versions through the runner; tested pair v4.3.2 + v5.8.1), `url-guard.ts` (https or `oci://`, no IP literal, loopback, `.localhost` or `.local` name, no userinfo, no query), `work-dir.ts` (cache root, lazy creation, run directory `tmp/run-<pid>-<hex>` mode 0700, files mode 0600 with `O_EXCL|O_NOFOLLOW`, removal in every outcome), `private-copy.ts` (repo directories copied through the bounded walk and reader; any refusal fails closed), `chart-cache.ts` (`charts/<sha256 of the guarded URL, 32 hex>/<chart>/<version>/`; exact versions read from a trusted cache; one `helm pull`; the pulled chart checked for symlinks, special files, its name and version; 401/403 `private-chart`, 404, 429 and unreachable named as such with "unknown whether the chart exists"), `helm-renderer.ts` (Chart.yaml and Chart.lock pre-read, BR4.20; in-root `file://` dependencies copied; `helm dependency build` only on the copy and only when a dependency is not vendored; values in the controller's order as 0600 files, read and parsed under the reader limits first), `kustomize-renderer.ts` (every kustomization the build would read pre-read, BR4.4/BR4.5; the closure copied; `--load-restrictor LoadRestrictionsRootOnly`, never `--enable-*`), `rendered-output.ts` (split at `---`/`...` lines, one document parsed at a time, document, node and object limits), `flux-substitution.ts`, `render-io.ts`, `renderers.ts` (the dispatch table now `plain`, `helm`, `kustomize`), `rendered-set-builder.ts` (Flux `targetNamespace`; exact test-hook names).
- **U3** `render-job.ts` (HelmJob, KustomizeJob, ChartLocation, HelmValues, FloatingRef; owner nullable for a Kustomize root), `render-planner.ts` (Argo CD single and multi-source: Helm repo charts, charts from repositories, Kustomize, plain; closed `helm` field list; `$values` only under the repo-identity rule), `flux-planner.ts` (Kustomizations and HelmReleases, lookups among the repo's own objects, reference edges kept), `plan-common.ts`, `source-discovery.ts` (a chart's `templates/` and `charts/` are not read as manifests).
- **U9** `pipeline-runner.ts` (toolchain detected once per run; the WorkDir created and cleaned up; the repo-object index for Flux; per-job isolation; timeouts counted; reference edges added; Kustomize roots covered by a render or built on their own), `cli-shell.ts` (`--version` with the detected versions; `--no-network` and `--cache-dir` now act; `--verbose` adds job and command counts), `cli.ts`.
- **U8 (minimal, the B1 extension points)**: toolchain in the report, JSON and text (`testedPair`, `missing`, `unrecognised`), the M5 `tool missing:` line, the untested-version note, `floating` (OD-12), `undeployedKustomizeRoots`, `toolMissing`, and a not-modelled line for helm's cluster-free rendering whenever helm rendered.
- **Fixtures**: `test/fixtures/fake-tools/` (a fake helm and kustomize run as real processes by the real runner; behaviour driven by the files of the chart or directory they get, since the child environment is the allowlist), `test/fixtures/render/repo/` (an in-repo chart of my own with a recorded real-helm output, a Kustomize overlay, Flux objects), `test/fixtures/render/hostile/` (file:// outside the root, alias bomb, `lookup`, symlink created at run time, URL resource, escaping resource).
- **Live lane** `scripts/live-render.mjs`, `npm run verify:live`: PASS, FAIL or SKIPPED per check with its reason; exit 1 on a failure, 2 when anything was skipped, 0 only when everything ran.

### Verified
- `npm run verify` on 2026-11-15 (Node v22.23.2, macOS arm64), exit 0:
  ```
  Checked 96 files in 46ms. No fixes applied.
   Test Files  34 passed (34)
        Tests  525 passed (525)
  Statements   : 91.37% ( 3051/3339 )
  Branches     : 82.28% ( 2285/2777 )
  Functions    : 96.05% ( 414/431 )
  Lines        : 93.1% ( 2647/2843 )
  check-tree: 169 files read, 0 finding(s)
  ```
- **The live-render lane ran on this machine** with helm v4.3.2 and kustomize v5.8.1 installed and the network up: `npm run verify:live` on 2026-11-15 (2026-11-16T01:00Z), on the committed code, exit 0:
  ```
  crankpath live-render lane, node v22.23.2, darwin arm64
    crankpath 0.1.0
    helm: v4.3.2 (tested)
    kustomize: v5.8.1 (tested)
  PASS  toolchain detected  (the tested pair)
    real tools: exit 0, 342 ms, 16 nodes, 19 edges, 1 opaque; recorded: 16 nodes, 19 edges
  PASS  render fixture: real tools match the recorded output  (v4.3.2 and v5.8.1)
  PASS  render fixture: chart, overlay and HelmRelease objects in the graph; test hook dropped; no Secret value
    hostile: exit 0, 298 ms, outside-dep=unsupported-field url-resource=remote-base escape=render-failed linked=unreadable-file bomb=render-failed lookup=none
  PASS  hostile fixture fails closed  (file:// outside the root, URL resource, escaping resource, symlink, alias bomb; lookup renders empty)
    network: exit 0, 986 ms, 26 nodes, 36 edges, 0 opaque; from the cache with --no-network: 327 ms, 26 nodes
  PASS  public chart hashicorp/vault-helm 0.34.1 rendered as vault and platform-secrets
  PASS  public chart again from the chart cache with --no-network: same graph, nothing fetched
  live-render lane: 6 passed, 0 failed, 0 skipped
  ```
  The same script with only node on PATH (`env PATH=<node dir> node scripts/live-render.mjs`, 2026-11-15) printed four SKIPPED lines with their reasons and "0 passed, 0 failed, 4 skipped (a skipped check is not a pass)", exit 2. (An earlier version exited 0 when everything was skipped; it now exits 2, so a skipped lane can never read as a pass.) The one-object opacity of the render fixture is its HelmRelease whose values Secret is not in the repository, by design.
- First timings (OD-7), `node scripts/measure-renders.mjs` (output in `docs/limits.md`): real renders 46 to 335 ms on the idle machine (76 to 882 ms in the recorded run, taken while the test suite ran); `npm run build` and the CLI with `--no-network --cache-dir <outside>` over the five census estates (cached read-only, 2026-11-15): 0.44 s (0 render jobs) to 12.88 s (305 render jobs, 289 `kustomize build` runs) per estate.
- Required tests, all in `npm run verify`: every forbidden subcommand (`install`, `upgrade`, `uninstall`, `rollback`, `dependency update`, `plugin install`, `repo add`, `registry login`, `get`, `kubectl apply|get`, `kustomize edit|create`, `git fetch|clone`, `sh -c`) and forbidden option (`--dry-run=server`, `--kubeconfig`, `--kube-context`, `--kube-apiserver`, `--validate`, `--post-renderer`, `--set`, `--set-file`, `-f`, `--values=`, `--enable-helm`, `--enable-alpha-plugins`, `--enable-exec`, `--network`, `--load-restrictor LoadRestrictionsNone`, `--output`, `--username`, `--pass-credentials`, http and IP repositories) refused before a process exists (`test/u4-render-engine/command-runner.test.ts`); the environment allowlist asserted key by key, and a real child shown to receive none of 13 planted credentials, tokens, a kubeconfig or a proxy; a timeout (SIGKILL, under 15 s for a 1.5 s limit) and both byte caps give `limit`; a hostile chart (`file://` outside the root, http, IP, loopback, credential, `@alias` repositories, Chart.lock checked too, a symlink in the chart) and a hostile kustomization (URL, `host/org/repo//path`, scp, `ssh://`, a missing base, URLs in bases, components, patches, configurations and generators, a symlinked file or kustomization, an escaping entry, `helmCharts`) fail closed with nothing run; a render that emits an alias bomb is `limit` with the document named and the next kept; output over the object limit keeps no object; the cache is not read from inside the scanned tree even when a chart is planted there; `--no-network` fetches nothing; 401/403/404/unreachable are named, never "absent"; values 0600, private, in order, removed; the scanned tree byte-for-byte unchanged and the private directory empty after a run; a failing job changes no other job's edges and its standard error appears nowhere; a timeout is counted and the status line says the output may differ on a rerun; JSON byte-identical across runs and cache locations, with no path of the run; `--verbose` holds no token, Secret value or path.
- **Hand mutations, run 2026-11-15** (`b2-tmp/mutate.py`, outside the repository; each mutation applied, the named test file run, the file restored): restrictor accepting any value, an AWS key passed to children, `file://` outside the root allowed, URLs not seen as remote, timeouts not counted, chart templates read as manifests, values order reversed, absent Flux values not opaque, standard error in a mark: each turned 1 or 2 tests red. The tenth, the chart cache read from inside the scanned tree, was first missed (the test planted nothing); the test now plants a chart where a committed `.crankpath` would put it, and the mutation turns it red.

### Edits to the expected output (thin slice) after the first real run
1. The toolchain line is now detected, not fixed text: `toolchain: helm not found on PATH, kustomize not found on PATH` (the tests run the CLI with a PATH that holds node only, so the line is the same on every machine); the JSON `toolchain` gains `testedPair`, `missing`, `unrecognised`.
2. `targetRevision: main` is a floating revision (OD-12): a `Floating revisions: 1` block after the opacity block, and a top-level JSON `floating` list; also `toolMissing` and `undeployedKustomizeRoots` (empty). Both files were edited by hand to the reviewed diff of the first real run, then compared with the run byte for byte.

### Deviations from the design and why
1. **Synchronous runner, one buffer bound.** The pipeline is synchronous, so the runner uses `spawnSync`, which has one `maxBuffer` for both streams: `renderStderrBytes` equals `renderStdoutBytes` and each stream is checked against its own cap after the call.
2. **No git forms on the allowlist yet.** C12's fixed `git` forms are B3's (their option names are confirmed at B3 step 0); `Tool` includes `git`, the allowlist has no git entry, and a test shows `git fetch`/`git clone` refused.
3. **A closed option list per command**, not only the (tool, subcommand) pair, so `--dry-run=server` and every cluster flag are refused by construction; options only in the separate-value form; `--` always precedes positionals (argument injection through a release name starting with `-` cannot happen); `helm version` takes only `--template {{.Version}}`.
4. **Environment.** The locale is fixed (`C`), not inherited, for byte-identical output; no proxy variable is passed (a proxy URL can carry a credential): owner item. PATH is inherited (shims need it), but tools are resolved to absolute paths from absolute PATH entries only.
5. **Cache root and trust.** Default `.crankpath` in the working directory; a cache root inside the scanned tree must be the tree's own `<root>/.crankpath` (discovery never reads it) and is then not trusted: cached charts are neither read nor written there, because the scanned repo could have committed them; `--cache-dir` outside the tree is trusted. A symlinked cache root is refused. Nothing is created until a helm or kustomize job needs it, so plain-only runs write nothing; an empty `.crankpath/tmp` stays after a run.
6. **Tools read only private copies.** A repo chart (with its in-root `file://` dependencies) and the closure of a kustomization are copied into the run directory first; any entry the walk or reader refuses fails the job closed (chart: `unreadable-file`; kustomize: `render-failed`, BR4.5) with the files named. A kustomization at the repo root copies the whole tree.
7. **BR4.20's pre-read is in the renderer**, not the planner (which reads no content, B1); the effect is the same: nothing runs.
8. **Floating chart ranges are always re-resolved** (`helm pull --version <range>`); under `--no-network` a range is `offline` (crankpath does not resolve ranges against its cache).
9. **Scheme-less chart `repoURL`** (the B0 owner item) is `unsupported-field`: whether Argo CD treats it as OCI depends on repository settings crankpath cannot see.
10. **Argo CD `helm` fields**: `parameters`, `fileParameters`, `kubeVersion`, `apiVersions` (non-empty) and `version` other than v3 are `unsupported-field`; `passCredentials` is accepted (crankpath sends no credential); `skipTests` has no effect (test hooks are always dropped); value files that are URLs, globs or hold build-environment variables are `unsupported-field`; `valuesObject` replaces `values` (Argo CD's `ValuesYAML`). Non-empty `kustomize` options are `unsupported-field`.
11. **Multi-source**: one source that cannot be planned makes the whole Application opaque (no partial jobs); a ref-only source renders nothing.
12. **Kustomize**: a `resources`/`bases`/`components` entry that is not a file or directory of the repo is `remote-base` (kustomize would try to fetch it), whatever it looks like; `helmCharts` is `unsupported-field`. A Kustomize root read by a render takes that render's mark (so a failed render is counted at its owner and at each root it read); a root nothing deploys is built on its own, its objects are not added to the graph (nothing in the repository applies them; a crank `creates: render:<path>` is the way to model a hand-applied root), and it is listed (`undeployedKustomizeRoots`); a `kind: Component` is not built on its own.
13. **Flux**: the objects a Flux source names are looked up among the YAML documents of the scanned repo only (not among rendered objects), by explicit namespace; an object without one is not found. An absent values or substitution source is `cluster-created-values` even when marked `optional` (the cluster may create it). Kustomization `patches`, `images`, `components`, `namePrefix`, `nameSuffix`, `commonMetadata`, and GitRepository `include`, `ignore`, `sparseCheckout`, `recurseSubmodules` are `unsupported-field`; a path without a kustomization file is read as a recursive plain directory (Flux generates a kustomization of every manifest). Post-build substitution works on parsed values (a substituted number stays a string) and refuses forms other than `${name}` and the four default forms. HelmRelease chart `valuesFiles`, `postRenderers`, `chartRef` other than an OCIRepository tag or semver, and a release name over 53 characters (helm-controller would shorten it) are `unsupported-field`; `targetPath` must be a plain dotted path and its value is set as a string.
14. **Reference edges of FR4.2** (`needs-config`/`needs-secret` from a Flux source to its values ConfigMap or Secret) come from the planner and are added by the pipeline as one extraction result, not from a U5 extractor: B4's FluxExtractor (dependsOn, sourceRef) does not cover them. If B4 also extracts them, the graph builder's merge must keep one (lead to check at integration).
15. **Discovery skips a chart's `templates/` and `charts/`** (counted as ignored): templates are not YAML, and B1 counted them as unreadable files.
16. **Rendered documents** are named `render:<jobId>` with renderedPath `render:<jobId>#<n>`.
17. **Test hooks** are the exact names `test`, `test-success`, `test-failure` (BR4.6); B1 matched any name starting with `test`.
18. **Floating revisions** (OD-12) are listed, not a gap: an Argo CD `targetRevision` that is not a 40-hex commit (absent is `HEAD`), a chart version range or `*`, a Flux GitRepository ref other than a commit; for a chart the rendered version is recorded.
19. **`--verbose`** prints job counts by kind and outcome and command counts by tool, subcommand and outcome, never a command line (NFR15.1's "redacted command line"): arguments hold repo text and private paths.
20. **A helm job without a destination namespace** passes no `--namespace` (helm's default); objects without their own namespace are then skipped `no-namespace`, as B1 does for plain sources.
21. **A not-modelled line** for helm's cluster-free rendering (`lookup` empty, default API versions, a controller's bundled helm) is added to the report whenever helm rendered (FR3.8, OD-13).
22. **`not-in-this-build`** is now produced only for ApplicationSets and `repos:` fetch entries (B3).

### Decisions taken for the owner
- **The cost at the limits** (`docs/limits.md`): a hostile chart can make one render take about four minutes and about 3 GB with documents each within every limit; nothing crashed on this machine (heap limit 4,144 MiB), but a smaller heap could run out. A per-run budget of parsed nodes would bound it; no published bound gives one, so it waits for the owner, with `filesPerScan` (B3), which has the same shape.
- No proxy variable reaches helm (deviation 4); the owner may want `HTTPS_PROXY`/`NO_PROXY` passed when they hold no userinfo.
- A cache inside the scanned tree is not trusted (deviation 5); the owner may prefer a user-level default cache.
- Scheme-less OCI chart sources stay opaque (deviation 9).
- Absent `optional` Flux values are opaque (deviation 13).
- Unreferenced Kustomize roots are built but not graphed (deviation 12).

### Files touched outside U3, U4 and U9
`src/u1-graph-model/limits.ts` (the render limits; `renderedDocumentBytes`), `src/u2-intake-config/bounded-reader.ts` (`readBytes`, with `readText` on top of it), `src/u2-intake-config/tree-walk.ts` (`entryKind`), `src/u8-output/report-model.ts`, `report-assembler.ts`, `json-renderer.ts`, `text-renderer.ts` (toolchain, tool missing, floating, undeployed roots, the helm not-modelled line), their tests and the thin-slice tests and expected output, `test/helpers/scan.ts` (`run` takes the tool PATH, default none), `docs/limits.md`, `docs/lookups.md`, `package.json` (`verify:live`). Nothing in U5, U6 or U7.

### Unverified
- Linux, x64 and other Node versions were not run; the fake tools need `#!/usr/bin/env node` on the child PATH.
- Real helm's wording for 401, 403, 404 and rate limits was not observed (the fake helm's messages stand in); the classifier falls back to "helm pull exited with an error".
- helm follows redirects itself (OD-29) and a host name may resolve to a private address (DNS rebinding): stated limits, not tested.
- A run killed with SIGKILL leaves its private directory; no test kills crankpath mid-run.
- Fidelity: Flux post-build substitution against drone/envsubst, Flux's generated kustomization against the recursive plain read, and Argo CD's kustomize build options from `argocd-cm` (invisible to crankpath) were not compared with a live controller.
- No test races the file system while a chart or kustomization is copied.

## B2 review fixes (review `reviews/bolt-2-review.md`: 4 Major, 7 Minor, 2 Nit)

`bolt/b0` (B0 with both review passes) was merged into this branch first (`28dcbbb`), because M4 builds on B0's reader budget; B1's per-run budget (`run-limits.ts`, `stringLeaves`) arrives with the merge of `main`, as the lead said. In the merge, two literals of a B1 test (`test/u2-intake-config/config-reader.test.ts`) are built at run time so B0's new home-relative check-tree rule does not flag them.

### Built
- **M1** `go-keys.ts`: keys fold as Go's encoding/json folds them (per character, to lower then upper case, so `Resources`, `RESOURCES` and `reſources` all match `resources`). A kustomization must hold only the exact field names of kustomize v5.8.1's `Kustomization` (plus `apiVersion`, `kind`): a case variant or an unknown key is `unsupported-field` naming the key, and so is a case variant of `path`, `files`, `envs` or `env` inside `patches`, `patchesJson6902`, `replacements`, `openapi`, `configMapGenerator`, `secretGenerator`. In Chart.yaml, Chart.lock, requirements.yaml and requirements.lock a case variant of a chart, lock or dependency field is `unsupported-field`; `dependencies` that is not a list is refused; every dependency repository is an in-root `file://` directory or passes the URL guard (an absolute `file:///` path is outside the root). YAML anchors and merge keys were already resolved by the reader; the anchor key itself (`x-anchor`) is now an unknown kustomization key.
- **M2** requirements.yaml and requirements.lock are pre-read with Chart.yaml and Chart.lock's rules; a requirements.yaml dependency that is not vendored needs `helm dependency build` as a Chart.yaml one does.
- **M3** `--skip-schema-validation` is always passed; the helm not-modelled line now says values are not checked against `values.schema.json`.
- **M4** a new derived limit `lexemesPerRender` (3,221,822): `lexemesPerFile`'s derivation with the output text's reserve (3 x `renderStdoutBytes`) in place of the file's; every lexeme of every document of one render's output counts (`parseYamlCounted`, an additive export of the reader); a hit is `limit` ("its output is over the parse budget of one render") with no object kept. Measured again: the two node-dense shapes that took 210 to 345 s now stop in 2.2 and 4.5 s (peak 0.7 and 1.5 GB) (`docs/limits.md`).
- **m1** a Secret keeps only `apiVersion`, `kind`, `metadata` (name, namespace, generateName, labels, annotations without last-applied, ownerReferences, finalizers), `type` and `immutable`, spelled exactly: `Data`, `StringData` and any other key are dropped. Every `<Kind>List` with `items` is expanded like `List` (rendered-set builder, discovery, output counting, substitution, the Flux object index).
- **m2** `template-scan.ts`: the actions of every file under a chart's `templates/` are scanned for helm's random and time functions and certificate generators, and for `getHostByName`. A chart using a random function is rendered twice: object names that differ make the source opaque `render-failed` ("its output is not deterministic"), names that agree keep the render and add a floating entry naming the functions. `getHostByName` under `--no-network` is `offline` and helm is not run; with the network it is a floating entry. Archived subcharts are not scanned (stated).
- **m3** the cache root gets a `.gitignore` of `*` when crankpath first uses it; run directories of processes that are gone are removed when a run starts; a child stopped by SIGINT or SIGTERM (a terminal's interrupt reaches the whole process group) ends the run with exit 130 or 143 and "interrupted; no report is written", the private directory removed; a signal to crankpath alone is handled when the running command returns (the pipeline is synchronous), by the same cleanup.
- **m4** pre-reads read crankpath's private copy: each kustomization file is copied and parsed from the copy, a chart directory is copied before its dependency files are parsed; paths are still judged on the original with lstat only. `PrivateTree` replaces `copyDirs`.
- **m5** the redundant Chart.lock symlink branch is gone; the copy refuses the link and names it, and a test asserts that mark.
- **m6** twenty hostile sources in `test/fixtures/render/hostile/` (the reviewer's h1 to h7 and k forms written again without any path of the reviewer's machine), in the fake-tool test and the live lane; the live lane runs them with a loopback listener (a separate process) the hostile URLs point at and a logging `git` first on PATH, and fails if either is reached or the exec function runs.
- **m7** exact versions compare without helm's leading `v` (and cache under the version without it); an OCI pull accepts the one directory helm made, whatever the chart calls itself.
- **n1** a test pins that an over-cap result keeps neither stream.

### Verified
- `npm run verify` on 2026-11-15, exit 0:
  ```
  Checked 105 files in 46ms. No fixes applied.
   Test Files  37 passed (37)
        Tests  654 passed (654)
  Statements   : 91.54% ( 3279/3582 )
  Branches     : 82.7% ( 2434/2943 )
  Functions    : 95.84% ( 438/457 )
  Lines        : 93.36% ( 2843/3045 )
  check-tree: 227 files read, 0 finding(s)
  ```
- `npm run verify:live` on 2026-11-15 (helm v4.3.2, kustomize v5.8.1, network up), exit 0: 6 passed, 0 failed, 0 skipped. Hostile line: every one of the 20 sources as expected (`bomb` and `random` `render-failed`, `exec-generator` `render-failed`, `schema-ref` and `lookup` rendered, `lookup-host` `offline`, the rest refused before any tool), "loopback requests: 0; git calls: 0; exec function ran: no". With `--skip-schema-validation` removed from the code for one run, the same lane printed "loopback requests: 1" and FAIL, so the listener can see a fetch.
- **Seen red before the fix**: M1, M2, M3, m4, m5, m7 (23 tests of `test/u4-render-engine/review-b2-preread.test.ts` failed against the pre-fix code; the anchor cases and n1 passed, as the review found those sound), M4 (3 of `review-b2-parse-budget.test.ts`), m1 (1).
- **Written with the fix, then shown able to fail by mutation** (`b2-tmp/mutate2.py`, outside the repository, each mutation applied, the test file run, restored): m2 ids not compared (1 red), no template scan (3), m3 no `.gitignore` (1), no stale removal (1), interrupt swallowed (2), m1 `SecretList` not expanded (1), M1 kustomize case variants allowed (first green, because the exact-key allowlist also refuses them; the test now also pins the detail, then 6 red), helm dependency case variants allowed (2), requirements.yaml not read (4), M4 lexemes not counted (1), m4 pre-read of the original (1), m7 `v` not normalised (1).

### Decisions (the lead's, and mine where the lead left the choice)
- M1: refuse case variants and unknown kustomization keys rather than lower-case lookups (the lead's preferred form); Chart.yaml's unknown keys stay allowed (helm ignores them), only case variants of its fields are refused.
- m2: render twice only when a template uses one of the functions (cheap), opaque when names differ, a floating entry otherwise; `getHostByName` treated as network.
- M3: always skip schema validation (the trade-off: a chart whose values break its own schema renders here though helm install would refuse it; stated in the not-modelled line).
- n2 (a grandchild holding the pipes past the wall clock) is not fixed: `spawnSync` cannot kill a process group; with remote bases refused before kustomize runs and plugins disabled, neither tool is left a reason to start a grandchild. Stated.

### What changes in meaning
- New outcomes: `unsupported-field` for case-variant or unknown keys in kustomizations and for case variants in chart dependency files; `limit` "over the parse budget of one render"; `render-failed` "not deterministic"; `offline` for `getHostByName` under `--no-network`; exit 130 or 143 on an interrupt.
- New floating entries (field `chart templates`) for charts using random, time or lookup functions; the claim "byte-identical JSON across runs" now holds because charts whose object names vary are opaque, and the floating list names the charts whose content may vary.
- A Secret body keeps fewer fields; `<Kind>List` items are objects now (they were skipped or kept whole).
- The B2 "cost at the limits" owner item is withdrawn: the parse is bounded now (M4).
- `.crankpath` gains a `.gitignore`; stale run directories of dead processes are removed.

## B2 merge of `main` (B0 `82c9a27`, B1 `df1724c`, B4 `23e6f95`)

### How it was merged
`main` holds B0, B1 and (by the time of the merge) B4 as squash commits, which share no history with this branch beyond the design commit, so a direct merge conflicted on every file both sides add. `bolt/b1` (whose tree is `main` at `df1724c`) and then `bolt/b4` (whose tree is `main` at `23e6f95`: `git diff bolt/b4 main` is empty) share history with this branch from `9ac9590`, so they were merged in turn (`650b815`, then the B4 merge, its conflicts resolved file by file against `df1724c` as the base, since B4 and this branch both start from B1's content there), and `main` was then recorded as merged with the `ours` strategy (no content of its own to add). Every file this branch had not changed since B0 or B1 takes `main`'s version; the rest were merged by hand: `limits.ts` (B0's final derivations with the render limits), `render-job.ts` (`notes` with B1's `stringLeaves`), `plain-renderer.ts` (through `buildSet`, which now carries `stringLeaves`), `rendered-set-builder.ts` (B1's test-hook option with B2's Secret, list and namespace changes), `report-assembler.ts`, `text-renderer.ts`, `cli-shell.ts` (B1's top-level guard and streamed output with B2's toolchain, cache flags and interrupt), `cli.ts`, `pipeline-runner.ts` (B1's labels, budget, `.json` wording and edge cap with B2's work directory, runtime, Flux index, reference edges, Kustomize roots and diagnostics), and BUILD-NOTES (B0 and B1 sections first, from `main`, then B2's).

### Built
- **`lexemesPerRender` re-derived** with B0's final figures: (2,500,000,000 - 45 MiB - 3 x `renderStdoutBytes`) / 937 = **2,282,007** (was 3,221,822 with 44 MiB and 664). The output's lexemes are now counted before any document is parsed (B0's `countLexemes`), so output over the budget is refused without a syntax tree.
- **Renders charged to B1's run budget** (the note for B2 in `docs/limits.md`): before a render's output is parsed its transient (lexemes x 937 + bytes x 3) must fit in what the run has not yet held (`RunBudget.fitsRenderTransient`); after the parse its bytes are held at `perFileByte` (`RunBudget.render`); then its objects and their string values are charged as B1 charges them. A refusal at any of the three is a refused job, counted (`runLimitJobs`, which makes the counts a floor), with the owner opaque `limit` ("the run's memory budget was reached") and nothing of the render in the graph. `buildSet` passes `stringLeaves` from `buildObjects`.
- **`dropTestHooks`** is true for Helm renders only (Kustomize, plain and Flux directory renders keep an object annotated as a Helm test, as B1 does for plain sources).
- `assembleReport`'s B2 inputs (toolchain, floating, undeployed roots, helm rendered) are optional with neutral defaults, so a report assembled without a run (B1's tests) needs none.
- One B1 test (`review-b1.test.ts`, the streamed-JSON test) now passes `toolPath: ""`, so the toolchain in the thin slice's expected output holds on every machine.
- **B4's FluxExtractor owns the reference edges** of a Flux source to its values ConfigMaps and Secrets (FR4.2), on every source whether it renders or not; the pipeline no longer adds the planner's own copies (the planner's `references` stay data, asserted by its tests). One difference in meaning: B4 makes no edge for an entry marked `optional: true`, while the planner still makes such a source opaque `cluster-created-values` when the object is not in the repository.

### Verified
- `npm run verify` on 2026-11-15 after both merges, exit 0:
  ```
  Checked 133 files in 56ms. No fixes applied.
   Test Files  50 passed (50)
        Tests  996 passed (996)
  Statements   : 93.04% ( 4189/4502 )
  Branches     : 85.69% ( 3180/3711 )
  Functions    : 96.88% ( 528/545 )
  Lines        : 94.75% ( 3633/3834 )
  check-tree: 292 files read, 0 finding(s)
  ```
- `npm run verify:live` on 2026-11-15 after both merges, exit 0: 6 passed, 0 failed, 0 skipped; the render fixture now gives 18 nodes and 23 edges with the real tools and with the recorded output alike (B4's extractors add edges); all 20 hostile sources as expected, "loopback requests: 0; git calls: 0; exec function ran: no"; vault-helm 0.34.1: 27 nodes, 38 edges, 0 opaque, the same from the cache with `--no-network`.
- `node scripts/measure-renders.mjs ...` rerun (output in `docs/limits.md`): real renders 46 to 254 ms; every synthetic output at the cap ends within about 3 s and 0.56 GB.
- New tests (`test/u9-cli-package/review-b2-run-budget.test.ts`): the budget is asked with the output's lexemes and bytes before the parse and its bytes held after; either refusal is a `limit` with no object; with a run budget of 800,000 bytes the two Helm renders of the render fixture are refused (counted, 2 jobs) and the Kustomize render is kept, and with the derived budget nothing is refused; a Helm-test-annotated object survives a Kustomize render and is dropped from a Helm one.

### What changes in meaning
- A render can now be opaque `limit` "the run's memory budget was reached" (counted in `runLimitJobs`, a floor) when the run's budget cannot hold its parse, its bytes or its objects.
- Output between 2,282,007 and 3,221,822 lexemes, accepted before, is now a `limit`.
- An object annotated as a Helm test is kept in a Kustomize or directory render (it was dropped in B2 before the merge).

## B2 merge of `main` (B5 `0a2e479`)

`main` already had this branch's earlier `ours` merge as an ancestor, so B5 merged directly (`02db6a9`). Conflicts resolved by hand: `pipeline-runner.ts` (B5's repo-alias resolution and used mappings moved into `runWith`, beside B2's work directory and runtime), `text-renderer.ts` (both sides' sections), the thin slice's `expected.json` (both sides' fields); duplicate imports removed. Every other file takes `main`'s version or merged cleanly.

## B2 review fixes, second pass (review `reviews/bolt-2-review-pass-2.md`: 3 Major, 4 Minor, 3 Nit; lead decisions of 2026-11-15)

### Built
- **M1** `kustomize-renderer.ts`: every entry of `resources`, `bases`, `components`, `configurations`, `crds`, `generators`, `transformers`, `validators` and `patchesStrategicMerge` is judged, whatever its YAML form. An entry that is not a plain one-line string (a block or folded scalar, a multi-line quoted string, a map, a number, any control character) is `unsupported-field` "an entry that is not a plain relative path", before kustomize runs; only an inline patch in `patchesStrategicMerge` (YAML text, never fetched) is skipped. New hostile source `kustomize/block-generator` (the review's repro written again).
- **M1, defence in depth** `command-runner.ts`: the child's `PATH` is crankpath's empty private directory (`homes.empty`), not the tool's directory: helm and kustomize are started by absolute path, and neither finds `git` (or anything else) to start. `buildChildEnv` takes the homes only.
- **M2** no signal handler: SIGINT and SIGTERM end crankpath at once (the default action, no exit 130 or 143, no "interrupted" message; `Interrupted` is gone). The stale-run sweep at the next start removes the private directory left under the cache's `tmp/`. Stated in `--help` ("Signals: ...") and in `docs/limits.md`.
- **M3** `template-scan.ts` is removed. Every Helm job is rendered twice with the same arguments: a second render that fails, times out or is refused is reported as such (`... (second render)`, or the timeout) (m2); object ids that differ make the source `render-failed` "its output is not deterministic: object names differ between two renders"; the same ids with other content keep the first render with a floating entry `helm template: content differs between two renders`. The second render's parse transient is asked of the run's budget; its output is not held (`finishOutput(..., { hold: false })`). `getHostByName` is no longer `offline`: the helm not-modelled line says a template may resolve host names even under `--no-network`.
- **m1** `url-guard.ts`: the host is judged as DNS sees it, lower case and punycode (the URL parser's; `oci://` is parsed as `https://`) with trailing dots removed, so `localhost.`, `LOCALHOST.` and `127.0.0.1.` are refused, and helm is given the normalised host. The not-modelled line and `docs/limits.md` (OD-29) state that helm follows a repository's redirects and that a host is checked by name, not by the address it resolves to.
- **m3** `work-dir.ts`: the cache root's `.gitignore` is written only into a directory crankpath creates; an existing directory is left as it is.
- **m3b** each listed survivor now has a test: non-string `repository`, scp-style remote, EPERM treated as alive, `ip6-localhost`, `file://` symlink dependency, run-budget refusal counting (transient, render, objects) and hold, plus the M1 newline path and the single-process signal path (`test/u4-render-engine/review-b2-pass2.test.ts`, `test/u9-cli-package/review-b2-cleanup.test.ts`). The template-scan survivors are moot (scan removed).
- **Fake tools** are generated at run time in a temporary directory (`fakeDir(variant)`, a `#!<node>` wrapper importing `fake-tool.mjs`), so no committed wrapper holds a path of this machine; the committed `test/fixtures/fake-tools/{tested,untested,garbled}/` wrappers are deleted. `fake-tool.mjs` gains modes `spawn-git`, `random`, `random-content`, `second-fails`, `second-sleeps`.
- **Live lane** check 3b "no git for the tools, even past a pre-read": kustomize run directly through the built runner on `resources: - https://127.0.0.1:1/org/repo.git//base?ref=main` (which real kustomize v5.8.1 fetches with `git init`), crankpath's own `PATH` holding a logging `git`; the check fails if `git` is called. The hostile check now has 21 sources.
- `scripts/measure-renders.mjs` follows the new `buildChildEnv` signature.

### Verified
- `npm run verify` on 2026-11-15, exit 0:
  ```
  Checked 152 files in 139ms. No fixes applied.
   Test Files  65 passed (65)
        Tests  1184 passed (1184)
  Statements   : 93.96% ( 5000/5321 )
  Branches     : 86.45% ( 3709/4290 )
  Functions    : 97.35% ( 698/717 )
  Lines        : 95.58% ( 4289/4487 )
  check-tree: 311 files read, 0 finding(s)
  ```
- `npm run verify:live` on 2026-11-15 (helm v4.3.2, kustomize v5.8.1, network up), exit 0: 7 passed, 0 failed, 0 skipped. Render fixture 550 ms, 18 nodes, 23 edges, equal to the recorded output; hostile 790 ms, all 21 sources as expected (`block-generator` `unsupported-field`, `random` `render-failed` by the double render, `lookup-host` rendered), "loopback requests: 0; git calls: 0; exec function ran: no"; check 3b "git calls: 0"; vault-helm 0.34.1 1,062 ms, 27 nodes, 38 edges, 0 opaque, from the cache with `--no-network` 599 ms, same graph.
- **Check 3b shown able to fail**: with the built runner changed to pass the parent's `PATH`, it printed "git calls: 1" and FAIL. (A first version set the parent `PATH` only after the runner's environment was built and stayed green under that mutation; it was fixed before this record.)
- **Red without the fix**: each fix was taken back in turn (the mutations below revert it), and its tests turned red; the fixes were not first committed separately, so no pre-fix commit was run.
- **Mutations** (`b2-tmp/mutate.py`, outside the repository; each applied, the test files run, restored), all red: entries' plain check removed (1), non-string entries treated as plain (1), child PATH inherited (2), ids not compared (1), digests not compared (1), second-render failure not named (1), second render held (2), trailing dot kept (4), `.gitignore` into an existing directory (1), signal handlers re-added (2), non-string repository allowed (1), scp form not remote (1), EPERM as dead (1), `ip6-localhost` allowed (1), symlink dependency as `render-failed` (1), refused transient, render and objects not counted (2, 1, 1; objects was green until a test was added), output not held (3). One mutation is equivalent and was resolved by deleting the code: lower-casing the host in the guard is the URL parser's own work (oci is parsed as https), so the redundant `toLowerCase()` was removed.

### Decisions (the lead's, and mine where the lead left the choice)
- M1: one rule for every list, "plain one-line relative path in the root or refused", rather than reading each line of a multi-line entry; empty child `PATH` as defence in depth (the lead's).
- M2: no handlers, default termination, next-run sweep (the lead's). The pipeline is synchronous, so a handler could only act after the running child returned, which was the defect.
- M3: render every Helm job twice and compare canonical ids (the lead's); the second render's output is parsed and charged as a transient only.
- n1 (an `optional: true` Flux values object in the repo gets no ordering edge): not fixed here; the edge belongs to B4's Flux extractor, which owns those edges since the merge of `main`. Left for that owner; the graph loses no edge `main` had.
- n2 (a Secret keeps annotation values): not fixed. Annotations are metadata, not data, never printed, and their values are read by extractors (an Argo CD `sync-wave` on a Secret orders it); dropping the values would lose real ordering.
- n3: nothing to do (the review confirms the cost line).
- n2 of the first pass (a grandchild holding the pipes) is now further out of reach: neither tool can find `git` on its `PATH`.

### What changes in meaning
- Every Helm source is rendered twice; a Helm source whose object names vary is `render-failed` "not deterministic" whatever functions its templates use (archived subcharts and `tpl` included); a floating entry `helm template: content differs between two renders` replaces the `chart templates` entries; a failing second render is reported as itself. One Helm source can take up to 2 x `renderWallClock`.
- `getHostByName` under `--no-network` is no longer `offline`; the not-modelled line says helm may resolve it, follows redirects, and that hosts are checked by name.
- SIGINT or SIGTERM ends crankpath with the signal (no exit 130 or 143, no message); the next run removes what it left.
- A kustomization entry that is not a plain one-line path is `unsupported-field`; the child's `PATH` is empty.
- Hosts are judged without a trailing dot, so `localhost.` and `127.0.0.1.` are refused, and helm gets the normalised URL.
- `.crankpath` gets a `.gitignore` only when crankpath creates it.

## B2 review fixes, third pass (review `reviews/bolt-2-review-pass-3.md`: 1 Major, 7 Minor, 2 Nit; lead decisions of 2026-11-15)

### Built
- **M1** `kustomize-renderer.ts`: every file kustomize loads as configuration (an entry of `generators`, `transformers`, `validators` or `configurations` that is a file, and a `replacements` path) is read from the private copy after the copy is made. It is `unsupported-field` when any string value anywhere in it contains `://` or starts with `//` ("a kustomize configuration file names a URL (kustomize would fetch it)"), or when a value under a path key (`path`, `paths`, `files`, `envs`, `env`, matched as Go folds keys) is not a plain relative path in or below the kustomization's directory ("... names a path that is not a plain relative path"). `path` and `env` must be one string and the plural keys a list; a `files` entry is judged after its `key=`. The rule is the lead's: kustomize never receives a configuration document that names a URL, with no per-kind key list. Two new hostile sources, `plugin-transformer` (a PatchTransformer whose `path` is a loopback URL) and `plugin-generator` (a ConfigMapGenerator whose `envs` holds one), both written again from the review's repros.
- **M1, defence in depth** `command-runner.ts`: `helm template` and `kustomize build` (allowlist entries marked `closedProxy`) run with `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` set to `CLOSED_PROXY` = `http://127.0.0.1:1` and `NO_PROXY` empty; `helm pull`, `helm dependency build` and both `version` commands get none. Go does not send a request for a loopback address through a proxy, so loopback URLs are covered only by the pre-reads (stated in `docs/limits.md`; the live lane's listener shows those hold).
- **m1** `template-scan.ts` is back, as a flag only: the random, time and certificate functions and `getHostByName` found in a chart's templates are floating entries (`chart templates`), and helm renders either way (`getHostByName` is not `offline`). The double render stays the guard. The limit is stated plainly in `docs/limits.md` and the helm not-modelled line: two renders cannot prove the output never varies, so Helm output is not claimed byte-identical.
- **m2** `--help` and `docs/limits.md`: a helm or kustomize crankpath is running is not stopped by a signal to crankpath alone, runs on with no time limit, and the next run using the same cache may remove its directory; Ctrl-C in a terminal reaches it too.
- **m3** `work-dir.ts`: an existing cache root named `.crankpath` with no `.gitignore` gets one (`*`); one already there is never overwritten; any other existing directory is still left alone.
- **m4** `helm-renderer.ts`: a second render that fails, times out, goes over a cap, cannot start, or whose output cannot be read keeps the first render, with the note `helm template: determinism not checked: second render <outcome>` (`exited with an error`, `timed out`, `over cap`, `could not start`, or `not read (<detail>)`). The second parse asks the run's budget as a comparison: `RunBudget.fitsRenderTransient(cost, false)` refuses without counting a refused job (`RenderRuntime.admitOutput` takes a `comparison` flag).
- **m6** `toolchain.ts`: when a tool's version command does not succeed, `ToolVersion.problem` is `script` (the file starts with `#!`) or `failed`. The text toolchain line and `--version` name it: "a script that did not run: tools run with an empty PATH, so a wrapper that looks a program up on PATH fails; give crankpath the real binary", or "its version command failed; tools run with an empty PATH". The report carries it as `toolchain.problems` (text only; the JSON is unchanged). One README line says the tools must be real binaries.
- **m7** a file entry of a kustomization outside its directory is `render-failed` "an entry names a file outside its kustomization's directory (kustomize loads files only in or below it)", naming the field, before kustomize runs (real kustomize v5.8.1 refuses that shape with `LoadRestrictionsRootOnly`, so this names the cause and changes no outcome). A base directory outside is still a kustomization of its own and allowed. A symlink that fails the copy of a kustomization directory is named: "a symlink in its directory is never followed (the directory is copied whole), so kustomize was not run", with the symlink's path as the value.
- **m5** one test per list and key `entries()` judges (`replacements`, `openapi`, `patchesJson6902`, `patches`, `secretGenerator`, `configMapGenerator` `files`, `envs`, `env`), the `openapi` case-variant key, the `key=path` split, a missing patch or strategic-merge file left to kustomize, a strategic-merge directory never queued as a base, an empty entry refused, and the first render's objects returned when content differs (`count-content` fake mode).
- Live lane: 23 hostile sources, and a new check 3c "the render commands' HTTP goes to a closed proxy": kustomize run through the built runner on a `https://example.org/...` resource must stop at `proxyconnect tcp: dial tcp 127.0.0.1:1` (no network needed). Fake tool modes `proxy-env` and `count-content`.

### Verified
- **Red first**: the new `test/u4-render-engine/review-b2-pass3.test.ts` ran against the pass-2 tip's code before any fix: 36 of 54 failed (the 18 that passed are the m5 pins of code that was already right, which only a mutation can show able to fail).
- `npm run verify` on 2026-11-15, exit 0:
  ```
  Checked 154 files in 80ms. No fixes applied.
   Test Files  66 passed (66)
        Tests  1242 passed (1242)
  Statements   : 94.15% ( 5110/5427 )
  Branches     : 86.77% ( 3806/4386 )
  Functions    : 97.93% ( 710/725 )
  Lines        : 95.8% ( 4380/4572 )
  check-tree: 322 files read, 0 finding(s)
  ```
- `npm run verify:live` on 2026-11-15 (helm v4.3.2, kustomize v5.8.1, network up), exit 0: 8 passed, 0 failed, 0 skipped. Render fixture 416 ms, 18 nodes, 23 edges, equal to the recorded output. Hostile 651 ms, all 23 as expected (`plugin-transformer` and `plugin-generator` `unsupported-field`), "loopback requests: 0; git calls: 0; exec function ran: no". Check 3b "git calls: 0". Check 3c "stopped at the closed proxy: yes". vault-helm 0.34.1: 1,031 ms, 27 nodes, 38 edges, 0 opaque; from the cache with `--no-network`: 462 ms, same graph.
- **The live checks can fail**: with the built configuration-file scan switched off, the hostile check printed `plugin-transformer=none plugin-generator=none`, "loopback requests: 2", FAIL (real kustomize fetched both URLs and used the listener's reply). With the built runner's proxy switched off, check 3c printed "stopped at the closed proxy: no", FAIL; that run made one GET to example.org, recorded in `docs/lookups.md` with the manual probe.
- **Mutations**: the review's harness, pointed at this worktree (`b2-tmp/mut3.py`, outside the repository), plus 52 mutations of the pass-3 code. Every one of the review's 12 survivors is red. Every pass-3 mutation is red, after three changes: a test for a configuration path outside the directory, and two for the comparison flag (the flag's value at the renderer, and a pipeline run at a budget of 1,100,000 bytes where the last comparison parse is refused and no job is counted). The configuration scan's symlink check could never be reached (the directory is copied whole, and a symlink fails the copy first), so it was removed. Mutations that did not compile were rewritten until they did, so none counts as red because the build failed. Still surviving, as the review found: `HEXISH_IPV4` and the zero-width part of `UNSAFE` (the URL parser already rewrites or refuses those forms). A test now pins `localhost..`, so a second trailing dot is red.
- One run of the full suite (before the verify above) had B1's closed-pipe test (`review-b1-pass2.test.ts`, "exits 1 with nothing on stderr when the reader closes standard output early") fail once. Seven further runs of it passed. It does not touch B2's code paths, and it is left for B1's owner as a possible timing race.

### Decisions (the lead's, and mine where the lead left the choice)
- M1 scope: "any other in-root file a kustomization points kustomize at" is read here as any file kustomize loads as configuration that can name further files to load (generator, transformer, validator and transformer-configuration files, replacement files). Resources, patches, generator data files (`files`, `envs`), CRDs and OpenAPI schemas are loaded as content, and kustomize never fetches a string in them. A URL there is ordinary data (annotations, CRD descriptions, ConfigMap values), and refusing it would make normal estates opaque. A `configurations` fieldSpec `path` (`metadata/labels`) passes the path rule because it is a plain relative path.
- The proxy port is 1: a privileged port on loopback that nothing serves. No port is guaranteed closed, so the live check asserts the refusal it saw.
- m4: the kept first render is not counted as a timeout (the source rendered). The note says what happened.
- m6: the cause is kept out of the JSON (a schema change during B6's output work would conflict). The text line and `--version` carry it.
- n1 (a one-line inline strategic-merge patch containing `://` is a false `remote-base`): not fixed. It fails closed, and an inline patch is almost always multi-line (skipped, as before). n2: nothing needed, as the review says.

### What changes in meaning
- A kustomization whose generator, transformer, validator, transformer-configuration or replacement file names a URL, or has a path key that is not plain and in its directory, is `unsupported-field` before kustomize runs (it was rendered, and kustomize fetched the URL).
- A file entry outside its kustomization's directory is `render-failed` with its cause named, before kustomize runs (it was the same reason, with kustomize's error unnamed). A symlink in a copied directory is named.
- `helm template` and `kustomize build` see a closed proxy.
- A Helm source whose second render does not finish keeps its objects, with a "determinism not checked" note (it was opaque). The `chart templates` floating entries are back as flags.
- `.crankpath` committed in a repository gets a `.gitignore` when it has none.
- The toolchain line and `--version` say why a tool's version was not read when its command failed.
- `--help`, `docs/limits.md` and the not-modelled line no longer suggest a signal stops a running tool, or that two renders prove determinism.

## B2 merge of `main` (B6 `1df4b0a`)

`main`'s earlier tip (B5) was already an ancestor, so B6 merged directly. Conflicts resolved by hand:
- `BUILD-NOTES.md`: `main`'s sections (B0 to B6) first, then every B2 section unchanged.
- `report-model.ts` and `report-assembler.ts`: both sides' fields (B2's `floating`, `undeployedKustomizeRoots`, `toolMissing`; B6's `controllerMatches`).
- `cli-shell.ts`: B2's real `--version` (B6's placeholder `versionText()` dropped), B6's `--explain` text and `--no-color`, B2's `--no-network` and `--cache-dir` texts, and help ending with B6's path-order lines, then B2's signals paragraph. That paragraph is now wrapped at 80 columns.
- `cli.ts`: B2's `toolPath` with B6's `isTTY` and `NO_COLOR`.
- `pipeline-runner.ts`: B6's controller-signature import (B2's `assembleReport` import kept).
- `test/fixtures/thin-slice/expected.txt`: B6's layout.

### Integration with the frozen schema (the B6 hand-over note)
- `schemas/crankpath-report.schema.json` gains B2's report fields: `toolchain.testedPair` (`helm`, `kustomize`), `toolchain.missing` and `toolchain.unrecognised` (tool words), `floating[]` (`node`, `field`, `value`, `resolved`), `undeployedKustomizeRoots[]`, and `toolMissing` (`helm`, `kustomize`). Every object has `additionalProperties: false` and every field is required, as B6 froze them. They are additive only, so `schemaVersion` stays 1.
- The field golden (`test/fixtures/schema/report-fields.golden.json`) gains the 18 new paths. It was written by `schemaFields` from the schema, with a check that no existing path changed type. `docs/json-output.md` was regenerated with `node scripts/json-output-doc.mjs`, and its prose names B2's additions. `toolchain.problems` (pass 3, m6) stays out of the JSON, as decided.

### Expected outputs re-checked by hand at 80 columns
- `test/fixtures/thin-slice/expected.txt`, three edits.
  - The toolchain line is B2's: `toolchain: helm not found on PATH, kustomize not found on PATH`, 62 columns, no wrap.
  - The floating section now goes through B6's layout: `Floating revisions: 1 (... a rerun may read or` / `    render other content)`.
  - The floating entry is now `  floating 1 of 1  node: Application "argocd/gitea"` / `      field: "spec.source.targetRevision"  value: "main"`. Each continuation is the line's indentation plus four, the break falls at a run of spaces outside quotes and not after a label, and the field name is quoted as B6's `fieldText` quotes it.
  - The one line over 80 columns (line 15, 87 columns) is `main`'s, a quoted hostile value that is never cut.
- Tests that asserted on whole B2 statements in the text (`render-e2e.test.ts`, the m6 test) now undo the wrap with B6's `unwrapText` or `flat`. The statements asserted are unchanged.
- `b6-cli.test.ts`'s colour tests call `main` in process and now pass `toolPath: ""`: with B2 the toolchain line reads the real PATH, and the expected text is for no tools found.
- The Mermaid text fence and `--explain` are B6's and carry no toolchain line. Not changed.

## B1's closed-pipe test: the race and the fix (lead request after the B6 merge)

- **What failed:** `review-b1-pass2.test.ts`, "exits 1 with nothing on stderr when the reader closes standard output early". It failed twice during B2's third pass: once in a full run, and once in the isolated run right after. It passed on every other run.
- **Reproduction attempts with crankpath itself, none of them failing:**
  - the test alone in a loop, 50 runs;
  - 200 copies of it at once, while a full suite ran;
  - 30 runs with 14 busy processes on 10 cores;
  - a stress script of the same spawn, 800 runs at 10 to 12 at once;
  - five full suites.

  None of these failures were captured, so the failing output is not on record.
- **The race, found one level down:** a plain Node child writing lines in a synchronous loop, with its standard output's reader closed on the first chunk (the test's own pattern). Out of 900 runs at 12 at once on this machine (macOS, Node v22.23.2), the first write error was not always `EPIPE`.
  - Reader closed on the first chunk: `ENOTCONN` in 9 of 300 runs, `EPIPE` in the rest.
  - Reader closed one turn later: `ENOTCONN` in 14 of 300.
  - Reader closed on a timer: `EPIPE` in all 300.

  macOS returns `ENOTCONN` when the write meets the reader's close part-way through. crankpath's handler (`cli.ts`, B1) treated only `EPIPE` as a gone reader and printed its internal-error line for anything else. That is exactly the test's failure mode: exit 1, but stderr not empty. So it was a product defect that a timing-dependent test showed now and then, not a defect in the test.
- **Fix:** the handler treats `EPIPE` and `ENOTCONN` as a closed reader (exit 1, nothing printed). Every other code still prints the internal-error line. `ECONNRESET` was never seen and is not added.
- **Deterministic test, written first:** each code (`EPIPE`, `ENOTCONN`, and `EIO` as the other case) is emitted on the built binary's standard output by an `--import` preload, after the run. So the real handler is exercised for every code on every run, whatever the timing. Before the fix, the `ENOTCONN` case failed with the internal-error line on stderr; the other two passed. The original spawned test is kept as it was: what it asserts is unchanged, and with the fix it can no longer meet an unhandled code.
- **Verified after the B6 merge and this fix (2026-11-16):**
  - `npm run verify` three times in a row, each exit 0: 78 files, 1382 tests; coverage 94.58% statements, 87.34% branches, 98.15% functions, 96.16% lines; check-tree 359 files read, 0 findings.
  - `npm run verify:live` once, exit 0: 8 passed, 0 failed, 0 skipped. Hostile set: 23 sources as expected, loopback requests 0, git calls 0. Closed proxy: yes. vault-helm 0.34.1: 27 nodes, 38 edges, 0 opaque, the same from the cache with `--no-network`.

## B2 review fixes, fourth pass (review `reviews/bolt-2-review-pass-4.md`: 1 Major, 2 Minor, 4 Nit; lead decisions of 2026-11-16)

### Built
- **M1** `yaml-shape.ts` (new, U4) reads a file's YAML tokens with the `yaml` library's lexer. It finds the first tag (`!!binary`, `!!str`, `!!set`, a custom `!tag`, a verbatim `!<...>`, a tag on a key, a tag after an anchor) or directive (`%TAG`, `%YAML`). It also finds the first quoted or plain scalar whose decoding could differ between crankpath's reader and kustomize's go-yaml: a double-quoted scalar with an escape or a line break, a single-quoted or plain scalar over more than one line. Block scalars are kept, top-level ones whose lines start at column 0 included. A `!` or `&` inside a value or a comment is not a tag, because the check reads tokens, not text.
  - `kustomize-renderer.ts` refuses a kustomization file (every one the pre-read reaches, bases and components included) and every configuration file it judges as a whole, as `unsupported-field`, before kustomize runs. The detail is "a YAML tag (kustomize may decode the value otherwise than crankpath reads it)" or "a quoted or plain scalar with an escape or a line break (...)", with the file as the field and the token as the value.
  - The check runs on the very text the reader parses (`PrivateTree.read` hands it over: one read of the private copy), and before the reader's own outcome, so a tag the reader refuses (`!!set`) is named too.
- **m1** a test with the URL in the second document of a transformer file. The review's mutation (`read.documents.slice(0, 1)`) is now red.
- **m2** one wording for both configuration-file refusals: "a kustomize configuration file names a URL or a non-plain path that kustomize may load; crankpath does not tell a literal from a path here". `docs/limits.md` lists both pre-reads as known false opaques: tags and scalar forms in any judged file, and literals with `://` or path-named keys in configuration files.
- Hostile set: 26 sources. The three new ones are `tag-binary-patch` and `tag-binary-config` (the review's `h5src` `a-main`, `b-cfg`) and `tag-key` (`h6src`). The live lane re-encodes their base64 values with the listener's port.
- **Nits:**
  - n2: `docs/json-output.md` now says byte-identical output holds except for a Helm source whose renders vary, pointing to `docs/limits.md`. The table was regenerated with `node scripts/json-output-doc.mjs`.
  - n4: the two `noCommaOperator` warnings are gone; `biome check` reports none.
  - n1 (a `.gitignore` in `tmp/` and in each run directory) and n3 (80 columns counted in code points): recorded, not changed.

### Verified
- **Red first:** `test/u4-render-engine/review-b2-pass4.test.ts` against a `yamlShapeProblem` stub that finds nothing: 19 of 21 failed. The two that passed are the "keeps block scalars ..." test and the m1 multi-document test, which pins code that was already right; the mutation below shows it can fail.
- `npm run verify` on 2026-11-16, exit 0:
  ```
  Checked 179 files in 98ms. No fixes applied.
   Test Files  79 passed (79)
        Tests  1403 passed (1403)
  Statements   : 94.63% ( 5730/6055 )
  Branches     : 87.47% ( 4176/4774 )
  Functions    : 98.16% ( 804/819 )
  Lines        : 96.2% ( 4893/5086 )
  check-tree: 372 files read, 0 finding(s)
  ```
- `npm run verify:live` on 2026-11-16, exit 0: 8 passed, 0 failed, 0 skipped.
  - Hostile set: all 26 sources as expected (`tag-binary-patch`, `tag-binary-config` and `tag-key` all `unsupported-field`); "loopback requests: 0; git calls: 0; exec function ran: no".
  - Closed proxy: yes.
  - vault-helm 0.34.1: 27 nodes, 38 edges, 0 opaque; the same from the cache with `--no-network`.
- **The live check can fail:** with the tag test removed from the built `yaml-shape.js`, the hostile check printed `tag-binary-patch=none tag-binary-config=none tag-key=render-failed`, "loopback requests: 2", FAIL. Real kustomize decoded the `!!binary` paths and fetched them.
- **Mutations** (`b2-tmp/mut4.py`, outside the repository), all red:
  - the tag test, the directive test, the double-quoted escape and line-break tests, the single-quoted and plain line-break tests;
  - the shape check off for kustomization files, and off for configuration files;
  - only the first document of a configuration file judged (the review's m1);
  - the read not handing its text over;
  - block scalar lines judged. This one was green until a test with a top-level block scalar whose lines start at column 0 was added.

### Decisions
- Any tag at all is refused, `!!str` included, and a `%YAML` directive too (it changes how the text decodes), as the lead decided ("fail closed"). The scalar rule refuses only the forms whose decoding could differ: escapes and line folding. Block scalars stay, because inline strategic-merge patches are written as block scalars.
- The configuration-file scan stays conservative (the lead's m2 decision). Its words now say so, and so does `docs/limits.md`.

### What changes in meaning
- A kustomization or configuration file with any YAML tag or directive, or with an escaped or multi-line quoted or plain scalar, is `unsupported-field` before kustomize runs. Before, it was judged on the reader's values, and kustomize could decode a tagged value into a URL and fetch it.
- The configuration-file refusal's detail is new (one sentence for URLs and paths).
