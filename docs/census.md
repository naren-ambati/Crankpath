# Day-1 census (D12, OD-19, OD-26): the opaque share of five public estates

This file is the census record. Its first two sections, the five estates and the classifier's rules, were written and committed before the first count (BR11.18, OD-26) and are kept as written. The independent review of B0 then found that the rules were not conservative in six cases and that the label `static upper bound` was not earned; section 2a lists the rule amendments made after the review, as such, and section 3 gives the result of re-running the amended rules on the same five estates at the same commits. Section 4 keeps the first count, now superseded. Section 5 is the census re-run with real discovery (B9, OD-19), side by side with the static estimate.

## 1. The five estates (OD-26 record)

The five estates were chosen by the build lead for the owner on 2026-11-15, before any count, with the selection rule written first. The table and the rule are copied here unchanged in substance.

Selection rule, written before any count: from GitHub repository searches run 2026-11-15 (unauthenticated REST search, sorted by stars: `topic:flux topic:homelab`, `topic:argocd topic:homelab`, `topic:fluxcd topic:gitops`, `topic:gitops topic:argocd topic:kubernetes`, `gitops-bridge in:name`, `gitops-bridge argocd`), take the most-starred repositories that are (a) not archived, (b) under MIT, Apache-2.0 or BSD (so a file could be copied later if ever needed; nothing is vendored for the census), (c) not one of the six the research examined (onedr0p/home-ops, bjw-s-labs/home-ops, fluxcd/flux2-kustomize-helm-example, khuedoan/homelab, argoproj/argocd-example-apps, gitops-bridge-dev/gitops-bridge-argocd-control-plane-template), (d) an estate, not a tool or list, and (e) containing Flux or Argo CD objects (presence checked with one grep per kind, yes/no only; nothing counted): one gitops-bridge estate with `$values`, two Argo CD estates, two Flux estates. Commits are the default-branch HEAD read on 2026-11-15 with `git ls-remote` or a shallow clone.

| # | Estate | Commit | Commit date | Licence | Stars (2026-11-15) | Shape | Why |
|---|---|---|---|---|---|---|---|
| 1 | https://github.com/gitops-bridge-dev/gitops-bridge | cac900a22e6b82fd011f0f5f94dc35a1614cf24d | 2024-07-18 | Apache-2.0 | 689 | Argo CD, gitops-bridge, `$values` present | most-starred gitops-bridge repo; the required `$values` estate |
| 2 | https://github.com/mortennordbye/homelab | d1f07baeda9ccc196f17017bfaa547c867e0a768 | 2026-11-15 | Apache-2.0 | 365 | Argo CD homelab | most-starred permissive Argo CD homelab in `topic:argocd topic:homelab` |
| 3 | https://github.com/acelinkio/argocd-homelab | 2f9aab023f92b6d73051bd86ec163a48a56dbe1e | 2026-10-28 | MIT | 62 | Argo CD homelab | next permissive non-archived Argo CD homelab in the same search (the ones above it are unlicensed, GPL, WTFPL, CC0 or archived) |
| 4 | https://github.com/ricsanfre/pi-cluster | adf08ec2915bfc39e720b36a610ecfc94cb00634 | 2026-11-15 | MIT | 591 | Flux | most-starred permissive Flux estate in `topic:fluxcd topic:gitops` (higher entries are tools) |
| 5 | https://github.com/niki-on-github/nixos-k3s | 9318b97bfdb1c49bc844734d4301d9c0142cab3a | 2026-05-15 | MIT | 192 | Flux | most-starred permissive Flux estate in `topic:flux topic:homelab` (buroa/home-ops is WTFPL, ahinko/home-ops Unlicense and archived) |

None is vendored: the census fetches each read-only at the commit into a cache outside the repository and records only URLs, commits and counts.

## 2. The classifier's rules (written before the first count)

(This section is the record as committed before the first count was run. Amended once before the first count was run, in the same session that chose the rules, so the history cannot show that the amendment was made without having looked at the estates: the paragraph on how an ApplicationSet generator's kind is decided before its template, so that a cluster generator's templated `repoURL` is reported as missing cluster inputs, its real cause, and a `git` generator's own parameters are not mistaken for unsupported templates.)

The census is a **static upper bound** of the opaque share: it reads files, it renders nothing and fetches no chart. It is labelled `static-upper-bound` until B9 re-runs it with the real discovery code (OD-19). Conservative means: when the static script cannot tell, the source is opaque. *(Superseded: the figure is labelled `static-estimate`, not an upper bound; see section 2a, item 9.)*

### What is read
- Every regular file ending in `.yaml` or `.yml` under the estate's checkout, outside `.git/`, read only through BoundedReader (the derived limits of `docs/limits.md`). A file BoundedReader refuses (a parse error, a limit, a symlink) is an **unreadable file**: counted and listed by refusal, and any source it holds is missing from the denominator. Files under a Helm chart's `templates/` folder (Go templates, rendered only by helm) are counted separately among the unreadable files.
- Symlinks are not followed; each is counted.
- Each estate's own URL is its census URL above. A `repoURL` is the estate's own repository only when it normalises equal to that URL (the FR2.3 rule: scheme and userinfo dropped for https, http, ssh and scp forms; host lower-cased; default port, trailing `.git` and `/` dropped; path compared case-sensitively). Anything else is another repository, even when it looks similar.

### The denominator (HelmReleases plus Applications, OD-19)
- Each document of kind `Application` with an `argoproj.io/` apiVersion counts once.
- Each document of kind `HelmRelease` with a `helm.toolkit.fluxcd.io/` apiVersion counts once.
- An `ApplicationSet` (`argoproj.io/`) counts by generator, because the static script cannot see what most generators produce:
  - a `list` generator with literal `elements` counts once per element (each element is a generated Application, classified with the template after substituting that element's values for simple `{{key}}`, `{{.key}}` or `{{ .key }}` references);
  - every other generator counts **once** (a `git` generator is not expanded: matching the repository's paths is discovery's job, B3), so the Applications it would generate are not in the denominator;
  - therefore whenever an estate has an ApplicationSet whose generators were counted once, the denominator is a floor and the result says **at least**.
- The same object in two files counts twice (no de-duplication: two copies in two overlay folders usually deploy to two places).

### Static reasons a source is opaque
An ApplicationSet generator's kind is decided first, before its template is looked at: `clusters`, `matrix` and `merge` make the source opaque `cluster-inputs-missing` (rule 2) and `scmProvider`, `pullRequest`, `clusterDecisionResource`, `plugin` and unknown kinds make it opaque `unsupported-field` (rule 3); a `list` element and a `git` generator go on to the template. For a `git` generator the template's references to the generator's own parameters (`path`, `path.*`, `path[n]`, and for a `files` generator any key, since those values come from files in the estate's own repository) count as resolved, except in `repoURL`, where any template construct stays unresolved (it could name another repository); its source is the template plus the generator's own `repoURL` (rule 4 applies to it).

Every other source gets exactly one reason, the first in this order that applies (the reason names are FR4.1's):

1. `unsupported-template`: a field the classifier reads (`repoURL`, `path`, `chart`, `targetRevision`, `ref`, `helm.valueFiles`, a HelmRelease's chart and source reference) still holds a template construct (`{{`) after the list-element substitution. This covers Applications written inside Helm chart templates that happen to parse as YAML, and `elementsYaml` list generators.
2. `cluster-inputs-missing`: an ApplicationSet generator `clusters`, `matrix` or `merge` (each needs cluster Secret labels and annotations that live outside the repository; with no `clusters:` block in a `crankpath.yaml`, the product marks them opaque).
3. `unsupported-field`: an ApplicationSet generator `scmProvider`, `pullRequest`, `clusterDecisionResource`, `plugin` or any other kind not listed here; an Application source with `plugin`, `helm.parameters`, `helm.fileParameters`, `directory.jsonnet`, `directory.include` or `directory.exclude`; a source with no `repoURL`; a `$values/...` value file naming a `ref` no source declares; a chart repository that is not `https://` or `oci://` (plain `http://` included), or whose host is an IP literal, `localhost`, a loopback or a link-local address; a Flux `Bucket` source; a kustomization in the source path that uses `generators:` or `transformers:` (kustomize plugins, never run).
4. `unreadable-repo`: a Git source (`path` or `ref`, a Flux `GitRepository`) whose `repoURL`/`url` is not the estate's own repository after normalisation (multi-repo: crankpath never guesses that two URLs name one repository); a HelmRelease whose chart source (`HelmRepository`, `GitRepository`, `OCIRepository`, `HelmChart`) is not defined in the repository.
5. `private-chart`: a chart source that needs credentials: an Argo CD repository-credential Secret in the repository (label `argocd.argoproj.io/secret-type: repository` with a literal `url` equal to the chart `repoURL`, or `repo-creds` with a `url` that is a path-segment prefix of it); a Flux `HelmRepository` or `OCIRepository` with `secretRef` or `certSecretRef`. A chart repository that needs credentials not represented in the repository cannot be seen statically; it is a known gap of this static count.
6. `remote-base`: a kustomization in an Application's own-repository source path that lists a remote resource (an entry with `://`, a `github.com/` prefix or a `?ref=`).
7. `encrypted-values`: a HelmRelease `valuesFrom` Secret defined in the repository with a top-level `sops` key; a SOPS-encrypted document (top-level `sops` key) directly in an Application's own-repository source path; a HelmRelease that uses Flux variables (`${...}`) under a Flux Kustomization (one whose `spec.path` contains the HelmRelease's file) whose `postBuild.substituteFrom` names a Secret with a `sops` key.
8. `cluster-created-values`: a HelmRelease `valuesFrom` ConfigMap or Secret that the repository does not define (as a document of that kind and name, or by a kustomize `configMapGenerator`/`secretGenerator` of that name), including one an `ExternalSecret` creates; the same for a `postBuild.substituteFrom` entry that covers a HelmRelease using `${...}` variables.
9. `unreadable-file`: an Application's own-repository Git source whose `path` does not exist in the checkout.

A source none of these rules marks is counted as not opaque. That is not a claim that crankpath will render it: renders can still fail, and this static census never runs one.

### What the output holds (C11)
`scripts/census.mjs` writes JSON with, per estate, `url`, `sha`, `total`, `opaque`, `byReason`, the fraction, the unreadable-file and symlink counts and whether the figure is a floor (`atLeast`), then the total `{total, opaque, fraction}` and `label: static-upper-bound`. Fractions are `opaque / total` rounded to four decimals. No file content and no copied text are in it: only URLs, commits, counts and crankpath's own reason names.

## 2a. Rule amendments made after the B0 review (after the first count)

These amendments were made after the first count, because the independent review reproduced cases the section 2 rules counted as readable although the files do not show that they are. Each makes the classifier stricter (more sources opaque); none relaxes a rule. Each has a regression test in `test/u11-validation-harness/census-lib.test.ts` that failed on the section 2 classifier.

1. **Flux variables.** A HelmRelease that uses `${...}` variables is opaque `unsupported-template` unless a Flux Kustomization in the repository covers its file and has a `postBuild`; with one, its `substituteFrom` entries are classified as before (a SOPS Secret: `encrypted-values`; not defined: `cluster-created-values`). Before, a HelmRelease with no covering Kustomization, or with one without `postBuild`, was readable.
2. **Kustomize closure.** An Application's own-repository source path is followed through every local `resources`, `bases` and `components` entry to any depth inside the repository. Anywhere on the way: a remote entry is `remote-base`; `generators`, `transformers`, `validators` or `helmCharts` is `unsupported-field`; an entry outside the repository or not found, or a kustomization BoundedReader could not read, is `unreadable-file`. Before, only the source directory itself was checked.
3. **Content under the source path.** A SOPS document anywhere under the source path (or any file the closure reaches) is `encrypted-values`, and a YAML file under it that BoundedReader refused is `unreadable-file` (its content is unknown), except Go templates in a chart's `templates/` folder, which helm renders. Before, only the source directory itself was checked and unreadable files were ignored.
4. **Value files.** Each `helm.valueFiles` entry must be a readable file in the estate's repository (relative to the source path, or to the repository root for `$ref/`): missing, unreadable or outside the repository is `unreadable-file`, a SOPS document is `encrypted-values`, a URL is `unsupported-field`, and a value file of a remote chart (which cannot be checked statically) is `unreadable-file`. Before, existence was never checked.
5. **ApplicationSet overrides.** A `templatePatch`, or a template given on a generator, makes every source of that generator `unsupported-template`; a `list` generator with a `selector` is counted once, `unsupported-field`. Before, both were ignored.
6. **Lists.** The items of a `kind: List` (or any `...List` kind) are counted as objects. Before, an Application inside a List was not counted at all.
7. **Siblings found while fixing the six.** A `<path:...>` placeholder or an `avp.kubernetes.io/` annotation (a secrets plugin) is `unsupported-field`; a chart `repoURL` with userinfo is `private-chart`; when the repository holds an Argo CD repository credential whose `url` cannot be read (SOPS-encrypted, templated or absent), every Argo CD chart source is `private-chart` (any of them could be the one it is for); a source document that itself carries a `sops` key is `encrypted-values`; a source document in a file that a kustomization reaches and patches with a patch that may target an Application, ApplicationSet or HelmRelease (or whose target cannot be told) is `unsupported-template`; a Flux chart source defined more than once under one name is checked against every definition and the strongest reason wins; a Flux `GitRepository` chart path that does not exist is `unreadable-file`.
8. **Never a crash.** A malformed percent escape in a `repoURL` is not the estate's repository (it used to throw and abort the run), and a source the classifier cannot handle is opaque `unsupported-field` (`unclassifiable`) instead of an exception.
9. **What the figure is called.** The rules now err toward opaque on everything the repository's files show, but a static reading still cannot see three things (written into the JSON as `notSeen`): chart repositories that need credentials kept outside the repository, renders that fail, and sources generated by templates crankpath could not read (unreadable files and generators counted once). Both counts are floors. The figure is therefore neither an upper nor a lower bound of what crankpath will find, and is labelled **`static-estimate`** (not the `static-upper-bound` of C11's two values). Each estate's place against one third is stated only as far as the counts establish it (`againstOneThird`).

## 2b. Rule amendments made after the second review

Also after the first count, and each stricter or a wording fix (regression tests in `census-lib.test.ts`, "findings of the second review", red on the section 2a classifier):

1. **Patches to consulted objects.** A kustomize patch that may target any kind the classifier reads (Application, ApplicationSet, HelmRelease, Flux Kustomization, HelmRepository, GitRepository, OCIRepository, HelmChart, Bucket, Secret, ConfigMap, ExternalSecret), or whose target cannot be told, makes a source opaque `unsupported-template` both when the source is in a patched file and when an object the source consults is (detail `a consulted object is patched`); a patched repository-credential Secret counts as a credential whose url cannot be read. Before, only patches aimed at the three source kinds counted.
2. **Kustomization cycles.** A kustomization reached again on its own path is `unreadable-file` (`kustomization cycle`); kustomize refuses a cycle, so the render would fail. Closures are memoised, so a long chain is linear.
3. **Wording.** A share not over one third is `not established`, never `at most one third` (failed renders and credentials kept elsewhere can only add opaque sources). The figure counts **units**: sources (Applications, HelmReleases, list-generated Applications) plus ApplicationSet generators counted once; the JSON says so in `unit`.
4. **scp form.** Percent escapes in an scp-style address are decoded like those of an https URL (a malformed one is not the estate's repository), and a `...List` object is kept as an object as well as expanded.

## 3. Results (static estimate until B9 re-runs it with real discovery)

Run on 2026-11-15 (Node 22.23.2, git 2.55.0, macOS arm64) with the section 2a and 2b rules (the 2b rules changed no count on these five estates, only the wording), on the same five commits (the cached checkouts, verified clean and at the recorded commit):

```
npm run build && node scripts/census.mjs --out docs/census-2026-11-15-static.json
```

A second run, and a third with `LANG=de_DE.UTF-8 LC_ALL=de_DE.UTF-8`, wrote byte-identical JSON (`cmp`). The committed result is `docs/census-2026-11-15-static.json`. Every figure below is copied from it.

| Estate | Commit | Opaque of counted units | Fraction | Against one third | Reasons | Floor | Files read / unreadable / symlinks |
|---|---|---|---|---|---|---|---|
| gitops-bridge-dev/gitops-bridge | cac900a2 | 29 of 29 | 1.0 | over one third of the counted units; not established for the estate | cluster-inputs-missing 24 (22 `clusters`, 2 `merge` generators), unreadable-repo 5 | at least: 24 generators counted once, 1 unreadable file | 42 / 1 / 0 |
| mortennordbye/homelab | d1f07bae | 1 of 2 | 0.5 | over one third of the counted units; not established for the estate | unsupported-template 1 (an ApplicationSet `templatePatch`) | at least: 2 `git` generators counted once | 500 / 0 / 2 |
| acelinkio/argocd-homelab | 2f9aab02 | 4 of 25 | 0.16 | not established | unsupported-field 3 (2 chart repositories written without a scheme, Argo CD's form for an OCI registry, refused as not `https://` or `oci://`; 1 `directory.include`), unreadable-repo 1 | at least: 1 generator counted once | 36 / 0 / 0 |
| ricsanfre/pi-cluster | adf08ec2 | 32 of 36 | 0.8889 | over one third of the counted units; not established for the estate | unsupported-template 32 (HelmReleases in files that kustomize overlays patch) | at least: 14 unreadable files | 1111 / 14 / 0 |
| niki-on-github/nixos-k3s | 9318b97b | 110 of 122 | 0.9016 | over one third | cluster-created-values 81 (variables substituted from a Secret the repository does not define), unsupported-template 29 (variables with no covering Kustomization that has a `postBuild`: here the `postBuild` is added by a Kustomization patch, which a static reading does not apply) | exact for what it counts | 502 / 0 / 0 |

**Total: at least 176 of 214 counted units are opaque, 0.8224; over one third of the counted units, not established for the estates as a whole** (four estates hold uncounted sources). A unit is a source, or an ApplicationSet generator counted once: 24 of gitops-bridge's 29 units are cluster or merge generators, each standing for an unknown number of Applications. One estate is over one third with nothing uncounted: niki-on-github/nixos-k3s (110 of 122). The four others are over or under one third only among what was counted.

Top reasons over all five: cluster-created-values 81 (all in nixos-k3s), unsupported-template 62 (32 kustomize-patched HelmReleases in pi-cluster, 29 uncovered Flux variables in nixos-k3s, 1 `templatePatch`), cluster-inputs-missing 24 (all in gitops-bridge), unreadable-repo 6, unsupported-field 3.

How much the total rests on single estates (arithmetic on the committed counts, not new runs): without nixos-k3s the total is 66 of 92 (0.7174); without pi-cluster 144 of 178 (0.809); without gitops-bridge 147 of 185 (0.7946); the unweighted mean of the five estate fractions is 0.6901.

What the figure is and is not:
- It is a **static estimate**: every rule errs toward opaque on what the files show, but it cannot see what only a fetch or a render shows (`notSeen` in the JSON), and both counts are floors. It is not an upper bound.
- Much of the rise from the first count comes from rules that mark a source opaque because a static reading cannot apply something the product will apply: kustomize patches (pi-cluster, 32) and patched-in `postBuild` blocks (nixos-k3s, 29). crankpath renders kustomize (B2, B3), so the real-discovery figure of B9 is expected to be lower for those sources; this static estimate does not show by how much.
- It is not a measurement of crankpath: discovery, rendering and repo identity do not exist yet. B9 re-runs the census with the real discovery code.

**What D12 makes of it (a scope decision, not a stop).** Among the counted units the share is over one third, and one estate is over one third with nothing uncounted. So, conservatively:
- the README must state opacity first, before the two homelab cycles (the release round rewrites the README; recorded for the owner in `BUILD-NOTES.md`);
- the owner picks the v1.1 item for the top reason: `cluster-created-values` maps to the v1.1 item "values held in encrypted or cluster-created Secrets" (here: Flux `postBuild.substituteFrom` naming a Secret created outside the repository); `unsupported-template` is mostly kustomize patches and patched-in substitutions, which the MVP's kustomize rendering is expected to read; `cluster-inputs-missing` maps to "ApplicationSet cluster generators without a `clusters:` block";
- B1 proceeds either way.

## 4. The first count (superseded by section 3)

Kept for the record: the result of the section 2 rules, run on 2026-11-15 with `npm run build && node scripts/census.mjs --out docs/census-2026-11-15-static.json` after sections 1 and 2 were committed. It was labelled a static upper bound; the review showed the rules were not conservative, so that label was wrong. The first run fetched the five commits (about five minutes); a second run from the cache, and a third with `LANG=de_DE.UTF-8 LC_ALL=de_DE.UTF-8`, wrote byte-identical JSON (`cmp`). The committed result is `docs/census-2026-11-15-static.json`. Every figure below is copied from it.

| Estate | Commit | Opaque of counted | Fraction | Against one third | Reasons | Floor | Files read / unreadable / symlinks |
|---|---|---|---|---|---|---|---|
| gitops-bridge-dev/gitops-bridge | cac900a2 | 29 of 29 | 1.0 | over one third | cluster-inputs-missing 24 (22 `clusters`, 2 `merge` generators), unreadable-repo 5 | at least: 24 generators counted once | 42 / 1 (a chart template, parse error) / 0 |
| mortennordbye/homelab | d1f07bae | 0 of 2 | 0 | under | none | at least: 2 `git` generators counted once (the Applications they generate are not counted) | 500 / 0 / 2 |
| acelinkio/argocd-homelab | 2f9aab02 | 4 of 25 | 0.16 | under | unsupported-field 3 (2 chart repositories written without a scheme, Argo CD's form for an OCI registry, which the written rule refuses as not `https://` or `oci://`; 1 `directory.include`), unreadable-repo 1 | at least: 1 generator counted once | 36 / 0 / 0 |
| ricsanfre/pi-cluster | adf08ec2 | 0 of 36 | 0 | under | none | at least: 14 files unreadable (parse errors, 13 of them in a `boilerplate/` template folder) | 1111 / 14 / 0 |
| niki-on-github/nixos-k3s | 9318b97b | 81 of 122 | 0.6639 | over one third | cluster-created-values 81 (Flux variables substituted from a Secret the repository does not define) | exact for what it counts | 502 / 0 / 0 |

Total then: at least 114 of 214 counted sources are opaque, 0.5327, over the one-third threshold. Two estates are over one third on their own: gitops-bridge-dev/gitops-bridge (29 of 29) and niki-on-github/nixos-k3s (81 of 122).

Top reasons over all five: cluster-created-values 81 (all in nixos-k3s), cluster-inputs-missing 24 (all in gitops-bridge), unreadable-repo 6, unsupported-field 3. No source was opaque for private-chart, remote-base, encrypted-values, unsupported-template or unreadable-file.

How much the total rests on single estates (arithmetic on the committed counts, not new runs): nixos-k3s holds 122 of the 214 counted sources; without it the total is 33 of 92 (0.3587), still over one third; without gitops-bridge it is 85 of 185 (0.4595); the unweighted mean of the five estate fractions is 0.3648. Two estates (mortennordbye/homelab and, to a lesser degree, acelinkio/argocd-homelab) are counted mostly through `git` generators counted once, so their denominators are far below the Applications they deploy.

What the figure is and is not:
- It is a **static upper bound** in the sense of OD-19: the rules mark a source opaque whenever a static reading cannot show crankpath could read it, and nothing was rendered or fetched besides the five commits.
- The counts are floors (`at least`): `git`, cluster and merge generators were counted once each, and 15 unreadable files may hold sources that are not counted at all.
- It is not a measurement of crankpath: the discovery, rendering and repo-identity code do not exist yet. B9 re-runs the census with the real discovery code.

What D12 was said to make of it then: The total is over one third, so:
- the README must state opacity first, before the two homelab cycles (the release round rewrites the README; recorded for the owner in `BUILD-NOTES.md`);
- the owner picks the v1.1 item for the top reason: `cluster-created-values` maps to the v1.1 item "values held in encrypted or cluster-created Secrets" (here: Flux `postBuild.substituteFrom` naming a Secret created outside the repository); the second reason, `cluster-inputs-missing`, maps to "ApplicationSet cluster generators without a `clusters:` block" (the MVP's `clusters:` block is the planned answer for it);
- B1 proceeds either way.

## 5. The census with real discovery (B9, OD-19)

Run on 2026-11-16 (Node 22.23.2, helm v4.3.2, kustomize v5.8.1, macOS arm64, with the network) by the built crankpath itself, over the same five checkouts (verified at the recorded commits; a checkout at any other commit is refused):

```
npm run build && node scripts/census-real.mjs --out docs/census-2026-11-16-real.json
```

A second run from the same caches, and a third under `LANG=de_DE.UTF-8 LC_ALL=de_DE.UTF-8`, wrote byte-identical JSON (`cmp`). The committed result is `docs/census-2026-11-16-real.json`, labelled `real-discovery`; every figure below is copied from it. crankpath ran with no `crankpath.yaml` of its own and no `--repo-alias`: each estate as it is published, with only its own URL.

Two figures per estate, both against the one-third threshold of D12:

- **D12 units** (the census's own denominator, OD-19): Applications (the ones crankpath generated from ApplicationSets included) and HelmReleases, plus each ApplicationSet or Flux Kustomization crankpath could not expand or read, counted once, since it stands for the Applications or HelmReleases it would have given. Counting it once makes the figure a floor (`at least`).
- **All source kinds** (crankpath's own opacity line, FR4.4): every Application, ApplicationSet, Flux Kustomization, HelmRelease and Kustomize root.

| Estate | Commit | Static estimate (section 3) | Real discovery, D12 units | Against one third | Real reasons (D12 units) | Real discovery, all source kinds |
|---|---|---|---|---|---|---|
| gitops-bridge-dev/gitops-bridge | cac900a2 | at least 29 of 29 (1) | at least 6 of 6 (1) | over one third | cluster-inputs-missing 4, unreadable-repo 2 | at least 6 of 6 (1) |
| mortennordbye/homelab | d1f07bae | at least 1 of 2 (0.5) | at least 30 of 40 (0.75) | over one third | unsupported-field 29, unsupported-template 1 | at least 60 of 104 (0.5769) |
| acelinkio/argocd-homelab | 2f9aab02 | at least 4 of 25 (0.16) | at least 4 of 25 (0.16) | not established (at or under one third of what was counted, a floor) | unsupported-field 3, unreadable-repo 1 | at least 4 of 25 (0.16) |
| ricsanfre/pi-cluster | adf08ec2 | at least 32 of 36 (0.8889) | at least 62 of 62 (1) | over one third | unreadable-repo 62 | at least 78 of 378 (0.2063) |
| niki-on-github/nixos-k3s | 9318b97b | at least 110 of 122 (0.9016) | at least 166 of 178 (0.9326) | over one third | unsupported-field 156, unreadable-repo 6, cluster-created-values 3, render-failed 1 | at least 168 of 326 (0.5153) |

Why each figure is a floor, and why the two can disagree. A unit crankpath could not expand or read (an ApplicationSet, a Flux Kustomization) is counted once and is opaque; every unit it hides sits behind an opaque source and is opaque too, so adding the hidden units would raise the opaque count and the total by the same number, and a share over one third would stay over it. Units in files crankpath could not read at all are not counted, and could be either; for those, only the opaque count is a floor, not the share. The two figures count different things: D12 units count only Applications, HelmReleases and the sources that stand for them, while all source kinds also count every Kustomize root, which crankpath builds on its own whether or not anything deploys it. pi-cluster shows the difference: its 62 Flux Kustomizations are all unreadable (62 of 62 D12 units, over one third), while its 316 Kustomize roots are mostly readable, which brings the all-kinds share down to 0.2063; with the floor, that is not established either way.

**Total with real discovery: at least 268 of 311 D12 units are opaque, 0.8617, over one third** (static estimate: at least 176 of 214, 0.8224). Over all source kinds, crankpath's own opacity line: at least 316 of 839 sources, 0.3766, over one third. Every run's status is `ANALYSED WITH GAPS`, and every figure is a floor.

Top reasons over the five (D12 units): unsupported-field 188, unreadable-repo 71, cluster-inputs-missing 4, cluster-created-values 3, render-failed 1, unsupported-template 1. Over all source kinds: unsupported-field 218, unreadable-repo 71, remote-base 10, unreadable-file 7, cluster-inputs-missing 4, cluster-created-values 3, render-failed 2, unsupported-template 1.

What changed from the static estimate, and why:
- **Kustomize patches and patched-in `postBuild` blocks are no longer guessed at.** The static rules made 32 pi-cluster HelmReleases and 29 nixos-k3s sources opaque because a static reading cannot apply a patch; crankpath renders kustomize, so those rules are gone. The real count finds other, larger walls instead.
- **Flux sources that are not a GitRepository.** 148 of nixos-k3s's Kustomizations read from a source kind other than `GitRepository` (`spec.sourceRef.kind`), which crankpath does not read: `unsupported-field`. This is now the largest single reason.
- **A bootstrap-created GitRepository.** All 62 of pi-cluster's Kustomizations name the `flux-system` GitRepository, which the Flux bootstrap creates in the cluster and the repository does not define: `unreadable-repo`. The HelmReleases they hold (the static estimate found them in the files) are behind them and uncounted, so pi-cluster's D12 figure is the 62 Kustomizations, each counted once. The other 6 Kustomizations of the reason `unreadable-repo` are nixos-k3s's: they name a `flux-system` GitRepository that the repository does not define either (`its GitRepository is not defined in the repository`, seen in a rerun of crankpath from the census cache with `--no-network` on 2026-11-16); whether nixos-k3s's bootstrap creates it was not checked. The total of that reason is 68.
- **Helm inflation in kustomize.** 28 of mortennordbye/homelab's generated Applications (and 29 Kustomize roots) use kustomize `helmCharts`, which crankpath never enables: `unsupported-field`. The static count saw 2 units there, because it did not expand the `git` generators; crankpath generated 39 Applications from them.
- **ApplicationSets are counted once each, not once per generator.** gitops-bridge's 4 cluster-generator ApplicationSets are `cluster-inputs-missing` (no `clusters:` block) and count 4 units; the static estimate counted its 24 generators.
- **The cluster-created values shrank, because what held them is now unread.** crankpath reached 20 of nixos-k3s's HelmReleases (the static estimate counted 122 units there): most sit behind the Kustomizations of the source-kind wall above, so their values are never looked at. The static estimate's 81 `cluster-created-values` were among those (not checked one by one); 3 HelmReleases with values from a ConfigMap the repository does not define remain.

**What D12 makes of it.** With real discovery the share is still over one third in total, by D12 units and by all source kinds alike; by D12 units four of the five estates are over it (acelinkio/argocd-homelab is not established), by all source kinds three (pi-cluster and acelinkio are not established). The README states opacity first. The top reasons have changed: the owner's v1.1 pick should now weigh Flux sources other than `GitRepository` and Helm inflation in kustomize (both `unsupported-field`) and bootstrap-created GitRepositories (`unreadable-repo`, which a crank or a declared mapping can answer), not the cluster-created Secrets the static estimate put first. D12 stays a scope decision, not a stop.
