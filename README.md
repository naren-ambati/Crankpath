# crankpath

**A black-start planner and cycle finder for GitOps estates.** crankpath reads a GitOps repository (Argo CD and Flux), renders its Helm and Kustomize sources, and reports every dependency cycle, the nodes that cannot start from a cold start and why, the external preconditions, and an ordered restoration plan with the manual "crank" steps marked. It needs no cluster and never touches one, and it names and counts everything it could not read instead of reporting a clean result over it.

## Opacity first: how much of a real estate crankpath can see

Much of a real GitOps estate cannot be read from the repository alone: values held in Secrets the cluster creates, ApplicationSet generators that need cluster inputs, charts and repositories behind credentials, overlays and templates crankpath does not model. crankpath names and counts every source it could not see (an *opaque* source), and its opacity line is a floor: it says `at least` whenever anything was unreadable.

On the five public estates of the census, crankpath itself, run as each estate is published (with only its own URL as `--repo-url`, no `crankpath.yaml` and no `--repo-alias`; with helm, kustomize and the network), found at least 268 of 311 Applications, HelmReleases and unexpandable ApplicationSets or Flux Kustomizations opaque, 0.8617, over the one-third threshold of D12; over every source kind it counts, at least 316 of 839 sources opaque, 0.3766 ([census record](docs/census.md), section 5, per estate). <!-- claim CL-8 --> The day-1 static estimate, made before the discovery code existed, found at least 176 of 214 counted units opaque, 0.8224, over the one-third threshold of D12 among the counted units only, not established for the estates as a whole (four estates hold sources it did not count). <!-- claim CL-1 --> The largest reasons now are Flux Kustomizations whose source is not a GitRepository (148), Flux Kustomizations whose GitRepository the repository does not define (68: 62 in ricsanfre/pi-cluster, all naming the `flux-system` GitRepository its Flux bootstrap creates, and 6 in niki-on-github/nixos-k3s, which name a `flux-system` it does not define either), and Applications that use Helm inflation inside kustomize (28). <!-- claim CL-12 -->

So read every crankpath result as "what the repository shows", never as the whole estate: a run with any opaque, skipped or limited item is `ANALYSED WITH GAPS`, and its cycles and plan cover what was read. What static analysis cannot see is listed in [what it cannot see](docs/what-it-cannot-see.md), and the limits of a run in [limits](docs/limits.md).

What it means for you: on most real estates today, crankpath's first run tells you as much about what it could not read as about cycles. That list is useful on its own (each opaque source names its reason and the field that caused it, and often the `repos:` entry or declared fact that would let crankpath read it), but until it is short, a run's cycles and plan are a lower bound of the estate's, not its whole picture.

![Terminal output of crankpath on the thin-slice example: Run status ANALYSED, then Cycles: 1 uncranked, cycle c-d8197e7d labelled extracted with 5 nodes and 8 edges, its two shortest-cycle edges with their fields, and 7 of 7 nodes not startable from a cold start; exit 0](docs/images/hero.png) <!-- claim CL-43 -->

*`crankpath examples/thin-slice/repo --repo-url http://gitea-http.gitea:3000/ops/thin-slice`, cut with `sed`, run 2026-11-16 on crankpath's own example estate: Argo CD reads its Git source from the Gitea it deploys: one extracted cycle, every node blocked, and a status line that says ANALYSED only because everything was read. [A tour with real output](docs/tour.md), and [runnable examples](docs/examples.md) of every outcome.*

## Why it should exist: the two homelab cycles

After a total blackout, grid operators follow a black-start plan: which plants can start with no grid power, and in what order the rest come back. A GitOps estate hides the same circularity in YAML: Argo CD or Flux must run to deploy anything, and what it needs (its Git server, its credentials, its secrets backend) is often something it deploys itself. The evidence below was gathered from 2026-10-29 to 2026-11-02 and is in the [research record](docs/research.md).

**The cycles are real, in a popular estate.** khuedoan/homelab (9,710 stars, checked at commit 8b9d40f) holds two dependency cycles that its own bootstrap breaks by hand in `system/bootstrap.yml` (traced by hand on 2026-11-02):

- **Gitea serves Argo CD.** Argo CD reads its Git from a Gitea that Argo CD itself deploys.
- **Argo CD manages itself.** The root ApplicationSet that Argo CD syncs deploys Argo CD.

What crankpath reports on that commit, from the two pinned golden runs (helm v4.3.2, kustomize v5.8.1, the network), each with exactly one repository alias, `--repo-alias http://gitea-http.gitea:3000/ops/homelab=<checkout>`, because the in-cluster Gitea URL is a copy of the GitHub repository and crankpath never assumes two URLs name one repository:

- **As published, it is `NOTHING ANALYSED`.** Nothing in the estate deploys `system/argocd`, the chart that renders the root ApplicationSet: the bootstrap play applies it by hand. So crankpath finds no source to start from, and lists the 31 chart directories nothing deploys, with the suggestion to declare a hand-applied one as `creates: render:<path>`. <!-- claim CL-10 --> The research's expectation of the two cycles without a crank was a hand trace that rendered `system/argocd` by hand; crankpath does not graph a directory nothing deploys unless a crank says it is applied by hand.
- **With the one crank the bootstrap performs** ([its crankpath.yaml](test/golden/homelab-cranked/crankpath.yaml): `creates: render:system/argocd` as release `argocd` in namespace `argocd`, the root ApplicationSet and the 31 Applications it generates rerouted to `github.com`, which is declared available), crankpath finds one cycle, `c-35843cd4`: one strongly connected component of 12 nodes and 22 edges, every edge extracted, that holds both research cycles. It is labelled `cranked (was extracted)`, and plan step 1 is the manual crank. The run is `ANALYSED WITH GAPS`. <!-- claim CL-11 -->

Nothing from that repository (GPL-3.0) is copied here or into the goldens: only its commit, node ids and counts.

**No controller will find them.** fluxcd/kustomize-controller #1712 (open, 2026-07-16; its value is the stated gap, not votes): "there is no admission validation and no controller-side cycle detection", and a cycle introduced one patch at a time stays dormant with both objects `Ready=True`. A Flux maintainer says cross-kind cycles "will also not be detectable" under the dependency RFC, flux2 #5879 (31 reactions).

**Ordering is in demand.** argo-cd #7437 "Application dependencies" (open since 2021): 391 reactions and 116 comments, re-read 2026-11-02. It asks for ordering across Applications, which crankpath's plan computes offline, not for cycle detection. External Secrets #2833 calls the first secret of a cluster "a chicken and an egg problem of initial secret creation".

**The honest limit:** no issue with many votes asks for an offline cycle finder. The case rests on a gap the controllers' maintainers say will stay, a large demand for the ordering half, and practitioners writing their cranks by hand.

## How it differs from what exists

Checked 2026-10-29 to 2026-11-02 (details and links in the [research record](docs/research.md)).

- stuttgart-things/clusterscope: a controller-level dependency picture of Flux and Argo objects; it does not report cycles, ordering, secrets, external nodes or a plan.
- AbdullahbinAmin/infrakg: generic "circular dependencies" over many file types; no Argo CD or Flux semantics, no rendering, no plan.
- tohjustin/kube-lineage: the dependencies of a live object; it needs the cluster you do not have during a black start.
- pezops/blackstart executes a hand-written bootstrap DAG; Velero restores by resource type, not dependency; Flux `dependsOn` and Argo CD sync waves each order within one controller, and neither reports a cycle across kinds.

crankpath is static and offline: it reads every source kind together (sources, Secrets and ConfigMaps, Service selectors, credentials, secret stores, issuers, the Vault seal, cloud identities), treats the repository as hostile input, and says what it could not see.

## Install

crankpath is not on npm yet. Until the owner publishes it, run it from a checkout of this repository (Node 22.13 or later; macOS arm64 is the only platform this build was run on, see [status](#status)). The clone address below works once the owner has created the public repository ([release checklist](docs/release-checklist.md), step 11); until then, start from the checkout you have, at its root:

```sh
git clone https://github.com/naren-ambati/crankpath.git && cd crankpath   # once the repository exists
npm ci --ignore-scripts && npm run build
node dist/u9-cli-package/cli.js --version
```

Once it is published, `npx crankpath <path>` runs the same CLI. To render Helm and Kustomize sources, the real helm and kustomize binaries must be on `PATH` (the tested pair is helm v4.3.2 with kustomize v5.8.1); without them, those sources are opaque `tool-missing`, named and counted. crankpath runs each tool with an empty `PATH` of its own, so a version-manager shim or a wrapper script that looks a program up on `PATH` does not run, and the toolchain line says so.

## Quick start

The documentation example in `test/fixtures/docs-example` is a small estate of crankpath's own: an Argo CD Application deploys Gitea and reads its own source from that Gitea, and a second Application reads from the same Gitea. From the checkout:

```sh
cd test/fixtures/docs-example
node ../../../dist/u9-cli-package/cli.js repo \
  --repo-url https://github.com/example-org/estate \
  --repo-alias http://gitea-http.gitea:3000/ops/estate=repo --no-network
```

`--repo-url` says what the scanned repository is called; `--repo-alias` says that the in-cluster Gitea URL serves a copy of it (crankpath never assumes two URLs name one repository; without the alias both Applications are opaque, see [write your cranks](docs/write-your-cranks.md#1-run-it-and-read-what-it-could-not-see)).

<!-- claim CL-13 -->
Excerpt of `crankpath repo --repo-url https://github.com/example-org/estate --repo-alias http://gitea-http.gitea:3000/ops/estate=repo --no-network`, run 2026-11-16 in `test/fixtures/docs-example` (`crankpath` is `node ../../../dist/u9-cli-package/cli.js` there; exit 0; `...` marks the lines left out before and after):

```text
...
Run status: ANALYSED

Opacity: 0 of 2 sources opaque (0%); sources are Applications, ApplicationSets,
    Kustomizations, HelmReleases and Kustomize roots; 0 files unreadable.
  found: 2 Applications, 0 ApplicationSets, 0 Kustomizations, 0 HelmReleases, 0
      Kustomize roots; 3 files hold no source document
  read through a mapping: repo "http://gitea-http.gitea:3000/ops/estate"
      root: "."  (--repo-alias, your input)
  (nothing opaque, nothing skipped)

Cycles: 1 uncranked
  cycle c-0b9310f2  label: extracted  nodes: 3  edges: 4
    Application "argocd/gitea" reads source from Service "gitea/gitea-http"
        [field: "spec.source.repoURL"]
    Service "gitea/gitea-http" deployed by Application "argocd/gitea"
        [field: "spec.source.path"]
    shortest cycle shown; 2 more edges of this component are listed in the JSON
        output

Not startable from a cold start: 5 of 5 nodes (5 blocked, 0 unverified); 0
    startable
...
```

`ANALYSED` says every source was read, rendered and analysed, not that the estate is healthy: here it holds one cycle, `c-0b9310f2`, read entirely from the estate (`extracted`), and nothing can start first. <!-- claim CL-13 --> The next step is to write down the crank the real bootstrap performs (here, pointing the first sync at the GitHub copy) and read the plan it makes possible: [write your cranks](docs/write-your-cranks.md) walks through it with the same example.

Other ways to read the same run: `--format json` (the stable contract, schema version 1, [JSON output](docs/json-output.md)), `--format mermaid` (a Markdown document with a diagram and its text fallback), and `--explain [id]` for the evidence behind a cycle or a node. The library entry is unstable until 1.0.

## The tour and the examples

- [The tour](docs/tour.md): thirteen steps, each a screenshot of a real run with its command and what it shows: the cycle in text, JSON, `--explain` and Mermaid; cranked against uncranked; the plan; a declared edge; opaque and limit outcomes; refusals of hostile input; the exit codes; colour; the Action's job summary; the homelab goldens as ids and counts.
- [The examples](docs/examples.md): one small estate of crankpath's own per scenario under `examples/`, with the command to run and its pinned output; `npm run verify` re-runs every offline one with the built CLI and compares it byte for byte.

## The GitHub Action

A composite Action in `action/` compares a pull request with its merge base and fails it only on a new uncranked cycle; when it cannot compare, or the head reads less than the base, it says NOT CHECKED, which fails the job too. `NO_NEW_CYCLES_FOUND` is never worded as a pass, and every crank or declared fact the pull request adds is listed as not verified. It has never run on a GitHub-hosted runner. Use, inputs, outputs and real output of its local harness: [the Action guide](docs/action.md).

## Limits: what static analysis cannot see

- **The repository is not the estate.** Runtime-only dependencies, state the cluster creates (Secrets, ConfigMaps, the labels of cluster Secrets that generators select on), objects operators create at run time, Helm `lookup`, the controllers' own start-up, timing and cold-load pickup are outside what a repository shows; every report closes with the five items it does not model ([what it cannot see](docs/what-it-cannot-see.md)).
- **The plan is an order, not a schedule**, relative to declared facts crankpath has not checked: externals declared available, cranks (`documented, not verified`), mappings and `match:` entries. A crank that does not work in practice gives a plan that does not work.
- **Every run is bounded**: file sizes, YAML depth and aliases, document and object counts, render time and output, files per scan, fetches per run and one memory budget, each derived from what it protects; a limit reached is a named, counted outcome ([limits](docs/limits.md)).
- **Determinism has an exception.** The same inputs and the same helm and kustomize versions give byte-identical output, except where a chart's own rendering varies: crankpath renders each chart twice and flags the differences it sees, which cannot prove that a chart never varies. khuedoan/homelab at 8b9d40f is such a case: one floating note of its JSON varies between runs ([limits](docs/limits.md#render-limits-first-real-renders-and-the-cost-at-the-limits-b2-step-0-od-5-od-7)).
- **helm and kustomize are the real binaries.** crankpath limits what they may do (a closed list of commands and options, no shell, no cluster, time and output caps, a private directory) but a flaw in them is theirs ([security](SECURITY.md)).

## Status

**0.1.0, unreleased: built and tested locally, nothing published.** No npm package, no public repository and no hosted Action run exist yet; [the release checklist](docs/release-checklist.md) lists the owner's steps, and [the changelog](CHANGELOG.md) what v0.1 does, its limits, the decisions taken for the owner and the amendments to the written design.

What is verified, and how:

- `npm run verify` (typecheck, Biome, build, the tests with the coverage floor, the offline release checks) passes on this checkout; the figures of the release round's run are in [BUILD-NOTES](BUILD-NOTES.md).
- The golden lane (`npm run verify:golden`) re-runs the homelab and Vault goldens with helm v4.3.2, kustomize v5.8.1 and the network, with every declared mutation, and `npm run release:check` adds `npm audit` and the owner's deny-list; on 2026-11-16 the release check's only blocker was the deny-list, not run because the owner supplies it ([BUILD-NOTES](BUILD-NOTES.md), B9 part 4).
- Every output quoted in these docs is from a real run and is re-run by the test named in [the claim map](docs/claims.md).

What is not verified: Linux and x64 have not been run (by design, D2, crankpath is meant for macOS and Linux on arm64 and x64; this build was run on macOS arm64 only), and Windows is not supported; the Action has never run on a GitHub-hosted runner; the Mermaid output was checked structurally, not rendered by Mermaid in the tests; real servers' 401, 403, 404, rate-limit and redirect answers were not observed (they are tested on recorded and fake messages).

## Documentation

- [Concepts](docs/concepts.md): black start, nodes and edges, cycle, crank, external precondition, opaque, the statuses and the plan.
- [The crankpath.yaml reference](docs/crankpath-yaml.md) and [write your cranks](docs/write-your-cranks.md).
- [What static analysis cannot see](docs/what-it-cannot-see.md) and [limits](docs/limits.md).
- [The GitHub Action](docs/action.md).
- [Fetching repositories, and where a token goes](docs/fetching.md).
- [JSON output](docs/json-output.md) and [host placement](docs/host-placement.md).
- [The claim map](docs/claims.md): every output claim these docs make, and the test that reproduces it.
- [SECURITY](SECURITY.md), [CONTRIBUTING](CONTRIBUTING.md), [CHANGELOG](CHANGELOG.md) and [the release checklist](docs/release-checklist.md).
- Records: the [census](docs/census.md), the [research record](docs/research.md), the [dated lookups](docs/lookups.md), and the design decisions in plain words ([decisions](docs/design/decisions.md), [vision](docs/design/vision.md), [technical environment](docs/design/tech-env.md)); the build log is [BUILD-NOTES](BUILD-NOTES.md).

## Licence

Apache License 2.0: [LICENSE](LICENSE). Third-party file copies (the test corpus, under their own Apache-2.0 and MIT licences) and the IANA root-zone data are listed in [NOTICE](NOTICE). Nothing from GPL or MPL sources is copied into this repository: for khuedoan/homelab (GPL-3.0) only its commit, node ids and counts, and for hashicorp/vault-helm (MPL-2.0) only a hand-written fixture of its shape.
