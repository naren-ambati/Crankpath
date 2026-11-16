// Test helpers for the 80-column text layout: undo the hanging-indent wrapping, so assertions about
// what a statement says need not know where it breaks. A continuation line is indented at least
// four spaces deeper than the logical line it continues (children are two deeper), so the join is
// exact except that the run of spaces at each break reads back as one space.

export function unwrapLines(text: string): string[] {
  const out: string[] = [];
  let base = -1;
  for (const line of text.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (out.length > 0 && base >= 0 && line.trim() !== "" && indent >= base + 4) {
      out[out.length - 1] += ` ${line.trimStart()}`;
      continue;
    }
    out.push(line);
    base = line.trim() === "" ? -1 : indent;
  }
  return out;
}

/** The text with every wrapped statement on one line again (single space at each former break). */
export function unwrapText(text: string): string {
  return unwrapLines(text).join("\n");
}

/** Whitespace runs as one space: for assertions on a statement that may have wrapped at a double space. */
export function flat(text: string): string {
  return unwrapText(text).replace(/ {2,}/g, " ");
}
