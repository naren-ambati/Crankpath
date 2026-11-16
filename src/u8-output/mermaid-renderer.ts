// MermaidRenderer (U8, contract C8; BR8.7, BR8.8, FR8.3, NFR14, OD-18): the graph as a Mermaid
// flowchart inside a Markdown document, so it pastes into a runbook. Three fenced blocks: a text
// header (version, scanned repo, run status with its gaps, the cycles line, what is drawn), the
// `mermaid` diagram, and a text fallback listing the drawn nodes and edges (`from -> to  kind
// source`, each name quoted). Both text blocks are fenced as `text`, so no Markdown renderer reads
// repo text as markup; no line of the document starts with repo text, so none can close a fence.
//
// Every diagram label is one quoted Mermaid string: repo text through SafeText's Mermaid form (each
// Mermaid or HTML syntax character an entity code, control characters visible, long text cut), and
// crankpath's own words drawn from a fixed alphabet. Edges on a cycle are thick and say `on cycle`;
// declared edges are dotted and say `declared, unverified`; opaque nodes have a dashed border and say
// `opaque`; a legend names each style. Meaning is never carried by style alone.
//
// The cap (OD-18, docs/limits.md): the whole graph is drawn only when its diagram text is at most
// `mermaidMaxTextChars` and it has at most `mermaidMaxEdges` edges; otherwise only the cycle
// components are drawn (whole components, in cycle-id order, while they fit), and the header says
// so. Counts come from the Report; nothing here counts what the Report counts. The header says "the
// whole graph read" only for a run with no gap; a run with nothing analysed prints the M4 text in one
// text fence and no diagram.

import type { Edge, GraphNode, NodeId } from "../u1-graph-model/graph-model.js";
import { parseNodeId } from "../u1-graph-model/graph-model.js";
import { LIMITS } from "../u1-graph-model/limits.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import { quote } from "../u1-graph-model/safe-text.js";
import { PRINTABLE_KINDS } from "../u1-graph-model/vocabulary.js";
import type { Report } from "./report-model.js";
import { wrapLines } from "./text-layout.js";
import { cycles as cycleSection, nodeRef, renderTextLines, scannedLine, statusLines } from "./text-renderer.js";

/** crankpath's own words inside a Mermaid label: a closed alphabet with no Mermaid syntax character. */
const OWN_WORDS = /^[A-Za-z0-9 ,:./-]*$/;

function own(text: string): string {
  if (!OWN_WORDS.test(text)) throw new Error("MermaidRenderer: own words outside the fixed alphabet (a bug)");
  return text;
}

/** A node's label: the kind (or `object`/`external`) and its quoted name, plus crankpath's notes. */
function nodeLabel(n: GraphNode): string {
  const p = parseNodeId(n.id);
  let label: string;
  if (p === undefined) label = quote("object", n.id, "mermaid");
  else if (p.external) label = quote("external", p.name, "mermaid");
  else {
    const rest = p.namespace === null ? p.name : `${p.namespace}/${p.name}`;
    label = PRINTABLE_KINDS.has(p.kind) ? quote(p.kind, rest, "mermaid") : quote("object", n.id, "mermaid");
  }
  const notes: string[] = [];
  if (n.opaque !== null) notes.push(`opaque: ${n.opaque.reason}`);
  if (n.flags.includes("not-defined")) notes.push("not defined by any readable source");
  if (n.flags.includes("cluster-provided")) notes.push("provided by every cluster, assumed");
  if (n.flags.includes("conflicting-definitions")) notes.push("conflicting definitions");
  if (n.flags.includes("foreign-destination")) notes.push("foreign destination");
  // the quoted label ends with its closing quote; crankpath's notes go inside it
  return notes.length === 0 ? label : `${label.slice(0, -1)}, ${own(notes.join(", "))}"`;
}

interface Drawn {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly Edge[];
  /** Cycle ids of the edges drawn (an edge lies on at most one component). */
  readonly cycleOf: ReadonlyMap<string, string>;
  readonly whole: boolean;
  readonly componentsDrawn: number;
}

function edgeKey(e: { from: string; to: string; kind: string; source: string }): string {
  return `${e.from}\n${e.to}\n${e.kind}\n${e.source}`;
}

function edgeNotes(e: Edge, cycleOf: ReadonlyMap<string, string>): string[] {
  const notes: string[] = [e.kind, e.source === "declared" ? "declared, unverified" : "extracted"];
  if (e.orderingOnly) notes.push("ordering only");
  const c = cycleOf.get(edgeKey(e));
  if (c !== undefined) notes.push(`on cycle ${c}`);
  return notes;
}

function cycleLabels(r: Report): Map<string, string> {
  return new Map(r.cycles.map((c) => [c.id, c.label === "cranked" ? `${c.id}, cranked` : c.id]));
}

function diagramLines(nodes: readonly GraphNode[], edges: readonly Edge[], cycleOf: ReadonlyMap<string, string>) {
  const index = new Map(nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const out: string[] = ["flowchart LR"];
  for (const n of nodes) out.push(`  ${index.get(n.id)}[${nodeLabel(n)}]${n.opaque === null ? "" : ":::opaque"}`);
  for (const e of edges) {
    const arrow = e.source === "declared" ? "-.->" : cycleOf.has(edgeKey(e)) ? "==>" : "-->";
    out.push(`  ${index.get(e.from)} ${arrow}|"${own(edgeNotes(e, cycleOf).join(", "))}"| ${index.get(e.to)}`);
  }
  out.push(
    '  subgraph legend["Legend"]',
    "    direction LR",
    '    legend1["thick arrow: an edge on a cycle"]',
    '    legend2["thin arrow: an extracted edge on no cycle"]',
    '    legend3["dotted arrow: a declared edge, unverified"]',
    '    legend4["dashed border: an opaque node"]:::opaque',
    "  end",
    "  classDef opaque stroke-dasharray: 5 5",
  );
  return { lines: out, index };
}

function textSize(lines: readonly string[]): number {
  let n = 0;
  for (const l of lines) n += l.length + 1;
  return n;
}

/** The two Mermaid limits the cap uses (OD-18); tests pass smaller ones. */
export interface MermaidLimits {
  readonly maxEdges: number;
  readonly maxTextChars: number;
}

const DEFAULT_LIMITS: MermaidLimits = Object.freeze({
  maxEdges: LIMITS.mermaidMaxEdges.value,
  maxTextChars: LIMITS.mermaidMaxTextChars.value,
});

function choose(r: Report, limits: MermaidLimits): Drawn & { diagram: string[]; index: Map<NodeId, string> } {
  const labels = cycleLabels(r);
  const cycleOf = new Map<string, string>();
  for (const c of r.cycles) for (const e of c.edges) cycleOf.set(edgeKey(e), labels.get(c.id) ?? c.id);
  const maxEdges = limits.maxEdges;
  const maxText = limits.maxTextChars;
  if (r.edges.length <= maxEdges) {
    const whole = diagramLines(r.nodes, r.edges, cycleOf);
    if (textSize(whole.lines) <= maxText) {
      return {
        nodes: r.nodes,
        edges: r.edges,
        cycleOf,
        whole: true,
        componentsDrawn: r.cycles.length,
        diagram: whole.lines,
        index: whole.index,
      };
    }
  }
  // over the cap: whole cycle components, in id order, while the diagram still fits
  const nodeById = new Map(r.nodes.map((n) => [n.id, n]));
  const edgeByKey = new Map(r.edges.map((e) => [edgeKey(e), e]));
  let nodes: GraphNode[] = [];
  let edges: Edge[] = [];
  let drawn = diagramLines([], [], cycleOf);
  let components = 0;
  for (const c of r.cycles) {
    if (edges.length + c.edges.length > maxEdges) break;
    const nextNodes = nodes.concat(c.nodes.map((id) => nodeById.get(id)).filter((n): n is GraphNode => !!n));
    const nextEdges = edges.concat(c.edges.map((e) => edgeByKey.get(edgeKey(e))).filter((e): e is Edge => !!e));
    nextNodes.sort((a, b) => compareCodePoints(a.id, b.id));
    nextEdges.sort((a, b) => compareCodePoints(edgeKey(a), edgeKey(b)));
    const attempt = diagramLines(nextNodes, nextEdges, cycleOf);
    if (textSize(attempt.lines) > maxText) break;
    nodes = nextNodes;
    edges = nextEdges;
    drawn = attempt;
    components += 1;
  }
  return { nodes, edges, cycleOf, whole: false, componentsDrawn: components, diagram: drawn.lines, index: drawn.index };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function drawnLine(r: Report, d: Drawn, limits: MermaidLimits): string {
  const all = `${plural(r.nodes.length, "node", "nodes")}, ${plural(r.edges.length, "edge", "edges")}`;
  // "the whole graph read" only when nothing was opaque, skipped, unresolved or limited (review m6)
  if (d.whole && r.runStatus.state === "ANALYSED") return `drawn: the whole graph read (${all})`;
  if (d.whole)
    return `drawn: every node and edge of the graph as read (${all}); the run has gaps, listed above, so the estate may hold more`;
  const caps = `${limits.maxEdges.toLocaleString("en-US")} edges or ${limits.maxTextChars.toLocaleString("en-US")} characters`;
  const part = `${plural(d.nodes.length, "node", "nodes")} of ${r.nodes.length} and ${plural(d.edges.length, "edge", "edges")} of ${r.edges.length}`;
  if (d.nodes.length === 0) {
    // over the cap with no cycle component that fits: say nothing is drawn (review pass 2, n1)
    return `drawn: nothing: the graph as read (${all}) is over what Mermaid draws by default (${caps}) and no cycle component fits; every node and edge is in the JSON output and the cycles in the text report`;
  }
  const rest = r.cycles.length - d.componentsDrawn;
  const left = rest > 0 ? `; ${plural(rest, "cycle component is", "cycle components are")} not drawn either` : "";
  return `drawn: only the cycle components, ${d.componentsDrawn} of ${r.cycles.length} (${part}): the graph as read (${all}) is over what Mermaid draws by default (${caps})${left}; every node and edge is in the JSON output and the cycles in the text report`;
}

/** The Mermaid document's lines (text header, diagram, text fallback), without line ends. */
export function renderMermaidLines(r: Report, limits: MermaidLimits = DEFAULT_LIMITS): string[] {
  // nothing analysed: the M4 shape, as the text report prints it, and no diagram (review M2)
  if (r.runStatus.state === "NOTHING ANALYSED") return ["```text", ...renderTextLines(r), "```"];
  const d = choose(r, limits);
  const header: string[] = [`crankpath ${r.toolchain.crankpath}`, scannedLine(r)];
  statusLines(r, header);
  const cyclesLines: string[] = [];
  cycleSection(r, cyclesLines);
  header.push(cyclesLines[0] ?? "Cycles: not listed");
  header.push(drawnLine(r, d, limits));
  const fallback: string[] = ["Text fallback: the nodes and edges drawn above.", `nodes: ${d.nodes.length}`];
  for (const n of d.nodes) {
    const note = n.opaque === null ? "" : `  opaque: ${n.opaque.reason}`;
    fallback.push(`  ${d.index.get(n.id)}  ${nodeRef(n.id)}${note}`);
  }
  fallback.push(`edges: ${d.edges.length} (from -> to  kind  source)`);
  for (const e of d.edges) {
    const c = d.cycleOf.get(edgeKey(e));
    const source = e.source === "declared" ? "declared (unverified)" : "extracted";
    const order = e.orderingOnly ? "  ordering only" : "";
    fallback.push(
      `  ${nodeRef(e.from)} -> ${nodeRef(e.to)}  ${e.kind}  ${source}${order}${c === undefined ? "" : `  cycle: ${c}`}`,
    );
  }
  if (!d.whole) fallback.push("the rest of the graph is in the JSON output (--format json)");
  return [
    "```text",
    ...wrapLines(header),
    "```",
    "",
    "```mermaid",
    ...d.diagram,
    "```",
    "",
    "```text",
    ...wrapLines(fallback),
    "```",
  ];
}

/** The Mermaid document as one string. */
export function renderMermaid(r: Report, limits: MermaidLimits = DEFAULT_LIMITS): string {
  return `${renderMermaidLines(r, limits).join("\n")}\n`;
}
