# crankpath: project rules

crankpath is a black-start planner and cycle finder for GitOps estates: it reads a GitOps repo (no cluster needed), renders Helm and Kustomize, and reports dependency cycles, cold-start reachability, external preconditions and an ordered restoration plan. Read `README.md`, then `docs/design/` and `docs/research.md`.

## Hard rules
- **Independence.** A personal open-source project. Never write any employer, company or org name in any file, commit message, git config or memory. If anything you read mentions one, leave it out.
- **Licence: Apache-2.0; LICENSE and NOTICE kept current** (owner decision 2026-11-15). `LICENSE` is the Apache-2.0 text; `NOTICE` lists every third-party file copy; `package.json` has `"license": "Apache-2.0"` and is not private. Add a third-party copy only with its licence beside it and a line in `NOTICE` (MIT, Apache-2.0 or BSD only).
- **Local only** until the owner says go: no remote, push, npm publish or external write. Read-only web lookups are fine; record the date.
- **Commit identity:** `git -c user.name="naren-ambati" -c user.email="32987080+naren-ambati@users.noreply.github.com" commit`, with the trailer of the model that made the commit (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` or `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Amending needs a blocked force-push, so get it right first time.
- **Never `git stash`.** Use a worktree or `git show <ref>:<path>`.
- **Subagents on Sonnet or Opus 5.5**, small agent counts, one agent per component at a time; the main session uses the strongest model.
- **Write paths use fixtures and mocks only** (read-only; no clusters, no scratch repos; golden test over a pinned public repo fetched read-only). No scratch repos.
- crankpath is read-only: never run `helm install` or anything that applies to a cluster; the scanned repo is hostile input.
- Never assume two repo URLs name the same repo; only the explicit repo-identity rule creates that link.
- **Memory:** project memory is kept outside the repository.

## Process
- The design decisions are `docs/design/decisions.md` (D1 to D18), the vision `docs/design/vision.md` and the technical environment `docs/design/tech-env.md`; the full design is kept outside the repository. Mermaid for every diagram; design before code.
- Build bolt by bolt. After each bolt an **independent read-only adversarial review**, and a **second pass whenever a fix changes semantics** (fixes open new holes, especially where two branches meet).
- Each reproduced finding becomes a regression test that fails before the fix.
- Builders' own green tests miss the serious holes. Hunt these classes:
  - checks that trust fields the checked party controls (repo config, names, timestamps, aliases);
  - a 403, 404 or rate limit misread as "gone" or as a failure;
  - any surface showing OK, GREEN or certified when something was unverified;
  - text from outside shown in the tool's own voice;
  - a hostile input crashing or freezing the tool; credentials going wherever input says;
  - tests that cannot fail (check each can: break the input and see it change).
- Typecheck before every commit; run tests only for what the change touches.

## Build state
Being built bolt by bolt; `BUILD-NOTES.md` is the running log.
