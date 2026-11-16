# The crankpath.yaml reference

`crankpath.yaml` holds the facts crankpath cannot read from the estate: which externals are up during a black start, which hosts are which nodes, which repository URLs are copies of which folder, the edges no field shows, and the manual steps (cranks) of the bootstrap. Every fact in it is **declared**: crankpath uses it and always labels it as declared and not verified. The words used here are defined in [concepts](concepts.md); writing cranks is walked through in [write your cranks](write-your-cranks.md).

## Where it is read from

- By default, `crankpath.yaml` at the root of the scanned path. If it is absent, there are no declared facts (nothing is assumed in their place).
- With `--config <file>`, that file, relative to the directory crankpath is run from. A `--config` file that does not exist is an error.

The file is part of the input. When it is committed in the scanned repository, it is the repository's own claim about itself, so it gets limited authority: paths in it must stay inside the scanned root, nothing in it can name an environment variable, a `repos:` mapping it declares counts as a declared fact that changes the graph (the run then has a gap), and every value from it is quoted when printed.

## Rules for the whole file

- One YAML document whose top level is a mapping with only the keys below; every key is optional.
- An unknown key or a duplicate key is an error naming its key path; so is a value of the wrong type or an empty string. Nothing is analysed with a half-read file: crankpath prints the error and exits 1.
- No value may name an environment variable (`$NAME`, `${NAME}`, `%NAME%`, or a leading `~`).
- The file is read through the same bounded reader as the estate (size, depth, aliases and document count limited, see [limits](limits.md)), and all its entries together (every external, match entry, repos entry, edge, crank target, cluster, label and annotation) are held to the `declaredEntries` limit; over it, the file is refused by name.

<!-- claim CL-5 -->
Output of `crankpath repo --config invalid.yaml --no-network`, run 2026-11-16 in `test/fixtures/docs-example` (the file names a key `reroute`; the key is `reroutes`; exit 1):

```text
error: invalid --config file "invalid.yaml" at key path "cranks[0].reroute" (unknown key)
```

An error in the default file says `invalid crankpath.yaml`; an error in a `--config` file names that file as given. Key paths are written `cranks[0].reroutes.node`, `external.github.com.cold_start`; a key that is not a plain word is quoted (`repos."http://gitea-http.gitea:3000/ops/estate".read_from`).

## `external`

A mapping from an external's name to its cold-start availability.

```yaml
external:
  github.com:
    cold_start: available
  kms.example.org:
    cold_start: unavailable
  registry.example.org:
    served_by: Deployment/registry/registry
  identity.example.org: {}
```

- The name is the external's id without its prefix (`external:github.com`): letters, digits, `.`, `_`, `-` and `/`, starting and ending with a letter or digit, no `//`.
- `cold_start: available` or `cold_start: unavailable`; or `served_by: <node id>` (the external is as available as that node of the estate). Both at once is an error.
- Neither (an empty body or `{}`): the cold start is unspecified, which is an unresolved item, and whatever needs the external is blocked.
- Effect: an available external lets what needs it start; it is listed under the plan as an assumption. `served_by` joins the external to that node by a declared edge, so a cycle through it is labelled `declared (unverified)`.

## `match`

A list of host patterns, each naming the node or external that answers the host.

```yaml
match:
  - host: git.internal.example.org
    node: Service/gitea/gitea-http
  - host: "*.s3.example.org"
    node: object-store.example.org
```

- `host`: a host name; `*` stands for one or more characters inside one DNS label and is the only wildcard; matching is case-insensitive and the pattern must have the host's number of labels.
- `node`: a node id, or an external's name.
- The entries are tried in file order before any Service, and the first that matches wins.
- Effect: an entry that names what crankpath's own Service rules find adds nothing (the edge stays `extracted`). An entry that places a host otherwise (to another node, or where the rules find nothing or several) is an override: the edge is `declared`, the override is listed with the host and both targets, the run has the `declared-facts` gap, and any cycle the overrides hide is listed with the entries that hide it. Entries that matched no host are listed as unused.

## `repos`

A mapping from a repository URL to where its files are.

```yaml
repos:
  "http://gitea-http.gitea:3000/ops/estate":
    read_from: .
  "https://github.com/example-org/shared-charts":
    fetch: true
```

- The URL must be one crankpath can compare (https, http, ssh or the scp form `git@host:path`); two entries that normalise to the same repository are an error.
- `read_from: <path>`: a directory inside the scanned root (`.` is the root itself). It cannot leave the root, name an environment variable or start with an `alias:` label.
- `fetch: true`: crankpath fetches that repository (read-only, https only) when a source of the scan first needs it, at its default branch, so the mapping is `floating` and the commit it resolved to is recorded. It is always fetched **without a token**, because the scanned repository chose it: a private repository named here is `unreadable-repo`, never read with your credentials (clone it yourself and use `--repo-alias`). An unused entry is never fetched. The fetch rules, the cache and the limits are in [fetching](fetching.md). Exactly one of `read_from` and `fetch`.
- Effect of `read_from`: a source whose `repoURL` normalises to that URL is read from that folder; the mapping is listed after the opacity line, and because the scanned repository declared it, it counts as a declared fact that changes the graph. The same mapping given on the command line with `--repo-alias <url>=<path>` is your input instead, listed as an assumption.
- Effect of `fetch: true`: the fetched commit is read as its own root (`fetch:N` in the report); the mapping line names the URL, the commit and whether it is floating, or why the fetch failed (`offline`, `tool-missing` or `unreadable-repo`, with "unknown whether the repository exists" for a 401, 403, 404, 429 or timeout). It is a declared fact of the scanned repository and counts in the `declared-facts` gap when a source was read through it.

crankpath never treats two URLs as one repository without such a mapping: a run without one marks the source `unreadable-repo` and prints the entry that would read it as a suggestion, never applied (see [write your cranks](write-your-cranks.md), step 1).

## `edges`

A list of edges no field of the estate shows.

```yaml
edges:
  - from: Deployment/app/api
    to: StatefulSet/db/postgres
    why: "the API waits for the database at start-up (init container)"
```

- `from` and `to`: node ids; `why`: a non-empty string.
- Effect: the edge is `declared`; a cycle that rests on it is labelled `declared (unverified)`, the run has the `declared-facts` gap, and an endpoint that does not exist is an unresolved item (`declared-edge-endpoint-missing`).

## `cranks`

A list of the manual steps of the bootstrap, applied in file order; the first is `crank 1` (`crank:1` in the JSON).

```yaml
cranks:
  - reroutes:
      node: Application/argocd/gitea
      to: github.com
    by: "first install: point Application argocd/gitea at the GitHub copy, sync, then switch it back to Gitea"
    ref: docs/bootstrap.md
  - creates: render:system/argocd
    namespace: argocd
    release: argocd
    by: "render system/argocd with helm template and apply it by hand (the first Argo CD install)"
  - creates:
      - Secret/vault/unseal-keys
    by: "a person unseals Vault with the keys from the safe"
```

- `by` is required: the step as a person would do it. `ref` is optional: where the step is written down.
- At least one of `creates` and `reroutes`; each is one entry or a list.
- `creates: <node id>`: the node exists after the step, so its own needs are taken as met.
- `creates: render:<path>`: a path inside the scanned root applied by hand. A path is data, never a pattern.
  - When the path is a Helm chart directory (a `Chart.yaml` not inside another chart's `charts/` or `templates/`) or a Kustomize root, it is a **directory applied by hand at bootstrap**: crankpath renders it once, with the same Helm or Kustomize job and every guard of any other source, and the crank creates every object that render produced. Sources among those objects (an ApplicationSet the chart renders, say) are then planned, rendered and expanded as usual.
  - Otherwise, every node read from a file at or under the path is created.
  - A hand-applied chart counts as a source of the kind `HandAppliedChart`: if its render fails, it is an opaque source like any other, and the crank creates nothing.
- `namespace: <name>` (optional, only on a crank with a `render:` target): the namespace the directory is applied in (helm's `--namespace`, and the namespace of its objects that name none). `release: <name>` (optional, the same): the Helm release name; without it, the directory's last segment. A release name helm would refuse makes the chart opaque `unsupported-field`. Two cranks may name the same `render:` path only with the same `namespace:` and `release:`.
- A chart directory or Kustomize root that nothing deploys and no crank applies is listed in the report as not deployed by anything read, with the suggestion to declare it as `creates: render:<path>` if it is applied by hand; its objects are never graphed without such a crank.
- `reroutes: {node: <node id>, to: <external name>}`: during the bootstrap the node reads its source from that external instead of the in-estate node (its `reads-source` edges to in-estate nodes are replaced by one `rerouted` edge to the external). The external's cold start comes from `external:`.
- Effect: every cycle a crank breaks is labelled `cranked` and names the crank; the crank is the plan's `manual` step before what it makes possible; it is `documented, not verified`. A target that matches no node is an unresolved item (`crank-target-unmatched`), and a crank none of whose targets matches is listed as unused (`crank-unused`). A node belongs to the first crank that creates it.

## `clusters`

A mapping from a cluster name to the labels and annotations of its Argo CD cluster Secret, for ApplicationSet generators that select clusters.

```yaml
clusters:
  in-cluster:
    labels:
      environment: production
    annotations:
      addons_repo_url: https://github.com/example-org/addons
```

- `labels` and `annotations`: maps of strings; both optional.
- The block stands for the complete set of the estate's cluster Secrets. A `clusters` generator (alone, or as a child of `matrix` or `merge`) selects among these entries with its `matchLabels` and `matchExpressions`; the local cluster is added as Argo CD adds it, and Argo CD's own annotations are never exposed. Without a `clusters:` block, a `clusters` generator is `cluster-inputs-missing`; `matrix` and `merge` without a `clusters` child are expanded from the repository alone.
- The block gives labels and annotations only, not a cluster's server URL or project: a template that uses `server` or `project` of a cluster other than `in-cluster` (taken to be `https://kubernetes.default.svc`) is `cluster-inputs-missing`.
- Effect: expansion through the block is a declared fact of the scanned repository: it counts in the `declared-facts` gap, and each cluster used is listed (`clustersUsed` in the JSON).

## Everything at once

The file below uses every key, and each entry is explained in its section above. Every example on this page except the error above is accepted by crankpath's reader (valid crankpath.yaml) when the scanned root is the documentation example's `repo/`. <!-- claim CL-7 -->

```yaml
external:
  github.com:
    cold_start: available
match:
  - host: git.internal.example.org
    node: Service/gitea/gitea-http
repos:
  "http://gitea-http.gitea:3000/ops/estate":
    read_from: .
edges:
  - from: Deployment/app/api
    to: StatefulSet/db/postgres
    why: "the API waits for the database at start-up"
cranks:
  - reroutes:
      node: Application/argocd/gitea
      to: github.com
    by: "first install from the GitHub copy"
clusters:
  in-cluster:
    labels:
      environment: production
```
