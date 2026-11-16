// What a renderer may read, run and write (C4): RenderIo reads through BoundedReader under the
// roots RepoIdentity allows; the runtime starts processes only through its CommandRunner and
// writes only through its WorkDir. The shared marks for a render that stopped are here too.

import type { NodeId, OpaqueMark, UnreadableFile } from "../u1-graph-model/graph-model.js";
import { makeOpaqueMark } from "../u1-graph-model/graph-model.js";
import {
  type BytesResult,
  REASON_WORDS,
  type ReadResult,
  type TextResult,
} from "../u2-intake-config/bounded-reader.js";
import type { EntryKind, WalkOptions, WalkOutcome } from "../u2-intake-config/tree-walk.js";
import type { FloatingRef, RenderedSet, RenderJob } from "../u3-discovery-expansion/render-job.js";
import type { CommandResult, CommandRunner } from "./command-runner.js";
import { type OutputLimits, parseRenderedOutput } from "./rendered-output.js";
import type { Toolchain } from "./toolchain.js";
import type { WorkDir } from "./work-dir.js";
import { substituteDocument } from "./flux-substitution.js";
import { buildObjects, type SourceDocument } from "./rendered-set-builder.js";

/** A ConfigMap's or plain Secret's string data, by key (Secret values decoded; memory only). */
export type ValuesData = Readonly<Record<string, string>>;

/** What a renderer may run and write, besides reading. */
export interface RenderRuntime {
  readonly runner: CommandRunner;
  readonly toolchain: Toolchain;
  readonly work: WorkDir;
  /** False under `--no-network`: nothing is fetched, a cache miss is opaque `offline` (BR4.9). */
  readonly network: boolean;
  readonly output: OutputLimits;
  /** The data of a ConfigMap or plain Secret defined in the repo (the planner has checked it is there). */
  valuesData(id: NodeId): ValuesData | null;
  /** Records each command's result (fixed words and numbers only) for `--verbose`. */
  record(result: CommandResult): void;
  /**
   * Whether the run's budget can take a render output's parse (its lexemes and bytes) before it is
   * parsed; `comparison` for a second render, whose refusal is not a refused job.
   */
  admitOutput(lexemes: number, bytes: number, comparison?: boolean): boolean;
  /** Charges a render output's bytes, held parsed; false when the run's budget is reached. */
  holdOutput(bytes: number): boolean;
}

/** What a renderer may do: list and read files under a root label, and name a file for output. */
export interface RenderIo {
  walk(root: string, dir: string, options: WalkOptions): WalkOutcome;
  read(root: string, path: string): ReadResult;
  readText(root: string, path: string): TextResult;
  readBytes(root: string, path: string): BytesResult;
  kind(root: string, path: string): EntryKind;
  /** The display path of a file under a root label (`alias:N/` prefixed outside the scanned root). */
  display(root: string, path: string): string;
  readonly runtime: RenderRuntime;
}

/** The RenderedSet outcome word of a mark (C4). */
export function outcomeOf(mark: OpaqueMark | null): RenderedSet["outcome"] {
  if (mark === null) return "ok";
  return mark.reason === "limit" ||
    mark.reason === "tool-missing" ||
    mark.reason === "offline" ||
    mark.reason === "unreadable-file"
    ? mark.reason
    : "render-failed";
}

/** A set with no objects and one mark (a job that stopped before or during its render). */
export function opaqueSet(
  job: RenderJob,
  mark: OpaqueMark,
  extra: {
    unreadable?: readonly UnreadableFile[];
    timedOut?: boolean;
    kustomizeDirs?: readonly string[];
    notes?: readonly FloatingRef[];
  } = {},
): RenderedSet {
  const outcome = outcomeOf(mark);
  return Object.freeze({
    jobId: job.jobId,
    objects: [],
    droppedHooks: 0,
    outcome,
    skipped: [],
    unreadable: extra.unreadable ?? [],
    opaque: mark,
    timedOut: extra.timedOut === true,
    resolvedVersion: null,
    kustomizeDirs: extra.kustomizeDirs ?? [],
    notes: extra.notes ?? [],
  });
}

/** The fixed mark for a command that did not end `ok` (BR4.2, BR4.19, OD-30). */
export function commandMark(what: string, result: CommandResult, lost: string): OpaqueMark {
  switch (result.outcome) {
    case "timed-out":
      return makeOpaqueMark({ reason: "limit", lostEdges: [lost], detail: "timeout" });
    case "over-cap":
      return makeOpaqueMark({
        reason: "limit",
        lostEdges: [lost],
        detail: `${what} output over the cap (${result.overCap === "stderr" ? "standard error" : "standard output"})`,
      });
    case "not-started":
      return makeOpaqueMark({ reason: "render-failed", lostEdges: [lost], detail: `${what} could not start` });
    default:
      return makeOpaqueMark({ reason: "render-failed", lostEdges: [lost], detail: `${what} exited with an error` });
  }
}

export interface SetParts {
  readonly unreadable?: readonly UnreadableFile[];
  /** A mark that holds even when the objects are built (some files could not be read). */
  readonly opaque?: OpaqueMark | null;
  readonly resolvedVersion?: string | null;
  readonly kustomizeDirs?: readonly string[];
  readonly notes?: readonly FloatingRef[];
}

/**
 * The set of a job's parsed documents: Flux post-build substitution first (when the job has it),
 * then ids, Secret stripping and hook dropping. A substitution form crankpath does not read makes
 * the owner opaque with no objects, never a guessed value.
 */
export function buildSet(job: RenderJob, documents: readonly SourceDocument[], parts: SetParts = {}): RenderedSet {
  let docs = documents;
  if (job.substitute !== null) {
    const vars = job.substitute;
    const out: SourceDocument[] = [];
    for (const d of documents) {
      const r = substituteDocument(d.value, vars);
      if (!r.ok) {
        return opaqueSet(
          job,
          makeOpaqueMark({
            reason: "unsupported-field",
            lostEdges: ["objects it renders"],
            field: "spec.postBuild",
            detail: "a substitution form crankpath does not read",
          }),
          { unreadable: parts.unreadable ?? [], kustomizeDirs: parts.kustomizeDirs ?? [] },
        );
      }
      out.push({ ...d, value: r.value });
    }
    docs = out;
  }
  const built = buildObjects(docs, {
    renderJob: job.jobId,
    defaultNamespace: job.namespace,
    namespaceOverride: job.namespaceOverride,
    destination: job.destination,
    // the objects a generated Application renders are deployed by it, not generated by its
    // ApplicationSet: only the Application itself is `generated-by` (B3)
    // Helm test hooks are dropped from a Helm render only: elsewhere the annotation means nothing
    dropTestHooks: job.kind === "helm",
  });
  const opaque = parts.opaque ?? null;
  return Object.freeze({
    jobId: job.jobId,
    objects: built.objects,
    droppedHooks: built.droppedHooks,
    outcome: outcomeOf(opaque),
    stringLeaves: built.stringLeaves,
    skipped: built.skipped,
    unreadable: parts.unreadable ?? [],
    opaque,
    timedOut: false,
    resolvedVersion: parts.resolvedVersion ?? null,
    kustomizeDirs: parts.kustomizeDirs ?? [],
    notes: parts.notes ?? [],
  });
}

const RENDERS = "objects it renders";
const RUN_BUDGET_MARK = makeOpaqueMark({
  reason: "limit",
  lostEdges: [RENDERS],
  detail: "the run's memory budget was reached",
});
const LIMIT_OUTCOMES: ReadonlySet<string> = new Set(["too-large", "too-deep", "too-many-documents", "alias-limit"]);

/** Parses a render's standard output into the job's set (shared by helm and kustomize). */
export function finishOutput(
  job: RenderJob,
  io: RenderIo,
  stdout: Buffer,
  parts: {
    kustomizeDirs: readonly string[];
    resolvedVersion: string | null;
    notes?: readonly FloatingRef[];
    /** False for a comparison render: its transient is asked for, its output is not held (B2 review pass 2, m2). */
    hold?: boolean;
  },
): RenderedSet {
  const file = `render:${job.jobId}`;
  const rt = io.runtime;
  const parsed = parseRenderedOutput(stdout, file, rt.output, (lexemes, bytes) =>
    rt.admitOutput(lexemes, bytes, parts.hold === false),
  );
  if (parsed.ok && parts.hold !== false && !rt.holdOutput(stdout.length)) {
    return opaqueSet(job, RUN_BUDGET_MARK, { kustomizeDirs: parts.kustomizeDirs, notes: parts.notes ?? [] });
  }
  if (!parsed.ok) {
    if (parsed.problem === "over-run-budget") {
      return opaqueSet(job, RUN_BUDGET_MARK, { kustomizeDirs: parts.kustomizeDirs, notes: parts.notes ?? [] });
    }
    const mark =
      parsed.problem === "too-many-objects"
        ? makeOpaqueMark({ reason: "limit", lostEdges: [RENDERS], detail: "more rendered objects than the limit" })
        : parsed.problem === "over-parse-budget"
          ? makeOpaqueMark({
              reason: "limit",
              lostEdges: [RENDERS],
              detail: "its output is over the parse budget of one render",
            })
          : makeOpaqueMark({ reason: "render-failed", lostEdges: [RENDERS], detail: "its output is not UTF-8" });
    return opaqueSet(job, mark, { kustomizeDirs: parts.kustomizeDirs });
  }
  const unreadable: UnreadableFile[] = parsed.refused.map((r) => ({
    path: `${file}#${r.document}`,
    outcome: r.outcome,
    reasonWord: REASON_WORDS[r.outcome],
    detail: r.detail,
  }));
  const limited = parsed.refused.some((r) => LIMIT_OUTCOMES.has(r.outcome));
  const opaque =
    parsed.refused.length === 0
      ? null
      : makeOpaqueMark({
          reason: limited ? "limit" : "render-failed",
          lostEdges: ["objects in the output documents it could not read"],
          detail: `${parsed.refused.length} ${parsed.refused.length === 1 ? "document" : "documents"} of its output not read`,
        });
  return buildSet(job, parsed.documents, {
    unreadable,
    opaque,
    kustomizeDirs: parts.kustomizeDirs,
    resolvedVersion: parts.resolvedVersion,
    notes: parts.notes ?? [],
  });
}
