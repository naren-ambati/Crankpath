// A bounded reader of the HCL subset Vault's server configuration uses (U6; NFR1.1, BR6.10,
// BR6.11): it finds the top-level `seal "<type>" { ... }` blocks and their direct attributes, and
// nothing else. It evaluates nothing, follows nothing and never recurses: one linear pass over the
// text with a byte-per-level stack, so deep braces, long strings and huge input cost time and
// memory in proportion to the input, which is bounded. Anything it does not understand fully is a
// refusal with a named problem, never a guess: an unterminated string, comment or heredoc, an
// unexpected character or token, a bare word as a value, an escape other than `\"`, `\\`, `\n`,
// `\t` and `\r`, unbalanced brackets, a `seal` that is not `seal "<type>" {`, or an attribute set
// twice in one seal block. These refusals hold anywhere in the text, not only in seal stanzas: a
// bare word in a `telemetry` block refuses the whole configuration, and its seal with it (listed,
// never guessed). A `seal` inside a comment, a string or a nested block is not a seal stanza.

/**
 * The largest configuration text read: 1 MiB, the most a ConfigMap can hold (Kubernetes
 * documentation, "ConfigMap cannot exceed 1 MiB", lookup of 2026-11-15 in docs/lookups.md). A value
 * that large cannot come from an object the API server accepts; a larger one is refused.
 */
export const HCL_VALUE_BYTES = 1024 * 1024;

export type HclScalar = string | number | boolean;

export interface SealStanza {
  /** The label of `seal "<type>"` (repo text). */
  readonly type: string;
  /** Direct attributes; null for a value that is a list or an object. */
  readonly attributes: ReadonlyMap<string, HclScalar | null>;
  /** 1-based line of the `seal` keyword in the text. */
  readonly line: number;
}

export type SealProblem =
  | "too-large"
  | "unterminated-string"
  | "unterminated-comment"
  | "unterminated-heredoc"
  | "bad-escape"
  | "bare-identifier"
  | "unexpected-character"
  | "unexpected-token"
  | "unbalanced"
  | "unrecognised-seal"
  | "duplicate-attribute";

export type SealRead =
  | { readonly ok: true; readonly seals: readonly SealStanza[] }
  | { readonly ok: false; readonly problem: SealProblem; readonly line: number };

type TokenKind = "ident" | "string" | "number" | "heredoc" | "{" | "}" | "[" | "]" | "=" | "," | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  line: number;
}

class Refusal {
  constructor(
    readonly problem: SealProblem,
    readonly line: number,
  ) {}
}

// The escapes read: a quote, a backslash, and line feed, tab and carriage return. `\u`, `\x` and
// any other are refused, not passed through as text.
const ESCAPES: Readonly<Record<string, string>> = Object.freeze({ '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r" });
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_.-]/;
const NUMBER = /-?(?:0x[0-9A-Fa-f]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
const HEREDOC_MARKER = /<<(-?)([A-Za-z_][A-Za-z0-9_]*)\r?\n/y;

function tokenizer(text: string): () => Token {
  let i = 0;
  let line = 1;
  const n = text.length;
  return () => {
    for (;;) {
      if (i >= n) return { kind: "eof", value: "", line };
      const c = text[i] as string;
      if (c === "\n") {
        line += 1;
        i += 1;
      } else if (c === " " || c === "\t" || c === "\r") {
        i += 1;
      } else if (c === "#" || (c === "/" && text[i + 1] === "/")) {
        while (i < n && text[i] !== "\n") i += 1;
      } else if (c === "/" && text[i + 1] === "*") {
        const start = line;
        const end = text.indexOf("*/", i + 2);
        if (end === -1) throw new Refusal("unterminated-comment", start);
        for (let k = i; k < end; k++) if (text[k] === "\n") line += 1;
        i = end + 2;
      } else break;
    }
    const c = text[i] as string;
    const at = line;
    if ("{}[]=,".includes(c)) {
      i += 1;
      return { kind: c as TokenKind, value: c, line: at };
    }
    if (c === '"') {
      let out = "";
      i += 1;
      for (;;) {
        if (i >= n || text[i] === "\n") throw new Refusal("unterminated-string", at);
        const d = text[i] as string;
        if (d === '"') {
          i += 1;
          return { kind: "string", value: out, line: at };
        }
        if (d === "\\") {
          const e = text[i + 1];
          if (e === undefined || e === "\n") throw new Refusal("unterminated-string", at);
          if (!Object.hasOwn(ESCAPES, e)) throw new Refusal("bad-escape", at);
          out += ESCAPES[e] as string;
          i += 2;
        } else {
          out += d;
          i += 1;
        }
      }
    }
    if (c === "<" && text[i + 1] === "<") {
      HEREDOC_MARKER.lastIndex = i;
      const m = HEREDOC_MARKER.exec(text);
      if (m === null) throw new Refusal("unexpected-character", at);
      const indented = m[1] === "-";
      const marker = m[2] as string;
      i = HEREDOC_MARKER.lastIndex;
      line += 1;
      const lines: string[] = [];
      for (;;) {
        if (i >= n) throw new Refusal("unterminated-heredoc", at);
        let end = text.indexOf("\n", i);
        if (end === -1) end = n;
        const raw = text.slice(i, end).replace(/\r$/, "");
        i = end === n ? n : end + 1;
        if ((indented ? raw.trim() : raw) === marker) {
          line += end === n ? 0 : 1;
          return { kind: "heredoc", value: lines.join("\n"), line: at };
        }
        lines.push(raw);
        if (end !== n) line += 1;
      }
    }
    NUMBER.lastIndex = i;
    const num = NUMBER.exec(text);
    if (num !== null && (c === "-" || /\d/.test(c))) {
      i = NUMBER.lastIndex;
      return { kind: "number", value: num[0], line: at };
    }
    if (IDENT_START.test(c)) {
      const start = i;
      i += 1;
      while (i < n && IDENT_PART.test(text[i] as string)) i += 1;
      return { kind: "ident", value: text.slice(start, i), line: at };
    }
    throw new Refusal("unexpected-character", at);
  };
}

function scalarOf(t: Token): HclScalar | undefined {
  if (t.kind === "string" || t.kind === "heredoc") return t.value;
  if (t.kind === "number") return Number(t.value);
  if (t.kind === "ident") {
    if (t.value === "true") return true;
    if (t.value === "false") return false;
    // A bare word as a value is not HCL (Vault refuses it): refused, never read as a string.
    throw new Refusal("bare-identifier", t.line);
  }
  return undefined;
}

const BODY = 0;
const LIST = 1;

/** Reads the top-level seal stanzas of a Vault configuration text, or refuses with a named problem. */
export function readSealStanzas(text: string): SealRead {
  if (Buffer.byteLength(text, "utf8") > HCL_VALUE_BYTES) return { ok: false, problem: "too-large", line: 1 };
  const next = tokenizer(text);
  // One byte per open level: BODY or LIST. Level 0 is the file's own body.
  const stack = new Uint8Array(text.length + 2);
  let depth = 0;
  stack[0] = BODY;
  const seals: SealStanza[] = [];
  // The seal block being read: it is always the body at depth 1.
  let seal: { type: string; attributes: Map<string, HclScalar | null>; line: number } | null = null;
  const open = (kind: number) => {
    depth += 1;
    stack[depth] = kind;
  };
  const record = (key: string, value: HclScalar | null, line: number) => {
    if (seal === null || depth !== 1) return;
    if (seal.attributes.has(key)) throw new Refusal("duplicate-attribute", line);
    seal.attributes.set(key, value);
  };
  try {
    let tok = next();
    for (;;) {
      if (stack[depth] === LIST) {
        if (tok.kind === "eof") throw new Refusal("unbalanced", tok.line);
        if (tok.kind === "]") {
          depth -= 1;
        } else if (tok.kind === "{") open(BODY);
        else if (tok.kind === "[") open(LIST);
        else if (tok.kind !== "," && scalarOf(tok) === undefined) throw new Refusal("unexpected-token", tok.line);
        tok = next();
        continue;
      }
      if (tok.kind === "eof") {
        if (depth !== 0) throw new Refusal("unbalanced", tok.line);
        return { ok: true, seals };
      }
      if (tok.kind === "}") {
        if (depth === 0) throw new Refusal("unbalanced", tok.line);
        if (depth === 1 && seal !== null) {
          seals.push(Object.freeze({ type: seal.type, attributes: seal.attributes, line: seal.line }));
          seal = null;
        }
        depth -= 1;
        tok = next();
        continue;
      }
      if (tok.kind === "," && depth > 0) {
        tok = next();
        continue;
      }
      if (tok.kind !== "ident" && tok.kind !== "string") throw new Refusal("unexpected-token", tok.line);
      const key = tok.value;
      const keyLine = tok.line;
      const isSeal = depth === 0 && key === "seal";
      tok = next();
      if (tok.kind === "=") {
        if (isSeal) throw new Refusal("unrecognised-seal", keyLine);
        tok = next();
        const scalar = scalarOf(tok);
        if (scalar !== undefined) record(key, scalar, keyLine);
        else if (tok.kind === "{" || tok.kind === "[") {
          record(key, null, keyLine);
          open(tok.kind === "{" ? BODY : LIST);
        } else throw new Refusal("unexpected-token", tok.line);
        tok = next();
        continue;
      }
      const labels: Token[] = [];
      while (tok.kind === "string" || tok.kind === "ident") {
        labels.push(tok);
        tok = next();
      }
      if (tok.kind !== "{") throw new Refusal(isSeal ? "unrecognised-seal" : "unexpected-token", tok.line);
      if (isSeal) {
        const label = labels[0];
        if (labels.length !== 1 || label === undefined || label.kind !== "string") {
          throw new Refusal("unrecognised-seal", keyLine);
        }
        open(BODY);
        seal = { type: label.value, attributes: new Map(), line: keyLine };
      } else {
        record(key, null, keyLine);
        open(BODY);
      }
      tok = next();
    }
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, problem: e.problem, line: e.line };
    throw e;
  }
}
