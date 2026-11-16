# Dated lookups

Every read-only lookup the build made, with its date. Nothing was published or written anywhere outside this machine; every fetch was a read of a public page, registry entry or repository.

## B0 (2026-11-15): toolchain and dependencies

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | `node --version`, `npm --version`, `git --version` | v22.23.2, 10.9.8, 2.55.0 |
| 2026-11-15 | `helm version` | v4.3.2 (GitCommit 8346aaa5…, Go 1.27.4), installed by the build lead with Homebrew on 2026-11-15; `brew info helm` offers stable 4.3.2. The design's tested version was v4.3.1 (OD-13); the tested pair becomes helm v4.3.2 + kustomize v5.8.1, a deviation for the owner (`BUILD-NOTES.md`). |
| 2026-11-15 | `kustomize version` | v5.8.1 |
| 2026-11-15 | `npm view commander version license engines.node` | 15.1.0, MIT, node `>=22.12.0` (the version the sibling project pins; no reason found to differ) |
| 2026-11-15 | `npm view yaml version license engines.node` | 2.9.1, ISC, node `>= 14.6` |
| 2026-11-15 | `npm view typescript version license` | 7.0.2, Apache-2.0 |
| 2026-11-15 | `npm view vitest version license engines.node` | 5.1.0, MIT, node `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` |
| 2026-11-15 | `npm view @vitest/coverage-v8 version license` | 5.1.0, MIT |
| 2026-11-15 | `npm view @biomejs/biome version license` | 2.6.8 is the latest, MIT OR Apache-2.0; 2.6.7 is pinned, as the sibling project pins it (no reason found to differ) |
| 2026-11-15 | `npm view @types/node@22 version` | highest 22.x is 22.20.5 (the 22 line matches the Node floor) |
| 2026-11-15 | Node floor | `engines.node >=22.13` (D1); the strictest dependency floors (commander, vitest) are 22.12.0, below it |
| 2026-11-15 | `npm install --ignore-scripts`, then `npm audit` | 115 locked packages; found 0 vulnerabilities. Licences read from `package-lock.json`: MIT 65, Apache-2.0 23, MPL-2.0 12, MIT OR Apache-2.0 11, ISC 2, BSD-3-Clause 1, 0BSD 1. The 12 MPL-2.0 entries are `lightningcss` and its platform builds, development-only dependencies of the test runner: installed, never copied into the repository or the package. One package has an install script (`fsevents`, optional, macOS); `.npmrc` sets `ignore-scripts=true`. |

## B0 (2026-11-15): limit derivations (`docs/limits.md`)

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | etcd `server/embed/config.go` at the latest release v3.7.3 (raw.githubusercontent.com) | `DefaultMaxRequestBytes = 1.5 * 1024 * 1024` (context for the object ceiling; the binding value used is the API server's) |
| 2026-11-15 | kubernetes/apiserver `pkg/server/config.go` (master) | `MaxRequestBodyBytes: int64(3 * 1024 * 1024)` (also `JSONPatchMaxCopyBytes`) |
| 2026-11-15 | kubernetes/website `concepts/configuration/configmap.md` and `secret.md` | "ConfigMap cannot exceed 1 MiB"; "Individual Secrets are limited to 1MiB in size" (context) |
| 2026-11-15 | kubernetes/website `concepts/overview/working-with-objects/names.md` | DNS subdomain names "contain no more than 253 characters"; DNS label names "contain at most 63 characters" |
| 2026-11-15 | kubernetes/apiextensions-apiserver `pkg/apis/apiextensions/validation/validation.go` (master) | a CRD `names.kind`, lower-cased, must be a DNS-1035 label (63 characters at most) |
| 2026-11-15 | kubernetes-sigs/yaml `go.mod` and `yaml.go` (master) | requires `go.yaml.in/yaml/v2 v2.4.2`; `YAMLToJSON` and `Unmarshal` decode with it |
| 2026-11-15 | yaml/go-yaml v2.4.2 `scannerc.go` | `max_flow_level = 10000`, `max_indents = 10000`, error "exceeded max depth of %d" |
| 2026-11-15 | yaml/go-yaml v2.4.2 `decode.go` | alias guard: `alias_ratio_range_low = 400000`, `alias_ratio_range_high = 4000000`, "document contains excessive aliasing" (context: a ratio rule, not a count) |
| 2026-11-15 | yaml/go-yaml v2.4.2 `resolve.go` | YAML 1.1 booleans: `y`, `Y`, `yes`, `on` (and cases) are true, `n`, `no`, `off` are false; `<<` is the merge tag. BoundedReader parses YAML 1.1 for this reason. |
| 2026-11-15 | `yaml` 2.9.1 source in `node_modules` (`dist/nodes/Alias.js`, `dist/schema/yaml-1.1/merge.js`, `dist/options.d.ts`, `dist/parse/cst.js`, `dist/parse/parser.d.ts`) | alias resolution visits the whole document per alias and returns the shared anchor value; `maxAliasCount` default 100 (not used); `uniqueKeys` default true (turned off, see `docs/limits.md`); `Parser.stack` is public; `CST.tokenType` names lexemes |
| 2026-11-15 | Argo CD latest release (GitHub API) | v3.6.1 |
| 2026-11-15 | argoproj/argo-cd v3.6.1 `docs/operator-manual/server-commands/argocd-repo-server.md` | `--max-combined-directory-manifests-size string  Max combined size of manifest files in a directory-type Application (default "10M")` |
| 2026-11-15 | argoproj/argo-cd master `cmd/argocd-repo-server/commands/argocd_repo_server.go` | the flag is read with `resource.ParseQuantity` (so "10M" is 10,000,000 bytes) |
| 2026-11-15 | argoproj/argo-cd v3.6.1 `docs/operator-manual/server-commands/argocd-applicationset-controller.md` | `--max-resources-status-count int  Max number of resources stored in appset status. (default 5000)` |
| 2026-11-15 | Helm latest release (GitHub API), helm/helm v4.3.2 `pkg/chart/loader/archive/archive.go` | v4.3.2; `MaxDecompressedChartSize int64 = 100 * 1024 * 1024`; `MaxDecompressedFileSize` "is no longer used internally" |
| 2026-11-15 | `npm view mermaid version license` | 12.3.0, MIT |
| 2026-11-15 | mermaid-js/mermaid at tag `mermaid@12.3.0`, `packages/mermaid/src/schemas/config.schema.yaml` | `maxTextSize` default 50000; `maxEdges` default 500 |
| 2026-11-15 | github/docs `content/repositories/creating-and-managing-repositories/repository-limits.md` (main) | recommended maxima: on-disk size 10 GB, directory width 3,000 entries, directory depth 50 (no total file count) |
| 2026-11-15 | VT100 User Guide, chapter 1 (vt100.net) | "the screen is 80 characters wide by 24 lines high" (80-column mode) |

## B0 (2026-11-15): census fetches (`docs/census.md`)

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | depth-1 `git fetch` of the exact commit over https, hooks, submodules, redirects and other protocols disabled, into a cache outside the repository: gitops-bridge-dev/gitops-bridge `cac900a2…`, mortennordbye/homelab `d1f07bae…`, acelinkio/argocd-homelab `2f9aab02…`, ricsanfre/pi-cluster `adf08ec2…`, niki-on-github/nixos-k3s `9318b97b…` | all five fetched; `git rev-parse HEAD` equals the recorded commit for each. Only counts were kept; nothing was copied into the repository. |

## B0 review fixes (2026-11-15): memory and depth derivations

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | github/docs `data/reusables/actions/supported-github-runners.md` and `single-cpu-table-row.md` (main) | standard GitHub-hosted runners: the smallest is `ubuntu-slim`, Linux, 1 CPU, 5 GB memory; the others have 7 GB (macOS arm64) to 16 GB |
| 2026-11-15 | `node -p process.versions.v8` | 12.4.254.21-node.56 (Node 22.23.2) |
| 2026-11-15 | v8/v8 branch `12.4-lkgr`, `src/heap/heap.h` and `src/heap/heap.cc` | `kPhysicalMemoryToOldGenerationRatio = 4`; `kHeapLimitMultiplier = kSystemPointerSize / 4` (2 on 64-bit without pointer compression); `HeapSizeFromPhysicalMemory`: old generation = physical memory / 4 x multiplier, capped by `MaxOldGenerationSize` |
| 2026-11-15 | `node -e 'require("v8").getHeapStatistics().heap_size_limit'` on this machine | 4,144 MiB (the cap), so the 5 GB runner's heap (2,500,000,000 bytes) was simulated with `--max-old-space-size=2384` in `scripts/measure-limits.mjs` |

## B4 (2026-11-15): the Vault fixture's chart sources

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | `git ls-remote --tags https://github.com/hashicorp/vault-helm 'v0.34*'` (read-only) | tags `v0.34.0` and `v0.34.1` exist; the fixture's `vault` and `platform-secrets` Applications name `v0.34.1` (the version research section 5 measured). Nothing fetched or copied. |
| 2026-11-15 | `git ls-remote --tags https://github.com/external-secrets/external-secrets 'helm-chart-*'` and `'v1.*'` (read-only) | the newest chart tags listed include `helm-chart-2.9.0`; release tags include `v1.3.2`. The fixture's `external-secrets` Application names `helm-chart-2.9.0` and its hand-written Deployment the image tag `v1.3.2`, as placeholders of the shape; neither was rendered or fetched. |
| 2026-11-15 | ConfigMap size (from the B0 row above: kubernetes/website `configmap.md`, "ConfigMap cannot exceed 1 MiB") | basis of `HCL_VALUE_BYTES` (1,048,576 bytes), the most text the Vault seal reader accepts. |
| 2026-11-15 | `curl` (read-only) of https://data.iana.org/TLD/tlds-alpha-by-domain.txt into the shared cache | first line "# Version 2026111500, Last Updated Sun Nov 15 07:07:01 2026 UTC"; 1,436 top-level domains (151 of them `XN--` labels); sha256 `2d991942f2ed167166d5c8cc8420bc9db25788cdb9dc77cc48970e5a21923036`. Committed, lower-cased and sorted, as `src/u6-extractors-workload/root-zone-tlds.ts` with its version line: the list of delegated top-level domains that decides whether a two-label host can be a public name. |

## B5 (2026-11-15): objects every cluster provides (OD-25, BR7.19; `src/u7-graph-analysis/cluster-provided.ts`)

Read-only fetches of raw files from kubernetes/website `main` (`content/en/docs/...`) and kubernetes/kubernetes `master`, into a scratch folder outside the repository; only the names below were kept.

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | kubernetes/website `concepts/overview/working-with-objects/namespaces.md`, "Initial namespaces" | "Kubernetes starts with four initial namespaces": `default`, `kube-node-lease`, `kube-public`, `kube-system` |
| 2026-11-15 | kubernetes/website `concepts/security/service-accounts.md`, "Default service accounts" | "Kubernetes automatically creates a ServiceAccount object named `default` for every namespace in your cluster" |
| 2026-11-15 | kubernetes/kubernetes `pkg/controller/certificates/rootcacertpublisher/publisher.go` | `RootCACertConfigMapName = "kube-root-ca.crt"`: the root CA publisher keeps that ConfigMap in every namespace (the projected service-account volume in `reference/access-authn-authz/service-accounts-admin.md` reads it) |
| 2026-11-15 | kubernetes/kubernetes `pkg/controlplane/controller/kubernetesservice/controller.go` | `kubernetesServiceName = "kubernetes"`, created in `metav1.NamespaceDefault`: the Service `default/kubernetes` |
| 2026-11-15 | kubernetes/website `reference/access-authn-authz/rbac.md`, "User-facing roles" and the default bindings table | default ClusterRoles not `system:`-prefixed: `cluster-admin`, `admin`, `edit`, `view` (the table names the binding's subject, group `system:masters`, not its name). `system:` names are not Kubernetes object names crankpath accepts (B1 deviation 9), so they are not listed |
| 2026-11-15 | kubernetes/kubernetes `plugin/pkg/auth/authorizer/rbac/bootstrappolicy/policy.go` | `rbacv1helpers.NewClusterBinding("cluster-admin").Groups(user.SystemPrivilegedGroup)`: the default ClusterRoleBinding is named `cluster-admin` |
| 2026-11-15 | kubernetes/website `concepts/scheduling-eviction/pod-priority-preemption.md` | "Kubernetes already ships with two PriorityClasses: `system-cluster-critical` and `system-node-critical`" |
