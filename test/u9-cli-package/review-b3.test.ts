// Regression tests for the B3 review through the pipeline: M1 (a hostile ApplicationSet ends in a
// counted limit, quickly, never out of memory) and m7 (the expander's own `limit` mark is kept when
// the run budget stops the generation, and the Applications built before it are kept).

import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { writeJson } from "../../src/u8-output/json-renderer.js";
import { DEFAULT_BUDGET, runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { estate } from "../helpers/scan.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

/** The review's generator (repros/amp-gen.mjs), written here: a list generator and a fat template. */
function amplifier(elements: number, annotations: number): string {
  let s =
    "apiVersion: argoproj.io/v1alpha1\nkind: ApplicationSet\nmetadata: {name: set, namespace: argocd}\nspec:\n  generators:\n  - list:\n      elements:\n";
  for (let i = 0; i < elements; i++) s += `      - env: a${i}\n`;
  s += '  template:\n    metadata:\n      name: "{{env}}"\n      annotations:\n';
  for (let j = 0; j < annotations; j++) s += `        k${j}: "v{{env}}x"\n`;
  s +=
    "    spec:\n      project: default\n      source: {repoURL: https://git.acme.dev/x/y.git, path: p, targetRevision: HEAD}\n      destination: {server: https://kubernetes.default.svc, namespace: ns}\n";
  return s;
}

function report(path: string, bytes: number) {
  const r = runPipeline({
    path,
    cwd: process.cwd(),
    repoUrl: "https://git.acme.dev/x/estate",
    budget: { ...DEFAULT_BUDGET, bytes },
  });
  if (r.kind !== "report") throw new Error(r.message);
  let json = "";
  writeJson(r.report, (c) => {
    json += c;
  });
  return JSON.parse(json);
}

describe("M1 and m7: a hostile ApplicationSet within the file limits", () => {
  it("stops generating when the run budget is reached, keeps what was built, and names its own limit", () => {
    const d = estate({ "set.yaml": amplifier(2_000, 200) });
    cleanup.push(d);
    const t0 = performance.now();
    // room for the file and its parse, then for about 140 of these Applications (each about 960 KB as charged)
    const r = report(d, 150_000_000);
    expect(performance.now() - t0).toBeLessThan(20_000);
    const apps = r.nodes.filter((n: { kind: string }) => n.kind === "Application");
    expect(apps.length).toBeGreaterThan(0);
    expect(apps.length).toBeLessThan(200);
    expect(r.opaque).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: "ApplicationSet/argocd/set",
          reason: "limit",
          detail: "the run's memory budget was reached while its Applications were generated",
        }),
      ]),
    );
    expect(r.runStatus.counts.runLimitJobs).toBe(1);
    expect(r.runStatus.floor).toBe(true);
    expect(r.runStatus.state).toBe("ANALYSED WITH GAPS");
  });
});
