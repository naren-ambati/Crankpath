import { describe, expect, it } from "vitest";
import { jsonText, quote, quoteUrl, redactUrl, UNPARSEABLE_URL } from "../../src/u1-graph-model/safe-text.js";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

// A seeded, hand-written hostile-string generator (no dependency): mixes quotes, backslashes,
// newlines, carriage returns, ANSI escapes, bidi overrides, zero-width characters, Mermaid and
// JSON breakers, lone surrogates and astral characters.
const PIECES = [
  '"',
  "\\",
  "\n",
  "\r",
  "\x1b[31m",
  "\x1b]8;;http://x\x07",
  "‮",
  "⁦",
  "​",
  "﻿",
  " ",
  " ",
  "\x00",
  "\x7f",
  "\x85",
  '"]; click x call alert(1)',
  "<script>",
  "`md`",
  "#quot;",
  "|",
  "}",
  "\ud800",
  "\udfff",
  "\u{1f600}",
  "\u{e0041}",
  "plain",
  " ",
];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function hostile(seed: number, n: number): string {
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < n; i++) out += PIECES[Math.floor(r() * PIECES.length)];
  return out;
}

// What must never appear inside quoted output: raw controls (C0, DEL, C1), bidi/format characters,
// line/paragraph separators, non-ASCII spaces and lone surrogates.
const RAW_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}   -   　]|\p{Cs}/u;

// The whole terminal form: the label, one quoted string whose quotes and backslashes are escaped,
// then at most the cut marker. A raw quote inside would end the string early and fail the match.
const TERMINAL_FORM = /^name "(?:[^"\\]|\\.)*"(?:\.\.\. \(cut at \d+ of \d+ characters\))?$/su;

describe("SafeText quote, terminal destination (BR1.4, BR1.5)", () => {
  it("puts repo text in double quotes after the fixed label, escaping quote and backslash", () => {
    expect(quote("name", 'a"b\\c', "terminal")).toBe('name "a\\"b\\\\c"');
  });

  it("shows control characters, terminal escapes, bidi and zero-width characters as visible codes", () => {
    expect(quote("name", "a\x1b[31mb\nc\rd‮e​f\x7fg\x85h", "terminal")).toBe(
      'name "a\\x1b[31mb\\x0ac\\x0dd\\u202ee\\u200bf\\x7fg\\x85h"',
    );
  });

  it("shows lone surrogates and astral format characters as codes, keeps astral letters", () => {
    expect(quote("name", "\ud800x\udfff\u{e0041}\u{1f600}", "terminal")).toBe(
      'name "\\ud800x\\udfff\\u{e0041}\u{1f600}"',
    );
  });

  it("never starts a line with repo text: newlines inside become codes, so the output is one line", () => {
    const out = quote("name", "x\nERROR: forged line\n", "terminal");
    expect(out.split("\n")).toHaveLength(1);
    expect(out.startsWith("name ")).toBe(true);
  });

  it("cuts long text on a code-point boundary and states the cut", () => {
    const out = quote("name", "\u{1f600}".repeat(10), "terminal", 3);
    expect(out).toBe('name "\u{1f600}\u{1f600}\u{1f600}"... (cut at 3 of 10 characters)');
    expect(quote("name", "abc", "terminal", 3)).toBe('name "abc"');
    expect(quote("name", "abcd", "terminal", 3)).toBe('name "abc"... (cut at 3 of 4 characters)');
  });

  it("uses the derived default length (the longest canonical node id, 381) and never cuts a valid id", () => {
    const id = `${"K".repeat(63)}/${"n".repeat(63)}/${"a".repeat(253)}`;
    expect(quote("node", id, "terminal")).toBe(`node "${id}"`);
    expect(quote("node", `${id}x`, "terminal")).toContain("(cut at 381 of 382 characters)");
  });

  it("refuses a call without a fixed label (a bug, not input)", () => {
    expect(() => quote("", "x", "terminal")).toThrow(/fixed label/);
    expect(() => quote('la"bel', "x", "terminal")).toThrow(/fixed label/);
    expect(() => quote("label\n", "x", "terminal")).toThrow(/fixed label/);
    expect(() => quote(" label", "x", "terminal")).toThrow(/fixed label/);
    expect(() => quote("name", "x", "terminal", 0)).toThrow(/maxChars/);
  });

  it("is total over hostile strings: one line, label first, no raw invisible character, quote closed", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const raw = hostile(seed, 1 + (seed % 40));
      const out = quote("name", raw, "terminal");
      expect(out.startsWith('name "')).toBe(true);
      expect(RAW_INVISIBLE.test(out)).toBe(false);
      expect(out.includes("\n") || out.includes("\r")).toBe(false);
      expect(TERMINAL_FORM.test(out)).toBe(true);
    }
  });

  it("handles a 10 MB string in one pass and cuts it", () => {
    const big = "a".repeat(10 * 1024 * 1024);
    const t0 = cpuStart();
    const out = quote("name", big, "terminal");
    expect(out.endsWith(`... (cut at 381 of ${big.length} characters)`)).toBe(true);
    expect(cpuSince(t0)).toBeLessThan(5000);
  });
});

describe("SafeText: characters that hide or stack text (review m8)", () => {
  it.each([
    ["Hangul filler", "\u3164", "\\u3164"],
    ["Hangul choseong filler", "\u115f", "\\u115f"],
    ["Hangul jungseong filler", "\u1160", "\\u1160"],
    ["halfwidth Hangul filler", "\uffa0", "\\uffa0"],
    ["Braille blank", "\u2800", "\\u2800"],
    ["combining mark", "e\u0301", "e\\u0301"],
    ["enclosing mark", "a\u20dd", "a\\u20dd"],
    ["noncharacter", "\ufffe", "\\ufffe"],
    ["private use", "\ue000", "\\ue000"],
    ["private use, astral", "\u{f0000}", "\\u{f0000}"],
  ])("%s is shown as a code", (_name, raw, code) => {
    expect(quote("name", raw, "terminal")).toBe(`name "${code}"`);
  });

  it("a run of stacked combining marks cannot overprint the label or the quotes", () => {
    const out = quote("name", `x${"\u0336".repeat(50)}`, "terminal");
    expect(/\p{M}/u.test(out)).toBe(false);
  });

  it("escapes $ for Mermaid, whose labels render KaTeX between $$", () => {
    expect(quote("name", "$$x$$", "mermaid")).not.toContain("$");
  });
});

describe("SafeText quote, Mermaid destination (BR1.6)", () => {
  it("cannot end the label or add a directive", () => {
    const out = quote("name", '"]; click x call alert("x") %%{init}%% <b>`md`</b> |x| #quot; ;', "mermaid");
    expect(out.startsWith('"name ')).toBe(true);
    expect(out.endsWith('"')).toBe(true);
    // crankpath's own entity codes removed, nothing that Mermaid reads as syntax is left
    const inner = out.slice(1, -1).replace(/#\d+;/g, "");
    for (const ch of ['"', "]", "[", "|", "`", "<", ">", "(", ")", "{", "}", ";", "%"]) {
      expect(inner.includes(ch), `raw ${ch} inside the label`).toBe(false);
    }
    expect(inner.includes("#")).toBe(false);
  });

  it("writes each of the 18 Mermaid and HTML syntax characters as its own entity code (B6 review m2)", () => {
    // every one, so dropping any from the escape set fails here; `&` matters for HTML labels, where
    // a raw `&quot;` or `&#60;` could display as another character than the repo wrote
    const specials = ['"', "#", "&", "<", ">", "`", "[", "]", "{", "}", "(", ")", "|", ";", "'", "%", "=", "$"];
    for (const ch of specials) {
      const code = `#${ch.codePointAt(0)};`;
      const out = quote("name", `a${ch}b`, "mermaid");
      // the terminal form escapes the quote with a backslash first
      expect(out, ch).toBe(ch === '"' ? `"name #34;a\\${code}b#34;"` : `"name #34;a${code}b#34;"`);
    }
    expect(quote("name", "&lt;b&gt; x=1 'q'", "mermaid")).toBe('"name #34;#38;lt#59;b#38;gt#59; x#61;1 #39;q#39;#34;"');
  });

  it("keeps newlines as visible codes inside the label", () => {
    const out = quote("name", "a\nb", "mermaid");
    expect(out.includes("\n")).toBe(false);
    expect(out).toContain("\\x0a");
  });

  it("is total over hostile strings", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const out = quote("name", hostile(seed, 30), "mermaid");
      const inner = out.slice(1, -1);
      expect(inner.includes('"')).toBe(false);
      expect(RAW_INVISIBLE.test(out)).toBe(false);
    }
  });
});

describe("SafeText jsonText (BR1.6)", () => {
  it("gives a value that JSON.stringify keeps on one line with visible codes", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const raw = hostile(seed, 20);
      const json = JSON.stringify({ v: jsonText(raw) });
      expect(json.includes("\n")).toBe(false);
      const back = JSON.parse(json) as { v: string };
      expect(RAW_INVISIBLE.test(back.v)).toBe(false);
    }
  });

  it("cuts with the same marker", () => {
    expect(jsonText("abcd", 2)).toBe("ab... (cut at 2 of 4 characters)");
    expect(jsonText("a\x00")).toBe("a\\x00");
    expect(() => jsonText("a", -1)).toThrow(/maxChars/);
  });
});

describe("SafeText URLs (BR1.11)", () => {
  it.each([
    ["https://user:token@github.com/a/b.git", "https://github.com/a/b.git"],
    ["https://token@github.com/a/b", "https://github.com/a/b"],
    ["ssh://git@github.com/a/b.git", "ssh://github.com/a/b.git"],
    ["git@github.com:a/b.git", "github.com:a/b.git"],
    ["user:pass@example.org:repo", "example.org:repo"],
    ["http://gitea-http.gitea:3000/ops/homelab", "http://gitea-http.gitea:3000/ops/homelab"],
    ["oci://ghcr.io/acme/charts", "oci://ghcr.io/acme/charts"],
    ["ssh://git@h.example.org/x?next=https://y.example.org", "ssh://h.example.org/x?next=https://y.example.org"],
    ["https://h.example.org/a@b", "https://h.example.org/a@b"],
  ])("removes userinfo from %s", (raw, expected) => {
    expect(redactUrl(raw)).toBe(expected);
  });

  it.each([
    "user:pass@host/path?next=https://x.org",
    "user:pass@host/p?x=https://a",
    "tok@host#https://a",
    "tok@host?r=ssh://b",
    "https://h.example.org/x?u=http://u:p@h2.example.org",
    "https://h.example.org/x#frag=https://tok@h2.example.org",
    "git@github.com:org/r?x=https://u:p@h.example.org",
    "x:y@h.example.org/a://b",
    "user:pass@host/path",
    "user:pass@host",
    "tok@host",
    "tok@host/x",
    "a@b:c@d/x",
    "mailto:someone@example.org",
    "not a url",
    "",
    "https://ex\nample.com",
    "https://example.com/\tx",
    " https://example.com",
    "https://exa​mple.com",
    "http://[::1",
  ])("%j is unparseable and never echoed", (raw) => {
    expect(redactUrl(raw)).toBeUndefined();
    const out = quoteUrl("repo URL", raw, "terminal");
    expect(out).toBe(`repo URL ${UNPARSEABLE_URL}`);
    expect(quoteUrl("repo URL", raw, "mermaid")).toBe(`"repo URL ${UNPARSEABLE_URL}"`);
  });

  it.each([
    "https://example.org/?next=//user:pass@host/",
    "https://example.org/?u=https%3A%2F%2Fuser:pass%40host",
    "https://example.org/?u=https:\\\\user:pass@host/x",
    "https://example.org/#//user:pass@host",
    "https://example.org/?u=https:/user:pass@host",
    "https://example.org/%68ttps://u:p@h",
    "https://example.org/?u=a+https://u:p@h",
    "https://example.org/?u=HTTPS://user:pass@host",
  ])("third review: %j hides a URL with userinfo and is unparseable", (raw) => {
    expect(redactUrl(raw)).toBeUndefined();
  });

  it.each([
    ["https://example.org/?token=SECRET123", "https://example.org/?token=<redacted>"],
    [
      "https://example.org/x?X-Amz-Signature=abcdef&X-Amz-Credential=AKIA&page=2",
      "https://example.org/x?X-Amz-Signature=<redacted>&X-Amz-Credential=<redacted>&page=2",
    ],
    ["https://example.org/cb#access_token=abc&state=1", "https://example.org/cb#access_token=<redacted>&state=1"],
    [
      "https://example.org/?api_key=k1&password=p&sig=s&auth=a",
      "https://example.org/?api_key=<redacted>&password=<redacted>&sig=<redacted>&auth=<redacted>",
    ],
    ["https://example.org/?monkey=1&keyboard=2&q=token", "https://example.org/?monkey=1&keyboard=2&q=token"],
  ])("redacts credential-named parameter values: %s", (raw, expected) => {
    expect(redactUrl(raw)).toBe(expected);
  });

  it.each([
    "https://github.com/org/repo.git",
    "https://example.org/a?b=c#d",
    "https://example.org/@scope/pkg",
    "https://example.org/path/@user",
    "https://example.org/?email=a@b.c",
    "https://registry.example.org:5000/charts",
    "oci://registry.example.org/charts/x",
    "https://example.org/a?next=https://other.org/x",
    "s3://bucket/key@v1",
  ])("keeps the legitimate URL %s", (raw) => {
    expect(redactUrl(raw)).toBe(new URL(raw).href);
  });

  it("quotes the redacted URL and never prints the token", () => {
    const out = quoteUrl("repo URL", "https://x-access-token:ghp_secret@github.com/a/b", "terminal");
    expect(out).toBe('repo URL "https://github.com/a/b"');
    expect(out).not.toContain("ghp_secret");
    expect(quoteUrl("repo URL", "https://u:p@h.example.org/x", "mermaid")).not.toContain("u:p");
    expect(() => quoteUrl("", "https://x", "terminal")).toThrow(/fixed label/);
  });
});
