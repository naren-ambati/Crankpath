// The run's memory budget (B1 review pass 2, N2): every file read, every object taken in from a
// render and every edge kept is charged at a measured rate in bytes against one derived budget
// (src/u1-graph-model/run-limits.ts, docs/limits.md). A charge that would exceed it is refused,
// and the refusal becomes a counted, named `limit` outcome (an unreadable file, an opaque job, a
// dropped edge), never a crash and never an out-of-memory abort. The budget is not sticky: only
// the item that does not fit is refused; a later item that fits is still taken in. Items are
// charged in canonical order (files in code-point order, sources in their sorted queue order), so
// which item is refused is the same on every machine, and depends on that order.

import type { RunCostRates } from "../u1-graph-model/run-limits.js";

export interface BudgetSpec {
  /** Bytes the run may charge. */
  readonly bytes: number;
  readonly rates: RunCostRates;
  /** The transient cost of parsing one file (lexemesPerFile's own terms), checked before it is parsed. */
  readonly parse: { readonly bytesPerLexeme: number; readonly textBytesPerByte: number };
  /** The edges a run may keep (edgesPerRun). */
  readonly maxEdges: number;
}

export interface BudgetUse {
  /** Files not read because the budget was reached. */
  readonly refusedFiles: number;
  /** Render jobs whose objects were not taken in. */
  readonly refusedJobs: number;
  /** Edges not kept over edgesPerRun. */
  readonly droppedEdges: number;
}

export class RunBudget {
  private spent = 0;
  refusedFiles = 0;
  refusedJobs = 0;
  droppedEdges = 0;

  constructor(readonly spec: BudgetSpec) {}

  private charge(cost: number): boolean {
    if (this.spent + cost > this.spec.bytes) return false;
    this.spent += cost;
    return true;
  }

  /**
   * Charges what the run holds whatever the budget (the discovered sources: their files are
   * already charged and held); later charges then find less room.
   */
  hold(cost: number): void {
    this.spent += cost;
  }

  /**
   * Whether a transient cost (a file's parse) fits in what the run has not yet held. Nothing is
   * charged: the transient is released after the parse. False (and counted as a refused file)
   * when it does not fit.
   */
  fitsTransient(cost: number): boolean {
    if (this.spent + cost <= this.spec.bytes) return true;
    this.refusedFiles += 1;
    return false;
  }

  /** Charges a file held parsed for the run; false (and counted) when the budget is reached. */
  file(bytes: number): boolean {
    const ok = this.charge(bytes * this.spec.rates.perFileByte);
    if (!ok) this.refusedFiles += 1;
    return ok;
  }

  /**
   * Whether a render output's parse transient fits in what the run has not yet held (B2): as
   * fitsTransient, but a refusal is a refused job (its owner is opaque `limit`). A comparison
   * render's refusal (`count` false) is not: its job keeps the first render (B2 review pass 3, m4).
   */
  fitsRenderTransient(cost: number, count = true): boolean {
    if (this.spent + cost <= this.spec.bytes) return true;
    if (count) this.refusedJobs += 1;
    return false;
  }

  /** Charges a render's output bytes, held parsed like a file's (B2); false (and a refused job) when the budget is reached. */
  render(bytes: number): boolean {
    const ok = this.charge(bytes * this.spec.rates.perFileByte);
    if (!ok) this.refusedJobs += 1;
    return ok;
  }

  /** Charges a render's objects and their string values; false (and counted) when the budget is reached. */
  objects(count: number, stringLeaves: number): boolean {
    const ok = this.charge(count * this.spec.rates.perObject + stringLeaves * this.spec.rates.perStringLeaf);
    if (!ok) this.refusedJobs += 1;
    return ok;
  }

  use(): BudgetUse {
    return { refusedFiles: this.refusedFiles, refusedJobs: this.refusedJobs, droppedEdges: this.droppedEdges };
  }
}
