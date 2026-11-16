// TemplateScan (U4; B2 review m2, pass 3 m1): what a chart's templates ask helm to do that makes
// its output change from run to run or reach the network. It is a flag only (a floating entry
// naming the functions), never the guard: the double render decides (helm-renderer.ts), and
// neither can prove determinism. helm's template functions `randAlphaNum`,
// `randAlpha`, `randNumeric`, `randAscii`, `randBytes`, `randInt`, `uuidv4`, `shuffle`, `now`,
// `date`, `dateInZone`, `unixEpoch`, the certificate and key generators, `htpasswd` and `bcrypt`
// give another value on every render; `getHostByName` makes a DNS lookup. The scan reads the
// actions (`{{ ... }}`) of every file under a `templates/` directory of the chart (and of
// unpacked subcharts) through the bounded reader; an archived subchart (`charts/*.tgz`) is not
// opened, which is a stated limit.

import { openRoot, readText } from "../u2-intake-config/bounded-reader.js";
import { walkFiles } from "../u2-intake-config/tree-walk.js";

export const RANDOM_FUNCTIONS: readonly string[] = Object.freeze([
  "randAlphaNum",
  "randAlpha",
  "randNumeric",
  "randAscii",
  "randBytes",
  "randInt",
  "uuidv4",
  "shuffle",
  "now",
  "date",
  "dateInZone",
  "unixEpoch",
  "genCA",
  "genCAWithKey",
  "genPrivateKey",
  "genSelfSignedCert",
  "genSelfSignedCertWithKey",
  "genSignedCert",
  "genSignedCertWithKey",
  "htpasswd",
  "bcrypt",
]);
export const NETWORK_FUNCTIONS: readonly string[] = Object.freeze(["getHostByName"]);

export interface TemplateScan {
  /** Functions found that change the output between renders, sorted. */
  readonly random: readonly string[];
  /** Functions found that reach the network, sorted. */
  readonly network: readonly string[];
}

const ACTION = /\{\{([\s\S]*?)\}\}/g;
// a function name, not a field (`.Values.date`) or a variable (`$now`)
const WORD = /(?<![.$A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*/g;

/** The words of a template's actions that name one of the functions. */
export function functionsIn(text: string, names: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(ACTION)) {
    for (const w of (m[1] ?? "").matchAll(WORD)) if (names.has(w[0])) found.add(w[0]);
  }
  return found;
}

/** Scans a chart directory crankpath owns (its private copy or its cache). */
export function scanTemplates(chartDir: string): TemplateScan {
  const random = new Set<string>();
  const network = new Set<string>();
  const opened = openRoot(chartDir);
  if (!opened.ok) return { random: [], network: [] };
  const walk = walkFiles(opened.root, "", { recurse: true });
  if (!walk.ok) return { random: [], network: [] };
  const randomNames = new Set(RANDOM_FUNCTIONS);
  const networkNames = new Set(NETWORK_FUNCTIONS);
  for (const file of walk.files) {
    if (!`/${file}`.includes("/templates/")) continue;
    const read = readText(opened.root, file);
    if (read.outcome !== "ok") continue;
    for (const f of functionsIn(read.text, randomNames)) random.add(f);
    for (const f of functionsIn(read.text, networkNames)) network.add(f);
  }
  return { random: [...random].sort(), network: [...network].sort() };
}
