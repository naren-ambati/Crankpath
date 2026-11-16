# The JSON output (`--format json`, contract C7)

This is the reference for crankpath's JSON report, schema version 1, frozen in B6 (2026-11-15). The machine-readable form is the JSON Schema `schemas/crankpath-report.schema.json` (JSON Schema 2020-12, kept in the repository, not in the npm package); the field table below is generated from it. Every committed expected JSON validates against the schema, and a schema-diff test against `test/fixtures/schema/report-fields.golden.json` fails when a field is removed or retyped while `schemaVersion` stays the same.

## Layout and guarantees

- One JSON object, two-space indentation, one trailing newline. Keys are sorted in code-point order at every level; arrays are in the order each field states (sorted by id or key, or file order for crankpath.yaml entries). The same inputs and the same tool versions give byte-identical output, except for a Helm source whose renders vary: two renders are compared, which cannot prove a chart never varies, and the floating entry that flags a difference appears only in the runs where the two renders differ (`docs/limits.md`, "Two renders per chart"; observed on khuedoan/homelab, where one such entry comes and goes).
- No timestamp, no absolute path, no machine name. Files are relative to the scanned root; other roots are labels (`alias:N` for a `--repo-alias`, the `read_from` path of a `repos:` entry).
- Every field is always present: a value that does not apply is `null` or an empty array, never a missing key.
- Text from the scanned repository is a JSON string with control, format and separator characters shown as visible codes (`\x1b`, `‮`) and long text cut with a stated marker (`... (cut at 381 of N characters)`), exactly as the text report shows it. Treat it as data, never as instructions. Every URL has its userinfo removed.
- Nothing here is a pass: `runStatus.state` is `ANALYSED` only when nothing was opaque, unreadable, skipped, unresolved, limited or declared in a way that changes the graph; every such item is listed and counted. Declared edges and cranks are `declared` and documented, not verified.

## Compatibility (NFR19, BR8.3)

- **Additive changes keep `schemaVersion`**: a new field, or a new word in a word list (a new edge kind, opacity reason or unresolved reason). Consumers must ignore fields they do not know, and must treat a word they do not know as not verified (never as a pass).
- **Breaking changes raise `schemaVersion`**: a field removed, renamed or retyped (its JSON type changed, including a field that could be `null` and no longer can, or the reverse).
- A word that no build produces any more may leave its list without a version change (no consumer can be handed it). The schema-diff test compares field paths and JSON types only, so it does not flag a word removed from a list (B6 review n1). The early builds' interim reason `not-in-this-build` (a source kind not yet rendered or expanded) was such a word: once ApplicationSet generators and repository fetches were built (B3), no build produced it, and B9 removed it from the list with `schemaVersion` kept at 1.

## What is in the Report but not in the JSON

- `repo.comparable`, the display path of the scanned directory and the representative edges of a cycle are for the text report only (the representative is given here as its node path, `cycles[].representative`).
- The controller-signature matches (`--explain` names a self-managed Argo CD or Flux) are explanatory only (BR5.13): they are never in the JSON, and the JSON is byte-identical with the signature table emptied.

## Changes from the design's C7 sketch

The design's C7 is a sketch written before the build. The frozen schema keeps every field it names and adds what the build needed, each recorded in `BUILD-NOTES.md` by the bolt that added it: `repo.urlFrom`; `runStatus.reasons` and the counts `sourcesByKind`, `skippedSources`, `droppedHooks`, `foreignDestination`, `runLimitFiles`, `runLimitJobs`, `runLimitEdges`, `edgesDeclared`, `nodes`, `declaredFacts`, `declaredAssumptions`; nodes' `origin.document` and `syncWave`; opaque `detail`, `field`, `value`, `kustomizeRoot`, and `suggestion` as `{url, readFrom}`; cycle edges as `{from, to, kind, source}` objects, `labelBeforeCranks`, `residualLabel`, `touchedBy`, `introducedBy`; statuses' `reason` and `via`; `statusCounts`; `cranks`; `unusedMatches`; `matchOverrides`; `repoMappings`; `hiddenCycles`; the plan's `assumes.clusterProvided`, `servedBy`, `matchEntries`, `argocdNamespace`, steps' `crank` and `ref`, structured `conflicts`, and `listedUnordered` with `status` and `blockers`; unresolved items' `field`, `candidates`, `candidatesTruncated`, `owner` and `value`; `skipped`, `unreadable`, `notComputed`, `notModelled` and `notVerified`. C7's `guarantees` and `compatibility` lines are this document, not fields. B2 (the render engine, merged after the freeze) adds `toolchain.testedPair`, `toolchain.missing`, `toolchain.unrecognised`, `floating`, `undeployedKustomizeRoots` and `toolMissing`: additive, so `schemaVersion` stays 1. B7 (a `render:<path>` crank of a chart or Kustomize directory applied by hand, FR7.4) adds `runStatus.counts.sourcesByKind.HandAppliedChart`, `opaque[].chartRoot` and `undeployedCharts`: additive, so `schemaVersion` stays 1. `notComputed` is empty in every run of this version (every part of the analysis is computed since B5); it stays so a consumer can rely on the field.

## Fields

Paths use `.` for an object's field and `[]` for each element of an array. "Words" lists the allowed values of a word list.

<!-- field table: generated by scripts/json-output-doc.mjs from the schema; do not edit by hand -->

| Field | Type | Meaning |
|---|---|---|
| `clustersUsed` | array | Entries of crankpath.yaml's `clusters:` block that a clusters generator used (declared facts the graph rests on), sorted. |
| `clustersUsed[]` | string | one entry |
| `cranks` | array | Every crank, in file order. |
| `cranks[]` | object | A crank of crankpath.yaml and what it did (documented, not verified). |
| `cranks[].alreadyCreated` | integer | Nodes its targets name that an earlier crank or target already created. |
| `cranks[].by` | string | The documented step (repo text). |
| `cranks[].createdNodes` | array | Nodes it creates first, sorted. |
| `cranks[].createdNodes[]` | string | A node. |
| `cranks[].id` | string | `crank:<n>`, its 1-based position in crankpath.yaml. |
| `cranks[].keyPath` | string | Its key path in crankpath.yaml. |
| `cranks[].matched` | boolean | False when none of its targets matched a node. |
| `cranks[].ref` | null or string | Its reference (repo text), or null. |
| `cranks[].removedEdges` | integer | Edges of the graph as read it removes. |
| `cranks[].reroutedEdges` | array | Its reroutes, sorted. |
| `cranks[].reroutedEdges[]` | object | A reroute. |
| `cranks[].reroutedEdges[].from` | string | The node rerouted. |
| `cranks[].reroutedEdges[].to` | string | The external it now reads from. |
| `cycles` | array | Cycles, sorted by id. |
| `cycles[]` | object | A cycle: a strongly connected component with its full node and edge set (OD-2). |
| `cycles[].crankedBy` | array | For a `cranked` cycle, the cranks that broke it (documented, not verified). |
| `cycles[].crankedBy[]` | string | one entry |
| `cycles[].edges` | array | Every non-ordering edge between its nodes, sorted. |
| `cycles[].edges[]` | object | An edge. |
| `cycles[].edges[].from` | string | The dependent node. |
| `cycles[].edges[].kind` | string | The edge kind. Words: `deployed-by`, `generated-by`, `reads-source`, `needs-credential`, `needs-secret`, `needs-config`, `produced-by`, `uses-store`, `issued-by`, `selects`, `runs-as`, `seals-with`, `assumes-identity`, `depends-on`, `rerouted`. |
| `cycles[].edges[].source` | string | Extracted or declared. Words: `extracted`, `declared`. |
| `cycles[].edges[].to` | string | What it needs. |
| `cycles[].id` | string | `c-` and hex digits of the sha256 of its sorted node ids: stable across runs. |
| `cycles[].introducedBy` | array | For a cycle that exists only once cranks are applied, the cranks whose reroutes close it. |
| `cycles[].introducedBy[]` | string | one entry |
| `cycles[].label` | string | Its label after cranks. Words: `extracted`, `declared (unverified)`, `cranked`. |
| `cycles[].labelBeforeCranks` | string | Its label on the graph as read. Words: `extracted`, `declared (unverified)`. |
| `cycles[].nodes` | array | Its nodes, sorted. |
| `cycles[].nodes[]` | string | A node. |
| `cycles[].representative` | array | One shortest cycle through its smallest id, as a path (the last node returns to the first). |
| `cycles[].representative[]` | string | A node. |
| `cycles[].residual` | array or null | For a cycle a crank touched but did not break: the nodes still on a cycle; else null. |
| `cycles[].residualLabel` | null or string | The residual's own label, or null. Words: `extracted`, `declared (unverified)`, `cranked`. |
| `cycles[].residual[]` | string | A node. |
| `cycles[].touchedBy` | array | For an uncranked cycle, the cranks that touched it without breaking it. |
| `cycles[].touchedBy[]` | string | one entry |
| `edges` | array | Every edge, sorted by (from, to, kind, source). |
| `edges[]` | object | An edge (C1): `from` needs `to`. |
| `edges[].evidence` | object | Where the edge's claim can be checked (BR1.1). |
| `edges[].evidence.field` | string | The field path in crankpath's notation. |
| `edges[].evidence.file` | string | The file holding the field (relative to the scanned root, or an `alias:N/` label). |
| `edges[].evidence.line` | integer or null | The line, when recorded; null otherwise. |
| `edges[].evidence.renderedPath` | string | The rendered object the edge was read from (`<file>#<document>` for plain sources). |
| `edges[].from` | string | The dependent node. |
| `edges[].kind` | string | The edge kind. Words: `deployed-by`, `generated-by`, `reads-source`, `needs-credential`, `needs-secret`, `needs-config`, `produced-by`, `uses-store`, `issued-by`, `selects`, `runs-as`, `seals-with`, `assumes-identity`, `depends-on`, `rerouted`. |
| `edges[].orderingOnly` | boolean | True for an ordering constraint, never part of a cycle. |
| `edges[].source` | string | Extracted or declared (unverified). Words: `extracted`, `declared`. |
| `edges[].to` | string | What it needs. |
| `externals` | array | Externals, sorted by id. |
| `externals[]` | object | An external precondition. |
| `externals[].coldStart` | string | Its declared availability. Words: `available`, `unavailable`, `unspecified`. |
| `externals[].id` | string | `external:<name>`. |
| `externals[].servedBy` | null or string | The in-estate node that serves it (declared), or null. |
| `floating` | array | Floating revisions and chart versions (OD-12), and render notes (a chart's random or lookup functions, a second render whose content differed or did not finish); sorted by (node, field). |
| `floating[]` | object | one entry |
| `floating[].field` | string | The field or note kind (`spec.source.targetRevision`, `chart templates`, `helm template`). |
| `floating[].node` | string | The source it belongs to. |
| `floating[].resolved` | null or string | The chart version rendered, for a chart from a repository; null otherwise. |
| `floating[].value` | string | The value as written in the repository, or the note (repo text). |
| `hiddenCycles` | array | Hidden cycles, sorted by id. |
| `hiddenCycles[]` | object | A cycle of the graph without the `match:` entries that the report does not hold. |
| `hiddenCycles[].edges` | integer | Its edge count. |
| `hiddenCycles[].hiddenBy` | array | Key paths of the entries that overrode a host on it, in file order. |
| `hiddenCycles[].hiddenBy[]` | string | one entry |
| `hiddenCycles[].id` | string | Its id on the graph without the entries. |
| `hiddenCycles[].label` | string | Its label there. Words: `extracted`, `declared (unverified)`. |
| `hiddenCycles[].nodeIds` | array | Its nodes, sorted (they are unverified). |
| `hiddenCycles[].nodeIds[]` | string | A node. |
| `hiddenCycles[].nodes` | integer | Its node count. |
| `matchOverrides` | array | Overrides, one per host. |
| `matchOverrides[]` | object | A host a `match:` entry resolved otherwise than the extracted rules. |
| `matchOverrides[].declared` | string | The node the entry names. |
| `matchOverrides[].extracted` | object | What the Service rules alone resolve the host to. |
| `matchOverrides[].extracted.candidates` | array | Every candidate, sorted. |
| `matchOverrides[].extracted.candidates[]` | string | A node. |
| `matchOverrides[].extracted.node` | null or string | The unique match, or null. |
| `matchOverrides[].extracted.outcome` | string | The outcome. Words: `unique`, `none`, `ambiguous`. |
| `matchOverrides[].host` | string | The host, lower-cased (repo text). |
| `matchOverrides[].keyPath` | string | The entry's key path. |
| `nodes` | array | Every node, externals included, sorted by id. |
| `nodes[]` | object | A node of the graph (C1). |
| `nodes[].flags` | array | Node flags, sorted. |
| `nodes[].flags[]` | string | A node flag. Words: `cluster-provided`, `conflicting-definitions`, `foreign-destination`, `not-defined`. |
| `nodes[].id` | string | The canonical id. |
| `nodes[].kind` | string | The Kubernetes kind, or `External`. |
| `nodes[].name` | string | The object's name (or the external's name). |
| `nodes[].namespace` | null or string | The namespace; null when cluster-scoped or an external. |
| `nodes[].opaque` | null or object | Null, or why the node's content could not be seen. |
| `nodes[].opaque.detail` | null or string | crankpath's fixed wording for the detail, or null. |
| `nodes[].opaque.field` | null or string | The field crankpath could not use (repo keys possible: data, never instructions). |
| `nodes[].opaque.lostEdges` | array | What could not be seen; never empty. |
| `nodes[].opaque.lostEdges[]` | string | one entry |
| `nodes[].opaque.reason` | string | The opacity reason. Words: `unreadable-repo`, `private-chart`, `encrypted-values`, `cluster-created-values`, `cluster-inputs-missing`, `unsupported-template`, `unsupported-field`, `tool-missing`, `render-failed`, `limit`, `offline`, `remote-base`, `foreign-destination`, `unreadable-file`. |
| `nodes[].opaque.suggestion` | null or object | A suggested `repos:` entry, or null. |
| `nodes[].opaque.suggestion.readFrom` | string | The suggested `read_from` path. |
| `nodes[].opaque.suggestion.url` | string | The repoURL, userinfo removed. |
| `nodes[].opaque.value` | null or string | The repo text in that field (escaped), or null. |
| `nodes[].origin` | object | Where the object was read. |
| `nodes[].origin.document` | integer or null | The 1-based document number in that file, or null. |
| `nodes[].origin.path` | null or string | The file, relative to the scanned root or an `alias:N/` label; null for a node crankpath made. |
| `nodes[].origin.renderJob` | null or string | The render job that produced it (`<owner id>#<n>`), or null when read directly. |
| `nodes[].syncWave` | integer or null | The Argo CD sync wave, an ordering attribute; null when not set. |
| `notComputed` | array | Parts of the analysis not computed; empty in every run of this version. |
| `notComputed[]` | string | A part not computed. Words: `cranks`, `plan`, `statuses`. |
| `notModelled` | array | The fixed list of what crankpath does not model. |
| `notModelled[]` | string | one entry |
| `notVerified` | array | What was not verified, in a fixed order; `declared-edges` always present. |
| `notVerified[]` | object | A closing-line item. |
| `notVerified[].count` | integer | How many. |
| `notVerified[].item` | string | What is not verified. Words: `opaque-sources`, `unreadable-files`, `skipped-objects`, `foreign-destination-objects`, `run-limit`, `unresolved-items`, `timeouts`, `uncranked-cycles`, `unverified-nodes`, `unspecified-externals`, `externals-declared`, `cranks-documented`, `match-entries-relied`, `repo-mappings`, `match-unused`, `cluster-provided`, `clusters-not-used`, `fetch-not-used`, `not-computed`, `declared-edges`. |
| `opaque` | array | Opaque sources, sorted by node (or Kustomize root). |
| `opaque[]` | object | An opaque source. |
| `opaque[].chartRoot` | null or string | The Helm chart directory applied by hand (a `render:<path>` crank), or null. |
| `opaque[].detail` | null or string | crankpath's fixed wording, or null. |
| `opaque[].field` | null or string | The field crankpath could not use, or null. |
| `opaque[].kustomizeRoot` | null or string | The Kustomize root directory, or null. |
| `opaque[].lostEdges` | array | What could not be seen; never empty. |
| `opaque[].lostEdges[]` | string | one entry |
| `opaque[].node` | null or string | The opaque node, or null for a Kustomize root. |
| `opaque[].reason` | string | The opacity reason. Words: `unreadable-repo`, `private-chart`, `encrypted-values`, `cluster-created-values`, `cluster-inputs-missing`, `unsupported-template`, `unsupported-field`, `tool-missing`, `render-failed`, `limit`, `offline`, `remote-base`, `foreign-destination`, `unreadable-file`. |
| `opaque[].suggestion` | null or object | A suggested `repos:` entry, or null. |
| `opaque[].suggestion.readFrom` | string | The suggested `read_from` path. |
| `opaque[].suggestion.url` | string | The repoURL, userinfo removed. |
| `opaque[].value` | null or string | The repo text in that field (escaped), or null. |
| `plan` | object | The restoration plan (an order, not a schedule). |
| `plan.assumes` | object | What every start step is relative to. |
| `plan.assumes.argocdNamespace` | array | The namespace taken to be Argo CD's. |
| `plan.assumes.argocdNamespace[]` | string | A Namespace. |
| `plan.assumes.clusterProvided` | array | Objects every cluster provides (the dated list) that the estate references. |
| `plan.assumes.clusterProvided[]` | string | A node. |
| `plan.assumes.cranks` | array | Cranks relied on (documented, not verified). |
| `plan.assumes.cranks[]` | string | one entry |
| `plan.assumes.externals` | array | Externals declared available. |
| `plan.assumes.externals[]` | string | An external. |
| `plan.assumes.matchEntries` | array | Key paths of the `match:` entries the graph relies on. |
| `plan.assumes.matchEntries[]` | string | one entry |
| `plan.assumes.notModelled` | array | The fixed not-modelled list. |
| `plan.assumes.notModelled[]` | string | one entry |
| `plan.assumes.servedBy` | array | Externals served by an in-estate node (declared). |
| `plan.assumes.servedBy[]` | string | An external. |
| `plan.conflicts` | array | Dropped constraints. |
| `plan.conflicts[]` | object | An ordering constraint dropped because a hard dependency contradicts it. |
| `plan.conflicts[].from` | null or string | For an ordering edge: its from node; else null. |
| `plan.conflicts[].fromWave` | integer or null | For a sync wave: the earlier wave; else null. |
| `plan.conflicts[].job` | null or string | For a sync wave: the render job; else null. |
| `plan.conflicts[].kind` | string | Which kind of constraint. Words: `sync-wave`, `ordering-edge`. |
| `plan.conflicts[].to` | null or string | For an ordering edge: its to node; else null. |
| `plan.conflicts[].toWave` | integer or null | For a sync wave: the later wave; else null. |
| `plan.disclaimer` | string | The fixed order-not-schedule disclaimer (BR8.12). Words: `an order, not a schedule; cold-load pickup is not modelled`. |
| `plan.listedUnordered` | array | Blocked and unverified nodes, by node. |
| `plan.listedUnordered[]` | object | A node not startable, listed after the plan. |
| `plan.listedUnordered[].blockers` | array | Its named blocker. |
| `plan.listedUnordered[].blockers[]` | string | one entry |
| `plan.listedUnordered[].node` | string | The node. |
| `plan.listedUnordered[].reason` | string | Its blocker's class. Words: `cycle`, `external-unavailable`, `external-unspecified`, `opaque`, `undefined-reference`, `unresolved`, `match-override`. |
| `plan.listedUnordered[].status` | string | Its status. Words: `blocked`, `unverified`. |
| `plan.steps` | array | Crank steps first, then start steps. |
| `plan.steps[]` | object | A step. |
| `plan.steps[].crank` | null or string | The crank id of a crank step, else null. |
| `plan.steps[].kind` | string | A manual crank step or a start step. Words: `crank`, `start`. |
| `plan.steps[].manual` | boolean | True for a crank step. |
| `plan.steps[].no` | integer | The step number, from 1. |
| `plan.steps[].nodes` | array | A start step: its nodes by wave then id; a crank step: the nodes it creates. |
| `plan.steps[].nodes[]` | string | A node. |
| `plan.steps[].ref` | null or string | The crank's `ref` (repo text), else null. |
| `plan.steps[].why` | string | A crank step: the crank's `by` (repo text); a start step: crankpath's fixed reason. |
| `repo` | object | The scanned repository. |
| `repo.commit` | null or string | The commit read: the resolved commit of a repository crankpath fetched (FR1.2); null for a local checkout (not read). |
| `repo.floating` | boolean | True when the fetched revision is a branch, a tag or the default branch, which can move (OD-12). |
| `repo.url` | null or string | Its URL with userinfo removed; null when unknown or unparseable. |
| `repo.urlFrom` | null or string | Where the URL came from: `flag` (--repo-url), `git-config` (the origin in .git/config) or `fetched` (the URL crankpath fetched to scan, FR1.2); null when unknown. Words: `flag`, `git-config`, `fetched`, null. |
| `repoMappings` | array | Mappings, sorted by (from, url). |
| `repoMappings[]` | object | A repository mapping. |
| `repoMappings[].commit` | null or string | A fetched entry's resolved commit (OD-12); null otherwise. |
| `repoMappings[].failure` | null or string | Why a fetch entry could not be read, in crankpath's fixed words (the reason, then its detail); null otherwise. |
| `repoMappings[].floating` | boolean | True when a fetched entry's revision can move (the default branch). |
| `repoMappings[].from` | string | `crankpath.yaml` (a declared fact of the scanned repo) or `--repo-alias` (the user's own input). Words: `crankpath.yaml`, `--repo-alias`. |
| `repoMappings[].root` | string | The root read: a path inside the scanned root, `fetch:N` (a fetched `repos:` entry), `(fetch)` (a fetch entry not fetched), or an `alias:N` label. |
| `repoMappings[].url` | string | The repository URL, userinfo removed. |
| `repoMappings[].used` | boolean | True when some source was read through it. |
| `runStatus` | object | How completely the estate was read and analysed (BR1.10). |
| `runStatus.counts` | object | Counts computed once by the report assembler; every format prints these and none recounts. |
| `runStatus.counts.declaredAssumptions` | integer | Declared facts the plan assumes (externals declared available or unavailable, `served_by`, matched cranks): listed, never a gap by themselves. |
| `runStatus.counts.declaredFacts` | integer | Declared facts that change the graph read (match entries that override a host, declared edges kept, `repos:` mappings a source was read through): a gap. |
| `runStatus.counts.droppedHooks` | integer | Helm test hooks dropped from Helm renders (not a gap). |
| `runStatus.counts.edgesDeclared` | integer | Edges declared in crankpath.yaml (unverified). |
| `runStatus.counts.edgesExtracted` | integer | Edges read from the repo's objects. |
| `runStatus.counts.foreignDestination` | integer | Objects deployed to another cluster, left out of Service and host matching. |
| `runStatus.counts.ignoredFiles` | integer | Files that hold no source document (they may still be read by a render). |
| `runStatus.counts.nodes` | integer | Nodes in the graph, externals included. |
| `runStatus.counts.opaque` | integer | Opaque sources. |
| `runStatus.counts.opaqueApplicationSets` | integer | Opaque ApplicationSets (their Applications are not counted, so `floor` is true). |
| `runStatus.counts.rendered` | integer | Sources read or rendered (not opaque). |
| `runStatus.counts.runLimitEdges` | integer | Edges not kept because the run's edge budget was reached. |
| `runStatus.counts.runLimitFiles` | integer | Files not read because the run's memory budget was reached. |
| `runStatus.counts.runLimitJobs` | integer | Render jobs not taken in because the run's memory budget was reached. |
| `runStatus.counts.skipped` | integer | Objects skipped (a name that is not Kubernetes syntax, a document that is not an object). |
| `runStatus.counts.skippedSources` | integer | Of those, source documents (missing from the opacity denominator). |
| `runStatus.counts.sourcesByKind` | object | Sources found, per kind. |
| `runStatus.counts.sourcesByKind.Application` | integer | Applications. |
| `runStatus.counts.sourcesByKind.ApplicationSet` | integer | ApplicationSets. |
| `runStatus.counts.sourcesByKind.HandAppliedChart` | integer | Helm chart directories a `creates: render:<path>` crank says are applied by hand (FR7.4). |
| `runStatus.counts.sourcesByKind.HelmRelease` | integer | Flux HelmReleases. |
| `runStatus.counts.sourcesByKind.Kustomization` | integer | Flux Kustomizations. |
| `runStatus.counts.sourcesByKind.KustomizeRoot` | integer | Kustomize roots (directories with a kustomization file). |
| `runStatus.counts.sourcesFound` | integer | Sources found: Applications, ApplicationSets, Kustomizations, HelmReleases and Kustomize roots. |
| `runStatus.counts.timeouts` | integer | Render jobs stopped by a time limit. |
| `runStatus.counts.unreadableFiles` | integer | Files that could not be read. |
| `runStatus.counts.unresolved` | integer | Unresolved items. |
| `runStatus.floor` | boolean | True when the opaque count is a lower bound (unreadable files, opaque ApplicationSets, timeouts, skipped sources or a run limit). |
| `runStatus.reasons` | array | The gap reasons, sorted; empty only for `ANALYSED`. |
| `runStatus.reasons[]` | string | A gap reason. Words: `declared-facts`, `no-dependency-edges`, `no-sources`, `not-computed`, `opaque-sources`, `run-limit`, `skipped-objects`, `timeouts`, `unreadable-files`, `unresolved-items`. |
| `runStatus.state` | string | `ANALYSED` only when there is no gap of any kind. Words: `ANALYSED`, `ANALYSED WITH GAPS`, `NOTHING ANALYSED`. |
| `schemaVersion` | integer | The schema version: raised only by a breaking change (a removed or retyped field). |
| `skipped` | array | Skipped objects, sorted by (file, document, item). |
| `skipped[]` | object | An object not in the graph. |
| `skipped[].document` | integer | The 1-based document number. |
| `skipped[].file` | string | The file. |
| `skipped[].item` | integer or null | The `.items[i]` of a List, or null. |
| `skipped[].kind` | null or string | The kind as found (repo text), or null. |
| `skipped[].name` | null or string | The name as found (repo text), or null. |
| `skipped[].namespace` | null or string | The namespace as found (repo text), or null. |
| `skipped[].reason` | string | Why it was skipped. Words: `invalid-kind`, `invalid-name`, `invalid-namespace`, `no-namespace`, `not-an-object`. |
| `skipped[].renderJob` | null or string | The render job that produced it, or null. |
| `skipped[].source` | boolean | True for a source document. |
| `statusCounts` | object | Status counts over the estate's nodes (externals not counted). |
| `statusCounts.blocked` | integer | Blocked nodes. |
| `statusCounts.startable` | integer | Startable nodes. |
| `statusCounts.unverified` | integer | Unverified nodes. |
| `statuses` | array | One verdict per node, externals included, sorted by node. |
| `statuses[]` | object | A node's cold-start verdict. |
| `statuses[].blockers` | array | Its named blocker (a cycle id, node id or `extractor:<name>`); empty only for startable. |
| `statuses[].blockers[]` | string | one entry |
| `statuses[].node` | string | The node. |
| `statuses[].reason` | null or string | The class of its named blocker; null only for startable. Words: `cycle`, `external-unavailable`, `external-unspecified`, `opaque`, `undefined-reference`, `unresolved`, `match-override`. |
| `statuses[].status` | string | Its status. Words: `startable`, `blocked`, `unverified`. |
| `statuses[].via` | null or string | The dependency the blocker comes through; null when the node is itself the cause, or startable. |
| `toolMissing` | object | Sources opaque `tool-missing`, by the tool they need. |
| `toolMissing.helm` | integer | Helm sources opaque because helm is not on PATH. |
| `toolMissing.kustomize` | integer | Kustomize sources opaque because kustomize is not on PATH. |
| `toolchain` | object | The tools that produced the report. |
| `toolchain.crankpath` | string | crankpath's version. |
| `toolchain.helm` | null or string | helm's version; null when not detected. |
| `toolchain.kustomize` | null or string | kustomize's version; null when not detected. |
| `toolchain.missing` | array | Tools not found on PATH, sorted. |
| `toolchain.missing[]` | string | one entry Words: `helm`, `kustomize`. |
| `toolchain.tested` | boolean | True only when both versions are the tested pair. |
| `toolchain.testedPair` | object | The tested pair of versions (OD-13), named in the text note when another version is in use. |
| `toolchain.testedPair.helm` | string | The tested helm version. |
| `toolchain.testedPair.kustomize` | string | The tested kustomize version. |
| `toolchain.unrecognised` | array | Tools found whose version could not be read, sorted. |
| `toolchain.unrecognised[]` | string | one entry Words: `helm`, `kustomize`. |
| `undeployedCharts` | array | Helm chart directories of the scanned root that nothing read deploys and no crank applies by hand (FR7.4; their objects are not in the graph), sorted. |
| `undeployedCharts[]` | string | one entry |
| `undeployedKustomizeRoots` | array | Kustomize roots no Application or Flux Kustomization renders (built on their own; their objects are not in the graph), sorted. |
| `undeployedKustomizeRoots[]` | string | one entry |
| `unreadable` | array | Unreadable files, sorted by path. |
| `unreadable[]` | object | A file that could not be read. |
| `unreadable[].detail` | null or string | A fixed detail, or null. |
| `unreadable[].outcome` | string | The reader's outcome word (for example `too-large`, `symlink`, `parse-error`). |
| `unreadable[].path` | string | Its display path. |
| `unreadable[].reasonWord` | string | crankpath's fixed wording for it. |
| `unresolved` | array | Unresolved items, sorted. |
| `unresolved[]` | object | Something crankpath could not resolve: a gap, never a pass. |
| `unresolved[].candidates` | array | Candidates of an ambiguity, sorted; possibly only the first ones. |
| `unresolved[].candidatesTruncated` | boolean | True when more candidates exist than are listed. |
| `unresolved[].candidates[]` | string | A node. |
| `unresolved[].field` | null or string | The field or key path, or null. |
| `unresolved[].owner` | null or string | The node that holds it (never startable), or null for a run-level item. |
| `unresolved[].subject` | string | What is unresolved: a node id, or repo text. |
| `unresolved[].value` | null or string | The repo text the item is about (a host), or null. |
| `unresolved[].where` | string | Where it was found: a rendered path or `crankpath.yaml`. |
| `unresolved[].why` | string | Why. Words: `address-missing`, `argocd-namespace-assumed`, `argocd-namespace-derived`, `argocd-namespace-unknown`, `conflicting-definitions`, `crank-target-unmatched`, `crank-unused`, `credential-ambiguous`, `credential-outside-argocd`, `credential-unreadable`, `credential-url-unresolved`, `declared-edge-endpoint-missing`, `external-unspecified`, `extractor-failed`, `host-ambiguous`, `host-unplaced`, `invalid-reference`, `invalid-sync-wave`, `match-limit`, `namespace-unknown`, `not-defined`, `region-unresolved`, `seal-unreadable`, `seal-workload-unidentified`, `selector-ambiguous`, `selector-invalid`, `served-by-missing`, `unsupported-provider`. |
| `unusedMatches` | array | Unused `match:` entries, in file order. |
| `unusedMatches[]` | object | A `match:` entry that matched no host. |
| `unusedMatches[].host` | string | Its host pattern (repo text). |
| `unusedMatches[].keyPath` | string | Its key path. |
| `unusedMatches[].node` | string | The node it names (repo text). |

<!-- end of the generated field table -->
