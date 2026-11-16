// The per-run memory limits (B1 review pass 2, N2; OD-5): derived, never picked. What they
// protect: the heap of one run on the smallest GitHub-hosted runner, so a hostile estate ends in a
// counted `limit` outcome instead of an out-of-memory abort. The heap figure is the one B0's
// review derived for tokensPerDocument (V8 12.4's default old generation for Node 22 on
// `ubuntu-slim`, 5 GB: 5,000,000,000 / 4 x 2 = 2,500,000,000 bytes). The rates are measured in
// crankpath's own structures by scripts/measure-run-limits.mjs (peak resident memory of a whole
// run, JSON output held in memory as for `--out`), so they include the graph, the report and the
// output. docs/limits.md is the reader's copy with the measurement output.
//
// Per-render limits (rendered objects of one helm or kustomize render, render time and bytes) are
// B2's, derived at its step 0; these are per run.

import type { DerivedLimit } from "./limits.js";

/** Bytes charged per unit, from the measurement (each the worst of its shapes, rounded up). */
export interface RunCostRates {
  /** Per byte of a file read and held parsed for the run (the read cache). */
  readonly perFileByte: number;
  /** Per object taken in from a render or discovery (its node, the edge to its owner, report entry, output). */
  readonly perObject: number;
  /**
   * Per string value of an object: every edge an extractor can make names its target by one of the
   * object's string values, so each is charged as the costliest edge (one with a stub node and an
   * unresolved item) before extraction runs.
   */
  readonly perStringLeaf: number;
  /** Per edge kept (with a stub node and an unresolved item, the costliest edge). */
  readonly perEdge: number;
}

const DATE = "2026-11-15";
// V8 12.4's default old generation for Node 22 on the smallest GitHub-hosted runner (ubuntu-slim,
// 5 GB): 5,000,000,000 / 4 x 2 bytes (the figure B0's review derived for tokensPerDocument).
const HEAP_BYTES = 2_500_000_000;
// Measured (scripts/measure-run-limits.mjs, 2026-11-15, Node 22.23.2, macOS arm64): peak resident
// memory of a whole run over the thin-slice fixture, the larger of two runs.
export const RUN_BASELINE_BYTES = 51_380_224;
// Measured (same run): peak-memory difference over unit difference between two sizes of a shape,
// rounded up: files 15.1 (block maps) and 32.5 (flow sequence of short strings) bytes per file
// byte; objects 6,677.2 bytes per object; edges with stubs 4,664.9 bytes per edge.
export const RUN_RATES: RunCostRates = Object.freeze({
  perFileByte: 33,
  perObject: 6678,
  perStringLeaf: 4665,
  perEdge: 4665,
});

// One heap figure is the only budget (lead decision after merging B0's final reader): no reserve.
// A file's parse is a transient checked against what the run has not yet held, before parsing
// (lexemesPerFile's own terms; pipeline-runner.ts), and released after it.
const BUDGET = HEAP_BYTES - RUN_BASELINE_BYTES;
const BASIS =
  "2,500,000,000 bytes (V8 12.4's default old generation for Node 22 on ubuntu-slim, the smallest GitHub-hosted runner: 5,000,000,000 / 4 x 2) minus 51,380,224 bytes (a run's measured baseline); each file's parse is a transient that must fit in what the run has not yet held";

/**
 * The transient memory of parsing one file, in the terms lexemesPerFile is derived from (limits.ts:
 * B0's measured worst 937 resident bytes per lexeme, and its text reserve of 3 bytes per byte: the
 * read buffer plus a decoded string). A test checks lexemesPerFile against these two numbers.
 */
export const READER_PARSE_COST = Object.freeze({ bytesPerLexeme: 937, textBytesPerByte: 3 });

export interface RunLimitSet {
  readonly runMemory: DerivedLimit<"bytes">;
  readonly objectsPerRun: DerivedLimit<"objects">;
  readonly edgesPerRun: DerivedLimit<"edges">;
  readonly nodesPerRun: DerivedLimit<"nodes">;
}

const objectsPerRun = Math.floor(BUDGET / RUN_RATES.perObject);
const edgesPerRun = Math.floor(BUDGET / RUN_RATES.perEdge);

export const RUN_LIMITS: RunLimitSet = Object.freeze({
  runMemory: Object.freeze({
    status: "derived",
    value: BUDGET,
    unit: "bytes",
    protects: "the heap of one run: files held parsed, objects, nodes, edges, report and output together",
    basis: BASIS,
    date: DATE,
  }),
  objectsPerRun: Object.freeze({
    status: "derived",
    value: objectsPerRun,
    unit: "objects",
    protects: "the heap of one run, when the run holds only objects",
    basis: `runMemory / ${RUN_RATES.perObject} bytes per object (measured); enforced as a charge, with each object's string values charged too`,
    date: DATE,
  }),
  edgesPerRun: Object.freeze({
    status: "derived",
    value: edgesPerRun,
    unit: "edges",
    protects: "the heap of one run, when the run holds only edges with their stubs",
    basis: `runMemory / ${RUN_RATES.perEdge} bytes per edge with a stub node and an unresolved item (measured)`,
    date: DATE,
  }),
  nodesPerRun: Object.freeze({
    status: "derived",
    value: objectsPerRun + edgesPerRun,
    unit: "nodes",
    protects: "the heap of one run",
    basis:
      "objectsPerRun + edgesPerRun: a node is an object, a stub (made only by an edge) or a declared external (bounded by the config file's own limits), so the two bounds above bound it; it is not charged separately",
    date: DATE,
  }),
});
