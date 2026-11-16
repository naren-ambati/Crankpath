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
