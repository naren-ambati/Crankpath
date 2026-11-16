// check-images (scripts/check-images.mjs): what every screenshot of docs/images needs, each rule shown
// failing on a small tree of its own; the repository's own images; and the transcripts against what
// docs/images/capture.mjs checked when it captured them (claim CL-43).

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCENARIOS } from "../../docs/images/capture.mjs";
import { BUDGET_BYTES, checkImages, imageRefs } from "../../scripts/check-images.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const transcript = (id: string, alt = "A terminal showing a run") => ({
  id,
  title: "t",
  caption: "c",
  alt,
  version: "0.1.0",
  capturedAt: "2026-11-16T00:00:00.000Z",
  load: "up",
  commands: [{ command: "crankpath x", exit: 0, seconds: 0.1, output: "o\n" }],
});

function tree(files: Record<string, string | Buffer>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-check-images-"));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return { root, files: Object.keys(files).sort() };
}

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const SHOT_PNG = Buffer.from([1, 2, 3]);
const SHOT_JSON = JSON.stringify(transcript("shot"));
const good = (): Record<string, string | Buffer> => ({
  "docs/images/shot.png": SHOT_PNG,
  "docs/images/transcripts/shot.json": SHOT_JSON,
  "docs/images/manifest.json": `${JSON.stringify({ shot: { png: sha(SHOT_PNG), transcript: sha(SHOT_JSON) } }, null, 2)}\n`,
  "docs/images/README.md": "- `shot`: how it was made\n",
  "docs/tour.md": "![A terminal showing a run](images/shot.png)\n\n*`crankpath x`, run 2026-11-16: what it shows.*\n",
});
const problems = (files: Record<string, string | Buffer>) => checkImages(tree(files)).problems;

describe("check-images", () => {
  it("passes a shot with its transcript, alt text, caption, a doc and a README entry", () => {
    const r = checkImages(tree(good()));
    expect(r.problems).toEqual([]);
    expect(r.uses).toEqual({ shot: ["docs/tour.md"] });
  });

  it("fails each missing piece by name", () => {
    expect(problems({ ...good(), "docs/tour.md": "![](images/shot.png)\n\n*c*\n" })).toEqual([
      "docs/tour.md:1 no-alt docs/images/shot.png has no alt text",
    ]);
    expect(problems({ ...good(), "docs/tour.md": "![Another alt](images/shot.png)\n\n*c*\n" })).toEqual([
      "docs/tour.md:1 alt-differs the alt text of docs/images/shot.png is not its transcript's",
    ]);
    expect(
      problems({ ...good(), "docs/tour.md": "![A terminal showing a run](images/shot.png)\n\nplain text\n" }),
    ).toEqual(["docs/tour.md:1 no-caption docs/images/shot.png is not followed by an italic caption line"]);
    const noTranscript = good();
    delete noTranscript["docs/images/transcripts/shot.json"];
    expect(problems(noTranscript)).toEqual(["docs/images/shot.png:0 no-transcript no transcripts/shot.json"]);
    expect(problems({ ...good(), "docs/tour.md": "nothing\n" })).toEqual([
      "docs/images/shot.png:0 unused-image no doc shows it",
    ]);
    expect(problems({ ...good(), "docs/images/README.md": "nothing\n" })).toEqual([
      "docs/images/shot.png:0 undocumented docs/images/README.md does not name it",
    ]);
    expect(problems({ ...good(), "docs/tour.md": `${good()["docs/tour.md"]}![x](images/gone.png)\n\n*c*\n` })).toEqual([
      "docs/tour.md:4 missing-image docs/images/gone.png does not exist",
    ]);
  });

  it("fails orphan and malformed transcripts, and keeps an attempt only beside its image", () => {
    const bad = { ...transcript("other"), alt: undefined };
    expect(
      problems({
        ...good(),
        "docs/images/transcripts/other.json": JSON.stringify(bad),
        "docs/images/transcripts/shot-attempt1.json": "{}",
        "docs/images/transcripts/gone-attempt1.json": "{}",
      }),
    ).toEqual([
      "docs/images/transcripts/gone-attempt1.json:0 orphan-transcript an attempt of no image",
      "docs/images/transcripts/other.json:0 no-transcript lacks alt",
      "docs/images/transcripts/other.json:0 orphan-transcript no docs/images/other.png",
    ]);
  });

  it("ties each image to its transcript by the render manifest (release review m2)", () => {
    // an image edited after it was rendered
    expect(problems({ ...good(), "docs/images/shot.png": Buffer.from([1, 2, 4]) })).toEqual([
      "docs/images/shot.png:0 image-differs it is not the image render.mjs made from its transcript (docs/images/manifest.json)",
    ]);
    // a transcript re-captured without rendering its image again
    const recaptured = JSON.stringify({ ...transcript("shot"), capturedAt: "2026-11-17T00:00:00.000Z" });
    expect(problems({ ...good(), "docs/images/transcripts/shot.json": recaptured })).toEqual([
      "docs/images/shot.png:0 transcript-differs its transcript changed after it was rendered (docs/images/manifest.json)",
    ]);
    // no entry, an entry of no image, and no manifest at all
    expect(problems({ ...good(), "docs/images/manifest.json": "{}\n" })).toEqual([
      "docs/images/shot.png:0 unrecorded docs/images/manifest.json has no entry for it",
    ]);
    const extra = JSON.stringify({
      shot: { png: sha(SHOT_PNG), transcript: sha(SHOT_JSON) },
      gone: { png: "0".repeat(64), transcript: "0".repeat(64) },
    });
    expect(problems({ ...good(), "docs/images/manifest.json": extra })).toEqual([
      "docs/images/manifest.json:0 orphan-entry gone has no image",
    ]);
    const none = good();
    delete none["docs/images/manifest.json"];
    expect(problems(none)).toEqual([
      "docs/images/manifest.json:0 no-manifest missing or not valid JSON (render.mjs writes it)",
    ]);
  });

  it("fails a set at or over the byte budget", () => {
    const files = good();
    const big = Buffer.alloc(BUDGET_BYTES);
    files["docs/images/shot.png"] = big;
    files["docs/images/manifest.json"] = JSON.stringify({ shot: { png: sha(big), transcript: sha(SHOT_JSON) } });
    expect(problems(files)).toEqual([`docs/images:0 too-large ${BUDGET_BYTES} bytes of PNG, budget ${BUDGET_BYTES}`]);
  });

  it("reads an image in a code span as no image", () => {
    expect(imageRefs("`![a](images/x.png)`\n")).toEqual([]);
  });

  it("passes the repository's own images, each shown by the tour", () => {
    const r = checkImages({ root: ROOT });
    expect(r.problems).toEqual([]);
    expect(r.images).toBe(SCENARIOS.length);
    expect(r.bytes).toBeLessThan(BUDGET_BYTES);
    for (const id of Object.keys(r.uses)) expect(r.uses[id], id).toContain("docs/tour.md");
  });
});

describe("the transcripts and capture.mjs", () => {
  it("every stored transcript still meets what capture.mjs checks it against", () => {
    for (const sc of SCENARIOS) {
      const t = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "images", "transcripts", `${sc.id}.json`), "utf8"));
      expect([t.id, t.title, t.caption, t.alt], sc.id).toEqual([sc.id, sc.title, sc.caption, sc.alt]);
      expect(t.commands.map((c: { command: string }) => c.command)).toEqual(
        sc.commands.map((c) => c.cmd.replaceAll("$S", "$TMPDIR/crankpath-shots")),
      );
      sc.commands.forEach((c, i) => {
        expect(
          c.check({ exit: t.commands[i].exit, output: t.commands[i].output }),
          `${sc.id} command ${i + 1}`,
        ).toEqual([]);
      });
    }
  });

  it("would catch a transcript whose output is not the pinned output", () => {
    const sc = SCENARIOS.find((s) => s.id === "thin-slice-text");
    const t = JSON.parse(
      fs.readFileSync(path.join(ROOT, "docs", "images", "transcripts", "thin-slice-text.json"), "utf8"),
    );
    const forged = t.commands[0].output.replace("Run status: ANALYSED", "Run status: OK");
    expect(sc?.commands[0]?.check({ exit: 0, output: forged }).length).toBeGreaterThan(0);
    expect(sc?.commands[0]?.check({ exit: 1, output: t.commands[0].output }).length).toBeGreaterThan(0);
  });
});
