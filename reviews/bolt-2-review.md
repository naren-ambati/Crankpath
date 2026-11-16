# Bolt B2 review: render engine (helm and kustomize behind the allowlisted runner)

- Bolt: B2, branch `bolt/b2`, reviewed commit `08d4cc2` (diff `9ac9590..08d4cc2`, base `bolt/b1`)
- Date: 2026-11-15
- Reviewer: Claude Sonnet 5.5, independent read-only review
- Commit identity of the three bolt commits: `naren-ambati <32987080+naren-ambati@users.noreply.github.com>`, each with the Sonnet co-author trailer: sound.
- Real tools used: helm v4.3.2, kustomize v5.8.1. Repros are in the reviewer's scratch folder `review-b2/repros/` (hostile fixtures, no network except a loopback listener and read-only public `helm pull` error probes).

## 1. Findings

| id | severity | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|---|
| M1 | Major | `kustomize-renderer.ts` `entries()`/`preReadKustomization` (BR4.4); `helm-renderer.ts` `preReadChart` (BR4.20) | The pre-read reads keys by exact lower-case name, but kustomize and helm decode with Go `encoding/json`, which matches keys case-insensitively. `Resources:` (or `RESOURCES:`) in `kustomization.yaml` is invisible to the pre-read yet is honoured by kustomize: a remote base is fetched. In `Chart.yaml`, `Repository:` inside a dependency is invisible (crankpath sees `repository` absent and skips the guard) while `helm dependency build` uses it, so an absolute `file:///...` dependency OUTSIDE the scanned root is read, vendored into the private copy and its objects appear in the graph, and an `http://127.0.0.1` repository is contacted (no guard). Defeats BR4.4, BR4.5, BR4.20, FR1.8, US4.x "remote-base" and the hard rule "scanned repo is hostile". | CONFIRMED. (a) `kustomize build` accepts `RESOURCES:`, rejects `Resourcesx:` ("unknown field"); with a fake `git` first on PATH, `crankpath` on a repo whose kustomization has `Resources: [https://127.0.0.1:1/org/repo.git//base?ref=main]` made kustomize call `git init` (log line `GIT CALLED: init`), and the root was not marked `remote-base` (`repros/h1`, `repros/k1`). (b) `repros/h1/chart-case`: chart with `Repository: file:///<outside-root-chart>` renders `ConfigMap/chartcase/from-outside-root` (an object from outside the root) in the graph. (c) a loopback listener received `GET /charts/index.yaml` (`repros/h2`). | Treat keys case-insensitively in every pre-read (lower-case the key set of the mapping before lookup, and reject, as `unsupported-field`, any mapping holding two keys equal after lower-casing), or, stronger, allowlist the exact set of top-level keys and refuse anything else. |
| M2 | Major | `helm-renderer.ts` pre-read (BR4.20) | `requirements.yaml` (and `requirements.lock`) of an `apiVersion: v1` chart is read by helm 4.3.2 for dependencies but never pre-read. Combined with a decoy lower-case `dependencies:` entry with no repository in `Chart.yaml` (which makes crankpath set `needsBuild` and run `helm dependency build`), the real dependency list in `requirements.yaml` can name `file:///<outside root>` or `http://127.0.0.1:PORT/charts`. | CONFIRMED: `repros/h2` (outside-root chart object `ConfigMap/a/from-outside-root` in the graph; listener hit `GET /charts/index.yaml`). `helm dependency build` on the same chart directly: "Saving 1 charts". | Pre-read `requirements.yaml` and `requirements.lock` exactly as `Chart.yaml`/`Chart.lock` (or refuse a chart that has them, `unsupported-field`). Same fix class as M1: the guard must cover every file helm reads for dependencies. |
| M3 | Major | `helm-renderer.ts` argv (`--skip-schema-validation` only when the source asks) ; BR4.9 / FR3.8 / "no cluster, no network" | helm 4.3.2 resolves `$ref` in a chart's `values.schema.json` itself: `http(s)://` is fetched and `file://` is read, with no URL guard and under `--no-network`. A hostile chart therefore makes crankpath's helm perform an HTTP GET to any host the repo names (internal services, metadata endpoints) even when the user asked for no network, and probe local files. | CONFIRMED: chart with `{"$ref":"http://127.0.0.1:PORT/schema.json"}`; `crankpath --no-network` on it rendered the objects and the listener logged `GET /schema.json` (`repros/h5`). With `helm template --skip-schema-validation` no request is made (verified). `file:///etc/hosts` as `$ref` is read (error text shows the parse failure). | Always pass `--skip-schema-validation` (already on the allowlist; the graph needs no schema validation) and add a not-modelled line. |
| M4 | Major | `rendered-output.ts` / `render-io.ts finishOutput` (no budget for in-process parse); `docs/limits.md` "Cost at the limits" | The wall-clock backstop covers only the subprocess. A render whose output stays inside every derived limit (100 MiB, 3 MiB per document, node limit per document) makes crankpath itself spend 3.5 to 5.8 minutes and 2.8 to 3.6 GB RSS in the parse (the bolt's own measurement; on a smaller heap it can exhaust memory before a limit binds). That is a hang or crash on hostile input (hard-rule class "a limit hit is a counted, named outcome, never a crash"). It is disclosed as an owner item, which is honest, but the Definition of Done item "fail closed on size, depth, count and time" is not met for this path. | PLAUSIBLE (traced; the bolt's measurements in `docs/limits.md`, not re-run: 4 to 6 minute runs). | Derive a per-job parse budget (total parsed nodes or wall time of the parse) from the same published ceilings the bolt already uses (for example total nodes at most the object ceiling times a per-object node bound) and report `limit`; do not leave it to the owner. |
| m1 | Minor | `rendered-set-builder.ts stripSecret` / `take` (BR4.7) | Secret stripping is exact-name: `kind: SecretList` items (kept with `data`), and a Secret whose keys are case variants (`Data:`, `StringData:`, which the API server decodes case-insensitively) keep their values in the object body. Plain `Secret`, `Secret` in `kind: List`, `data` and `stringData` are stripped (checked). Bodies are not printed anywhere today, so no leak reaches output now. | CONFIRMED with a node script over `buildObjects` (`repros/secret.mjs`: LEAK6, LEAK7, LEAK8 retained). | Strip case-insensitively and expand `*List` kinds; or whitelist the fields of a Secret body to keep (`metadata`, `type`, `immutable`). |
| m2 | Minor | rendered output determinism (brief "same inputs, byte-identical JSON"; BUILD-NOTES "JSON byte-identical across runs") | A chart using `randAlphaNum`, `now`, `uuidv4`, `genCA` in names or labels gives different node ids on every run, with no flag in the report; the claim of byte-identical output holds only for deterministic charts. | CONFIRMED: two runs of one repo differ (`repros/h3`: `ConfigMap/a/awtr1m-x` vs `ConfigMap/a/xwkdjq-x`). | Detect it cheaply (render twice only when the chart's templates mention a random or time function, or always compare ids of a second render under a cap) and mark the owner `render-failed: non-deterministic output`, or at least add a not-modelled line. State the claim as "for deterministic charts". |
| m3 | Minor | `work-dir.ts`, `helm-renderer.ts writeValues` | Values read from repo Secrets (Flux `valuesFrom`) are decoded and written to 0600 files under `<cache>/tmp/run-*/`, which for the default cache is inside the scanned tree and not git-ignored. Removal is in a `finally` only: no SIGINT/SIGTERM handler, and SIGKILL or a crash leaves decoded secrets in the work tree for the next `git add .`. | PLAUSIBLE (traced: no `process.on` anywhere; leftover runs are never cleaned by later runs). | Create `.crankpath/.gitignore` containing `*` on first creation, clean stale `tmp/run-*` of dead pids at start, and register signal cleanup. |
| m4 | Minor | `helm-renderer.ts preReadChart` vs `copyDirs` | Time-of-check/time-of-use: the pre-read parses the original `Chart.yaml`, and `copyDirs` re-reads the files afterwards (an uncached second read, the pre-read itself being cached from discovery). Content changed in between is not re-checked. Outside the threat model of a static checkout, but the fix is free: pre-read the private copy. | PLAUSIBLE. | Run the pre-read on the private copy after copying (same for kustomize). |
| m5 | Minor | test `helm-renderer.test.ts` (Chart.lock symlink) | A mutation removing the `Chart.lock` symlink branch left all 158 u4 tests green (the reader and `copyDirs` also refuse the link, so behaviour is unchanged). The branch is redundant, or untested for its own message. | CONFIRMED by mutation. | Remove the branch or assert its specific mark. |
| m6 | Minor | live lane and hostile fixture | The hostile fixture and live lane use only lower-case keys and `Chart.yaml`, so they could not have caught M1, M2 or M3; "hostile fixture fails closed" in BUILD-NOTES is true only for the forms tried. | CONFIRMED (fixtures read). | Add case-variant, `requirements.yaml` and `values.schema.json` `$ref` fixtures to both lanes. |
| m7 | Minor | `chart-cache.ts getChart` | An exact `targetRevision: v1.2.3` against a chart whose Chart.yaml says `1.2.3` is compared by string (`id.version !== loc.version`) and fails with "does not state the requested name and version" every time (helm normalises the `v`); OCI charts whose internal name differs from the last path segment fail the single-entry check. Both are opaque, never a false OK. | PLAUSIBLE (traced). | Compare normalised SemVer; accept the one directory helm made. |
| n1 | Nit | `command-runner.ts` | Over-cap results still keep `stderr` when only stdout is over (mutation changing the over-cap stderr clearing passed all tests): not a leak (never shown), only an untested line. | CONFIRMED by mutation. | Test or drop. |
| n2 | Nit | `command-runner.ts realSpawn` | `spawnSync` SIGKILLs only the child; a grandchild (kustomize's `git`) holding the pipes can keep the call alive past the wall-clock limit. | PLAUSIBLE (not reproduced). | Spawn in its own process group and kill the group, or close stdio on timeout. |

## 2. Tests that cannot fail

Mutations applied in a scratch copy, each followed by the named test files, then restored (`git status` clean after):

| Mutation | Result |
|---|---|
| allow `--post-renderer` on `helm template` | red (1) |
| pass `AWS_SECRET_ACCESS_KEY` to the child env | red (2) |
| skip Secret stripping | red (3) |
| hook match by prefix instead of exact | red (2) |
| cache always trusted | red (1) |
| `file://` outside-root check disabled | red (1) |
| timed-out flag not set | red (5) |
| `helmCharts` check disabled | red (1) |
| URL entries not seen as remote | red (1) |
| missing base not `remote-base` | red (2) |
| IP-literal guard removed | red (9) |
| object limit disabled | red (2) |
| `--no-network` guard for dependency fetch removed | red (2) |
| offline refusal for in-tree cache removed | red (2) |
| `Chart.lock` symlink branch removed | GREEN (m5) |
| stderr kept on over-cap | GREEN (n1) |

The `LoadRestrictionsRootOnly` value is also enforced twice (allowlist fixed value, plus the test of refused values); not separately mutated.

## 3. Definition of Done, item by item

| Item | Status | Evidence |
|---|---|---|
| Closed subprocess allowlist, argv only, no shell, fixed option sets | Met for the runner itself | `checkAllowed`; every forbidden subcommand and flag refused before spawn; `--namespace --post-renderer=x` checked with real helm: consumed as the value, nothing run. But the allowed argv does not make helm network-free (M3). |
| Env allowlist, private homes, `KUBECONFIG=/dev/null`, no credential | Met | `buildChildEnv`; test plants 13 credentials; no proxy variables; `HELM_NO_PLUGINS=1`, empty plugin dir. |
| Pre-read of Chart.yaml/Chart.lock/kustomization (BR4.4, BR4.5, BR4.20) | Not met | M1, M2: bypassed by key case, by `requirements.yaml`; merge keys (`<<`) and YAML anchors ARE handled (checked: refused). |
| No remote base, no plugin, no exec, no `--enable-*` | Partly | exec generator and `HelmCharts` tried with real kustomize: refused by the tool without the flags. Remote bases bypass the pre-read (M1) so kustomize does attempt the fetch. |
| Cache trust: `.crankpath` in the scanned tree never trusted | Met | planted chart at the exact cache path is ignored ("the chart cache is inside the scanned tree"), the same chart is used from an outside `--cache-dir`; symlinked cache parts refused by lstat. |
| `--no-network` means cache only; miss opaque `offline` | Not met for helm itself | M3 (schema `$ref` fetch); the crankpath-side logic is sound. |
| Caps and timeouts give counted opaque marks, no stderr verbatim, no retry | Met for the subprocess; not for parse cost | `commandMark`, `timedOut` counted, OD-30 wording "stopped by a time limit (the output may differ on a rerun)" present in the status block and JSON counts; stderr read only in `fetchFailureMark` and never printed. M4 for the in-process parse. Real helm wording for 403/404/unreachable observed here and matches the classifier. |
| Derived limits (OD-5) | Met | wall clock 90 s from Argo CD's default exec timeout, 100 MiB from its gRPC default, 65,536 objects from etcd's request size over the shortest controller entry, 3 MiB document from kube-apiserver; each has a dated basis; no picked number found. The cost they allow is M4. |
| Secret data stripped | Partly | all main forms (`data`, `stringData`, `List` items) stripped; `SecretList` and case-variant keys not (m1). |
| Test hooks exact match, dropped and counted | Met | `test`, `test-success`, `test-failure`, comma lists; prefix mutation turns tests red. |
| Writes confined (US9.4) | Met with a caveat | only `--out` and `.crankpath`; run dir 0700, files 0600 `O_EXCL|O_NOFOLLOW`; leftover run dirs after a kill (m3). |
| Live lane ran, SKIPPED never a pass | Met | `npm run verify:live` run here 2026-11-15: 6 passed, 0 failed, 0 skipped (exit 0); script exits 2 on any skip, 1 on a failure. The lane does not cover the bypass forms (m6). |
| `npm run verify` green | Met | typecheck, lint, build, tests (34 files, 525 tests), coverage, check-tree: exit 0 on the reviewed commit. |
| Determinism | Partly | deterministic for deterministic charts; random or time functions change ids (m2). |
| Hard rules (independence, licence, no design-tool names, identity) | Met | no employer or personal path found in the added files (reviewer grep of the diff); commits carry the required identity and trailer; no vault-helm content committed. |

## 4. What was checked and found sound

- Option-as-value injection: `--namespace` takes the next argument as its value even when it starts with `--` (real helm); positionals always follow `--`.
- YAML merge keys and anchors in `Chart.yaml` and `kustomization.yaml` do not hide a dependency or a base (both refused).
- Kustomize exec generators and Helm inflation are inert without `--enable-exec` and `--enable-helm`; the allowlist never passes them.
- In-tree `.crankpath` is not read as a chart cache; a symlinked `.crankpath` is refused; the cache key is a digest of the guarded URL and chart names and exact versions are character-restricted.
- Symlinks, `..`, absolute entries and out-of-root `file://` (lower-case form) fail closed; the tools only read a private copy.
- `values:`/`valuesObject`/value files are parsed under reader limits before helm sees them; written 0600, in order, removed afterwards.
- Credentials: no token, proxy, kubeconfig, Docker or registry config reaches a child; `--repo` URLs with userinfo or queries are refused.
- A kustomize root at the scanned root does not copy `.crankpath` into itself.
- No `helm install`/`upgrade`, no `kubectl` anywhere in `src/`.

## 5. Verdict

**Not ready.** Four Majors: M1 and M2 (the BR4.4/BR4.20 pre-reads are bypassable by key case and by `requirements.yaml`, giving a remote kustomize fetch, an out-of-root chart read and an unguarded HTTP request), M3 (helm fetches `values.schema.json` `$ref` URLs even under `--no-network`; one allowlisted flag fixes it), and M4 (a render inside every limit can hang the parse for minutes and gigabytes). The runner, environment, cache trust, derived limits and live lane are otherwise well built and the tests are mostly able to fail.
