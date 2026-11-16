// Rendered output (U4; FR1.4, NFR5): turns the standard output of `helm template` or `kustomize
// build` into parsed documents under the limits, one document at a time, so no parse ever holds
// more than one document's worth of the parser's own structures. YAML forbids `---` and `...` at
// the start of a line inside any scalar, so a line that starts with either is always a document
// boundary and a split on such lines is exact. A document over `renderedDocumentBytes` (no API
// server would take it), a document the bounded parser refuses, and output with more objects than
// `renderedObjects` are named limit outcomes; output that is not UTF-8 is a failed render. Every
// lexeme of every document is counted against `lexemesPerRender` (B2 review M4), the memory
// budget of one render's parse, derived as the reader's `lexemesPerFile` is: output past it is a
// `limit` for the whole render, never minutes of parsing.

import type { DataValue } from "../u1-graph-model/extractor.js";
import { isDataMap } from "../u1-graph-model/extractor.js";
import { type DerivedLimit, LIMITS } from "../u1-graph-model/limits.js";
import {
  countLexemes,
  parseYamlCounted,
  READER_LIMITS,
  type ReaderLimits,
  type Refusal,
} from "../u2-intake-config/bounded-reader.js";
import type { SourceDocument } from "./rendered-set-builder.js";

export interface OutputLimits {
  readonly documentBytes: DerivedLimit<"bytes">;
  readonly objects: DerivedLimit<"objects">;
  /** The parse budget over every document of the output. */
  readonly lexemes: DerivedLimit<"lexemes">;
  readonly reader: ReaderLimits;
}

export const OUTPUT_LIMITS: OutputLimits = Object.freeze({
  documentBytes: LIMITS.renderedDocumentBytes,
  objects: LIMITS.renderedObjects,
  lexemes: LIMITS.lexemesPerRender,
  reader: READER_LIMITS,
});

export interface RefusedDocument {
  /** 1-based document number in the output. */
  readonly document: number;
  readonly outcome: Refusal;
  readonly detail: string | null;
}

export type ParsedOutput =
  | {
      readonly ok: true;
      readonly documents: readonly SourceDocument[];
      readonly refused: readonly RefusedDocument[];
      /** Lexemes the parse counted (all documents). */
      readonly lexemes: number;
    }
  | { readonly ok: false; readonly problem: "not-utf8" | "too-many-objects" | "over-parse-budget" | "over-run-budget" };

const BOUNDARY = /^(?:---|\.\.\.)(?:[ \t].*)?$/;

/** The document texts of a YAML stream, split at `---` and `...` lines. */
export function splitDocuments(text: string): string[] {
  const docs: string[] = [];
  let current: string[] = [];
  let sawContent = false;
  for (const line of text.split("\n")) {
    if (BOUNDARY.test(line.replace(/\r$/, ""))) {
      if (sawContent) docs.push(current.join("\n"));
      // `--- value` puts the document's content on the marker line itself
      const rest = line.startsWith("---") ? line.slice(3).trim() : "";
      current = rest === "" ? [] : [rest];
      sawContent = rest !== "";
      continue;
    }
    current.push(line);
    if (line.trim() !== "" && !line.trimStart().startsWith("#")) sawContent = true;
  }
  if (sawContent) docs.push(current.join("\n"));
  return docs;
}

function objectCount(value: DataValue): number {
  if (isDataMap(value) && typeof value.kind === "string" && value.kind.endsWith("List") && Array.isArray(value.items))
    return value.items.length;
  return value === null ? 0 : 1;
}

/** Parses a render's output; `file` is the display name the documents get (`render:<job>`). */
/**
 * Parses a render's output; `file` is the display name the documents get (`render:<job>`). Before
 * anything is parsed the output's lexemes are counted (no syntax tree is built): over the parse
 * budget it is refused at once, and `admit` (the run's budget) is asked whether the parse's
 * transient fits.
 */
export function parseRenderedOutput(
  stdout: Buffer,
  file: string,
  limits: OutputLimits = OUTPUT_LIMITS,
  admit: (lexemes: number, bytes: number) => boolean = () => true,
): ParsedOutput {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
  } catch {
    return { ok: false, problem: "not-utf8" };
  }
  const counted = countLexemes(text, limits.lexemes.value);
  if (counted > limits.lexemes.value) return { ok: false, problem: "over-parse-budget" };
  if (!admit(counted, stdout.length)) return { ok: false, problem: "over-run-budget" };
  const documents: SourceDocument[] = [];
  const refused: RefusedDocument[] = [];
  let objects = 0;
  let lexemes = 0;
  const budget = limits.lexemes.value;
  const pieces = splitDocuments(text);
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i] as string;
    const n = i + 1;
    if (Buffer.byteLength(piece, "utf8") > limits.documentBytes.value) {
      refused.push({ document: n, outcome: "too-large", detail: "document" });
      continue;
    }
    const remaining = budget - lexemes;
    // the document may use what is left of the render's budget, and never more than a file may
    const perCall = Math.min(remaining, limits.reader.lexemesPerFile.value);
    const reader: ReaderLimits = {
      ...limits.reader,
      lexemesPerFile: { ...limits.reader.lexemesPerFile, value: perCall },
    };
    const parsed = parseYamlCounted(piece, reader);
    if (!parsed.ok) {
      if (parsed.refusal === "too-large" && parsed.detail === "file memory" && perCall === remaining) {
        return { ok: false, problem: "over-parse-budget" };
      }
      refused.push({ document: n, outcome: parsed.refusal, detail: parsed.detail ?? null });
      continue;
    }
    lexemes += parsed.lexemes;
    for (const value of parsed.documents) {
      objects += objectCount(value);
      if (objects > limits.objects.value) return { ok: false, problem: "too-many-objects" };
      documents.push({ file, document: n, value });
    }
  }
  return { ok: true, documents, refused, lexemes };
}
