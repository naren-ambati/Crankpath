# crankpath

**A black-start planner and cycle finder for GitOps estates.** It reads a GitOps repository, renders its Helm and Kustomize sources, and reports every dependency cycle, the nodes unreachable from a cold start, the external preconditions, and an ordered restoration plan with the manual "crank" steps marked. It needs no cluster and never touches one.

Status: in development (v0.1.0 being built; see [BUILD-NOTES.md](BUILD-NOTES.md)); nothing is published. Licence: Apache-2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). Platforms: macOS and Linux (arm64 and x64) by design (D2); this build was run on macOS arm64 only, and Linux and x64 have not been run; Windows is not supported.

## Opacity first: how much of a real estate crankpath can see

Much of a real GitOps estate cannot be read from the repository alone: values held in Secrets the cluster creates, ApplicationSet generators that need cluster inputs, charts and repositories behind credentials, overlays and templates crankpath does not model. crankpath names and counts every source it could not see (an *opaque* source), and its opacity line is a floor: it says `at least` whenever anything was unreadable.

On the five public estates of the census, crankpath itself, run as each estate is published (with only its own URL as `--repo-url`, no `crankpath.yaml` and no `--repo-alias`; with helm, kustomize and the network), found at least 268 of 311 Applications, HelmReleases and unexpandable ApplicationSets or Flux Kustomizations opaque, 0.8617, over the one-third threshold of D12; over every source kind it counts, at least 316 of 839 sources opaque, 0.3766 ([census record](docs/census.md), section 5, per estate). <!-- claim CL-8 --> The day-1 static estimate, made before the discovery code existed, found at least 176 of 214 counted units opaque, 0.8224, over the one-third threshold of D12. <!-- claim CL-1 --> The largest reasons now are Flux Kustomizations whose source is not a GitRepository (148), Flux Kustomizations whose GitRepository only the bootstrap creates (68), and Applications that use Helm inflation inside kustomize (28). <!-- claim CL-12 -->

So read every crankpath result as "what the repository shows", never as the whole estate: a run with any opaque, skipped or limited item is `ANALYSED WITH GAPS`, and its cycles and plan cover what was read. What static analysis cannot see is listed in [what it cannot see](docs/what-it-cannot-see.md), and the limits of a run in [limits](docs/limits.md).

## The two homelab cycles

khuedoan/homelab at commit 8b9d40f holds two dependency cycles that its own bootstrap breaks by hand in `system/bootstrap.yml` (traced by hand on 2026-11-02, [research record](docs/research.md)):

- **Gitea serves Argo CD.** Argo CD reads its Git from a Gitea that Argo CD itself deploys.
- **Argo CD manages itself.** The root ApplicationSet that Argo CD syncs deploys Argo CD.

What crankpath reports on that commit, from the two pinned golden runs (helm v4.3.2, kustomize v5.8.1, the network), each with exactly one repository alias, `--repo-alias http://gitea-http.gitea:3000/ops/homelab=<checkout>`, because the in-cluster Gitea URL is a copy of the GitHub repository and crankpath never assumes two URLs name one repository:

- **As published, it is `NOTHING ANALYSED`.** Nothing in the estate deploys `system/argocd`, the chart that renders the root ApplicationSet: the bootstrap play applies it by hand. So crankpath finds no source to start from, and lists the 31 chart directories nothing deploys, with the suggestion to declare a hand-applied one as `creates: render:<path>`. <!-- claim CL-10 --> The research's expectation of the two cycles without a crank was a hand trace that rendered `system/argocd` by hand; crankpath does not graph a directory nothing deploys unless a crank says it is applied by hand.
- **With the one crank the bootstrap performs** ([its crankpath.yaml](test/golden/homelab-cranked/crankpath.yaml): `creates: render:system/argocd` as release `argocd` in namespace `argocd`, the root ApplicationSet and the 31 Applications it generates rerouted to `github.com`, which is declared available), crankpath finds one cycle, `c-35843cd4`: one strongly connected component of 12 nodes and 22 edges, every edge extracted, that holds both research cycles. It is labelled `cranked (was extracted)`, and plan step 1 is the manual crank. The run is `ANALYSED WITH GAPS`. <!-- claim CL-11 -->

Nothing from that repository (GPL-3.0) is copied here or into the goldens: only its commit, node ids and counts.

## Why it should exist

After a total blackout, grid operators follow a black-start plan: which plants can start with no grid power and in what order the rest come back. GitOps estates have the same circularity hidden in YAML, and no tool reports it.
- **No controller will find them.** fluxcd/kustomize-controller #1712: "there is no admission validation and no controller-side cycle detection". A Flux maintainer says cross-kind cycles "will also not be detectable" under the dependency RFC flux2 #5879 (31 reactions, [research record](docs/research.md)).
- **Ordering demand is large.** argo-cd #7437 "Application dependencies": 391 reactions, 116 comments (it asks for ordering, not cycle detection; [research record](docs/research.md)).
- **Honest limit:** no high-vote issue asks for an offline cycle finder.

## Who uses it

Platform and SRE engineers who own a GitOps estate and a DR runbook; DR and compliance owners who need a restoration plan as evidence; maintainers of public homelab and open-source estates.

## How it differs from what exists

Checked 2026-10-29 to 2026-11-02 (details and links in the [research record](docs/research.md)).
- stuttgart-things/clusterscope: a controller-level dependency picture; it does not report cycles, ordering, secrets, external nodes or a plan.
- AbdullahbinAmin/infrakg: generic "circular dependencies" over many file types; no Argo/Flux semantics, no rendering, no plan.
- tohjustin/kube-lineage: dependencies of a live object; needs the cluster you do not have during a black start.
- pezops/blackstart executes a hand-written bootstrap DAG; Velero restores by resource type, not dependency; Flux `dependsOn` and Argo sync waves cover one controller each.

## Using it

The command is `crankpath [path]`; `--format text` (default), `json` or `mermaid`; `--explain [id]` prints the evidence behind a cycle or node. The JSON output with its `schemaVersion` is the stable contract ([JSON output](docs/json-output.md), schema version 1); the library entry is unstable until 1.0. The same inputs and the same helm and kustomize versions give byte-identical output, except where a chart's own rendering varies: crankpath renders each chart twice and flags the differences it sees, which cannot prove that a chart never varies ([limits](docs/limits.md#render-limits-first-real-renders-and-the-cost-at-the-limits-b2-step-0-od-5-od-7)).

A GitHub Action fails a pull request only on a new uncranked cycle and says NOT CHECKED when it cannot compare; it has never run on a GitHub-hosted runner ([the Action guide](docs/action.md)).

helm and kustomize are found on `PATH` and run with an empty `PATH` of their own, so each must be the real binary: a version-manager shim or a wrapper script that looks a program up on `PATH` does not run, and the toolchain line says so.

## Documentation

- [Concepts](docs/concepts.md): black start, nodes and edges, cycle, crank, external precondition, opaque, the statuses and the plan.
- [The crankpath.yaml reference](docs/crankpath-yaml.md) and [write your cranks](docs/write-your-cranks.md).
- [What static analysis cannot see](docs/what-it-cannot-see.md) and [limits](docs/limits.md).
- [The GitHub Action](docs/action.md).
- [Fetching repositories, and where a token goes](docs/fetching.md).
- [JSON output](docs/json-output.md) and [host placement](docs/host-placement.md).
- [The claim map](docs/claims.md): every output claim these docs make, and the test that reproduces it.
- [SECURITY](SECURITY.md), [CONTRIBUTING](CONTRIBUTING.md), [CHANGELOG](CHANGELOG.md).
- Records: the [census](docs/census.md), the [research record](docs/research.md), the [dated lookups](docs/lookups.md), and the design decisions in plain words ([decisions](docs/design/decisions.md), [vision](docs/design/vision.md), [technical environment](docs/design/tech-env.md)).
