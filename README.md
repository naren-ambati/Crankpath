# crankpath

**A black-start planner and cycle finder for GitOps estates.** It reads a GitOps repository, renders its Helm and Kustomize sources, and reports every dependency cycle, the nodes unreachable from a cold start, the external preconditions, and an ordered restoration plan with the manual "crank" steps marked. It needs no cluster.

Status: in development (v0.1.0 being built; see BUILD-NOTES.md). The command is `crankpath`; the package's library entry (`src/u9-cli-package/library.ts`) is unstable until 1.0, and the JSON output with its `schemaVersion` is the stable contract: schema version 1, frozen in B6, described in `docs/json-output.md` with its JSON Schema in `schemas/crankpath-report.schema.json`. Formats: `--format text` (default), `json` and `mermaid`; `--explain [id]` prints the evidence behind a cycle or node.

helm and kustomize are found on `PATH` and run with an empty `PATH` of their own, so each must be the real binary: a version-manager shim or a wrapper script that looks a program up on `PATH` does not run, and the toolchain line says so.

## Why it should exist

After a total blackout, grid operators follow a black-start plan: which plants can start with no grid power and in what order the rest come back. GitOps estates have the same circularity hidden in YAML, and no tool reports it.
- **A popular repo with the problem.** khuedoan/homelab (9,710 stars, commit 8b9d40f, traced 2026-11-02): Argo CD reads its Git from a Gitea that Argo CD deploys (a 3-edge cycle, every edge from rendered output), and Argo CD manages itself (a second, 2-edge cycle). The repo breaks both by hand in `system/bootstrap.yml`.
- **No controller will find them.** fluxcd/kustomize-controller #1712: "there is no admission validation and no controller-side cycle detection". A Flux maintainer says cross-kind cycles "will also not be detectable" under the dependency RFC flux2 #5879 (31 reactions).
- **Ordering demand is large.** argo-cd #7437 "Application dependencies": 391 reactions, 116 comments (it asks for ordering, not cycle detection).
- **Honest limit:** no high-vote issue asks for an offline cycle finder.

## Who uses it

Platform and SRE engineers who own a GitOps estate and a DR runbook; DR and compliance owners who need a restoration plan as evidence; maintainers of public homelab and open-source estates.

## How it differs from what exists

Checked 2026-10-29 to 2026-11-02 (details and links in `docs/research.md`).
- stuttgart-things/clusterscope (0 stars): a controller-level dependency picture; no cycles, ordering, secrets, external nodes or plan.
- AbdullahbinAmin/infrakg (0 stars): generic "circular dependencies" over many file types; no Argo/Flux semantics, no rendering, no plan.
- tohjustin/kube-lineage (461 stars): dependencies of a live object; needs the cluster you do not have during a black start.
- pezops/blackstart (5 stars) executes a hand-written bootstrap DAG; Velero (10,363 stars) restores by resource type, not dependency; Flux `dependsOn` and Argo sync waves cover one controller each.

## Size estimate

L-, about 3 weeks part-time with Claude Code (TypeScript CLI plus a GitHub Action). Needs no containers to demo.

Licence: Apache-2.0 (see LICENSE).
