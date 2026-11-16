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
