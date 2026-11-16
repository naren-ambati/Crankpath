export interface Facts {
  lines?: string[];
  contains?: string[];
  absent?: string[];
  startCounts?: Record<string, number>;
  empty?: boolean;
}
export interface Run {
  name: string;
  setup?: string[];
  args: string[];
  env?: Record<string, string>;
  exit: number;
  stdout: Facts;
  stderr: Facts;
  sameAs?: string;
}
export interface Example {
  lane: string;
  what: string;
  runs: Run[];
}
export interface Expected {
  about: string;
  edits: { example: string; run: string; what: string; why: string }[];
  examples: Record<string, Example>;
}
export interface Result {
  exit: number | null;
  stdout: string;
  stderr: string;
}
export declare const ROOT: string;
export declare const CLI: string;
export declare const EXAMPLES: string;
export declare const EXPECTED_FILE: string;
export declare const LANES: readonly string[];
export declare function loadExpected(file?: string): Expected;
export declare function shapeProblems(expected: Expected): string[];
export declare function runEnv(extra?: Record<string, string>): Record<string, string>;
export declare function runExample(run: Run): Result;
export declare function factProblems(facts: Facts, text: string, label: string): string[];
export declare function checkRun(run: Run, result: Result): string[];
export declare function pinnedPaths(
  example: string,
  run: string,
  examplesDir?: string,
): { dir: string; stdout: string; stderr: string };
export declare function readPinned(
  example: string,
  run: string,
  examplesDir?: string,
): { stdout: string; stderr: string } | null;
export declare function comparePinned(example: string, run: Run, result: Result): string[];
export declare function allRuns(expected: Expected): [string, Example, Run][];
export declare const DOC_FILE: string;
export declare function quotedText(
  example: string,
  run: string,
  stream: "stdout" | "stderr",
  key: string | undefined,
): string | null;
export declare function docQuotes(text: string): {
  example: string;
  run: string;
  stream: "stdout" | "stderr";
  key: string | undefined;
  body: string;
  open: number;
  close: number;
  line: number;
}[];
