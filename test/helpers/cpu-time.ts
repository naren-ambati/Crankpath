// Cost bounds a busy host cannot break. A test that bounds how long crankpath's own work takes (a hostile
// input that must not go quadratic or hang) measures the CPU time this process spends on it (user plus
// system, `process.cpuUsage`), not the wall clock: under load the wall clock grows with the time the
// process waits for a core, the CPU time only with the work. The ceilings are the figures the tests had
// as wall-clock bounds; the CPU time each one measured on an idle run, and the margin, are recorded in
// BUILD-NOTES (release round, part B). Work done by a child process is not counted here: a test about a
// child bounds it by what the broken behaviour would take (the child's own run time), not by a guess.
//
// To re-measure: CRANKPATH_COST_LOG=<file outside the repository> npx vitest run, then read the file
// (one line per bound: the test's name and the CPU milliseconds).
import fs from "node:fs";
import { expect } from "vitest";

/** The process's CPU usage now: pass it to `cpuSince`. */
export function cpuStart(): NodeJS.CpuUsage {
  return process.cpuUsage();
}

/** CPU milliseconds (user plus system) this process has used since `start`. */
export function cpuSince(start: NodeJS.CpuUsage): number {
  const d = process.cpuUsage(start);
  const ms = (d.user + d.system) / 1000;
  const log = process.env.CRANKPATH_COST_LOG;
  if (log) fs.appendFileSync(log, `${expect.getState().currentTestName ?? "?"}\t${ms.toFixed(1)}\n`);
  return ms;
}
