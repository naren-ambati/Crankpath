# Release checklist: crankpath 0.1.0

The ordered steps from this checkout to the first public release of `crankpath` (0.1.0). Written 2026-11-16 and not executed. **Nothing in the build publishes anything:** a publish, a tag or a remote happens only on the owner's explicit go (BR12.5), and every step that makes something public or permanent is the owner's, by hand, and is marked so.

Two roles:

- **owner**: decides, and does every public or permanent act (the repository, the remote, the push, the npm publisher, the tag, the publish), and keeps the deny-list file.
- **coordinator**: whoever prepares the release in a checkout. Every coordinator step is local and reversible, or a read-only look at a public page or the npm registry.

## The steps

| # | Step | Who |
|---|------|-----|
| 1 | Licence: Apache-2.0 | owner, done 2026-11-15 |
| 2 | Security contact: GitHub private vulnerability reporting | owner, decided |
| 3 | Re-check the npm name and the repository name | coordinator |
| 4 | Every review is closed | coordinator |
| 5 | Fresh clone: `npm ci --ignore-scripts && npm run verify` | coordinator |
| 6 | The golden and live lanes on a machine with helm, kustomize, git and the network | coordinator, on the owner's machine |
| 7 | Supply `CRANKPATH_DENYLIST_FILE` and run `npm run release:check` | owner (the file), on the owner's machine |
| 8 | Read the tarball | coordinator |
| 9 | Clean the history before the first push | coordinator |
| 10 | Date the changelog | coordinator |
| 11 | Create the empty repository `naren-ambati/crankpath` | owner |
| 12 | Add the remote and push `main` only | owner |
| 13 | Enable private vulnerability reporting | owner |
| 14 | Set up trusted publishing on npmjs.com | owner |
| 15 | Tag `v0.1.0`; the workflow publishes | owner |
| 16 | Check the published package | coordinator |
| 17 | Run the Action once on a hosted runner, and pin it by commit SHA | coordinator |

The order matters in four places. The checks (3 to 10) come before the repository exists (11), because a push is permanent and a failing check is cheaper to fix while everything is local; the history in particular can only be cleaned before the first push (9). The repository exists (11) and has private reporting switched on (13) before anyone can read the code that says to report there. Trusted publishing (14) is configured before the tag (15), because the tag starts the publish. And the Action can only be pinned (17) to a commit of the public repository, so it comes last.

## 1. Licence: Apache-2.0

**Owner. Done 2026-11-15.** `LICENSE` is the Apache-2.0 text, `NOTICE` lists every third-party file copy (the corpus copies under `test/corpus/` and the IANA root-zone list) with its source and licence, and `package.json` says `"license": "Apache-2.0"` without `"private": true`. `scripts/check-pack.mjs` holds all of it, including the licence text by its SHA-256 ([lookups](lookups.md)).

**How to check.** `npm run pack:check` prints `0 problem(s)`; read `NOTICE` against each `test/corpus/*/NOTICE`.

## 2. Security contact: GitHub private vulnerability reporting

**Owner. Decided 2026-11-16.** [`SECURITY.md`](../SECURITY.md) names GitHub's private vulnerability reporting at `github.com/naren-ambati/crankpath/security/advisories/new`. The feature is a repository setting, so it can only be switched on once the repository exists (step 13). Until then the contact points at nothing.

**How to check.** After step 13, open the link signed out (or ask someone else to): the form must open.

## 3. Re-check the npm name and the repository name

**Coordinator**, read-only. `npm view crankpath`: only a clean `E404` counts as free; any other answer (a 403, a 429, a 5xx, a timeout) is unknown and is redone, never read as free. Check that `github.com/naren-ambati/crankpath` does not exist yet. Append the dated rows to [lookups](lookups.md) (on 2026-11-16 both were 404). A name is held only by publishing it, so repeat the npm check on the day of the tag (step 15). A different name changes `package.json` (`name`, `bin`, `repository`, `homepage`, `bugs`), the docs and the Action's references.

**How to check.** The rows in `lookups.md` have today's date and the answer 404.

## 4. Every review is closed

**Coordinator.** Open each file under `reviews/`: each reproduced finding names its fix and the regression test that failed before the fix, or the decision that leaves it, in [BUILD-NOTES](../BUILD-NOTES.md).

**How to check.** No finding is open.

## 5. Fresh clone: `npm ci --ignore-scripts && npm run verify`

**Coordinator.** From a fresh `git clone` of the release commit, in a folder outside any other checkout (not a copy of the working folder):

```sh
npm ci --ignore-scripts && npm run verify
```

**How to check.** Exit 0; the summary shows every test file passed (the skipped tests are the goldens that need helm and the network, step 6), the coverage lines, and the release checks ending `offline checks: nothing blocks`, with the deny-list `NOT RUN` until step 7.

## 6. The golden and live lanes

**Coordinator, on the owner's machine**, with helm v4.3.2, kustomize v5.8.1, git and a steady network, on an idle machine:

```sh
npm run verify:golden
npm run verify:live
```

The golden lane re-runs both homelab goldens (khuedoan/homelab at 8b9d40f, read-only, ids and counts only) and the Vault goldens, and every mutation of them; the live lane renders the fixtures with the real tools and fetches one pinned public repository. Both write only to caches outside the repository (`CRANKPATH_GOLDEN_CACHE`, `CRANKPATH_LIVE_CACHE`). A skipped check is never a pass: a helm or kustomize version other than the reviewed one, or no network, makes the lane exit 2, and the release waits for a run that has them all. A render that times out under load is a FAIL to understand, not a re-run until it passes.

**How to check.** Each lane exits 0 and its last line counts no failure and no skip.

## 7. Supply `CRANKPATH_DENYLIST_FILE` and run `npm run release:check`

**Owner (the file), on the owner's machine.** The deny-list is a file of names that must never appear in the repository or the package, one per line, kept outside the repository; no name in it is ever written into this repository. Then:

```sh
CRANKPATH_DENYLIST_FILE=<the file> npm run release:check
```

It builds, then runs every release check in release mode: check-tree, check-docs, secret-grep with the deny-list (over the tree, the package, every commit message and author field of the history, and the local git config), check-pack, interim-reason, `npm audit` and the golden lane. A finding names the place and the term's number, never the term.

**How to check.** The last result line reads `release check: nothing blocks`, and the deny-list row is `PASS` with its count of terms. On 2026-11-16 the only blocker was the deny-list, `NOT RUN` because the variable was unset ([BUILD-NOTES](../BUILD-NOTES.md), B9 part 4).

## 8. Read the tarball

**Coordinator.** `npm run build && npm run pack:check`, then read `npm pack --dry-run` yourself once: it must list only `dist/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE` and `package.json`. No `npm-shrinkwrap.json` is shipped and `schemas/` is not packed (decisions in the [CHANGELOG](../CHANGELOG.md)). The packed README's relative links point at files that are not in the package; npm's package page is expected to resolve them against the `repository` field, which is not looked up here, so check the page after step 15.

**How to check.** The pack check prints `0 problem(s)` and the listing holds those six entries and nothing else.

## 9. Clean the history before the first push

**Coordinator, before step 12.** History cannot be rewritten after a push, so three things are settled first:

- The design workspace kept in the local history is removed before the first push, from every commit of `main`, with the files it leaves out recorded; the design is cited in the shipped files only by its ids (FR, BR, OD, ADR, C) and by the plain-words copies in `docs/design/`.
- Every commit on `main` is authored `naren-ambati <32987080+naren-ambati@users.noreply.github.com>`.
- Only `main` goes out: the bolt, review and release branches stay local.

Then run steps 5 and 7 again on the rewritten `main`.

**How to check.** `git log --format='%an <%ae>' main | sort -u` prints one line; a search of every commit of `main` for the removed paths finds none; step 7's last line still reads `nothing blocks`.

## 10. Date the changelog

**Coordinator.** `## 0.1.0: unreleased` becomes `## 0.1.0 (YYYY-MM-DD)`, the release's day, in its own commit.

**How to check.** `CHANGELOG.md` has the date; step 5 still passes.

## 11. Create the empty repository `naren-ambati/crankpath`

**Owner.** Create it on GitHub with no README, no licence and no `.gitignore` (the repository has its own), and no collaborators yet. This is the first public act.

**How to check.** `https://github.com/naren-ambati/crankpath` exists and is empty.

## 12. Add the remote and push `main` only

**Owner.** In the release checkout: `git remote add origin https://github.com/naren-ambati/crankpath.git`, then `git push -u origin main`. Push `main` only, never every ref.

**How to check.** `git ls-remote origin` lists `main` and nothing else.

## 13. Enable private vulnerability reporting

**Owner.** Repository Settings, Code security, "Private vulnerability reporting": enable it (step 2).

**How to check.** The Security tab shows "Report a vulnerability", and [`SECURITY.md`](../SECURITY.md)'s link opens the form.

## 14. Set up trusted publishing on npmjs.com

**Owner.** The workflow is in place ([`.github/workflows/release.yml`](../.github/workflows/release.yml); `test/u12-docs-release/release-workflow.test.ts` holds its shape: the tag filter, the pinned action commits, the offline gate before the publish, the tag check and provenance). What is left is on npmjs.com: configure a trusted publisher for `crankpath` (repository `naren-ambati/crankpath`, workflow `release.yml`). If npm requires the package to exist first, either publish the first version by hand from a clean checkout of the tag (`npm publish --provenance --access public`), or add an `NPM_TOKEN` repository secret, which the workflow uses when it is set, and remove it once trusted publishing works.

One thing is not exercised anywhere here: the job's `env` passes `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`, which is an empty string when the secret is not set, and `setup-node` writes an `.npmrc` that reads it; whether npm then still publishes through trusted publishing has not been run. So choose one: set the `NPM_TOKEN` secret, or rely on trusted publishing alone and remove that `env` line from the workflow (and the line of `test/u12-docs-release/release-workflow.test.ts` that expects it) before the tag.

**How to check.** The package settings on npmjs.com list the publisher and the workflow has no `NODE_AUTH_TOKEN` line; or the secret is set and step 15's run uses it.

## 15. Tag `v0.1.0`; the workflow publishes

**Owner** (this is the written go). Re-check the npm name (step 3) the same day. On the release commit (the changelog dated, step 10): `git tag v0.1.0 && git push origin v0.1.0`. The workflow runs `npm ci --ignore-scripts && npm run verify`, checks that the tag names `package.json`'s version, and publishes with provenance. It runs only on a pushed `v<major>.<minor>.<patch>` tag, never on a branch push, a pull request or a schedule; the golden lane, the live lane and the deny-list are not part of it: they were steps 6 and 7.

**How to check.** The workflow run ends with the publish step done and `npm view crankpath@0.1.0 dist.integrity` answers.

## 16. Check the published package

**Coordinator**, read-only. `npm view crankpath@0.1.0 version license dist.integrity`; the provenance attestation on the package page; the package page's file list is the six entries of step 8; the README's links resolve on the package page; and `npx crankpath@0.1.0 --version` prints `crankpath 0.1.0` with the helm and kustomize it finds.

**How to check.** Each of those, written down with the date in `lookups.md`.

## 17. Run the Action once on a hosted runner, and pin it by commit SHA

**Coordinator**, once the repository exists. The Action has never run on a GitHub-hosted runner ([the Action guide](action.md)). Run it once from a scratch repository you own, with a pull request that adds a cycle and one that does not, before telling anyone to use it; record the result. The Action is used as `uses: naren-ambati/crankpath/action@<full commit id>`, never a branch or a tag: it builds the CLI from its own checkout, so it works at any pushed commit and does not depend on step 15. Keep that form, with the placeholder, wherever the docs show the Action.

**How to check.** Both runs are recorded with their date, and the docs' workflow example reads `naren-ambati/crankpath/action@` followed by a placeholder or a 40-character commit id on `main`.
