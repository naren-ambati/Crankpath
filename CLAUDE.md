# crankpath: project rules

crankpath is a black-start planner and cycle finder for GitOps estates: it reads a GitOps repo (no cluster needed), renders Helm and Kustomize, and reports dependency cycles, cold-start reachability, external preconditions and an ordered restoration plan. Read `README.md`, then `aidlc-inputs/` and `docs/research.md`.

## Hard rules
- **Independence.** A personal open-source project. Never write any employer, company or org name in any file, commit message, git config or memory. If anything you read mentions one, leave it out.
- **No licence.** No LICENSE file, no licence text. Say "licence: decided by the owner before release". `package.json` gets `"private": true, "license": "UNLICENSED"`.
- **Local only** until the owner says go: no remote, push, npm publish or external write. Read-only web lookups are fine; record the date.
- **Commit identity:** `git -c user.name="naren-ambati" -c user.email="32987080+naren-ambati@users.noreply.github.com" commit`, with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Amending needs a blocked force-push, so get it right first time.
- **Never `git stash`.** Use a worktree or `git show <ref>:<path>`.
- **Subagents on Sonnet**, small agent counts, one agent per component at a time; the main session uses the strongest model.
- **Write paths use fixtures and mocks only** (read-only; no clusters, no scratch repos; golden test over a pinned public repo fetched read-only). No scratch repos.
- crankpath is read-only: never run `helm install` or anything that applies to a cluster; the scanned repo is hostile input.
- Never assume two repo URLs name the same repo; only the explicit repo-identity rule creates that link.
- **Memory** lives in `~/Documents/crankpath-vault/Memory/` (set by `.claude/settings.local.json`, which git ignores). Keep `[[wikilinks]]` pointing at real filenames.

## Process
- Design with AI-DLC first (see START-HERE.md); stage-major, Mermaid diagrams, design before code.
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

## Next step
the day-1 census on five more public estates (go/no-go on the opaque share), then week 1 of the MVP; before that, run AI-DLC per START-HERE.md.
