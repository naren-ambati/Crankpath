// The adversarial index's evidence (B7 review m2): each referenced test is looked up in vitest's own
// result for the referenced files (its JSON reporter), not in the source text, so a test that was
// skipped, marked todo, commented out or renamed cannot satisfy the index.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Reference } from "./suite.js";

export interface AssertionResult {
  readonly ancestorTitles: readonly string[];
  readonly title: string;
  readonly status: string;
}
export interface FileResult {
  readonly name: string;
  readonly assertionResults: readonly AssertionResult[];
}

/** Runs vitest on the given files (relative to the root) and returns its per-file results. */
export function vitestResults(root: string, files: readonly string[]): FileResult[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-index-"));
  const out = path.join(dir, "results.json");
  try {
    const r = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules", "vitest", "vitest.mjs"),
        "run",
        ...files,
        "--reporter=json",
        `--outputFile=${out}`,
      ],
      { cwd: root, encoding: "utf8", env: { ...process.env, VITEST: undefined, VITEST_WORKER_ID: undefined } },
    );
    if (!fs.existsSync(out)) throw new Error(`vitest wrote no result (exit ${r.status})`);
    const parsed = JSON.parse(fs.readFileSync(out, "utf8")) as { testResults: FileResult[] };
    return parsed.testResults.map((t) => ({ ...t, name: path.relative(root, t.name) }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A title as written in the source, as a pattern of the titles vitest reports (`%s` and `${...}` placeholders). */
export function titlePattern(title: string): RegExp {
  const parts = title.split(/(%[sdifjo#%]|\$\{[^}]*\})/);
  const body = parts
    .map((p, i) => (i % 2 === 1 ? (p === "%%" ? "%" : "[\\s\\S]*") : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}$`);
}

/**
 * What vitest says of a reference: the statuses of the tests in that file whose title matches and
 * whose describe chain holds the referenced describe. It holds the reference only when at least one
 * test matched and every match passed.
 */
export function referenceStatus(results: readonly FileResult[], ref: Reference): { ok: boolean; statuses: string[] } {
  const file = results.find((f) => f.name === ref.file);
  const it = titlePattern(ref.it);
  const describe = titlePattern(ref.describe);
  const statuses = (file?.assertionResults ?? [])
    .filter((a) => it.test(a.title) && a.ancestorTitles.some((t) => describe.test(t)))
    .map((a) => a.status);
  return { ok: statuses.length > 0 && statuses.every((s) => s === "passed"), statuses };
}
