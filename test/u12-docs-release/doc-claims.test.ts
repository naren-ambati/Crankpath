// Tests named by the claim map (docs/claims.md): each reproduces one claim a document makes. A quoted
// output block is compared with a fresh run of the command its caption names: the block's lines must be
// a contiguous run of the output's lines (a quote may be an excerpt, never an edit). The runs are
// in-process, offline, with helm and kustomize not on crankpath's PATH, and with a private --cache-dir
// (which changes nothing in the output) so the fixture folder is never written to.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openRoot } from "../../src/u2-intake-config/bounded-reader.js";
import { parseYamlBounded } from "../../src/u2-intake-config/bounded-reader.js";
import { validateConfig } from "../../src/u2-intake-config/config-reader.js";
import { run, tempDir } from "../helpers/scan.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXAMPLE = path.join(ROOT, "test", "fixtures", "docs-example");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** The body of the first fenced block after the claim marker `<!-- claim <id> -->` in a document. */
function quoted(doc: string, id: string): string[] {
  const lines = read(doc).split("\n");
  const at = lines.findIndex((l) => l.includes(`<!-- claim ${id} -->`));
  expect(at, `${doc} marks ${id}`).toBeGreaterThanOrEqual(0);
  const open = lines.findIndex((l, i) => i > at && /^```/.test(l));
  const close = lines.findIndex((l, i) => i > open && /^```\s*$/.test(l));
  expect(open).toBeGreaterThan(at);
  return lines.slice(open + 1, close);
}

/** Whether `part` is a contiguous run of `whole`. */
function isExcerpt(part: string[], whole: string[]): boolean {
  if (part.length === 0) return false;
  for (let i = 0; i + part.length <= whole.length; i++) if (part.every((l, j) => l === whole[i + j])) return true;
  return false;
}

/** Runs crankpath in the documentation example, as the captions name the command. */
function example(args: string[]): { code: number; out: string[] } {
  const cache = tempDir("docs-cache");
  try {
    const r = run([...args, "--cache-dir", cache], EXAMPLE, "");
    return { code: r.code, out: `${r.stdout}${r.stderr}`.replace(/\n$/, "").split("\n") };
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
}

const URL_FLAG = ["--repo-url", "https://github.com/example-org/estate"];
const ALIAS = ["--repo-alias", "http://gitea-http.gitea:3000/ops/estate=repo"];

interface CensusTotal {
  total: number;
  opaque: number;
  fraction: number;
  atLeast: boolean;
}

describe("claims the documents make (docs/claims.md)", () => {
  it("the README states the static census total as the committed census record has it", () => {
    const census = JSON.parse(read("docs/census-2026-11-15-static.json")) as { label: string; total: CensusTotal };
    expect(census.label).toBe("static-estimate");
    const t = census.total;
    const fraction = String(t.fraction);
    const over = t.opaque / t.total > 1 / 3;
    const sentence = `${t.atLeast ? "at least " : ""}${t.opaque} of ${t.total} counted units opaque, ${fraction}, ${over ? "over" : "at or under"} the one-third threshold`;
    const readme = read("README.md");
    expect(readme).toContain(sentence);
    // the statement sits in the first section, the opacity statement (BR12.1)
    const first = readme.split(/^## /m)[1] ?? "";
    expect(first.startsWith("Opacity")).toBe(true);
    expect(first).toContain(sentence);
  });

  it("the README states the real-discovery census totals as the committed record has them", () => {
    const real = JSON.parse(read("docs/census-2026-11-16-real.json"));
    expect(real.label).toBe("real-discovery");
    const d = real.total.d12;
    const a = real.total.allKinds;
    const over = (x: { opaque: number; total: number }) => (x.opaque / x.total > 1 / 3 ? "over" : "at or under");
    const first = read("README.md").split(/^## /m)[1] ?? "";
    expect(first.startsWith("Opacity")).toBe(true);
    expect(first).toContain(
      `${d.atLeast ? "at least " : ""}${d.opaque} of ${d.total} Applications, HelmReleases and unexpandable ApplicationSets or Flux Kustomizations opaque, ${d.fraction}, ${over(d)} the one-third threshold`,
    );
    expect(first).toContain(`${a.atLeast ? "at least " : ""}${a.opaque} of ${a.total} sources opaque, ${a.fraction}`);
    // the real figure comes before the static one
    expect(first.indexOf(String(d.fraction))).toBeLessThan(first.indexOf("0.8224"));
  });

  // The two homelab goldens are pinned from reviewed real runs; `npm run verify:golden` (run by
  // `npm run release:check`) re-runs them with helm and the network and fails when they differ.
  const homelabSection = (): string => {
    const r = read("README.md");
    return r.slice(r.indexOf("## The two homelab cycles"), r.indexOf("## Why it should exist"));
  };

  it("the README states the uncranked homelab golden as it is pinned", () => {
    const g = JSON.parse(read("test/golden/homelab/expected.json"));
    const input = JSON.parse(read("test/golden/homelab/input.json"));
    expect(input.fetch[0].sha.startsWith("8b9d40f")).toBe(true);
    expect(g.runStatus.state).toBe("NOTHING ANALYSED");
    expect(g.cycles).toEqual([]);
    const s = homelabSection();
    expect(s).toContain("it is `NOTHING ANALYSED`");
    expect(s).toContain(`lists the ${g.undeployed.charts} chart directories nothing deploys`);
  });

  it("the README states the cranked homelab golden as it is pinned", () => {
    const g = JSON.parse(read("test/golden/homelab-cranked/expected.json"));
    expect(g.cycles).toHaveLength(1);
    const c = g.cycles[0];
    expect([c.label, c.labelBeforeCranks, c.crankedBy]).toEqual(["cranked", "extracted", ["crank:1"]]);
    const step = g.plan.steps[0];
    expect([step.no, step.kind, step.manual, step.crank]).toEqual([1, "crank", true, "crank:1"]);
    const s = homelabSection();
    expect(s).toContain(
      `\`${c.id}\`: one strongly connected component of ${c.nodes.length} nodes and ${c.edgeCount} edges`,
    );
    expect(s).toContain("labelled `cranked (was extracted)`, and plan step 1 is the manual crank");
    expect(s).toContain(`The run is \`${g.runStatus.state}\``);
    expect(g.edges.bySource).toEqual({ extracted: g.edges.total });
    // both research cycles are inside the component
    const has = (from: string, kind: string, to: string) =>
      c.edges.some((e: string[]) => e[0] === from && e[1] === kind && e[2] === to);
    expect(has("ApplicationSet/argocd/root", "reads-source", "Service/gitea/gitea-http")).toBe(true);
    expect(has("Application/argocd/gitea", "generated-by", "ApplicationSet/argocd/root")).toBe(true);
    expect(has("ApplicationSet/argocd/root", "deployed-by", "Application/argocd/argocd")).toBe(true);
    expect(has("Application/argocd/argocd", "generated-by", "ApplicationSet/argocd/root")).toBe(true);
  });

  it("without the alias, both Applications of the example are opaque unreadable-repo with a suggested repos entry", () => {
    const r = example(["repo", ...URL_FLAG, "--no-network"]);
    expect(r.code).toBe(0);
    expect(isExcerpt(quoted("docs/write-your-cranks.md", "CL-3"), r.out)).toBe(true);
  });

  it("with the alias, the example holds one extracted cycle that blocks every node", () => {
    const r = example(["repo", ...URL_FLAG, ...ALIAS, "--no-network"]);
    expect(r.code).toBe(0);
    expect(isExcerpt(quoted("docs/write-your-cranks.md", "CL-2"), r.out)).toBe(true);
    expect(isExcerpt(quoted("docs/concepts.md", "CL-2"), r.out)).toBe(true);
  });

  it("with the crank, the cycle is cranked and plan step 1 is the manual crank", () => {
    const r = example(["repo", ...URL_FLAG, ...ALIAS, "--config", "cranked.yaml", "--no-network"]);
    expect(r.code).toBe(0);
    expect(isExcerpt(quoted("docs/write-your-cranks.md", "CL-4"), r.out)).toBe(true);
  });

  it("an unknown key in crankpath.yaml is an error naming its key path, and nothing is analysed", () => {
    const r = example(["repo", "--config", "invalid.yaml", "--no-network"]);
    expect(r.code).toBe(1);
    expect(quoted("docs/crankpath-yaml.md", "CL-5")).toEqual(r.out);
  });

  it("every crankpath.yaml example in the reference is accepted by the reader", () => {
    const root = openRoot(path.join(EXAMPLE, "repo"));
    if (!root.ok) throw new Error("the example root does not open");
    const blocks = [...read("docs/crankpath-yaml.md").matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map((m) => m[1] ?? "");
    expect(blocks.length).toBeGreaterThanOrEqual(7);
    const accepted = (text: string) => {
      const parsed = parseYamlBounded(text);
      if (!parsed.ok) return false;
      return validateConfig(parsed.documents[0] ?? null, "crankpath.yaml", root.root).ok;
    };
    for (const b of blocks) expect(accepted(b), b).toBe(true);
    // the check can fail: the same blocks with a misspelt key are refused
    expect(accepted(blocks[blocks.length - 1]?.replace("reroutes:", "reroute:") ?? "")).toBe(false);
  });

  it("every run lists the five items crankpath does not model", () => {
    const r = example(["repo", ...URL_FLAG, ...ALIAS, "--no-network"]);
    expect(isExcerpt(quoted("docs/what-it-cannot-see.md", "CL-6"), r.out)).toBe(true);
  });
});

describe("the platforms the documents claim (review M1)", () => {
  // Only macOS arm64 was run in this build: every sentence of a user document that names Linux, x64 or
  // a platform list must say that they were not run, and none may say Linux was tested or run.
  const USER_DOCS = [
    "README.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "CHANGELOG.md",
    ...fs
      .readdirSync(path.join(ROOT, "docs"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `docs/${f}`),
  ].filter((f) => !["docs/research.md", "docs/lookups.md", "docs/census.md", "docs/limits.md"].includes(f));

  /** Sentences naming Linux or x64 that do not say they were not run. */
  function unqualified(text: string): string[] {
    return text
      .replace(/`[^`]*`/g, " ")
      .split(/(?<=[.!?])\s+|\n\n/)
      .filter((s) => /\blinux\b|\bx64\b/i.test(s) && !/not (?:been )?run|not yet run|were not run|unverified/i.test(s));
  }

  it("names Linux and x64 only with the statement that this build did not run them", () => {
    for (const f of USER_DOCS) expect(unqualified(read(f)), f).toEqual([]);
    expect(read("README.md")).toContain("this build was run on macOS arm64 only");
  });

  it("can fail: the old platform sentences are refused", () => {
    expect(unqualified("Runs on macOS and Linux.")).toHaveLength(1);
    expect(unqualified("macOS and Linux. Other systems are not tested.")).toHaveLength(1);
  });
});

describe("the quote check can fail", () => {
  it("refuses an edited line, a reordered pair and an empty quote", () => {
    const whole = ["a", "b", "c"];
    expect(isExcerpt(["b", "c"], whole)).toBe(true);
    expect(isExcerpt(["b", "x"], whole)).toBe(false);
    expect(isExcerpt(["c", "b"], whole)).toBe(false);
    expect(isExcerpt([], whole)).toBe(false);
  });
});
