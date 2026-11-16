# Release round review, part 1 of 2: docs accuracy, screenshots and examples

- Branch: `release/files-readme`, commit reviewed: 653d4b1 (release round c7cb222..653d4b1; part A is merged as ad0a19c).
- Date: 2026-11-16. Reviewer: Claude Sonnet 5.5, independent read-only review.
- Method: a scratch clone of the branch, `npm ci --ignore-scripts && npm run build`, helm v4.3.2 and kustomize v5.8.1 present on the host. Nothing in the branch was edited; all mutations were made in the scratch clone and reverted.

## 1. Findings

No Major finding. Counts: Major 0, Minor 5, Nit 2.

| id | location | failure scenario | status | minimal general fix |
|---|---|---|---|---|
| m1 | `docs/images/opaque.png`, `refusals.png` (transcripts `opaque`, `refusals`; commands in `docs/tour.md` steps 8 and 9) | The `sed -n '/^Run status:/,/^Cycles:/p'` cut ends on the first physical line of the wrapped Cycles line: the image's last line reads `Cycles: none found among 10 nodes and 11 edges read (3 nodes opaque, so cycles` and stops. The qualifier it belongs to (`inside them cannot be seen; 3 unresolved items; 1 file unreadable`) is on the next line of the real output (`examples/opaque/expected/text.stdout:31-32`). The run status above says ANALYSED WITH GAPS, but the one line that says "none found" is shown without its caveat. The same mid-sentence cut is in `plan.png` (`Not verified: 1 external declared in crankpath.yaml (not verified); 1 crank`, continuation `documented (not verified). Declared edges: 0 ...` is cut). | CONFIRMED (transcripts vs `examples/*/expected/text.stdout`) | End each cut at the end of the whole wrapped paragraph (e.g. `/^Cycles:/,/^$/p`), or end the cut one section later; no image should end inside a sentence. |
| m2 | `scripts/check-images.mjs` (whole) | The images check never ties a PNG to its transcript's text: it checks existence, alt text, caption, transcript fields, use, README mention and size only. Repro: in the scratch clone, `magick docs/images/hero.png -fill red -draw "rectangle 100,140 300,160" PNG8:docs/images/hero.png` then `node scripts/check-images.mjs` still says `0 problem(s)`. So an image edited after capture, or one re-captured without its transcript, passes. (Faithfulness today is real, see section 3, but nothing in `verify` keeps it so.) | CONFIRMED | Record each PNG's SHA-256 in its transcript (written by `render.mjs`) and have `check-images` compare it; or say in `docs/images/README.md` that faithfulness is checked only by re-running `render.mjs`, which needs the out-of-tree tools. |
| m3 | `README.md` Install (line ~86) vs Status | Install gives `git clone https://github.com/naren-ambati/crankpath.git`, while Status says "no public repository exists yet". Until the owner creates it the first install command fails, and the text before it says "run it from a checkout". | CONFIRMED (reading) | Say "from a checkout of this repository (the clone URL below works once the repository is public)", or lead with `cd` into the checkout. |
| m4 | `README.md` opacity paragraph, claim CL-12 | "Flux Kustomizations whose GitRepository only the bootstrap creates (68)": `docs/census-2026-11-16-real.json` has 68 `unreadable-repo / Kustomization / spec.sourceRef.name`, but only 62 are pi-cluster's `flux-system` GitRepository (the bootstrap-created one, `docs/census.md` section 5); the other 6 are nixos-k3s Kustomizations whose source is not defined in the repository, with no statement that the bootstrap creates it. | CONFIRMED (census JSON per estate) | Word it "whose GitRepository the repository does not define (68; 62 of them the bootstrap-created `flux-system`)". |
| m5 | `README.md` opacity paragraph, claim CL-1 | The static estimate is stated as "at least 176 of 214 counted units opaque, 0.8224, over the one-third threshold of D12". `docs/census.md` section 3 says the same figure is "over one third of the counted units; not established for the estates as a whole" (four estates have uncounted units; static estimate, not a bound). The README drops the qualifier that the record insists on, while the real-discovery sentence before it is fine. | CONFIRMED (text comparison) | Add "of the counted units" and "not established for the estates as a whole", or drop the static figure from the README and keep it in `docs/census.md`. |
| n1 | `README.md` quick start excerpt | The excerpt omits the first four lines and the blocks after "Not startable" (blocked-by list, external preconditions, plan, not-modelled list) without a marker; the block is introduced as "Excerpt" but the gaps are not visible. Everything shown matches a real run (verified). | CONFIRMED | Put `...` where lines were removed, or show the sed that cuts it. |
| n2 | `docs/images/README.md` | States the capture machine as "macOS 26.6 ... Node v22.23.2" and a Chromium build; these are facts I cannot confirm from the repository; they are plausible and consistent with `census.md` (Node 22.23.2). No action. | PLAUSIBLE | none |

## 2. Tests and checks that cannot fail

I mutated each and watched for red:

- `check-images` alt text: changed the hero alt in `docs/tour.md`: `alt-differs` fired (can fail). Unused image, missing caption, size: logic read, rules present; not each mutated.
- `check-images` on the picture itself: cannot fail, see m2.
- `check-examples` / `docs/examples.md` quotes: changed `edges: 8` to `edges: 9` in a quoted block: `quote ... is not the pinned output of explain/cycles`, 2 problems (can fail).
- Examples test lane: changed the `--repo-url` in `examples/thin-slice/repo/apps/gitea.yaml` so the cycle disappears: `thin-slice/text` FAIL on the written facts; added ` OK` to a pinned stdout: FAIL (can fail).
- Transcript privacy: appended a home-directory path to `transcripts/hero.json`: `check-tree` reported `home-path` and the release check failed (can fail).
- `check-docs`: 72 files, 16 claims, 0 problems on the branch.

## 3. What I checked and found sound

- Screenshots to transcripts: I ran `docs/images/render.mjs` over a copy of the 15 committed transcripts with the pinned out-of-tree tools (Playwright 1.65.0, marked 18.1.3, mermaid 12.3.0, `-colors 48` reduction). All 15 PNGs came out byte-identical to the committed ones (`cmp`), so every image is the rendering of its transcript with no pixel edit. I also looked at hero, refusals, mermaid and action-summary-pass: the text matches the transcript, the hero's text equals `crankpath examples/thin-slice/repo ... | sed ...` run live.
- Re-capture: `node docs/images/capture.mjs` on `cranked-uncranked`, `no-color`, `action-summary-fail`, `refusals`, `exit-codes`, `homelab-golden`: 0 differing; command, exit and output of every command identical to the committed transcripts (only `capturedAt`, `load` and seconds differ). The pseudo-terminal and Action scenarios reproduced too.
- Only the stated rewrites: the only `$TMPDIR` is in the refusals image; no home-directory or temp-folder path, user name, hostname or `.local` in any transcript or PNG text; `uptime` line carries no hostname. Total 1,054,309 bytes (budget 3,000,000).
- GPL: the golden image prints only the pinned reduced JSON (state, `31` charts, 12 node ids, 22 edges). No homelab file text anywhere in images, examples or docs; examples are crankpath's own estates. Node ids like `Secret/gitea/gitea-admin-secret` are ids, within the "ids and counts" rule.
- Examples: `node scripts/examples.mjs`: 21 passed, 0 failed, 0 skipped; `check-examples`: 10 examples, 21 runs, 15 quotes, 0 problems. All offline; every scenario of the brief is present (thin slice text and JSON, cranked vs uncranked, declared, plan with one manual step, opaque/limit/encrypted, exits 0/1/1/2, refusals, Mermaid, `--explain`, `--no-color`/`NO_COLOR`); homelab appears in docs only as ids and counts. Each `expected.json` edit lists its reason.
- The claim in `docs/examples.md` that with helm and kustomize installed only the toolchain line (and the JSON `toolchain` object) changes: reproduced by running all 21 runs with the host `PATH`; the only differences are `toolchain: helm v4.3.2, kustomize v5.8.1` and the JSON `helm`/`kustomize`/`missing`/`tested` fields.
- README quick start, run live in `test/fixtures/docs-example` with the stated command: output equals the excerpt, exit 0; without `--repo-alias` both Applications are opaque as stated; `--version` prints the version and the helm and kustomize lines.
- Opacity-first figures: 268 of 311 (0.8617), 316 of 839 (0.3766), 176 of 214 (0.8224), reasons 148 and 28, equal `docs/census.md` section 5 and the census JSON. Research figures (9,710 stars, #1712, #5879 31 reactions, #7437 391 reactions and 116 comments, #2833) match `docs/research.md`.
- README order matches the brief: what it is, opacity first, hero (with its alt and caption from `docs/images/README.md`), why with evidence, how it differs, install, quick start, tour and examples, Action, limits, status, licence (then a documentation index).
- Word search for OK, clean, passed, safe, green, healthy across README, tour, examples, images page, Action guide, SECURITY, CONTRIBUTING, CHANGELOG and checklist: every use is negated, a rule statement, or about the tool's own verification; no surface claims OK over a gap. The Action images read `NO_NEW_CYCLES_FOUND (not a pass)`.
- `package.json` licence Apache-2.0, `bin`, `exports`, `repository`, `homepage`, `bugs`, `engines` consistent with the README; the design workspace folders are still tracked in the history, which the release checklist (step 9) assigns to the coordinator.

## 4. Not done

- Part 2 of the review (release files, workflow shape, SECURITY, CONTRIBUTING, CHANGELOG, checklist) is not covered here beyond word searches.
- I did not run the full `npm run verify` (the README's status line says it passes; I did not re-measure its figures) nor the golden or live lanes.
- I did not open every PNG by eye (hero, refusals, mermaid and the Action pass image only); the byte-identical re-render stands in for the rest.

## 5. Verdict

Ready to merge after fixes: no Major, five Minor (m1 and m2 are the ones to fix first) and two Nits.
