// The cost-bound helper (test/helpers/cpu-time.ts) counts work, not waiting: a bound written in it fails
// when the work grows and not when the host is busy. Both directions are shown here.
import { describe, expect, it } from "vitest";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

const pause = new Int32Array(new SharedArrayBuffer(4));

describe("cpuSince", () => {
  it("does not count time spent waiting (a 300 ms blocking wait costs almost nothing)", () => {
    const wall = performance.now();
    const t0 = cpuStart();
    Atomics.wait(pause, 0, 0, 300);
    const cpu = cpuSince(t0);
    expect(performance.now() - wall).toBeGreaterThanOrEqual(290); // a wait can only last longer on a busy host
    expect(cpu).toBeLessThan(100);
  });

  it("counts time spent working, however long the work waits for a core", () => {
    // a fixed amount of work, never a time window, so a busy host cannot shorten it: 50 million dependent
    // square roots take far longer than 20 ms on any processor (each waits for the one before)
    const t0 = cpuStart();
    let x = 0;
    for (let i = 0; i < 50_000_000; i++) x = Math.sqrt(x + i);
    expect(x).toBeGreaterThan(0);
    expect(cpuSince(t0)).toBeGreaterThanOrEqual(20);
  });
});
