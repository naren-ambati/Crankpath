// SourceDiscovery (U3; BR3.1 to BR3.3, FR1.1, FR1.6): walks the scanned root through the bounded
// tree walk and reader, classifies every YAML or JSON document by apiVersion and kind (Argo CD Application
// and ApplicationSet, Flux Kustomization and HelmRelease) and every `kustomization.yaml` by its
// name (a Kustomize root), expands `List` items, and counts every other file as ignored. A
// document is never trusted for what it says about itself beyond those two fields. A Helm chart's
// templates are not read as manifests.

import type { DataValue } from "../u1-graph-model/extractor.js";
import type { SourceKind } from "../u1-graph-model/status-model.js";
import { compareCodePoints } from "../u1-graph-model/order.js";
import type { ReadResult } from "../u2-intake-config/bounded-reader.js";
import type { WalkOutcome } from "../u2-intake-config/tree-walk.js";

export const KUSTOMIZATION_FILES: ReadonlySet<string> = new Set([
  "kustomization.yaml",
  "kustomization.yml",
  "Kustomization",
]);

/** Directory names never walked: git's own data, and crankpath's cache under the root. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([".git"]);
export const SKIP_AT_ROOT: ReadonlySet<string> = new Set([".crankpath"]);

/** A manifest file: `.yaml`, `.yml` or `.json`, the same set the plain renderer reads (as Argo CD does). */
export function isManifestFile(file: string): boolean {
  return file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json");
}

function basename(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

function dirname(file: string): string {
  const i = file.lastIndexOf("/");
  return i === -1 ? "" : file.slice(0, i);
}

/** The source kind of a document's apiVersion and kind, or null (BR3.1). */
export function sourceKindOf(apiVersion: string, kind: string): Exclude<SourceKind, "KustomizeRoot"> | null {
  const group = apiVersion.includes("/") ? apiVersion.slice(0, apiVersion.indexOf("/")) : "";
  if (group === "argoproj.io" && kind === "Application") return "Application";
  if (group === "argoproj.io" && kind === "ApplicationSet") return "ApplicationSet";
  if (group === "kustomize.toolkit.fluxcd.io" && kind === "Kustomization") return "Kustomization";
  if (group === "helm.toolkit.fluxcd.io" && kind === "HelmRelease") return "HelmRelease";
  return null;
}

function documentHasSource(value: DataValue): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const { apiVersion, kind } = value;
  if (typeof apiVersion === "string" && typeof kind === "string") {
    if (sourceKindOf(apiVersion, kind) !== null) return true;
    if (kind.endsWith("List") && Array.isArray(value.items)) return value.items.some(documentHasSource);
  }
  return false;
}

export interface DiscoveredFile {
  /** Canonical path relative to the scanned root. */
  readonly path: string;
  readonly documents: readonly DataValue[];
}

export interface Discovery {
  /** YAML files holding at least one source document, in code-point order. */
  readonly sourceFiles: readonly DiscoveredFile[];
  /** Kustomize root directories (canonical, `""` is the root), in code-point order. */
  readonly kustomizeRoots: readonly string[];
  /**
   * Helm chart directories (a `Chart.yaml`; canonical, `""` is the root), in code-point order, except
   * charts vendored inside another chart's `charts/` or `templates/` (FR7.4: a chart nothing deploys
   * is listed, and is rendered only when a crank says it is applied by hand).
   */
  readonly chartDirs: readonly string[];
  /** Files with no source: not YAML, or YAML with no source document. */
  readonly ignoredFiles: number;
  /** Refusals of the walk and of the reader (symlinks, limits, parse errors), canonical paths. */
  readonly unreadable: readonly {
    readonly path: string;
    readonly outcome: string;
    readonly reasonWord: string;
    readonly detail: string | null;
  }[];
}

export interface DiscoveryIo {
  walk(): WalkOutcome;
  read(path: string): ReadResult;
}

/** Discovers the sources of the scanned root. A walk that cannot start is the caller's error. */
export function discover(io: DiscoveryIo): Discovery | { readonly failed: true } {
  const walk = io.walk();
  if (!walk.ok) return { failed: true };
  const sourceFiles: DiscoveredFile[] = [];
  const roots = new Set<string>();
  const unreadable: { path: string; outcome: string; reasonWord: string; detail: string | null }[] = walk.refusals.map(
    (r) => ({ path: r.path, outcome: r.outcome, reasonWord: r.reasonWord, detail: r.detail ?? null }),
  );
  let ignoredFiles = 0;
  // A Helm chart's templates and vendored charts are not manifests (they are rendered, or are
  // archives): files under `<chart>/templates/` and `<chart>/charts/` of a directory holding a
  // `Chart.yaml` are counted as ignored, never parsed as YAML.
  const chartDirs = new Set(walk.files.filter((f) => basename(f) === "Chart.yaml").map(dirname));
  const inChartInternals = (file: string): boolean => {
    for (let d = dirname(file); ; d = dirname(d)) {
      const parent = dirname(d);
      const name = basename(d);
      if ((name === "templates" || name === "charts") && chartDirs.has(d === name ? "" : parent)) return true;
      if (d === "") return false;
    }
  };
  for (const file of walk.files) {
    if (inChartInternals(file)) {
      ignoredFiles += 1;
      continue;
    }
    if (KUSTOMIZATION_FILES.has(basename(file))) {
      roots.add(dirname(file));
      continue;
    }
    if (!isManifestFile(file)) {
      ignoredFiles += 1;
      continue;
    }
    const read = io.read(file);
    if (read.outcome !== "ok") {
      unreadable.push({
        path: read.path,
        outcome: read.outcome,
        reasonWord: read.reasonWord,
        detail: read.detail ?? null,
      });
      continue;
    }
    if (read.documents.some(documentHasSource)) sourceFiles.push({ path: read.path, documents: read.documents });
    else ignoredFiles += 1;
  }
  unreadable.sort((a, b) => compareCodePoints(a.path, b.path));
  const charts = walk.files.filter((f) => basename(f) === "Chart.yaml" && !inChartInternals(f)).map(dirname);
  return {
    sourceFiles,
    kustomizeRoots: [...roots].sort(compareCodePoints),
    chartDirs: [...new Set(charts)].sort(compareCodePoints),
    ignoredFiles,
    unreadable,
  };
}
