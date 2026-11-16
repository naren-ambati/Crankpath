// Code-point order (C1 "Ordering"): every sorted collection in crankpath uses it. JavaScript's own
// string comparison is UTF-16 code-unit order, which sorts astral characters differently, so it is
// never used for output order.

/** Compares two strings by Unicode code point, then by length. */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    // Below the surrogate range and above it, code-unit order equals code-point order; a
    // surrogate (an astral character) sorts after every BMP character above U+D7FF.
    const xs = x >= 0xd800 && x <= 0xdfff;
    const ys = y >= 0xd800 && y <= 0xdfff;
    if (xs === ys) return x < y ? -1 : 1;
    return xs ? 1 : -1;
  }
  return a.length < b.length ? -1 : 1;
}

/** Compares tuples of strings field by field in code-point order. */
export function compareTuples(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = compareCodePoints(a[i] as string, b[i] as string);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/** A sorted copy (code-point order), duplicates removed. */
export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}
