# crankpath: Design decisions (already answered; treat as constraints)

These are the questions the design pass would ask, pre-answered. Every answer is a default: change the ones that are wrong in this file. Date of writing: 2026-11-10. The full design built on them is kept outside the repository.

**D1. Language, runtime, packaging.** TypeScript (strict, ESM) on Node.js 22+ (`engines.node >= 22.13`); `commander`, `vitest`, `yaml`. Core has no other runtimes; rendering shells out to `helm` and `kustomize`. Distribution: npm package with a `crankpath` binary, plus a GitHub Action wrapper. Package stays `"private": true` until release (replaced by D9 on 2026-11-15: the package is Apache-2.0 and not private). Default, change if wrong.

**D2. Platforms.** macOS and Linux (arm64 and x64). Windows is not supported and not tested. Default, change if wrong.

**D3. Interfaces.** CLI first; the GitHub Action is in the MVP. An MCP server is optional and post-MVP (read-only: plan, cycles, explain); nothing else (no web UI, no daemon). The report's MVP has no MCP server. Default, change if wrong.

**D4. MVP versus full scope, and phases.** The first design pass covers the MVP only: the research's 3-week MVP (day-1 census spike; week 1 rendering and graph model; week 2 remaining extractors and analysis; week 3 outputs, Action, golden tests). Phase 2 (v1.1): encrypted or cluster-created Secret values, ApplicationSet cluster generators without a `clusters:` block, Helm `lookup`, image-registry and URL-literal edges. Phase 3: Terraform inputs, live snapshot merge, pacing, optional MCP. Hosted tier and drill runner are direction only, never designed now. Default, change if wrong.

**D5. Live-write policy.** crankpath is read-only by design: it never writes to a cluster, and the MVP never reads from one. In development and tests, no scratch repos, no scratch clusters, no cloud accounts; use fixtures, recorded rendered output and mock servers. Writes allowed: its own output files and the `.crankpath/charts` cache. The restoration-drill runner (rehearsal on a throwaway cluster) is out of scope. Default, change if wrong.

**D6. Test strategy.** Unit tests for the pure analysis core; extractor tests on recorded rendered output (vault-helm v0.34.1); golden tests for khuedoan/homelab at 8b9d40f (fetched read-only into a cache at test time, never vendored, skipped when offline or without helm) and the committed Vault fixture; adversarial fixtures for hostile input; a census script. Every tool-output claim in the README must be reproducible by a test. Default, change if wrong.

**D7. External services that may be contacted.** Read-only only: public Helm chart repos and OCI registries (chart pulls), and public Git hosts (clones of the scanned repo and of repos named by `repos:`). A token from an environment variable may be used for a private remote and only toward that remote's host. Nothing else; no telemetry; no search or API calls beyond that. Read-only web lookups to refresh facts are fine, with the date recorded. Default, change if wrong.

**D8. Security and threat posture.** The scanned repo is hostile input. Never run anything but `helm template` and `kustomize build`; never `helm install`; enforce size, depth and time limits; fail closed on symlinks and path traversal; never send a credential to a host named by repo content; escape repo-derived text in Mermaid and terminal output; tokens from the environment only and never in output. No telemetry. Default, change if wrong.

**D9. Licence.** Apache-2.0, the owner's choice for both sibling projects, applied 2026-11-15 (originally "decided by the owner before release"). `LICENSE` is the Apache-2.0 text and `NOTICE` lists any third-party file copy; `package.json` has `"license": "Apache-2.0"` and is not private (this replaces the `"private": true` line of D1). Default, change if wrong.

**D10. Naming and the npm name.** The name is `crankpath` (`blackstart` is taken by pezops/blackstart). npm returned 404 for `crankpath` on 2026-11-02 and again on 2026-11-10, and GitHub `crankpath in:name` returned 0. Do not publish or reserve it until the owner says go; re-check availability just before release. Default, change if wrong.

**D11. Docs.** README (with the opacity statement first, then the two real homelab cycles), concepts, `crankpath.yaml` reference, "write your cranks", Action guide, limits (what static analysis cannot see), SECURITY (contact decided before release; leave a placeholder), CONTRIBUTING, CHANGELOG. All diagrams in Mermaid. Default, change if wrong.

**D12. Day-1 go/no-go.** Run the census on five more public Flux and Argo estates (the research already did three Flux estates, homelab, argocd-example-apps and the gitops-bridge template). If more than one third of HelmReleases and Applications come out opaque, the README says so before anything else and the v1.1 items move forward. This is a scope decision, not a stop: the build continues either way. Default, change if wrong.

**D13. Repo identity.** crankpath reads a `repoURL` only when it equals the scanned repo's own URL after normalisation, or when `repos:` / `--repo-alias <url>=<path>` maps it. It never guesses; it prints a suggested `repos:` entry when the last URL segment matches the scanned repo's name. The homelab golden test uses exactly one alias (`http://gitea-http.gitea:3000/ops/homelab` mapped to the checkout). Default, change if wrong.

**D14. Exit codes and CI behaviour.** The CLI exits non-zero only on tool errors; reporting cycles is not an error by itself. The Action fails only on a new uncranked cycle against the base branch. Default, change if wrong.

**D15. What counts as v0.1.0.** The MVP complete: the Week-1-to-3 scope; both golden tests pass; the Action works on a fixture repo; the README states opacity and limits; the review lessons in CLAUDE.md applied (an independent adversarial review per bolt, second pass on semantic fixes); package built and packed locally (`npm pack`) but not published. Default, change if wrong.

**D16. Timeline.** None. Take the time needed; the 3-week estimate is a size, not a deadline. Default, change if wrong.

**D17. Agent working rules.** Subagents on Sonnet, small agent counts, one agent at a time per component. After each bolt, an independent read-only adversarial review; a second pass when the fix changes semantics. Each reproduction becomes a regression test that fails before the fix. Never `git stash`. Default, change if wrong.

**D18. Output contract.** The JSON output is the stable contract with a `schemaVersion`; text and Mermaid are renderings of it. Output is deterministic (sorted keys and edges) given the same helm and kustomize versions, which are recorded in the output. Default, change if wrong.
