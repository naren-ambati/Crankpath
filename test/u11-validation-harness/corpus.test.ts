// The corpus of trimmed public estates (US11.7, BR11.16, BR11.17, C11, OD-21): licence hygiene of each
// copy, and its expected outcome (counts and cycle ids only), asserted offline.
//
// Two lanes per copy, both offline (`--no-network`, an empty cache):
//   no tools     helm and kustomize are not on crankpath's PATH: always runs, the same on every machine
//   tested pair  helm v4.3.2 and kustomize v5.8.1 from PATH: runs only when crankpath reports exactly that
//                pair, else the test is SKIPPED (never a pass); charts are not fetched, so remote charts
//                are opaque `offline` and Kustomize roots render
// With CRANKPATH_CORPUS_OBSERVED_DIR set, each lane also writes its observed summary there (a directory
// outside the repository) for review before expected.json is changed.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run, tempDir } from "../helpers/scan.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CORPUS = path.join(ROOT, "test", "corpus");
const PERMISSIVE = ["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause"];

interface Manifest {
  copy: string;
  origin: string;
  commit: string;
  licence: string;
  licenceSha256: string;
  scan: { path: string; repoUrl: string };
  modified: string[];
  kept: { path: string; sha256: string }[];
}

/** The counts-and-ids summary of a crankpath JSON report (no text of the scanned repository). */
// biome-ignore lint/suspicious/noExplicitAny: the report is read field by field
function summarise(code: number, r: any) {
  // biome-ignore lint/suspicious/noExplicitAny: as above
  const by = (list: any[], key: (x: any) => string) => {
    const m: Record<string, number> = {};
    for (const x of list) m[key(x)] = (m[key(x)] ?? 0) + 1;
    return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  };
  return {
    exit: code,
    state: r.runStatus.state,
    floor: r.runStatus.floor,
    reasons: r.runStatus.reasons,
    sourcesByKind: r.runStatus.counts.sourcesByKind,
    opaqueByReason: by(r.opaque, (o) => o.reason),
    unreadableByReason: by(r.unreadable, (u) => u.reasonWord),
    skippedByReason: by(r.skipped, (s) => s.reason),
    unresolvedByWhy: by(r.unresolved, (u) => u.why),
    nodes: r.nodes.length,
    edges: r.edges.length,
    cycles: r.cycles.map((c: { id: string; label: string; nodes: unknown[]; edges: unknown[] }) => ({
      id: c.id,
      label: c.label,
      nodes: c.nodes.length,
      edges: c.edges.length,
    })),
    statusCounts: r.statusCounts,
    planSteps: r.plan.steps.length,
    undeployedKustomizeRoots: r.undeployedKustomizeRoots.length,
    toolMissing: r.toolMissing,
  };
}

const copies = fs
  .readdirSync(CORPUS)
  .filter((d) => fs.statSync(path.join(CORPUS, d)).isDirectory())
  .sort();
const manifest = (d: string): Manifest => JSON.parse(fs.readFileSync(path.join(CORPUS, d, "corpus.json"), "utf8"));
const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of fs.readdirSync(d).sort()) {
      const full = path.join(d, n);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

describe("the corpus of trimmed public estates (US11.7)", () => {
  it("holds 3 to 5 copies, each listed in the root NOTICE with its origin, commit and licence", () => {
    expect(copies.length).toBeGreaterThanOrEqual(3);
    expect(copies.length).toBeLessThanOrEqual(5);
    const notice = fs.readFileSync(path.join(ROOT, "NOTICE"), "utf8");
    for (const d of copies) {
      const m = manifest(d);
      for (const s of [`test/corpus/${d}/`, m.origin, m.commit, m.licence]) expect(notice, `${d}: ${s}`).toContain(s);
    }
  });

  for (const d of copies) {
    describe(d, () => {
      const dir = path.join(CORPUS, d);
      const m = manifest(d);

      it("is under a permissive licence whose upstream text sits beside it, with a NOTICE naming origin and commit", () => {
        expect(m.copy).toBe(d);
        expect(PERMISSIVE).toContain(m.licence);
        const licence = fs.readFileSync(path.join(dir, "LICENSE"), "utf8");
        if (m.licence === "Apache-2.0") {
          expect(licence).toMatch(/Apache License\s+Version 2\.0, January 2004/);
          expect(licence).toContain("END OF TERMS AND CONDITIONS");
        } else if (m.licence === "MIT") {
          expect(licence).toMatch(/^MIT License/);
          expect(licence).toContain("Permission is hereby granted, free of charge");
          expect(licence).toMatch(/Copyright \(c\) \d{4} \S/);
        } else expect(licence).toContain("Redistribution and use in source and binary forms");
        expect(licence).not.toMatch(/GNU (?:AFFERO |LESSER )?GENERAL PUBLIC LICENSE|Mozilla Public License/);
        // review m4: the copied licence is byte-identical to the one recorded when it was copied
        expect(m.licenceSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(sha(path.join(dir, "LICENSE"))).toBe(m.licenceSha256);
        const notice = fs.readFileSync(path.join(dir, "NOTICE"), "utf8");
        expect(notice).toContain(m.origin);
        expect(notice).toContain(m.commit);
        expect(m.commit).toMatch(/^[0-9a-f]{40}$/);
      });

      it("holds exactly the files its manifest lists, each byte-identical to the copied file", () => {
        expect(filesUnder(path.join(dir, "repo"))).toEqual(m.kept.map((k) => k.path).sort());
        for (const k of m.kept) expect(sha(path.join(dir, "repo", k.path)), k.path).toBe(k.sha256);
        for (const f of m.modified) {
          const first = fs
            .readFileSync(path.join(dir, "repo", f), "utf8")
            .split("\n")
            .slice(0, 3)
            .join("\n");
          expect(first, f).toMatch(/Modified by crankpath/);
        }
        expect(filesUnder(dir).filter((f) => !f.startsWith("repo/"))).toEqual([
          "LICENSE",
          "NOTICE",
          "corpus.json",
          "expected.json",
        ]);
      });

      const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
      const lane = (name: "noTools" | "testedPair", toolPath: string) => {
        const cache = tempDir("corpus-cache");
        try {
          const r = run(
            [
              path.join(dir, m.scan.path),
              "--repo-url",
              m.scan.repoUrl,
              "--format",
              "json",
              "--no-network",
              "--cache-dir",
              cache,
            ],
            ROOT,
            toolPath,
          );
          const report = JSON.parse(r.stdout);
          const observed = summarise(r.code, report);
          const out = process.env.CRANKPATH_CORPUS_OBSERVED_DIR;
          if (out !== undefined && out !== "") {
            fs.mkdirSync(out, { recursive: true });
            fs.writeFileSync(path.join(out, `${d}.${name}.json`), `${JSON.stringify(observed, null, 2)}\n`);
          }
          return { observed, toolchain: report.toolchain };
        } finally {
          fs.rmSync(cache, { recursive: true, force: true });
        }
      };

      it("gives its expected outcome with no helm and no kustomize", () => {
        expect(lane("noTools", "").observed).toEqual(expected.noTools);
      });

      it("gives its expected outcome with the tested pair, offline (SKIPPED unless helm v4.3.2 and kustomize v5.8.1 are on PATH)", (ctx) => {
        const { observed, toolchain } = lane("testedPair", process.env.PATH ?? "");
        if (toolchain.tested !== true) ctx.skip();
        expect(observed).toEqual(expected.testedPair);
      });
    });
  }
});
