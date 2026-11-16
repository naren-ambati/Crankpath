// The census with real discovery (OD-19, C11, BR11.18): the committed record adds up, holds only URLs,
// commits, counts and fixed words, and docs/census.md section 5 states it as the JSON has it; the
// summary of a report counts what the record says it counts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ESTATES } from "../../scripts/census.mjs";
import { summarise, total } from "../../scripts/census-real.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = JSON.parse(read("docs/census-2026-11-16-real.json"));
const doc = read("docs/census.md");
const section = doc.slice(doc.indexOf("## 5. The census with real discovery"));

// biome-ignore lint/suspicious/noExplicitAny: a synthetic report, field by field
function report(opaque: any[], byKind: Record<string, number>, floor = false): any {
  const kinds = { Application: 0, ApplicationSet: 0, HelmRelease: 0, Kustomization: 0, KustomizeRoot: 0, ...byKind };
  const found = Object.values(kinds).reduce((a, b) => a + b, 0);
  return {
    runStatus: {
      state: "ANALYSED WITH GAPS",
      reasons: ["opaque-sources"],
      floor,
      counts: { sourcesByKind: kinds, sourcesFound: found, unreadableFiles: 0, timeouts: 0 },
    },
    opaque,
  };
}

describe("the real-discovery census record", () => {
  it("is labelled real-discovery and covers exactly the OD-26 estates at their commits, none failed", () => {
    expect(json.label).toBe("real-discovery");
    expect(json.estates.map((e: { url: string; sha: string }) => [e.url, e.sha])).toEqual(
      ESTATES.map((e) => [e.url, e.sha]),
    );
    expect(json.failedEstates).toBe(0);
  });

  it("adds up: reasons sum to opaque, estates sum to the total, fractions match", () => {
    for (const k of ["d12", "allKinds"] as const) {
      for (const e of json.estates) {
        const sum = Object.values(e[k].byReason as Record<string, number>).reduce((a, b) => a + b, 0);
        expect(sum, `${e.url} ${k}`).toBe(e[k].opaque);
        expect(e[k].fraction).toBe(Math.round((e[k].opaque / e[k].total) * 10000) / 10000);
      }
      expect(json.total[k].total).toBe(
        json.estates.reduce(
          (a: number, e: Record<"d12" | "allKinds", { total: number; opaque: number }>) => a + e[k].total,
          0,
        ),
      );
      expect(json.total[k].opaque).toBe(
        json.estates.reduce(
          (a: number, e: Record<"d12" | "allKinds", { total: number; opaque: number }>) => a + e[k].opaque,
          0,
        ),
      );
    }
    expect(json.total).toEqual(total(json.estates));
  });

  it("holds only URLs, commits, counts, crankpath's words and its own fixed wording", () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          strings.push(k);
          walk(x);
        }
    };
    walk(json);
    for (const s of strings)
      expect(
        /^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+|[0-9a-f]{40}|[A-Za-z][a-zA-Z0-9-]*|helm v[\d.]+, kustomize v[\d.]+|1\/3)$/.test(
          s,
        ) ||
          s === json.method ||
          s === json.units.d12 ||
          s === json.units.allKinds ||
          /^[a-z-]+ \| [A-Za-z]+ \| (?:no field|other field|[A-Za-z][\w.[\]]*)$/.test(s) ||
          /^(over one third|at or under one third|nothing counted|not established \(at or under one third of what was counted, a floor\)|ANALYSED WITH GAPS|ANALYSED|NOTHING ANALYSED)$/.test(
            s,
          ),
        s,
      ).toBe(true);
  });

  it("is stated in docs/census.md section 5 as the JSON has it, with 'at least' before each floor", () => {
    for (const e of json.estates) {
      const row = section.split("\n").find((l) => l.startsWith(`| ${e.url.replace("https://github.com/", "")} |`));
      expect(row, e.url).toBeDefined();
      for (const k of ["d12", "allKinds"] as const)
        expect(row).toContain(`${e[k].atLeast ? "at least " : ""}${e[k].opaque} of ${e[k].total} (${e[k].fraction})`);
      expect(row).toContain(`| ${e.d12.againstOneThird} |`);
    }
    const t = json.total;
    expect(section).toContain(
      `at least ${t.d12.opaque} of ${t.d12.total} D12 units are opaque, ${t.d12.fraction}, ${t.d12.againstOneThird}`,
    );
    expect(section).toContain(`at least ${t.allKinds.opaque} of ${t.allKinds.total} sources, ${t.allKinds.fraction}`);
  });
});

describe("the measured prose of census.md section 5 and the README (review m5)", () => {
  const est = (name: string) => json.estates.find((e: { url: string }) => e.url.endsWith(`/${name}`));
  const field = (
    e: Record<"d12" | "allKinds", { byReasonKindField: Record<string, number> }>,
    k: "d12" | "allKinds",
    key: string,
  ) => e[k].byReasonKindField[key] ?? 0;

  it("states each breakdown figure as the record has it", () => {
    const nixos = est("nixos-k3s");
    const pi = est("pi-cluster");
    const morten = est("homelab");
    const bridge = est("gitops-bridge");
    const claims: [string, number][] = [
      [
        `${field(nixos, "d12", "unsupported-field | Kustomization | spec.sourceRef.kind")} of nixos-k3s's Kustomizations read from a source kind other than \`GitRepository\``,
        148,
      ],
      [
        `All ${field(pi, "d12", "unreadable-repo | Kustomization | spec.sourceRef.name")} of pi-cluster's Kustomizations name the \`flux-system\` GitRepository`,
        62,
      ],
      [
        `${field(morten, "d12", "unsupported-field | Application | helmCharts")} of mortennordbye/homelab's generated Applications (and ${field(morten, "allKinds", "unsupported-field | KustomizeRoot | helmCharts")} Kustomize roots) use kustomize \`helmCharts\``,
        28,
      ],
      [`crankpath generated ${morten.allKinds.byKind.Application} Applications from them`, 39],
      [
        `gitops-bridge's ${field(bridge, "d12", "cluster-inputs-missing | ApplicationSet | spec.generators[0].clusters")} cluster-generator ApplicationSets are \`cluster-inputs-missing\``,
        4,
      ],
      [`crankpath reached ${nixos.allKinds.byKind.HelmRelease} of nixos-k3s's HelmReleases`, 20],
      [
        `${field(nixos, "d12", "cluster-created-values | HelmRelease | spec.valuesFrom[0].name")} HelmReleases with values from a ConfigMap the repository does not define remain`,
        3,
      ],
    ];
    for (const [sentence] of claims) expect(section, sentence).toContain(sentence);
  });

  it("names in the README the three largest reasons of the total, in their order", () => {
    const top = Object.entries(json.total.d12.byReasonKindField as Record<string, number>)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    expect(top).toEqual([
      "unsupported-field | Kustomization | spec.sourceRef.kind",
      "unreadable-repo | Kustomization | spec.sourceRef.name",
      "unsupported-field | Application | helmCharts",
    ]);
    const words: Record<string, string> = {
      "unsupported-field | Kustomization | spec.sourceRef.kind":
        "Flux Kustomizations whose source is not a GitRepository",
      "unreadable-repo | Kustomization | spec.sourceRef.name":
        "Flux Kustomizations whose GitRepository only the bootstrap creates",
      "unsupported-field | Application | helmCharts": "Applications that use Helm inflation inside kustomize",
    };
    const readme = read("README.md");
    const at = top.map((k) => readme.indexOf(`${words[k]} (${json.total.d12.byReasonKindField[k]})`));
    expect(
      at.every((i) => i > 0),
      JSON.stringify(at),
    ).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe("summarise (the two figures of one report)", () => {
  it("counts Applications and HelmReleases, and an opaque ApplicationSet or Kustomization once, never a Kustomize root", () => {
    const r = report(
      [
        { node: "Application/argocd/a", reason: "unreadable-repo" },
        { node: "ApplicationSet/argocd/s", reason: "cluster-inputs-missing" },
        { node: "Kustomization/flux-system/k", reason: "unsupported-field" },
        { node: null, reason: "remote-base" },
      ],
      { Application: 3, ApplicationSet: 1, HelmRelease: 1, Kustomization: 2, KustomizeRoot: 4 },
    );
    const s = summarise(r);
    expect(s.d12).toMatchObject({
      total: 6,
      opaque: 3,
      opaqueCountedOnce: 2,
      atLeast: true,
      againstOneThird: "over one third",
    });
    expect(s.d12.byReason).toEqual({ "cluster-inputs-missing": 1, "unreadable-repo": 1, "unsupported-field": 1 });
    expect(s.allKinds).toMatchObject({ total: 11, opaque: 4, atLeast: false });
  });

  it("says at or under one third only when nothing is a floor", () => {
    const exact = summarise(report([{ node: "Application/argocd/a", reason: "offline" }], { Application: 4 }));
    expect(exact.d12.againstOneThird).toBe("at or under one third");
    const floor = summarise(report([{ node: "Application/argocd/a", reason: "offline" }], { Application: 4 }, true));
    expect(floor.d12.againstOneThird).toMatch(/^not established/);
    expect(summarise(report([], {})).d12.againstOneThird).toBe("nothing counted");
  });
});
