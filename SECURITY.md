# Security policy

## Reporting a vulnerability

**Contact: GitHub's private vulnerability reporting.** Report at [github.com/naren-ambati/crankpath/security/advisories/new](https://github.com/naren-ambati/crankpath/security/advisories/new) (the repository's Security tab, "Report a vulnerability"). Only the maintainer sees the report; please do not open a public issue for it. The repository and its reporting switch are created by the owner at release ([release checklist](docs/release-checklist.md)); until then the link leads nowhere and nothing is published.

Include what you need to show the problem: the crankpath version or commit, the command line, the helm and kustomize versions (`crankpath --version` prints all three), and a repository or fixture that reproduces it. Leave out any real token: describe where it went instead.

## What counts

crankpath reads a GitOps repository you may not control and tells you what a cold start of that estate depends on. Its value is that a report never says more than it read. So a vulnerability is anything that makes a report say more than it read, or that lets the scanned repository reach beyond reading:

- a report that says `ANALYSED`, or a status, plan or Action result that reads as clean, over an input that was opaque, unreadable, skipped, limited or timed out, or an opacity line that is not a floor (`at least`) when something was unreadable;
- a cycle the repository holds that crankpath hides: one it drops, merges away or fails to report, or one shown as proven when it rests on a declared edge;
- a cycle labelled `cranked` without a crank that breaks it, or a declared fact (a crank, a declared edge, an external, a `match:` entry) shown as verified;
- repository text shown in crankpath's own voice: unquoted, unescaped for the terminal or Mermaid, at the start of a line, or with control characters that act;
- a credential that reaches another host or any output: a `CRANKPATH_TOKEN_<HOST>` sent to a host other than its own, or a token or URL userinfo in a report, a cache, a log or an error message;
- a subprocess outside the closed allowlist ([what crankpath does](#what-crankpath-does)), an option outside its closed list, a shell, or an environment variable that reaches a tool when the allowlist does not pass it;
- a write outside the confined paths (the cache directory, `--cache-dir` or `.crankpath` by default; the `--out` file; the Action's directory under `RUNNER_TEMP`), a write through a symlink, or a cache inside the scanned tree whose charts are read as trusted;
- a crash, a hang, or memory or time beyond the stated limits on hostile input: a YAML bomb, deep nesting, a huge file, a symlink, `../`, odd names, a hostile chart or kustomization;
- a 401, 403, 404, 429, refused redirect or timeout read as a repository or chart that is gone, or as a pass.

The limits crankpath states plainly are known, not vulnerabilities, though a way to make one worse is: they are in [what it does not promise](#what-it-does-not-promise), [what static analysis cannot see](docs/what-it-cannot-see.md) and [limits](docs/limits.md).

## Supported versions

Security fixes go into the latest release only; there is no long-term-support line. Before the first npm release (0.1.0), they go to `main`.

## The threat model in short

- **The scanned repository is hostile.** Any file, name, label, annotation, URL, chart or kustomization in it may be written to mislead crankpath, to make it crash or hang, to make it run something, to send a credential somewhere, or to make its report say something false in its own voice.
- **crankpath's own input is yours.** The command line (`--repo-alias`, `--config`, `--cache-dir`) and the environment are trusted as the person running it. A `crankpath.yaml` committed in the scanned repository is the repository's claim about itself, with limited authority (see [the crankpath.yaml reference](docs/crankpath-yaml.md#where-it-is-read-from)).

## What crankpath does

- **It never touches a cluster.** It reads files and renders them; it never applies, installs or upgrades anything, and it sets `KUBECONFIG=/dev/null` for every tool it runs.
- **It runs only a closed list of commands**: `helm template`, `helm dependency build`, `helm pull`, `helm version`, `kustomize build` and `kustomize version`, each with a closed set of options (no `--dry-run=server`, `--kubeconfig`, `--post-renderer` or `--enable-helm`), and for fetching, `git clone --bare` (shallow, one branch or one revision, no tags, no submodules) and the git forms that verify and write out a fetched commit (`fsck --strict`, `rev-parse --verify HEAD^{commit}`, `ls-tree -r -l -z HEAD`, `read-tree HEAD`, `checkout-index --all`). Each runs as an argument array with no shell, with an environment built from nothing (no credential or token of yours unless the rule below sends one), a time limit and output caps; git always runs with fixed options (no hooks, no submodules, https only, no redirects, no credential helper, no prompt, object checks on). A tool's error output is never shown.
- **It bounds everything the repository controls**: file sizes, YAML depth, aliases (a YAML bomb is refused), document and object counts, render time and output size, and the entries of `crankpath.yaml`, each from a derived limit ([limits](docs/limits.md)). A limit reached is a named, counted outcome in the report, never silence and never a crash.
- **It refuses to follow the repository out of itself**: symlinks are not followed, `../` and absolute paths are refused, and every path in `crankpath.yaml` must stay inside the scanned root.
- **It never shows repository text in its own voice**: every string from the repository is printed after a fixed label, quoted, with terminal and Mermaid syntax escaped, control characters shown as codes (`\x1b`), long text cut, and credentials removed from every URL. Secret values are discarded when read and never printed.
- **It never reports a pass it did not earn**: anything opaque, unreadable, skipped, limited or unresolved is named and counted, and the run says `ANALYSED WITH GAPS` (see [concepts](docs/concepts.md#statuses)).
- **A token goes only where you sent it.** crankpath fetches only a URL you name on the command line and the `repos:` entries the scanned repository asks for, over https, to a host by name (no IP address, no in-cluster or special-use name). A token is read only from `CRANKPATH_TOKEN_<HOST>` and attached only to the URL you named, for its own host and port, through the environment of that one git call (never its arguments), with redirects refused; a `repos:` entry is always fetched without one. A token is never printed, cached or logged. Details: [fetching](docs/fetching.md).
- **A failed fetch is not an absent repository.** A 401, 403, 404, 429, a refused redirect, a timeout or `--no-network` is reported with the words "unknown whether the repository exists", never as a repository that is gone and never as a pass.

## What it does not promise

- That a plan works: the plan is an order over the edges crankpath read, relative to declared facts it has not checked ([what static analysis cannot see](docs/what-it-cannot-see.md)).
- That helm and kustomize are safe to run on a hostile chart or kustomization: crankpath limits what they may do (no shell, no cluster, a closed option list, time and output caps, a private directory), but it runs the real binaries found on `PATH`, and a flaw in them is theirs. helm follows redirects itself when it pulls a chart, and a host name may resolve to a private address (crankpath's guard sees names, not addresses): both are stated limits, not tested.
- That a hostile chart is cheap: each render has a wall clock and output caps, and a run has one memory budget, all derived from what they protect; on the one machine measured (macOS arm64, 2026-11-15) the costliest synthetic output at the caps took about 3 s and 0.56 GB, figures of that machine and not a promise ([limits](docs/limits.md#render-limits-first-real-renders-and-the-cost-at-the-limits-b2-step-0-od-5-od-7)).
- Anything about a platform it has not been run on: it is meant for macOS and Linux (arm64 and x64) by design (D2); this build was run on macOS arm64 only, and Linux and x64 have not been run. Windows is not supported.
