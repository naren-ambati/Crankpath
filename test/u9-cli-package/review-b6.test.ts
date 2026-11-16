// Regression tests for the B6 review (reviews/bolt-6-review.md) through the real CLI, written to
// fail before their fixes: M1 (repo-set labels on any workload made crankpath say "not a defect"),
// M2 (Mermaid on a NOTHING ANALYSED run claimed a no-cycle result over the whole graph read).

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claimWordsInOwnVoice } from "../../src/u1-graph-model/status-model.js";
import { fences } from "../helpers/mermaid-grammar.js";
import { copyThinSlice, estate, run, THIN_SLICE_URL } from "../helpers/scan.js";
import { flat } from "../helpers/text.js";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
});

describe("M1: the self-management note never reassures from repo-set labels", () => {
  it("names nothing when the Gitea Deployment carries the Argo CD repo server labels (the reviewer's est3)", () => {
    const repo = copyThinSlice();
    cleanup.push(path.dirname(repo));
    const file = path.join(repo, "platform", "gitea", "deployment.yaml");
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace(
          "    app.kubernetes.io/instance: gitea\nspec:",
          "    app.kubernetes.io/instance: gitea\n    app.kubernetes.io/part-of: argocd\n    app.kubernetes.io/component: repo-server\nspec:",
        ),
    );
    const r = run([repo, "--repo-url", THIN_SLICE_URL, "--explain", "c-d8197e7d"], process.cwd());
    expect(r.code).toBe(0);
    const text = flat(r.stdout);
    expect(text).toContain("self-management: none named (no source on this cycle renders an object");
    expect(text).not.toContain("not a defect");
    expect(text).not.toContain("black-start unit");
    expect(claimWordsInOwnVoice(r.stdout)).toEqual([]);
  });
});

describe("M2: Mermaid on a NOTHING ANALYSED run prints the M4 shape and no diagram", () => {
  it("prints the nothing-analysed text in one text fence, exit 2, with no cycles line and no drawn claim", () => {
    const root = estate({ "README.md": "docs only\n", "docs/a.yaml": "a: 1\n" });
    cleanup.push(root);
    const mermaid = run([root, "--repo-url", "https://h.example.org/x", "--format", "mermaid"], process.cwd());
    const text = run([root, "--repo-url", "https://h.example.org/x"], process.cwd());
    expect(mermaid.code).toBe(2);
    expect(text.code).toBe(2);
    const blocks = fences(mermaid.stdout);
    expect(blocks.map((b) => b.info)).toEqual(["text"]);
    expect(`${blocks[0]?.body}\n`).toBe(text.stdout);
    expect(mermaid.stdout).not.toContain("Cycles:");
    expect(mermaid.stdout).not.toContain("drawn:");
    expect(mermaid.stdout).not.toContain("flowchart");
  });
});
