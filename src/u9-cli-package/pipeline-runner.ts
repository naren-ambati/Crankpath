// PipelineRunner (U9, the composition root; ADR-006; BR9.3 to BR9.8, BR9.10, BR9.11): discover,
// plan, render, extract, build, analyse, assemble. It wires every stage, isolates each job and each
// extractor (a throw becomes a named, counted item, never a crash of the run), reads only through
// BoundedReader under the roots RepoIdentity allows, writes only through the WorkDir under the
// cache root (nothing at all for a run of plain directories), removes its private directory in
// every outcome, and returns one Report with its exit code, or a usage error in crankpath's voice
// (exit 1). Stages are dispatched from their own registries: render job kinds from
// src/u4-render-engine/renderers.ts, extractors from the U5 and U6 lists, the analysis behind the
// C9 `analyse` interface. No telemetry: nothing is sent anywhere.

import path from "node:path";
import type { ConfigDocument } from "../u1-graph-model/declared-facts.js";
import type {
  DataMap,
  DataValue,
  ExtractContext,
  Extractor,
  ExtractResult,
  JobInfo,
  RenderedObject,
} from "../u1-graph-model/extractor.js";
import { emptyResult, getPath, IN_CLUSTER, isDataMap } from "../u1-graph-model/extractor.js";
import type { NodeId, OpaqueMark, SkippedObject, UnreadableFile } from "../u1-graph-model/graph-model.js";
import { makeOpaqueMark, objectId } from "../u1-graph-model/graph-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import { quote, quoteUrl } from "../u1-graph-model/safe-text.js";
import { type SourceKind, unresolvedItem } from "../u1-graph-model/status-model.js";
import {
  countLexemes,
  openRoot,
  READER_LIMITS,
  type ReadRefused,
  type ReadResult,
  readBytes,
  readText,
  readYaml,
  type ScanRoot,
  type TextOk,
} from "../u2-intake-config/bounded-reader.js";
import { configLocation, readConfig } from "../u2-intake-config/config-reader.js";
import {
  createRepoIdentity,
  normaliseRepoUrl,
  parseRepoAlias,
  type RepoAlias,
  ALIAS_LABEL,
  REPOS_LABEL,
  readOriginUrl,
  type ScannedUrlFrom,
} from "../u2-intake-config/repo-identity.js";
import { entryKind, walkFiles } from "../u2-intake-config/tree-walk.js";
import { stringData } from "../u3-discovery-expansion/flux-planner.js";
import type { RenderedSet, RenderJob } from "../u3-discovery-expansion/render-job.js";
import {
  type PlanContext,
  type PlanSource,
  planSource,
  type RepoObject,
} from "../u3-discovery-expansion/render-planner.js";
import { discover, SKIP_AT_ROOT, SKIP_DIRS, sourceKindOf } from "../u3-discovery-expansion/source-discovery.js";
import {
  buildChildEnv,
  type CommandResult,
  createCommandRunner,
  OUTCOME_WORDS,
  type RunnerLimits,
  type Spawn,
} from "../u4-render-engine/command-runner.js";
import { isKustomizeComponent } from "../u4-render-engine/kustomize-renderer.js";
import { OUTPUT_LIMITS, type OutputLimits } from "../u4-render-engine/rendered-output.js";
import {
  buildObjects,
  byLocation,
  canonicalJson,
  countStringLeaves,
} from "../u4-render-engine/rendered-set-builder.js";
import { type RenderIo, type RenderRuntime, render, type ValuesData } from "../u4-render-engine/renderers.js";
import { detectToolchain, findTool } from "../u4-render-engine/toolchain.js";
import { createWorkDir, resolveCacheRoot } from "../u4-render-engine/work-dir.js";
import { GITOPS_EXTRACTORS } from "../u5-extractors-gitops/index.js";
import { createHostMatching, hostResolution, type ServiceEntry } from "../u6-extractors-workload/host-matcher.js";
import { WORKLOAD_EXTRACTORS } from "../u6-extractors-workload/index.js";
import { analyse, type HiddenCycle } from "../u7-graph-analysis/analysis.js";
import { findCycles } from "../u7-graph-analysis/cycle-finder.js";
import { buildGraph, compareEdges } from "../u7-graph-analysis/graph-builder.js";
import { assembleReport, type FloatingEntry, type SourceOutcome } from "../u8-output/report-assembler.js";
import { cyclesHiddenByOverrides } from "../u7-graph-analysis/match-overrides.js";
import { matchControllerSignatures } from "../u5-extractors-gitops/controller-signatures.js";
import { type BudgetSpec, RunBudget } from "./run-budget.js";
import { READER_PARSE_COST, RUN_LIMITS, RUN_RATES } from "../u1-graph-model/run-limits.js";

/** The derived per-run budget (src/u1-graph-model/run-limits.ts, docs/limits.md). */
export const DEFAULT_BUDGET: BudgetSpec = Object.freeze({
  bytes: RUN_LIMITS.runMemory.value,
  rates: RUN_RATES,
  parse: READER_PARSE_COST,
  maxEdges: RUN_LIMITS.edgesPerRun.value,
});

const RUN_LIMIT_MARK = makeOpaqueMark({
  reason: "limit",
  lostEdges: ["objects it renders"],
  detail: "the run's memory budget was reached",
});
import type { Report } from "../u8-output/report-model.js";

/** Every extractor, in a fixed order (ADR-002): the U5 list, then the U6 list. */
export const EXTRACTORS: readonly Extractor[] = Object.freeze([...GITOPS_EXTRACTORS, ...WORKLOAD_EXTRACTORS]);

export interface RunOptions {
  /** The path to scan, as given (relative to `cwd`). */
  readonly path: string;
  readonly cwd: string;
  readonly repoUrl?: string;
  readonly repoAliases?: readonly string[];
  readonly config?: string;
  /** `--no-network`: nothing is fetched; a chart not in the cache is opaque `offline`. */
  readonly noNetwork?: boolean;
  /** `--cache-dir` (default `.crankpath` in `cwd`). */
  readonly cacheDir?: string;
  /** The PATH crankpath searches for helm and kustomize and gives its children (default: this process's). */
  readonly toolPath?: string;
  /** Extractors to run; the default is EXTRACTORS (tests inject failing ones). */
  readonly extractors?: readonly Extractor[];
  /** The process port and limits (tests only). */
  readonly spawn?: Spawn;
  readonly runnerLimits?: RunnerLimits;
  readonly outputLimits?: OutputLimits;
  /** The run's memory budget; the default is the derived one (tests use small ones, the measurement none). */
  readonly budget?: BudgetSpec;
}

export type RunOutcome =
  | {
      readonly kind: "report";
      readonly report: Report;
      readonly exitCode: 0 | 2;
      /** The real paths of every root read (scanned, aliases, repos:): for write confinement only, never printed. */
      readonly rootReals: readonly string[];
      /** Counts for `--verbose` (fixed words and numbers only). */
      readonly diagnostics: readonly string[];
    }
  | { readonly kind: "error"; readonly message: string; readonly exitCode: 1 };

function usage(message: string): RunOutcome {
  return { kind: "error", message, exitCode: 1 };
}

interface SourceEntry {
  readonly kind: Exclude<SourceKind, "KustomizeRoot">;
  readonly object: RenderedObject;
}

function configMessage(error: { keyPath: string | null; problem: string; reasonWord?: string }): string {
  if (error.keyPath !== null)
    return `${quote("error: invalid crankpath.yaml at key path", error.keyPath, "terminal")} (${error.problem})`;
  const word = error.reasonWord === undefined ? "" : `: ${error.reasonWord}`;
  return `error: invalid crankpath.yaml (${error.problem}${word})`;
}

const CACHE_PROBLEMS = {
  "inside-tree": "is inside the scanned tree; there only <path>/.crankpath is allowed, which discovery never reads",
  "not-a-directory": "is not a directory (a symlink is never followed)",
  "parent-missing": "has no parent directory",
} as const;

/** Kinds the Flux planner looks up among the repo's own objects. */
const LOOKUP_KINDS = new Set(["GitRepository", "HelmRepository", "OCIRepository", "ConfigMap", "Secret"]);

/** The repo's own objects a Flux source can name, from every YAML document discovery read. */
function repoObjectIndex(reads: readonly ReadResult[]): Map<NodeId, RepoObject> {
  const index = new Map<NodeId, RepoObject>();
  const digests = new Map<NodeId, string>();
  const sorted = [...reads].sort((a, b) => compareCodePoints(a.path, b.path));
  for (const read of sorted) {
    if (read.outcome !== "ok") continue;
    const add = (v: DataValue) => {
      if (!isDataMap(v) || typeof v.kind !== "string" || !LOOKUP_KINDS.has(v.kind)) return;
      const id = objectId(v.kind, getPath(v, ["metadata", "namespace"]), getPath(v, ["metadata", "name"]));
      if (!id.ok) return;
      const digest = canonicalJson(v);
      const seen = digests.get(id.id);
      if (seen === undefined) {
        digests.set(id.id, digest);
        index.set(id.id, { state: "found", value: v as DataMap, file: read.path });
      } else if (seen !== digest) index.set(id.id, { state: "conflict" });
    };
    for (const doc of read.documents) {
      if (isDataMap(doc) && typeof doc.kind === "string" && doc.kind.endsWith("List") && Array.isArray(doc.items))
        doc.items.forEach(add);
      else add(doc);
    }
  }
  return index;
}

/** Runs the whole pipeline once. Never throws on hostile input; a bug still throws. */
export function runPipeline(options: RunOptions): RunOutcome {
  const absolute = path.resolve(options.cwd, options.path);
  const opened = openRoot(absolute);
  if (!opened.ok) return usage(quote("error: cannot read path", options.path, "terminal"));
  const root = opened.root;

  let scannedUrl: string | null = null;
  let scannedFrom: ScannedUrlFrom | null = null;
  if (options.repoUrl !== undefined) {
    if (normaliseRepoUrl(options.repoUrl) === null) {
      return usage(quoteUrl("error: --repo-url is not a URL crankpath can compare:", options.repoUrl, "terminal"));
    }
    scannedUrl = options.repoUrl;
    scannedFrom = "flag";
  } else {
    scannedUrl = readOriginUrl(root);
    scannedFrom = scannedUrl === null ? null : "git-config";
  }

  // Root labels: `.` the scanned root, `alias:N` a --repo-alias root, `repos:<path>` a crankpath.yaml
  // mapping. The spaces are disjoint and a label is never set twice, so repo-supplied config can
  // never replace or shadow a root the invoker chose.
  const roots = new Map<string, ScanRoot>([[".", root]]);
  // Only `alias:N` (numbered here, one per flag) and a `repos:` label not yet set reach this, so
  // the check below cannot be reached from any input; it guards against a future caller.
  const setRoot = (label: string, r: ScanRoot) => {
    if (roots.has(label)) throw new Error("PipelineRunner: a root label set twice (a bug)");
    roots.set(label, r);
  };
  const aliases: RepoAlias[] = [];
  for (const value of options.repoAliases ?? []) {
    const parsed = parseRepoAlias(value);
    if (!parsed.ok) {
      const why =
        parsed.problem === "not-comparable" ? "its URL is not one crankpath can compare" : "expected <url>=<path>";
      return usage(`error: invalid --repo-alias (${why})`);
    }
    if (aliases.some((a) => a.normalised === parsed.normalised))
      return usage("error: two --repo-alias values name the same repository");
    const aliasRoot = openRoot(path.resolve(options.cwd, parsed.path));
    if (!aliasRoot.ok) return usage(quote("error: cannot read path", parsed.path, "terminal"));
    const label = `alias:${aliases.length + 1}`;
    aliases.push({ url: parsed.url, normalised: parsed.normalised, label });
    setRoot(label, aliasRoot.root);
  }

  const location = configLocation(root, options.config, options.cwd);
  if (!("dir" in location)) return usage(configMessage(location));
  const read = readConfig(location, root);
  if (!read.ok) return usage(configMessage(read.error));
  const config: ConfigDocument = read.config;
  for (const m of config.repos) {
    if (m.readFrom === null || m.readFrom === "") continue;
    const sub = openRoot(path.join(root.real, ...m.readFrom.split("/")));
    if (!sub.ok || sub.root.real !== path.join(root.real, ...m.readFrom.split("/"))) {
      return usage(
        configMessage({ keyPath: `${m.keyPath}.read_from`, problem: "not a directory inside the scanned root" }),
      );
    }
    // Two entries naming one directory (mirror URLs of one checkout) share its root: config
    // validation already gave both the same canonical `read_from`, so the label is the same.
    if (!roots.has(`${REPOS_LABEL}${m.readFrom}`)) setRoot(`${REPOS_LABEL}${m.readFrom}`, sub.root);
  }
  const identity = createRepoIdentity({ scannedUrl, scannedFrom, aliases, mappings: config.repos });
  const cacheRoot = resolveCacheRoot(options.cwd, options.cacheDir, root.real);
  if (!cacheRoot.ok) {
    const shown = options.cacheDir ?? ".crankpath";
    return usage(`${quote("error: the cache directory", shown, "terminal")} ${CACHE_PROBLEMS[cacheRoot.problem]}`);
  }
  const work = createWorkDir(cacheRoot.cacheRoot, cacheRoot.trusted);
  try {
    return runWith(options, { root, roots, identity, config, work, aliases });
  } finally {
    work.cleanup();
  }
}

interface Prepared {
  readonly root: ScanRoot;
  readonly roots: ReadonlyMap<string, ScanRoot>;
  readonly identity: ReturnType<typeof createRepoIdentity>;
  readonly config: ConfigDocument;
  readonly work: ReturnType<typeof createWorkDir>;
  readonly aliases: readonly RepoAlias[];
}

function runWith(options: RunOptions, prepared: Prepared): RunOutcome {
  const { root, roots, identity, config, work, aliases } = prepared;
  // Which mappings a resolution went through (B5 review pass 2, M2): a `repos:` entry of the
  // scanned repo's crankpath.yaml changes what is read (a declared fact, a gap); a --repo-alias is
  // the user's own input (listed as an assumption).
  const usedMappings = new Set<string>();
  const resolveRepo = (url: string) => {
    const r = identity.resolve(url);
    if (r.via === "repos-read-from" || r.via === "repos-fetch" || r.via === "repo-alias") {
      const n = normaliseRepoUrl(url);
      if (n !== null) usedMappings.add(`${r.via === "repo-alias" ? "alias" : "repos"}\n${n}`);
    }
    return r;
  };

  const toolPath = options.toolPath ?? process.env.PATH ?? "";
  const runner = createCommandRunner({
    binaries: { helm: findTool("helm", toolPath), kustomize: findTool("kustomize", toolPath) },
    env: buildChildEnv(work.homes),
    ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
    ...(options.runnerLimits === undefined ? {} : { limits: options.runnerLimits }),
  });
  const commands: CommandResult[] = [];
  const toolchain = detectToolchain(runner, path.dirname(work.cacheRoot));

  // Every file held parsed is charged to the run's budget; over it, the file is a counted
  // `too-large` refusal (detail `run budget`) and its parsed documents are let go.
  const budget = new RunBudget(options.budget ?? DEFAULT_BUDGET);
  // Before a file is parsed, its transient parse cost (lexemesPerFile's terms: its lexemes x the
  // worst bytes per lexeme, plus its bytes x the text reserve) must fit in what the run has not yet
  // held; else it is refused `run budget reached` without being parsed. Over lexemesPerFile the
  // reader refuses it itself.
  const transientFits = (text: TextOk): ReadRefused | null => {
    const lexemes = countLexemes(text.text, READER_LIMITS.lexemesPerFile.value);
    if (lexemes > READER_LIMITS.lexemesPerFile.value) return null;
    const p = budget.spec.parse;
    if (budget.fitsTransient(lexemes * p.bytesPerLexeme + text.size * p.textBytesPerByte)) return null;
    return { outcome: "too-large", path: text.path, reasonWord: "run budget reached", detail: "run budget" };
  };
  const charged = (r: ReadResult): ReadResult =>
    r.outcome !== "ok" || budget.file(r.size)
      ? r
      : { outcome: "too-large", path: r.path, reasonWord: "run budget reached", detail: "run budget" };

  // One read per file per root in a run: discovery and rendering see the same bytes.
  const cache = new Map<string, ReadResult>();
  const scannedReads: ReadResult[] = [];
  const readUnder = (label: string, rel: string): ReadResult => {
    const key = `${label.length}:${label}${rel}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const r = roots.get(label);
    const result: ReadResult =
      r === undefined
        ? { outcome: "not-found", path: rel, reasonWord: "not found" }
        : charged(readYaml(r, rel, READER_LIMITS, transientFits));
    cache.set(key, result);
    if (label === ".") scannedReads.push(result);
    return result;
  };
  const display = (label: string, rel: string): string => {
    if (label.startsWith("alias:")) return `${label}/${rel}`;
    const full = label === "." ? rel : `${label.slice(REPOS_LABEL.length)}/${rel}`;
    // a repo directory spelled like an alias label is shown as `./alias:1/...`, never as an alias
    return ALIAS_LABEL.test(full.split("/")[0] ?? "") ? `./${full}` : full;
  };
  const discovery = discover({
    walk: () => walkFiles(root, "", { recurse: true, skipNames: SKIP_DIRS, skipAtStart: SKIP_AT_ROOT }),
    read: (p) => readUnder(".", p),
  });
  if ("failed" in discovery) return usage(quote("error: cannot read path", options.path, "terminal"));

  const index = repoObjectIndex(scannedReads);
  // A render's output is charged like a file read (docs/limits.md, the note for B2): its parse
  // transient checked against what the run has not yet held before it is parsed, then its bytes
  // held at the per-file-byte rate; its objects are charged by the job loop below.
  const runtime: RenderRuntime = {
    runner,
    toolchain,
    work,
    network: options.noNetwork !== true,
    output: options.outputLimits ?? OUTPUT_LIMITS,
    valuesData: (id): ValuesData | null => {
      const found = index.get(id);
      if (found === undefined || found.state !== "found") return null;
      const kind = found.value.kind === "Secret" ? "Secret" : "ConfigMap";
      return stringData(kind, found.value);
    },
    record: (r) => {
      commands.push(r);
    },
    admitOutput: (lexemes, bytes, comparison) =>
      budget.fitsRenderTransient(
        lexemes * budget.spec.parse.bytesPerLexeme + bytes * budget.spec.parse.textBytesPerByte,
        comparison !== true,
      ),
    holdOutput: (bytes) => budget.render(bytes),
  };
  const nf = (rel: string) => ({ outcome: "not-found" as const, path: rel, reasonWord: "not found" });
  const io: RenderIo = {
    walk: (label, dir, walkOptions) => {
      const r = roots.get(label);
      if (r === undefined) return { ok: false, refusal: { outcome: "not-found", path: dir, reasonWord: "not found" } };
      return walkFiles(r, dir, walkOptions);
    },
    read: readUnder,
    readText: (label, rel) => {
      const r = roots.get(label);
      return r === undefined ? nf(rel) : readText(r, rel);
    },
    readBytes: (label, rel) => {
      const r = roots.get(label);
      return r === undefined ? nf(rel) : readBytes(r, rel);
    },
    kind: (label, rel) => {
      const r = roots.get(label);
      return r === undefined ? "missing" : entryKind(r, rel);
    },
    display,
    runtime,
  };

  // A `.json` file is read as YAML (as Argo CD reads it): its parse failure is worded for both.
  const worded = (u: UnreadableFile): UnreadableFile =>
    u.outcome === "parse-error" && u.path.endsWith(".json") ? { ...u, reasonWord: "not valid JSON or YAML" } : u;
  const unreadable: UnreadableFile[] = discovery.unreadable.map((u) => worded({ ...u, path: display(".", u.path) }));
  const skipped: SkippedObject[] = [];
  const pendingNoNamespace: SkippedObject[] = [];
  const discovered: RenderedObject[] = [];
  let discoveredLeaves = 0;
  for (const file of discovery.sourceFiles) {
    const built = buildObjects(
      file.documents.map((value, i) => ({ file: file.path, document: i + 1, value })),
      {
        renderJob: null,
        defaultNamespace: null,
        destination: IN_CLUSTER,
        keep: (apiVersion, kind) => sourceKindOf(apiVersion, kind) !== null,
        sourceDocuments: true,
      },
    );
    discovered.push(...built.objects);
    discoveredLeaves += built.stringLeaves;
    for (const s of built.skipped) (s.reason === "no-namespace" ? pendingNoNamespace : skipped).push(s);
  }
  discovered.sort(byLocation);
  // Discovered sources are charged like rendered objects (and held: they are already read).
  budget.hold(discovered.length * budget.spec.rates.perObject + discoveredLeaves * budget.spec.rates.perStringLeaf);

  const sources = new Map<NodeId, SourceEntry>();
  const queue: SourceEntry[] = [];
  const enqueue = (object: RenderedObject) => {
    const kind = sourceKindOf(object.apiVersion, object.kind);
    if (kind === null || sources.has(object.id)) return;
    const entry = { kind, object };
    sources.set(object.id, entry);
    queue.push(entry);
  };
  for (const o of discovered) enqueue(o);

  const planContext: PlanContext = {
    resolveRepo,
    probeDirectory: (label, dir) => {
      const listed = io.walk(label, dir, { recurse: false });
      if (!listed.ok) return { ok: false, reasonWord: listed.refusal.reasonWord };
      return { ok: true, names: listed.files.map((f) => f.slice(f.lastIndexOf("/") + 1)) };
    },
    lookup: (id) => index.get(id) ?? { state: "absent" },
  };

  const marks: { node: NodeId; mark: OpaqueMark }[] = [];
  const markedNodes = new Set<NodeId>();
  const markOwner = (node: NodeId, mark: OpaqueMark) => {
    if (markedNodes.has(node)) return;
    markedNodes.add(node);
    marks.push({ node, mark });
  };
  const jobs = new Map<string, JobInfo>();
  const rendered: RenderedObject[] = [];
  const floating: FloatingEntry[] = [];
  // Kustomize directories of the scanned root a render read, and the mark of the first job that read each.
  const covered = new Map<string, OpaqueMark | null>();
  const jobCounts = new Map<string, number>();
  let timeouts = 0;
  let droppedHooks = 0;

  const failedSet = (job: RenderJob): RenderedSet => ({
    jobId: job.jobId,
    objects: [],
    droppedHooks: 0,
    outcome: "render-failed",
    skipped: [],
    unreadable: [],
    opaque: makeOpaqueMark({
      reason: "render-failed",
      lostEdges: ["objects it renders"],
      detail: "the render stopped with an error",
    }),
    timedOut: false,
    resolvedVersion: null,
    kustomizeDirs: [],
    notes: [],
  });
  /** Renders one job; its objects are taken in only when the run's budget holds them (B1 N2). */
  const runJob = (job: RenderJob): RenderedSet => {
    let set: RenderedSet;
    try {
      set = render(job, io);
    } catch {
      // a bug or an unexpected I/O error in one job never stops the others (US9.3)
      set = failedSet(job);
    }
    if (set.timedOut) timeouts += 1;
    unreadable.push(...set.unreadable.map(worded));
    if (job.kind === "kustomize" && job.root === ".") {
      for (const d of set.kustomizeDirs) if (!covered.has(d)) covered.set(d, set.opaque);
    }
    const leaves = set.stringLeaves ?? set.objects.reduce((n, o) => n + countStringLeaves(o.body), 0);
    if (set.objects.length > 0 && !budget.objects(set.objects.length, leaves))
      set = { ...failedSet(job), opaque: RUN_LIMIT_MARK, outcome: "limit" };
    const key = `${job.kind} ${set.outcome}`;
    jobCounts.set(key, (jobCounts.get(key) ?? 0) + 1);
    droppedHooks += set.droppedHooks;
    return set;
  };

  for (let head = 0; head < queue.length; head++) {
    const entry = queue[head] as SourceEntry;
    const planned = planSource({ kind: entry.kind, object: entry.object } as PlanSource, planContext);
    // The reference edges of a Flux source to its values ConfigMaps and Secrets (FR4.2) are the
    // FluxExtractor's (B4), on every source whether or not it renders; the planner's list is data only.
    if (planned.opaque !== null) {
      markOwner(entry.object.id, planned.opaque);
      continue;
    }
    for (const job of planned.jobs) {
      if (job.owner === null) continue;
      jobs.set(job.jobId, {
        jobId: job.jobId,
        owner: job.owner,
        ownerFile: job.ownerFile,
        ownerField: job.ownerField,
        ownerRenderedPath: job.ownerRenderedPath,
        destination: job.destination,
      });
      const set = runJob(job);
      for (const f of job.floating) {
        floating.push({ node: job.owner, field: f.field, value: f.value, resolved: set.resolvedVersion });
      }
      for (const f of set.notes) floating.push({ node: job.owner, field: f.field, value: f.value, resolved: null });
      rendered.push(...set.objects);
      skipped.push(...set.skipped);
      if (set.opaque !== null) markOwner(job.owner, set.opaque);
      for (const o of set.objects) enqueue(o);
    }
  }

  // Kustomize roots: one a render already read takes that render's outcome; one nothing deploys
  // is built on its own (its outcome is its own; a component cannot be and is only read) and its
  // objects are not added to the graph: nothing in the repository applies them.
  const rootOutcomes: SourceOutcome[] = [];
  const undeployed: string[] = [];
  for (const dir of discovery.kustomizeRoots) {
    const shown = dir === "" ? "." : dir;
    if (covered.has(dir)) {
      rootOutcomes.push({ kind: "KustomizeRoot", node: null, kustomizeRoot: shown, mark: covered.get(dir) ?? null });
      continue;
    }
    undeployed.push(shown);
    // a Kustomize component is only built inside the kustomization that includes it
    if (isKustomizeComponent(io, ".", dir)) {
      rootOutcomes.push({ kind: "KustomizeRoot", node: null, kustomizeRoot: shown, mark: null });
      continue;
    }
    const planned = planSource({ kind: "KustomizeRoot", dir }, planContext);
    let mark: OpaqueMark | null = planned.opaque;
    for (const job of planned.jobs) {
      const set = runJob(job);
      mark ??= set.opaque;
    }
    rootOutcomes.push({ kind: "KustomizeRoot", node: null, kustomizeRoot: shown, mark });
  }

  // A source document with no namespace of its own is skipped only if no render gave it one.
  const renderedAt = new Set(rendered.map((o) => o.renderedPath));
  for (const s of pendingNoNamespace) {
    const at = s.item === null ? `${s.file}#${s.document}` : `${s.file}#${s.document}.items[${s.item}]`;
    if (!renderedAt.has(at)) skipped.push(s);
  }

  const objects = [...discovered, ...rendered].sort((a, b) => compareCodePoints(a.id, b.id) || byLocation(a, b));
  const bucket = (o: RenderedObject) =>
    o.origin.renderJob === null ? IN_CLUSTER : (jobs.get(o.origin.renderJob)?.destination ?? IN_CLUSTER);
  const services = new Map<NodeId, ServiceEntry>();
  for (const o of objects) {
    if (o.kind === "Service" && o.apiVersion === "v1" && o.namespace !== null && bucket(o) === IN_CLUSTER) {
      services.set(o.id, { id: o.id, name: o.name, namespace: o.namespace });
    }
  }
  // `match:` entries are tried first, in file order (US2.3); the ones no host matched are listed.
  const resolution = hostResolution(objects, [...services.values()], config.matches);
  const hosts = resolution.matching;
  const matchHost = hosts.match;
  const ctx: ExtractContext = Object.freeze({
    resolveRepo,
    matchHost,
    externalOf: resolution.externalOf,
    config,
    jobs,
  });
  const extractAll = (context: ExtractContext): ExtractResult[] => {
    const results: ExtractResult[] = [];
    for (const extractor of options.extractors ?? EXTRACTORS) {
      try {
        results.push(extractor.extract(objects, context));
      } catch {
        const failed = emptyResult();
        failed.unresolved.push(unresolvedItem(`extractor:${extractor.name}`, "extractor-failed", "(extractor)", null));
        results.push(failed);
      }
    }
    return results;
  };
  const extracted = extractAll(ctx);
  if (hosts.limitHit()) {
    // the wildcard comparison budget was spent: a counted limit that leaves every node unverified
    const limited = emptyResult();
    limited.unresolved.push(unresolvedItem("match", "match-limit", config.file ?? "crankpath.yaml", "match"));
    extracted.push(limited);
  }

  // edgesPerRun (N2): over it, the edges kept are the first in canonical order; the rest are counted.
  const capEdges = (results: ExtractResult[]): { kept: ExtractResult[]; dropped: number } => {
    const total = results.reduce((n, r) => n + r.edges.length, 0);
    if (total <= budget.spec.maxEdges) return { kept: results, dropped: 0 };
    const all = results.flatMap((r) => r.edges).sort(compareEdges);
    const keep = new Set(all.slice(0, budget.spec.maxEdges));
    return {
      kept: results.map((r) => ({ ...r, edges: r.edges.filter((e) => keep.has(e)) })),
      dropped: total - keep.size,
    };
  };
  const capped = capEdges(extracted);
  if (capped.dropped > 0) budget.droppedEdges = capped.dropped;

  const graph = buildGraph({ objects, extracted: capped.kept, config, opaque: marks });
  const overrides = hosts.overrides();
  const relied = [...new Set(overrides.map((o) => o.keyPath))];
  let analysis = analyse(graph, config, { matchEntries: relied });
  // A match entry that overrode a host may hide a cycle: find the cycles without the entries and
  // list the ones the report does not hold (review M1).
  let hidden: HiddenCycle[] = [];
  if (overrides.length > 0) {
    const plain = createHostMatching([...services.values()], []);
    const without = buildGraph({
      objects,
      extracted: capEdges(extractAll(Object.freeze({ ...ctx, matchHost: plain.match }))).kept,
      config,
      opaque: marks,
    });
    hidden = cyclesHiddenByOverrides(
      analysis.cycles,
      findCycles(
        without.nodes.map((n) => n.id),
        without.edges,
      ),
      overrides,
    );
    // nodes on a hidden cycle are unverified: analyse again, naming them (B5 review pass 2, m1)
    if (hidden.length > 0) analysis = analyse(graph, config, { matchEntries: relied, hiddenCycles: hidden });
  }
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const outcomes: SourceOutcome[] = [...sources.values()].map((s) => ({
    kind: s.kind,
    node: s.object.id,
    kustomizeRoot: null,
    mark: nodeById.get(s.object.id)?.opaque ?? null,
  }));
  outcomes.push(...rootOutcomes);
  const report = assembleReport({
    scanned: identity.scanned,
    scannedPath: options.path,
    graph,
    analysis,
    config,
    sources: outcomes,
    skipped,
    unreadable,
    ignoredFiles: discovery.ignoredFiles,
    droppedHooks,
    timeouts,
    limits: budget.use(),
    toolchain,
    floating,
    undeployedKustomizeRoots: undeployed,
    helmRendered: commands.some((c) => c.tool === "helm" && c.subcommand[0] === "template"),
    unusedMatches: hosts.unusedRules(),
    matchOverrides: overrides,
    hiddenCycles: hidden,
    // explanatory only (US5.4): read after the analysis, which never sees it
    controllerMatches: matchControllerSignatures(objects, [...jobs.values()]),
    repoMappings: [
      ...config.repos.map((m) => ({
        url: m.url,
        root: m.readFrom === null ? "(fetch)" : m.readFrom === "" ? "." : m.readFrom,
        from: "crankpath.yaml" as const,
        used: usedMappings.has(`repos\n${m.normalised}`),
      })),
      ...aliases.map((a) => ({
        url: a.url,
        root: a.label,
        from: "--repo-alias" as const,
        used: usedMappings.has(`alias\n${a.normalised}`),
      })),
    ],
  });
  const commandCounts = new Map<string, number>();
  for (const c of commands) {
    const key = `${c.tool} ${c.subcommand.join(" ")}: ${OUTCOME_WORDS[c.outcome]}`;
    commandCounts.set(key, (commandCounts.get(key) ?? 0) + 1);
  }
  const diagnostics = [
    `sources found: ${outcomes.length}`,
    `render jobs run: ${[...jobCounts.values()].reduce((a, b) => a + b, 0)}`,
    ...[...jobCounts.entries()].sort(([a], [b]) => compareCodePoints(a, b)).map(([k, n]) => `  jobs ${k}: ${n}`),
    ...[...commandCounts.entries()].sort(([a], [b]) => compareCodePoints(a, b)).map(([k, n]) => `  ran ${k}: ${n}`),
    `helm test hooks dropped: ${droppedHooks}`,
    `objects read: ${objects.length}`,
    `extractors run: ${extracted.length}`,
    `nodes: ${graph.nodes.length}  edges: ${graph.edges.length}  cycles: ${analysis.cycles.length}`,
  ];
  return {
    kind: "report",
    report,
    exitCode: report.runStatus.state === "NOTHING ANALYSED" ? 2 : 0,
    rootReals: [...roots.values()].map((r) => r.real),
    diagnostics,
  };
}
