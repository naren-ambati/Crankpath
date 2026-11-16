// How helm and kustomize match keys (B2 review M1): both decode YAML through sigs.k8s.io/yaml into
// Go structs with encoding/json, which matches a key to a field without regard to case (Unicode
// simple folding: `Resources`, `RESOURCES` and `reſources` all set `resources`). A pre-read that
// looks a field up by its exact name would not see a key the tool honours, so every pre-read
// refuses a key that folds to a field's name but is spelled otherwise, and two keys that fold to
// one name.

/** The fold encoding/json applies per character (to lower, then to upper case). */
export function foldKey(key: string): string {
  let out = "";
  for (const ch of key) out += ch.toLowerCase().toUpperCase();
  return out;
}

/**
 * The first key of `map` that folds to one of `names` without being spelled exactly so, or that
 * folds to the same name as an earlier key; null when there is none.
 */
export function caseVariantKey(map: Readonly<Record<string, unknown>>, names: readonly string[]): string | null {
  const byFold = new Map(names.map((n) => [foldKey(n), n]));
  const seen = new Set<string>();
  for (const key of Object.keys(map)) {
    const fold = foldKey(key);
    const name = byFold.get(fold);
    if (name !== undefined && name !== key) return key;
    if (name !== undefined && seen.has(fold)) return key;
    if (name !== undefined) seen.add(fold);
  }
  return null;
}
