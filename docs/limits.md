# Limits (OD-5): what each protects, what it is derived from, and what is not derived yet

Written in B0 (2026-11-15). Rule (OD-5, FR1.4, NFR5): no limit is picked. Each is derived from what it protects (two derivations rest on a stated choice, named in their rows: the half-stack reserve of `nestingDepth` and the reference machine of `lexemesPerFile`), from a dated lookup (`docs/lookups.md`) or a measurement made with a committed script, and a limit hit is a named, counted refusal, never silence and never a crash. A limit whose basis needs a real render or a measurement not made yet is **not yet derived**: in code (`src/u1-graph-model/limits.ts`) it has no value at all, so no unit can use it as a number (the type forbids it; `test/u1-graph-model/limits.test.ts` proves it). A test keeps this table and the code in step.

## The table

| Limit | Value | Unit | Protects | Derived from (lookup or measurement, 2026-11-15) | Enforced by |
|---|---|---|---|---|---|
| `fileBytes` | 10,000,000 | bytes | memory and parse time of one repository file | Argo CD v3.6.1 repo-server default `--max-combined-directory-manifests-size` "10M", a Kubernetes quantity (`resource.ParseQuantity`): 10,000,000 bytes. No file of a directory-type Application can exceed what Argo CD reads for the whole directory at its defaults. This is a default of a configurable flag that governs one Application type (the review noted it, m2): Helm 4.3.2 has no per-file limit (`MaxDecompressedFileSize` "is no longer used internally"; 100 MiB per chart) and no Flux per-file limit was found, so a larger file there is a named `too-large` outcome. | BoundedReader: an early exit from lstat, then a bounded read that stops one byte past the limit and refuses a file that grew while read |
| `documentsPerFile` | 217,391 | documents | per-document cost of a file of many tiny or empty documents | `fileBytes` / 46: 46 bytes is the shortest document that can describe one named Kubernetes object (`---`, `apiVersion: v1`, `kind: X`, `metadata:`, ` name: a`, with newlines). A file within `fileBytes` cannot hold more object-bearing documents. | BoundedReader, counted while parsing, before composing |
| `nestingDepth` | 287 | levels | the parser's stack, so that a deep file is refused by this count and never by stack exhaustion (the same file gets the same answer on every run) | the smallest nesting the yaml package 2.9.1 composed over eight shapes with V8's interpreter only (`--jitless`, the largest frames and so the lowest capacity) and half of Node 22.23.2's default stack already in use (the half is kept for crankpath's own callers, a stated reserve): 287 levels, the same in two runs (`scripts/measure-limits.mjs`, part 2). go-yaml v2.4.2, the decoder Kubernetes uses, allows 10,000 (`max_flow_level`, `max_indents`): a file between 287 and 10,000 levels is valid to Kubernetes and refused by crankpath, by name. The deepest real file in the five estates has 14. | BoundedReader: the CST parser's explicit stack length, checked per lexeme before anything is composed; the yaml package's own stack-exhaustion error and a `RangeError` remain mapped to the same `too-deep` as a backstop |
| `expandedNodesPerDocument` | 1,572,864 | nodes | walk time and size of one document after alias and merge-key expansion (alias bombs) | kube-apiserver `MaxRequestBodyBytes` 3 MiB (k8s.io/apiserver `pkg/server/config.go`: `int64(3 * 1024 * 1024)`) / 2 bytes, the smallest JSON encoding of one value node (`0,`). An object with more nodes cannot be sent to the API server. It does not bound the parser's memory: `lexemesPerFile` does, and it binds first for dense flow style: a document of 1,572,864 one-character values written `[0,0,...]` costs three lexemes per value (4.7 million) and is refused `file memory`, a stated trade-off with a test (`bounded-reader.test.ts`); ordinary manifests are far below either (the third review measured a 5 MB CRD-shaped bundle at 746,207 lexemes). | BoundedReader: counted while lexing (every lexeme that starts a node) and again while converting (aliases expanded by size, never copied); `alias-limit` when the document has aliases, `too-large` otherwise |
| `lexemesPerFile` | 2,585,714 | lexemes | the reader's memory for one file: the yaml package's syntax trees and the converted values of all its documents | (the default old-generation heap V8 12.4 gives Node 22 on the smallest GitHub-hosted runner, `ubuntu-slim` with 5 GB: 5,000,000,000 / 4 x 2 = 2,500,000,000 bytes; minus the reader's largest measured baseline before the text exists, 45 MiB; minus a reserve for the text, 3 x `fileBytes`: the read buffer plus a decoded string of at most 2 bytes per input byte) / 937 bytes, the worst resident memory per lexeme of the 39 shapes measured (`scripts/measure-limits.mjs`, part 1: several documents, comments, whitespace, nested collections and invalid YAML included; the worst was a run of commas, which the parser refuses only after spending the memory). The worst of the shapes measured, not a proven maximum. The reference machine and the text reserve are stated choices of the derivation. | BoundedReader: counted while lexing, over the whole file, before any document is composed; `too-large` (detail `file memory`) |
| `quotedTextChars` | 381 | characters | line length and output size of quoted repository text | the longest canonical node id `Kind/namespace/name`: kind 63 (a CRD kind lower-cased must be a DNS-1035 label: apiextensions `validation.go`), namespace 63 (DNS-1123 label), name 253 (DNS-1123 subdomain), Kubernetes "Object Names and IDs": 63 + 1 + 63 + 1 + 253. No valid id is ever cut. | SafeText: cut on a code-point boundary with `... (cut at 381 of N characters)` |
| `generatedApplicationsPerApplicationSet` | — | applications | graph size from one ApplicationSet | not yet derived: B3 step 0. No source ties a ceiling to what it protects: Argo CD's `--max-resources-status-count` default 5000 (v3.6.1) is a status-recording default, not a generation ceiling. Needs the measured cost of a generated Application in the graph. | the generator expansion (B3) |
| `mermaidMaxEdges` | 500 | edges | a diagram the renderer refuses to draw | Mermaid 12.3.0 config schema (`packages/mermaid/src/schemas/config.schema.yaml`): `maxEdges` default 500. | the Mermaid renderer (B8) |
| `mermaidMaxTextChars` | 50,000 | characters | a diagram text the renderer refuses to parse | Mermaid 12.3.0 config schema: `maxTextSize` default 50000. | the Mermaid renderer (B8) |
| `explainElementaryCycles` | — | cycles | readability of `--explain`: the elementary cycles of one component fit one screen | not yet derived: B6 step 0. A VT100 screen is 24 lines (VT100 User Guide, chapter 1), but how many of them the `--explain` listing uses for itself is not designed yet, so no count can be derived from it now. | `--explain` |
| `filesPerScan` | — | files | total read time of a scan | not yet derived: B3 step 0. No tool or host publishes a file-count ceiling for a repository (GitHub's repository limits recommend at most 3,000 entries per directory and a depth of 50, which bound no total), and OD-7 sets no time budget from which a count could follow; the basis needs discovery's measured per-file cost (review m3: the lead to record the deferral). | discovery (B3) |
| `renderWallClock` | — | milliseconds | a render subprocess that never ends (a backstop only, OD-30) | not yet derived: B2 step 0. Needs real helm and kustomize renders to measure. | the command runner (B2) |
| `renderStdoutBytes` | — | bytes | memory held by one render's standard output | not yet derived: B2 step 0. Needs real renders. | the command runner (B2) |
| `renderStderrBytes` | — | bytes | memory held by one render's standard error | not yet derived: B2 step 0. Needs real renders. | the command runner (B2) |
| `renderedObjects` | — | objects | graph size from one render | not yet derived: B2 step 0. Needs real renders. | the rendered-set builder (B2) |

## The Mermaid node cap (OD-18)

The design asks for a derived Mermaid node cap. Mermaid itself limits two things, edges (`maxEdges`) and the diagram text (`maxTextSize`), not nodes, and a node count cannot guarantee the text fits because labels vary in length (a quoted id is up to 381 characters before Mermaid entity escaping). So the cap is recorded as those two derived limits: the graph is drawn whole only when its generated text is at most 50,000 characters and it has at most 500 edges; otherwise only its cycle components are drawn and the output says so. This replaces a single node number (a deviation recorded in `BUILD-NOTES.md`).

## Need (what real files use) against the limits

The five census estates (`docs/census.md`), every readable YAML file, measured with `node scripts/census.mjs --need` on 2026-11-15 (one JSON line per estate; the maxima here):

| Measure | Largest in the five estates | Limit |
|---|---|---|
| file size | 85,272 bytes (ricsanfre/pi-cluster) | 10,000,000 |
| documents in one file | 19 (mortennordbye/homelab) | 217,391 |
| nesting depth (collection levels) | 14 (three estates) | 287 |
| nodes in one document, aliases expanded | 1,040 (ricsanfre/pi-cluster) | 1,572,864 |

## Memory, depth and cost (measured)

`npm run build && node scripts/measure-limits.mjs` on 2026-11-15. Part 1 measures memory per lexeme with the node, lexeme and depth limits lifted, over 39 shapes (several documents in one file, comment, newline and space runs, nested collections down to 280 levels, aliases inside collections, merge keys, and invalid YAML that the parser refuses only after building it), and the resident cost of a byte of text; part 2 the depth the yaml package composes with the interpreter only and half the stack in use; part 3 builds, for each of 18 shapes, the largest file the derived limits accept (and one just over the lexeme limit), each in a child whose heap is the derived 2,500,000,000 bytes (`--max-old-space-size=2384`), so a shape that needed more would crash there; part 4 the yaml package's own guards.

The derivation of `lexemesPerFile` uses part 1 of this run (`node scripts/measure-limits.mjs --part1`), after the third review found a heavier shape than the 23 measured before (nested empty flow sequences):

```
node v22.23.2, darwin arm64
1. memory per lexeme (39 shapes, about 3 MB each, node, lexeme and depth limits lifted; every lexeme counted):
  anchored block items: 2999998 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 477 MiB, 147 bytes per lexeme
  anchored and tagged block items: 2076922 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 336 MiB, 141 bytes per lexeme
  tagged block items: 2100001 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 366 MiB, 155 bytes per lexeme
  block items: 3750001 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 660 MiB, 169 bytes per lexeme
  flow numbers: 4500005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1494 MiB, 335 bytes per lexeme
  flow tagged numbers: 1875005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 549 MiB, 276 bytes per lexeme
  flow anchored numbers: 3000005 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 823 MiB, 268 bytes per lexeme
  aliases in a flow sequence: 2000021 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1320 MiB, 663 bytes per lexeme
  block keys: 2370663 lexemes, ok, before the text 44 MiB, with it 95 MiB, peak 501 MiB, 179 bytes per lexeme
  explicit keys: 2539991 lexemes, ok, before the text 44 MiB, with it 89 MiB, peak 481 MiB, 162 bytes per lexeme
  quoted strings: 1500005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 798 MiB, 519 bytes per lexeme
  empty flow maps: 3000005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1412 MiB, 474 bytes per lexeme
  empty flow sequences: 3000005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1357 MiB, 455 bytes per lexeme
  null values in a flow map: 2612571 lexemes, ok, before the text 44 MiB, with it 102 MiB, peak 555 MiB, 182 bytes per lexeme
  three documents of empty flow maps: 3000019 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1145 MiB, 381 bytes per lexeme
  three documents of empty flow sequences: 3000019 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1362 MiB, 457 bytes per lexeme
  comment lines: 3000008 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 362 MiB, 107 bytes per lexeme
  comments in a flow sequence: 3000010 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 366 MiB, 109 bytes per lexeme
  newlines in a flow sequence: 3000006 lexemes, ok, before the text 44 MiB, with it 54 MiB, peak 321 MiB, 93 bytes per lexeme
  newline and space in a flow sequence: 3000006 lexemes, ok, before the text 44 MiB, with it 54 MiB, peak 321 MiB, 93 bytes per lexeme
  blank lines in a block mapping: 3000015 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 301 MiB, 86 bytes per lexeme
  comments between block items: 3500001 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 529 MiB, 142 bytes per lexeme
  empty flow maps and newlines: 3000006 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 869 MiB, 284 bytes per lexeme
  nested empty flow sequences, four deep: 3000002 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 2016 MiB, 685 bytes per lexeme
  nested empty flow sequences, two deep: 3000005 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1753 MiB, 593 bytes per lexeme
  flow sequences of one number: 3750005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1932 MiB, 525 bytes per lexeme
  flow sequences of an empty map: 3000005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1793 MiB, 607 bytes per lexeme
  flow maps of an empty sequence: 3375005 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1147 MiB, 339 bytes per lexeme
  flow sequences of an alias: 2400019 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1756 MiB, 743 bytes per lexeme
  flow maps of an alias: 3000019 lexemes, ok, before the text 44 MiB, with it 58 MiB, peak 1118 MiB, 371 bytes per lexeme
  merge keys: 2666689 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1023 MiB, 380 bytes per lexeme
  aliases of a map: 2000025 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1323 MiB, 664 bytes per lexeme
  flow key-value pairs: 3000006 lexemes, ok, before the text 44 MiB, with it 101 MiB, peak 574 MiB, 165 bytes per lexeme
  empty strings: 2000005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1054 MiB, 524 bytes per lexeme
  flow sequences of an alias, ten deep: 2869567 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 2268 MiB, 808 bytes per lexeme
  flow sequences of an alias, 280 deep: 2994355 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 2397 MiB, 820 bytes per lexeme
  nested empty flow sequences, 280 deep: 2999672 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 2397 MiB, 818 bytes per lexeme
  runs of commas (not valid YAML): 3000005 lexemes, parse-error, before the text 44 MiB, with it 54 MiB, peak 2735 MiB, 937 bytes per lexeme
  nested flow maps with commas (not valid YAML): 3000002 lexemes, parse-error, before the text 44 MiB, with it 56 MiB, peak 1592 MiB, 537 bytes per lexeme
  text cost: one scalar of 10000000 bytes, ok, 1.04 resident bytes per byte of text
  most bytes per lexeme: 937; largest baseline before the text: 45 MiB
```

A complete run afterwards, with the derived limit built in (its part 1 gave 935 at most, below the 937 used):

```
node v22.23.2, darwin arm64
1. memory per lexeme (39 shapes, about 3 MB each, node, lexeme and depth limits lifted; every lexeme counted):
  anchored block items: 2999998 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 480 MiB, 148 bytes per lexeme
  anchored and tagged block items: 2076922 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 336 MiB, 141 bytes per lexeme
  tagged block items: 2100001 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 366 MiB, 155 bytes per lexeme
  block items: 3750001 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 660 MiB, 169 bytes per lexeme
  flow numbers: 4500005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1499 MiB, 337 bytes per lexeme
  flow tagged numbers: 1875005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 550 MiB, 277 bytes per lexeme
  flow anchored numbers: 3000005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 823 MiB, 268 bytes per lexeme
  aliases in a flow sequence: 2000021 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1322 MiB, 664 bytes per lexeme
  block keys: 2370663 lexemes, ok, before the text 44 MiB, with it 94 MiB, peak 505 MiB, 182 bytes per lexeme
  explicit keys: 2539991 lexemes, ok, before the text 44 MiB, with it 90 MiB, peak 481 MiB, 161 bytes per lexeme
  quoted strings: 1500005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 797 MiB, 519 bytes per lexeme
  empty flow maps: 3000005 lexemes, ok, before the text 43 MiB, with it 55 MiB, peak 1411 MiB, 474 bytes per lexeme
  empty flow sequences: 3000005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1356 MiB, 455 bytes per lexeme
  null values in a flow map: 2612571 lexemes, ok, before the text 44 MiB, with it 102 MiB, peak 554 MiB, 181 bytes per lexeme
  three documents of empty flow maps: 3000019 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1261 MiB, 421 bytes per lexeme
  three documents of empty flow sequences: 3000019 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1236 MiB, 413 bytes per lexeme
  comment lines: 3000008 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 362 MiB, 107 bytes per lexeme
  comments in a flow sequence: 3000010 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 367 MiB, 109 bytes per lexeme
  newlines in a flow sequence: 3000006 lexemes, ok, before the text 44 MiB, with it 54 MiB, peak 321 MiB, 93 bytes per lexeme
  newline and space in a flow sequence: 3000006 lexemes, ok, before the text 44 MiB, with it 54 MiB, peak 321 MiB, 93 bytes per lexeme
  blank lines in a block mapping: 3000015 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 301 MiB, 86 bytes per lexeme
  comments between block items: 3500001 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 529 MiB, 142 bytes per lexeme
  empty flow maps and newlines: 3000006 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 869 MiB, 284 bytes per lexeme
  nested empty flow sequences, four deep: 3000002 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 2015 MiB, 685 bytes per lexeme
  nested empty flow sequences, two deep: 3000005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1753 MiB, 593 bytes per lexeme
  flow sequences of one number: 3750005 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1933 MiB, 525 bytes per lexeme
  flow sequences of an empty map: 3000005 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1792 MiB, 607 bytes per lexeme
  flow maps of an empty sequence: 3375005 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1147 MiB, 339 bytes per lexeme
  flow sequences of an alias: 2400019 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1759 MiB, 744 bytes per lexeme
  flow maps of an alias: 3000019 lexemes, ok, before the text 44 MiB, with it 57 MiB, peak 1118 MiB, 371 bytes per lexeme
  merge keys: 2666689 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1022 MiB, 380 bytes per lexeme
  aliases of a map: 2000025 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 1322 MiB, 664 bytes per lexeme
  flow key-value pairs: 3000006 lexemes, ok, before the text 44 MiB, with it 102 MiB, peak 574 MiB, 165 bytes per lexeme
  empty strings: 2000005 lexemes, ok, before the text 44 MiB, with it 55 MiB, peak 1054 MiB, 524 bytes per lexeme
  flow sequences of an alias, ten deep: 2869567 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 2266 MiB, 808 bytes per lexeme
  flow sequences of an alias, 280 deep: 2994355 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 2396 MiB, 820 bytes per lexeme
  nested empty flow sequences, 280 deep: 2999672 lexemes, ok, before the text 44 MiB, with it 56 MiB, peak 2397 MiB, 818 bytes per lexeme
  runs of commas (not valid YAML): 3000005 lexemes, parse-error, before the text 44 MiB, with it 54 MiB, peak 2730 MiB, 935 bytes per lexeme
  nested flow maps with commas (not valid YAML): 3000002 lexemes, parse-error, before the text 44 MiB, with it 55 MiB, peak 1592 MiB, 537 bytes per lexeme
  text cost: one scalar of 10000000 bytes, ok, 1.04 resident bytes per byte of text
  most bytes per lexeme: 935; largest baseline before the text: 44 MiB
2. depth capacity (--jitless, half the default stack in use; nesting levels composed):
  flow sequences: 288 (stack 9183 probe frames, 4591 in use)
  flow mappings: 287 (stack 9183 probe frames, 4591 in use)
  tagged flow sequences: 288 (stack 9183 probe frames, 4591 in use)
  anchored flow sequences: 288 (stack 9183 probe frames, 4591 in use)
  block mappings: 320 (stack 9183 probe frames, 4591 in use)
  block sequences: 339 (stack 9183 probe frames, 4591 in use)
  compact block sequences: 339 (stack 9183 probe frames, 4591 in use)
  alternating flow mappings and sequences: 287 (stack 9183 probe frames, 4591 in use)
  smallest: 287
3. cost at the limits (child heap --max-old-space-size=2384; each file is the largest the limits accept, or one unit over):
  empty flow maps, several documents: 2581625 bytes, 2581625 lexemes, 3213 ms, ok, 1 documents, peak RSS 1212 MB
  empty flow sequences, several documents: 2581625 bytes, 2581625 lexemes, 3214 ms, ok, 1 documents, peak RSS 1190 MB
  flow numbers, several documents: 1721086 bytes, 2581625 lexemes, 2650 ms, ok, 1 documents, peak RSS 877 MB
  quoted strings, several documents: 5163244 bytes, 2581626 lexemes, 3399 ms, ok, 1 documents, peak RSS 1313 MB
  aliases, several documents: 3872472 bytes, 2581665 lexemes, 3999 ms, ok, 2 documents, peak RSS 1281 MB
  anchored block items, several documents: 2581618 bytes, 2581617 lexemes, 2376 ms, ok, 1 documents, peak RSS 413 MB
  tagged block items, several documents: 3688024 bytes, 2581617 lexemes, 2456 ms, ok, 1 documents, peak RSS 432 MB
  comment lines: 2581623 bytes, 2581626 lexemes, 2135 ms, ok, 1 documents, peak RSS 330 MB
  newlines in a flow sequence: 2581622 bytes, 2581624 lexemes, 1895 ms, ok, 1 documents, peak RSS 294 MB
  newline and space in a flow sequence: 2581622 bytes, 2581624 lexemes, 1717 ms, ok, 1 documents, peak RSS 279 MB
  comments between block items: 2212494 bytes, 2581244 lexemes, 2344 ms, ok, 1 documents, peak RSS 404 MB
  nested empty flow sequences, four deep: 2581622 bytes, 2581622 lexemes, 4676 ms, ok, 1 documents, peak RSS 1738 MB
  nested empty flow sequences, two deep: 2581623 bytes, 2581623 lexemes, 4283 ms, ok, 1 documents, peak RSS 1499 MB
  flow sequences of an empty map: 2581623 bytes, 2581623 lexemes, 4174 ms, ok, 1 documents, peak RSS 1534 MB
  flow maps of an alias: 2581635 bytes, 2581637 lexemes, 3210 ms, ok, 1 documents, peak RSS 976 MB
  minimal object documents: 4241062 bytes, 2581517 lexemes, 2848 ms, ok, 92197 documents, peak RSS 98 MB
  newlines in a flow sequence, one unit over: 2585728 bytes, 2585730 lexemes, 1804 ms, too-large (file memory), peak RSS 293 MB
4. yaml package duplicate-key check (uniqueKeys on), distinct block keys:
  10000 keys: 705 ms with the check, 71 ms without
  20000 keys: 2189 ms with the check, 137 ms without
  40000 keys: 8898 ms with the check, 260 ms without
   yaml package conversion of nested collection keys ({? {? ... x}}):
  100 levels: 22 ms
  200 levels: 77 ms
  300 levels: 796 ms
```

Part 3 again with the comma run at the limit added (`node scripts/measure-limits.mjs --part3`):

```
node v22.23.2, darwin arm64
3. cost at the limits (child heap --max-old-space-size=2384; each file is the largest the limits accept, or one unit over):
  empty flow maps, several documents: 2581625 bytes, 2581625 lexemes, 3185 ms, ok, 1 documents, peak RSS 1213 MB
  empty flow sequences, several documents: 2581625 bytes, 2581625 lexemes, 3186 ms, ok, 1 documents, peak RSS 1190 MB
  flow numbers, several documents: 1721086 bytes, 2581625 lexemes, 2691 ms, ok, 1 documents, peak RSS 875 MB
  quoted strings, several documents: 5163244 bytes, 2581626 lexemes, 3461 ms, ok, 1 documents, peak RSS 1314 MB
  aliases, several documents: 3872472 bytes, 2581665 lexemes, 3965 ms, ok, 2 documents, peak RSS 1270 MB
  anchored block items, several documents: 2581618 bytes, 2581617 lexemes, 2429 ms, ok, 1 documents, peak RSS 416 MB
  tagged block items, several documents: 3688024 bytes, 2581617 lexemes, 2383 ms, ok, 1 documents, peak RSS 431 MB
  comment lines: 2581623 bytes, 2581626 lexemes, 2152 ms, ok, 1 documents, peak RSS 330 MB
  newlines in a flow sequence: 2581622 bytes, 2581624 lexemes, 1961 ms, ok, 1 documents, peak RSS 295 MB
  newline and space in a flow sequence: 2581622 bytes, 2581624 lexemes, 1689 ms, ok, 1 documents, peak RSS 292 MB
  comments between block items: 2212494 bytes, 2581244 lexemes, 2413 ms, ok, 1 documents, peak RSS 405 MB
  nested empty flow sequences, four deep: 2581622 bytes, 2581622 lexemes, 4639 ms, ok, 1 documents, peak RSS 1738 MB
  nested empty flow sequences, two deep: 2581623 bytes, 2581623 lexemes, 4373 ms, ok, 1 documents, peak RSS 1498 MB
  flow sequences of an empty map: 2581623 bytes, 2581623 lexemes, 4117 ms, ok, 1 documents, peak RSS 1538 MB
  flow maps of an alias: 2581635 bytes, 2581637 lexemes, 3152 ms, ok, 1 documents, peak RSS 977 MB
  a run of commas (not valid YAML): 2581621 bytes, 2581623 lexemes, 19863 ms, parse-error, peak RSS 2365 MB
  minimal object documents: 4241062 bytes, 2581517 lexemes, 2822 ms, ok, 92197 documents, peak RSS 98 MB
  newlines in a flow sequence, one unit over: 2585728 bytes, 2585730 lexemes, 2676 ms, too-large (file memory), peak RSS 294 MB
```

What this shows (always of the shapes measured; another shape could cost more):
- **Of the 39 shapes measured for memory per lexeme, the worst cost 937 bytes per lexeme** (a run of commas, refused as not valid YAML after the parser built it), and the limit is derived from it. Of the 18 shapes built at the limit, the worst accepted file peaked at 1,738 MB in 4.6 s (nested empty flow sequences), and the worst of all, the refused comma run, at 2,365 MB in 19.9 s, about 99% of the derived heap: the derivation leaves almost no margin above the worst shape measured, by construction. No shape crashed with the derived 2,384 MiB heap. The third review's shape (nested empty flow sequences, 3.52 million lexemes, 2,335 MiB) is now over `lexemesPerFile` and refused by name.
- On a machine or container with a smaller heap than the reference runner's, the bound does not hold, and nothing claims it does.
- **The depth refusal is deterministic.** Every shape refuses at the pre-scan once over 287 levels, below the parser's stack in every shape measured, the same in all runs.
- The node count and the lexeme count are both applied while lexing, so a document over the one or a file over the other is refused before the yaml package composes anything.
- The measured cost of a byte of text (1.04 resident bytes per byte for a Latin-1 scalar) is below the derived reserve of 3 bytes per byte.

## The parser's own stack

The yaml package (2.9.1) composes documents recursively, so its capacity depends on the stack left by the caller and on how V8 compiled the frames: measured with optimised code it moved between runs and with the caller's depth (the review reproduced a 500-level file accepted at one call depth and refused at another). The derived limit above is measured where frames are largest (`--jitless`) and with half the default stack already in use, so the pre-scan refuses before the parser can run out. The parser's error (`RESOURCE_EXHAUSTION`) and a `RangeError` remain mapped to the same `too-deep` refusal as a backstop, through preallocated results, so even a call that starts with almost no stack left returns a refusal instead of throwing (a test calls the reader from every depth near the end of a child process's stack).

## Why the yaml package's own guards are not used

Two of its paths grow faster than the input, as part 4 above shows: its duplicate-key check compares each new key with every earlier one (quadratic: doubling the keys roughly quadruples the time, so a 10 MB file of a million keys would take hours), and its conversion of collection-valued keys stringifies each level again (100, 200, 300 nested `{? ...}` keys: superlinear). Its alias resolution also scans the document once per alias (read in its source, `nodes/Alias.js`, 2026-11-15). BoundedReader therefore turns the duplicate-key check off and detects duplicates itself with a set, refuses non-scalar keys (Kubernetes' JSON has none), and resolves aliases itself in one pass in document order, sharing the aliased value and counting its size.
