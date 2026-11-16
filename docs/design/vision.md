# crankpath: Vision

## Executive Summary

crankpath is an open-source TypeScript CLI (plus a GitHub Action) that answers a question no GitOps tool answers today: **"if this cluster vanished, could this repository bring it back, and in what order?"** It reads a GitOps repository without needing a cluster, renders its Helm and Kustomize sources, extracts the hard-dependency graph across Argo CD, Flux, External Secrets, cert-manager, Vault and workloads, adds declared out-of-estate nodes (Git host, cloud KMS/IAM, identity provider, registry), and reports:
- the black-start-capable set;
- every dependency cycle, each edge tagged `extracted` or `declared`;
- the nodes unreachable from a cold start;
- the external preconditions;
- an ordered restoration plan with the manual "crank" steps marked.

The idea is ported from power-grid black-start planning: which plants can start with no grid power, the cranking paths from them, and the restoration order. After a total blackout normal dependencies are circular; Kubernetes estates hide the same circularity in YAML.

**Status (2026-11-10):** nothing is built. Research is complete (see `docs/research.md`). The design covers the whole product at MVP depth first, then the post-MVP items.

Build estimate from the research: **3 weeks part-time**, one person with Claude Code. Size L-.

## Business Context

### Problem Statement
GitOps estates are rebuilt from a repository, but the repository itself frequently depends on the estate. Concrete, verified example (khuedoan/homelab, 9,710 stars, commit 8b9d40f, traced on 2026-11-02):
- Argo CD reads its Git from a Gitea that Argo CD deploys: a 3-edge cycle, every edge taken from rendered output (ApplicationSet `argocd/root` to Service `gitea/gitea-http` to Deployment `gitea/gitea` and back to `root`).
- Argo CD manages itself through the same ApplicationSet: a second, 2-edge cycle.
- The repo breaks both by hand in an Ansible bootstrap playbook, which is a "crank" in black-start terms.

Other shapes of the same problem:
- Argo CD needs a repository credential that an ExternalSecret inside the same private repo creates; that ExternalSecret needs Vault, whose chart values come from the same repo; Vault's TLS can come from a cert-manager Issuer that is Vault's own PKI engine; Vault's auto-unseal needs a cloud KMS key outside the estate.
- No controller will find these. kustomize-controller #1712 (2026-07-16): "there is no admission validation and no controller-side cycle detection"; a Flux maintainer says that under the cross-kind dependency RFC (flux2 #5879, 31 reactions) "cycles will also not be detectable when we implement this".
- Real outages are recoveries that depended on the thing that was down: Meta 2021-10-04 ("the total loss of DNS broke many of the internal tools we'd normally use to investigate and resolve outages"); Cloudflare 2025-06-12 (a restoration order written after the fact); AWS 2025-10-20 (DynamoDB recovered at 2:40 AM PDT, yet EC2 launches failed until 10:36 AM because of "congestive collapse").

### Business Drivers
- The founder wants crankpath public as an open-source project and a portfolio piece, with a later paid tier.
- Paid path (report score 3): a DR-readiness SaaS that stores plans per cluster, alerts when a commit adds a cycle or an out-of-band dependency, and exports evidence for ISO 22301 and SOC 2 availability controls; enterprise: a restoration-drill runner that rehearses the plan on a throwaway cluster and times it.
- Demand is real but indirect (honest limit from the research): no issue with many votes asks for an offline cycle finder. Signals: argo-cd #7437 "Application dependencies" (391 reactions, ordering, not cycles), flux2 #5879 (31), kustomize-controller #1712, External Secrets #2833 ("chicken and an egg problem of initial secret creation"), and hand-written cranks in popular repos.

### Target Users and Stakeholders
- **Platform and SRE engineers** who own a GitOps estate and a DR runbook (run crankpath locally and in CI).
- **DR and compliance owners** (consume the restoration plan as evidence for availability controls).
- **Homelab and open-source estate maintainers** (the first audience, because their repos are public and golden-testable).
- **AI-assistant users** (optional, post-MVP: read-only MCP access to the plan).

### Business Constraints
- Solo founder building with Claude Code; TypeScript; part-time.
- Licence: Apache-2.0, the owner's choice for both sibling projects, applied 2026-11-15 (originally decided by the owner before release).
- Everything stays local until the founder says go. Nothing is published to npm or GitHub in the meantime.
- Read-only by nature: crankpath reads repositories and renders charts; in the MVP it never touches a cluster.
- Personal project: no employer or company names anywhere.

### Success Metrics
- The khuedoan/homelab golden test (pinned at 8b9d40f, with its one declared repo alias and no hand-declared edges) reproduces both hand-traced cycles; with the one crank the repo already performs, both become `cranked` and plan step 1 is that crank.
- The Vault fixture reports cycle A (3 edges), cycle B (4 edges), the three external preconditions and nothing else uncranked; the two documented edits make cycle A `cranked` and cycle B disappear.
- Day-1 census on five more public estates: at most one third of HelmReleases and Applications come out opaque, or the README says so up front and the v1.1 items move forward.
- The GitHub Action fails only on a new uncranked cycle relative to the base branch.
- Every opaque node is listed with the reason and, where possible, a suggested `repos:` entry; crankpath never invents an edge from a guessed repo identity.

## Full Scope Vision

### Product Vision Statement
"A black-start plan for your GitOps estate, computed from the repository alone."

### Feature Areas

#### Feature Area 1: Rendering and the graph model
- Argo CD Applications with single-source Helm (`chart`, `repoURL`, `targetRevision`, `helm.values`, `valuesObject`, in-repo `valueFiles`) rendered with `helm template`; charts cached in `.crankpath/charts`.
- **Repo identity.** A `repoURL` is read from the scanned checkout only when it normalises to the scanned repo's own URL, or when `repos:` in `crankpath.yaml` (or `--repo-alias <url>=<path>`) maps it to a local clone, optionally with a token for a private remote. Otherwise the nodes generated from it are opaque and listed, with a suggested `repos:` entry when the URL's last segment matches the scanned repo's name. Never assume two URLs name the same repo. A URL whose host matches an in-estate Service still yields its host-match edge.
- Argo multi-source `$values`, when the `ref` source is readable under the repo-identity rule.
- ApplicationSets: `list` and `git` (directories and files) generators expanded; `clusters`, `matrix`, `merge` expanded from a `clusters:` block or marked opaque.
- Kustomize directories via `kustomize build`. Flux Kustomizations including `postBuild.substituteFrom` from ConfigMaps in the repo. HelmReleases with inline `values` and with `valuesFrom` ConfigMaps or plain Secrets in the repo.
- Helm test hooks (`helm.sh/hook: test`) are dropped.
- **Opaque nodes keep their reference edges.** Encrypted or cluster-created Secret values and private charts without credentials make a node opaque and listed; its edges to the referenced Secret or ConfigMap, and onward to the ExternalSecret and store, are still extracted. Only edges from inside the unreadable values are lost, and the report names each such node.

#### Feature Area 2: Extractors
- Argo Application/ApplicationSet (sync waves, sources, `repoURL`); Argo repository-credential Secrets (`argocd.argoproj.io/secret-type`), including ExternalSecrets whose `spec.target.template.metadata.labels` carry it; Flux `dependsOn` and `sourceRef`.
- ExternalSecret, SecretStore, ClusterSecretStore (provider, server URL, auth refs).
- cert-manager Certificate, Issuer, ClusterIssuer (`issuerRef`; Vault or ACME server URL matched to a Service).
- Workload `envFrom`, `secretKeyRef`, secret and ConfigMap volumes.
- The Vault `seal "awskms"|"gcpckms"|"azurekeyvault"|"transit"` stanza under key `extraconfig-from-values.hcl` in the rendered `<fullname>-config` ConfigMap (verified on vault-helm v0.34.1).
- ServiceAccount cloud-identity annotations (`eks.amazonaws.com/role-arn`, `iam.gke.io/gcp-service-account`).

#### Feature Area 3: Analysis
- `crankpath.yaml` as the declared-facts file: `external` (cold-start availability), `match` (host patterns to nodes), `repos`, `edges` (hand-declared, always tagged `declared`), `cranks`, `clusters`.
- Tarjan strongly connected components for cycles; cold-start reachability from the black-start-capable set; a topological plan that respects sync waves and `dependsOn`.
- A crank creates nodes outside the controllers' reach (one named object, or `render:<path>`), reroutes a node's dependency to an external precondition during bootstrap, or both.
- Cycle labels: `extracted`, `declared (unverified)`, `cranked`. A cycle broken by a documented crank is reported as `cranked`, not as an error.
- Self-managed controllers (Argo CD managing itself, Flux's `flux-system`) are black-start units; `--explain` names the pattern. Every plan states it gives order, not pacing (cold-load pickup).

#### Feature Area 4: Outputs and CI
- Text, Mermaid and JSON outputs (the JSON is the stable contract).
- A GitHub Action that fails only on a **new** uncranked cycle compared with the base branch.
- Golden tests over the pinned homelab commit and the Vault fixture.

#### Feature Area 5: Post-MVP (v1.1 and later, not designed in depth in the first pass)
- Values from encrypted or cluster-created Secrets (beyond keeping the reference edges); ApplicationSet cluster generators without a `clusters:` block.
- Helm `lookup` and other templates that read a live cluster.
- Image-registry and general URL-literal edges.
- Terraform inputs; a live snapshot merge (kube-lineage export) for runtime-only dependencies; pacing for cold-load pickup.
- Optional read-only MCP server (`plan`, `cycles`, `explain`).
- Hosted tier (stored plans, alerts, evidence export) and the restoration-drill runner: named for direction only, not for design now.

#### Feature Area 6: Documentation
- README with an up-front opacity statement, concepts (black start, crank, cycle, external precondition), the `crankpath.yaml` reference, a "write your cranks" guide, an Action guide, a limits page (what static analysis cannot see), SECURITY and CONTRIBUTING.

## MVP scope (about 3 weeks)

- **Day 1 spike:** finish the census on five more public estates; go/no-go on the opacity threshold (more than a third opaque means the README says so first and v1.1 items move forward).
- **Week 1:** rendering and the graph model: single-source Helm, repo identity, `$values`, ApplicationSets (`list`, `git`, plus `clusters:` block), Kustomize, Flux Kustomizations and HelmReleases (`valuesFrom`, `substituteFrom`), opaque nodes with reference edges, Argo and Flux extractors.
- **Week 2:** the remaining extractors (ExternalSecret and stores, cert-manager, workload references, Vault seal, cloud-identity annotations) and the analysis (`crankpath.yaml`, Tarjan SCC, reachability, ordered plan).
- **Week 3:** text, Mermaid and JSON output, the GitHub Action, golden tests, packaging (private until the owner says go).
- Out of the MVP: everything in Feature Area 5.

## Risks

- **Thin demand evidence.** No high-vote issue asks for an offline cycle finder; the strongest votes are for ordering (Argo #7437, 391 reactions). Mitigation: lead the README with the two real cycles in a popular repo; validate with a handful of estate owners before the paid tier.
- **Opacity.** If more than a third of nodes in popular estates are opaque, the tool's first impression is "unreadable". `valuesFrom` appears in about 21% of files containing a Flux HelmRelease (18,112 of 87,808 on GitHub code search, approximate, forks included) and `$values` in 3,360 files that contain an ApplicationSet; both are in the MVP for that reason. The cluster-generator inputs remain the real blind spot (the `clusters:` block is the answer).
- **Invented edges.** A wrong repo identity would add edges that do not exist. Mitigation: the strict repo-identity rule; every edge tagged extracted or declared.
- **Hand-traced goldens.** The expected homelab output was traced by hand, not produced by a run; a full run may find more cycles. The golden test pins the real run's output only after human review.
- **Runtime-only dependencies** (service discovery, flags, `lookup`) escape static extraction; they are declared or left to post-MVP.
- **Cold-load pickup** is not modelled; the plan is an order, not a schedule, and says so every time.
- **Toolchain drift:** rendering depends on helm and kustomize versions (research used helm v4.3.1). Pin and record the versions used in every output.
- **Scope creep** from the "overscoped" objection raised in the arena: hold the MVP line.

## What the design pass was asked for

- A complete design at MVP depth, with the post-MVP items listed and sequenced but not designed.
- Read `decisions.md`: every question in it is already answered; treat the answers as constraints, and tell me only if one is inconsistent with the research.
- Complete every unit's design before any code. Design only: stop before code generation.
- Use **Mermaid** for all diagrams (component view, render-and-extract pipeline, the graph and analysis flow, the repo-identity decision, the Action flow).
- Look hardest at: the graph schema and the JSON output contract; the repo-identity rule and its failure modes; how opaque nodes are represented; the crank model (`creates`, `reroutes`, `render:<path>`); cycle labelling; how the plan orders waves, `dependsOn` and cranks together; the golden-test strategy without vendoring third-party repos; the unit boundaries and bolt order.
- Include, per unit, the adversarial-review checklist for that unit (see CLAUDE.md for the failure classes).
- Ask me only about what these documents do not answer.
