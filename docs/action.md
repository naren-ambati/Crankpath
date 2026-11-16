# The crankpath GitHub Action

The Action (`action/action.yml`, contract C10 of the design, kept outside the repository) runs crankpath on a pull request's base commit and head commit and fails the job only when the pull request adds an uncranked dependency cycle. When it cannot compare the two, it says `NOT CHECKED` and the job is not green.

**This Action has never run on a GitHub-hosted runner.** Everything below was exercised by the local harness (`scripts/action-local.mjs`) and the tests on one macOS machine; the first hosted run happens after the owner's first push. Until then, treat its behaviour on Linux runners as unverified.

## Use

```yaml
name: crankpath
on: pull_request
permissions:
  contents: read
jobs:
  cycles:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      # actions/checkout v7.0.1, released 2026-07-20, commit read from the GitHub API on 2026-11-15
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          fetch-depth: 0          # the base commit must be in the checkout
          persist-credentials: false
      - uses: naren-ambati/crankpath/action@<full commit id>
        id: crankpath
```

- **Permissions:** `contents: read` is all the job needs. The Action uses no token: it reads only the checkout.
- **`fetch-depth`:** `actions/checkout` fetches one commit by default, which does not hold the base. Use `0` (all history): the Action compares with the merge base of `base-ref` and the head, which needs the history back to where the pull request branched. A checkout without the base or without that history gives `NOT CHECKED`, never a comparison against nothing.
- **`timeout-minutes`:** the Action sets no timer of its own (no limit could be derived for a whole estate); a job stopped by the job's timeout is cancelled, which is not green either.
- **helm and kustomize:** crankpath renders Helm and Kustomize sources with the `helm` and `kustomize` it finds on the runner's PATH; the Action installs neither. Without them those sources are opaque (`tool-missing`) on both sides, and a pull request that adds one makes the head read less than the base, which is `NOT CHECKED`. Install the tested pair (`crankpath --version` names it) in an earlier step for a full comparison. Which versions a hosted runner image ships was not checked.
- **Pin by commit:** reference the Action by a full commit id, as it pins `actions/setup-node` itself.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `path` | `.` | The directory to scan, relative to the workspace, inside a git checkout. A subdirectory is scanned in both commits (crankpath reads it as the root of the estate, as `crankpath <dir>` does). |
| `config` | empty | `crankpath.yaml` location. Empty: `crankpath.yaml` at the scanned path, read from each commit (absent is no declared facts). Relative: a path from the repository root, read from each commit; when it is missing from one of them the result is `NOT CHECKED` (the same rule must hold on both sides). Absolute: the same file for both; it must be **outside the workspace** (a file the pull request cannot change), or the pull request controls the config of both sides. |
| `base-ref` | the pull request's base commit (`github.event.pull_request.base.sha`) | The base branch side: a commit id or a plain ref name. The Action compares with the **merge base** of this commit and the head (`git merge-base`), so what the base branch gained after the pull request branched off is not counted as the pull request's. Empty (not a pull request) gives `NOT CHECKED`; a merge base equal to the head (`base-ref: HEAD`, or a head behind the base) gives `NOT CHECKED`. |
| `repo-alias` | empty | Newline-separated `url=path` entries, each passed as a `--repo-alias`. A relative path is read from each commit (it must stay inside the repository); an absolute path is the same directory for both sides and, as for `config`, must be outside the workspace. |

**The head is the commit checked out.** On a `pull_request` event `actions/checkout` checks out the merge commit GitHub made from the pull request and the base branch tip at that time. When the base branch has moved on since `base.sha` was recorded, the merge commit holds base-branch commits the merge base does not, and a cycle they add is reported as this pull request's (a failure, never a hidden cycle). Checking out the pull request's own head (`ref: ${{ github.event.pull_request.head.sha }}`) compares exactly the pull request's commits with its fork point.

Each input reaches the Action's script as an environment variable and reaches git and crankpath only as one element of an argument list, never inside a shell command. A value that does not fit its rule (a path leaving the workspace, a ref that looks like an option or a revision expression, an alias line that is not `url=path`) gives `NOT CHECKED` with the reason; an alias line is never echoed, since its URL could hold a token.

The repository's own URL (`--repo-url`) is `GITHUB_SERVER_URL/GITHUB_REPOSITORY`, the same on both sides, so Applications that read the scanned repository are read from the checkout. Applications that read it through another URL (an in-cluster mirror) need a `repo-alias` line.

## Outputs

| Output | Values |
|---|---|
| `result` | `FAILED`, `NO_NEW_CYCLES_FOUND` or `NOT_CHECKED` |
| `new-cycles` | the number of new uncranked cycles; **empty** when `result` is `NOT_CHECKED`, because no count exists (C10 says integer; an empty value cannot be read as zero) |

The step's exit status is 0 only for `NO_NEW_CYCLES_FOUND`.

## What fails and what does not

A head cycle is **new**, and fails the job, when it is uncranked (label `extracted` or `declared (unverified)`) and:

1. one of its edges, identified by (from, to, kind), is absent from the base graph (OD-24). Every edge of a strongly connected component lies on a cycle, so this is exact. Renaming a node makes its cycle new. A cycle that appears only because a source became readable in the head counts as new (OD-27 d);
2. or its edges all exist in the base, but the base component holding them was `cranked` there: the pull request removed or broke the crank (OD-27 a).

These never fail the job:

- an uncranked cycle the base already had with the same edges (an old cycle does not block unrelated work);
- a cycle `cranked` in the head, including by a crank the pull request adds (BR10.3). The summary says, for each cranked head cycle, whether the crank is one this pull request adds and how many of its edges are new in this pull request (`cranked by a crank this pull request adds; 8 of its edges are new in this pull request`), so a reviewer sees a crank written to cover a cycle the pull request introduces.

A cycle a crank touched but did not break stays uncranked and is judged on all its edges, as the rule reads; the residual is not judged separately.

### `NO_NEW_CYCLES_FOUND` is not a pass

It states exactly what was checked: no uncranked head cycle has an edge the base lacks or lost a crank the base had. The summary's first line always says what it does not cover, beginning `Not a pass:` (M7): the head's opaque sources (each of which the base had too: a gap item new in the head is `NOT CHECKED` instead), the uncranked cycles the base already had, the declared facts the pull request added, cycles hidden by match entries, and the head's gaps.

### Facts the pull request declares are listed, not verified

Cranks, declared edges and externals the head adds or changes (and `match:` entries and `repos:` mappings) are honoured, because the head's own analysis applies them (OD-27 b), and each is listed as `documented by the PR author, not verified`, with a warning annotation. A pull request can therefore break its own new cycle with a crank in `crankpath.yaml` and get `NO_NEW_CYCLES_FOUND`; the summary names the crank so a reviewer can judge it. Cycles a head `match:` entry hides are listed as not checked.

### The order of the decision: new cycles first, then new gaps

1. **A new uncranked cycle fails the check** (`FAILED`), whatever else is new. A cycle that needs a declared edge this pull request adds is new and uncranked: it is shown with its `declared (unverified)` label and the declared edge, marked `[declared, not verified]`. Gaps new in the head are listed beside it.
2. **With no new cycle, a gap the base did not have is `NOT CHECKED`.** A pull request could hide a cycle by making what carries it unreadable (invalid YAML, a symbolic link, an opaque source, a misspelt kind). So the head's gap items (opaque sources, unreadable files, skipped objects, unresolved items, submodules) are compared with the base's as a multiset over their full keys: every field the report carries for an item (for an unresolved item its subject, reason, where, field, value, owner and candidates). Each base item matches one equal head item; every head item left over is new, so a second gap of the same kind on an object that already has one (a second unplaced source of a multi-source Application) is new too. Edges not kept over the run limit have no item list, so a higher count of them is a new gap. Any new item makes the result `NOT CHECKED`, naming each (the first 21, then a count: crankpath's `explainListEntries`). Removing a gap the base had never makes up for a new one. (Owner decision on the B8 reviews.)
3. **With no new cycle, a declared fact the base did not rely on is `NOT CHECKED` too**, in its own words: `the head relies on N declared facts the base did not`, each listed (a declared edge, a `match:` entry that overrides a host, a `crankpath.yaml` `repos:` mapping a source was read through). Never worded as reading less: the head reads as much, it declares more.

Gaps the base has too are compared as usual and stated beside the result (BR10.8): both sides' run status and opaque and skipped counts side by side (`at least` when a count is a floor), with each side's gap reasons. Base gaps can only add failures (an edge the base did not show counts as absent from it). A consequence of item matching: a pull request that adds a source carrying its own gap (an Application whose repository host is unknown, a public host whose cold start is not declared) is `NOT CHECKED` until that gap is resolved or declared. Because the keys hold the file, the document number and the field where a gap was found, a gap that only moves is new as well: renaming the file that holds a standing gap, inserting a document before it in a multi-document file, or adding a source ahead of it in a list makes the result `NOT CHECKED` with the moved gap listed. That is a false `NOT CHECKED`, never a hidden cycle; a refactoring pull request in an estate with standing gaps needs those gaps resolved first.

## NOT CHECKED

The job is not green (OD-11) and the summary and an error annotation give the reason when:

- there is no base commit (not a pull request and no `base-ref`);
- the base commit is not in the checkout, or it and the head share no merge base in the checkout (worded `(shallow clone)` when the checkout is shallow);
- the merge base is the head commit itself (nothing to compare);
- with no new cycle, the head has a gap item or relies on a declared fact the base did not (above);
- a path the Action reads in a copy (the scanned `path`, a relative `config`, a relative alias path) leads outside the copy through a symbolic link;
- a copy is over one of its bounds (below), or the file system refuses a write while copying;
- the head commit cannot be read, `path` is not inside a git checkout, or `path` or a relative `config` is missing from one of the commits;
- crankpath stops with a tool or usage error on either side (its first line is quoted);
- crankpath finds nothing to analyse on either side (`NOTHING ANALYSED`), for example a pull request that adds the whole estate;
- a render timed out on either side (its output may differ on a rerun, OD-30);
- either report cannot be read as crankpath's JSON, schema version 1;
- an input is invalid, the runner gave no `GITHUB_STEP_SUMMARY` or `GITHUB_OUTPUT` file, a commit holds a path the Action will not write (an empty, `.`, `..` or `.git` segment, or one that collides with another entry or a link), or the Action stops on an error it did not expect.

## What it writes

Only the job summary (`GITHUB_STEP_SUMMARY`), annotations (workflow commands on standard output), the two outputs (`GITHUB_OUTPUT`) and its exit status. It never writes into the checkout: from each commit it copies **only what crankpath reads** (the subtree at `path`, a relative `config`, and the subtrees of relative alias paths; the whole tree when `path` is the repository's root), **raw**, into the runner's temporary directory, from `git ls-tree -r -z -l` and `git cat-file --batch`, and removed before the Action ends. No `.gitattributes` rule, filter driver (Git LFS included), end-of-line conversion or `ident` expansion runs, whether the base, the head or the runner's git configuration names one, so the copies are the committed bytes. The copy is bounded by crankpath's own derived limits, applied to what is copied (so a pull request to a large monorepo is bounded by its estate, not the repository) and checked before anything is written: tree entries by `filesPerScan`, all blob bytes by `fetchedRepoBytes`, the largest blob by `fileBytes`, and the whole copy's time by `repoFetchWallClock`; a copy over one is `NOT CHECKED` naming it and the paths over it (the largest files, or the top-level directories with the most entries; the first 21, then a count). With `path` the repository's root the whole tree is copied, so a large unrelated file or a large repository stops the check; the message then says to set `path` to the estate's directory, and only what crankpath reads counts. The Action reads the four from the build it made, so they are the values crankpath itself uses (in this build: 279,235 files, 74,200,599 bytes, 10,000,000 bytes, 90,000 ms; `docs/limits.md` gives their derivations). A copy takes about as much disk as the checkout, per side. On a case-insensitive file system (macOS runners) two directories whose names differ only in case become one in the copy (a superset of both, the same on both sides); two files whose names differ only in case stop the copy. Regular files are written byte for byte (mode 0644, or 0755 when executable); symbolic links are recreated as links and never followed (crankpath refuses them by name), and every path the Action hands crankpath is resolved and must stay inside its copy; a submodule (gitlink) becomes an empty directory and is counted as a gap of its side ("submodules not read"), because what it holds is never read. A path that reaches crankpath through a symbolic link in its commit (the path itself or a directory above it) is `NOT CHECKED`; the Action never follows a link to decide what to copy. A copy holds no `.git`, and crankpath is given the repository's URL with `--repo-url`, so it reads no git configuration. Analysing commits, not the working tree, means both sides are read the same way and an earlier step's edits to the workspace change nothing. git runs only `rev-parse`, `merge-base`, `ls-tree` and `cat-file`, always with hooks and fsmonitor off and every transport refused; the CLI's standard output is discarded, so nothing it prints can reach the runner as a workflow command. Both runs share one chart cache (`--cache-dir`) in the Action's temporary directory, outside both copies, so a chart fetched for one side is rendered from the same bytes for the other; it is removed with the rest. The base runs first, so the head can only read what the base's run fetched. A fetch that fails for the base and succeeds for the head makes the chart's cycles count as new (a false failure, never a hidden cycle).

The build step runs `npm ci --ignore-scripts` and `npm run build` in the Action's own checkout (BR10.6): crankpath is never installed from a registry.

## Repo text is quoted and inert

Every string from the scanned repository (names, file paths, crank text, hosts, URLs with userinfo already removed by crankpath) is printed in double quotes after a fixed label, never at a line start, as crankpath escaped it (control and invisible characters as `\x1b`-style codes) and escaped again for its destination:

- **summary:** every character outside printable ASCII becomes a code, and Markdown and HTML characters (`` ` `` `<` `>` `&` `[` `]` `!` `|` `*` `_` `~` `#`) become `\xNN`; the report lines sit in one fenced `text` block, so repo text cannot make a link, an image, HTML, a heading or close the fence;
- **annotations:** `%` becomes `\x25`, and the message and properties are encoded as the runner decodes them (`%25`, `%0D`, `%0A`, plus `%3A` and `%2C` in properties), so no text can end the command or start another; an evidence file is given as the annotation's `file` only when it is a plain repository path.

The Action never says passed, OK or green; `pass` and `green` appear only negated (`Not a pass`, `This job is not green`), as M7 words them.

## The workflow token never reaches crankpath

crankpath runs with an environment allowlist (`PATH`, `HOME`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TMPDIR`, `TZ`, `NO_COLOR`) plus any `CRANKPATH_TOKEN_<HOST>` variables the workflow sets (crankpath sends each only to its own host). `GITHUB_TOKEN`, `ACTIONS_*`, `INPUT_*`, `NODE_OPTIONS` and `GIT_*` are dropped, and so is a `CRANKPATH_TOKEN_<HOST>` whose value is the workflow's own token. A test runs a probe in crankpath's place and shows neither it nor a process it starts holds the token (BR10.5).

## Bounds

- The summary stays within GitHub's 1 MiB per step: the cycle and declared-fact listing is cut with a counted line (`... N more lines not shown`), and the counts and the result line are always written.
- At most 10 error and 10 warning annotations (GitHub's limit per step); with more new cycles than fit, the last error counts the rest.

## The local harness

`npm run build && node scripts/action-local.mjs [case ...]` builds a local git repository with a base and a head commit for each case under `test/fixtures/action/` (`case.json` lists the fixture layers of each commit and the result it expects), runs the `check` step of `action/action.yml` as the runner would (its bash `run` line, with its `env` evaluated from the inputs' defaults and the case's base commit standing for `github.event.pull_request.base.sha`), with the GitHub variables pointed at temporary files and a fake workflow token set, and prints the exit status, outputs, annotations and job summary. No `act`, no network, no GitHub. Cases: `add-crank`, `add-cycle`, `add-helm-chart`, `crank-and-new-cycle`, `gap-rise`, `hostile-name`, `no-base`, `nothing-analysed`, `remove-crank`, `shallow`, `tool-error`, `unrelated-change`. It skips the two steps before `check`: `setup-node` (it uses the Node running it) and the build step (`npm ci`, `npm run build`; it uses the `dist/` already built). Only a hosted run exercises those. A case with `"tools": "fake"` (`add-helm-chart`) puts the fake helm and kustomize of `test/fixtures/fake-tools` first on PATH, so its render is the same on every machine; the other cases render nothing.

## Example output

<!-- claim CL-9 -->
From `npm run build && node scripts/action-local.mjs add-cycle add-crank gap-rise no-base`, run 2026-11-16 (Node v22.23.2, git 2.55.0, macOS arm64); the harness prints the same bytes on every run. Each case's job summary is the Markdown the Action appends to `GITHUB_STEP_SUMMARY`.

````text
== case: add-cycle
   A PR that adds a cycle: Gitea moves under Argo CD and serves the repository Argo CD reads it from (BR10.1).
exit status: 1
outputs (GITHUB_OUTPUT):
  result=FAILED
  new-cycles=1
annotations (workflow commands on standard output): 2
  ::error file=apps/gitea.yaml,title=crankpath new uncranked cycle::New uncranked cycle c-d8197e7d (label: extracted, 8 edges; head only, base has 0 of its edges): Application "argocd/gitea" reads source from Service "gitea/gitea-http"  [file: "apps/gitea.yaml"]
  ::warning title=crankpath gaps::The base analysis has gaps: Base: ANALYSED WITH GAPS (0 opaque, 0 skipped). An edge the base did not show counts as absent from it, so a head cycle may be reported new; the gaps are listed in the job summary.
job summary (GITHUB_STEP_SUMMARY):
## crankpath: FAILED

crankpath 0.1.0; base commit 806e09fe3c63 (the merge base of base-ref "806e09fe3c637c266f4dce6daa9554acf4d0baf3" and the head); head commit 1e0933967bed.

```text
New uncranked cycles: 1
  cycle c-d8197e7d  label: extracted  edges: 8   (head only; base has 0 of its edges)
    Application "argocd/gitea" reads source from Service "gitea/gitea-http"  [file: "apps/gitea.yaml"]
    ConfigMap "gitea/gitea-config" deployed by Application "argocd/gitea"  [file: "apps/gitea.yaml"]
    Deployment "gitea/gitea" deployed by Application "argocd/gitea"  [file: "apps/gitea.yaml"]
    Deployment "gitea/gitea" needs ConfigMap "gitea/gitea-config"  [file: "platform/gitea/deployment.yaml"]
    Deployment "gitea/gitea" needs Secret "gitea/gitea-admin"  [file: "platform/gitea/deployment.yaml"]
    Secret "gitea/gitea-admin" deployed by Application "argocd/gitea"  [file: "apps/gitea.yaml"]
    Service "gitea/gitea-http" deployed by Application "argocd/gitea"  [file: "apps/gitea.yaml"]
    Service "gitea/gitea-http" selects Deployment "gitea/gitea"  [file: "platform/gitea/service.yaml"]
Cranks, declared edges and externals added by this pull request: 0
Base: ANALYSED WITH GAPS (0 opaque, 0 skipped).  Head: ANALYSED (0 opaque, 0 skipped).
  base gaps: unresolved-items (1 unresolved item)
Result: FAILED (new uncranked cycle)
```
````

<!-- claim CL-9 -->
Case `add-crank` of the same run, `node scripts/action-local.mjs add-cycle add-crank gap-rise no-base`, run 2026-11-16:

````text
== case: add-crank
   A PR that adds the same cycle and a crank that breaks it: honoured, listed as documented by the PR author and not verified (BR10.3, BR10.10).
exit status: 0
outputs (GITHUB_OUTPUT):
  result=NO_NEW_CYCLES_FOUND
  new-cycles=0
annotations (workflow commands on standard output): 2
  ::warning title=crankpath declared facts::This pull request adds or changes 1 declared fact (cranks, declared edges, externals, match entries or repos: mappings): documented by the PR author, not verified. They are listed in the job summary.
  ::warning title=crankpath gaps::The base analysis has gaps: Base: ANALYSED WITH GAPS (0 opaque, 0 skipped). An edge the base did not show counts as absent from it, so a head cycle may be reported new; the gaps are listed in the job summary.
job summary (GITHUB_STEP_SUMMARY):
## crankpath: NO_NEW_CYCLES_FOUND (not a pass)

crankpath 0.1.0; base commit 806e09fe3c63 (the merge base of base-ref "806e09fe3c637c266f4dce6daa9554acf4d0baf3" and the head); head commit 31e78dea40ae.

```text
No new uncranked cycle found. Not a pass: it rests on 1 declared fact this pull request added or changed, which crankpath does not verify.
Cycles cranked in the head: 1 (by cranks documented, not verified)
  cycle c-d8197e7d  label: cranked  edges: 8   (cranked by a crank this pull request adds; 8 of its edges are new in this pull request)
Cranks, declared edges and externals added or changed by this pull request: 1 (documented by the PR author, not verified)
  crank 1 by: "kubectl apply -f platform/gitea from a laptop checkout, runbook BS-1"  ref: "runbooks/bs-1.md"  (creates 4 nodes; documented by the PR author, not verified)
Base: ANALYSED WITH GAPS (0 opaque, 0 skipped).  Head: ANALYSED (0 opaque, 0 skipped).
  base gaps: unresolved-items (1 unresolved item)
Result: NO_NEW_CYCLES_FOUND (not a pass; see the first line)
```
````

<!-- claim CL-9 -->
Case `gap-rise` of the same run, `node scripts/action-local.mjs add-cycle add-crank gap-rise no-base`, run 2026-11-16:

````text
== case: gap-rise
   The head reads less than the base: the PR makes the file holding the Gitea cycle unreadable, so the cycle drops out of the head. NOT CHECKED naming the counts that rose, never cleared (M1).
exit status: 1
outputs (GITHUB_OUTPUT):
  result=NOT_CHECKED
  new-cycles=
annotations (workflow commands on standard output): 1
  ::error title=crankpath NOT CHECKED::NOT CHECKED: the head has 2 gaps the base did not have, so what they hide could not be compared (listed below). This job is not green.
job summary (GITHUB_STEP_SUMMARY):
## crankpath: NOT CHECKED

crankpath 0.1.0; base commit 4800de6d55e3 (the merge base of base-ref "4800de6d55e3f4c15316fc87cbe39476bb08696b" and the head); head commit a11eed4a99cb.

```text
NOT CHECKED: the head has 2 gaps the base did not have, so what they hide could not be compared (listed below). This job is not green.
  new in the head: unreadable file "apps/gitea.yaml"  (not valid YAML)
  new in the head: unresolved host-unplaced  subject: "Application/argocd/web"  where: "apps/web.yaml\x231"
Base: ANALYSED (0 opaque, 0 skipped).  Head: ANALYSED WITH GAPS (at least 0 opaque, 0 skipped).
Result: NOT CHECKED (no comparison was made; the job is not green)
```
````

<!-- claim CL-9 -->
Case `no-base` of the same run, `node scripts/action-local.mjs add-cycle add-crank gap-rise no-base`, run 2026-11-16:

````text
== case: no-base
   No base commit (not a pull request, no base-ref): NOT CHECKED, the job is not green (BR10.7).
exit status: 1
outputs (GITHUB_OUTPUT):
  result=NOT_CHECKED
  new-cycles=
annotations (workflow commands on standard output): 1
  ::error title=crankpath NOT CHECKED::NOT CHECKED: no base commit (this is not a pull_request event and no base-ref was given). This job is not green.
job summary (GITHUB_STEP_SUMMARY):
## crankpath: NOT CHECKED

crankpath 0.1.0; base commit (none); head commit 8179283afa73.

```text
NOT CHECKED: no base commit (this is not a pull_request event and no base-ref was given). This job is not green.
Result: NOT CHECKED (no comparison was made; the job is not green)
```
````
