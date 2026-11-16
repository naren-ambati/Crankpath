#!/usr/bin/env node
// secret-grep: the release grep for credentials, personal paths and the owner's denylist (NFR2, NFR16,
// FR12.3, OD-28). Read-only: it reads the files git lists (tracked, and untracked but not ignored;
// never the design workspace check-tree excludes), the files of the package as `npm pack` builds it
// (packed into a private temporary directory and removed; nothing is published), the commit messages
// and author and committer names and addresses of HEAD's history, and the repository's local git
// config. Offline.
//
// Usage: node scripts/secret-grep.mjs [--release] [--no-pack]
//   --release  the denylist must have run: NOT RUN fails
//   --no-pack  skip the package (the tests use it on trees that are not packages)
//
// Rules (a finding prints `place: rule`, never the matched text in full, never a denylist term):
//   credential    a GitHub, npm, AWS, Slack or Google API token shape, a private key block, a JSON web
//                 token, a token in an Authorization header, or a value assigned to a
//                 CRANKPATH_TOKEN_<HOST> variable (everywhere)
//   e-mail        an e-mail address (in the package, and in Markdown outside test/): addresses at the
//                 reserved example domains, a hosting service's no-reply form, the commit trailer's
//                 no-reply address and the `git@<host>` SSH form are nobody's and are allowed
//   home-path, hostname, user-name
//                 check-tree's personal-path, machine-name and login-name rules, over the package
//                 (check-tree itself covers the tree)
//   denylist      a term of the owner's denylist, matched case-insensitively after folding (NFKC,
//                 format characters removed), in file contents, file names, commit messages, author
//                 and committer fields and the local git config
//
// The denylist (OD-28). Names the project must never contain are never written into the repository:
// they are read at run time from the file named by CRANKPATH_DENYLIST_FILE (one term per line; blank
// lines and lines starting `#` ignored). With the variable unset, the file missing or unreadable, or
// no term in it, the denylist check is NOT RUN, and the summary says so every time; it is never
// reported as passed, and with --release it fails. A denylist file inside the repository is itself a
// finding (the names would be in the tree). A denylist finding names the term's number and the entry
// (its number in the tree or the package listing, a commit id), never the term and never a path,
// which may hold the term; any other finding whose path holds a term shows the entry number instead.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { decodeText, isExcluded, listFiles, rules } from "./check-tree.mjs";

export const DENYLIST_VARIABLE = "CRANKPATH_DENYLIST_FILE";

export const CREDENTIAL_PATTERNS = Object.freeze([
  { name: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { name: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "private key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "JSON web token", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  {
    name: "token in an Authorization header",
    re: /\bauthorization["']?\s*[:=]\s*["']?(?:token|bearer|basic)\s+[A-Za-z0-9+/_.=-]{20,}/i,
  },
  // a value of 20 or more token characters holding both a letter and a digit (a placeholder such as
  // `planted-token-value`, words and hyphens only, is not a token shape; a real token without a digit is
  // a stated blind spot)
  {
    name: "assigned crankpath token",
    re: /\bCRANKPATH_TOKEN_[A-Z0-9_]+["']?\s*[:=]\s*["']?(?=[A-Za-z0-9_\-.]*[0-9])(?=[A-Za-z0-9_\-.]*[A-Za-z])[A-Za-z0-9_\-.]{20,}/,
  },
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** Addresses that are nobody's. */
export const ALLOWED_ADDRESSES = Object.freeze([
  /^[^@]+@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/i,
  /^[^@]+@[^@]+\.(?:invalid|example|test)$/i,
  /^[^@]+@users\.noreply\.github\.com$/i,
  /^noreply@anthropic\.com$/i,
  /^git@[^@]+$/i,
]);

/** Text folded as check-tree folds it, so a compatibility form or a format character cannot split a term. @param {string} s */
export function fold(s) {
  return s
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase();
}

/**
 * The denylist state: `{ state: "run", terms }` or `{ state: "not-run", why }`.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} root the repository root (a denylist inside it is refused)
 * @returns {{ state: "run", terms: string[], file: string } | { state: "not-run", why: string, inside?: boolean }}
 */
export function loadDenylist(env, root) {
  const file = env[DENYLIST_VARIABLE];
  if (file === undefined || file.trim() === "") return { state: "not-run", why: `${DENYLIST_VARIABLE} is unset` };
  const abs = path.resolve(file);
  let real = abs;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return { state: "not-run", why: `the file ${DENYLIST_VARIABLE} names does not exist` };
  }
  const rootReal = fs.realpathSync(root);
  if (real === rootReal || real.startsWith(`${rootReal}${path.sep}`))
    return { state: "not-run", why: `the file ${DENYLIST_VARIABLE} names is inside the repository`, inside: true };
  let text;
  try {
    const st = fs.statSync(real);
    if (!st.isFile()) return { state: "not-run", why: `the file ${DENYLIST_VARIABLE} names is not a regular file` };
    text = fs.readFileSync(real, "utf8");
  } catch {
    return { state: "not-run", why: `the file ${DENYLIST_VARIABLE} names cannot be read` };
  }
  const terms = text
    .split(/\r\n|\r|\n/)
    .map((l) => fold(l.trim()))
    .filter((l) => l !== "" && !l.startsWith("#"));
  if (terms.length === 0) return { state: "not-run", why: `the file ${DENYLIST_VARIABLE} names holds no term` };
  return { state: "run", terms, file: real };
}

/**
 * Findings in one text. `where` names the text (a file, a commit); lines are 1-based.
 * @param {string} where
 * @param {string} text
 * @param {{ emails: boolean, personal: import("./check-tree.mjs").Rule[], terms: string[] | null,
 *   denyWhere?: string, denyWhat?: string, denyWithheld?: boolean }} opts
 */
export function grepText(where, text, opts) {
  // A denylist finding names `opts.denyWhere` (an entry number, a commit id), never `where`: a path may
  // hold the term itself (review m1).
  /** @type {string[]} */
  const out = [];
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, i) => {
    const at = `${where}:${i + 1}`;
    for (const { name, re } of CREDENTIAL_PATTERNS) if (re.test(line)) out.push(`${at}: credential (${name})`);
    if (opts.emails)
      for (const m of line.matchAll(EMAIL))
        if (!ALLOWED_ADDRESSES.some((a) => a.test(m[0]))) out.push(`${at}: e-mail (an address that is someone's)`);
    if (opts.personal.length > 0) {
      const plain = line
        .normalize("NFKC")
        .replace(/\p{Cf}/gu, "")
        .replace(/<[^<>]{0,32}>/g, "");
      const hit = new Set(opts.personal.filter((r) => r.pattern.test(plain)).map((r) => r.rule));
      for (const rule of hit) out.push(`${at}: ${rule}`);
    }
    if (opts.terms !== null) {
      const f = fold(line);
      opts.terms.forEach((t, n) => {
        if (f.includes(t))
          out.push(
            `denylist term #${n + 1} found in ${opts.denyWhere ?? "a text"} (${opts.denyWhat ?? "its contents"}, line ${i + 1}${opts.denyWithheld === false ? "" : "; path withheld"})`,
          );
      });
    }
  });
  return out;
}

/** The files of a .tgz as npm writes it (ustar, with pax headers for long names). @param {Buffer} tgz */
export function tarEntries(tgz) {
  const tar = gunzipSync(tgz);
  /** @type {{ path: string, data: Buffer }[]} */
  const files = [];
  /** @type {string | null} */
  let paxPath = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (/** @type {number} */ from, /** @type {number} */ len) =>
      header
        .subarray(from, from + len)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    const body = tar.subarray(at + 512, at + 512 + size);
    const name = field(0, 100);
    const prefix = field(345, 155);
    if (type === "x") {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      paxPath = m ? (m[1] ?? null) : null;
    } else {
      if (type === "0") files.push({ path: paxPath ?? (prefix ? `${prefix}/${name}` : name), data: Buffer.from(body) });
      paxPath = null;
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Packs the package (no scripts, offline) into a private temporary directory; returns its entries. @param {string} root */
export function packEntries(root) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-pack-"));
  try {
    const out = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--offline", "--pack-destination", dest], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" },
    });
    const info = JSON.parse(out)[0];
    return tarEntries(fs.readFileSync(path.join(dest, info.filename)));
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

/** HEAD's commits as `{ sha, text }`, text = author, committer and message. @param {string} root */
export function commitTexts(root) {
  let out = "";
  try {
    out = execFileSync("git", ["-C", root, "log", "--format=%H%x00%an <%ae>%n%cn <%ce>%n%B%x1e"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  return out
    .split("\x1e")
    .map((c) => c.replace(/^\n/, ""))
    .filter((c) => c.includes("\0"))
    .map((c) => {
      const [sha, text] = c.split("\0");
      return { sha: (sha ?? "").slice(0, 12), text: text ?? "" };
    });
}

/** The repository's local git config. @param {string} root */
function localConfig(root) {
  try {
    return execFileSync("git", ["-C", root, "config", "--local", "--list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/**
 * Runs the grep.
 * @param {{ root: string, env?: NodeJS.ProcessEnv, release?: boolean, pack?: boolean, files?: string[],
 *   hostname?: string, userName?: string }} options
 */
export function secretGrep({
  root,
  env = process.env,
  release = false,
  pack = true,
  files,
  hostname = os.hostname(),
  userName = os.userInfo().username,
}) {
  const deny = loadDenylist(env, root);
  const terms = deny.state === "run" ? deny.terms : null;
  /** @type {string[]} */
  const findings = [];
  if (deny.state === "not-run" && deny.inside === true)
    findings.push(`${DENYLIST_VARIABLE}: denylist (the denylist file is inside the repository)`);
  const tree = (files ?? listFiles(root)).filter((f) => !isExcluded(f));
  /** A path as printed: withheld (by entry number) when it holds a denylist term. @param {string} kind @param {string} p @param {number} n */
  const shown = (kind, p, n) =>
    terms?.some((t) => fold(p).includes(t)) ? `${kind} entry ${n} (path withheld: it holds a denylist term)` : p;
  let treeRead = 0;
  for (const [idx, rel] of tree.entries()) {
    const entry = `tree entry ${idx + 1}`;
    if (terms !== null)
      findings.push(
        ...grepText(entry, rel, { emails: false, personal: [], terms, denyWhere: entry, denyWhat: "its path" }).map(
          (f) => f.replace(/, line 1;/, ";"),
        ),
      );
    let st;
    try {
      st = fs.lstatSync(path.join(root, rel));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const text = decodeText(fs.readFileSync(path.join(root, rel)));
    treeRead += 1;
    if (text === undefined) continue; // check-tree reports a file that is not text
    const emails = rel.endsWith(".md") && !rel.startsWith("test/");
    findings.push(...grepText(shown("tree", rel, idx + 1), text, { emails, personal: [], terms, denyWhere: entry }));
  }
  let packRead = 0;
  if (pack) {
    const personal = rules(hostname, userName);
    for (const e of packEntries(root)) {
      packRead += 1;
      const entry = `package entry ${packRead}`;
      const where = `package:${shown("package", e.path, packRead)}`;
      if (terms !== null)
        findings.push(
          ...grepText(entry, e.path, {
            emails: false,
            personal: [],
            terms,
            denyWhere: entry,
            denyWhat: "its path",
          }).map((f) => f.replace(/, line 1;/, ";")),
        );
      findings.push(...grepText(where, e.data.toString("utf8"), { emails: true, personal, terms, denyWhere: entry }));
    }
  }
  const commits = terms === null ? [] : commitTexts(root);
  for (const c of commits)
    findings.push(
      ...grepText(`commit ${c.sha}`, c.text, {
        emails: false,
        personal: [],
        terms,
        denyWhere: `commit ${c.sha}`,
        denyWhat: "its message or author fields",
        denyWithheld: false,
      }),
    );
  if (terms !== null)
    findings.push(
      ...grepText("git config", localConfig(root), {
        emails: false,
        personal: [],
        terms,
        denyWhere: "the local git config",
        denyWhat: "its entries",
        denyWithheld: false,
      }),
    );
  const denylist =
    deny.state === "run"
      ? `denylist: ${deny.terms.length} term(s) checked over files, names, ${commits.length} commit(s) and the git config`
      : `denylist: NOT RUN (${deny.why}; not a pass)`;
  const ok = findings.length === 0 && treeRead > 0 && (!release || deny.state === "run");
  const denylistDetail =
    deny.state === "run"
      ? `${deny.terms.length} term(s) checked over files, names, ${commits.length} commit(s) and the git config`
      : deny.why;
  return { ok, findings, treeRead, packRead, denylistRun: deny.state === "run", denylist, denylistDetail };
}

function main() {
  const args = process.argv.slice(2);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = secretGrep({ root, release: args.includes("--release"), pack: !args.includes("--no-pack") });
  for (const f of r.findings) console.log(`FAIL  ${f}`);
  console.log(r.denylist);
  console.log(
    `secret-grep: ${r.treeRead} files in the tree, ${r.packRead} files in the package, ${r.findings.length} finding(s)${args.includes("--release") && !r.denylistRun ? "; the release check fails while the denylist is NOT RUN" : ""}`,
  );
  process.exitCode = r.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
