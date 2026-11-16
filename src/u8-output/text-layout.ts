// TextLayout (U8, contract C8; FR8.2, FR8.6, FR8.7, NFR14): the shared line layout of the text
// report and the --explain text. Each logical line is wrapped at 80 columns with a hanging indent
// (its own indentation plus four spaces). A line breaks only at a run of spaces outside a quoted
// value, never right after a label that ends in `:` and never right before a quote, so a
// continuation line always starts with crankpath's own words, never with repo text. A single label
// with its quoted value longer than the width is never cut: that line is longer than 80 columns
// (the value itself is already bounded by SafeText's length limit).
//
// Colour is decoration only (BR8.6): it is added after wrapping, to a few of crankpath's own words
// outside quoted values, and every meaning it marks is already a word. Stripping the colour codes
// gives the uncoloured text byte for byte.

export const TEXT_WIDTH = 80;
const HANGING = 4;

/** Code points of a line (a quoted value may hold astral characters). */
function codePoints(line: string): string[] {
  return Array.from(line);
}

/** Positions [start, end) of the runs of spaces where the line may break. */
function breakRuns(cps: readonly string[]): [number, number][] {
  const runs: [number, number][] = [];
  let quoted = false;
  let i = 0;
  while (i < cps.length && cps[i] === " ") i++; // leading indentation never breaks
  for (; i < cps.length; i++) {
    const c = cps[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c !== " ") continue;
    let j = i;
    while (j < cps.length && cps[j] === " ") j++;
    const before = cps[i - 1];
    const after = cps[j];
    if (j < cps.length && before !== ":" && after !== '"') runs.push([i, j]);
    i = j - 1;
  }
  return runs;
}

/** One logical line as output lines of at most `width` columns where a break point allows. */
export function wrapLine(line: string, width: number = TEXT_WIDTH): string[] {
  const cps = codePoints(line);
  if (cps.length <= width) return [line];
  let indent = 0;
  while (indent < cps.length && cps[indent] === " ") indent++;
  const prefix = " ".repeat(indent + HANGING);
  const runs = breakRuns(cps);
  const out: string[] = [];
  let start = 0;
  let lead = "";
  let r = 0;
  while (lead.length + (cps.length - start) > width) {
    // the last break that keeps this output line within the width, else the first one after start
    let chosen = -1;
    while (r < runs.length && (runs[r] as [number, number])[0] <= start) r++;
    for (let k = r; k < runs.length; k++) {
      const [a] = runs[k] as [number, number];
      if (lead.length + (a - start) <= width) chosen = k;
      else break;
    }
    if (chosen < 0) chosen = r < runs.length ? r : -1;
    if (chosen < 0) break;
    const [a, b] = runs[chosen] as [number, number];
    out.push(lead + cps.slice(start, a).join(""));
    start = b;
    lead = prefix;
    r = chosen + 1;
  }
  out.push(lead + cps.slice(start).join(""));
  return out;
}

/** Every logical line wrapped, in order. */
export function wrapLines(lines: readonly string[], width: number = TEXT_WIDTH): string[] {
  const out: string[] = [];
  for (const line of lines) for (const l of wrapLine(line, width)) out.push(l);
  return out;
}

const SGR = Object.freeze({ bold: "\x1b[1m", yellow: "\x1b[33m", red: "\x1b[31m", reset: "\x1b[0m" });

// Words crankpath may colour (its own vocabulary only), longest first so a longer phrase wins.
const COLOURED: readonly [string, string][] = [
  ["ANALYSED WITH GAPS", `${SGR.bold}${SGR.yellow}`],
  ["NOTHING ANALYSED", `${SGR.bold}${SGR.yellow}`],
  ["ANALYSED", SGR.bold],
  ["UNRESOLVED", SGR.yellow],
  ["uncranked", SGR.red],
  ["blocked", SGR.red],
  ["unverified", SGR.yellow],
];

/** Colours crankpath's own words outside quoted values; repo text is never wrapped in a colour. */
export function colourLine(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const c = line[i] as string;
    if (c === '"') {
      // copy the quoted value untouched
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j += line[j] === "\\" ? 2 : 1;
      out += line.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const prevWord = i > 0 && /[A-Za-z0-9-]/.test(line[i - 1] as string);
    const hit = prevWord ? undefined : COLOURED.find(([w]) => line.startsWith(w, i));
    const next = hit === undefined ? "" : (line[i + hit[0].length] ?? "");
    if (hit !== undefined && !/[A-Za-z0-9-]/.test(next)) {
      out += `${hit[1]}${hit[0]}${SGR.reset}`;
      i += hit[0].length;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Removes the colour codes colourLine adds (tests: the coloured text minus colour is the plain text). */
export function stripColour(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the colour codes are what is removed
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Whether colour is used: only on a terminal, never when `NO_COLOR` is set to a non-empty value
 * (no-color.org) or `--no-color` is given, and never for a file or another format.
 */
export function useColour(options: { isTTY: boolean; noColorEnv: string | undefined; noColorFlag: boolean }): boolean {
  return options.isTTY && !options.noColorFlag && (options.noColorEnv === undefined || options.noColorEnv === "");
}
