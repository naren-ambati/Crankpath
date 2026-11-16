// A strict structural check of the Mermaid crankpath emits (the B6 choice: no Mermaid parser is
// small enough to pin as a dev dependency; the mermaid package is the whole renderer with a browser
// DOM). It accepts exactly the flowchart subset MermaidRenderer writes and nothing else, so a line
// crankpath did not mean to write, or a label that could end early, fails it:
//   flowchart LR
//   <2 sp>n<k>["<label>"]            optionally :::opaque
//   <2 sp>n<a> --> | ==> | -.-> |"<label>"| n<b>     between declared nodes
//   <2 sp>subgraph legend["Legend"] / <4 sp>direction LR / <4 sp>legend<k>["<label>"] / <2 sp>end
//   <2 sp>classDef opaque stroke-dasharray: 5 5
// A label is one double-quoted string with no raw quote, no raw `#` other than an entity code
// `#<decimal>;`, no raw Mermaid or HTML syntax character and no control character. It also checks
// Mermaid's own default limits (maxEdges 500, maxTextSize 50,000 characters).

const LABEL_BODY = "(?:[^\"#\\x00-\\x1f\\x7f[\\]{}()|;'%=$&<>`]|#\\d+;)*";
const LABEL = `"${LABEL_BODY}"`;
const NODE = new RegExp(`^  (n\\d+)\\[(${LABEL})\\](:::opaque)?$`);
const EDGE = new RegExp(`^  (n\\d+) (-->|==>|-\\.->)\\|(${LABEL})\\| (n\\d+)$`);
const LEGEND_NODE = new RegExp(`^    legend\\d+\\[${LABEL}\\](:::opaque)?$`);

export interface MermaidCheck {
  readonly errors: string[];
  readonly nodes: number;
  readonly edges: number;
  readonly labels: string[];
}

export function checkMermaid(diagram: string): MermaidCheck {
  const errors: string[] = [];
  const labels: string[] = [];
  const lines = diagram.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines[0] !== "flowchart LR") errors.push("line 1: not `flowchart LR`");
  const declared = new Set<string>();
  let edges = 0;
  let state: "body" | "legend" | "after" = "body";
  lines.slice(1).forEach((line, i) => {
    const at = `line ${i + 2}`;
    if (state === "body") {
      const n = NODE.exec(line);
      if (n !== null) {
        if (edges > 0) errors.push(`${at}: a node after the edges`);
        if (declared.has(n[1] as string)) errors.push(`${at}: node ${n[1]} declared twice`);
        declared.add(n[1] as string);
        labels.push(n[2] as string);
        return;
      }
      const e = EDGE.exec(line);
      if (e !== null) {
        for (const id of [e[1], e[4]]) if (!declared.has(id as string)) errors.push(`${at}: edge to undeclared ${id}`);
        labels.push(e[3] as string);
        edges += 1;
        return;
      }
      if (line === '  subgraph legend["Legend"]') {
        state = "legend";
        return;
      }
      errors.push(`${at}: not a line crankpath writes: ${JSON.stringify(line.slice(0, 80))}`);
      return;
    }
    if (state === "legend") {
      if (line === "    direction LR" || LEGEND_NODE.test(line)) return;
      if (line === "  end") {
        state = "after";
        return;
      }
      errors.push(`${at}: not a legend line: ${JSON.stringify(line.slice(0, 80))}`);
      return;
    }
    if (line !== "  classDef opaque stroke-dasharray: 5 5") errors.push(`${at}: unexpected after the legend`);
  });
  if ((state as string) !== "after") errors.push("the legend is missing or not closed");
  if (edges > 500) errors.push(`${edges} edges: over Mermaid's default maxEdges (500)`);
  if (diagram.length > 50_000) errors.push(`${diagram.length} characters: over Mermaid's default maxTextSize`);
  return { errors, nodes: declared.size, edges, labels };
}

/** The Markdown document's fenced blocks, in order, each with its info string. */
export function fences(doc: string): { info: string; body: string }[] {
  const out: { info: string; body: string }[] = [];
  const lines = doc.split("\n");
  let open: { info: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (open === null) {
      const m = /^```(\w+)$/.exec(line);
      if (m !== null) open = { info: m[1] as string, lines: [] };
      else if (line !== "") throw new Error(`text outside a fence: ${JSON.stringify(line.slice(0, 80))}`);
      continue;
    }
    if (line === "```") {
      out.push({ info: open.info, body: open.lines.join("\n") });
      open = null;
      continue;
    }
    if (/^ {0,3}```/.test(line)) throw new Error("a line inside a fence could close it");
    open.lines.push(line);
  }
  if (open !== null) throw new Error("an unclosed fence");
  return out;
}
