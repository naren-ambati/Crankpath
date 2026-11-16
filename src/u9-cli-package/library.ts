// crankpath as a library. UNSTABLE until 1.0: these exports may change in any release before 1.0.0.
// The stable contract is the JSON output (schemaVersion), not this module.

export type { ConfigDocument } from "../u1-graph-model/declared-facts.js";
export type { Extractor, ExtractContext, ExtractResult, RenderedObject } from "../u1-graph-model/extractor.js";
export type { Edge, GraphNode, NodeId } from "../u1-graph-model/graph-model.js";
export type { AnalysisResult, CrankEffect, NodeVerdict, Plan, PlanStep } from "../u7-graph-analysis/analysis.js";
export { analyse } from "../u7-graph-analysis/analysis.js";
export type { ControllerMatch, ControllerSignature } from "../u5-extractors-gitops/controller-signatures.js";
export type { Cycle } from "../u7-graph-analysis/cycle-finder.js";
export type { EstateGraph } from "../u7-graph-analysis/graph-builder.js";
export { type ExplainTarget, explainTarget, renderExplain } from "../u8-output/explain-renderer.js";
export { renderJson } from "../u8-output/json-renderer.js";
export { renderMermaid } from "../u8-output/mermaid-renderer.js";
export { CRANKPATH_VERSION } from "../u8-output/report-assembler.js";
export type { Report } from "../u8-output/report-model.js";
export { renderText } from "../u8-output/text-renderer.js";
export { main } from "./cli-shell.js";
export { EXTRACTORS, type RunOptions, type RunOutcome, runPipeline } from "./pipeline-runner.js";
