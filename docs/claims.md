# The claim map

Every claim the documentation makes about crankpath's output or its measured results is marked in the document with a claim id, and has one row here naming the test that reproduces it (US12.2, BR12.3, NFR18). `npm run verify` runs the docs check (`scripts/check-docs.mjs`), which fails when:

- an output fence carries no claim id: in a user document every fence with no info string or `text` is output, and so is a code fence whose content is crankpath's output; a fence is otherwise a code language, a `measurement` (the dated output of a measuring script, with its command and date, not a claim a test reproduces) or an `illustration` (which may hold no line crankpath prints);
- a sentence that states a cycle id, or a count of the form `N of M <word>`, carries no claim id (a count, never a cycle id, may instead carry `<!-- measured YYYY-MM-DD -->`, a dated observation of runs);
- a claim id has no row here, or a row here is marked nowhere;
- a row's test file is not a test of this repository, the test title is not an `it()` or `test()` of that file, or the test is skipped;
- a row's last verified run is not a real date at or before today.

Records are held by their own tests, not by rows here: the census record (`docs/census.md`, sections 3 and 5) by `test/u11-validation-harness/census-record.test.ts` and `test/u11-validation-harness/census-real.test.ts`, which compare every figure and breakdown of its prose with the committed JSON.

The same `npm run verify` runs every named test, so a row names a test that passed in the run that checked it. The last verified run is the date the row's claim was last compared with a real run by hand.

| Claim | Where | Claim (as the doc states it) | Test file | Test | Last verified run |
|---|---|---|---|---|---|
| CL-1 | README.md, opacity section | the static census total: at least 176 of 214 counted units opaque, 0.8224, over one third | test/u12-docs-release/doc-claims.test.ts | the README states the static census total as the committed census record has it | 2026-11-16 |
| CL-2 | docs/concepts.md, Cycle; docs/write-your-cranks.md, steps 2 and 3 | with the alias, the example holds one extracted cycle, c-0b9310f2 (3 nodes, 4 edges), that blocks every node | test/u12-docs-release/doc-claims.test.ts | with the alias, the example holds one extracted cycle that blocks every node | 2026-11-16 |
| CL-3 | docs/write-your-cranks.md, step 1 | without the alias, both Applications are opaque `unreadable-repo`, with a suggested `repos:` entry that is not applied | test/u12-docs-release/doc-claims.test.ts | without the alias, both Applications of the example are opaque unreadable-repo with a suggested repos entry | 2026-11-16 |
| CL-4 | docs/write-your-cranks.md, step 5 | with the crank, the cycle is `cranked (was extracted)` and plan step 1 is the manual crank, then five start steps | test/u12-docs-release/doc-claims.test.ts | with the crank, the cycle is cranked and plan step 1 is the manual crank | 2026-11-16 |
| CL-5 | docs/crankpath-yaml.md, rules for the whole file | an unknown key is an error naming its key path, exit 1 | test/u12-docs-release/doc-claims.test.ts | an unknown key in crankpath.yaml is an error naming its key path, and nothing is analysed | 2026-11-16 |
| CL-6 | docs/what-it-cannot-see.md | every run lists the five not-modelled items | test/u12-docs-release/doc-claims.test.ts | every run lists the five items crankpath does not model | 2026-11-16 |
| CL-7 | docs/crankpath-yaml.md, everything at once | every example on the reference page except the error is accepted by the reader | test/u12-docs-release/doc-claims.test.ts | every crankpath.yaml example in the reference is accepted by the reader | 2026-11-16 |
| CL-8 | README.md, opacity section | the real-discovery census total: at least 268 of 311 D12 units opaque, 0.8617, over one third; all source kinds at least 316 of 839, 0.3766 | test/u12-docs-release/doc-claims.test.ts | the README states the real-discovery census totals as the committed record has them | 2026-11-16 |
| CL-9 | docs/action.md, example output | the local harness's output for the cases add-cycle (FAILED), add-crank (NO_NEW_CYCLES_FOUND, not a pass), gap-rise and no-base (NOT CHECKED) | test/u10-github-action/action-local.test.ts | quotes the harness output of a real run, byte for byte | 2026-11-16 |
| CL-10 | README.md, the homelab cycles | khuedoan/homelab at 8b9d40f with the one alias: NOTHING ANALYSED, 31 chart directories nothing deploys | test/u12-docs-release/doc-claims.test.ts | the README states the uncranked homelab golden as it is pinned | 2026-11-16 |
| CL-11 | README.md, the homelab cycles | with the bootstrap crank: one cycle c-35843cd4, 12 nodes, 22 edges, cranked (was extracted) by crank 1, plan step 1 the manual crank, ANALYSED WITH GAPS | test/u12-docs-release/doc-claims.test.ts | the README states the cranked homelab golden as it is pinned | 2026-11-16 |
| CL-12 | README.md, opacity section | the three largest reasons of the real-discovery census, with their counts, in order | test/u11-validation-harness/census-real.test.ts | names in the README the three largest reasons of the total, in their order | 2026-11-16 |
