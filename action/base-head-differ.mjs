// BaseHeadDiffer (U10, contract C10; BR10.1 to BR10.3, BR10.7 to BR10.10; OD-11, OD-24, OD-27,
// OD-30): decides which head cycles are new by comparing two crankpath JSON reports (schema
// version 1). Pure: no I/O, no clock, no environment; the same two reports give the same result.
//
// A head cycle is new when it is uncranked (label `extracted` or `declared (unverified)`) and
// (a) one of its edges, identified by (from, to, kind), is absent from the base graph (OD-24:
// every edge of a strongly connected component lies on a cycle, so this is exact; a renamed node
// makes its cycle new), or (b) its edges all exist in the base but the base component holding them
// was `cranked` there (a crank the pull request removed or broke, OD-27 a). A cycle that appears
// only because a source became readable has edges the base lacks, so it is new (OD-27 d).
// Cranks, declared edges, externals, match entries and repos: mappings the head adds or changes
// are honoured (the head's own analysis applied them) and listed as documented by the pull request
// author, not verified (OD-27 b, FR10.5). NOTHING ANALYSED or a timeout on either side is
// NOT CHECKED (OD-27 c, OD-30); the caller adds the NOT CHECKED reasons only it can see (no base
// commit, a shallow checkout, a tool error).
//
// The order of the decision (B8 review pass 2, lead decisions m1 and m2): new uncranked cycles are
// found first, and any makes the result FAILED. Only when there is none, every gap item of the head
// with no equal item in the base (an opaque source by node and reason, an unreadable file by path,
// a skipped object by file, document and item, an unresolved item by subject, reason and where, a
// submodule by path, and the count of edges not kept over the run limit, which has no item list)
// makes it NOT CHECKED, as does every declared fact that changes the graph the base did not rely on
// (a declared edge, a match override, a crankpath.yaml repos: mapping a source was read through).
// Items are matched one by one: removing a gap the base had never makes up for a new one.
//
// Self-contained on purpose (no import of the build): it runs in the Action right after the
// build and in the tests without one. Repo-derived strings stay as the CLI escaped them; the
// summary module quotes them for each destination.

/** @typedef {"FAILED" | "NO_NEW_CYCLES_FOUND" | "NOT_CHECKED"} ActionResult */
/** @typedef {{ from: string, to: string, kind: string, source: string }} CycleEdge */
/** @typedef {{ file: string, line: number | null }} Evidence */
/** @typedef {{ from: string, to: string, kind: string, source: string, orderingOnly: boolean, evidence: Evidence, key?: string }} ReportEdge */
/**
 * @typedef {{ id: string, label: string, labelBeforeCranks: string, nodes: string[], edges: CycleEdge[],
 *   crankedBy: string[], touchedBy: string[], introducedBy: string[], residual: string[] | null }} ReportCycle
 */
/** @typedef {{ from: string, to: string }} Reroute */
/**
 * @typedef {{ id: string, by: string, ref: string | null, createdNodes: string[], reroutedEdges: Reroute[],
 *   matched: boolean, keyPath: string }} ReportCrank
 */
/** @typedef {{ id: string, coldStart: string, servedBy: string | null }} ReportExternal */
/** @typedef {{ id: string, label: string, nodeIds: string[], hiddenBy: string[] }} ReportHiddenCycle */
/** @typedef {{ host: string, keyPath: string, declared: string, key: string }} ReportMatchOverride */
/** @typedef {{ from: string, url: string, root: string, used: boolean, key: string }} ReportRepoMapping */
/** @typedef {{ node: string | null, kustomizeRoot: string | null, reason: string, key: string }} ReportOpaque */
/** @typedef {{ path: string, reasonWord: string, key: string }} ReportUnreadable */
/** @typedef {{ file: string, document: number, item: number | null, reason: string, key: string }} ReportSkipped */
/** @typedef {{ subject: string, why: string, where: string, key: string }} ReportUnresolved */
/**
 * A gap or declared fact of the head with no equal item in the base.
 * @typedef {{ kind: "opaque", node: string | null, kustomizeRoot: string | null, reason: string }
 *   | { kind: "unreadable", path: string, reasonWord: string }
 *   | { kind: "skipped", file: string, document: number, item: number | null, reason: string }
 *   | { kind: "unresolved", subject: string, why: string, where: string }
 *   | { kind: "run-limit-edges", base: number, head: number }
 *   | { kind: "submodule", path: string }
 *   | { kind: "declared-edge", edge: ReportEdge }
 *   | { kind: "match-override", host: string, declared: string }
 *   | { kind: "repo-mapping", url: string, root: string }} GapItem
 */
/**
 * @typedef {{ state: string, floor: boolean, reasons: string[], opaque: number, skipped: number,
 *   unreadableFiles: number, unresolved: number, timeouts: number, runLimitFiles: number,
 *   runLimitJobs: number, runLimitEdges: number, declaredFacts: number, submodules: number }} RunSummary
 */
/**
 * The fields of a crankpath report the Action reads, checked for shape (everything else is ignored,
 * as C7 tells consumers to do). `submodules` is the Action's own list (paths of gitlinks in the
 * copied commit); readReport leaves it empty and the caller fills it.
 * @typedef {{ run: RunSummary, edges: ReportEdge[], cycles: ReportCycle[], cranks: ReportCrank[],
 *   externals: ReportExternal[], hiddenCycles: ReportHiddenCycle[], matchOverrides: ReportMatchOverride[],
 *   repoMappings: ReportRepoMapping[], opaque: ReportOpaque[], unreadable: ReportUnreadable[],
 *   skipped: ReportSkipped[], unresolved: ReportUnresolved[], submodules: string[] }} ActionReport
 */
/**
 * @typedef {{ cycle: ReportCycle, why: "new-edges" | "crank-removed" | "no-base-component",
 *   newEdges: ReportEdge[], baseEdgesPresent: number, baseCycle: ReportCycle | null,
 *   baseCranks: ReportCrank[] }} NewCycle
 */
/**
 * @typedef {{ cranks: ReportCrank[], declaredEdges: ReportEdge[], externals: ReportExternal[],
 *   matchOverrides: ReportMatchOverride[], repoMappings: ReportRepoMapping[] }} DeclaredChanges
 */
/**
 * @typedef {{ side: "base" | "head" | "both", code: string, value?: string, exit?: number, count?: number,
 *   limit?: { name: string, value: number, unit: string },
 *   over?: { path: string, size: number, unit: string }[] }} NotCheckedReason
 */
/**
 * A head cycle that is cranked: how many of its edges the base lacks, and whether a crank this pull
 * request adds is among those that broke it (B8 review m4).
 * @typedef {{ cycle: ReportCycle, newEdges: number, addedByPr: boolean }} CrankedCycle
 */
/**
 * @typedef {{ result: ActionResult, notChecked: NotCheckedReason[], newCycles: NewCycle[],
 *   unchangedCycles: ReportCycle[], crankedInHead: CrankedCycle[], headCranks: ReportCrank[],
 *   declared: DeclaredChanges, hiddenNew: ReportHiddenCycle[], newGaps: GapItem[], newDeclared: GapItem[],
 *   base: RunSummary | null,
 *   head: RunSummary | null }} DiffResult
 */

/** Code-point order (the CLI's order rule), never the locale's. */
export function compareCodePoints(/** @type {string} */ a, /** @type {string} */ b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** An edge's identity across base and head (OD-24, NFR2.1): no path, line or label in it. */
export function edgeKey(/** @type {{ from: string, to: string, kind: string }} */ e) {
  return JSON.stringify([e.from, e.to, e.kind]);
}

/**
 * An item's full key: every field the report carries for it, objects with their keys sorted, so
 * two items are the same item only when the report says the same about them (B8 review pass 3, M1).
 */
export function canonical(/** @type {unknown} */ v) {
  /** @returns {unknown} */
  const sort = (/** @type {unknown} */ x) => {
    if (Array.isArray(x)) return x.map(sort);
    if (x !== null && typeof x === "object") {
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const k of Object.keys(x).sort(compareCodePoints))
        out[k] = sort(/** @type {Record<string, unknown>} */ (x)[k]);
      return out;
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

const STATES = new Set(["ANALYSED", "ANALYSED WITH GAPS", "NOTHING ANALYSED"]);
const LABELS = new Set(["extracted", "declared (unverified)", "cranked"]);
const UNCRANKED = new Set(["extracted", "declared (unverified)"]);

class Shape extends Error {}

/** @returns {Record<string, unknown>} */
function obj(/** @type {unknown} */ v) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Shape();
  return /** @type {Record<string, unknown>} */ (v);
}
/** @returns {unknown[]} */
function arr(/** @type {unknown} */ v) {
  if (!Array.isArray(v)) throw new Shape();
  return v;
}
function str(/** @type {unknown} */ v) {
  if (typeof v !== "string") throw new Shape();
  return v;
}
function strOrNull(/** @type {unknown} */ v) {
  return v === null ? null : str(v);
}
function int(/** @type {unknown} */ v) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Shape();
  return v;
}
function bool(/** @type {unknown} */ v) {
  if (typeof v !== "boolean") throw new Shape();
  return v;
}
function strs(/** @type {unknown} */ v) {
  return arr(v).map(str);
}
function word(/** @type {unknown} */ v, /** @type {Set<string>} */ words) {
  const w = str(v);
  if (!words.has(w)) throw new Shape();
  return w;
}

/** @returns {CycleEdge} */
function cycleEdge(/** @type {unknown} */ v) {
  const o = obj(v);
  return { from: str(o.from), to: str(o.to), kind: str(o.kind), source: str(o.source) };
}

/**
 * Reads the fields the Action uses from a parsed report; undefined when the value is not a crankpath
 * report of schema version 1 (the caller says NOT CHECKED: the report could not be read).
 * @returns {ActionReport | undefined}
 */
export function readReport(/** @type {unknown} */ json) {
  try {
    const r = obj(json);
    if (r.schemaVersion !== 1) return undefined;
    const rs = obj(r.runStatus);
    const c = obj(rs.counts);
    /** @type {RunSummary} */
    const run = {
      state: word(rs.state, STATES),
      floor: bool(rs.floor),
      reasons: strs(rs.reasons),
      opaque: int(c.opaque),
      skipped: int(c.skipped),
      unreadableFiles: int(c.unreadableFiles),
      unresolved: int(c.unresolved),
      timeouts: int(c.timeouts),
      runLimitFiles: int(c.runLimitFiles),
      runLimitJobs: int(c.runLimitJobs),
      runLimitEdges: int(c.runLimitEdges),
      declaredFacts: int(c.declaredFacts),
      // the Action's own count (unreadable submodules); the caller sets it from the copied tree
      submodules: 0,
    };
    const edges = arr(r.edges).map((v) => {
      const o = obj(v);
      const ev = obj(o.evidence);
      const line = ev.line === null ? null : int(ev.line);
      return {
        from: str(o.from),
        to: str(o.to),
        kind: str(o.kind),
        source: str(o.source),
        orderingOnly: bool(o.orderingOnly),
        evidence: { file: str(ev.file), line },
        key: canonical(v),
      };
    });
    const cycles = arr(r.cycles).map((v) => {
      const o = obj(v);
      return {
        id: str(o.id),
        label: word(o.label, LABELS),
        labelBeforeCranks: str(o.labelBeforeCranks),
        nodes: strs(o.nodes),
        edges: arr(o.edges).map(cycleEdge),
        crankedBy: strs(o.crankedBy),
        touchedBy: strs(o.touchedBy),
        introducedBy: strs(o.introducedBy),
        residual: o.residual === null ? null : strs(o.residual),
      };
    });
    const cranks = arr(r.cranks).map((v) => {
      const o = obj(v);
      return {
        id: str(o.id),
        by: str(o.by),
        ref: strOrNull(o.ref),
        createdNodes: strs(o.createdNodes),
        reroutedEdges: arr(o.reroutedEdges).map((x) => {
          const e = obj(x);
          return { from: str(e.from), to: str(e.to) };
        }),
        matched: bool(o.matched),
        keyPath: str(o.keyPath),
      };
    });
    const externals = arr(r.externals).map((v) => {
      const o = obj(v);
      return { id: str(o.id), coldStart: str(o.coldStart), servedBy: strOrNull(o.servedBy) };
    });
    const hiddenCycles = arr(r.hiddenCycles).map((v) => {
      const o = obj(v);
      return { id: str(o.id), label: str(o.label), nodeIds: strs(o.nodeIds), hiddenBy: strs(o.hiddenBy) };
    });
    const matchOverrides = arr(r.matchOverrides).map((v) => {
      const o = obj(v);
      return { host: str(o.host), keyPath: str(o.keyPath), declared: str(o.declared), key: canonical(v) };
    });
    const repoMappings = arr(r.repoMappings).map((v) => {
      const o = obj(v);
      return { from: str(o.from), url: str(o.url), root: str(o.root), used: bool(o.used), key: canonical(v) };
    });
    const opaque = arr(r.opaque).map((v) => {
      const o = obj(v);
      return {
        node: strOrNull(o.node),
        kustomizeRoot: strOrNull(o.kustomizeRoot),
        reason: str(o.reason),
        key: canonical(v),
      };
    });
    const unreadable = arr(r.unreadable).map((v) => {
      const o = obj(v);
      return { path: str(o.path), reasonWord: str(o.reasonWord), key: canonical(v) };
    });
    const skipped = arr(r.skipped).map((v) => {
      const o = obj(v);
      return {
        file: str(o.file),
        document: int(o.document),
        item: o.item === null ? null : int(o.item),
        reason: str(o.reason),
        key: canonical(v),
      };
    });
    const unresolved = arr(r.unresolved).map((v) => {
      const o = obj(v);
      return { subject: str(o.subject), why: str(o.why), where: str(o.where), key: canonical(v) };
    });
    return {
      run,
      edges,
      cycles,
      cranks,
      externals,
      hiddenCycles,
      matchOverrides,
      repoMappings,
      opaque,
      unreadable,
      skipped,
      unresolved,
      submodules: [],
    };
  } catch (e) {
    if (e instanceof Shape) return undefined;
    throw e;
  }
}

/** A NOT CHECKED result for reasons the caller found (no base, shallow checkout, tool error, ...). */
export function notCheckedResult(
  /** @type {NotCheckedReason[]} */ reasons,
  /** @type {RunSummary | null} */ base = null,
  /** @type {RunSummary | null} */ head = null,
) {
  if (reasons.length === 0) throw new Error("BaseHeadDiffer: NOT CHECKED needs a reason (a bug)");
  /** @type {DiffResult} */
  const result = {
    result: "NOT_CHECKED",
    notChecked: reasons,
    newCycles: [],
    unchangedCycles: [],
    crankedInHead: [],
    headCranks: [],
    declared: { cranks: [], declaredEdges: [], externals: [], matchOverrides: [], repoMappings: [] },
    hiddenNew: [],
    newGaps: [],
    newDeclared: [],
    base,
    head,
  };
  return Object.freeze(result);
}

/**
 * The head's items that the base does not hold, as a multiset over their keys (B8 review pass 3,
 * M1): each base item matches one equal head item, so a second equal item in the head is new.
 */
function newItems(
  /** @type {readonly any[]} */ base,
  /** @type {readonly any[]} */ head,
  /** @type {(x: any) => string} */ key,
) {
  /** @type {Map<string, number>} */
  const left = new Map();
  for (const b of base) left.set(key(b), (left.get(key(b)) ?? 0) + 1);
  const out = [];
  for (const h of head) {
    const n = left.get(key(h)) ?? 0;
    if (n > 0) left.set(key(h), n - 1);
    else out.push(h);
  }
  return out;
}

/**
 * The gap items and the graph-changing declared facts of the head that the base did not have.
 * @returns {{ gaps: GapItem[], declared: GapItem[] }}
 */
export function newGapItems(/** @type {ActionReport} */ base, /** @type {ActionReport} */ head) {
  const k = (/** @type {unknown[]} */ ...parts) => JSON.stringify(parts);
  /** @type {GapItem[]} */
  const gaps = [
    ...newItems(base.opaque, head.opaque, (o) => o.key).map(
      (/** @type {ReportOpaque} */ o) =>
        /** @type {GapItem} */ ({ kind: "opaque", node: o.node, kustomizeRoot: o.kustomizeRoot, reason: o.reason }),
    ),
    ...newItems(base.unreadable, head.unreadable, (u) => u.key).map(
      (/** @type {ReportUnreadable} */ u) =>
        /** @type {GapItem} */ ({ kind: "unreadable", path: u.path, reasonWord: u.reasonWord }),
    ),
    ...newItems(base.skipped, head.skipped, (x) => x.key).map(
      (/** @type {ReportSkipped} */ x) =>
        /** @type {GapItem} */ ({
          kind: "skipped",
          file: x.file,
          document: x.document,
          item: x.item,
          reason: x.reason,
        }),
    ),
    ...newItems(base.unresolved, head.unresolved, (u) => u.key).map(
      (/** @type {ReportUnresolved} */ u) =>
        /** @type {GapItem} */ ({ kind: "unresolved", subject: u.subject, why: u.why, where: u.where }),
    ),
    ...newItems(base.submodules, head.submodules, (p) => k(p)).map(
      (/** @type {string} */ p) => /** @type {GapItem} */ ({ kind: "submodule", path: p }),
    ),
  ];
  // edges not kept over the run limit are only counted (the report lists none of them)
  if (head.run.runLimitEdges > base.run.runLimitEdges) {
    gaps.push({ kind: "run-limit-edges", base: base.run.runLimitEdges, head: head.run.runLimitEdges });
  }
  const declaredEdges = (/** @type {ActionReport} */ r) => r.edges.filter((e) => e.source === "declared");
  /** @type {GapItem[]} */
  const declared = [
    ...newItems(declaredEdges(base), declaredEdges(head), (e) => e.key ?? edgeKey(e)).map(
      (/** @type {ReportEdge} */ e) => /** @type {GapItem} */ ({ kind: "declared-edge", edge: e }),
    ),
    ...newItems(base.matchOverrides, head.matchOverrides, (m) => m.key).map(
      (/** @type {ReportMatchOverride} */ m) =>
        /** @type {GapItem} */ ({ kind: "match-override", host: m.host, declared: m.declared }),
    ),
    ...newItems(
      base.repoMappings.filter((m) => m.from === "crankpath.yaml" && m.used),
      head.repoMappings.filter((m) => m.from === "crankpath.yaml" && m.used),
      (m) => m.key,
    ).map(
      (/** @type {ReportRepoMapping} */ m) =>
        /** @type {GapItem} */ ({ kind: "repo-mapping", url: m.url, root: m.root }),
    ),
  ];
  return { gaps, declared };
}

/** The reasons a side cannot be compared from its own report (OD-27 c, OD-30). */
export function sideReasons(/** @type {"base" | "head"} */ side, /** @type {RunSummary} */ run) {
  /** @type {NotCheckedReason[]} */
  const out = [];
  if (run.state === "NOTHING ANALYSED") out.push({ side, code: "nothing-analysed" });
  if (run.timeouts > 0) out.push({ side, code: "timeout", count: run.timeouts });
  return out;
}

function crankKey(/** @type {ReportCrank} */ k) {
  const created = [...k.createdNodes].sort(compareCodePoints);
  const rerouted = k.reroutedEdges.map((e) => JSON.stringify([e.from, e.to])).sort(compareCodePoints);
  return JSON.stringify([k.by, k.ref, created, rerouted]);
}

/** The declared facts the head holds that the base does not hold in the same form (FR10.5). */
function declaredChanges(/** @type {ActionReport} */ base, /** @type {ActionReport} */ head) {
  const baseCranks = new Set(base.cranks.map(crankKey));
  const cranks = head.cranks.filter((k) => !baseCranks.has(crankKey(k)));

  const baseDeclared = new Set(base.edges.filter((e) => e.source === "declared").map(edgeKey));
  const seen = new Set();
  const declaredEdges = [];
  for (const e of head.edges) {
    if (e.source !== "declared") continue;
    const k = edgeKey(e);
    if (baseDeclared.has(k) || seen.has(k)) continue;
    seen.add(k);
    declaredEdges.push(e);
  }

  const declaredForm = (/** @type {ReportExternal} */ x) => JSON.stringify([x.coldStart, x.servedBy]);
  const baseExternals = new Map(base.externals.map((x) => [x.id, declaredForm(x)]));
  const externals = head.externals.filter(
    (x) => (x.coldStart !== "unspecified" || x.servedBy !== null) && baseExternals.get(x.id) !== declaredForm(x),
  );

  const overrideKey = (/** @type {ReportMatchOverride} */ m) => JSON.stringify([m.host, m.declared]);
  const baseOverrides = new Set(base.matchOverrides.map(overrideKey));
  const matchOverrides = head.matchOverrides.filter((m) => !baseOverrides.has(overrideKey(m)));

  const mappingKey = (/** @type {ReportRepoMapping} */ m) => JSON.stringify([m.url, m.root]);
  const baseMappings = new Set(base.repoMappings.filter((m) => m.from === "crankpath.yaml").map(mappingKey));
  const repoMappings = head.repoMappings.filter((m) => m.from === "crankpath.yaml" && !baseMappings.has(mappingKey(m)));

  return { cranks, declaredEdges, externals, matchOverrides, repoMappings };
}

/**
 * Compares the base and head reports (both already read by readReport).
 * @returns {DiffResult}
 */
export function diffReports(/** @type {ActionReport} */ base, /** @type {ActionReport} */ head) {
  const reasons = [...sideReasons("base", base.run), ...sideReasons("head", head.run)];
  if (reasons.length > 0) return notCheckedResult(reasons, base.run, head.run);

  // The base graph: every edge read (ordering-only edges never lie on a cycle), and every edge of
  // every base cycle, so an edge a base crank adds (a reroute) is part of the base too.
  const baseEdges = new Set(base.edges.filter((e) => !e.orderingOnly).map(edgeKey));
  for (const c of base.cycles) for (const e of c.edges) baseEdges.add(edgeKey(e));
  /** @type {Map<string, ReportCycle>} */
  const baseComponentOf = new Map();
  for (const c of base.cycles) for (const n of c.nodes) if (!baseComponentOf.has(n)) baseComponentOf.set(n, c);
  const baseCrankById = new Map(base.cranks.map((k) => [k.id, k]));
  /** @type {Map<string, ReportEdge>} */
  const headEdgeByKey = new Map();
  for (const e of head.edges) if (!headEdgeByKey.has(edgeKey(e))) headEdgeByKey.set(edgeKey(e), e);

  /** @type {NewCycle[]} */
  const newCycles = [];
  /** @type {ReportCycle[]} */
  const unchangedCycles = [];
  /** @type {CrankedCycle[]} */
  const crankedInHead = [];
  const declared = declaredChanges(base, head);
  const addedCranks = new Set(declared.cranks.map((k) => k.id));
  const cycles = [...head.cycles].sort((a, b) => compareCodePoints(a.id, b.id));
  for (const cycle of cycles) {
    if (!UNCRANKED.has(cycle.label)) {
      crankedInHead.push({
        cycle,
        newEdges: cycle.edges.filter((e) => !baseEdges.has(edgeKey(e))).length,
        addedByPr: cycle.crankedBy.some((id) => addedCranks.has(id)),
      });
      continue;
    }
    const missing = cycle.edges.filter((e) => !baseEdges.has(edgeKey(e)));
    if (missing.length > 0) {
      const newEdges = missing.map(
        (e) => headEdgeByKey.get(edgeKey(e)) ?? { ...e, orderingOnly: false, evidence: { file: "", line: null } },
      );
      newCycles.push({
        cycle,
        why: "new-edges",
        newEdges,
        baseEdgesPresent: cycle.edges.length - missing.length,
        baseCycle: null,
        baseCranks: [],
      });
      continue;
    }
    // Every edge is in the base, so the cycle's nodes lie in one base component.
    const first = cycle.nodes[0];
    const baseCycle = first === undefined ? undefined : baseComponentOf.get(first);
    if (baseCycle === undefined) {
      // Cannot happen for a report crankpath wrote; never read as "not new".
      newCycles.push({
        cycle,
        why: "no-base-component",
        newEdges: [],
        baseEdgesPresent: cycle.edges.length,
        baseCycle: null,
        baseCranks: [],
      });
    } else if (baseCycle.label === "cranked") {
      const baseCranks = baseCycle.crankedBy.flatMap((id) => {
        const k = baseCrankById.get(id);
        return k === undefined ? [] : [k];
      });
      newCycles.push({
        cycle,
        why: "crank-removed",
        newEdges: [],
        baseEdgesPresent: cycle.edges.length,
        baseCycle,
        baseCranks,
      });
    } else unchangedCycles.push(cycle);
  }

  const known = new Set([...base.hiddenCycles.map((h) => h.id), ...base.cycles.map((c) => c.id)]);
  const hiddenNew = [...head.hiddenCycles]
    .filter((h) => !known.has(h.id))
    .sort((a, b) => compareCodePoints(a.id, b.id));

  // new cycles first (m2): any new uncranked cycle fails the check, whatever else is new; only
  // without one do new gap items and declared facts make the result NOT CHECKED (m1)
  const fresh = newGapItems(base, head);
  /** @type {NotCheckedReason[]} */
  const notChecked = [];
  if (newCycles.length === 0) {
    if (fresh.gaps.length > 0) notChecked.push({ side: "head", code: "new-gaps", count: fresh.gaps.length });
    if (fresh.declared.length > 0)
      notChecked.push({ side: "head", code: "new-declared", count: fresh.declared.length });
  }
  /** @type {DiffResult} */
  const result = {
    result: newCycles.length > 0 ? "FAILED" : notChecked.length > 0 ? "NOT_CHECKED" : "NO_NEW_CYCLES_FOUND",
    notChecked,
    newCycles,
    unchangedCycles,
    crankedInHead,
    headCranks: head.cranks,
    declared,
    hiddenNew,
    newGaps: fresh.gaps,
    newDeclared: fresh.declared,
    base: base.run,
    head: head.run,
  };
  return Object.freeze(result);
}
