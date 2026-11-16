# Images

Every PNG here is a screenshot of a real run, captured on 2026-11-16 with crankpath 0.1.0 built from this repository (`npm run build`). The text in each one is in [`transcripts/`](transcripts) as the command, its merged standard output and error, its exit status and its wall time; nothing in an image was typed or edited by hand. The [tour](../tour.md) shows every image, and the release checks (`scripts/check-images.mjs`, run by `npm run verify`) fail an image that has no transcript, no alt text, no caption line, alt text other than its transcript's, no use in a doc, or no entry on this page, and fail the set at 3,000,000 bytes or more.

In the commands and the images, `crankpath` stands for `node dist/u9-cli-package/cli.js`: the package is not published, so every run is of the built checkout.

## How they were made

1. [`capture.mjs`](capture.mjs) ran each command from the repository root as `sh -c 'set -o pipefail; { <command>; } 2>&1'`, so the output is standard output and error merged in the order written and a command that ends in a pipe keeps crankpath's exit code. `PATH` was node's directory, `/usr/bin` and `/bin` only, so helm and kustomize were not found (the toolchain line the [examples](../examples.md) are pinned with); `python3` in a command is a python3 of 3.10 or later found on the caller's `PATH` (3.14.7 here), because macOS's own 3.9 never returns from `pty.spawn` once the child has exited. It stored each run as `transcripts/<id>.json` (`id`, `title`, `caption`, `alt`, `version`, `capturedAt`, `load` from `uptime`, which prints no hostname here, and per command `command`, `exit`, `seconds`, `output`; the Action images add `summary`, the Mermaid image `mermaid`). After each scenario it compared the run with what was written down before it:
   - a command on an example: the exit code in [`examples/expected.json`](../../examples/expected.json), and the output equal to that example run's pinned output, or, where the command cuts it with `sed`, lines of the pinned output in their order (on the pseudo-terminal, with the colour codes taken out first);
   - the Action: the result, exit status and new-cycle count its fixture's `case.json` expects;
   - the homelab golden: lines of the pinned file it prints.

   A run that differed would have been saved as `<id>-attempt<N>.json` and never as `<id>.json`, so a differing attempt stays on record. Both captures in the repository on 2026-11-16 had none: the first, at 21:40 UTC, was replaced by the second, at 21:43 UTC, after two alt texts were corrected (the hero's gained the not-startable line it shows, and the Mermaid image's said six nodes where the diagram has seven); no output changed. The trial runs before them, outside the repository, are in `BUILD-NOTES.md`. Re-capture one image with `node docs/images/capture.mjs <id>`, then render it again. On 2026-11-16, after the release review, `opaque`, `refusals` and `plan` were captured again with cuts that end on a whole statement (each had ended inside a wrapped line: the qualifier of the Cycles line, and the second line of Not verified, were cut off), and capture.mjs now refuses a cut that ends inside a wrapped statement; all fifteen were rendered again, and the other twelve PNGs came out byte-identical to the ones before.
2. [`render.mjs`](render.mjs) turned each transcript into a page and screenshotted it with Playwright 1.65.0's headless Chromium (build 1254, Chromium 158.0.8127.18), with `marked` 18.1.3 and `mermaid` 12.3.0, all exact versions installed in a folder outside the repository (`npm install --ignore-scripts --save-exact playwright@1.65.0 marked@18.1.3 mermaid@12.3.0`, then `npx playwright install chromium`, a read-only download; render.mjs refuses any other version). A terminal card shows each command, its output and its exit status as stored, with a bar holding the crankpath version and the capture date; the colour codes crankpath writes (SGR 1, 31 and 0 in these runs) become styled text. The Action images are the stored job summary Markdown rendered the way GitHub renders a job summary, with the step's annotations under it. The Mermaid image is crankpath's Markdown output rendered with each `mermaid` block drawn by Mermaid itself in the page; render.mjs stops when Mermaid cannot parse a block, so the image also shows that the diagram parses.
3. Each PNG was reduced to 48 colours with ImageMagick 7.1.2-31 (`magick in.png -colors 48 -dither None -strip PNG8:out.png`; `-strip` leaves no text or metadata chunk, which the tree check refuses). All fifteen together are 1,067,793 bytes. render.mjs records, in [`manifest.json`](manifest.json), the SHA-256 of each PNG it wrote and of the transcript it rendered it from, and the release checks (`scripts/check-images.mjs`) refuse an image or a transcript that no longer matches: an image edited after rendering, or a transcript captured again without rendering its image again.

One machine: macOS 26.6 on Apple silicon, Node v22.23.2, `/usr/bin/git` (Apple Git 2.54.0) for the Action's local harness. The 1-minute load in each transcript was 1.5 (the 15-minute load about 12, from other work on the machine); none of these runs is timed against anything.

## What differs from the raw output

Only this: the home directory is written `~` and the system temporary directory `$TMPDIR/` (here only in the refusals image, whose estate is copied to `$TMPDIR/crankpath-shots/refusals`). Everything else that makes an image shorter than the full output is a command in the image: `sed` cuts the report to the lines that matter, `sed -n '1,48p'` and `sed -n '1,40p'` keep the first lines of the JSON report and of `--explain` (`head` would close the pipe early, and crankpath exits 1 when its output is closed), and `tr -d '\r'` drops the carriage return a pseudo-terminal adds to each line. The full outputs are the pinned files of [the examples](../examples.md).

## The images

The hero (used by the README):

- `hero`: alt text "Terminal output of crankpath on the thin-slice example: Run status ANALYSED, then Cycles: 1 uncranked, cycle c-d8197e7d labelled extracted with 5 nodes and 8 edges, its two shortest-cycle edges with their fields, and 7 of 7 nodes not startable from a cold start; exit 0". Caption: "Argo CD reads its Git source from the Gitea it deploys: one extracted cycle, every node blocked, and a status line that says ANALYSED only because everything was read." A short run of its own (`examples/thin-slice`, cut with `sed`), not a crop of another image. <!-- claim CL-43 -->

The rest, in the order of the [tour](../tour.md); each one's alt text and caption are in its transcript:

- `thin-slice-text`, `thin-slice-json`: the thin-slice example's whole text report, and the first 48 lines of its JSON report.
- `explain`: the first 40 lines of `--explain` on the same example.
- `mermaid`: `--format mermaid` on the same example, rendered by Mermaid.
- `cranked-uncranked`: the same example without and with `examples/crank/crankpath.yaml`, two commands in one image.
- `plan`: the plan example, from the not-startable line to the end of the plan.
- `declared`: the declared example without and with its declared edge.
- `opaque`: the opaque example, from the run status to the cycles line.
- `refusals`: the refusals example copied by its `make-copy.mjs`, then crankpath over the copy, from the run status to the cycles line.
- `exit-codes`: four commands, one per exit code (0, 1 twice, 2).
- `no-color`: the thin-slice run on a pseudo-terminal three times, plain, with `--no-color` and with `NO_COLOR=1`. The pseudo-terminal is Python's `pty` module (the command line shows it).
- `action-summary-fail`, `action-summary-pass`: the Action's own check step run by `scripts/action-local.mjs` on its fixtures `add-cycle` and `unrelated-change`, with `GITHUB_STEP_SUMMARY` pointing at a temporary file; the transcript holds the harness's output and the summary Markdown. Not a run on a GitHub-hosted runner: the Action has never run on one.
- `homelab-golden`: parts of the golden lane's pinned reduced JSON for khuedoan/homelab at 8b9d40f, printed with `cat` and `sed`. It holds node ids and counts only; no file or text of the GPL-3.0 repository is in this repository or in any image.

Whose data: every estate shown is crankpath's own, written for its examples and fixtures; nothing here is a claim about anyone's cluster, and every number is the result of one run on one machine.
