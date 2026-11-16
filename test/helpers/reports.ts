// Test helpers: whole Reports from a FixtureKit fixture (the real extractors, GraphBuilder, analysis
// and ReportAssembler over hand-written rendered objects, no helm, no network), so the renderers can
// be tested on the Vault fixture's two cycles and on the self-managed Argo CD fixture.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ConfigDocument } from "../../src/u1-graph-model/declared-facts.js";
import { NO_DECLARED_FACTS } from "../../src/u1-graph-model/declared-facts.js";
import { createRepoIdentity } from "../../src/u2-intake-config/repo-identity.js";
import { sourceKindOf } from "../../src/u3-discovery-expansion/source-discovery.js";
import {
  type ControllerSignature,
  CONTROLLER_SIGNATURES,
  matchControllerSignatures,
} from "../../src/u5-extractors-gitops/controller-signatures.js";
import { analyse } from "../../src/u7-graph-analysis/analysis.js";
import type { EstateGraph } from "../../src/u7-graph-analysis/graph-builder.js";
import { assembleReport } from "../../src/u8-output/report-assembler.js";
import type { Report } from "../../src/u8-output/report-model.js";
import { analyseFixture, fixtureConfig, loadFixture, withOverlays } from "./fixture-kit.js";

export const VAULT = fileURLToPath(new URL("../fixtures/vault/", import.meta.url));
export const SELF_MANAGED = fileURLToPath(new URL("../fixtures/self-managed/", import.meta.url));

/** A Report over a fixture root (its rendered/jobs.yaml), as the pipeline would assemble it. */
export function fixtureReport(
  root: string,
  url: string,
  config: ConfigDocument = NO_DECLARED_FACTS,
  signatures: readonly ControllerSignature[] = CONTROLLER_SIGNATURES,
): Report {
  const loaded = loadFixture(root);
  const { graph, analysis } = analyseFixture(loaded, config);
  const identity = createRepoIdentity({ scannedUrl: url, scannedFrom: "flag", aliases: [], mappings: [] });
  // every source-kind object is a source, whether discovery read it or a render produced it (as
  // the pipeline's worklist plans a source found in a render), once per id
  const sources = [...new Map(loaded.objects.map((o) => [o.id, o])).values()]
    .filter((o) => sourceKindOf(o.apiVersion, o.kind) !== null)
    .map((o) => ({
      kind: sourceKindOf(o.apiVersion, o.kind) as NonNullable<ReturnType<typeof sourceKindOf>>,
      node: o.id,
      kustomizeRoot: null,
      mark: null,
    }));
  return assembleReport({
    scanned: identity.scanned,
    scannedPath: "gitops",
    graph,
    analysis,
    config,
    sources,
    skipped: loaded.skipped,
    unreadable: [],
    ignoredFiles: 0,
    droppedHooks: 0,
    timeouts: 0,
    limits: { refusedFiles: 0, refusedJobs: 0, droppedEdges: 0 },
    controllerMatches: matchControllerSignatures(loaded.objects, loaded.jobs, signatures),
  });
}

/** The Vault fixture's Report, with variant overlays (`crank-a`, `ca-issuer`) applied. */
export function vaultReport(overlays: readonly string[]): Report {
  const variants = overlays.map((v) => fileURLToPath(new URL(`../fixtures/vault/variants/${v}/`, import.meta.url)));
  const root = overlays.length === 0 ? VAULT : withOverlays(VAULT, variants);
  try {
    const config = overlays.length === 0 ? NO_DECLARED_FACTS : fixtureConfig(`${root}/gitops`);
    return fixtureReport(root, "https://github.com/acme/platform-gitops", config);
  } finally {
    if (root !== VAULT) fs.rmSync(root, { recursive: true, force: true });
  }
}

/** A Report over a synthetic graph (test/helpers/graphs.ts), through the real analysis and assembler. */
export function graphReport(g: EstateGraph, f: ConfigDocument = NO_DECLARED_FACTS): Report {
  return assembleReport({
    scanned: { url: null, normalised: null, name: null, from: null },
    scannedPath: ".",
    graph: g,
    analysis: analyse(g, f),
    config: f,
    sources: [{ kind: "Application", node: g.nodes[0]?.id ?? null, kustomizeRoot: null, mark: null }],
    skipped: [],
    unreadable: [],
    ignoredFiles: 0,
    timeouts: 0,
    droppedHooks: 0,
    limits: { refusedFiles: 0, refusedJobs: 0, droppedEdges: 0 },
  });
}
