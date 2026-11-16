# Third-pass review of bolt B0 (after the second-pass fixes)

- Bolt: B0. Branch: `bolt/b0`. Commit reviewed: `2e2e08f` (pass 2 reviewed `12d16df`; the fixes are `12d16df..2e2e08f`). Date: 2026-11-15.
- Reviewer: Claude Sonnet 5.5, independent read-only review. Scope: only the pass-2 fixes and where they meet (URL redaction, `lexemesPerFile`, the RangeError tests, the `changed` outcome, check-tree matching, census wording).
- Method: fresh clone of the commit, `npm ci --ignore-scripts`, `npm run build`, `npm run verify` three times (all three exit 0: 193 tests, check-tree 42 files, 0 findings), the deep-stack sweep alone 25 times, mutation runs on the reader, and repro scripts in the scratch folder `review-b0-pass3/repros/` (they import `../w/dist` and `../w/scripts`, so they run in a clone of this commit after `npm ci --ignore-scripts && npm run build`).

Counts: Major 1, Minor 5, Nit 5.

## 1. Findings

### Major

| id | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|
| M1 | `docs/limits.md` "Memory is bounded per file" and the `lexemesPerFile` row; `src/u1-graph-model/limits.ts` `MEASURED.worstBytesPerLexeme = 664`; BUILD-NOTES (Unverified) | The pass-2 M3 class again: the stated worst case is not the worst. The doc says the most resident memory per lexeme measured is 664 bytes and "the worst file the limits accept cost 1,684 MB peak and the slowest 13.5 s". A file of nested empty flow sequences (`[[[[]]]],` repeated, 3.52 MB, 3.52 million lexemes, 1.57 million nodes: inside every limit, accepted `ok`) peaks at about 2,335 MiB resident in 9.5 s, about 680 bytes per lexeme (peak minus the with-text baseline, the script's own formula). Run with the derived heap it passes; with `--max-old-space-size=2250` it passes; with 2200 it dies with a V8 out-of-memory abort. So the bound holds on the reference runner, but with a 6% margin (and 2,384 MiB is the derived figure, not a measured safe one), the 664 figure is below a shape I found in eight tries, and the "worst accepted file" numbers (1,684 MB, 13.5 s) are wrong by 40% in memory and the shape was never in the 23 or the 12. The derivation's whole claim ("the most memory per lexeme measured over the shapes") is therefore false as worded, and a heavier shape (more nested collections per node budget) was not searched for. | CONFIRMED: `node --max-old-space-size=2384 repros/shape.mjs n3 3520000` prints `ok peakMiB 2338`; the same with 2200 aborts (`repros/shape.mjs`, shapes `n3`, `n4`, `nested`: 588 to 680 bytes per lexeme) | Add nested-collection shapes (empty flow sequences inside flow sequences, at the node limit) to part 1 and part 3 of the measurement script, take the real maximum, re-derive `lexemesPerFile` from it (or add the node limit's share to the model: a node costs more than a lexeme), and restate the worst accepted file's cost and time from the new worst shape. Until then word the doc as "no shape tried crashed", not "worst". |

### Minor

| id | location | scenario | status | fix |
|---|---|---|---|---|
| m1 | `src/u1-graph-model/safe-text.ts` `redactUrl`, `EMBEDDED_USERINFO` (a regex for `scheme://...@`); BUILD-NOTES M1 "decides by construction" | Only one spelling of an embedded URL is found. A URL with userinfo later in the string is echoed unchanged when written scheme-relative (`...?next=//user:pass@host/`), percent-encoded (`...?u=https%3A%2F%2Fuser:pass%40host`), with a single slash (`https:/user:pass@host`) or with backslashes (`https:\\user:pass@host/x`). The first of these is a credential echo of exactly the pass-2 M1 class; "by construction" is true of the top-level URL, not of what follows it. Query secrets that are not userinfo (`?token=...`, signed-URL signature parameters) are also echoed; nothing in the docs says redaction is userinfo-only. The `scheme://` spellings, the fragment, `;` parameters and the scp form are all refused (checked). | CONFIRMED: `repros/url2.mjs` | Treat any `@` that follows the authority (in query, fragment or path) with a `:` or `//` or `%2F`/`%3A` before it as unparseable, or state in `redactUrl`'s comment and BUILD-NOTES that only userinfo of literal `scheme://` URLs is removed and query secrets are out of scope. |
| m2 | `src/u2-intake-config/bounded-reader.ts` `readTextWithHooks` outer `try/catch` (new in this range) | The new catch that turns any throw inside the read into an `io-error` result is not exercised by any test: replacing its body with a rethrow leaves 56 of 56 reader tests green (`readYaml`'s own boundary hides it from the sweep). Another caller of `readText` would see a throw. | CONFIRMED (mutation) | One test with a hooks object whose hook throws (a RangeError and an Error) and an assertion on the `io-error` result. |
| m3 | `limits.ts` `lexemesPerFile` vs `expandedNodesPerDocument` | The two derived limits do not agree: `expandedNodesPerDocument` says a 3 MiB object of one-character nodes (1,572,864 nodes, legal for the API server) is admissible, but such a document written in flow style (`[0,0,...]`) costs 3 lexemes per element, 4.5 million, and is refused `file memory` (`repros/json.mjs`, third row). Ordinary files are far from it (a 5 MB CRD-shaped bundle: 746,207 lexemes, 6.7 bytes per lexeme, accepted; a 3.4 MiB minified JSON object: 760,022, accepted; 10.7 MB of three such documents: 2.28 million, accepted). The refusal is named and counted, so this is a doc and consistency point only. | CONFIRMED | State in the `expandedNodesPerDocument` row that the lexeme budget refuses it first, or derive one limit from the other. |
| m4 | `docs/census.md` line 25 | Section 1 still says the census "is a static upper bound" and is "labelled `static-upper-bound`"; the JSON label is `static-estimate` and a test forbids the phrase in the results. The preface of the file explains that sections 1 and 2 are kept as written, but this sentence is not marked in place the way BUILD-NOTES marks its superseded lines. | CONFIRMED (read) | Mark the sentence "(superseded: see section 2a)" or reword it. |
| m5 | `scripts/check-tree.mjs` rules | False positives on ordinary text, found by running 40 sample lines through `checkTree`: any `/home/` folder path of the CI-image kind (a runner's work folder) is `home-path`; `home-relative` fires on a tilde-slash followed by any letter or digit (a `cd` into a source folder, a bin folder added to the path), common in ordinary install notes; the ordinary phrase for the development life cycle of an artificial-intelligence system, abbreviated to two letters at its start (with or without the word driven), is `design-tool`; and the five letters of the tool name listed as separate array items in code are `design-tool`. The whole-word login rule skips logins of three characters or fewer (stated), so a short real name passes. None flags the committed tree (0 findings). No false positive on `said`, `aid`, `paid`, `agile ... life cycle`, a bare users folder, a `$HOME`-prefixed dot folder, or markup like an italics tag. | CONFIRMED (`repros/ct2.mjs`) | Accept and record these as the cost of the rules, or narrow `home-path` to non-service names and `home-relative` to the design workspace's folder names. |

### Nit

| id | location | note |
|---|---|---|
| n1 | `bounded-reader.ts` `readerProbe` | A mutable counter is exported from the production module for one test's benefit; harmless (a property write), but it is public API of u2. |
| n2 | `check-tree.mjs` `matches` | The scan is per line, so the tool name split across two lines still passes (`ai` at a line end, the rest on the next). Known class of the separator rules; fine to leave. |
| n3 | `redactUrl` | `http://a.org/redirect?u=ssh://git@host/x` prints `unparseable URL` (an ssh user in an embedded URL is treated as userinfo): safe direction, rare. A scheme-less OCI chart address (`registry.example.org/charts`, Argo CD's form, named in the census) also prints `unparseable URL`; unchanged from pass 2, so not a regression. |
| n4 | `readTextWithHooks` | `changed` catches grow, shrink and another inode; a rewrite to the same size between fstat and read is not detectable this way (inherent, and the real-path check still holds). The test names the three outcomes, so nothing misleads. |
| n5 | `check-tree.mjs` `home-path` | `/Users/` followed by whitespace then a word is matched (`\s*` crosses a newline), so a sentence ending in that folder name with the next line starting with a word is flagged. Safe direction. |

## 2. Where the pass-2 fixes meet (answers to the brief's questions)

- **URL redaction.** For a string that starts with `scheme://` the URL parser removes userinfo and the result is rechecked for a later `scheme://...@`: sound for that spelling. Legitimate URLs I tried (41 forms, `repros/url.mjs`) are kept, including `@` in a path (`/@scope/pkg`, `/path/@user`), `@` in a query (`?email=a@b.c`), an embedded `https://` URL in a query, `oci://` and `s3://` addresses with `@` in the path, an IPv6 host, an IDN host (punycoded), a port, `file://`, and scp addresses (user removed). No legitimate `https` URL printed `unparseable URL`. The hole is m1 (other spellings of an embedded URL, and query secrets).
- **`lexemesPerFile`.** The arithmetic reproduces: (2,500,000,000 - 44 MiB - 30,000,000) / 664 = 3,650,395. The text reserve (3 times `fileBytes`: read buffer plus a decoded string of at most 2 bytes per input byte) is sound as a bound. The count really is per file (a test and my 8-shape run: the cumulative count refuses three-document files and comment and newline files). The per-file bound holds at the reference heap for every shape I ran at the limit, but the measured maximum is not the maximum (M1). Ordinary Kubernetes manifests are nowhere near it: a 5 MB CRD-shaped bundle is 746,207 lexemes and is accepted, a 3.4 MiB minified JSON object 760,022, and 10.7 MB of three of those 2.28 million; only flow-style files denser than about 3 bytes per lexeme can reach the budget (m3).
- **Deterministic RangeError tests.** Both new tests fail when their code is removed: mapping everything to `parse-error` turns two tests red; a rethrowing second boundary in `readYaml` turns two red (the new test and the deep-stack test); the sweep itself (call-site overflow no longer counted, via the probe) ran clean 25 of 25 times standalone (7,975 reached, 0 escaped) and 3 of 3 in `verify`, so pass-2 M2 is closed. The new outer catch of `readTextWithHooks` is untested (m2).
- **`changed` outcome.** Grow, shrink and another inode each have a test with its own detail; removing the shrink check turns the shrink test red. The reason word and the `Refusal` union are consistent (`REASON_WORDS` is a total record; no other switch over refusals exists in `src`).
- **check-tree.** NFKC and separator-run folding find the spelled variants and do not fire on `said`, `aid`, `paid`, `agile ... life cycle`, `<i>` markup or `a<b>i`; no catastrophic backtracking (2 million punctuation characters between the letters: 77 ms). The false positives are in m5. Matching the tool name is unchanged for the three-character cutoff: logins of 3 characters or fewer are not checked, by statement.
- **Census wording.** `againstOneThird` logic is right: "over one third" without a floor is exact for what is counted and cannot be undone by failed renders (only opaque units can be added); "not established" is used for every share not over, and "over one third of the counted units; not established for the estate" whenever a floor exists. The strings in `docs/census.md`, the JSON (label `static-estimate`, `unit` field) and the tests agree; the one stale sentence is m4.

## 3. Tests that cannot fail

| test or defence | how shown |
|---|---|
| `readTextWithHooks` outer catch (new) | replaced by a rethrow: 56 of 56 reader tests pass (m2) |

Killed by mutation (so those tests do fail): parse-handler mapping (2 red), `readYaml` second boundary (2 red), shrink check (1 red), lexeme count without space, newline and comment lexemes (2 red).

## 4. Definition of Done (third pass)

| item | status | evidence |
|---|---|---|
| `npm run verify` green | met | 3 of 3 runs exit 0; the sweep 25 of 25 clean |
| census figure honest about its nature | met | label, units, floors and wording agree (m4 is one stale sentence in a kept section) |
| limits table in step with the code, derived not picked | partly | table equals the code and the arithmetic reproduces; the "worst measured" inputs are wrong (M1) |
| SafeText tests incl. adversarial | partly | `scheme://` spellings sound; other embedded spellings echoed (m1) |
| BoundedReader tests incl. adversarial | met, with m2 | |
| check-tree 0 findings and tested | met, with m5 | |
| docs against code and committed JSON | partly | limits.md worst-case figures (M1); census.md line 25 (m4) |

## 5. Checked and found sound

- Three `verify` runs; the pass-2 M2 flake is gone (25 standalone sweeps).
- The text reserve and the heap derivation arithmetic; the per-file (not per-document) count.
- Real-manifest sizes against the lexeme budget (CRD bundle, minified JSON, multi-document files): accepted.
- `redactUrl` on 41 legitimate and 20 hostile strings: no `https` URL wrongly refused; all literal `scheme://` embedded forms refused.
- The `changed` outcome and wording; `Refusal` and `REASON_WORDS` stay total.
- `againstOneThird` and the census wording against the committed JSON.
- check-tree speed on 8 MB of separator-heavy text; no false positive on ordinary English words.
- No design-tool name, home path or personal name in the added files (check-tree runs clean on this review file as well; its examples are described, not quoted).

## 6. Verdict

**Ready to merge after fixes.** Fix M1 (measure the nested-collection shape, take the true maximum, restate the worst accepted file) and either fix or state the limits of m1; the other findings can follow in B1 if the lead records them.

Repros: the folder `review-b0-pass3/repros/` (`shape.mjs`, `crd.mjs`, `json.mjs`, `url.mjs`, `url2.mjs`, `ct.mjs`, `ct2.mjs`). M1: `node --max-old-space-size=2384 repros/shape.mjs n3 3520000` (and the same with 2200).
