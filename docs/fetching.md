# Fetching repositories, and where a token goes

crankpath reads a GitOps repository; it fetches one only in two cases, both read-only:

1. **A URL on the command line**: `crankpath https://<host>/<path> [--rev <rev>]`. The commit's files are scanned and the URL is their own URL. A full commit sha pins it; a branch, a tag or no `--rev` (the default branch) is flagged `floating`, with the commit it resolved to recorded in the report.
2. **A `repos:` fetch entry** in the scanned repository's `crankpath.yaml`: `"<url>": {fetch: true}`. It is fetched at its default branch (floating, commit recorded) only when a source of the scan needs it.

## Tokens

- A token is read only from `CRANKPATH_TOKEN_<HOST>` (the host upper-cased, `.` to `_`, `-` to `__`), or `CRANKPATH_TOKEN_<HOST>_<PORT>` for a port other than 443. No key of `crankpath.yaml` names a variable.
- It is attached **only to the URL you name on the command line**. A `repos:` entry is chosen by the repository being scanned, which crankpath treats as hostile input, so **it is always fetched without a token**: a private repository named there is reported `unreadable-repo` (the detail says it was fetched without a token), never read with your credentials. To read a private repository, clone it yourself and pass `--repo-alias <url>=<path>`.
- The token goes to its own host and port only, over https, as an `Authorization` header given to git through the environment of that one call (never in its arguments); git is told to treat every redirect as an error, so the header cannot follow one. It is never printed, cached or logged.

## The cache, and what is read

- `.crankpath/repos/<host>/<path>@<sha>/` (or under `--cache-dir`) holds git object stores only (`git clone --bare`), never a tree crankpath reads.
- Every read of a commit, cached or just fetched, goes the same way: the store's object files, chosen by name (loose objects and `pack-<hash>.pack`/`.idx`/`.rev`; never a symlink), are copied into a private git directory of the run that crankpath writes itself (its own config, `HEAD` naming the commit). Nothing else of the store is read: not its config, hooks, refs, `info/` or alternates, and no directory reached through a symlink. `git fsck --strict` must pass: every object's hash, the pack checksums, connectivity from `HEAD`, which must be a commit (crankpath writes `HEAD` as the commit asked for).
- Before anything is written, `git ls-tree -r -l -z HEAD` lists every path with its size: the sum and the count must be within `fetchedRepoBytes` and `filesPerScan`, so a blob that expands at many paths is refused before a byte is written. The same listing finds paths that would name one file on a case-insensitive or normalising file system (`App.yaml` and `app.yaml`, `café` written in NFC and in NFD, a directory `Docs/` and `docs/`).
- The commit's files are then written by `git checkout-index` into the run's own directory, with the repository's attributes replaced by the empty tree (no filter, `ident`, `eol` or `working-tree-encoding` changes a byte). Colliding paths are removed again, on every platform, so every machine scans the same files; each is reported as an unreadable file (`path-collision`), a counted gap. Only that directory is scanned; it is removed at the end of the run. The private copy of the objects is removed as soon as the files are written, and so is a store that is not kept in the cache.
- A store git refuses is discarded and fetched again; under `--no-network` the repository is `offline`. A verification call that did not finish (the wall clock ran out, its output passed the cap, or git could not start) says nothing about the store: the fetch is `unreadable-repo` with those words and the cached store is left alone. Without git a cached commit is not read (`tool-missing`): it cannot be verified.
- A store at a pinned commit whose objects pass is that commit, whoever wrote the directory: git checks every object against its name.

## What is never fetched

Only https, to a host by name: no IP address in any spelling, no loopback or link-local name, no name that can only resolve inside a network (one label, `.svc`, `.cluster.local`, `.internal`, or a top-level domain that is not delegated), and no special-use name of the IANA registry (`.local`, `.localhost`, `.test`, `.example`, `example.com`/`.net`/`.org`, `.invalid`, `.onion`, `home.arpa`, anything under `arpa`, and the rest of the registry). A URL holding a credential, a query or a fragment is refused. git runs with a fixed set of options (no hooks, no submodules, https only, no credential helper, no prompt) and an environment built from nothing.

## Limits and what they mean

- One attempt. One fetch, its clone and its verification together, is stopped after 90 s (`repoFetchWallClock`). git and every helper it started run in one process group, killed together when the time runs out, when git's output passes `gitOutputBytes`, and when crankpath's helper gets SIGINT, SIGTERM or SIGHUP.
- One run makes at most 33 fetches (`fetchesPerRun`), the command line's URL and every `repos:` entry together, reads from the cache included: a `repos:` entry past that is an opaque `limit`, counted. With the wall clock, a run spends at most 33 × 90 s fetching.
- A repository larger than the run could read (`fetchedRepoBytes`, 74,200,599 bytes: the store, the copy, and the sizes git lists for the files it would write, each measured, the last before anything is written) or holding more files than a scan lists (`filesPerScan`) is refused: a counted `limit`.
- What a run keeps on disk: each fetch keeps only its written files (at most `fetchedRepoBytes`) until the run ends, so the run directory holds at most 33 × 74,200,599 bytes (about 2.4 GB); while one repository is read, its store and a copy of its objects add at most two more `fetchedRepoBytes`. A trusted cache keeps one store per fetch.
- A 401, 403, 404, 429, a refused redirect, a timeout or `--no-network` is reported as what it is, with the words "unknown whether the repository exists": never as a repository that is absent, and never as a pass.

## Not covered

- A host name that resolves to a private address (DNS rebinding, or a wildcard DNS service that answers with any address) is not detected: the checks see names, not addresses.
- The cache under `.crankpath/repos/` is never pruned; remove it yourself. A cache inside the scanned tree is never read. A cache entry written by an earlier crankpath (a checkout, not a store) fails verification and is fetched again.
- `git fsck --strict` (git 2.55.0) turns fsck's warnings into errors: a path that a file system could read as `.git` (`.GIT`, `git~1`, `.git` with an ignorable code point) is refused. A legacy file mode written by old git (`100664`, group-writable) is only reported, not refused (checked: such a commit is read).
- The colliding-path check folds case and Unicode normalisation; it does not model every file system's rules (for example the code points HFS+ ignores in names other than `.git`). A pair a given file system keeps apart may still be reported; none it merges is missed by the case and normalisation rules.
- A SIGKILL sent to crankpath's helper process itself cannot be handled: git then runs until it ends by itself or the network closes. A SIGTERM sent to crankpath alone (not its process group) while git is silent leaves git running until the fetch's wall clock (at most 90 s), when the helper kills it.
- A process that git started and that left git's process group while holding its output would keep the call waiting; git starts none (its helpers stay in its group), and crankpath runs nothing else through the helper.
- While git runs, its download is bounded only by the wall clock; the size is checked after it ends.
