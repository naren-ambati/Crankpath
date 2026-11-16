#!/usr/bin/env node
// check-tree: fails on text that must never be committed. It reads every git-tracked file and
// every untracked file that git does not ignore, except the design workspace folders (kept
// outside what ships), and reports one line per finding. Rules:
//   home-path      an absolute home path (macOS, Linux or Windows home directory with a user
//                  name) or a macOS per-user temporary folder
//   design-tool    the design tool's short name or folder name, any case, spelled with small
//                  separators (format characters and short tags are removed before matching)
//   start-file     the design tool's start file name
//   home-relative  a path from the home directory to a personal folder (`~/` or `$HOME/`
//                  followed by a capitalised folder name such as Documents or Desktop)
//   settings-folder a mention of the local settings folder (dot, then the assistant's name),
//                  allowed only in .gitignore, which must name it to keep it out
//   hostname       this machine's hostname, read at run time and never written down
//   user-name      this machine's login name, read at run time (service accounts excepted)
//   not-text       a file that is neither UTF-8 nor UTF-16 text, so it cannot be checked; the one
//                  exception is a screenshot under docs/images/ (`<id>.png`): a well-formed PNG with
//                  no text or metadata chunk is read as checked, because every word it shows is in
//                  its transcript, docs/images/transcripts/<id>.json, which is checked as text
//   image-metadata a docs/images/ PNG that carries a text or metadata chunk (tEXt, zTXt, iTXt,
//                  eXIf, tIME), which could hold a name or a path the image does not show
// File and folder names are checked with the same rules, and so is the target of a symlink.
// Later bolts add rules (the denylist and the secret grep); keep checkTree importable.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Top-level paths that are never read (the design workspace and its start file). */
// The design tool's folder name, spelled by character codes so this file passes its own rules.
const TOOL_FOLDER = String.fromCharCode(97, 105, 100, 108, 99);
export const EXCLUDED_PREFIXES = Object.freeze([`${TOOL_FOLDER}/`, `${TOOL_FOLDER}-inputs/`, `.${"claude"}/`]);
export const EXCLUDED_FILES = Object.freeze([`START${"-"}HERE.md`]);

/**
 * @typedef {{ rule: string, pattern: RegExp, except?: readonly string[] }} Rule
 * @typedef {{ file: string, line: number, rule: string }} Finding
 */

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The rules, with the hostname taken at run time.
 * @param {string} hostname
 * @returns {Rule[]}
 */
export function rules(hostname, userName = "") {
  /** @type {Rule[]} */
  const list = [
    {
      rule: "home-path",
      pattern: new RegExp(
        [
          `/${"Users"}/ ?[^\\s/'"\`)]+`,
          `%2F${"Users"}%2F`,
          // a home folder followed by a path segment, not one of the CI and container accounts
          `/${"home"}/(?!(?:${[...SERVICE_ACCOUNTS].join("|")})/)[A-Za-z0-9._-]+/[^\\s]`,
          `[A-Za-z]:\\\\{1,2}${"Users"}\\\\{1,2}[^\\s\\\\]+`,
          `/(private/)?${"var"}/folders/`,
        ].join("|"),
        "u",
      ),
    },
    {
      // the short name only (the spelled-out phrase is ordinary English); after NFKC and with tags
      // removed, at most one non-letter inside each part and up to three between the two parts, so
      // spelled variants are found and letters listed apart in code (`a, i, d`) are not
      rule: "design-tool",
      pattern: new RegExp(`(?<![\\p{L}\\p{N}])a${SEP1}i${SEP3}d${SEP1}l${SEP1}c(?![\\p{L}])`, "iu"),
    },
    { rule: "start-file", pattern: new RegExp(`START${"-"}HERE`) },
    { rule: "home-relative", pattern: /(?:(?<![\w~])~|\$HOME|\$\{HOME\})\/[A-Za-z0-9]/ },
    {
      rule: "settings-folder",
      pattern: new RegExp(`(?<![\\w.-])\\.${"claude"}(?![\\w.-])`, "i"),
      except: [".gitignore"],
    },
  ];
  // A login name of three characters or fewer (`ci`, `dev`, `git`) is an ordinary word and is not
  // checked (a stated choice); a longer one is matched as a whole word.
  const user = userName.trim();
  if (user.length > 3 && !SERVICE_ACCOUNTS.has(user.toLowerCase())) {
    list.push({
      rule: "user-name",
      pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(user)}(?![\\p{L}\\p{N}])`, "iu"),
    });
  }
  const names = new Set();
  const full = hostname.trim();
  if (full.length > 0 && full.toLowerCase() !== "localhost") {
    names.add(full);
    const short = full.replace(/\.local$/i, "");
    if (short.length > 0) names.add(short);
  }
  for (const name of names) list.push({ rule: "hostname", pattern: new RegExp(escapeRegExp(name), "i") });
  return list;
}

/** At most one, or at most three, characters that are not letters or digits. */
const SEP1 = "[^\\p{L}\\p{N}]?";
const SEP3 = "[^\\p{L}\\p{N}]{0,3}";

/** This machine's login name, or "" when the process has none (a container's arbitrary uid). */
function loginName() {
  try {
    return os.userInfo().username;
  } catch {
    return "";
  }
}

/** Login names of CI and container images, which are not anyone's name. */
const SERVICE_ACCOUNTS = new Set([
  "root",
  "runner",
  "node",
  "ubuntu",
  "vscode",
  "codespace",
  "admin",
  "user",
  "ci",
  "build",
  "builder",
  "jenkins",
  "circleci",
  "gitlab-runner",
  "vagrant",
]);

/**
 * The text of a file: UTF-8, or UTF-16 with a byte-order mark; undefined when it is neither
 * (a NUL byte without a UTF-16 mark), which is a `not-text` finding.
 * @param {Buffer} buf
 * @returns {string | undefined}
 */
export function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  if (buf.includes(0)) return undefined;
  return buf.toString("utf8");
}

/**
 * @param {string} text
 * @param {Rule[]} active
 * @param {string} rel the file the text comes from (a rule may allow one file)
 * @returns {string[]} the rules the text breaks
 */
function matches(text, active, rel) {
  // compatibility forms are folded (NFKC: full-width letters, no-break spaces), format characters
  // (zero-width, bidi) removed and short markup tags dropped, so none of them can split a word
  const plain = text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/<[^<>]{0,32}>/g, "");
  return active.filter(({ pattern, except }) => !except?.includes(rel) && pattern.test(plain)).map(({ rule }) => rule);
}

/**
 * @param {string} rel
 * @returns {boolean}
 */
export function isExcluded(rel) {
  return EXCLUDED_FILES.includes(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p));
}

/**
 * Files git tracks plus untracked files it does not ignore, relative to `root`.
 * @param {string} root
 * @returns {string[]}
 */
export function listFiles(root) {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(out.split("\0").filter((s) => s.length > 0))].sort();
}

/**
 * Scans the files and returns the findings and how many files were read.
 * @param {{ root: string, hostname?: string, userName?: string, files?: string[] }} options
 * @returns {{ filesRead: number, findings: Finding[] }}
 */
export function checkTree({ root, hostname = os.hostname(), userName = loginName(), files }) {
  const all = files ?? listFiles(root);
  const active = rules(hostname, userName);
  /** @type {Finding[]} */
  const findings = [];
  let filesRead = 0;
  for (const rel of all) {
    if (isExcluded(rel)) continue;
    const full = path.join(root, rel);
    for (const rule of matches(rel, active, rel)) findings.push({ file: rel, line: 0, rule });
    let st;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue; // listed by git but deleted in the working tree
    }
    if (st.isSymbolicLink()) {
      filesRead += 1;
      for (const rule of matches(fs.readlinkSync(full), active, rel)) findings.push({ file: rel, line: 0, rule });
      continue;
    }
    if (!st.isFile()) continue;
    const buf = fs.readFileSync(full);
    const text = decodeText(buf);
    filesRead += 1;
    if (text === undefined && isScreenshot(rel)) {
      const chunks = pngChunks(buf);
      if (chunks === undefined) findings.push({ file: rel, line: 0, rule: "not-text" });
      else if (chunks.some((c) => PNG_METADATA.includes(c)))
        findings.push({ file: rel, line: 0, rule: "image-metadata" });
      continue;
    }
    if (text === undefined) {
      findings.push({ file: rel, line: 0, rule: "not-text" });
      continue;
    }
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const rule of matches(lines[i] ?? "", active, rel)) findings.push({ file: rel, line: i + 1, rule });
    }
  }
  return { filesRead, findings };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_METADATA = Object.freeze(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

/**
 * The chunk types of a well-formed PNG, or undefined when the bytes are not one (a bad signature,
 * a chunk running past the end, no IEND last).
 * @param {Buffer} buf
 * @returns {string[] | undefined}
 */
export function pngChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  const types = [];
  let at = 8;
  while (at + 12 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.subarray(at + 4, at + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type) || at + 12 + len > buf.length) return undefined;
    types.push(type);
    at += 12 + len;
    if (type === "IEND") return at === buf.length ? types : undefined;
  }
  return undefined;
}

/** Whether a path is a screenshot of docs/images (the not-text exception above). @param {string} rel */
export function isScreenshot(rel) {
  return /^docs\/images\/[a-z0-9-]+\.png$/.test(rel);
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { filesRead, findings } = checkTree({ root });
  for (const f of findings) console.log(`${f.file}:${f.line === 0 ? "name" : f.line}: ${f.rule}`);
  console.log(`check-tree: ${filesRead} files read, ${findings.length} finding(s)`);
  process.exitCode = findings.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
