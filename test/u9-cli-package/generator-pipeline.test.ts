// ApplicationSet expansion and the scan's file limit through the whole pipeline (B3): limits are
// counted outcomes that make the counts a floor; a `render:` crank never creates a generated
// Application; an unreadable generator repository still keeps its host-match edge (AC2.4.5).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { writeJson } from "../../src/u8-output/json-renderer.js";
import { renderTextLines } from "../../src/u8-output/text-renderer.js";
import { DEFAULT_BUDGET, type RunOptions, runPipeline } from "../../src/u9-cli-package/pipeline-runner.js";
import { app, estate, tempDir } from "../helpers/scan.js";

const HOMELAB = fileURLToPath(new URL("../fixtures/homelab-shape/repo", import.meta.url));
const FORGE = "http://gitea-http.gitea:3000/ops/homelab";
const SELF = "https://git.example.org/ops/homelab";
const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

function outputs(options: Omit<RunOptions, "cwd"> & { cwd?: string }) {
  const r = runPipeline({ cwd: process.cwd(), ...options });
  if (r.kind !== "report") throw new Error(r.message);
  let json = "";
  writeJson(r.report, (c) => {
    json += c;
  });
  return { text: `${renderTextLines(r.report).join("\n")}\n`, report: JSON.parse(json) };
}
function copy(extra: Record<string, string> = {}): string {
  const d = tempDir("gen");
  cleanup.push(d);
  fs.cpSync(HOMELAB, path.join(d, "repo"), { recursive: true });
  for (const [rel, content] of Object.entries(extra)) fs.writeFileSync(path.join(d, "repo", rel), content);
  return path.join(d, "repo");
}

describe("the generated-Application limit through the pipeline (AC3.3.5)", () => {
  it("keeps the first ones, makes the ApplicationSet opaque limit and the counts a floor", () => {
    const o = outputs({
      path: HOMELAB,
      repoUrl: SELF,
      repoAliases: [`${FORGE}=${HOMELAB}`],
      expansionLimits: { applications: 2, patternSteps: 1_000_000 },
    });
    const apps = o.report.nodes
      .filter((n: { kind: string }) => n.kind === "Application")
      .map((n: { id: string }) => n.id);
    // Argo CD lists the directories in path order (apps/notes, platform/gitea, system/argocd) and
    // keeps those any pattern matches: the third, argocd, is not generated
    expect(apps).toEqual(["Application/argocd/gitea", "Application/argocd/notes"]);
    expect(o.report.opaque).toEqual([
      expect.objectContaining({
        node: "ApplicationSet/argocd/root",
        reason: "limit",
        detail: "generated Applications over the limit (generatedApplicationsPerApplicationSet)",
      }),
    ]);
    expect(o.report.runStatus.floor).toBe(true);
    expect(o.text).toMatch(/^Opacity: at least 1 of 3 sources opaque/m);
  });
});

describe("the scan's file limit (filesPerScan, B3)", () => {
  it("stops a listing at the limit, names it and makes the counts a floor; never a crash", () => {
    const files: Record<string, string> = { "apps/a.yaml": app("a", "cfg") };
    for (let i = 0; i < 30; i++)
      files[`cfg/c${String(i).padStart(2, "0")}.yaml`] = `apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c${i}}\n`;
    const d = estate(files);
    cleanup.push(d);
    const o = outputs({
      path: d,
      repoUrl: "http://gitea-http.gitea:3000/ops/thin-slice",
      budget: { ...DEFAULT_BUDGET, maxFiles: 20 },
    });
    expect(o.report.unreadable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonWord: "file count limit reached (the rest of this listing not seen)",
          detail: "files per scan",
        }),
      ]),
    );
    expect(o.report.runStatus.floor).toBe(true);
    expect(o.report.runStatus.state).toBe("ANALYSED WITH GAPS");
    const unlimited = outputs({ path: d, repoUrl: "http://gitea-http.gitea:3000/ops/thin-slice" });
    expect(unlimited.report.unreadable).toEqual([]);
  });
});

describe("a render: crank never creates a generated Application (B5 rule, B3 origin)", () => {
  it("creates what system/argocd holds, and not the Applications the ApplicationSet generates", () => {
    const repo = copy({
      "crankpath.yaml": 'cranks:\n  - creates: render:system/argocd\n    by: "apply system/argocd by hand"\n',
    });
    const o = outputs({ path: repo, repoUrl: SELF, repoAliases: [`${FORGE}=${repo}`] });
    const crank = o.report.cranks[0];
    expect(crank.createdNodes).toEqual(["ApplicationSet/argocd/root", "Deployment/argocd/argocd-repo-server"]);
  });
});

describe("an unreadable generator repository keeps its host-match edge (AC2.4.5)", () => {
  it("is opaque unreadable-repo and still reads source from the in-estate Service its host names", () => {
    const set = fs.readFileSync(path.join(HOMELAB, "system", "argocd", "root.yaml"), "utf8");
    const d = estate({
      "bootstrap/forge.yaml": app("gitea", "platform/gitea", SELF),
      "platform/gitea/service.yaml": fs.readFileSync(path.join(HOMELAB, "platform", "gitea", "service.yaml"), "utf8"),
      "platform/gitea/deployment.yaml": fs.readFileSync(
        path.join(HOMELAB, "platform", "gitea", "deployment.yaml"),
        "utf8",
      ),
      "system/argocd/root.yaml": set,
    });
    cleanup.push(d);
    const o = outputs({ path: d, repoUrl: SELF });
    expect(o.report.opaque.find((x: { node: string }) => x.node === "ApplicationSet/argocd/root")?.reason).toBe(
      "unreadable-repo",
    );
    const edges = o.report.edges.map((e: { from: string; kind: string; to: string }) => `${e.from} ${e.kind} ${e.to}`);
    expect(edges).toContain("ApplicationSet/argocd/root reads-source Service/gitea/gitea-http");
  });
});
