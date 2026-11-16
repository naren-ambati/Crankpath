// ApplicationSet parameters and template substitution (U3, part of GeneratorExpander; FR3.3,
// BR3.10, BR3.12). Argo CD v3.6.1 renders an ApplicationSet's template in one of two modes, and
// crankpath follows each exactly where it supports it and refuses the rest by name:
//
// - fasttemplate (the default, `goTemplate` false): every string of the template that holds `{{`
//   and `}}` on one line is scanned; each `{{ tag }}` whose trimmed tag is a string parameter is
//   replaced, and any other tag is left as written (Argo CD's own behaviour); an unterminated `{{`
//   is an error in Argo CD and here `unsupported-template`.
// - Go templates (`goTemplate: true`): an action is only a field chain (`{{ .path.basename }}`) or
//   `index` of a chain with a decimal index (`{{ index .path.segments 1 }}`). Every other construct
//   (functions, pipes, variables, conditions, trim markers, comments) is `unsupported-template`. A
//   missing key prints `<no value>` as Go does, or is refused under `missingkey=error`; a value that
//   is not a string, a boolean or a safe integer is refused (crankpath does not reproduce Go's
//   formatting of other values).
//
// A parameter crankpath cannot know (a cluster's server URL, which the `clusters:` block does not
// give) is carried as a gap: using it makes the generated Application opaque with the gap's reason.
// Nothing here reads a file or evaluates anything: a template is data.

import type { DataMap, DataValue } from "../u1-graph-model/extractor.js";
import { isDataMap } from "../u1-graph-model/extractor.js";

export type TemplateMode = "fast" | "go";

/** Why a parameter cannot be used. */
export interface ParamGap {
  readonly reason: "cluster-inputs-missing" | "unsupported-template";
  /** crankpath's fixed words. */
  readonly detail: string;
}

/**
 * One parameter set. In fasttemplate mode `values` is flat (dotted keys, string values); in Go
 * mode it is nested as Argo CD builds it. `gaps` holds keys crankpath cannot know: flat keys, or
 * the top-level key in Go mode.
 */
export interface ParamSet {
  readonly values: DataMap;
  readonly gaps: ReadonlyMap<string, ParamGap>;
}

export type Rendered =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly reason: ParamGap["reason"] | "limit";
      readonly detail: string;
    };

const NO_VALUE = "<no value>";
/** A render stopped by its work bound (generatorRenderSteps, B3 review M1). */
const OVER: Rendered = Object.freeze({
  ok: false,
  reason: "limit",
  detail: "template rendering work over the limit (generatorRenderSteps)",
});
const SAME_LINE_TAGS = /\{\{.*\}\}/;

/** Argo CD's SanitizeName (applicationset/utils/template_functions.go, v3.6.1). */
export function sanitizeName(name: string): string {
  let n = name.toLowerCase().replace(/[^-a-z0-9.]/gu, "-");
  if (n.length > 253) n = n.slice(0, 253);
  return n.replace(/^[-.]+/, "").replace(/[-.]+$/, "");
}

/** A scalar printed as both template modes print it, or null when crankpath does not reproduce it. */
export function scalarText(v: DataValue | undefined): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  return null;
}

function renderFast(text: string, params: ParamSet, cap: number): Rendered {
  if (!SAME_LINE_TAGS.test(text)) return { ok: true, text };
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{{", i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    const close = text.indexOf("}}", open + 2);
    if (close === -1) {
      return {
        ok: false,
        reason: "unsupported-template",
        detail: "a {{ without its }} (Argo CD refuses the template)",
      };
    }
    out += text.slice(i, open);
    const tag = text.slice(open + 2, close);
    const key = tag.trim();
    const gap = key === "" ? undefined : params.gaps.get(key);
    if (gap !== undefined) return { ok: false, reason: gap.reason, detail: gap.detail };
    const value = key === "" || !Object.hasOwn(params.values, key) ? undefined : params.values[key];
    out += typeof value === "string" ? value : `{{${tag}}}`;
    if (out.length > cap) return OVER;
    i = close + 2;
  }
  return { ok: true, text: out };
}

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const CHAIN = new RegExp(`^((?:\\.${IDENT})+)$`);
const INDEX = new RegExp(`^index\\s+((?:\\.${IDENT})+)\\s+(\\d{1,9})$`);

type Lookup =
  | { found: true; value: DataValue }
  /** `last`: only the last key of the chain is missing (Go prints `<no value>`); else Go fails. */
  | { found: false; last: boolean }
  | { gap: ParamGap };

function lookup(params: ParamSet, chain: string): Lookup {
  const steps = chain.slice(1).split(".");
  const gap = params.gaps.get(steps[0] as string);
  if (gap !== undefined) return { gap };
  let current: DataValue = params.values as DataValue;
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s] as string;
    // a field of something that is not a map is an error in Go, as is a field of a missing key
    if (!isDataMap(current)) return { found: false, last: false };
    if (!Object.hasOwn(current, step)) return { found: false, last: s === steps.length - 1 };
    current = current[step] as DataValue;
  }
  return { found: true, value: current };
}

function renderGo(text: string, params: ParamSet, missingKeyError: boolean, cap: number): Rendered {
  if (!text.includes("{{")) return { ok: true, text };
  const refuse = (detail: string): Rendered => ({ ok: false, reason: "unsupported-template", detail });
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{{", i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    const close = text.indexOf("}}", open + 2);
    if (close === -1) return refuse("a {{ without its }} (Argo CD refuses the template)");
    out += text.slice(i, open);
    const raw = text.slice(open + 2, close);
    if (raw.startsWith("-") || raw.endsWith("-") || raw.startsWith("/*")) {
      return refuse("a Go template construct crankpath does not evaluate (only {{.field}} and {{index .field N}})");
    }
    const action = raw.trim();
    const chain = CHAIN.exec(action);
    const index = INDEX.exec(action);
    if (chain === null && index === null) {
      return refuse("a Go template construct crankpath does not evaluate (only {{.field}} and {{index .field N}})");
    }
    const found = lookup(params, ((chain ?? index) as RegExpExecArray)[1] as string);
    if ("gap" in found) return { ok: false, reason: found.gap.reason, detail: found.gap.detail };
    if (!found.found) {
      // Go prints a missing map key as `<no value>`; a field of a missing key is an error.
      if (index !== null || !found.last || missingKeyError) {
        return refuse("a key the parameters do not hold (Argo CD fails this Application)");
      }
      out += NO_VALUE;
      if (out.length > cap) return OVER;
    } else {
      let value: DataValue | undefined = found.value;
      if (index !== null) {
        const n = Number(index[2]);
        if (!Array.isArray(value) || n >= value.length) return refuse("an index the parameters do not hold");
        value = value[n];
      }
      const t = scalarText(value);
      if (t === null) return refuse("a value that is not a string, a boolean or an integer");
      out += t;
      if (out.length > cap) return OVER;
    }
    i = close + 2;
  }
  return { ok: true, text: out };
}

/** Renders one template string with one parameter set. */
export function renderString(
  text: string,
  params: ParamSet,
  mode: TemplateMode,
  missingKeyError: boolean,
  cap = Number.POSITIVE_INFINITY,
): Rendered {
  const r = mode === "fast" ? renderFast(text, params, cap) : renderGo(text, params, missingKeyError, cap);
  return r.ok && r.text.length > cap ? OVER : r;
}

/**
 * The work one ApplicationSet's template rendering may do, in steps (generatorRenderSteps): a node
 * visited is one, a character a templated string produces is one each. Shared by every Application
 * of the set, so the elements times the template's size are bounded together (B3 review M1).
 */
export class WorkBudget {
  constructor(public left: number) {}
  spend(n: number): boolean {
    if (n > this.left) {
      this.left = 0;
      return false;
    }
    this.left -= n;
    return true;
  }
}
const OVER_FIELDS = {
  reason: "limit" as const,
  detail: "template rendering work over the limit (generatorRenderSteps)",
};

export type RenderedValue =
  | { readonly ok: true; readonly value: DataValue }
  | {
      readonly ok: false;
      readonly reason: ParamGap["reason"] | "limit";
      readonly detail: string;
      readonly field: string;
      readonly text: string;
    };

/**
 * Renders every string of a template value (iteratively: no recursion, so depth cannot overflow a
 * stack; the value came through BoundedReader, so its size is bounded). Map keys are never
 * templated by Argo CD; a key holding `{{` is refused. `field` names the first failing string.
 */
export function renderValue(
  value: DataValue,
  params: ParamSet,
  mode: TemplateMode,
  missingKeyError: boolean,
  at: string,
  work: WorkBudget = new WorkBudget(Number.POSITIVE_INFINITY),
): RenderedValue {
  type Frame = { src: DataValue; set: (v: DataValue) => void; field: string };
  let result: DataValue = null;
  const stack: Frame[] = [{ src: value, set: (v) => (result = v), field: at }];
  while (stack.length > 0) {
    const f = stack.pop() as Frame;
    const src = f.src;
    // one step per node visited, and one per character a templated string produces
    if (!work.spend(1)) return { ok: false, ...OVER_FIELDS, field: f.field, text: "" };
    if (typeof src === "string") {
      const r = renderString(src, params, mode, missingKeyError, work.left);
      if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, field: f.field, text: src };
      if (r.text !== src && !work.spend(r.text.length)) return { ok: false, ...OVER_FIELDS, field: f.field, text: src };
      f.set(r.text);
    } else if (Array.isArray(src)) {
      const arr: DataValue[] = new Array(src.length).fill(null);
      f.set(arr);
      for (let k = src.length - 1; k >= 0; k--) {
        stack.push({ src: src[k] as DataValue, set: (v) => (arr[k] = v), field: `${f.field}[${k}]` });
      }
    } else if (isDataMap(src)) {
      const obj: { [key: string]: DataValue } = {};
      f.set(obj);
      const keys = Object.keys(src);
      for (let k = keys.length - 1; k >= 0; k--) {
        const key = keys[k] as string;
        if (key.includes("{{")) {
          return {
            ok: false,
            reason: "unsupported-template",
            detail: "a templated map key (Argo CD templates values only)",
            field: f.field,
            text: key,
          };
        }
        Object.defineProperty(obj, key, { value: null, enumerable: true, writable: true });
        stack.push({ src: src[key] as DataValue, set: (v) => (obj[key] = v), field: `${f.field}.${key}` });
      }
    } else f.set(src);
  }
  return { ok: true, value: result };
}

/** Whether any string or key of a value holds `{{` (a templated generator spec). */
export function holdsTemplate(value: DataValue): boolean {
  const stack: DataValue[] = [value];
  while (stack.length > 0) {
    const v = stack.pop() as DataValue;
    if (typeof v === "string") {
      if (v.includes("{{")) return true;
    } else if (Array.isArray(v)) for (const x of v) stack.push(x);
    else if (isDataMap(v)) {
      for (const k of Object.keys(v)) {
        if (k.includes("{{")) return true;
        stack.push(v[k] as DataValue);
      }
    }
  }
  return false;
}

/**
 * Flattens a value as Argo CD's fasttemplate mode does (jeremywohl/flatten, DotStyle: nested keys
 * joined by `.`, array items by their index), printing scalars with `%v`. A scalar crankpath does
 * not print as Go does (null, a non-integer number) becomes a gap on its key.
 */
export function flattenParams(value: DataMap): { values: Record<string, string>; gaps: Map<string, ParamGap> } {
  const values: Record<string, string> = {};
  const gaps = new Map<string, ParamGap>();
  const stack: { prefix: string; v: DataValue }[] = [];
  for (const k of Object.keys(value)) stack.push({ prefix: k, v: value[k] as DataValue });
  while (stack.length > 0) {
    const { prefix, v } = stack.pop() as { prefix: string; v: DataValue };
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) stack.push({ prefix: `${prefix}.${i}`, v: v[i] as DataValue });
    } else if (isDataMap(v))
      for (const k of Object.keys(v)) stack.push({ prefix: `${prefix}.${k}`, v: v[k] as DataValue });
    else {
      const t = scalarText(v);
      if (t === null)
        gaps.set(prefix, {
          reason: "unsupported-template",
          detail: "a value crankpath does not print as Argo CD does",
        });
      else Object.defineProperty(values, prefix, { value: t, enumerable: true, writable: true });
    }
  }
  return { values, gaps };
}
