// SafeText: the one choke point for text taken from the scanned repo (BR1.4, BR1.5, BR1.6, BR1.11).
// Repo text is always placed in double quotes after a fixed label, so it never starts a line and
// never reads as crankpath's own voice. Quote and backslash are escaped; control characters,
// bidi and other format characters, separators and lone surrogates are shown as visible codes
// (`\x1b`, `‮`, `\u{e0001}`); text over the length limit is cut on a code-point boundary
// with a stated marker. Pure: no I/O, no clock, no environment. URLs: see redactUrl for exactly
// what is removed and what is not.
// Two known trade-offs: unassigned code points (\p{Cn}) follow the running Node's Unicode tables,
// so a character assigned in a newer Unicode version prints literally there and as a code on an
// older Node; and every combining mark (\p{Mn}) is shown as a code, which keeps stacked marks from
// overprinting but makes quoted Thai, Devanagari or decomposed accents hard to read.

import { LIMITS } from "./limits.js";

export type Destination = "terminal" | "mermaid";

/** crankpath's fixed wording for a URL it could not parse; it is never followed by the input. */
export const UNPARSEABLE_URL = "unparseable URL";

// A fixed label is crankpath's own text: printable ASCII, no quote or backslash, starting with a
// letter. A call without one is a bug.
const LABEL = /^[A-Za-z][\x20-\x21\x23-\x5b\x5d-\x7e]*$/;

function checkLabel(label: string): void {
  if (!LABEL.test(label)) throw new Error("SafeText: a fixed label is required (a bug)");
}

// Characters shown as codes besides C0, DEL and C1: format (bidi controls, zero-width, tags),
// line and paragraph separators, space separators other than U+0020, private use.
// Also combining marks (they stack over other characters), unassigned code points and
// noncharacters, and the blank letters that render as nothing (Hangul fillers, Braille blank).
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}\p{Zs}\p{Co}\p{Mn}\p{Me}\p{Cn}\u115f\u1160\u3164\uffa0\u2800]/u;

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0");
}

function codeFor(cp: number): string {
  if (cp < 0x100) return `\\x${hex(cp, 2)}`;
  if (cp <= 0xffff) return `\\u${hex(cp, 4)}`;
  return `\\u{${hex(cp, 1)}}`;
}

function visibleCodePoint(cp: number, ch: string): string {
  if (cp === 0x22) return '\\"';
  if (cp === 0x5c) return "\\\\";
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return codeFor(cp);
  if (cp === 0x20) return ch;
  if (cp >= 0xd800 && cp <= 0xdfff) return codeFor(cp); // a lone surrogate
  if (INVISIBLE.test(ch)) return codeFor(cp);
  return ch;
}

interface Cut {
  readonly escaped: string;
  /** Total code points of the raw text when it was cut; undefined when it was not cut. */
  readonly total: number | undefined;
}

/** One linear pass: escape at most `maxChars` code points, then count the rest only if cut. */
function escapeBounded(raw: string, maxChars: number): Cut {
  const out: string[] = [];
  let count = 0;
  let i = 0;
  while (i < raw.length && count < maxChars) {
    const unit = raw.charCodeAt(i);
    let cp = unit;
    let width = 1;
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < raw.length) {
      const next = raw.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = (unit - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        width = 2;
      }
    }
    out.push(visibleCodePoint(cp, raw.slice(i, i + width)));
    i += width;
    count += 1;
  }
  if (i >= raw.length) return { escaped: out.join(""), total: undefined };
  let total = count;
  while (i < raw.length) {
    const unit = raw.charCodeAt(i);
    const pair = unit >= 0xd800 && unit <= 0xdbff && i + 1 < raw.length && (raw.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
    i += pair ? 2 : 1;
    total += 1;
  }
  return { escaped: out.join(""), total };
}

function cutMarker(maxChars: number, total: number): string {
  return `... (cut at ${maxChars} of ${total} characters)`;
}

// Mermaid label syntax and HTML: every character that could end a quoted label, open a markdown
// string, start an entity or be read as markup becomes a Mermaid entity code `#<decimal>;`.
const MERMAID_SPECIAL = new Set([
  '"',
  "#",
  "&",
  "<",
  ">",
  "`",
  "[",
  "]",
  "{",
  "}",
  "(",
  ")",
  "|",
  ";",
  "'",
  "%",
  "=",
  "$",
]);

function mermaidEntities(text: string): string {
  let out = "";
  for (const ch of text) out += MERMAID_SPECIAL.has(ch) ? `#${ch.codePointAt(0)};` : ch;
  return out;
}

function checkMax(maxChars: number): void {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("SafeText: maxChars must be a positive integer");
}

/**
 * Repo text for a terminal or Mermaid label: `LABEL "escaped"` (terminal) or a complete quoted
 * Mermaid label `"LABEL #34;escaped#34;"`. The label is crankpath's fixed text.
 */
export function quote(
  label: string,
  raw: string,
  destination: Destination,
  maxChars: number = LIMITS.quotedTextChars.value,
): string {
  checkLabel(label);
  checkMax(maxChars);
  const { escaped, total } = escapeBounded(raw, maxChars);
  const marker = total === undefined ? "" : cutMarker(maxChars, total);
  if (destination === "terminal") return `${label} "${escaped}"${marker}`;
  return `"${mermaidEntities(`${label} "${escaped}"${marker}`)}"`;
}

/**
 * Repo text as a JSON string value (the caller's JSON.stringify adds the JSON quoting): the same
 * visible codes and cut marker as the terminal form, so a reader of the JSON sees what a reader
 * of the text report sees.
 */
export function jsonText(raw: string, maxChars: number = LIMITS.quotedTextChars.value): string {
  checkMax(maxChars);
  const { escaped, total } = escapeBounded(raw, maxChars);
  return total === undefined ? escaped : `${escaped}${cutMarker(maxChars, total)}`;
}

// Any control, format or separator character makes a URL unparseable for printing: the WHATWG
// parser silently drops tabs and newlines and trims spaces, which would hide what the input held.
const URL_REFUSED = /[\p{Cc}\p{Cf}\p{Z}]/u;
// scp-style Git address: [user@]host:path, where the path does not start with `//`.
const SCP = /^(?:[^@/]+@)?([^@/:[\]]+):(?!\/\/)(.*)$/s;

// A URL with a real authority starts with its scheme and `//`; anywhere else `://` proves nothing.
const SCHEME_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\//i;
// A scheme followed by one or two slashes: the start of an embedded URL in any common spelling.
const EMBEDDED_SCHEME = /[a-z][a-z0-9+.-]*:\//i;
// Query and fragment parameter names that carry credentials: a name whose words (split on
// anything that is not a letter or digit) include one of these has its value redacted.
const CREDENTIAL_WORDS = new Set([
  "token",
  "password",
  "passwd",
  "pwd",
  "secret",
  "key",
  "apikey",
  "sig",
  "signature",
  "auth",
  "authorization",
  "credential",
  "credentials",
]);
export const REDACTED = "<redacted>";

/** `%XX` escapes decoded byte by byte and backslashes read as slashes, for the embedded-URL check. */
function loosen(text: string): string {
  return text
    .replace(/%([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\/g, "/");
}

/**
 * Does the part after the authority hide a URL with userinfo? Any `@` after a `//`, or after a
 * `scheme:/`, in the text with its percent escapes decoded and backslashes read as slashes.
 */
function hidesUserinfo(rest: string): boolean {
  for (const text of [rest, loosen(rest), loosen(loosen(rest))]) {
    const at = text.lastIndexOf("@");
    if (at < 0) continue;
    const before = text.slice(0, at);
    if (before.includes("//") || EMBEDDED_SCHEME.test(before)) return true;
  }
  return false;
}

/** Redacts the value of each `name=value` parameter whose name reads as a credential. */
function redactParams(part: string): string {
  return part
    .split("&")
    .map((param) => {
      const eq = param.indexOf("=");
      if (eq < 0) return param;
      const words = loosen(param.slice(0, eq))
        .toLowerCase()
        .split(/[^a-z0-9]+/);
      return words.some((w) => CREDENTIAL_WORDS.has(w)) ? `${param.slice(0, eq + 1)}${REDACTED}` : param;
    })
    .join("&");
}

/** Redacts credential-named values in the query and in the fragment. */
function redactQuery(url: string): string {
  const hash = url.indexOf("#");
  const beforeHash = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? undefined : url.slice(hash + 1);
  const q = beforeHash.indexOf("?");
  const base = q < 0 ? beforeHash : `${beforeHash.slice(0, q + 1)}${redactParams(beforeHash.slice(q + 1))}`;
  return fragment === undefined ? base : `${base}#${redactParams(fragment)}`;
}

/**
 * The URL with its credentials removed, or undefined (printed `unparseable URL`) when it does not
 * parse cleanly.
 *
 * Removed or refused: the userinfo of a `scheme://` URL (the URL parser reads the authority); the
 * user of an scp-style address (`[user@]host:path`); every other string with an `@` before its
 * first `/`, `?` or `#` (unparseable); every string whose part after the authority holds an `@`
 * after a `//` or a `scheme:/`, in any spelling (one or two slashes, backslashes, percent
 * escapes): a URL hidden in a query, fragment or path is unparseable; and the value of every query
 * or fragment parameter whose name reads as a credential (its words include token, password,
 * passwd, pwd, secret, key, apikey, sig, signature, auth, authorization, credential or
 * credentials), printed `<redacted>`.
 *
 * Not removed: credentials in a parameter with another name, in the path, or in a value that is
 * not a URL with userinfo; anything crankpath cannot recognise as a credential by its form.
 */
export function redactUrl(raw: string): string | undefined {
  if (raw.length === 0 || URL_REFUSED.test(raw)) return undefined;
  let out: string | undefined;
  if (SCHEME_AUTHORITY.test(raw)) {
    try {
      const url = new URL(raw);
      url.username = "";
      url.password = "";
      out = url.href;
    } catch {
      return undefined;
    }
  } else {
    const end = raw.search(/[/?#]/);
    const head = end < 0 ? raw : raw.slice(0, end);
    const scp = SCP.exec(raw);
    if (scp !== null) {
      const host = scp[1] ?? "";
      const rest = scp[2] ?? "";
      const at = raw.indexOf("@");
      const restHead = rest.split(/[/?#]/)[0] ?? "";
      // the only `@` allowed is the one ending the user part, before the host
      if (at >= 0 && !(at < raw.indexOf(host) && !restHead.includes("@"))) return undefined;
      out = `${host}:${rest}`;
    } else if (head.includes("@")) {
      return undefined;
    } else {
      try {
        out = new URL(raw).href;
      } catch {
        return undefined;
      }
    }
  }
  const rest = out.slice(out.indexOf(":") + 1).replace(/^\/\/[^/?#]*/, "");
  return hidesUserinfo(rest) ? undefined : redactQuery(out);
}

/** A URL from any source, userinfo removed first, then quoted; `LABEL unparseable URL` otherwise. */
export function quoteUrl(
  label: string,
  raw: string,
  destination: Destination,
  maxChars: number = LIMITS.quotedTextChars.value,
): string {
  checkLabel(label);
  const redacted = redactUrl(raw);
  if (redacted === undefined) {
    return destination === "terminal"
      ? `${label} ${UNPARSEABLE_URL}`
      : `"${mermaidEntities(`${label} ${UNPARSEABLE_URL}`)}"`;
  }
  return quote(label, redacted, destination, maxChars);
}
