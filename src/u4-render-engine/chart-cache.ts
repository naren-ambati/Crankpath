// ChartCache (U4, contract C13; BR4.8 to BR4.10, FR3.9, FR1.8): a chart from a Helm repository or
// an OCI registry, stored under `.crankpath/charts/<repo-key>/<chart>/<version>/`, keyed by the
// guarded repository URL (as a digest), the chart name and the resolved version. A cache hit is
// used only for an exact version in a cache root crankpath trusts (one outside the scanned tree);
// a version that is a range or `*` is floating and needs the repository index. With `--no-network`
// nothing is fetched and a miss is opaque `offline`. A fetch is `helm pull` through the runner:
// one attempt, no credential; a refusal from the repository (401, 403) is `private-chart`; a 404,
// a rate limit or an unreachable host is reported as that outcome (never as an absent chart). The
// pulled chart is checked (no symlink, no special file, its own name) before helm renders it.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDataMap } from "../u1-graph-model/extractor.js";
import { makeOpaqueMark, type OpaqueMark } from "../u1-graph-model/graph-model.js";
import { openRoot, readYaml } from "../u2-intake-config/bounded-reader.js";
import { walkFiles } from "../u2-intake-config/tree-walk.js";
import type { ChartLocation } from "../u3-discovery-expansion/render-job.js";
import type { CommandResult } from "./command-runner.js";
import { commandMark, type RenderRuntime } from "./render-io.js";
import { guardChartUrl, URL_PROBLEM_WORDS } from "./url-guard.js";

export const CHART_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;
/** An exact SemVer 2 version, optionally with Helm's leading `v`. */
export const EXACT_VERSION =
  /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
/** The characters of a Helm version constraint (`^1.2`, `~1`, `>=1 <2`, `1.x`, `*`, `||`). */
const RANGE = /^[0-9A-Za-z.*^~<>=!|, +-]{1,128}$/;

/** An exact version as helm compares it (B2 review m7): SemVer without helm's optional leading `v`. */
export function normaliseVersion(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

/** True when a chart version is a range or `*` or absent (floating, OD-12). */
export function isFloatingVersion(version: string | null): boolean {
  return version === null || version === "" || !EXACT_VERSION.test(version);
}

/** A usable version text: exact or a constraint; never starting with `-` (never an option). */
export function isUsableVersion(version: string): boolean {
  return (EXACT_VERSION.test(version) || RANGE.test(version)) && !version.startsWith("-");
}

export type ChartResult =
  | { readonly ok: true; readonly dir: string; readonly version: string; readonly fromCache: boolean }
  | { readonly ok: false; readonly mark: OpaqueMark; readonly timedOut: boolean };

const RENDERS = "objects it renders";

function fail(
  reason: "offline" | "render-failed" | "private-chart" | "unsupported-field",
  detail: string,
): ChartResult {
  return { ok: false, mark: makeOpaqueMark({ reason, lostEdges: [RENDERS], detail }), timedOut: false };
}

/** The cache key's repository segment: a digest of the guarded URL (no host text in a path). */
export function repoKey(guardedUrl: string): string {
  return createHash("sha256").update(guardedUrl).digest("hex").slice(0, 32);
}

/** The name and version a chart directory's own Chart.yaml states, or null. */
function chartIdentity(dir: string): { name: string; version: string } | null {
  // `dir` is crankpath's own cache or pull directory (checked with lstat by the caller)
  const root = openRoot(dir);
  if (!root.ok) return null;
  const read = readYaml(root.root, "Chart.yaml");
  if (read.outcome !== "ok" || read.documents.length !== 1) return null;
  const doc = read.documents[0];
  if (!isDataMap(doc) || typeof doc.name !== "string" || typeof doc.version !== "string") return null;
  return { name: doc.name, version: doc.version };
}

function lstatDir(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Classifies a failed `helm pull` from its standard error (read here only; never shown). */
export function fetchFailureMark(result: CommandResult): OpaqueMark {
  if (result.outcome !== "failed") return commandMark("helm pull", result, RENDERS);
  const text = result.stderr
    .subarray(0, 64 * 1024)
    .toString("latin1")
    .toLowerCase();
  const detail = (d: string, reason: "private-chart" | "render-failed" = "render-failed") =>
    makeOpaqueMark({ reason, lostEdges: [RENDERS], detail: d });
  if (/\b40[13]\b|unauthorized|forbidden|denied/.test(text)) {
    return detail("the repository refused the request (crankpath sends no credential)", "private-chart");
  }
  if (/\b429\b|too many requests|rate limit|toomanyrequests/.test(text)) {
    return detail("the repository rate-limited the request; unknown whether the chart exists");
  }
  if (/\b404\b|not found|no chart version|no chart name/.test(text)) {
    return detail("the repository answered not found; unknown whether the chart exists for a client with credentials");
  }
  if (/no such host|dial tcp|connection refused|i\/o timeout|tls|x509|network is unreachable|eof/.test(text)) {
    return detail("the repository could not be reached; unknown whether the chart exists");
  }
  return detail("helm pull exited with an error");
}

/** Resolves a chart from a repository: the cache, or one guarded `helm pull`. */
export function getChart(loc: Extract<ChartLocation, { from: "repository" }>, rt: RenderRuntime): ChartResult {
  const guarded = guardChartUrl(loc.url);
  if (!guarded.ok) return fail("unsupported-field", URL_PROBLEM_WORDS[guarded.problem]);
  if (!CHART_NAME.test(loc.name)) return fail("unsupported-field", "not a chart name crankpath can use");
  if (loc.version !== null && loc.version !== "" && !isUsableVersion(loc.version)) {
    return fail("unsupported-field", "not a version or version range crankpath can use");
  }
  const floating = isFloatingVersion(loc.version);
  const key = repoKey(guarded.url);
  const charts = rt.work.trusted ? rt.work.chartsDir() : null;
  if (!floating && charts !== null) {
    const dir = path.join(charts, key, loc.name, normaliseVersion(loc.version as string));
    if (lstatDir(dir)) {
      const id = chartIdentity(dir);
      if (
        id !== null &&
        (guarded.scheme === "oci" || id.name === loc.name) &&
        normaliseVersion(id.version) === normaliseVersion(loc.version as string)
      ) {
        return { ok: true, dir, version: id.version, fromCache: true };
      }
    }
  }
  if (!rt.network) {
    if (floating)
      return fail("offline", "a version range needs the repository index, and --no-network fetches nothing");
    if (!rt.work.trusted) {
      return fail(
        "offline",
        "the chart cache is inside the scanned tree, so crankpath does not read it; use --cache-dir",
      );
    }
    return fail("offline", "not in the chart cache, and --no-network fetches nothing");
  }
  const pullDir = rt.work.makeDir("pull");
  if (!pullDir.ok) return fail("render-failed", "crankpath could not create its private directory");
  const args = [
    ...(guarded.scheme === "https" ? ["--repo", guarded.url] : []),
    ...(loc.version === null || loc.version === "" ? [] : ["--version", loc.version]),
    "--untar",
    "--untardir",
    pullDir.path,
    "--",
    guarded.scheme === "https" ? loc.name : `${guarded.url}/${loc.name}`,
  ];
  const result = rt.runner.run({ tool: "helm", subcommand: ["pull"], args, cwd: pullDir.path });
  rt.record(result);
  if (result.outcome !== "ok") return { ok: false, mark: fetchFailureMark(result), timedOut: result.timedOut };
  // The pull must have made exactly the chart's own directory and nothing a renderer should not read.
  const root = openRoot(pullDir.path);
  const listed = root.ok ? walkFiles(root.root, "", { recurse: true }) : null;
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(pullDir.path);
  } catch {
    entries = [];
  }
  // helm makes exactly one directory, named as the chart names itself; for a repository the chart
  // must be the one asked for, while an OCI reference's last segment need not be the chart's name
  const only = entries.length === 1 ? (entries[0] as string) : null;
  if (
    listed === null ||
    !listed.ok ||
    listed.refusals.length > 0 ||
    only === null ||
    (guarded.scheme === "https" && only !== loc.name)
  ) {
    return fail("render-failed", "the fetched chart holds a symlink, a special file or another chart's directory");
  }
  const pulled = path.join(pullDir.path, only);
  const id = chartIdentity(pulled);
  if (
    id === null ||
    id.name !== only ||
    (!floating && normaliseVersion(id.version) !== normaliseVersion(loc.version as string))
  ) {
    return fail("render-failed", "the fetched chart does not state the requested name and version");
  }
  if (!EXACT_VERSION.test(id.version) || charts === null)
    return { ok: true, dir: pulled, version: id.version, fromCache: false };
  // Store it (C13); a chart already at that key is left as it is and the pulled copy is rendered.
  const target = path.join(charts, key, loc.name, normaliseVersion(id.version));
  try {
    for (const p of [path.join(charts, key), path.join(charts, key, loc.name)]) {
      if (!lstatDir(p)) fs.mkdirSync(p, { mode: 0o700 });
    }
    if (!fs.existsSync(target)) {
      fs.renameSync(pulled, target);
      return { ok: true, dir: target, version: id.version, fromCache: false };
    }
  } catch {
    // caching is best effort; the render uses the pulled copy
  }
  return { ok: true, dir: pulled, version: id.version, fromCache: false };
}
