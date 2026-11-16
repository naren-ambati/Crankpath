#!/usr/bin/env node
// The golden lane (`npm run verify:golden`, after `npm run build`): every case under test/golden/
// run with the built crankpath and compared with its reviewed expected output, then every declared
// mutation of it run on a copy of its input, which must change the result (MutationChecker). The
// logic is `checkCase` in scripts/golden-lib.mjs; the offline test drives the same code.
//
// Each check prints PASS, FAIL or SKIPPED with its reason. A case that needs helm, kustomize, git
// or the network and does not find it here (or finds another helm or kustomize version than the
// one its expected output was reviewed with) is SKIPPED with the reason, and so are its mutations;
// a skip is never a pass. Exit 1 when any check failed, 2 when none failed but any was skipped
// (or only observed), 0 only when every check ran and passed.
//
//   node scripts/golden.mjs [--case <id>]... [--offline]
//   node scripts/golden.mjs --observe [--case <id>]...   run, write the outputs to the cache and
//                                                        print the reduced summary; compares nothing
//   node scripts/golden.mjs --pin <id>                   write a case's expected files from a run;
//                                                        refused until its reviewed.md exists
//
// Run the lane on an idle machine with a steady network: each run builds chart dependencies over the
// network in a fresh helm home and every render has a wall clock, so on a loaded machine a render may
// time out or fail. That is never a pass: the case FAILs, and the message names the counts that
// differ, the run's timeouts and opaque outcomes, and keeps the failed output in the cache.
//
// Fetched sources, work trees, crankpath's chart cache and every observed output are written under
// the golden cache (CRANKPATH_GOLDEN_CACHE, default <home>/.cache/crankpath-golden), never in the
// repository.

import fs from "node:fs";
import { BIN, cacheRoot, checkCase, laneExit, listCases, probeEnvironment } from "./golden-lib.mjs";

const argv = process.argv.slice(2);
/** @param {string} flag */
const values = (flag) =>
  argv.flatMap((a, i) => {
    const v = argv[i + 1];
    return a === flag && v !== undefined ? [v] : [];
  });
const pin = values("--pin")[0];
const mode = pin !== undefined ? "pin" : argv.includes("--observe") ? "observe" : "compare";
const only = pin === undefined ? values("--case") : [pin];

if (!fs.existsSync(BIN)) {
  console.log("golden lane: dist is missing: run npm run build first");
  process.exit(1);
}
const cache = cacheRoot();
const env = probeEnvironment({ offline: argv.includes("--offline") });
console.log(`crankpath golden lane, node ${process.version}, ${process.platform} ${process.arch}`);
for (const k of /** @type {const} */ (["helm", "kustomize", "git", "network"])) {
  const p = env[k];
  console.log(`  ${k}: ${p.ok ? (p.version ?? "reachable") : p.why}`);
}

/** @type {import("./golden-lib.mjs").CheckResult[]} */
const results = [];
const ids = listCases().filter((id) => only.length === 0 || only.includes(id));
for (const id of only) if (!ids.includes(id)) results.push({ result: "FAIL", name: id, why: "no such case" });
for (const id of ids) results.push(...checkCase(id, { cache, env, mode }));
for (const r of results) {
  console.log(`${r.result}  ${r.name}${r.why === "" ? "" : `  (${r.why})`}`);
  if (r.summary !== undefined) console.log(r.summary.replace(/^/gm, "    ").trimEnd());
}

const n = (/** @type {string} */ k) => results.filter((x) => x.result === k).length;
const observed = n("OBSERVED") > 0 ? `, ${n("OBSERVED")} observed (not compared, not a pass)` : "";
const skipNote = n("SKIPPED") > 0 ? " (a skipped golden is not a pass)" : "";
console.log(`golden lane: ${n("PASS")} passed, ${n("FAIL")} failed, ${n("SKIPPED")} skipped${observed}${skipNote}`);
process.exit(laneExit(results));
