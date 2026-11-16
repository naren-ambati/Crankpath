// ExplainRenderer (U8; US8.4, US5.4, BR8.9, BR8.10, BR5.12, BR5.13, FR8.4, FR7.7, OD-2, OD-16):
// `--explain [id]`, the evidence trail behind a cycle or a node, so a reader can check each finding
// against the repo. For a cycle: its nodes, numbered; every edge with the file, field, rendered
// path and line it was read from, each quoted after a fixed label; its elementary cycles up to the
// derived bound (`explainElementaryCycles`), saying when the listing stopped; the self-management
// pattern when a source on the cycle renders a workload with a GitOps controller's upstream name and
// labels (ControllerSignatures: worded as an observation of what the repo set and a conditional,
// never a conclusion; it changes no label, status or verdict); how many nodes it blocks. For a node:
// where it was read, its status and blockers, its opacity, the cycle it is on, its dependencies with
// their evidence, its dependents and its unresolved items. Every explanation ends with the plan's
// assumptions and the not-modelled list. Same 80-column layout as the text report; repo text never
// starts a line.
//
// Bounds (B6 review m4, pass 2 M1): every list goes through one helper, `capped`, which shows at
// most its derived bound (`explainListEntries`, or `explainEdgeEntries` for four-line edge entries)
// and says how many it left out, pointing to the JSON output only for what the JSON carries. The
// whole output holds at most `explainOutputLines` lines: whole explanations while they fit; an
// explanation's own closing lines are reserved before its body is filled, so no planted list can cut
// them; the close (assumptions, not modelled) is always printed.
//
// Without an id every cycle is explained. An id that names no cycle and no node is the caller's
// usage error (`explainTarget` says which it is).

import type { Edge, NodeId } from "../u1-graph-model/graph-model.js";
import { parseNodeId } from "../u1-graph-model/graph-model.js";
import { LIMITS } from "../u1-graph-model/limits.js";
import { quote } from "../u1-graph-model/safe-text.js";
import { EDGE_WORDS } from "../u1-graph-model/vocabulary.js";
import type { Cycle, EdgeRef } from "../u7-graph-analysis/cycle-finder.js";
import { elementaryCycles } from "./elementary-cycles.js";
import type { Report } from "./report-model.js";
import { wrapLine, wrapLines } from "./text-layout.js";
import { assumedLine, crankRef, cycles as cycleSection, nodeRef, scannedLine, statusLines } from "./text-renderer.js";

const T = "terminal";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type ExplainTarget = { kind: "all" } | { kind: "cycle"; cycle: Cycle } | { kind: "node"; node: NodeId };

/** What an `--explain` id names in this report, or undefined when it names nothing. */
export function explainTarget(r: Report, id: string | undefined): ExplainTarget | undefined {
  if (id === undefined) return { kind: "all" };
  const cycle = r.cycles.find((c) => c.id === id);
  if (cycle !== undefined) return { kind: "cycle", cycle };
  if (r.nodes.some((n) => n.id === id)) return { kind: "node", node: id };
  return undefined;
}

/**
 * The one capped-list helper: at most `bound` entries, and what was left out. `inJson` says whether
 * the JSON output carries the whole list; only then does a pointer send the reader there.
 */
interface Capped<T> {
  readonly shown: readonly T[];
  readonly left: number;
  readonly total: number;
  /** For a list printed on its own lines: the sentence after its heading, or "" when nothing was left out. */
  readonly rest: string;
  /** For a list printed inline: the words after its last entry, or "" when nothing was left out. */
  readonly more: (noun: string) => string;
}

function capped<T>(list: readonly T[], bound: number, inJson: boolean, what = "observations"): Capped<T> {
  const left = Math.max(0, list.length - bound);
  const shown = left === 0 ? list : list.slice(0, bound);
  const where = inJson ? "in the JSON output" : `not printed (the JSON output does not carry these ${what})`;
  return {
    shown,
    left,
    total: list.length,
    rest: left === 0 ? "" : inJson ? `the other ${left} are in the JSON output` : `${left} more ${where}`,
    more: (noun) => {
      if (left === 0) return "";
      const what = noun === "" ? `${left} more` : `${left} more ${noun}`;
      return inJson ? ` and ${what} (${where})` : ` and ${what}; ${where}`;
    },
  };
}

function edgeKey(e: { from: string; to: string; kind: string; source: string }): string {
  return `${e.from}\n${e.to}\n${e.kind}\n${e.source}`;
}

function edgeLines(e: EdgeRef, i: number, n: number, evidence: Edge | undefined, out: string[]): void {
  const source = e.source === "declared" ? "declared, unverified" : "extracted";
  const order = evidence?.orderingOnly === true ? ", ordering only" : "";
  out.push(
    `    edge ${i} of ${n}  ${nodeRef(e.from)} ${EDGE_WORDS[e.kind] ?? e.kind} ${nodeRef(e.to)}  (${e.kind}, ${source}${order})`,
  );
  if (evidence === undefined) {
    out.push("      evidence: not in the report (a bug)");
    return;
  }
  const ev = evidence.evidence;
  out.push(`      ${quote("file:", ev.file, T)}  line: ${ev.line === null ? "not recorded" : ev.line}`);
  out.push(`      ${quote("field:", ev.field, T)}`);
  out.push(`      ${quote("rendered path:", ev.renderedPath, T)}`);
}

const OWNER_KINDS = /^(Application|Kustomization|HelmRelease)\//;

/**
 * The self-management notes (US5.4, review M1, pass 2 M1 and m1): labelled observations of what the
 * repo set (a workload with a controller's upstream name and labels, rendered by a source on the
 * cycle), then the documented pattern as a conditional; capped, and the rest counted as not printed
 * (the JSON output does not carry these observations).
 */
function selfManagement(
  r: Report,
  owners: readonly NodeId[],
  onCycle: ReadonlySet<NodeId>,
  form: "cycle" | "node",
  out: string[],
): void {
  const set = new Set(owners);
  const found = capped(
    r.controllerMatches.filter((m) => set.has(m.owner)),
    LIMITS.explainListEntries.value,
    false,
  );
  if (found.total === 0) {
    out.push(
      `  self-management: none named (${form === "node" ? "it renders no object" : "no source on this cycle renders an object"} matching the Argo CD or Flux controller signatures)`,
    );
    return;
  }
  for (const m of found.shown) {
    const kind = parseNodeId(m.owner);
    const who =
      form === "cycle"
        ? `this cycle's ${nodeRef(m.owner)}`
        : `this ${kind !== undefined && !kind.external ? kind.kind : "source"}`;
    const off = onCycle.has(m.object) ? "" : "; this object is not on the cycle";
    out.push(
      `  self-management: pattern: an object ${who} renders, ${nodeRef(m.object)}, carries the name and labels ${m.controller} uses (name and labels set by the repo, not verified${off}); if this is the controller's own install, a first-install crank breaks it`,
    );
  }
  if (found.left > 0) out.push(`  ${found.more("objects match a controller signature").trimStart()}`);
}

function crankLines(r: Report, c: Cycle, out: string[]): void {
  const byId = new Map(r.cranks.map((k) => [k.crank, k]));
  const text = (ids: readonly string[]) => {
    const list = capped(ids, LIMITS.explainListEntries.value, true);
    return `${list.shown.map((id) => crankRef(id, byId.get(id)?.by ?? "")).join("; ")}${list.more("cranks")}`;
  };
  if (c.crankedBy.length > 0) out.push(`  cranked by: ${text(c.crankedBy)}  (documented, not verified)`);
  if (c.residual !== null)
    out.push(
      `  touched by: ${text(c.touchedBy)}  (documented, not verified); not broken: ${plural(c.residual.length, "node is", "nodes are")} still on a cycle`,
    );
  if (c.introducedBy.length > 0)
    out.push(`  exists only once the cranks are applied; closed by: ${text(c.introducedBy)}`);
}

/** One explanation: its body, then its own closing lines, which a cut never removes. */
interface Block {
  readonly body: string[];
  readonly closing: string[];
}

function explainCycle(r: Report, c: Cycle, edgeBy: ReadonlyMap<string, Edge>): Block {
  const out: string[] = [];
  const label = c.label === "cranked" ? `cranked (was ${c.labelBeforeCranks})` : c.label;
  out.push(`cycle ${c.id}  label: ${label}  nodes: ${c.nodes.length}  edges: ${c.edges.length}`);
  crankLines(r, c, out);
  const listing = elementaryCycles(c.nodes, c.edges, LIMITS.explainElementaryCycles.value);
  const k = LIMITS.explainListEntries.value;
  const nodes = capped(listing.nodes, k, true);
  out.push(
    nodes.left === 0
      ? "  nodes, numbered for the elementary cycles below:"
      : `  nodes, numbered in the order of the JSON's cycles[].nodes: the first ${k} of ${listing.nodes.length} listed; elementary cycles name the others by id`,
  );
  nodes.shown.forEach((id, i) => {
    out.push(`    node ${i + 1}  ${nodeRef(id)}`);
  });
  const e = LIMITS.explainEdgeEntries.value;
  const edges = capped(c.edges, e, true);
  out.push(
    edges.left === 0
      ? `  evidence for each of the ${plural(c.edges.length, "edge", "edges")} (file, field, rendered path, line):`
      : `  evidence for the first ${e} of ${c.edges.length} edges (file, field, rendered path, line); ${edges.rest}`,
  );
  edges.shown.forEach((x, i) => {
    edgeLines(x, i + 1, c.edges.length, edgeBy.get(edgeKey(x)), out);
  });
  const bound = listing.bound;
  out.push(
    listing.stopped
      ? `  elementary cycles: the first ${bound} found (as node sequences); stopped at the bound of ${bound}`
      : `  elementary cycles: ${listing.cycles.length}, all of them (as node sequences; the bound is ${bound})`,
  );
  // a node the list above shows is named by its number, any other by its id (review pass 2, m3)
  const name = (v: number) => (v < nodes.shown.length ? `node ${v + 1}` : nodeRef(listing.nodes[v] as NodeId));
  listing.cycles.forEach((seq, i) => {
    const steps = capped(seq, k, true);
    const shown = steps.shown.map(name).join(" -> ");
    const first = name(seq[0] as number);
    const back = steps.left === 0 ? ` -> ${first}` : ` ... and ${steps.left} more nodes back to ${first}`;
    out.push(`    path ${i + 1}  ${shown}${back}`);
  });
  if (listing.stopped) {
    out.push(
      "    stopped: more elementary cycles exist; every node and edge on any of them is in this cycle's node and edge sets (the JSON output lists them all), and the cycle is the whole component either way",
    );
  }
  const closing: string[] = [];
  selfManagement(
    r,
    c.nodes.filter((id) => OWNER_KINDS.test(id)),
    new Set(c.nodes),
    "cycle",
    closing,
  );
  const group = r.notStartable.find((g) => g.reason === "cycle" && g.blocker === c.id);
  const blocked = group?.nodes.length ?? 0;
  closing.push(
    blocked > 0
      ? `  nodes blocked by this cycle: ${blocked} (the text report lists them under Not startable from a cold start)`
      : `  nodes blocked by this cycle: 0${c.label === "cranked" ? " (it is cranked: documented, not verified)" : ""}`,
  );
  return { body: out, closing };
}

function explainNode(r: Report, id: NodeId, edgeBy: ReadonlyMap<string, Edge>): Block {
  const out: string[] = [];
  const closing: string[] = [];
  const node = r.nodes.find((n) => n.id === id);
  if (node === undefined) return { body: out, closing };
  const k = LIMITS.explainListEntries.value;
  out.push(`node ${nodeRef(id)}`);
  const o = node.origin;
  if (o.path === null) out.push("  read from: no file (a node crankpath made: a reference target or an external)");
  else {
    const job = o.renderJob === null ? "read directly from the repository" : quote("render job:", o.renderJob, T);
    out.push(`  read from: ${quote("file:", o.path, T)}  document: ${o.document ?? "not recorded"}  ${job}`);
  }
  if (node.flags.length > 0) out.push(`  flags: ${node.flags.join(", ")}`);
  const verdict = r.statuses.find((s) => s.node === id);
  if (verdict !== undefined) {
    const via = verdict.via === null ? "" : `  via ${nodeRef(verdict.via)}`;
    const list = capped(verdict.blockers, k, true);
    const blockers =
      list.total === 0
        ? ""
        : `  ${plural(list.total, "blocker", "blockers")}: ${list.shown.map((b) => (b.startsWith("c-") ? `cycle ${b}` : nodeRef(b))).join(", ")}${list.more("")}`;
    out.push(
      `  status: ${verdict.status}${verdict.reason === null ? "" : `  reason: ${verdict.reason}`}${blockers}${via}`,
    );
  }
  if (node.opaque !== null) {
    out.push(`  opaque: reason: ${node.opaque.reason}  could not see: ${node.opaque.lostEdges.join("; ")}`);
  }
  const cyclesOn = r.cycles.filter((c) => c.nodes.includes(id));
  const on = capped(
    cyclesOn.map((c) => `cycle ${c.id} (${c.label})`),
    k,
    true,
  );
  out.push(`  on a cycle: ${on.total === 0 ? "no" : on.shown.join(", ")}${on.more("cycles")}`);
  const e = LIMITS.explainEdgeEntries.value;
  const deps = capped(
    r.edges.filter((x) => x.from === id),
    e,
    true,
  );
  out.push(
    deps.left === 0
      ? `  dependencies: ${plural(deps.total, "edge", "edges")}, each with where it was read:`
      : `  dependencies: ${deps.total} edges; the first ${e}, each with where it was read; ${deps.rest}`,
  );
  deps.shown.forEach((x, i) => {
    edgeLines(x, i + 1, deps.total, edgeBy.get(edgeKey(x)), out);
  });
  const dependents = capped(
    r.edges.filter((x) => x.to === id),
    k,
    true,
  );
  out.push(
    dependents.left === 0
      ? `  dependents: ${plural(dependents.total, "edge", "edges")}`
      : `  dependents: ${dependents.total} edges; the first ${k}; ${dependents.rest}`,
  );
  for (const x of dependents.shown)
    out.push(`    ${nodeRef(x.from)} ${EDGE_WORDS[x.kind] ?? x.kind} it  (${x.kind}, ${x.source})`);
  const owned = capped(
    r.unresolved.filter((u) => u.owner === id || u.subject === id),
    k,
    true,
  );
  out.push(
    owned.left === 0
      ? `  unresolved items on it: ${owned.total}`
      : `  unresolved items on it: ${owned.total}; the first ${k}; ${owned.rest}`,
  );
  for (const u of owned.shown) out.push(`    unresolved: ${u.why}  ${quote("where:", u.where, T)}`);
  if (OWNER_KINDS.test(id)) {
    // the pattern is about cycles: a source on no cycle names none
    if (cyclesOn.length === 0) closing.push("  self-management: none named (it is on no cycle)");
    else selfManagement(r, [id], new Set(cyclesOn.flatMap((c) => c.nodes)), "node", closing);
  }
  const step = r.plan.steps.find((s) => s.nodes.includes(id));
  closing.push(
    step !== undefined
      ? `  plan: step ${step.no} (${step.kind})`
      : r.plan.listedUnordered.some((l) => l.node === id)
        ? "  plan: not ordered (blocked or unverified)"
        : "  plan: not a start step (an external, an object every cluster provides, or one a crank creates)",
  );
  return { body: out, closing };
}

function tail(r: Report, out: string[]): void {
  out.push("");
  out.push(assumedLine(r));
  out.push(`Not modelled (${r.notModelled.length} items): ${r.notModelled.join("; ")}.`);
}

/** Output lines the logical lines take at 80 columns. */
function cost(lines: readonly string[]): number {
  let n = 0;
  for (const l of lines) n += wrapLine(l).length;
  return n;
}

export interface ExplainOptions {
  /** The output bound in lines; defaults to the derived `explainOutputLines` (tests pass smaller). */
  readonly outputLines?: number;
}

/**
 * The explanation's logical lines (before the 80-column layout), at most `explainOutputLines` once
 * laid out: whole explanations while they fit, then a stop line saying how many cycles were left
 * out; one explanation too large for the bound keeps its own closing lines and says how many of
 * its lines are not printed. The target must come from explainTarget.
 */
export function explainLogicalLines(r: Report, target: ExplainTarget, options: ExplainOptions = {}): string[] {
  const top: string[] = [];
  const id = target.kind === "cycle" ? target.cycle.id : target.kind === "node" ? target.node : null;
  top.push(`crankpath ${r.toolchain.crankpath} ${id === null ? "explain: every cycle" : quote("explain:", id, T)}`);
  top.push(scannedLine(r));
  statusLines(r, top);
  top.push("");
  const end: string[] = [];
  tail(r, end);
  const edgeBy = new Map(r.edges.map((e) => [edgeKey(e), e]));
  const blocks: Block[] = [];
  if (target.kind === "node") blocks.push(explainNode(r, target.node, edgeBy));
  else if (target.kind === "cycle") blocks.push(explainCycle(r, target.cycle, edgeBy));
  else if (r.cycles.length === 0) {
    const b: string[] = [];
    cycleSection(r, b);
    b.push("no cycle to explain; name a node id to see its evidence (--explain <node id>)");
    blocks.push({ body: b, closing: [] });
  } else {
    for (const c of r.cycles) {
      const b = explainCycle(r, c, edgeBy);
      blocks.push(blocks.length === 0 ? b : { body: ["", ...b.body], closing: b.closing });
    }
  }
  const budget = options.outputLines ?? LIMITS.explainOutputLines.value;
  const bound = budget.toLocaleString("en-US");
  const stopReserve = 3; // a blank line and a stop line of up to two output lines
  let used = cost(top) + cost(end) + stopReserve;
  const out = [...top];
  let explained = 0;
  for (const b of blocks) {
    const c = cost(b.body) + cost(b.closing);
    if (used + c <= budget) {
      out.push(...b.body, ...b.closing);
      used += c;
      explained += 1;
      continue;
    }
    if (explained === 0) {
      // even one explanation does not fit: its closing lines are reserved, then its body fills the rest
      used += cost(b.closing);
      let printed = 0;
      for (const line of b.body) {
        const lc = wrapLine(line).length;
        if (used + lc > budget) break;
        out.push(line);
        used += lc;
        printed += 1;
      }
      const notPrinted = cost(b.body.slice(printed));
      out.push(
        `  stopped: the explanation reached its bound of ${bound} lines; ${notPrinted} more lines of this explanation are not printed here`,
        ...b.closing,
      );
    } else {
      const left = blocks.length - explained;
      out.push(
        "",
        `stopped: the explanation reached its bound of ${bound} lines; ${left} of ${blocks.length} cycles are not explained here (--explain <cycle id> explains one)`,
      );
    }
    break;
  }
  out.push(...end);
  return out;
}

/** The explanation's output lines at 80 columns. */
export function renderExplainLines(r: Report, target: ExplainTarget, options: ExplainOptions = {}): string[] {
  return wrapLines(explainLogicalLines(r, target, options));
}

export function renderExplain(r: Report, target: ExplainTarget, options: ExplainOptions = {}): string {
  return `${renderExplainLines(r, target, options).join("\n")}\n`;
}
