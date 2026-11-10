# crankpath: research record

Source: the arena report "Unique project candidates 2026-10-28" (project 4, with the shared sections "Assumptions and limits", "Summary", "How the five were chosen", "Runner-ups" and "Everything I searched"). The report's searches ran from 2026-10-29, with re-checks through 2026-11-02. Every figure below is the report's, with the date the report gives. Where this file adds a fact, it says so and dates it.

Added on 2026-11-10 (read-only lookup): npm registry returns 404 for `crankpath`, `kube-tagout` and `tagout`, so the name `crankpath` is still free. Local machine on 2026-11-10: Node v22.23.2, kustomize v5.8.1, Docker and kubectl present, `helm` not installed.

## 1. What it is

crankpath reads a GitOps repository, renders its Helm and Kustomize sources, and builds the hard-dependency graph of the estate. The graph includes declared out-of-estate nodes (Git hosting, cloud KMS/IAM, IdP, registry). It reports:
- the black-start-capable set;
- every cycle, including cross-kind cycles, each edge tagged `extracted` or `declared`;
- nodes unreachable from a cold start;
- external preconditions;
- an ordered restoration plan, with the manual "crank" steps marked.

Size in the report: **L-**. Build estimate **3 weeks** part-time (one person with Claude Code). The estimate rose to 3 weeks because two input forms (`valuesFrom` and Argo multi-source `$values`) moved into the MVP after a measurement; repo identity adds about half a day to week 1.

Kind/channel: static DR planner (CLI + GitHub Action; no cluster needed). Stack assumption: TypeScript throughout.

The name: `blackstart` is taken by pezops/blackstart (an unrelated bootstrap executor). GitHub `crankpath in:name` returned 0 results and npm `crankpath` returned 404 (report, 2026-11-02; re-confirmed 2026-11-10).

## 2. The analogy and where it breaks

Grid operators keep a black-start plan: which plants can start with no grid power, the cranking paths from them, and the restoration order. After a total blackout, normal dependencies are circular. Kubernetes estates hide the same circularity in YAML:
- Argo CD needs a repository credential that an ExternalSecret inside the same private repo creates.
- That ExternalSecret needs Vault, whose chart values come from the same repo.
- Vault's TLS certificate can come from a cert-manager Issuer that is Vault's own PKI engine.
- Vault's auto-unseal needs a cloud KMS key: outside the estate, fine only if that provider is up.

Where the analogy breaks, and the fix (report, project 4):
- (a) No physics. Grids have physics; here it is reachability plus readiness, so the plan is an order, not a schedule.
- (b) Runtime-only dependencies (service discovery, flags) escape static extraction. Post-MVP, crankpath merges a live snapshot (kube-lineage export).
- (c) Secrets bootstrap is a human step in most estates. External Secrets #2833 calls it the "chicken and an egg problem of initial secret creation". The plan marks it as a manual crank; a cycle broken by a documented crank is reported as `cranked`, not as an error.
- (d) Cold-load pickup. Restored systems face more load than normal. AWS's DynamoDB recovered at 2:40 AM PDT on 2025-10-20, yet "new EC2 instance launches failed" until 10:36 AM because a manager "had entered a state of congestive collapse" (https://aws.amazon.com/message/101925/). crankpath gives the order, not the pacing, and says so in every plan.
- (e) A controller that deploys itself is a black-start unit, not a bug. Argo CD managing itself through app-of-apps, or Flux's own `flux-system` Kustomization, always forms a cycle. A grid's black-start unit has its own diesel generator; here the diesel is the first install (an Ansible play, `flux bootstrap`, `helm install`). crankpath reports this cycle like any other, and `--explain` names the pattern when one of the cycle's Applications renders the controller's own Deployments. Only a `creates:` crank naming the first install cranks it, so the plan of every self-managed estate starts with that step. The Action is unaffected: it fails only on cycles the base branch does not have.

How it differs from the already-checked "multi-repo change orchestrator": that idea orders changes across repos at deploy time. crankpath is static and about restoration from nothing, including secrets bootstrap, the controllers' own prerequisites and out-of-band services.

## 3. Prior art: verified non-existence

The missing piece, in the report's words: static cold-start and cycle analysis across rendered GitOps sources, workload references and declared out-of-estate dependencies, with a restoration plan. Gap score **2** (a gap of 1 would mean the mechanism exists elsewhere).

GitHub repo queries (report): `gitops dependency graph` 4 (clusterscope), `argocd dependency graph` 1 (clusterscope), `flux dependency graph` 5 (flux-snapshot, a failure-time observer), `kubernetes dependency graph` 39 (mirops, a live upgrade-risk graph), `kubernetes circular dependency` 2 (infrakg). Nothing on point: `cluster bootstrap order` 4, `disaster recovery gitops` 53, `cluster rebuild` 51, `dependency cycle kubernetes` 2. Zero results: `kubernetes bootstrap circular dependency detector`, `black start cluster dependency order`, `black start kubernetes`, `gitops bootstrap cycle`. On 2026-11-02: `cluster restore order` 1 (unrelated); `argocd bootstrap secrets` 9 (tools that perform a bootstrap; none analyses one). `blackstart in:name` 52. HN queries (all 0 or off-topic): `argocd chicken and egg`, `kubernetes bootstrap chicken egg vault`, `gitops disaster recovery rebuild cluster`, `circular dependency outage`, `chicken and egg outage`, `cold start cluster`. The krew plugin index was also listed.

### Closest three

| Item | Stars | Last push | What it is / what it lacks |
|---|---|---|---|
| https://github.com/stuttgart-things/clusterscope | 0 | 2026-11-02 | Parses Flux and Argo objects into an interactive HTML dependency graph with a PR diff view. Controller-level picture only. Its README (re-read 2026-11-02, release 0.29.0) mentions no cycles, ordering, secrets, external nodes or restoration plan; code search for "cycle" returned 0. Found by `gitops dependency graph`. |
| https://github.com/AbdullahbinAmin/infrakg | 0 | 2026-06-13 | Parses Terraform/K8s/compose/GH Actions into a NetworkX graph and "detect[s] circular dependencies". No Argo/Flux semantics, no rendering, no external nodes, no plan. Found by `kubernetes circular dependency`. |
| https://github.com/tohjustin/kube-lineage | 461 | 2024-07-07 | Dependencies of a live object. Needs a running cluster, which you do not have during a black start. Found in the krew plugin index. |

Also seen:
- pezops/blackstart (5 stars): executes a hand-written bootstrap DAG.
- Velero (10,363 stars): restores by resource-type priority, not dependency.
- miropshq/mirops (2 stars); kubectl-tree.
- Native partials: Flux `dependsOn` (cycles detected only in the controller's sort) and Argo CD sync waves (one Application only).

## 4. Demand evidence

Honest limit, stated by the report: no issue with many votes asks for an offline cycle finder. The strongest signals are a controller gap that Flux's maintainers say will remain (#1712, #5879), a 391-reaction request for the ordering half (Argo #7437), and practitioners building cranks by hand (khuedoan/homelab; External Secrets #2833). The arena scored demand 2 (down from 3) because the headline issue asks for ordering, not cycle detection.

**khuedoan/homelab** (9,710 stars, last push 2026-11-02; checked at commit 8b9d40f). The report rendered it with helm 4.3.1 on 2026-11-02 and traced the edges by hand:
- `system/argocd` renders ApplicationSet `argocd/root` (through its `argocd-apps` subchart). Its git generator reads `http://gitea-http.gitea:3000/ops/homelab` and generates one Application per directory under `system/*`, `platform/*` and `apps/*`. That URL is the in-cluster Gitea, not GitHub, so listing those directories needs an alias that the repo itself implies: `platform/gitea/files/config/config.yaml` migrates `ops/homelab` from `https://github.com/khuedoan/homelab`. crankpath takes that alias as a declared input (see repo identity), never as a guess.
- `platform/gitea`, rendered as release `gitea` in namespace `gitea`, produces Service `gitea-http` on port 3000. Its selector, `app.kubernetes.io/instance: gitea`, matches Deployment `gitea/gitea`.
- So Argo CD's source of truth is served by a workload that Argo CD deploys from that same source: a 3-edge cycle (cycle 1), every edge taken from rendered output. The Deployment also needs Secret `gitea-admin-secret`, produced by an ExternalSecret through ClusterSecretStore `global-secrets`, which is itself defined under `platform/`.
- `system/*` includes `system/argocd` itself, so `root` generates Application `argocd`, which renders `root` and Argo CD's own controllers: a second, 2-edge cycle (cycle 2). That is self-management (analogy break e), not a defect, but a cold start has to break it too.
- The repo breaks both by hand. `system/bootstrap.yml` renders `./argocd` with `helm_template` and applies it, creating the controllers and `root` outside Argo CD (cycle 2). Before that it runs a task "Check if this is the first installation" (is a gitea pod Running?). If none is, it renders with `values-seed.yaml`, whose `repoURL` is `https://github.com/khuedoan/homelab` (cycle 1). That is a crank written as an Ansible play; crankpath's `cranks:` entry is its declarative form.
- This shows the problem in a popular repo. It is not demand for a tool: nobody there asked for one.

**fluxcd/kustomize-controller #1712** (open, 2026-07-16; 0 reactions, so the value is the stated gap, not the votes), "Circular dependsOn silently disables event-driven reconciliation for all Kustomizations sharing the source":
- "there is no admission validation and no controller-side cycle detection".
- A cycle introduced one patch at a time stays "dormant" with both objects `Ready=True` until the next revision.
- The open fix, PR #1725, only falls back to unsorted enqueueing. A Flux maintainer replied that under the cross-kind dependency RFC "cycles will also not be detectable when we implement this", and that "making noise only for cycles between Kustomizations" is not helpful.
- That RFC, **flux2 #5879 "[RFC] Advanced Dependency Management"**, is open with 31 reactions (29 thumbs-up). Also read: flux2 PR #5988 and kustomize-controller #301.
- So the controller will not find these cycles; an offline analyzer that sees all kinds is the gap.

**argoproj/argo-cd #7437 "Application dependencies"** (open since 2021): 308 thumbs-up, 391 reactions, 116 comments (re-read 2026-11-02). Measures demand for cross-Application ordering, which crankpath's plan computes offline. Not a request for cycle detection: partial evidence.

**External Secrets #2833** "Best initial secret bootstrapping pattern": "a chicken and an egg problem of initial secret creation" (0 reactions; qualitative).

**Incidents:**
- Meta, 2021-10-04 (https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/): "the total loss of DNS broke many of the internal tools we'd normally use to investigate and resolve outages like this".
- Cloudflare, 2025-06-12: remediation includes tooling to "progressively re-enable namespaces … so that key dependencies … are able to come up without risking a denial-of-service against our own infrastructure", a restoration order written after the fact.
- AWS, 2025-10-20 (https://aws.amazon.com/message/101925/): the cold-load-pickup example (analogy break d).
- docker/compose #374 "delay container startup to support dependant services": 265 thumbs-up, 316 comments. Ordering demand again, not cycles.

Other searches that found nothing on point: `repo:argoproj/argo-cd "chicken and egg"` 10 and `repo:external-secrets/external-secrets "chicken and egg"` 3 (leading to #2833); `repo:fluxcd/flux2 circular dependency` 6; `repo:fluxcd/kustomize-controller dependsOn cycle` 2; `repo:fluxcd/flux2 dependsOn circular` 3; `repo:hashicorp/vault-helm "chicken and egg"` 0. Issues re-read 2026-11-02: #1712 (0 reactions), #5879 (31), #7437 (391), #2833 (0); the top hits of `repo:argoproj/argo-cd "chicken and egg"` (22) and `repo:external-secrets/external-secrets bootstrap` (16) were not about bootstrap cycles.

## 5. MVP scope and estimate (report)

**Day 1: spike on real repos (partly done on 2026-11-02).** khuedoan/homelab and hashicorp/vault-helm both render with helm 4.3.1, including dependency pulls from public chart repos, and every edge of the cycle above and the Vault seal stanza appear in the output. The rest of the spike runs the census below on five more public estates. **Go/no-go:** if more than a third of their HelmReleases and Applications come out opaque under the rules below, the README says so before anything else, and the v1.1 items move forward.

**Week 1: rendering and the graph model.**
- Argo Applications with single-source Helm (`chart`, `repoURL`, `targetRevision`, `helm.values` / `valuesObject` / in-repo `valueFiles`) rendered with `helm template`, charts cached in `.crankpath/charts`.
- **Repo identity.** Every Application source and every ApplicationSet git generator names a `repoURL`. crankpath reads that repo from the scanned checkout only when the URL normalises to the scanned repo's own URL, or when `repos:` in `crankpath.yaml` (or `--repo-alias <url>=<path>`) maps it to the checkout or another local clone, optionally with a token for a private remote. Otherwise the repo is unreadable: nodes generated or rendered from it are opaque and listed, with a suggested `repos:` entry when the URL's last path segment matches the scanned repo's name. crankpath never assumes two URLs name the same repo, because in a multi-repo estate that would invent edges. A URL whose host matches an in-estate Service still yields its host-match edge, which needs no content.
- **Argo multi-source `$values`**, when the `ref` source is readable under the repo-identity rule.
- **ApplicationSets.** `list` and `git` (directories and files) generators are expanded. `clusters`, `matrix` and `merge` need cluster Secret labels and annotations that usually live outside the repo (Terraform, the gitops-bridge pattern). They are expanded from a `clusters:` block in `crankpath.yaml`, or else marked opaque.
- Kustomize directories rendered with `kustomize build`.
- Flux Kustomizations, including `postBuild.substituteFrom` from ConfigMaps defined in the repo (plain or by `configMapGenerator`). HelmReleases with inline `values`, and with `valuesFrom` ConfigMaps or plain Secrets defined in the repo.
- Helm test hooks (`helm.sh/hook: test`) are dropped, because they are not part of the running estate (vault-helm renders one, `vault-server-test`).
- **Opaque nodes keep their reference edges.** Values from a SOPS-encrypted Secret, from a Secret an ExternalSecret creates in the cluster, or from a private chart without credentials cannot be rendered. The node is marked opaque and listed. Its edges to the referenced Secret or ConfigMap are still extracted, and so are the edges from there to the ExternalSecret and its store. Only edges from inside those values are lost (for example a Vault seal stanza in encrypted values), and the report names each such node.
- Extractors: Argo Application/ApplicationSet (waves, sources, `repoURL`); Argo repository-credential Secrets (`argocd.argoproj.io/secret-type`), including ExternalSecrets whose `spec.target.template.metadata.labels` carry that label; Flux `dependsOn` / `sourceRef`.

**Week 2: remaining extractors and the analysis.**
- ExternalSecret / SecretStore / ClusterSecretStore (provider, server URL, auth refs).
- cert-manager Certificate/Issuer/ClusterIssuer (`issuerRef`, Vault or ACME server URL matched to a Service).
- Workload `envFrom`, `secretKeyRef` and secret/ConfigMap volumes.
- The Vault `seal "awskms"|"gcpckms"|"azurekeyvault"|"transit"` stanza, under key `extraconfig-from-values.hcl` in the rendered `<fullname>-config` ConfigMap (hashicorp/vault-helm). Measured with vault-helm v0.34.1: the ConfigMap is `vault-config` for a release named `vault` and `platform-secrets-vault-config` for one named `platform-secrets`, and the `seal "awskms"` stanza appears verbatim in both.
- ServiceAccount cloud-identity annotations (`eks.amazonaws.com/role-arn`, `iam.gke.io/gcp-service-account`).
- Analysis: `crankpath.yaml` for externals, host matches, declared edges and cranks; Tarjan SCC for cycles; cold-start reachability; a topological plan respecting waves and `dependsOn`.

**Week 3: outputs and packaging.**
- Text, Mermaid and JSON outputs.
- A GitHub Action that fails on a new uncranked cycle against the base branch.
- Golden tests: the khuedoan/homelab cycles at a pinned commit (with its one repo alias), plus the Vault fixture.

**Measured census (static, 2026-11-02): how often the earlier cut list would have bitten.**
- In three popular Flux estates, `valuesFrom` appears in 1 of 153 HelmReleases: onedr0p/home-ops 1 of 69 (a ConfigMap defined in the repo), bjw-s-labs/home-ops 0 of 79, fluxcd/flux2-kustomize-helm-example 0 of 5. `postBuild.substituteFrom` appears in 1 of 180 Kustomizations.
- GitHub code search finds `valuesFrom:` in 18,112 of 87,808 files that contain a Flux HelmRelease (about 21%; approximate counts, forks included).
- In gitops-bridge-dev/gitops-bridge-argocd-control-plane-template (53 stars, last push 2024-07-29; the gitops-bridge pattern), 49 of 52 ApplicationSets are multi-source with `$values`, with paths templated from cluster-Secret annotations. Code search finds `"$values/"` in 3,360 files that contain an ApplicationSet.
- argoproj/argocd-example-apps: 12 ApplicationSets, all single-source.
- Other code-search counts: `"ref: values" "kind: Application"` 18,432; `"kind: Application" "argoproj.io/v1alpha1"` 196,352.
- Conclusion in the report: `valuesFrom` and `$values` are common enough to be in the MVP. The real remaining blind spot is the cluster-generator inputs, which the `clusters:` block is for.

**`crankpath.yaml`** covers what no parser can see (the report's example):

```yaml
external:
  github.com:        {cold_start: available}
  aws-kms/us-east-1: {cold_start: available}
  aws-sts:           {cold_start: available}
  corp-registry:     {served_by: Application/harbor}   # in-estate: can join a cycle
match:
  - {host: "*.kms.us-east-1.amazonaws.com", node: aws-kms/us-east-1}
repos:     # how to read a repoURL crankpath cannot fetch; its host still matches in-estate Services
  "http://gitea-http.gitea:3000/ops/homelab": {read_from: .}   # Gitea's copy of this repo
edges:     # hand-declared, tagged "declared" in all output
  - {from: StatefulSet/vault/vault, to: corp-idp, why: "OIDC auth method"}
cranks:    # documented manual bootstrap steps
  - {creates: Secret/argocd/repo-platform, by: "kubectl create secret from 1Password, runbook DR-3"}
  - creates: render:system/argocd          # every object that path renders: Argo CD and ApplicationSet root
    reroutes: {node: ApplicationSet/argocd/root, to: github.com}   # first install renders values-seed.yaml
    by: "helm template ./argocd, then apply"
    ref: system/bootstrap.yml
clusters:  # inputs for ApplicationSet cluster generators, which live outside the repo
  in-cluster: {labels: {environment: prod}, annotations: {addons_repo_basepath: "gitops/"}}
```

A crank creates nodes outside the estate's controllers (one named object, or every object a path renders: `render:<path>`), reroutes a node's dependency to an external precondition during bootstrap, or both.

**Cycle labels:** a cycle made only of declared edges is `declared (unverified)`; one broken by a listed crank is `cranked`.

**Leaves out (v1.1):**
- values held in encrypted or cluster-created Secrets (their edges are kept), and ApplicationSet cluster generators without a `clusters:` block;
- Helm `lookup` and other templates that read a live cluster (`helm template` renders them empty);
- image-registry and general URL-literal edges (declare them instead);
- Terraform, live import, and pacing (analogy break d).

## 6. Demo (under 5 minutes), expected output

crankpath is not built yet. The expected output below comes from the renders and hand tracing described above; the report says a full run may find more cycles and the golden test pins the real run's output after review.

**Part 1, a real repo (2 min).** `npx crankpath https://github.com/khuedoan/homelab --rev 8b9d40f` first reports what it cannot read: `ApplicationSet argocd/root reads http://gitea-http.gitea:3000/ops/homelab: unreadable, so its generated Applications are opaque. Suggested: repos: {"http://gitea-http.gitea:3000/ops/homelab": {read_from: .}} (the URL's last segment matches this repo).` It never applies the suggestion itself. Rerun with `--repo-alias http://gitea-http.gitea:3000/ops/homelab=.` (one declared repo identity, no hand-declared edges) and it reports:
- Cycle 1 (extracted, 3 edges): ApplicationSet `argocd/root` to Service `gitea/gitea-http` (its git source's host matched to the Service; needs no alias) to Deployment `gitea/gitea` (selector match) back to `root`, which generates the Application that deploys it from `platform/gitea` (needs the alias, to list `platform/*`). The same strongly connected component holds the admin-secret path: Secret `gitea-admin-secret` from ExternalSecret from ClusterSecretStore `global-secrets` from `root`.
- Cycle 2 (extracted, 2 edges, self-managed): `root` generates Application `argocd` from `system/argocd`, which renders `root` and the Argo CD controllers.
- Unreachable from cold start: everything, because both cycles contain `root`.

Add the one crank the repo already performs in Ansible and rerun: both cycles become `cranked`, and plan step 1 reads "render and apply system/argocd with the github.com seed (system/bootstrap.yml)", followed by Gitea and the rest in dependency order.

**Part 2, the Vault fixture (2.5 min).** A sample app-of-apps repo has a private `platform` repo; `vault` and `external-secrets` Applications from public Helm charts with values from `platform`; and Vault TLS from a Vault-PKI ClusterIssuer. Argo CD itself is installed outside this repo, so it has no self-management cycle. With no hand-declared edges it reports:
- Cycle A (extracted, 3 edges): Application/platform needs the credential for `git@github.com:acme/platform.git`. That credential is Secret `argocd/repo-platform`, the target of an ExternalSecret delivered by Application/platform.
- Cycle B (extracted, 4 edges): Certificate `vault/vault-tls` to ClusterIssuer `vault-pki` (`spec.vault.server: https://vault.vault.svc:8200`) to Service `vault/vault` to StatefulSet `vault/vault`. The StatefulSet mounts Secret `vault-tls`, which that Certificate produces.
- External preconditions, not cycles: github.com; `aws-kms/us-east-1` (from Vault's `seal "awskms"`); `aws-sts` (IRSA annotation).
- Unreachable from cold start: everything behind either cycle.

Then two changes: (1) add the `creates:` crank and cycle A becomes `cranked` as plan step 1; (2) switch Vault's Certificate to a `ca` ClusterIssuer seeded at bootstrap and cycle B disappears. The rerun shows a fully ordered plan with one marked manual step.

## 7. Monetisation (report)

- A DR-readiness SaaS: stored plans per cluster, alerts when a commit adds a cycle or an out-of-band dependency, and evidence export for ISO 22301 / SOC 2 availability controls.
- Enterprise: a restoration-drill runner that rehearses the plan on a throwaway kind/EKS cluster and times it.
- "Path to a paid product" means a free OSS core that produces a verdict, plus a hosted or team tier that keeps verdicts over time and across repos or clusters. Paid-path score 3.

## 8. Scoring, arena verdict and weaknesses raised

Matrix (0-3 per criterion; gap is a gate): crankpath Gap 2, Demand 2, Solo-buildable 2, Paid path 3, Demo-able 2, total **11**, verdict "in" (lowest of the five; pr-rla 13, kube-tagout/tripcurve/mel-check 12). Score history: demand fell from 3 to 2 because the headline issue asks for ordering, not cycle detection; no total changed in the later checks; the estimate rose to 3 weeks after the `valuesFrom`/`$values` measurement.

The arena (100 agents, single elimination; the report's author was champion a044) judged the report as a whole, not each project. Recorded weaknesses touching crankpath:
- A round-3 judge's surviving objection: "crankpath/kube-tagout overscoped".
- Round 2 forced the fix that crankpath's demo cycles be extractable from YAML (Helm/Kustomize rendering, Vault seal HCL, IRSA parsing) rather than assumed.
- Final round (r7) attacks, both rated MAJOR and both fixed in the report: (3) the flagship homelab cycle could not be found as first specified, because `root`'s git generator points at the in-cluster Gitea, not the scanned repo (fix: the explicit repo-identity rule, `repos:` and `--repo-alias`, never assuming two URLs are one repo); (4) the self-managed Argo CD cycle was missing from the homelab output and the first crank did not break it (fix: cycle 2, analogy break e, `creates: render:system/argocd`).
- Standing limits from the report: no high-vote issue asks for an offline cycle finder; the golden outputs are hand-traced, not yet produced by a run; the Docker daemon was not available during the report's lab work.

## 9. Everything the report searched or read for this project

- Sources read: clusterscope (and its commits), mirops, flux-snapshot, infrakg, pezops/blackstart READMEs; hashicorp/vault-helm `server-config-configmap.yaml`; external-secrets `externalsecret_types.go`; Argo CD declarative-setup docs; the krew-index listing.
- Renders (2026-11-02): helm v4.3.1 (`get.helm.sh` tarball, SHA-256 matched): hashicorp/vault-helm v0.34.1 (1,263 stars) with an `awskms` seal as releases `vault` and `platform-secrets`; khuedoan/homelab @ 8b9d40f `platform/gitea` (release `gitea`, namespace `gitea`) and `system/argocd` with `values.yaml`, after `helm dependency build`. Read: `system/bootstrap.yml`, `system/argocd/values.yaml`, `system/argocd/values-seed.yaml`, `platform/gitea/files/config/config.yaml`, `platform/gitea/templates/config-job.yaml`.
- A static census script (PyYAML) over shallow clones of onedr0p/home-ops (2,913 stars), bjw-s-labs/home-ops (866), fluxcd/flux2-kustomize-helm-example (1,302), khuedoan/homelab, argoproj/argocd-example-apps (2,204) and gitops-bridge-dev/gitops-bridge-argocd-control-plane-template.
- Pages: AWS post-event summary https://aws.amazon.com/message/101925/; Meta https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/; Cloudflare 2025-06-12 incident post.
- Reddit was reached only through the Arctic Shift archive (reddit.com JSON returns 403); title search worked for r/ExperiencedDevs, r/sre, r/aws, r/node and r/ArgoCD.

## 10. Runner-ups and cut ideas that touch this project

The report's "Runner-ups" list (RPC deadline-lint, an `@claude` agent pipe for Bitbucket, an instigator-aware approval check, a Jira automation-rule analyzer) does not overlap crankpath. A neighbouring idea named in the crankpath pitch, the "multi-repo change orchestrator", was checked earlier and is a different problem (deploy-time ordering of changes). Stars and last-push dates in the report come from the GitHub REST API (`pushed_at`).

## 11. Report-wide assumptions and limits that apply

- "Does not exist" means no substantially equivalent open-source tool; well-starred primitives may exist.
- Estimates assume one person using Claude Code, part-time.
- A laptop is not a CI runner (10-core macOS laptop for all local work).
- Searches used short 2-3-word queries first; where a query returned hundreds, the top results by stars or recency were inspected.
- Build order in the report: 1 pr-rla, 2 tripcurve, 3 mel-check, 4 crankpath, 5 kube-tagout. crankpath needs no containers to demo.
