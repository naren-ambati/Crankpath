# crankpath: Technical Environment

## Project Technical Summary
Open-source CLI and library distributed on npm, with a GitHub Action wrapper. Runs on a developer laptop (macOS, Linux) and in CI runners. Static analysis only: it needs no cluster and no cloud account. No hosted backend in the open-source scope.

## Programming Languages
- **Required:** TypeScript (strict, ESM), Node.js 22+ (`engines.node >= 22.13`).
- **Prohibited:** additional runtimes in the core package. Rendering shells out to the `helm` and `kustomize` binaries; crankpath does not reimplement them.

## Frameworks and Libraries
- **Required:** `commander` (CLI), `vitest` (tests), `yaml` (YAML 1.2 parsing, including multi-document streams).
- **Preferred:** a maintained graph or Tarjan implementation only if tiny; otherwise write the SCC pass (it is about 40 lines) and test it. Plain `fetch` or `child_process` over heavyweight clients. `zod` (or similar) for validating `crankpath.yaml`.
- **Rules:** minimal dependencies; no telemetry; pure functions for graph analysis, cycle labelling and plan ordering, so they are testable without rendering.
- **External binaries (version-pinned and recorded in every output):** `helm` (research used v4.3.1, tarball SHA-256 checked) and `kustomize` (v5.8.1 is present on the founder's machine).

## Cloud Environment
- None required. External services contacted, read-only:
  - public Helm chart repositories and OCI registries (chart pulls and `helm dependency build`);
  - public Git hosts (read clones of the scanned repo and of repos named by `repos:`), with an optional token from an environment variable for a private remote.
- The GitHub Action reads the checkout and the base branch; it writes only its own output and check status.

## Architecture and Patterns
- **Pipeline:** discover sources, resolve repo identity, render, extract nodes and edges, build the graph, analyse (SCC, reachability, ordering), report.
- **Graph schema is the contract:** nodes (kind, namespace, name, `opaque` flag with reason), edges (from, to, `source: extracted | declared`, evidence: file, field, rendered path), cranks and externals as first-class. The JSON output is versioned (`schemaVersion`).
- **Extractors are small, separate and pure** (input: a rendered object set; output: edges with evidence), so adding one touches no core code.
- **Repo identity** is one module with one rule: normalised URL equals the scanned repo, or an explicit `repos:` / `--repo-alias` mapping; nothing else.
- **Opaque nodes keep their reference edges;** only edges from inside unreadable values are lost, and each loss is reported by name.
- **Determinism:** the same inputs and the same helm/kustomize versions give byte-identical JSON (sorted keys and edges), so golden tests and the Action's base-branch diff are stable.
- **Action diff:** compute the cycle set on the base branch and on the head; fail only on a cycle present in head and not in base, and not `cranked`.

## Security
- Treat the scanned repo as hostile input: no template or chart may cause code execution outside `helm template` and `kustomize build`; no network access chosen by repo content other than chart and Git fetches that the repo names; no credential is ever sent to a host named by repo content. A token configured for a `repos:` entry is sent only to that entry's host.
- `helm template` runs with no cluster access and no `--dry-run=server`; never `helm install` or any apply.
- Symlinks, path traversal (`valueFiles`, `render:<path>`), huge or deeply nested YAML, and pathological charts must fail closed with a clear message, not crash or hang; enforce size, depth and time limits.
- Tokens from environment variables only; never written to output, caches or logs.
- Text copied from the scanned repo (names, annotations) is data: escape it in Mermaid and terminal output, and never present it in crankpath's own voice.
- No telemetry, no permanent public write (npm, GitHub, issues) without the owner's explicit go.

## Testing
- **Unit tests** for the graph, SCC, reachability, plan ordering, cycle labelling and the crank model; each with a case that can fail.
- **Golden tests:**
  - the khuedoan/homelab cycles at pinned commit 8b9d40f, with its one repo alias, fetched read-only into a cache at test time (not vendored; skipped with a clear message when offline or when helm is missing);
  - the Vault fixture: a hand-written sample app-of-apps repo with a private `platform` repo (cycle A, cycle B, three external preconditions, then the two edits), committed in the repo.
- **Extractor tests** on recorded rendered output of hashicorp/vault-helm v0.34.1 (release names `vault` and `platform-secrets`).
- **Adversarial fixtures:** hostile charts, symlink escapes, a URL that looks like the scanned repo but is not, a cycle that is dormant until one patch, a repo with zero Applications.
- **Census script** (day 1) runs over shallow clones of public estates and reports the opaque fraction; its numbers go into the README.
- Every adversarial-review reproduction becomes a regression test that fails before the fix.
- Mutation-style check on tests: for each golden, a deliberately broken input must change the result.
