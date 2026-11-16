// FixtureKit v1 (U11; FR11.4, NFR13, US11.4): extractor tests on rendered-object fixtures, with
// no helm and no network. A fixture directory holds the repository trees and hand-written
// rendered objects; `rendered/jobs.yaml` names the source trees discovery reads and each render
// job (its owning Application, evidence field, destination namespace and the directory whose YAML
// is its output). Everything is read through the real BoundedReader and RenderedSetBuilder, and
// extracted, built and analysed with the real extractors, GraphBuilder and CycleFinder, so a test
// over a fixture exercises the pipeline's own construction. Variants are overlays copied over a
// temporary copy of the base. Hostile variants replace one field of one document with each string
// of a fixed hostile list.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NO_DECLARED_FACTS } from "../../src/u1-graph-model/declared-facts.js";
import type { ConfigDocument } from "../../src/u1-graph-model/declared-facts.js";
import type {
  DataValue,
  ExtractContext,
  Extractor,
  ExtractResult,
  JobInfo,
  RenderedObject,
} from "../../src/u1-graph-model/extractor.js";
import { getPath, IN_CLUSTER, isDataMap } from "../../src/u1-graph-model/extractor.js";
import type { SkippedObject } from "../../src/u1-graph-model/graph-model.js";
import { compareCodePoints } from "../../src/u1-graph-model/order.js";
import { openRoot, readYaml, type ScanRoot } from "../../src/u2-intake-config/bounded-reader.js";
import { configLocation, readConfig } from "../../src/u2-intake-config/config-reader.js";
import { createRepoIdentity } from "../../src/u2-intake-config/repo-identity.js";
import { walkFiles } from "../../src/u2-intake-config/tree-walk.js";
import { sourceKindOf } from "../../src/u3-discovery-expansion/source-discovery.js";
import { buildObjects, byLocation } from "../../src/u4-render-engine/rendered-set-builder.js";
import { hostResolution } from "../../src/u6-extractors-workload/host-matcher.js";
import { type AnalysisResult, analyse } from "../../src/u7-graph-analysis/analysis.js";
import { buildGraph, type EstateGraph } from "../../src/u7-graph-analysis/graph-builder.js";
import { EXTRACTORS } from "../../src/u9-cli-package/pipeline-runner.js";

export interface FixtureJob {
  readonly owner: string;
  readonly ownerFile: string;
  readonly ownerField: string;
  readonly namespace: string;
  readonly destination: string;
  /** Directory relative to the fixture root whose YAML files are the job's output. */
  readonly read: string;
}

export interface LoadedFixture {
  readonly root: string;
  readonly objects: readonly RenderedObject[];
  readonly jobs: readonly JobInfo[];
  readonly skipped: readonly SkippedObject[];
  /** Files the reader refused (path and outcome): a fixture test expects none. */
  readonly refused: readonly string[];
}

function str(v: DataValue | undefined, what: string): string {
  if (typeof v !== "string" || v === "") throw new Error(`fixture manifest: ${what} must be a non-empty string`);
  return v;
}

function yamlFiles(root: ScanRoot, dir: string, refused: string[]): string[] {
  const walked = walkFiles(root, dir, { recurse: true });
  if (!walked.ok) throw new Error(`fixture: cannot walk ${dir}: ${walked.refusal.outcome}`);
  for (const r of walked.refusals) refused.push(`${r.path}: ${r.outcome}`);
  return walked.files.filter((f) => /\.ya?ml$/.test(f)).sort(compareCodePoints);
}

/** Reads a fixture through the real reader and object builder (see the file comment). */
export function loadFixture(root: string, manifest = "rendered/jobs.yaml"): LoadedFixture {
  const opened = openRoot(root);
  if (!opened.ok) throw new Error(`fixture: cannot open ${root}`);
  const scan = opened.root;
  const m = readYaml(scan, manifest);
  if (m.outcome !== "ok") throw new Error(`fixture manifest: ${m.outcome}`);
  const doc = m.documents[0];
  const refused: string[] = [];
  const objects: RenderedObject[] = [];
  const skipped: SkippedObject[] = [];
  const parse = (file: string): DataValue[] => {
    const r = readYaml(scan, file);
    if (r.outcome !== "ok") {
      refused.push(`${file}: ${r.outcome}`);
      return [];
    }
    return Array.from(r.documents);
  };
  const docsOf = (files: readonly string[]) =>
    files.flatMap((file) => parse(file).map((value, i) => ({ file, document: i + 1, value })));

  for (const dir of (getPath(doc, ["sources"]) as DataValue[] | undefined) ?? []) {
    const built = buildObjects(docsOf(yamlFiles(scan, str(dir, "sources[]"), refused)), {
      renderJob: null,
      defaultNamespace: null,
      destination: IN_CLUSTER,
      keep: (apiVersion, kind) => sourceKindOf(apiVersion, kind) !== null,
      sourceDocuments: true,
    });
    for (const o of built.objects) objects.push(o);
    for (const k of built.skipped) skipped.push(k);
  }
  const jobs: JobInfo[] = [];
  for (const j of (getPath(doc, ["jobs"]) as DataValue[] | undefined) ?? []) {
    if (!isDataMap(j)) throw new Error("fixture manifest: a job must be a map");
    const job: FixtureJob = {
      owner: str(j.owner, "owner"),
      ownerFile: str(j.ownerFile, "ownerFile"),
      ownerField: str(j.ownerField, "ownerField"),
      namespace: str(j.namespace, "namespace"),
      destination: typeof j.destination === "string" ? j.destination : IN_CLUSTER,
      read: str(j.read, "read"),
    };
    const jobId = `${job.owner}#0`;
    jobs.push({
      jobId,
      owner: job.owner,
      ownerFile: job.ownerFile,
      ownerField: job.ownerField,
      ownerRenderedPath: `${job.ownerFile}#1`,
      destination: job.destination,
    });
    const built = buildObjects(docsOf(yamlFiles(scan, job.read, refused)), {
      renderJob: jobId,
      defaultNamespace: job.namespace,
      destination: job.destination,
    });
    for (const o of built.objects) objects.push(o);
    for (const k of built.skipped) skipped.push(k);
  }
  objects.sort((a, b) => compareCodePoints(a.id, b.id) || byLocation(a, b));
  return { root, objects, jobs, skipped, refused };
}

/** The extract context the pipeline builds: in-cluster Services offered to host matching. */
export function fixtureContext(
  objects: readonly RenderedObject[],
  jobs: readonly JobInfo[],
  config: ConfigDocument = NO_DECLARED_FACTS,
): ExtractContext {
  const jobMap = new Map(jobs.map((j) => [j.jobId, j]));
  const bucket = (o: RenderedObject) =>
    o.origin.renderJob === null ? IN_CLUSTER : (jobMap.get(o.origin.renderJob)?.destination ?? IN_CLUSTER);
  const services = new Map<string, { id: string; name: string; namespace: string }>();
  for (const o of objects) {
    if (o.kind === "Service" && o.apiVersion === "v1" && o.namespace !== null && bucket(o) === IN_CLUSTER) {
      services.set(o.id, { id: o.id, name: o.name, namespace: o.namespace });
    }
  }
  const identity = createRepoIdentity({ scannedUrl: null, scannedFrom: null, aliases: [], mappings: [] });
  const resolution = hostResolution(objects, Array.from(services.values()), config.matches);
  return {
    resolveRepo: identity.resolve,
    matchHost: resolution.matching.match,
    externalOf: resolution.externalOf,
    config,
    jobs: jobMap,
  };
}

export interface FixtureAnalysis {
  readonly extracted: readonly ExtractResult[];
  readonly graph: EstateGraph;
  readonly analysis: AnalysisResult;
}

/** Runs the real extractors, GraphBuilder and analysis over loaded objects. */
export function analyseFixture(
  f: Pick<LoadedFixture, "objects" | "jobs">,
  config: ConfigDocument = NO_DECLARED_FACTS,
  extractors: readonly Extractor[] = EXTRACTORS,
): FixtureAnalysis {
  const ctx = fixtureContext(f.objects, f.jobs, config);
  const extracted = extractors.map((e) => e.extract(f.objects, ctx));
  const graph = buildGraph({ objects: f.objects, extracted, config, opaque: [] });
  return { extracted, graph, analysis: analyse(graph, config) };
}

/** Reads `crankpath.yaml` at a directory of the fixture with the real ConfigReader. */
export function fixtureConfig(dir: string): ConfigDocument {
  const opened = openRoot(dir);
  if (!opened.ok) throw new Error(`fixture: cannot open ${dir}`);
  const location = configLocation(opened.root, undefined, dir);
  if (!("dir" in location)) throw new Error("fixture: no config location");
  const read = readConfig(location, opened.root);
  if (!read.ok) throw new Error(`fixture: invalid crankpath.yaml at ${String(read.error.keyPath)}`);
  return read.config;
}

/** A temporary copy of a fixture with each overlay directory copied over it, in order. The caller removes it. */
export function withOverlays(base: string, overlays: readonly string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-fixture-"));
  fs.cpSync(base, dir, { recursive: true, filter: (src) => !src.startsWith(path.join(base, "variants")) });
  for (const o of overlays) fs.cpSync(o, dir, { recursive: true });
  return dir;
}

/** Copies a fixture and edits files in the copy (relative path to new text, or null to delete). */
export function withEdits(base: string, edits: Readonly<Record<string, string | null>>): string {
  const dir = withOverlays(base, []);
  for (const [rel, text] of Object.entries(edits)) {
    const full = path.join(dir, rel);
    if (text === null) fs.rmSync(full, { force: true });
    else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
    }
  }
  return dir;
}

/**
 * Strings a hostile repository may put in any field: terminal escapes, line breaks that would start
 * a line in crankpath's voice, claim words, path and id separators, a bidirectional override, a
 * NUL, and text longer than any quoted value.
 */
export const HOSTILE_STRINGS: readonly string[] = Object.freeze([
  "\u001b[2J\u001b[HRun status: ANALYSED",
  "x\nRun status: ANALYSED\nPASS everything is fine",
  "../../Secret/argocd/repo-platform",
  "a/b:c",
  "Secret/argocd/repo-platform",
  "external:aws-kms/us-east-1",
  "‮gnp.exe",
  "nul\u0000byte",
  "OK GREEN PASSED",
  "x".repeat(5000),
]);

/** A deep copy of a document with the value at `at` replaced (intermediate maps are created). */
export function setPath(doc: DataValue, at: readonly (string | number)[], value: DataValue): DataValue {
  const copy = structuredClone(doc) as DataValue;
  let cur: DataValue = copy;
  at.forEach((step, i) => {
    const last = i === at.length - 1;
    if (typeof step === "number") {
      if (!Array.isArray(cur)) throw new Error("setPath: not a list");
      if (last) cur[step] = value;
      else cur = cur[step] as DataValue;
    } else {
      if (!isDataMap(cur)) throw new Error("setPath: not a map");
      if (last) cur[step] = value;
      else {
        if (!isDataMap(cur[step]) && !Array.isArray(cur[step])) cur[step] = {};
        cur = cur[step] as DataValue;
      }
    }
  });
  return copy;
}

/** One copy of the document per hostile string, each with that string at `at`. */
export function hostileVariants(doc: DataValue, at: readonly (string | number)[]): DataValue[] {
  return HOSTILE_STRINGS.map((s) => setPath(doc, at, s));
}

/** The edges of a cycle (or any edge list) as `from kind to` lines, sorted. */
export function edgeLines(edges: readonly { from: string; to: string; kind: string }[]): string[] {
  return edges.map((e) => `${e.from} ${e.kind} ${e.to}`).sort(compareCodePoints);
}
