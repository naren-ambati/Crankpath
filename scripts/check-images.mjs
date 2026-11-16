#!/usr/bin/env node
// check-images: the screenshots under docs/images (docs/images/README.md) against the docs that use
// them. Read-only and offline; one of the release checks (scripts/release-checks.mjs).
//
// Usage: node scripts/check-images.mjs
//
// Rules (each problem prints `file:line rule message`; any problem exits 1):
//   missing-image    a Markdown image whose target under docs/images/ does not exist
//   no-alt           an image of docs/images/ with empty alt text
//   alt-differs      alt text that is not the transcript's `alt` (one alt text per image, written
//                    when it was captured)
//   no-caption       an image whose next non-blank line is not a one-line italic caption (`*...*`)
//   no-transcript    a PNG without docs/images/transcripts/<id>.json, or a transcript whose `id` is
//                    not its file name or that lacks a field capture.mjs writes
//   orphan-transcript a transcript without its PNG, or an attempt (`<id>-attemptN.json`) of no image
//   unused-image     a PNG no Markdown file outside docs/images/ shows
//   undocumented     a PNG docs/images/README.md does not name (it says how each one was made)
//   too-large        all PNGs together at or over 3,000,000 bytes (the release round's budget)
//   no-manifest      docs/images/manifest.json is missing or not valid JSON while any PNG exists
//   unrecorded       a PNG the manifest has no entry for
//   image-differs    a PNG whose SHA-256 is not the one render.mjs recorded when it made it from its
//                    transcript (an image edited, or replaced, after it was rendered)
//   transcript-differs a transcript whose SHA-256 is not the one its image was rendered from (a
//                    re-capture whose image was not rendered again)
//   orphan-entry     a manifest entry of no image
// The manifest ties each image to its transcript (release review m2): render.mjs writes, per image,
// the SHA-256 of the PNG it wrote and of the transcript it rendered.
//
// The docs check (check-docs.mjs) already fails a broken link; this check adds what an image needs.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linkTargets, resolveLink } from "./check-docs.mjs";
import { isExcluded, listFiles } from "./check-tree.mjs";

export const IMAGES_DIR = "docs/images";
export const IMAGES_README = "docs/images/README.md";
export const BUDGET_BYTES = 3_000_000;
export const MANIFEST = "docs/images/manifest.json";

/** The SHA-256 of a file, in hex. */
const sha256 = (/** @type {string} */ file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * The manifest entry of one image, as render.mjs records it after writing the PNG.
 * @param {string} dir the folder holding `<id>.png` and `transcripts/<id>.json`
 * @param {string} id
 */
export function manifestEntry(dir, id) {
  return { png: sha256(path.join(dir, `${id}.png`)), transcript: sha256(path.join(dir, "transcripts", `${id}.json`)) };
}
const TRANSCRIPT_FIELDS = Object.freeze(["id", "title", "caption", "alt", "version", "capturedAt", "load", "commands"]);
const COMMAND_FIELDS = Object.freeze(["command", "exit", "seconds", "output"]);

/**
 * The image references of one Markdown text: line, alt text, target and the caption line after it.
 * @param {string} text
 */
export function imageRefs(text) {
  const lines = text.split("\n");
  const linkLines = new Set(linkTargets(text).map((l) => l.line));
  /** @type {{ line: number, alt: string, target: string, caption: string }[]} */
  const out = [];
  lines.forEach((raw, i) => {
    if (!linkLines.has(i + 1)) return;
    for (const m of raw.replace(/`[^`]*`/g, "").matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      let c = i + 1;
      while (c < lines.length && (lines[c] ?? "").trim() === "") c++;
      out.push({ line: i + 1, alt: m[1] ?? "", target: m[2] ?? "", caption: lines[c] ?? "" });
    }
  });
  return out;
}

/**
 * Runs the check over a repository root.
 * @param {{ root: string, files?: string[] }} options
 * @returns {{ problems: string[], images: number, bytes: number, uses: Record<string, string[]> }}
 */
export function checkImages({ root, files }) {
  const listed = (files ?? listFiles(root)).filter((f) => !isExcluded(f));
  const pngs = listed.filter((f) => /^docs\/images\/[^/]+\.png$/.test(f) && fs.existsSync(path.join(root, f)));
  const transcripts = listed.filter(
    (f) => /^docs\/images\/transcripts\/[^/]+\.json$/.test(f) && fs.existsSync(path.join(root, f)),
  );
  const problems = [];
  /** @type {Record<string, string[]>} */
  const uses = {};
  /** @type {Map<string, any>} */
  const byId = new Map();

  const ids = new Set(pngs.map((f) => path.posix.basename(f, ".png")));
  for (const f of transcripts) {
    const name = path.posix.basename(f, ".json");
    const attempt = /^(.*)-attempt\d+$/.exec(name);
    if (attempt !== null) {
      if (!ids.has(attempt[1] ?? "")) problems.push(`${f}:0 orphan-transcript an attempt of no image`);
      continue;
    }
    let t;
    try {
      t = JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
    } catch {
      problems.push(`${f}:0 no-transcript not valid JSON`);
      continue;
    }
    const missing = TRANSCRIPT_FIELDS.filter((k) => t[k] === undefined);
    if (t.id !== name) problems.push(`${f}:0 no-transcript its id is not ${JSON.stringify(name)}`);
    if (missing.length > 0) problems.push(`${f}:0 no-transcript lacks ${missing.join(", ")}`);
    if (
      !Array.isArray(t.commands) ||
      t.commands.length === 0 ||
      t.commands.some((/** @type {any} */ c) => COMMAND_FIELDS.some((k) => c?.[k] === undefined))
    )
      problems.push(`${f}:0 no-transcript a command lacks ${COMMAND_FIELDS.join(", ")}`);
    byId.set(name, t);
    if (!ids.has(name)) problems.push(`${f}:0 orphan-transcript no ${IMAGES_DIR}/${name}.png`);
  }
  for (const id of [...ids].sort()) {
    uses[id] = [];
    if (!byId.has(id)) problems.push(`${IMAGES_DIR}/${id}.png:0 no-transcript no transcripts/${id}.json`);
  }

  for (const md of listed.filter((f) => f.endsWith(".md") && fs.existsSync(path.join(root, f)))) {
    const text = fs.readFileSync(path.join(root, md), "utf8");
    for (const ref of imageRefs(text)) {
      const r = resolveLink(md, ref.target);
      if (!("rel" in r) || !/^docs\/images\/[^/]+\.png$/.test(r.rel)) continue;
      const id = path.posix.basename(r.rel, ".png");
      const where = `${md}:${ref.line}`;
      if (!ids.has(id)) {
        problems.push(`${where} missing-image ${r.rel} does not exist`);
        continue;
      }
      if (!md.startsWith(`${IMAGES_DIR}/`)) uses[id]?.push(md);
      if (ref.alt.trim() === "") problems.push(`${where} no-alt ${r.rel} has no alt text`);
      else if (byId.has(id) && ref.alt !== byId.get(id).alt)
        problems.push(`${where} alt-differs the alt text of ${r.rel} is not its transcript's`);
      if (!/^\s*\*[^*\s][^*]*\*\s*(?:<!--.*-->\s*)?$/.test(ref.caption))
        problems.push(`${where} no-caption ${r.rel} is not followed by an italic caption line`);
    }
  }
  const readme = fs.existsSync(path.join(root, IMAGES_README))
    ? fs.readFileSync(path.join(root, IMAGES_README), "utf8")
    : "";
  for (const id of [...ids].sort()) {
    if ((uses[id] ?? []).length === 0) problems.push(`${IMAGES_DIR}/${id}.png:0 unused-image no doc shows it`);
    if (!readme.includes(`\`${id}\``))
      problems.push(`${IMAGES_DIR}/${id}.png:0 undocumented ${IMAGES_README} does not name it`);
  }
  /** @type {Record<string, { png?: unknown, transcript?: unknown }> | null} */
  let manifest = null;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), "utf8"));
    if (m !== null && typeof m === "object" && !Array.isArray(m)) manifest = m;
  } catch {
    manifest = null;
  }
  if (manifest === null) {
    if (ids.size > 0) problems.push(`${MANIFEST}:0 no-manifest missing or not valid JSON (render.mjs writes it)`);
  } else {
    for (const id of [...ids].sort()) {
      const e = manifest[id];
      const where = `${IMAGES_DIR}/${id}.png:0`;
      if (e === undefined) {
        problems.push(`${where} unrecorded ${MANIFEST} has no entry for it`);
        continue;
      }
      const now = byId.has(id) ? manifestEntry(path.join(root, IMAGES_DIR), id) : null;
      if (now === null) continue; // no-transcript is reported above
      if (e.png !== now.png)
        problems.push(`${where} image-differs it is not the image render.mjs made from its transcript (${MANIFEST})`);
      if (e.transcript !== now.transcript)
        problems.push(`${where} transcript-differs its transcript changed after it was rendered (${MANIFEST})`);
    }
    for (const id of Object.keys(manifest).sort())
      if (!ids.has(id)) problems.push(`${MANIFEST}:0 orphan-entry ${id} has no image`);
  }
  const bytes = pngs.reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0);
  if (bytes >= BUDGET_BYTES) problems.push(`${IMAGES_DIR}:0 too-large ${bytes} bytes of PNG, budget ${BUDGET_BYTES}`);
  for (const id of Object.keys(uses)) uses[id] = [...new Set(uses[id])].sort();
  return { problems, images: pngs.length, bytes, uses };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = checkImages({ root });
  for (const p of r.problems) console.log(p);
  console.log(`check-images: ${r.images} images, ${r.bytes} bytes, ${r.problems.length} problem(s)`);
  process.exitCode = r.problems.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
