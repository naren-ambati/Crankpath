// Flux post-build substitution (U4; FR3.6): a Flux Kustomization's `postBuild.substitute` and
// `postBuild.substituteFrom` variables replace `${name}` in the built objects, as kustomize-
// controller does after `kustomize build`. The forms read are `${name}` and the default forms
// `${name:=default}`, `${name:-default}`, `${name=default}`, `${name-default}`, and `$${...}` for a
// literal; an unset variable with no default becomes empty (Flux's default, non-strict). Any other
// `${...}` form (substrings, replacements, nesting) is refused, and the source is then opaque
// rather than built with a guess. An object labelled or annotated
// `kustomize.toolkit.fluxcd.io/substitute: disabled` is left as it is. The substitution works on
// parsed values (keys and strings); kustomize-controller substitutes text, so a substituted number
// stays a string here (no edge depends on it).

import type { DataValue } from "../u1-graph-model/extractor.js";
import { getPath, isDataMap } from "../u1-graph-model/extractor.js";

export const SUBSTITUTE_DISABLED = "kustomize.toolkit.fluxcd.io/substitute";

const NAME = /^[_A-Za-z][_A-Za-z0-9]*$/;
const REF = /\$\$\{|\$\{([^}]*)\}/g;

export type Substituted = { readonly ok: true; readonly value: DataValue } | { readonly ok: false };

function substituteText(text: string, vars: ReadonlyMap<string, string>): string | null {
  if (!text.includes("${")) return text;
  let failed = false;
  const out = text.replace(REF, (whole, inner: string | undefined) => {
    if (whole === "$${") return "${";
    const body = inner ?? "";
    const m = /^([^:=-]*)(?::?[=-](.*))?$/s.exec(body);
    const name = m?.[1] ?? "";
    const fallback = m?.[2];
    if (!NAME.test(name) || (fallback !== undefined && /[${}]/.test(fallback))) {
      failed = true;
      return whole;
    }
    const v = vars.get(name);
    if (v !== undefined && (v !== "" || !body.startsWith(`${name}:`))) return v;
    return fallback ?? v ?? "";
  });
  // an unterminated `${` is a form crankpath does not read
  if (failed || /\$\{(?![^}]*\})/.test(out.replace(/\$\$\{/g, ""))) return null;
  return out;
}

function walk(value: DataValue, vars: ReadonlyMap<string, string>): Substituted {
  if (typeof value === "string") {
    const s = substituteText(value, vars);
    return s === null ? { ok: false } : { ok: true, value: s };
  }
  if (value === null || typeof value !== "object") return { ok: true, value };
  // iterative over the structure would be needed for depth beyond the reader's limit; parsed
  // documents are already bounded by the reader's nesting limit and the yaml package's stack
  if (Array.isArray(value)) {
    const out: DataValue[] = [];
    for (const v of value) {
      const r = walk(v, vars);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  const out: { [key: string]: DataValue } = {};
  for (const k of Object.keys(value)) {
    const key = substituteText(k, vars);
    if (key === null) return { ok: false };
    const r = walk(value[k] as DataValue, vars);
    if (!r.ok) return r;
    Object.defineProperty(out, key, { value: r.value, enumerable: true, configurable: true, writable: true });
  }
  return { ok: true, value: out };
}

function disabled(value: DataValue): boolean {
  for (const where of ["labels", "annotations"] as const) {
    const v = getPath(value, ["metadata", where, SUBSTITUTE_DISABLED]);
    if (v === "disabled") return true;
  }
  return false;
}

/** Substitutes one parsed document (a List's items one by one). */
export function substituteDocument(value: DataValue, vars: ReadonlyMap<string, string>): Substituted {
  if (isDataMap(value) && typeof value.kind === "string" && value.kind.endsWith("List") && Array.isArray(value.items)) {
    const items: DataValue[] = [];
    for (const item of value.items) {
      const r = disabled(item) ? { ok: true as const, value: item } : walk(item, vars);
      if (!r.ok) return r;
      items.push(r.value);
    }
    return { ok: true, value: { ...value, items } };
  }
  if (disabled(value)) return { ok: true, value };
  return walk(value, vars);
}
