# Contributing

crankpath is a small personal project in development; nothing is published yet. These are the rules its own build follows, and any change is held to them.

## Set-up

- Node 22.13 or later. Install with `npm ci --ignore-scripts` (`.npmrc` sets `ignore-scripts=true`; no dependency's install script runs).
- helm and kustomize on `PATH` are needed only for the live render lane (`npm run verify:live`) and the corpus lane that uses them; without them those report SKIPPED, never a pass. The tested pair is helm v4.3.2 with kustomize v5.8.1.

## The one local gate

`npm run verify` runs the typecheck (tests included), Biome, the build, the tests with the coverage floor and the release checks (`scripts/release-checks.mjs`: check-tree, check-docs, secret-grep, check-pack). It must pass before a change is proposed. `npm run release:check` adds the network and helm checks (npm audit, the golden lane) and fails on anything not run; it is for the owner before a release.

## Rules for a change

- **Tests first.** Write the test or expected output, see it fail, then change the code. Every rule about honesty (no pass that was not earned, no repository text in crankpath's voice, a limit is a named outcome) has a test that fails when the rule is broken; check that yours can fail.
- **Deterministic output.** The same input and the same tool versions give byte-identical JSON: sorted keys and arrays, no timestamps, absolute paths or machine names.
- **Dependencies**: `commander` and `yaml` only at run time, exact versions, a lockfile resolved from the npm registry.
- **Documentation**: every fence is a code language, quoted output (no info string or `text`: from a real run, with its command and date in the caption and a row in [the claim map](docs/claims.md) naming the test that reproduces it), a `measurement` (with its command and date) or an `illustration` (no output lines); diagrams are Mermaid with a `Text fallback:` line. `npm run docs:check` checks all of this.
- **Third-party files**: only under MIT, Apache-2.0 or BSD licences, with the upstream licence beside the copy, a NOTICE, and a line in the root [NOTICE](NOTICE). Never GPL or MPL material.
- **Nothing personal or secret in the repository**: no home paths, machine names, tokens or e-mail addresses (`npm run secret-grep`).
- A change to the JSON output, `crankpath.yaml` or the Action's inputs and outputs that breaks a consumer goes in the [CHANGELOG](CHANGELOG.md), and a breaking JSON change raises `schemaVersion` ([JSON output](docs/json-output.md)).

## Licence

Contributions are made under the Apache License 2.0 ([LICENSE](LICENSE)).
