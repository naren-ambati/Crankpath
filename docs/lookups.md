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
## B2 (2026-11-15): render limits, the tested pair and render fidelity (`docs/limits.md`)

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | `helm version`, `kustomize version` (installed by the build lead with Homebrew) | v4.3.2 (Go 1.27.4), v5.8.1: the tested pair (OD-13; the design's helm v4.3.1 is the lead's recorded deviation) |
| 2026-11-15 | `helm pull vault --repo https://helm.releases.hashicorp.com --version 0.34.1 --untar`, into a cache outside the repository | hashicorp/vault-helm 0.34.1 (appVersion 2.0.4), MPL-2.0: rendered only to measure; no template or rendered output is committed |
| 2026-11-15 | `helm pull <chart> --repo <url> --untar` (latest at the date), into the same cache: kube-prometheus-stack (prometheus-community.github.io/helm-charts), argo-cd (argoproj.github.io/argo-helm), cert-manager (charts.jetstack.io), external-secrets (charts.external-secrets.io), cilium (helm.cilium.io) | 93.3.0, 10.18.0, v1.21.3, 2.15.0, 1.20.4; rendered only to measure; nothing committed |
| 2026-11-15 | argoproj/argo-cd v3.6.1 `util/exec/exec.go` and `docs/operator-manual/high_availability.md` (raw.githubusercontent.com) | `ARGOCD_EXEC_TIMEOUT`, default `90 * time.Second`; "enforces a 90 second timeout" for helm and kustomize (basis of `renderWallClock`) |
| 2026-11-15 | argoproj/argo-cd v3.6.1 `reposerver/apiclient/clientset.go`, `common/common.go` | `MaxGRPCMessageSize = env.ParseNumFromEnv(common.EnvGRPCMaxSizeMB, 100, 0, math.MaxInt32) * 1024 * 1024`, `EnvGRPCMaxSizeMB = "ARGOCD_GRPC_MAX_SIZE_MB"` (basis of `renderStdoutBytes`) |
| 2026-11-15 | argoproj/argo-cd v3.6.1 `docs/operator-manual/server-commands/argocd-repo-server.md` | `--helm-manifest-max-extracted-size` default "1G" and `--helm-registry-max-index-size` default "1G" (chart archives and indexes, not render output: context) |
| 2026-11-15 | argoproj/argo-cd v3.6.1 `pkg/apis/application/v1alpha1/types.go` | `ResourceStatus` JSON fields `group`, `version`, `kind`, `namespace`, `name`, `status`, `health`, `hook` (all `omitempty`); `ApplicationSourceHelm` fields `valueFiles`, `parameters`, `releaseName`, `values`, `fileParameters`, `version`, `passCredentials`, `ignoreMissingValueFiles`, `skipCrds`, `valuesObject`, `namespace`, `kubeVersion`, `apiVersions`, `skipTests`, `skipSchemaValidation`; `ApplicationSource` adds `tagPrefix`; `ApplicationSourceKustomize` fields (all read as not applied when set) |
| 2026-11-15 | argoproj/argo-cd v3.6.1 `pkg/apis/application/v1alpha1/values.go` | `ValuesYAML()`: `valuesObject` replaces `values` when set |
| 2026-11-15 | argoproj/argo-cd v3.6.1 `reposerver/repository/repository.go` | helm template options: release name from `helm.releaseName` else the Application name, namespace `helm.namespace` else the destination's; value files resolved first, the inline values written last (`ExtraValues`); `helm dependency build` only after a missing-dependency error; a source with only `ref` (no path, no chart) renders nothing; value files may be globs and may hold build-environment variables |
| 2026-11-15 | fluxcd/kustomize-controller latest release (GitHub API); `api/v1/inventory_types.go` at v1.10.1 | v1.10.1; `ResourceRef {ID string json:"id"; Version string json:"v"}`, ID `<namespace>_<name>_<group>_<kind>` (basis of `renderedObjects`) |
| 2026-11-15 | etcd-io/etcd v3.7.3 `server/embed/config.go` | `DefaultMaxRequestBytes = 1.5 * 1024 * 1024` (basis of `renderedObjects`) |
| 2026-11-15 | `kustomize build --help` (v5.8.1, local) | `--load-restrictor` (default `LoadRestrictionsRootOnly`), `--enable-helm`, `--enable-alpha-plugins`, `--enable-exec`, `--network`, `--network-name`; no flag disables remote bases |
| 2026-11-15 | Node v22.23.2 `child_process.spawnSync` (`maxBuffer`, one option for both streams) | one buffer bound for both streams, so the runner passes the larger cap and checks each stream against its own cap after the call; `test/u4-render-engine/command-runner.test.ts` floods each stream in turn and sees `over cap` with that stream named |
| 2026-11-15 | `kustomize build --load-restrictor LoadRestrictionsRootOnly` (v5.8.1, local) on `resources: [https://example.org/crankpath-proxy-probe.yaml]`, once with the closed proxy, once with none (one GET to example.org, a 404) (B2 review pass 3) | with `HTTPS_PROXY=http://127.0.0.1:1` the fetch stops at `proxyconnect tcp: dial tcp 127.0.0.1:1: connect: connection refused`; without it, `HTTP Error: status code 404`. On `resources: [cm.yaml, ../../shared/extra.yaml]`: `security; file ... is not in or below ...`: kustomize loads files only in or below the kustomization directory |

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

## B6 (2026-11-15): controller signatures and the Mermaid parser choice

Read-only fetches of raw files and package metadata, into a scratch folder outside the repository; only the labels and facts below were kept, no manifest was copied.

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | argoproj/argo-cd tag `v3.6.1`, `manifests/base/application-controller/argocd-application-controller-statefulset.yaml`, `repo-server/argocd-repo-server-deployment.yaml`, `server/argocd-server-deployment.yaml`, `applicationset-controller/argocd-applicationset-controller-deployment.yaml` | the application controller is a `StatefulSet`, the others `Deployment`s; each carries `app.kubernetes.io/part-of: argocd` and `app.kubernetes.io/component` (`application-controller`, `repo-server`, `server`, `applicationset-controller`) |
| 2026-11-15 | `git ls-remote --tags https://github.com/argoproj/argo-helm 'argo-cd-*'`; tag `argo-cd-10.18.0`, `charts/argo-cd/values.yaml`, `templates/_common.tpl`, `templates/argocd-application-controller/deployment.yaml` | newest chart tag `argo-cd-10.18.0`; `nameOverride: argocd`; the common labels set `app.kubernetes.io/part-of: argocd` and `app.kubernetes.io/component: <component>`; the chart runs the application controller as a `Deployment` when `controller.dynamicClusterDistribution` is set |
| 2026-11-15 | `git ls-remote --tags https://github.com/fluxcd/flux2 'v2.*'`; release asset `v2.9.6/install.yaml` (sha256 `9c1fda7e401429531ed1478f67ba06b3edff6513b75da7ee47bde9f1c4d4251c`, 341,661 bytes) | newest tag `v2.9.6`; each controller is a `Deployment` labelled `app.kubernetes.io/part-of: flux` and `app.kubernetes.io/component: <controller>` (`helm-controller`, `kustomize-controller`, `source-controller`, and others) |
| 2026-11-15 | `npm view @mermaid-js/parser version license dependencies` and the file list of its 2.0.1 package (`npm pack`, not installed) | 2.0.1, MIT; grammars for architecture, cynefin, eventmodeling, gitGraph, info, packet, pie, radar, railroad, treeView, treemap and wardley: no flowchart grammar (flowchart parsing lives in the mermaid package itself) |
| 2026-11-15 | `npm view mermaid@12.3.0 dependencies` | 23 runtime dependencies (d3, cytoscape, dompurify, katex, elkjs and others): not a small pinned dev-only parser, so the Mermaid output is checked by a strict structural test of the grammar crankpath emits instead |
| 2026-11-15 | mermaid-js/mermaid tag `mermaid@12.3.0`, `packages/mermaid/src/docs/syntax/flowchart.md` | entity codes escape characters inside a quoted label (`A["A double quote:#quot;"] --> B["A dec char:#9829;"]`); thick links `==>`, dotted links `-.->`; the `:::` class operator; `direction` inside a subgraph; `classDef` styles such as `stroke-dasharray` (commas there would need escaping, so the renderer writes `5 5`) |
| 2026-11-15 | `npm install --ignore-scripts mermaid@12.3.0` into a scratch folder outside the repository (removed afterwards) | installed (116 packages); running its parser on the output was refused by the session's permission rules, so the output was not parsed by Mermaid itself (BUILD-NOTES B6, Unverified) |
| 2026-11-15 | xterm(1) manual page (invisible-island.net/xterm/manpage), resource `saveLines` | "Specifies the number of lines to save beyond the top of the screen when a scrollbar is turned on. The default is "1024"." Basis of `explainOutputLines` (B6 review m4) |

## B3 (2026-11-15): git options, Argo CD's generator semantics, the fetch limits

### The fixed git options (contract C12, step 0)

Read locally on 2026-11-15 in the installed git, `git version 2.55.0` (Homebrew, macOS arm64): `man git-config` (the text `git help config` shows), `man git`, `man git-clone`, `man git-rev-parse`, read through `col -b` into a scratch folder outside the repository. Every option crankpath passes is listed in `src/u4-render-engine/git-runner.ts` (`GIT_CONFIG`) with what the documentation says it does:

| Option or variable | Value | What the 2.55.0 documentation says |
|---|---|---|
| `core.hooksPath` | `/dev/null` | "Git will try to find your hooks in that directory": no hook can be found under a path that is not a directory (the reference-transaction hook runs on fetch) |
| `core.fsmonitor` | `false` | "If set to true, enable the built-in file system monitor daemon" |
| `core.protectHFS`, `core.protectNTFS` | `true` | "do not allow checkout of paths that would be considered equivalent to .git on an HFS+ filesystem" / "that would cause problems with the NTFS filesystem" |
| `protocol.allow` | `never` | "provide a user defined default policy for all protocols which don't explicitly have a policy"; `never` - "protocol is never able to be used" |
| `protocol.https.allow` | `always` | `protocol.<name>.allow`: "Set a policy to be used by protocol <name> with clone/fetch/push commands" |
| `http.followRedirects` | `false` | "If set to false, git will treat all redirects as errors" (the default is `initial`) |
| `http.sslVerify` | `true` | "Whether to verify the SSL certificate when fetching or pushing over HTTPS" |
| `submodule.recurse`, `fetch.recurseSubmodules` | `false` | "A boolean indicating if commands should enable the --recurse-submodules option by default" / "recurse at all when set to [false]" |
| `credential.helper` | (empty) | helpers form a list; an empty value resets it (`gitcredentials(7)`), so no helper of the machine is asked |
| `credential.interactive` | `false` | "To avoid the possibility of user interactivity from Git, set credential.interactive=false" |
| `core.askPass` | (empty) | an external program "that interactively ask[s] for a password"; empty is no program (and `GIT_TERMINAL_PROMPT=0` stops the terminal prompt) |
| `transfer.fsckObjects` | `true` | "the fetch or receive will abort in the case of a malformed object ... and potential security issues" |
| `init.templateDir` | (empty) | "the directory from which templates will be copied": none, so the clone gets no sample hooks |
| `gc.auto`, `maintenance.auto` | `0`, `false` | `git gc --auto` and `git maintenance run --auto` after "their normal work": not run |
| `safe.bareRepository` | `explicit` | "Git only works with bare repositories specified via the top-level --git-dir" |
| `--config-env=http.https://<host>[:port]/.extraHeader=CRANKPATH_GIT_AUTH_HEADER` | the header, in the variable | `--config-env`: "Like -c <name>=<value> ... where <envvar> is the name of an environment variable from which to retrieve the value ... useful ... where other processes might be able to read your command line ... but not your environment"; `http.<url>.*`: scheme, host and port "must match exactly"; "URLs visited as a result of a redirection do not participate in matching" |
| `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` | environment | "Can be set to /dev/null to skip reading configuration files of the respective level" |
| `GIT_TERMINAL_PROMPT=0`, `GIT_PROTOCOL_FROM_USER=0` | environment | "git will not prompt on the terminal"; "prevent protocols ... configured to the user state" |
| `git clone --depth 1 --single-branch --no-tags --no-recurse-submodules --quiet [--revision <sha> \| --branch <name>]` | | `--revision=<rev>`: "fetch the history leading to the given revision <rev> (and nothing else) ... detach HEAD to <rev> ... a ref name ... or a hexadecimal object name"; `--branch` "can also take tags" |
| `git rev-parse --verify HEAD` | | "Verify that exactly one parameter is provided, and that it can be turned into a raw 20-byte SHA-1" |

Shown in practice: the installed git under these options refuses `file://` ("transport 'file' not allowed") and writes no header into a clone (`test/u4-render-engine/repo-fetcher.test.ts`, offline), and the live lane fetched over https with an empty `PATH` (below).

### Argo CD v3.6.1 sources read for the generator semantics

`curl` (read-only) of raw files at tag `v3.6.1` of argoproj/argo-cd into a scratch folder outside the repository, 2026-11-15; nothing is copied into the repository (Apache-2.0, read for behaviour only). sha256 of each file as fetched:

| File | sha256 | What crankpath takes from it |
|---|---|---|
| `applicationset/generators/repo_path_utils.go` | `9804f9d38c1ad88e463747fc603c31829b77b2a74179e6f0fa6dae882a4ca24f` | `filterPaths` (`path.Match`, include unless any exclude matches); path parameters (`path`, `path.basename`, `path.basenameNormalized`, `path[n]`, `path.filename`, `path.filenameNormalized`, Go-mode `segments`, `pathParamPrefix`); file contents as one object or a list of objects, flattened with `DotStyle` in fasttemplate mode; directories take precedence over files |
| `applicationset/generators/git.go` | `857cb41a80a580da4816c2ed6ddb130795ee885be77b8128f56aa9b38611eea0` | the git generator's fields |
| `reposerver/repository/repository.go` (`GetGitDirectories`, `GetGitFiles`) | `27d7b258e902e88a592895d1b6e056cd24b1498caddbef5b4296ccbcf7fae9e8` | directories from a walk of the checkout; files through `gitClient.LsFiles` |
| `reposerver/repository/utils.go` (`walkDirectoryTree`) | `4cb3ba10bbfc0ee943552033aca21f5c0322038e036b96aeddc1cec000695027` | hidden directories skipped with what is below them (`IncludeHiddenDirectories` off by default) |
| `util/git/client.go` (`LsFiles`, `runCredentialedCmd`) | `7d0fa21d196268108a28273dafcc8bfa9dfcc7f0d648cbeb4c6f15a2c1ce3022` | the default globbing is `git ls-files -- <pattern>` (a pathspec); Argo CD itself passes a token as `--config-env http.extraHeader=<variable>` |
| `util/git/creds.go` | `fb0516df80601174cac654c75d72391a271d0d965986b6380a2fd75d3e8b7e8a` | the Basic header form `Authorization: Basic base64(user:password)` |
| `util/exec/exec.go` | `54b93b205e4e477dd6e3b8cffb84b140d9f5fcf51984e5e03060d54ded788978` | `ARGOCD_EXEC_TIMEOUT` default `90 * time.Second` (`repoFetchWallClock`) |
| `applicationset/utils/utils.go` (`Replace`) | `21bc4c133dd44bdc03f7963a84e491dd1948a0d2ca25250b9e4056e535e6ed78` | fasttemplate: only strings matching `.*{{.*}}.*` are templated; a tag is trimmed; an unknown tag is written back as it was; Go mode with sprig and `goTemplateOptions` |
| `applicationset/utils/template_functions.go` (`SanitizeName`) | `59868d8b1e7746607aa1cca014f02d5cac109b7740475d0c0ad2da59ca365849` | lower-case, `[^-a-z0-9.]` to `-`, at most 253, trim `-` and `.` |
| `applicationset/generators/list.go` | `5d86b69b79f779fa53b939a10f89a4c6f0aa31142e7295edc1273dce7aff26a8` | without goTemplate every element value must be a string and `values` a map of strings; `elementsYaml` |
| `applicationset/generators/cluster.go` | `b0545f148091c906359a2e55fc62bfd2948c6aab9634b0af8335621e39751534` | cluster parameters (`name`, `nameNormalized`, `server`, `project`, `metadata.labels.*`, `metadata.annotations.*`), the annotations never exposed, the local cluster added last when there is no selector and no Secret for it |
| `applicationset/generators/matrix.go` | `d991e69b4c6e7397326a3a1cf49b8ef7d331531198c5ef23790b4b98878cd05d` | exactly two children; an error when a child generates nothing; fasttemplate parameters combined (a conflict is an error), Go-mode merge with the first child winning |
| `applicationset/generators/merge.go` | `eeac03f2369c8e63b9d770566e5113be1f880a93aef5a30495adfa6bd2b498c3` | at least two children; merge keys required; duplicate keys an error; later generators override |
| `applicationset/controllers/template/template.go` | `bf6f642c1d3adc306ddfcfc56378f658aa397d4a7fa8d6ff423a851774827e70` | every generated Application is put in the ApplicationSet's namespace; `templatePatch` |

### Other B3 lookups

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | `git ls-remote https://github.com/fluxcd/flux2-kustomize-helm-example HEAD` (read-only) | `4f1a5b1051b469108d1bdf0ebec6c814427e3834`: the commit the live fetch lane (`scripts/live-fetch.mjs`) pins |
| 2026-11-15 | `curl` (read-only) of torvalds/linux `master` `include/uapi/linux/limits.h` | `#define PATH_MAX 4096 /* # chars in a path name including nul */`: the longest path a walk can list (`filesPerScan`) |
| 2026-11-15 | `curl` (read-only) of git/git `v2.55.0` `pkt-line.h` | `#define LARGE_PACKET_MAX 65520` (`gitOutputBytes`: one packet line's ceiling; nothing bounds their number) |

## B3 review fixes (2026-11-15)

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | `curl` (read-only) of https://www.iana.org/assignments/special-use-domain-names/special-use-domain.csv into the shared cache; the registry's XML page for its date | registry "Special-Use Domain Names", updated 2026-05-22; sha256 of the CSV `377ba1290135e5976561834276549018fb36084d8023ac4b92b121c9925da0ec`; its 42 names are committed as `SPECIAL_USE_NAMES` in `src/u4-render-engine/repo-fetcher.ts` (the fetch guard refuses each and every name under it, and anything under `arpa`) |
| 2026-11-15 | the installed git 2.55.0 against a loopback listener (`test/support/git-http-server.mjs`, 127.0.0.1 only, a dummy token), with crankpath's fixed options and http allowed in place of https | the failure texts recorded in `test/fixtures/git-stderr/git-2.55.0.json`: a 401 is `fatal: unable to get password from user` (no helper, no prompt), a 403 and a refused 301 are `The requested URL returned error: <code>`, a 404 is `repository '<url>' not found`; after a timeout of the plain `spawnSync` call, `git-remote-http` was still running (the reason git now runs in its own process group) |

## B3 review pass 2 (2026-11-16): verified materialisation and the process-group helper

| Date | Lookup | Result |
|---|---|---|
| 2026-11-16 | `man git`, `git-clone`, `git-fsck`, `git-read-tree`, `git-checkout-index` of the installed git 2.55.0 | `--attr-source=<tree-ish>`: "Read gitattributes from <tree-ish> instead of the worktree ... equivalent to setting the GIT_ATTR_SOURCE environment variable"; `clone --bare`: "make the <directory> itself the $GIT_DIR. This obviously implies the --no-checkout"; `fsck --strict`: "Enable more strict checking, namely to catch a file mode recorded with g+w bit set" (a tip tree holding one is refused: failed verification, never read unverified), `--no-dangling` omits dangling objects from the output, `--no-progress`; `read-tree <tree-ish>`: "Reads the tree information given by <tree-ish> into the index"; `checkout-index --all` "checks out all files in the index", `--force` "forces overwrite of existing files", `--quiet` |
| 2026-11-16 | the installed git 2.55.0, local repositories only (sha1 and sha256 object formats) | a shallow `clone --bare` writes `HEAD`, `config`, `packed-refs`, `refs/`, `shallow` (the commit) and `objects/pack/pack-<hash>.{pack,idx,rev}`; a private git directory holding only copies of those object files, crankpath's own config, `HEAD` and `shallow` passes `fsck --strict` and `rev-parse --verify HEAD^{commit}`; `checkout-index --all` with `--attr-source` set to the empty tree (`4b825dc6...` sha1, `6ef19b41...` sha256) leaves a file with `ident eol=crlf` attributes byte-exact, while the same checkout without it expands `$Id$` and converts line endings; `fsck` fails on a flipped pack byte ("pack checksum mismatch", exit 128), a truncated pack, a missing blob ("missing blob", exit 3), a `HEAD` naming an absent object (exit 2) or a tree (exit 8); `rev-parse` and `fsck` do not read the attribute source |
| 2026-11-16 | Node 22's `child_process` behaviour, observed with a stand-in program | `spawnSync` with `maxBuffer` kills only its direct child on `ENOBUFS`; a child started `detached` (its own group) and its children survive it, and survive SIGINT, SIGTERM or SIGHUP sent to a helper with no handler (the review's repros `ovcap.mjs`, `sig.mjs`). With the helper counting the bytes and handling the three signals, no member of the group is left (tests in `test/u4-render-engine/review-b3-pass2.test.ts`) |

## B3 review pass 3 (2026-11-16): the listing before the write, collisions, fsck strictness

| Date | Lookup | Result |
|---|---|---|
| 2026-11-16 | the installed git 2.55.0, local bare repositories with trees written as raw objects (`hash-object -t tree --literally`) | `fsck --strict` on a tree entry with mode `100664`: "warning ... badFilemode: contains bad file modes", exit 0 (so the pass-3 m4 premise does not hold on this git: `--strict` is kept, a legacy mode is not refused). `fsck --strict` exits 1 on an entry named `.GIT`, `git~1` or `.git` followed by U+200C; plain `fsck` exits 0 on all three. `read-tree HEAD` refuses `git~1` and `.git`+U+200C with `core.protectNTFS=true` and `core.protectHFS=true`, and accepts both with the two set to false (`.GIT` is refused either way). |
| 2026-11-16 | the same git: `ls-tree` output forms | `ls-tree -r -z --format=%(objectsize)%x09%(path)` C-quotes the path (`"caf\303\251.yaml"`, `"a\"q..."`) even with `-z`; `ls-tree -r -l -z` writes `<mode> <type> <name> <size>TAB<path>NUL` with the path byte for byte (a name holding a tab, a newline and a quote came through unchanged), the size right-aligned in 7 columns and `-` for a submodule. crankpath uses the second. |
| 2026-11-16 | the same git: stray files in a store | in `objects/ab/`, a file whose name is not an object name is reported (`bad sha1 file`) and fsck still exits 0; a well-named file that is not an object fails fsck. crankpath copies only well-named files. |

## B8 (2026-11-15): the GitHub Action (`action/`, `docs/action.md`)

| Date | Lookup | Result |
|---|---|---|
| 2026-11-15 | GitHub API (read-only GET): `repos/actions/setup-node/releases/latest`, `git/ref/tags/v7.1.0`, `commits/949feb2413d6458794dcd2491c4babbbce0c15c1` | latest release `v7.1.0`, published 2026-10-08T02:52:34Z; the tag is a lightweight tag on commit `949feb2413d6458794dcd2491c4babbbce0c15c1` (committed 2026-10-08T02:43:26Z). Pinned in `action/action.yml` by that full commit id. |
| 2026-11-15 | GitHub API (read-only GET): `contents/action.yml` of actions/setup-node at `949feb2413d6458794dcd2491c4babbbce0c15c1` | runs on `node24`; inputs include `node-version` and `package-manager-cache` (default `true`: caching is enabled when the workspace's `package.json` names npm as its package manager). The Action sets `package-manager-cache: false`, so nothing is restored from a cache into the job. |
| 2026-11-15 | docs.github.com, "Workflow commands for GitHub Actions" (`/en/actions/reference/workflows-and-actions/workflow-commands`) | job summaries: "each step is restricted to a maximum size of 1MiB"; "A maximum of 20 job summaries from steps are displayed per job". `::error file={name},line={line},endLine={endLine},title={title}::{message}`. The page states no escaping rule for messages or properties. Basis of `SUMMARY_MAX_BYTES`. |
| 2026-11-15 | docs.github.com, REST "Check runs" (`/en/rest/checks/runs`) | "GitHub Actions are limited to 10 warning annotations and 10 error annotations per step"; an annotation message's maximum size is 64 KB. Basis of `ANNOTATIONS_PER_KIND`. |
| 2026-11-15 | GitHub API (read-only GET): actions/toolkit `packages/core/src/command.ts` (latest commit on that file `ed3ea3b5ba8cf9cc0232e157f2080a9864305bd5`, 2026-01-29) | `escapeData`: `%` to `%25`, `\r` to `%0D`, `\n` to `%0A`; `escapeProperty`: the same plus `:` to `%3A` and `,` to `%2C`. The Action encodes its workflow commands the same way (`escapeData`, `escapeProperty` in `action/summary.mjs`), written here, not copied. |
| 2026-11-15 | `git read-tree` with `GIT_INDEX_FILE` set, then `git checkout-index --all --prefix=<dir>/` (git 2.55.0, a scratch repository outside this one) | copies a commit's tree into a directory without touching the checkout's index or work tree; `export-ignore` attributes do not apply (unlike `git archive`); symbolic links are recreated as links, which crankpath's reader refuses by name on both sides alike. |
| 2026-11-15 | GitHub API (read-only GET): `repos/actions/checkout/releases/latest`, `git/ref/tags/v7.0.1`, `contents/action.yml` at that commit | latest release `v7.0.1`, published 2026-07-20T15:10:05Z, commit `3d3c42e5aac5ba805825da76410c181273ba90b1`; `fetch-depth` defaults to 1 ("0 indicates all history for all branches and tags"); `persist-credentials` defaults to true. Used only in the example workflow of `docs/action.md` (the Action itself does not check out). |
| 2026-11-15 | B8 review m2: `git ls-tree -r -z -l --full-tree <commit>` and `git cat-file --batch` (git 2.55.0, the review's repro with a filter driver in a global git configuration and `*.yaml filter=<name>` in the head's `.gitattributes`) | `checkout-index` ran the filter driver while copying (the review's marker file was written); reading the tree with `ls-tree` and the blobs with `cat-file --batch` runs no attribute, filter or end-of-line processing (the marker stays absent, `test/u10-github-action/review-b8.test.ts`). The Action now copies commits that way; the `read-tree` / `checkout-index` row above describes the first build of B8. |

## B7 (2026-11-16): golden sources

All read-only clones into the golden cache outside the repository (`CRANKPATH_GOLDEN_CACHE`); nothing of them is committed.

| Date | Lookup | Result |
|---|---|---|
| 2026-11-16 | `git clone --depth 1 --branch v0.34.1 https://github.com/hashicorp/vault-helm` | tag `v0.34.1` is commit `aa1c92e4adddbce9660e536dfe5222a88eda6d52` (MPL-2.0: never committed) |
| 2026-11-16 | `git clone --filter=blob:none --sparse --branch helm-chart-2.9.0 https://github.com/external-secrets/external-secrets`, sparse `deploy/charts/external-secrets` | tag `helm-chart-2.9.0` is commit `cc5bfbc2234ace9cb0caff4ea89c435cf517b27b`; the chart depends on `bitwarden-sdk-server` v0.6.0 from `oci://ghcr.io/external-secrets/charts` (behind a condition), so helm runs `helm dependency build` over the network |
| 2026-11-16 | `git clone --filter=blob:none --no-checkout https://github.com/khuedoan/homelab`, then `git rev-parse --verify 8b9d40f^{commit}` | `8b9d40f` is unique and resolves to `8b9d40f51e528bcc642ea9d052eecfc7c23b5cda` (committed 2026-11-02T08:41:37+07:00); `git ls-remote` does not list it (not a ref tip). GPL-3.0: ids and counts only, never committed |
| 2026-11-16 | `git ls-tree` of that commit | 221 files; no plain Application, ApplicationSet, Flux Kustomization or HelmRelease document anywhere (the root ApplicationSet exists only in what `system/argocd`'s chart renders through its `argocd-apps` dependency) |
| 2026-11-16 | `git ls-remote --exit-code https://github.com/hashicorp/vault-helm HEAD` | the golden lane's network probe; reachable |

## B9 (2026-11-16): release checks

| Date | Lookup | Result |
|---|---|---|
| 2026-11-16 | https://www.apache.org/licenses/LICENSE-2.0.txt (read-only fetch) | SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`; byte-identical to `LICENSE` (`cmp`). `scripts/check-pack.mjs` checks `LICENSE` against this hash. |
| 2026-11-16 | `npm audit --json --omit=dev` and `npm audit --json` (registry read, run by `npm run release:check`) | 0 vulnerabilities in the runtime tree and 0 in the whole tree |
| 2026-11-16 | `git clone --depth 1` (read-only, into the shared cache outside the repository) of https://github.com/fluxcd/flux2-kustomize-helm-example, https://github.com/gitops-bridge-dev/gitops-bridge-argocd-control-plane-template and https://github.com/bjw-s-labs/home-ops | HEAD commits 4f1a5b1051b469108d1bdf0ebec6c814427e3834 (2026-07-08), e6d355197ff3af8e6be09e1dea068dc12727a915 (2024-05-15), e6e44645283b5e138d5f4faa2e83e028947c702b (2026-11-16); each LICENSE read in full: the Apache License 2.0 text (the common copy without the leading blank line, SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`); no NOTICE file in any of them |
| 2026-11-16 | acelinkio/argocd-homelab at 2f9aab023f92b6d73051bd86ec163a48a56dbe1e, from the census cache (fetched 2026-11-15) | LICENSE read in full: the MIT licence, "Copyright (c) 2023 acelinkio"; no NOTICE file |
| 2026-11-16 | the real-discovery census (`node scripts/census-real.mjs`): crankpath's own read-only chart pulls (`helm pull`) and `repos:` fetches for the five OD-26 estates, into a cache outside the repository | every estate ran (exit 0, `ANALYSED WITH GAPS`); counts in `docs/census-2026-11-16-real.json` |
