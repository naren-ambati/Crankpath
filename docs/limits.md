# Limits (OD-5): what each protects, what it is derived from, and what is not derived yet

Written in B0 (2026-11-15); the render limits derived in B2 step 0 (2026-11-15). Rule (OD-5, FR1.4, NFR5): no limit is picked. Each is derived from what it protects (two derivations rest on a stated choice, named in their rows: the half-stack reserve of `nestingDepth` and the reference machine of `lexemesPerFile`), from a dated lookup (`docs/lookups.md`) or a measurement made with a committed script, and a limit hit is a named, counted refusal, never silence and never a crash. A limit whose basis needs a real render or a measurement not made yet is **not yet derived**: in code (`src/u1-graph-model/limits.ts`) it has no value at all, so no unit can use it as a number (the type forbids it; `test/u1-graph-model/limits.test.ts` proves it). A test keeps this table and the code in step.

These limits bound what one run reads and computes. What static analysis cannot see at all, whatever the limits, is in [what static analysis cannot see](what-it-cannot-see.md).

## The table

| Limit | Value | Unit | Protects | Derived from (lookup or measurement, 2026-11-15) | Enforced by |
|---|---|---|---|---|---|
| `fileBytes` | 10,000,000 | bytes | memory and parse time of one repository file | Argo CD v3.6.1 repo-server default `--max-combined-directory-manifests-size` "10M", a Kubernetes quantity (`resource.ParseQuantity`): 10,000,000 bytes. No file of a directory-type Application can exceed what Argo CD reads for the whole directory at its defaults. This is a default of a configurable flag that governs one Application type (the review noted it, m2): Helm 4.3.2 has no per-file limit (`MaxDecompressedFileSize` "is no longer used internally"; 100 MiB per chart) and no Flux per-file limit was found, so a larger file there is a named `too-large` outcome. | BoundedReader: an early exit from lstat, then a bounded read that stops one byte past the limit and refuses a file that grew while read |
| `documentsPerFile` | 217,391 | documents | per-document cost of a file of many tiny or empty documents | `fileBytes` / 46: 46 bytes is the shortest document that can describe one named Kubernetes object (`---`, `apiVersion: v1`, `kind: X`, `metadata:`, ` name: a`, with newlines). A file within `fileBytes` cannot hold more object-bearing documents. | BoundedReader, counted while parsing, before composing |
| `nestingDepth` | 287 | levels | the parser's stack, so that a deep file is refused by this count and never by stack exhaustion (the same file gets the same answer on every run) | the smallest nesting the yaml package 2.9.1 composed over eight shapes with V8's interpreter only (`--jitless`, the largest frames and so the lowest capacity) and half of Node 22.23.2's default stack already in use (the half is kept for crankpath's own callers, a stated reserve): 287 levels, the same in two runs (`scripts/measure-limits.mjs`, part 2). go-yaml v2.4.2, the decoder Kubernetes uses, allows 10,000 (`max_flow_level`, `max_indents`): a file between 287 and 10,000 levels is valid to Kubernetes and refused by crankpath, by name. The deepest real file in the five estates has 14. | BoundedReader: the CST parser's explicit stack length, checked per lexeme before anything is composed; the yaml package's own stack-exhaustion error and a `RangeError` remain mapped to the same `too-deep` as a backstop |
| `expandedNodesPerDocument` | 1,572,864 | nodes | walk time and size of one document after alias and merge-key expansion (alias bombs) | kube-apiserver `MaxRequestBodyBytes` 3 MiB (k8s.io/apiserver `pkg/server/config.go`: `int64(3 * 1024 * 1024)`) / 2 bytes, the smallest JSON encoding of one value node (`0,`). An object with more nodes cannot be sent to the API server. It does not bound the parser's memory: `lexemesPerFile` does, and it binds first for dense flow style: a document of 1,572,864 one-character values written `[0,0,...]` costs three lexemes per value (4.7 million) and is refused `file memory`, a stated trade-off with a test (`bounded-reader.test.ts`); ordinary manifests are far below either (the third review measured a 5 MB CRD-shaped bundle at 746,207 lexemes). | BoundedReader: counted while lexing (every lexeme that starts a node) and again while converting (aliases expanded by size, never copied); `alias-limit` when the document has aliases, `too-large` otherwise |
| `lexemesPerFile` | 2,585,714 | lexemes | the reader's memory for one file: the yaml package's syntax trees and the converted values of all its documents | (the default old-generation heap V8 12.4 gives Node 22 on the smallest GitHub-hosted runner, `ubuntu-slim` with 5 GB: 5,000,000,000 / 4 x 2 = 2,500,000,000 bytes; minus the reader's largest measured baseline before the text exists, 45 MiB; minus a reserve for the text, 3 x `fileBytes`: the read buffer plus a decoded string of at most 2 bytes per input byte) / 937 bytes, the worst resident memory per lexeme of the 39 shapes measured (`scripts/measure-limits.mjs`, part 1: several documents, comments, whitespace, nested collections and invalid YAML included; the worst was a run of commas, which the parser refuses only after spending the memory). The worst of the shapes measured, not a proven maximum. The reference machine and the text reserve are stated choices of the derivation. | BoundedReader: counted while lexing, over the whole file, before any document is composed; `too-large` (detail `file memory`) |
| `quotedTextChars` | 381 | characters | line length and output size of quoted repository text | the longest canonical node id `Kind/namespace/name`: kind 63 (a CRD kind lower-cased must be a DNS-1035 label: apiextensions `validation.go`), namespace 63 (DNS-1123 label), name 253 (DNS-1123 subdomain), Kubernetes "Object Names and IDs": 63 + 1 + 63 + 1 + 253. No valid id is ever cut. | SafeText: cut on a code-point boundary with `... (cut at 381 of N characters)` |
| `generatedApplicationsPerApplicationSet` | 96,638 | applications | the run's memory and time spent on one ApplicationSet's generated Applications, counted while they are generated (B3 step 0) | every generated Application is an object of the run, charged the measured 6,678 bytes per object and 4,665 bytes per string value (B1, "Per-run limits" below), and every Application holds at least four strings (apiVersion, kind, `metadata.name`, `metadata.namespace`): `runMemory` 2,448,619,776 / (6,678 + 4 x 4,665) = 96,638. A ceiling for the smallest possible Application only; a real template's size is bounded by the in-loop budget charge and by `generatorRenderSteps` (B3 review M1). Argo CD's `--max-resources-status-count` default 5000 (v3.6.1) is a status-recording default, not a generation ceiling, and is not used. | GeneratorExpander: before each Application is built it is charged to the run budget with its real string values (the template's plus apiVersion, kind and namespace); a refusal stops the generation, keeps the ones built and makes the ApplicationSet opaque `limit` (detail `the run's memory budget was reached while its Applications were generated`); the count is checked too (detail `generated Applications over the limit`); counts are a floor |
| `mermaidMaxEdges` | 500 | edges | a diagram the renderer refuses to draw | Mermaid 12.3.0 config schema (`packages/mermaid/src/schemas/config.schema.yaml`): `maxEdges` default 500. | the Mermaid renderer (B6) |
| `mermaidMaxTextChars` | 50,000 | characters | a diagram text the renderer refuses to parse | Mermaid 12.3.0 config schema: `maxTextSize` default 50000. | the Mermaid renderer (B6) |
| `explainElementaryCycles` | 21 | cycles | readability of `--explain` (the elementary cycles of one component fit one screen) and the time spent finding them (each costs at most one pass over the component) | a VT100 screen is 24 lines (VT100 User Guide, chapter 1); the listing of one component's elementary cycles uses 3 of them for itself (its heading line, its stop line, and the shell prompt after the output): 24 - 3 = 21 (derived in B6). The output is sized by this bound (B6 review m5): it counts entries, one per cycle; each cycle's line shows at most `explainListEntries` nodes, so a long cycle's line wraps to a few lines; the whole output is bounded separately by `explainOutputLines`. | `--explain` (bounded enumeration of elementary cycles; the output says when it stopped) |
| `explainListEntries` | 21 | entries | readability and size of each list of one-line entries `--explain` prints (a cycle's nodes, the nodes shown for one elementary cycle, a node's dependents, its unresolved items, the self-management notes, cranks and blockers) (B6 review m4, pass 2 M1) | the same basis as `explainElementaryCycles`: one 24-line screen less the 3 lines a listing uses for itself. Edge entries take four lines and have their own bound, `explainEdgeEntries`. | `--explain`, through one capped-list helper: a longer list shows its first entries, says how many it left out, and points to the JSON output only for what the JSON carries (the self-management observations are only in `--explain`, so those are counted as not printed) |
| `explainEdgeEntries` | 5 | entries | readability of the evidence lists of `--explain` (a cycle's edges, a node's dependencies): they fit one screen (B6 review pass 2, m4) | (24 - 3) / 4, rounded down: one screen less the listing's own lines, divided by the 4 lines an edge entry prints (the edge, its file and line, its field, its rendered path). A wrapped long value can still push a list past the screen. | `--explain`: the first 5 edges with their evidence, then how many more are in the JSON output |
| `explainOutputLines` | 1,024 | lines | the whole of one `--explain` output stays in a terminal's default scrollback, so it can be read back to its first line (B6 review m4) | xterm(1), resource `saveLines`: the lines kept above the screen default to 1024 (lookup 2026-11-15). Counted at 80 columns: a wider terminal shows fewer lines, a narrower one more, and a file has no scrollback at all (pass 2, n2). | `--explain`: whole explanations while they fit at 80 columns, then a stop line saying what was left out; an explanation's own closing lines (self-management, the nodes it blocks, the plan step), the plan's assumptions and the not-modelled list are always printed |
| `declaredEntries` | 1,572,864 | entries | work and output size the scanned repo's `crankpath.yaml` can cause through the number of its entries (B5 review M3) | the same basis as `expandedNodesPerDocument`: `crankpath.yaml` is one document of at most that many nodes, and every entry of every section (an external, a match entry, a repos entry, an edge, a crank, one `creates` or `reroutes` target, a cluster, one label or annotation) is at least one node of it, so no admitted file holds more. Every analysis step over the entries is linear (indexed: no lookup scans a list), so the count bounds the work. | ConfigReader counts the entries after validation and refuses the file by name ("more entries than the limit") |
| `hostPatternComparisons` | 1,572,864 | steps | the time a run spends comparing hosts with `match:` entries that hold a wildcard (B5 review M3; time bound since pass 2) | the same basis as `expandedNodesPerDocument`: the wildcard work the `match:` entries of one admitted file may cause is held to the nodes one admitted document may hold, counted in steps actually done: one per entry consulted, a literal label's length, a wildcard label's pattern length times label length (the matcher's own table). Entries without a wildcard are looked up by host and cost nothing; wildcard entries are indexed by label count and literal suffix, so a host consults only the entries whose literal suffix it ends in; a host is compared once however often it is queried. | HostMatcher charges each step; a spent budget stops the remaining wildcard work and is a counted `match-limit` item that leaves every node unverified |
| `filesPerScan` | 279,235 | files | the memory and time of the file lists a scan holds: a file the run budget charges nothing for by its bytes (an empty file, a file discovery does not read) still costs every walk that lists it (B3 step 0) | `runMemory` 2,448,619,776 / (577 bytes, the measured worst cost of a walked file the budget does not charge by its bytes: `scripts/measure-scan-limits.mjs`, an empty `.yaml` file walked, read, parsed and cached, the worst of three shapes, below; + 8,192 bytes for its path at the longest a walk can list: Linux `PATH_MAX` 4,096 bytes, `<linux/limits.h>`, at 2 bytes per UTF-16 code unit). No tool or host publishes a file-count ceiling for a repository (GitHub recommends at most 3,000 entries per directory and a depth of 50, which bound no total). | every walk of the scan counts against it (discovery, each render's listing, each git generator's listing; a directory listed twice counts twice), and each walked file is also charged to the run budget at 577 bytes plus 2 bytes per character of its path, so the budget binds first when other things fill it; a refusal stops that listing and is a named, counted unreadable entry (`file count limit reached` or `run budget reached`, the rest of the listing not seen), so the counts are a floor |
| `generatorPatternSteps` | 1,572,864 | steps | the time one ApplicationSet's git generator spends matching its path patterns against the repository's paths (B3) | the same basis as `expandedNodesPerDocument` and `hostPatternComparisons`: the matching work the patterns of one admitted document may cause is held to the nodes one admitted document may hold, counted in steps actually done (one per comparison, plus pattern length times path length for the matcher's table, which never backtracks). Directory patterns consult only the paths of their own depth under their first literal segment. | GeneratorExpander charges each step; a spent budget stops the expansion and the ApplicationSet is opaque `limit` (detail `path matching over the limit`) |
| `repoFetchWallClock` | 90,000 | milliseconds | the time one fetch takes, all its git calls together: the clone, then the verification and checkout of what it got (B3; reworded in review pass 2, m4). With `fetchesPerRun` it is the whole bound on the time a run spends fetching: at most `fetchesPerRun` × `repoFetchWallClock` = 33 × 90 s = 49.5 minutes | Argo CD v3.6.1 stops every command it runs, git included (`util/git/client.go` runs git through `util/exec`), after `ARGOCD_EXEC_TIMEOUT`, default `90 * time.Second` (`util/exec/exec.go`). crankpath gives one fetch that time in all (each git call gets what is left), so a repository Argo CD at its defaults fetches in one command is within it, and no fetch takes longer however many calls it makes. | the git runner: one deadline per fetch; the process-group helper kills git's whole group with SIGKILL when it passes, and the call returns once the group is gone; the fetch is `unreadable-repo` with the detail `timed out`, unknown whether the repository exists |
| `gitOutputBytes` | 10,000,000 | bytes | memory held by one git command's standard output and error, kept only to classify a failure and never shown (B3) | `fileBytes`: the output of a git command is held like one repository file and is never larger than the largest file crankpath reads. git publishes no output size; its packet lines are at most 65,520 bytes each (`LARGE_PACKET_MAX`, `pkt-line.h`) with no bound on their number. | the process-group helper counts each stream's bytes and kills git's whole group the moment one passes it (review pass 2, m1; the caller's `maxBuffer` is never the one to overflow); over it the fetch is `unreadable-repo`, detail `git's output was over the limit` |
| `generatorRenderSteps` | 1,224,309,888 | steps | the time and memory one ApplicationSet's template rendering takes: its parameter sets times its template's size (B3 review M1) | `runMemory` / 2 bytes per UTF-16 code unit: the text the rendering of one set produces cannot be more than the run can hold as strings. Counted in steps actually done, shared by every Application of the set: one per template node visited, one per character a templated string produces, checked while the string is built (a single substitution of a long value stops as soon as it passes the bound). | GeneratorExpander; a spent budget stops the expansion: the ApplicationSet is opaque `limit` (detail `template rendering work over the limit`) |
| `fetchedRepoBytes` | 74,200,599 | bytes | the disk one fetched repository takes (the files a run writes from it; while it is read, its object store and their copy), and a scan that could not read it anyway (B3 review m5; checked before anything is written since pass 3, M1) | `runMemory` / 33 bytes, the run budget's measured charge per byte of a file held parsed: a run cannot hold more of a repository's files than this, so a larger repository is refused rather than half-read. Measured against it, each on its own, with the file count against `filesPerScan`: the object store a clone wrote; the object files copied from a store before git verifies them; the sum of the sizes `git ls-tree -r -l -z HEAD` lists for the commit's files, and the listing's own size, before `checkout-index` writes a byte; and, as a backstop, the files `checkout-index` wrote. | RepoFetcher: the store after git ends (`repoFetchWallClock` bounds the clone while it runs), the copy as it is made, the listing before the write, the written files after it; over either bound a counted `limit` (opaque reason `limit` for a `repos:` entry; exit 1 for a URL on the command line) |
| `fetchesPerRun` | 33 | fetches | the disk and time one run's fetches take: the command line's URL and every `repos:` entry together, reads from the cache included, so a scanned repository naming many cannot make a run fetch or write without end (B3 review pass 2, M2; the disk bound stated in pass 3, m5) | floor(`runMemory` / `fetchedRepoBytes`) = floor(2,448,619,776 / 74,200,599). What a fetch keeps in the run directory for the rest of the run is its written files, at most `fetchedRepoBytes`: its object store and their copy are removed once the files are written (or the store is moved to the cache). So the run directory holds at most 33 × 74,200,599 = 2,448,619,767 bytes, about `runMemory`, the run's one size figure, taken as its disk bound too; while one fetch is read, at most two more `fetchedRepoBytes` (its store and their copy) are on disk. A trusted cache grows by at most the same per run. Time: at most `fetchesPerRun` × `repoFetchWallClock` = 49.5 minutes. | RepoFetcher, through one allowance per run shared by every fetcher of the run: a fetch past it starts no process and is a counted `limit` (opaque reason `limit`, detail `not fetched: the run has made fetchesPerRun (33) fetches`, for a `repos:` entry) |
| `renderWallClock` | 90,000 | milliseconds | a render subprocess that never ends (a backstop only, OD-30: a job it stops is opaque `limit`, detail `timeout`, counted, and the status line says the output may differ on a rerun) | Argo CD v3.6.1 repo-server stops a helm or kustomize command after `ARGOCD_EXEC_TIMEOUT`, default `90 * time.Second` (`util/exec/exec.go`; `docs/operator-manual/high_availability.md`: "enforces a 90 second timeout"). A render that takes longer fails in Argo CD itself at its defaults. Need: the slowest first real render took 254 ms (below; 882 ms in a run on a loaded machine). | the command runner (B2): `spawnSync` `timeout`, killed with SIGKILL, never retried |
| `renderStdoutBytes` | 104,857,600 | bytes | memory held by one render's standard output | Argo CD v3.6.1 `MaxGRPCMessageSize` (`reposerver/apiclient/clientset.go`: `ARGOCD_GRPC_MAX_SIZE_MB` default 100, times 1024 * 1024): the repo-server cannot hand the controller a larger manifest response for one source at its defaults. Argo CD sends the manifests as JSON and crankpath measures helm's YAML; the two differ in size, so this is the controller's bound applied to the nearest thing crankpath sees. Need: 5,312,383 bytes, the largest first real render (kube-prometheus-stack 93.3.0 with CRDs). | the command runner (B2): `maxBuffer`, then a byte check per stream; `over cap` |
| `renderStderrBytes` | 104,857,600 | bytes | memory held by one render's standard error (read only to classify a failure; never shown) | the same bound as `renderStdoutBytes`: Node's `spawnSync` holds both streams under one `maxBuffer`, so the memory a call can hold for standard error is the standard-output bound whatever smaller number were written here; no tool publishes a size for its error stream. Need: 0 bytes in every successful first real render. | the command runner (B2) |
| `renderedObjects` | 65,536 | objects | graph size from one render | no GitOps controller can track more objects from one source than its status lists in one etcd object: etcd v3.7.3 `DefaultMaxRequestBytes = 1.5 * 1024 * 1024` (1,572,864 bytes) / 24 bytes, the shortest Flux kustomize-controller v1.10.1 inventory entry (`ResourceRef {id: "<namespace>_<name>_<group>_<kind>", v: version}`; a cluster-scoped core object: `{"id":"_a__X","v":"v1"},`). Argo CD v3.6.1's shortest `ResourceStatus` with its non-empty kind, name and version is 39 bytes (`{"version":"v1","kind":"X","name":"a"},`), a smaller bound (40,329); the larger is kept so nothing either controller can apply is cut. Need: 136 objects, the most in one first real render. | the rendered-output parser (B2), counting `List` items; a hit keeps no object of that render |
| `renderedDocumentBytes` | 3,145,728 | bytes | parse memory and time of one document of a render's output | kube-apiserver `MaxRequestBodyBytes` 3 MiB (`k8s.io/apiserver` `pkg/server/config.go`): a rendered object larger than this cannot be sent to the API server, so a larger document is a named `limit` outcome. | the rendered-output parser (B2), before the document is parsed |
| `lexemesPerRender` | 2,282,007 | lexemes | crankpath's own memory and time while it parses one render's output: the yaml package's syntax trees and the converted values of all its documents | `lexemesPerFile`'s derivation with a render's output in place of a file (B2 review M4): (2,500,000,000 bytes, the default old-generation heap V8 12.4 gives Node 22 on `ubuntu-slim`; minus the reader's measured baseline, 45 MiB; minus a reserve for the output text, 3 x `renderStdoutBytes`: the output buffer plus a decoded string of at most 2 bytes per byte) / 937 bytes, the worst resident memory per lexeme measured (`scripts/measure-limits.mjs`, part 1). Every lexeme of every document of the output counts. | the rendered-output parser (B2): counted over the whole output before anything is parsed, and the parse's transient (lexemes x 937 + bytes x 3) then checked against the run's budget; a hit is `limit` (detail "its output is over the parse budget of one render") with no object kept |

## Render limits: first real renders and the cost at the limits (B2 step 0, OD-5, OD-7)

`npm run build && node scripts/measure-renders.mjs <chart>=<releases> ...` on 2026-11-15, with the
charts fetched read-only by `helm pull` into a cache outside the repository (`docs/lookups.md`; no
template or rendered output of any of them is committed). Part 1 renders each chart with the
installed helm through crankpath's own CommandRunner (allowlist, environment, caps), five times;
part 2 parses synthetic outputs of at most `renderStdoutBytes` with the built rendered-output
parser and rendered-set builder, each in its own child process. Output of that run:

Measured output of `node scripts/measure-renders.mjs`, run 2026-11-15:

```measurement
node v22.23.2, darwin arm64, helm v4.3.2, kustomize v5.8.1
first real renders (helm template --include-crds, 5 runs each):
  vault 0.34.1 as vault: ok, 47/48/56 ms, stdout 16590 bytes, stderr 0 bytes, 13 objects
  vault 0.34.1 as platform-secrets: ok, 46/47/50 ms, stdout 17308 bytes, stderr 0 bytes, 13 objects
  kube-prometheus-stack 93.3.0 as monitoring: ok, 153/156/202 ms, stdout 5312383 bytes, stderr 0 bytes, 136 objects
  argo-cd 10.18.0 as argocd: ok, 162/163/186 ms, stdout 2135393 bytes, stderr 0 bytes, 60 objects
  cert-manager v1.21.3 as cert-manager: ok, 62/62/74 ms, stdout 44659 bytes, stderr 0 bytes, 44 objects
  external-secrets 2.15.0 as external-secrets: ok, 135/136/149 ms, stdout 2046197 bytes, stderr 0 bytes, 44 objects
  cilium 1.20.4 as cilium: ok, 201/241/254 ms, stdout 68638 bytes, stderr 0 bytes, 25 objects
cost at the limits (synthetic outputs of at most renderStdoutBytes = 104857600 bytes):
  minimal objects (over the object limit): 104857555 bytes, 681 ms, refused (over-parse-budget), peak RSS 361 MB
  objects of one long string each (3 MiB documents): 103804635 bytes, 2850 ms, 33 objects built, 0 documents refused, peak RSS 553 MB
  flow sequences of numbers (3 MiB documents, nodes at the limit): 103804470 bytes, 541 ms, refused (over-parse-budget), peak RSS 360 MB
  small mappings in a block sequence (3 MiB documents): 104747962 bytes, 735 ms, refused (over-parse-budget), peak RSS 362 MB
  one document of the whole output (over the document limit): 104857600 bytes, 492 ms, 0 objects built, 1 documents refused, peak RSS 447 MB
```

Run again on 2026-11-15 after B2's merge of `main` (the output above): `lexemesPerRender` is
re-derived with B0's final figures (937 bytes per lexeme, a 45 MiB baseline: 2,282,007), and an
output's lexemes are counted before any document is parsed, so output over it is refused without
building a syntax tree. Before the B2 review's M4 fix the two node-dense shapes were parsed in
full: 210 s and 3.6 GB peak, and 256 s and 2.8 GB (first run), and 345 s and 3.0 GB, and 248 s and
3.0 GB (a run while the test suite ran); after M4 and before this merge they stopped in 2.2 s and
4.5 s (0.7 and 1.5 GB).

What the run shows:
- **Need against the limits.** The slowest real render took 254 ms against a 90,000 ms backstop;
  the largest wrote 5,312,383 bytes against 104,857,600; the most objects was 136 against 65,536.
  No real render wrote to standard error. These are first timings (OD-7), not a budget.
- **Cost at the limits.** Every synthetic output at `renderStdoutBytes` now ends within about 3 s
  and 0.56 GB peak resident memory on this machine: past the parse budget (counted without a
  parse, under 1 s), past the document limit, or built in full (documents of long strings, 2.9 s).
  The minimal-object shape now meets the parse budget before the object limit. On top of these,
  each render is charged to the run's budget (`Per-run limits` below): its parse transient must fit
  in what the run has not yet held before it is parsed, then its bytes are held.

## What the render limits do not cover (OD-29, B2 review passes 2 and 3)

- **Redirects and addresses.** crankpath checks every chart repository URL it reads (https or
  `oci://`, a host name, never an IP literal, a loopback or link-local name, the name lower-cased,
  in punycode and without a trailing dot) before helm sees it, and gives helm no credential. helm
  follows the repository's redirects itself, and a name can resolve to a private or loopback address
  (DNS rebinding): neither is checked. Both are printed in the report's not-modelled line whenever
  helm rendered.
- **The closed proxy.** `helm template` and `kustomize build` run with `HTTP_PROXY`, `HTTPS_PROXY`
  and `ALL_PROXY` set to `http://127.0.0.1:1` (a loopback port nothing listens on) and `NO_PROXY`
  empty, so a fetch either tool was not stopped from making fails at the proxy before any name is
  resolved. Go never sends a request for a loopback address (`localhost`, `127.0.0.0/8`, `::1`)
  through a proxy, so a loopback URL is covered only by the pre-reads; the live lane's loopback
  listener is what shows those hold. `helm pull` and `helm dependency build` must fetch and get no
  proxy.
- **Conservative kustomize pre-reads (known false opaques, B2 review pass 4).** crankpath judges
  the values its YAML reader returns, and kustomize decodes the same text with another library. So
  a kustomization or configuration file holding any YAML tag (`!!binary`, `!!str`, a custom or
  verbatim tag, a tag on a key) or directive, or a quoted or plain scalar with an escape or a line
  break, is refused whole (`unsupported-field`). That covers real files using such forms
  harmlessly. Block scalars are kept. In a configuration file (generator, transformer, validator,
  transformer configuration, replacements) any string with `://` and any `path`, `paths`, `files`,
  `envs` or `env` value that is not a plain relative path in the directory is refused too, a literal
  included (`literals: [HOMEPAGE=https://example.org/docs]`, `labels: {env: ""}`). crankpath does
  not tell a literal from a path there. Each is a named opaque source, never a silent pass.
- **Host lookups in templates.** A template may call `getHostByName`; helm may resolve it even under
  `--no-network`. Stated in the same line, and the chart is named in a floating entry.
- **Two renders per chart, and what they cannot prove.** Every Helm source is rendered twice and the
  two are compared: object names that differ make it `render-failed` ("not deterministic"), other
  content that differs is a floating entry. Two renders cannot prove determinism: output that varies
  only rarely can agree twice (a name from `randInt 0 2` agrees half the time), so Helm output is not
  claimed byte-identical across runs. The flag itself is only as stable as the chart: when a chart's
  own rendering varies, the floating entry `helm template: content differs between two renders`
  appears in the runs where crankpath's two renders happen to differ and not in the others. Observed
  on khuedoan/homelab at 8b9d40f (2026-11-16, B7): three charts vary (Go map order picks a Service
  port); two were flagged in every run seen, one in 3 of 5 <!-- measured 2026-11-16 -->, so that estate's JSON differs between
  runs by one floating entry. The golden lane (`npm run verify:golden`) therefore compares the
  floating revisions of a reduced case without that render note. On a loaded machine a render can
  also reach `renderWallClock` or, through `helm dependency build`, a network failure: crankpath then
  counts a timeout or names an opaque source, and the golden fails with those outcomes named (B7
  review m7: 20 runs of the homelab case under 12 busy loops on 10 cores, 2026-11-16, gave the same
  counts every time; the one failure the reviewer saw could not be reproduced). The template scan names the random, time and lookup functions
  it finds as a floating entry (`chart templates`); it is a flag, never the guard, and does not open
  archived subcharts. A second render that fails, times out or cannot be read keeps the first
  render with the note "determinism not checked: second render ...". Each render has its own
  `renderWallClock`, so one Helm source can take up to twice that; the second render's parse is
  asked of the run's budget, is not held, and a refusal of it is not a refused job.
- **Signals.** The run is one synchronous call: SIGINT or SIGTERM ends crankpath at once. A helm or
  kustomize it is running is not stopped by a signal to crankpath alone (`kill <pid>`, `timeout`):
  the child is adopted by init and runs on with no time limit (the wall clock ended with crankpath),
  in its private directory, which the next run using the same cache may remove under it. A
  terminal's Ctrl-C reaches the child too (one process group). The next run removes a directory
  left under the cache's `tmp/` only for the same cache, and keeps one whose process id has been
  reused by a live process.

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

Measured output of `node scripts/measure-limits.mjs --part1`, run 2026-11-15:

```measurement
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

Measured output of `node scripts/measure-limits.mjs`, run 2026-11-15 (the complete run):

```measurement
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

Measured output of `node scripts/measure-limits.mjs --part3`, run 2026-11-15:

```measurement
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

## Per-run limits (B1 review pass 2, N2)

What they protect: the heap of one whole run on the smallest GitHub-hosted runner, so a hostile estate (many Applications rendering one large directory, a workload with a huge number of references, many large files) ends in a counted `limit` outcome, never an out-of-memory abort. Per-render limits (objects of one helm or kustomize render, render time and output bytes) are B2's, derived at its step 0; these are per run. Code: `src/u1-graph-model/run-limits.ts`; enforcement: `src/u9-cli-package/run-budget.ts` and `pipeline-runner.ts`.

| Limit | Value | Unit | Protects | Derived from (2026-11-15) | Enforced by |
|---|---|---|---|---|---|
| `runMemory` | 2,448,619,776 | bytes | the heap of one run: files held parsed, objects, nodes, edges, report and output together, with the one file being parsed | 2,500,000,000 bytes (V8 12.4's default old generation for Node 22 on `ubuntu-slim`, 5 GB: 5,000,000,000 / 4 x 2, the heap `lexemesPerFile` is derived from) minus 51,380,224 bytes (a run's measured baseline: the thin-slice fixture). No reserve: one heap figure is the only budget, and each file's parse is a transient checked against it (below) | the run budget: each charge is checked before it is taken; before a file is parsed its transient parse cost must fit in what the run has not yet held |
| `objectsPerRun` | 366,669 | objects | the heap of one run, when it holds only objects | `runMemory` / 6,678 bytes per object (measured: node, the edge to its owner, report entry, JSON held in memory) | the run budget: each render's objects are charged 6,678 bytes each plus 4,665 bytes per string value (every edge an extractor can make names its target by one of the object's string values, so each is charged as the costliest edge before extraction runs); a job that does not fit is not taken in and its owner is opaque `limit`; a later job that fits is still taken in |
| `edgesPerRun` | 524,891 | edges | the heap of one run, when it holds only edges with their stubs | `runMemory` / 4,665 bytes per edge with a stub node and an unresolved item (measured) | after extraction: the first `edgesPerRun` edges in canonical order are kept, the rest counted (`runLimitEdges`, a gap, the counts a floor) |
| `nodesPerRun` | 891,560 | nodes | the heap of one run | `objectsPerRun + edgesPerRun`: a node is an object, a stub (made only by an edge) or a declared external (bounded by the config file's own limits), so the two bounds above bound it | not charged separately |

Files held parsed are charged 33 bytes per file byte (the worse of two measured shapes, rounded up); a file that does not fit is a counted `too-large` refusal with the detail `run budget` (shown as `run budget reached`), and a later file that fits is still read. At that rate the budget holds about 74 MB of YAML per run: a larger estate ends with named, counted refusals on the smallest runner. Discovered sources are charged as objects and always held (their files are already read).

**The parse transient (lead decision after merging B0's final reader).** Before a file is parsed, its transient parse cost must fit in what the run has not yet held: its lexeme count from a pre-scan (the reader's own count: every lexeme of every document) times 937 bytes, B0's measured worst resident memory per lexeme, plus 3 bytes per byte of the file, B0's text reserve (the read buffer and a decoded string): the same terms `lexemesPerFile` is derived from. If it does not fit, the file is refused `run budget reached` without being parsed (counted, a floor). After the parse the transient is released, and only the held cost (33 bytes per file byte) stays charged. `lexemesPerFile` still bounds one file against the whole heap; the run budget bounds the sum. This replaces the earlier 832,000,000-byte reserve, which no longer covered the worst file B0's final reader admits.

**Not sticky, and the order decides.** Only an item that does not fit is refused; later items that fit are still charged and taken in. Items are charged in canonical order (files in code-point order of their paths, sources in their sorted queue order, edges in canonical edge order), so the same estate gives the same refusals on every machine, but which item is refused depends on that order: a repository can name its files so that a large one comes first. The run-limit line says so. Any refusal makes the run `ANALYSED WITH GAPS` and its counts a floor (`at least`), and a run whose only sources were refused is never `NOTHING ANALYSED`.

**What is charged, and what is not.** B1 charges, in bytes: each file held parsed (33 per byte), each object taken in (6,678) and each string value in it (4,665), and keeps at most `edgesPerRun` edges. Numbers, booleans and keys in an object's body are not charged per value: in B1 every object comes from a file already charged by its bytes, which covers them. The string-value charge assumes each value is an edge with a stub, the costliest case, so it is pessimistic for objects with many plain values (the 1,500 x 3,000 review tree used 342 MB of the 1.6 GB budget). It bounds the edges extraction can make only through string values; an extractor that made edges from anything else would not be covered.

**Note for B2 (done in B2's merge of `main`).** A Helm or Kustomize render is not a file read, so its output is charged by nothing above but the per-object and string-value rates. B2 must charge each render's output bytes the same way: its transient parse cost (its lexemes x 937 + its bytes x 3) checked against what the run has not yet held before it is parsed, then its output bytes charged at `perFileByte` (its parsed documents are held like a file's) before its objects are taken in; and pass `stringLeaves` from `buildObjects` on the RenderedSet (the pipeline counts them itself when absent). The per-render limits stay B2's, from its step 0.

### Measurement

`npm run build && node scripts/measure-run-limits.mjs` on 2026-11-15 (Node 22.23.2, macOS arm64; each run a child process with `--max-old-space-size=8192` and no budget, the JSON output held in memory as `--out` does; peak is the child's maximum resident set size):
Measured output of `node scripts/measure-run-limits.mjs`, run 2026-11-15:

```measurement
baseline (thin-slice fixture): peak 51380224 bytes
objects n=100: units 200000, input bytes 142890, nodes 200100, edges 200000, output 131357540 chars, peak 1400864768 bytes
objects n=200: units 400000, input bytes 142890, nodes 400200, edges 400000, output 264033740 chars, peak 2736308224 bytes
objects: 6677.2 bytes per unit (peak difference over unit difference)
edges n=50000: units 50000, input bytes 3877916, nodes 50002, edges 50001, output 44936024 chars, peak 1057013760 bytes
edges n=100000: units 100000, input bytes 7777916, nodes 100002, edges 100001, output 89936028 chars, peak 1290256384 bytes
edges: 4664.9 bytes per unit (peak difference over unit difference)
edges: 78.0 input bytes per reference
files n=50: units 50889000, input bytes 50889000, nodes 1, edges 0, output 1979 chars, peak 919404544 bytes
files n=100: units 101778000, input bytes 101778000, nodes 1, edges 0, output 1980 chars, peak 1688879104 bytes
files: 15.1 bytes per unit (peak difference over unit difference)
```
and `node scripts/measure-run-limits.mjs files-flow` (the same day, added after the first run):
Measured output of `node scripts/measure-run-limits.mjs files-flow`, run 2026-11-15:

```measurement
baseline (thin-slice fixture): peak 50823168 bytes
files-flow n=50: units 50000200, input bytes 50000200, nodes 1, edges 0, output 1979 chars, peak 1746141184 bytes
files-flow n=100: units 100000400, input bytes 100000400, nodes 1, edges 0, output 1980 chars, peak 3369058304 bytes
files-flow: 32.5 bytes per unit (peak difference over unit difference)
```
Resident memory counts more than the old-generation heap the budget is taken from, so the rates err toward smaller bounds. One machine, macOS only; Linux not measured.

## Cost of the declared-fact limits (B5, measured)

Measured on 2026-11-15 (Node v22.23.2, macOS arm64), after the second review's fix (budget in steps, literal-suffix index); a one-off script over the built HostMatcher, kept outside the repository:

Measured output of the one-off script kept outside the repository, run 2026-11-15:

```measurement
all-wildcard 4 labels (review pass 2): 2000 entries, 800 hosts, 9 ms, budget spent: true
all-wildcard 4 labels, distinct entries: 300000 entries, 2000 hosts, 11 ms, budget spent: true
63-character star labels (first pass): 30000 entries, 2000 hosts, 9 ms, budget spent: true
literal suffixes: 300000 entries, 100000 hosts, 236 ms, budget spent: false
```

The earlier figure in this section ("the whole budget at the worst label shape: 619 ms") was wrong: the budget then counted label comparisons, not the work inside them, and the second review measured 19.2 s for the first shape above (`reviews/bolt-5-review-pass-2.md`, M3). Charged per step, the whole budget costs about 10 ms at the worst shapes found. The other declared-fact shapes (`test/u7-graph-analysis/review-b5-regressions.test.ts`, on a 100,000-node ring): 1,000 `render:` cranks and one crank of 10,000 targets about 1.6 s; 50,000 declared externals with 100,000 declared edges about 0.4 s; the second review measured 300,000 mixed `render:` cranks and reroutes at 4.2 s.

## B3 step 0: the scan's file count, generated Applications and fetches

B0 left `filesPerScan` and `generatedApplicationsPerApplicationSet` to B3 step 0. The per-run budget (B1, above) already bounds most of what a large estate costs, so both are derived from it rather than from a new heap figure:

- **`generatedApplicationsPerApplicationSet`** protects the run's memory: each generated Application becomes an object the budget charges 6,678 bytes plus 4,665 bytes per string value, and every Application has at least four strings, so one ApplicationSet can never usefully generate more than `runMemory` / (6,678 + 4 x 4,665) = 96,638. The expander stops there while generating (before building more). *Corrected after the review (M1, m7):* that count alone did not protect memory (a template of 1,000 annotations made each Application hundreds of times larger than the four-string minimum, and a 1.8 MB file ran the heap out), and the set was charged only after it was built. Now each Application is charged to the run budget with its real string values before it is built, and the rendering work of the whole set is bounded by `generatorRenderSteps`; a refusal keeps what was built and the ApplicationSet carries its own `limit` mark. On the review's file (90,000 elements, 1,000 templated annotations) the run now ends in 2.4 s with 378 MB resident (exit 0, 416 Applications kept, the ApplicationSet opaque `limit`), where it aborted out of memory after 150 s (run 2026-11-15, `node --max-old-space-size=2500`).
- **`filesPerScan`** protects what the budget does not see: it charges a file by its bytes, so an empty file, or a file discovery does not parse, cost it nothing, yet each is held in a walk's list (and parsed files in the read cache). Measured below: 577 bytes per such file at most; with a path at Linux's `PATH_MAX` in two-byte characters a file can cost 8,769 bytes, so `runMemory` / 8,769 = 279,235 files. Each walked file is also charged to the budget (577 bytes plus 2 per path character). *Corrected after the review (m7):* on ordinary path lengths `filesPerScan` binds first (about 3.6 million short-path files would fit the budget alone); the budget charge binds only when other things have filled it.
- **`generatorPatternSteps`**, **`repoFetchWallClock`** and **`gitOutputBytes`** are new in B3 (rows above); **`generatorRenderSteps`** and **`fetchedRepoBytes`** came with the review fixes. *Stated after the review (m7):* `generatorPatternSteps` binds a `directories` generator long before the Application count: with one pattern consulting every directory of its depth, about 28,000 directories spend it (the review's 97,500-directory tree ended in one counted `limit` and no Application, in 61 s). It is a counted outcome, not a wrong result; a repository that large under one pattern is reported opaque.

### Measurement

`npm run build && CRANKPATH_MEASURE_TMP=<a scratch folder> node scripts/measure-scan-limits.mjs` on 2026-11-15 (Node 22.23.2, macOS arm64; each run a child process with `--max-old-space-size=8192` and no budget; the rate is the difference in peak resident memory between two sizes over the difference in files; the trees were generated in a scratch folder outside the repository):
Measured output of `node scripts/measure-scan-limits.mjs`, run 2026-11-15:

```measurement
empty-yaml n=50000: files hold no source 50000, peak 110493696 bytes
empty-yaml n=100000: files hold no source 100000, peak 139329536 bytes
empty-yaml: 576.7 bytes per file (peak difference over file difference)
other-files n=50000: files hold no source 50000, peak 73285632 bytes
other-files n=100000: files hold no source 100000, peak 96976896 bytes
other-files: 473.8 bytes per file (peak difference over file difference)
long-names n=50000: files hold no source 50000, peak 139362304 bytes
long-names n=100000: files hold no source 100000, peak 166100992 bytes
long-names: 534.8 bytes per file (peak difference over file difference)
```
The 200-character names did not cost more than the short ones in this measurement (resident memory is coarse at this scale); the path is therefore charged by the derivation, at 2 bytes per character, not by the measured rate. One machine, one run per shape; Linux not measured.
