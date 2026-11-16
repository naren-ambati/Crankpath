# Changelog

All notable changes to crankpath. The JSON output's `schemaVersion` is the stable contract: a breaking change to it, to `crankpath.yaml` or to the Action's inputs and outputs is listed here (C7, C2, C10), and a breaking JSON change bumps `schemaVersion`.

## 0.1.0 (unreleased)

Not published: built and packed locally only, pending the owner's go.

- First version: reads a GitOps repository (Argo CD Applications and ApplicationSets, Flux Kustomizations and HelmReleases, Kustomize roots and plain directories), renders Helm and Kustomize sources with the helm and kustomize binaries on `PATH`, and reports dependency cycles, nodes not startable from a cold start, external preconditions and an ordered restoration plan with the declared cranks marked.
- Output formats `text`, `json` (schema version 1, [JSON output](docs/json-output.md)) and `mermaid`; `--explain` for the evidence behind a cycle or node.
- A GitHub Action (`action/`, [the Action guide](docs/action.md)) that fails a pull request only on a new uncranked cycle and says NOT CHECKED when it cannot compare; it has not yet run on a GitHub-hosted runner.
- `crankpath.yaml` for declared facts: externals, cranks, repository identities, host matches and declared edges, each labelled as declared and never as verified.
