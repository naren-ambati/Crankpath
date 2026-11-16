# Release round part 2: release files, licence, packaging and whole-tree hard rules (independent review)

- Branch: `release/files-readme`, commit reviewed: `653d4b1`
- Date: 2026-11-16
- Reviewer: Claude Sonnet 5.5, independent read-only review

## Findings

| id | location | failure scenario | status | minimal general fix |
|----|----------|------------------|--------|---------------------|
| m1 | `test/helpers/action-repo.ts` (repository set-up, lines 53 to 61) and `test/u10-github-action/action-entry.test.ts:256` | `npm run verify` from a fresh clone failed once in two runs: "NOT CHECKED for invalid inputs, never an option passed to git" compared a before/after snapshot of the fixture checkout and saw `.git/objects/maintenance.lock` and the objects directory size appear. The fixture's `git commit` starts git's detached automatic maintenance, which writes into `.git/objects` while the test snapshots. Re-running the test alone passed 4 of 4 times; the second full `verify` passed. The release workflow runs the same gate, so a tag push can fail on a race that is not a defect. | CONFIRMED (first fresh-clone run, log kept in scratch: `1 failed, 2048 passed`; second run green) | Create the fixture repository with maintenance and gc off (`-c maintenance.auto=false -c gc.auto=0` on the `init`/`commit` calls, or `git config` after `init`), or exclude `.git/objects/maintenance.lock` and directory sizes from the snapshot. |
| n1 | `README.md` Install section | The install block says `git clone https://github.com/naren-ambati/crankpath.git`, an address that does not exist until the owner completes checklist step 11. The paragraph above it says "not on npm yet" but not that the clone address is also not live. | PLAUSIBLE (traced) | One clause: "once the repository exists (checklist, step 11)". |
| n2 | `.github/workflows/release.yml` job `env` | `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` is an empty string when the secret is unset, and `setup-node` with `registry-url` writes an `.npmrc` that reads it. Whether npm trusted publishing (OIDC) still takes precedence over an empty token is not exercised anywhere here. Same shape as the sibling project's workflow, so not a regression. | PLAUSIBLE, not verifiable offline | Owner checks on the first tag run; the checklist step 14 already offers the token fallback. Optionally say so in step 15's check line. |

No Major finding. No hard-rule break found.

## Tests that cannot fail

`test/u12-docs-release/release-workflow.test.ts` holds the workflow's shape and has a "can fail" case that breaks five properties one at a time (wider tag, pull-request trigger, moving action ref, no gate, no provenance) and asserts `holds()` turns false for each and true for the real file. Each break is a real mutation of the text, and `expect(b).not.toBe(TEXT)` guards a no-op replace. I found no weak test in this part. One gap, not a finding: the test checks the pinned SHAs by form and against `docs/lookups.md`, not that they exist; I checked that separately (below).

## Checklist against the brief

| Item | Result | Evidence |
|------|--------|----------|
| LICENSE byte-identical to the sibling's | met | `cmp` identical |
| NOTICE lists every third-party copy, permissive only, licence beside each | met | Four corpus folders (flux2-kustomize-helm-example Apache-2.0, gitops-bridge template Apache-2.0, acelinkio MIT, bjw-s home-ops Apache-2.0), each with `LICENSE`, `NOTICE`, `corpus.json`; the commit ids in the root NOTICE match each folder's NOTICE; the IANA root-zone list is named with its version line and the "no licence stated" caveat. No other third-party copy exists in the tree (all other fixture READMEs say hand-written, none copied). GPL and MPL material: homelab goldens hold ids and counts; the Vault fixture is hand-written. |
| package.json | met | Apache-2.0, not private, `repository`, `homepage`, `bugs` at the owner's GitHub path, `bin` to `dist/u9-cli-package/cli.js`, `exports`, `files` (dist, README, CHANGELOG, NOTICE; npm adds LICENSE and package.json), `engines.node >=22.13`, every dependency and dev dependency an exact version, no install scripts, `.npmrc` `ignore-scripts=true` |
| `npm pack --dry-run` | met | package.json, README.md, CHANGELOG.md, LICENSE, NOTICE and 154 files under `dist/`, nothing else; no home path or design-tool name in the packed files (grep) |
| SECURITY.md | met | pr-rla's structure and contact wording, advisory URL for crankpath, "What counts" written for crankpath, supported versions, no placeholder left. The statement that the link leads nowhere until release is true |
| CONTRIBUTING.md | met | The commands (`npm ci --ignore-scripts`, `npm run verify`, `verify:live`, `verify:golden`, `release:check`) all exist in package.json and `verify` ran from a fresh clone (see m1 for the one race) |
| CHANGELOG 0.1.0 | met | 25 amendments; I traced 14 against BUILD-NOTES (the census label, depth 287, sync waves as a node attribute, Mermaid limits, `cold_start` with `served_by`, `external-unspecified`, `x-access-token`, `credential-ambiguous`, `KUBECONFIG=/dev/null` and the locale, npm 11.21.2 in the lookups, the census figures 268 of 311 and 0.8617): all have a matching record. No false amendment found |
| release.yml | met | tag-only `v[0-9]+.[0-9]+.[0-9]+`, read-only permissions, `id-token: write` on the one job, offline gate `npm ci --ignore-scripts && npm run verify`, tag-equals-version step, provenance; never run here. Pinned SHAs read by me from the GitHub API on 2026-11-16: `actions/checkout` `3d3c42e5...` is the commit of tag v7.0.1 and `actions/setup-node` `949feb24...` is the commit of tag v7.1.0 (both resolve through `git/ref/tags`) |
| docs/release-checklist.md | met | 17 steps, each with who and how to check; creating the repository, push `main` only, private reporting, deny-list file and `release:check`, golden and live lanes, npm name re-check, tag, publish all present; the design workspace removal is worded neutrally ("the design workspace kept in the local history is removed before the first push") and names no folder |
| No employer or company name | met | Tree grep (excluding the design-workspace folders and the start file), all commit messages, authors and committers since the design commits: 0 hits. I used my own term list, not the owner's deny-list, which this checkout does not carry |
| No personal path, hostname or user name | met | The only `/Users/` hits are the text of a lint rule's description in BUILD-NOTES and one review; `/home/runner` in action tests is the runner's own value. No machine name or personal e-mail outside the neutral no-reply address |
| Nothing added under the design-workspace folders by the build | met | `git log b7ae93d..HEAD --` over the design workspace's folders and start file (paths withheld here: the tree check refuses their names) lists only the three design commits (d4901b2, 3eda749, c2f501e) that precede the first build commit; no build commit touches those paths. They remain tracked (733 paths), as the checklist step 9 says the coordinator removes before the first push |
| Commit identity | met | 25 commits since b7ae93d, one author and committer: `naren-ambati <32987080+naren-ambati@users.noreply.github.com>`; every one carries a Co-Authored-By trailer (22 Opus 5.5, 3 Sonnet 5.5) |
| No design-tool name in any shipped file | met | grep of every file outside the excluded folders for the tool's name, its command, its stage names and its start file: 0 hits (the packed files are also clean) |
| Fresh clone, other parent folder | partly | `npm ci --ignore-scripts` 0 vulnerabilities. Run 1 of `npm run verify`: 117 of 118 test files passed, 2048 passed, 1 failed (m1), exit 1. Run 2: 118 of 118 files, 2049 passed, 4 skipped (2053), lines 96.26% (6837 of 7102), 10 images 1,054,309 bytes 0 problems (15 images), examples 10 / 21 runs / 15 quotes 0 problems, `release checks: 7 passed, 0 failed, 3 not run, 0 skipped`, `offline checks: nothing blocks`, exit 0. The three "not run" are `npm audit`, the golden lane and the deny-list, as designed |

## What I checked and found sound

- LICENSE, NOTICE and the corpus licence texts (the three Apache copies are identical to each other; the MIT copy names its copyright holder).
- The pack listing and package fields; pinned runtime dependencies; no install script anywhere.
- The release workflow's actions exist at the stated commits and versions.
- Release checklist ordering (history cleaned before the first push, private reporting on before the code that points to it, trusted publishing before the tag).
- SECURITY.md claims about the runner (closed command list, `KUBECONFIG=/dev/null`) are backed by BUILD-NOTES records.
- README figures for the census (268 of 311, 0.8617) match `docs/census.md`.

## Not verified

- The deny-list (owner's file) was not available; the employer-name grep used my own terms.
- The first hosted run of the workflow and OIDC publishing (n2) cannot be exercised here.
- I did not re-run the golden or live lanes (need helm and the network).

## Verdict

Ready to merge after fixes (m1: a race in a test that the release gate runs; the two nits are optional).
