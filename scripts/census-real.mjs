#!/usr/bin/env node
// The census with real discovery (OD-19, D12; dev-only, not shipped): runs the built crankpath
// (dist/, so run `npm run build` first) over each OD-26 estate's checkout at its recorded commit, with
// the helm and kustomize on PATH and the network (crankpath fetches charts and `repos:` entries
// read-only into a cache outside the repository), and counts opaque sources by reason from its JSON
// report. It writes the C11 census JSON with `label: real-discovery` (URLs, commits and counts only).
//
//   node scripts/census-real.mjs [--out <file>] [--cache <dir>]
//
// The checkouts are the ones the day-1 census fetched (`scripts/census.mjs`): --cache, else
// $CRANKPATH_CENSUS_CACHE, else `cache/census` beside this checkout; crankpath's own cache is
// `<cache>/../census-real/crankpath-cache`. A checkout whose HEAD is not the recorded commit is refused
// (that estate is reported failed, never counted). Two figures per estate:
//   d12       the D12 and OD-19 denominator: Applications (generated ones included) and HelmReleases,
//             plus each ApplicationSet or Flux Kustomization crankpath could not expand or read,
//             counted once (it stands for the Applications or HelmReleases it would have given: a floor);
//   allKinds  crankpath's own opacity line: every source of the five kinds (Applications,
//             ApplicationSets, Flux Kustomizations, HelmReleases and Kustomize roots).

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESTATES } from "./census.mjs";

export const D12_KINDS = Object.freeze(["Application", "HelmRelease"]);
/** Source kinds whose opaque instance stands for D12 sources it would have given, counted once. */
export const ONCE_KINDS = Object.freeze(["ApplicationSet", "Kustomization"]);
export const THRESHOLD = 1 / 3;

/** @param {number} opaque @param {number} total */
function fraction(opaque, total) {
  return total === 0 ? null : Math.round((opaque / total) * 10000) / 10000;
}

/** @param {Record<string, number>} m */
function sorted(m) {
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** @param {number} opaque @param {number} total @param {boolean} atLeast */
export function againstOneThird(opaque, total, atLeast) {
  if (total === 0) return "nothing counted";
  if (opaque / total > THRESHOLD) return "over one third";
  return atLeast ? "not established (at or under one third of what was counted, a floor)" : "at or under one third";
}

// crankpath's own field notation (`spec.sourceRef.kind`, `spec.generators[0].clusters`, `helmCharts`,
// `resources[1]`); anything else (a file path the field names, a field with words in it) is counted as
// `other field`, so no text of an estate enters the record.
const OWN_FIELD = /^(?:(?:spec|metadata)(?:\.[A-Za-z][A-Za-z0-9]*(?:\[\d+\])?)+|[a-z][A-Za-z]*(?:\[\d+\])?)$/;

/** The breakdown key of an opaque entry: reason, source kind and field. @param {any} o */
export function breakdownKey(o) {
  const field =
    typeof o.field === "string" && OWN_FIELD.test(o.field) ? o.field : o.field === null ? "no field" : "other field";
  return `${o.reason} | ${kindOf(o)} | ${field}`;
}

/** The kind of the source an opaque entry names (a Kustomize root has no node). @param {any} o */
function kindOf(o) {
  return o.node === null ? "KustomizeRoot" : (String(o.node).split("/")[0] ?? "");
}

/**
 * The two figures of one crankpath JSON report.
 * @param {any} r
 */
export function summarise(r) {
  const counts = r.runStatus.counts;
  /** @type {Record<string, number>} */
  const d12Breakdown = {};
  /** @type {Record<string, number>} */
  const allBreakdown = {};
  /** @type {Record<string, number>} */
  const d12Reasons = {};
  /** @type {Record<string, number>} */
  const allReasons = {};
  let d12Opaque = 0;
  let opaqueSets = 0;
  for (const o of r.opaque) {
    allReasons[o.reason] = (allReasons[o.reason] ?? 0) + 1;
    const key = breakdownKey(o);
    allBreakdown[key] = (allBreakdown[key] ?? 0) + 1;
    const k = kindOf(o);
    if (D12_KINDS.includes(k) || ONCE_KINDS.includes(k)) {
      d12Breakdown[key] = (d12Breakdown[key] ?? 0) + 1;
      d12Opaque += 1;
      d12Reasons[o.reason] = (d12Reasons[o.reason] ?? 0) + 1;
      if (ONCE_KINDS.includes(k)) opaqueSets += 1;
    }
  }
  const d12Total = counts.sourcesByKind.Application + counts.sourcesByKind.HelmRelease + opaqueSets;
  const atLeast = r.runStatus.floor === true || opaqueSets > 0;
  return {
    d12: {
      total: d12Total,
      opaque: d12Opaque,
      fraction: fraction(d12Opaque, d12Total),
      byReason: sorted(d12Reasons),
      byReasonKindField: sorted(d12Breakdown),
      opaqueCountedOnce: opaqueSets,
      atLeast,
      againstOneThird: againstOneThird(d12Opaque, d12Total, atLeast),
    },
    allKinds: {
      total: counts.sourcesFound,
      opaque: r.opaque.length,
      fraction: fraction(r.opaque.length, counts.sourcesFound),
      byKind: sorted({ ...counts.sourcesByKind }),
      byReason: sorted(allReasons),
      byReasonKindField: sorted(allBreakdown),
      atLeast: r.runStatus.floor === true,
      againstOneThird: againstOneThird(r.opaque.length, counts.sourcesFound, r.runStatus.floor === true),
    },
    runStatus: r.runStatus.state,
    gaps: r.runStatus.reasons,
    unreadableFiles: counts.unreadableFiles,
    timeouts: counts.timeouts,
  };
}

/**
 * The total over the estates' summaries.
 * @param {{ d12: any, allKinds: any }[]} estates
 */
export function total(estates) {
  /** @param {"d12" | "allKinds"} k */
  const sum = (k) => {
    /** @type {Record<string, number>} */
    const reasons = {};
    /** @type {Record<string, number>} */
    const breakdown = {};
    let t = 0;
    let o = 0;
    let atLeast = false;
    for (const e of estates) {
      t += e[k].total;
      o += e[k].opaque;
      atLeast = atLeast || e[k].atLeast;
      for (const [r, n] of Object.entries(e[k].byReason)) reasons[r] = (reasons[r] ?? 0) + /** @type {number} */ (n);
      for (const [r, n] of Object.entries(e[k].byReasonKindField ?? {}))
        breakdown[r] = (breakdown[r] ?? 0) + /** @type {number} */ (n);
    }
    return {
      total: t,
      opaque: o,
      fraction: fraction(o, t),
      byReason: sorted(reasons),
      byReasonKindField: sorted(breakdown),
      atLeast,
      againstOneThird: againstOneThird(o, t, atLeast),
    };
  };
  return { d12: sum("d12"), allKinds: sum("allKinds") };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cacheDir = path.resolve(
    opt("--cache") ?? process.env.CRANKPATH_CENSUS_CACHE ?? path.join(repoRoot, "..", "cache", "census"),
  );
  if (cacheDir === repoRoot || cacheDir.startsWith(`${repoRoot}${path.sep}`)) {
    console.error("census-real: the cache must be outside the repository");
    process.exit(1);
  }
  const crankCache = path.join(path.dirname(cacheDir), "census-real", "crankpath-cache");
  fs.mkdirSync(crankCache, { recursive: true });
  const cli = path.join(repoRoot, "dist", "u9-cli-package", "cli.js");
  const estates = [];
  const toolchains = new Set();
  for (const e of ESTATES) {
    const dir = path.join(cacheDir, e.url.replace("https://github.com/", "").replace("/", "_"));
    let head = "";
    try {
      head = execFileSync("git", ["-C", dir, "rev-parse", "--verify", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      head = "";
    }
    if (head !== e.sha) {
      estates.push({ url: e.url, sha: e.sha, failed: "the checkout is missing or not at the recorded commit" });
      continue;
    }
    const r = spawnSync(
      process.execPath,
      [cli, dir, "--repo-url", e.url, "--format", "json", "--cache-dir", crankCache],
      {
        encoding: "utf8",
        maxBuffer: 1 << 30,
      },
    );
    let report;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      estates.push({ url: e.url, sha: e.sha, failed: `crankpath gave no report (exit ${r.status})` });
      continue;
    }
    toolchains.add(`helm ${report.toolchain.helm ?? "missing"}, kustomize ${report.toolchain.kustomize ?? "missing"}`);
    estates.push({ url: e.url, sha: e.sha, exit: r.status, ...summarise(report) });
  }
  const counted = estates.filter((e) => !("failed" in e));
  const out = {
    label: "real-discovery",
    method:
      "the built crankpath over each checkout at its recorded commit, with helm, kustomize and the network; counts from its JSON report",
    toolchain: [...toolchains].sort(),
    units: {
      d12: "Applications (generated ones included) and HelmReleases, plus each ApplicationSet or Flux Kustomization crankpath could not expand or read, counted once",
      allKinds:
        "every source crankpath counts: Applications, ApplicationSets, Flux Kustomizations, HelmReleases and Kustomize roots",
    },
    threshold: "1/3",
    estates,
    failedEstates: estates.length - counted.length,
    total: total(/** @type {any[]} */ (counted)),
  };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  const file = opt("--out");
  if (file === undefined) process.stdout.write(text);
  else fs.writeFileSync(file, text);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
