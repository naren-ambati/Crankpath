// A small, strict JSON Schema validator for the report schema (ADR-015: no schema-validation
// library). It knows only the keywords the schema uses and refuses any other, so the schema can
// never hold a rule this validator silently skips. Also: the field list of a schema (path to JSON
// types), for the schema-diff test.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = { readonly [key: string]: unknown };

const KNOWN = new Set([
  "$schema",
  "$defs",
  "$ref",
  "title",
  "description",
  "type",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minimum",
  "anyOf",
]);

function typeOf(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(v: Json, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === "number" && actual === "integer");
}

function resolve(root: Schema, ref: string): Schema {
  const m = /^#\/\$defs\/([A-Za-z0-9]+)$/.exec(ref);
  const defs = root.$defs as Record<string, Schema> | undefined;
  const target = m === null ? undefined : defs?.[m[1] as string];
  if (target === undefined) throw new Error(`schema: unresolvable $ref ${ref}`);
  return target;
}

/** Every error of `value` against `schema`, as `path: message` lines; empty when valid. */
export function validate(root: Schema, value: unknown, schema: Schema = root, at = "$"): string[] {
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`schema: unsupported keyword ${k} at ${at}`);
  if (schema.$ref !== undefined) return validate(root, value, resolve(root, schema.$ref as string), at);
  const v = value as Json;
  const errors: string[] = [];
  if (schema.anyOf !== undefined) {
    const options = schema.anyOf as Schema[];
    if (!options.some((o) => validate(root, v, o, at).length === 0)) errors.push(`${at}: matches no anyOf option`);
    return errors;
  }
  if (schema.const !== undefined && JSON.stringify(v) !== JSON.stringify(schema.const)) {
    errors.push(`${at}: is not the constant ${JSON.stringify(schema.const)}`);
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => typeMatches(v, t))) {
      errors.push(`${at}: is ${typeOf(v)}, expected ${types.join(" or ")}`);
      return errors;
    }
  }
  if (schema.enum !== undefined && !(schema.enum as Json[]).some((e) => e === v)) {
    errors.push(`${at}: ${JSON.stringify(v)} is not one of the listed words`);
  }
  if (schema.minimum !== undefined && typeof v === "number" && v < (schema.minimum as number)) {
    errors.push(`${at}: is below ${schema.minimum}`);
  }
  if (typeOf(v) === "array" && schema.items !== undefined) {
    (v as Json[]).forEach((item, i) => {
      errors.push(...validate(root, item, schema.items as Schema, `${at}[${i}]`));
    });
  }
  if (typeOf(v) === "object") {
    const obj = v as { [key: string]: Json };
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const r of (schema.required ?? []) as string[]) if (!(r in obj)) errors.push(`${at}: lacks ${r}`);
    for (const [k, x] of Object.entries(obj)) {
      const p = props[k];
      if (p === undefined) {
        if (schema.additionalProperties === false) errors.push(`${at}: has a field the schema does not list: ${k}`);
        continue;
      }
      errors.push(...validate(root, x, p, `${at}.${k}`));
    }
  }
  return errors;
}

/** The JSON types a schema node allows, as a sorted `|`-joined word (`string|null`). */
function typesOf(root: Schema, schema: Schema): string[] {
  if (schema.$ref !== undefined) return typesOf(root, resolve(root, schema.$ref as string));
  if (schema.anyOf !== undefined)
    return [...new Set((schema.anyOf as Schema[]).flatMap((o) => typesOf(root, o)))].sort();
  if (schema.const !== undefined) return [typeOf(schema.const as Json)];
  if (schema.type === undefined) return ["any"];
  return (Array.isArray(schema.type) ? [...(schema.type as string[])] : [schema.type as string]).sort();
}

function deref(root: Schema, schema: Schema): Schema {
  return schema.$ref !== undefined ? deref(root, resolve(root, schema.$ref as string)) : schema;
}

/** Every field path of the schema with its JSON types: `cycles[].edges[].from` to `string`. */
export function schemaFields(root: Schema): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (s: Schema, at: string) => {
    const node = deref(root, s);
    const options = node.anyOf === undefined ? [node] : (node.anyOf as Schema[]).map((o) => deref(root, o));
    for (const o of options) {
      if (o.properties !== undefined) {
        for (const [k, p] of Object.entries(o.properties as Record<string, Schema>)) {
          const path = at === "" ? k : `${at}.${k}`;
          out[path] = typesOf(root, p).join("|");
          walk(p, path);
        }
      }
      if (o.items !== undefined) {
        out[`${at}[]`] = typesOf(root, o.items as Schema).join("|");
        walk(o.items as Schema, `${at}[]`);
      }
    }
  };
  walk(root, "");
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Fields of `before` that `after` removed or retyped (a breaking change). */
export function breakingChanges(before: Record<string, string>, after: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [path, type] of Object.entries(before)) {
    if (!(path in after)) out.push(`removed: ${path}`);
    else if (after[path] !== type) out.push(`retyped: ${path} (${type} to ${after[path]})`);
  }
  return out;
}
