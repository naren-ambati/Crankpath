import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkDocs,
  checkMermaidText,
  DOC_SET,
  findTest,
  forbiddenUse,
  parseClaimMap,
  showsOutput,
  slug,
} from "../../scripts/check-docs.mjs";

// Each rule is run on a seeded tree in a temporary directory, once broken and once with the twin that
// passes, so no rule's test can pass with the rule removed.

const TODAY = "2026-11-16";
let dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const GOOD_README = [
  "# x",
  "",
  "## Opacity first",
  "",
  "See [the claims](docs/claims.md) and [concepts](docs/concepts.md).",
  "",
  "## The two homelab cycles",
  "",
  "text",
  "",
].join("\n");
const CLAIMS_HEADER =
  "# Claims\n\n| Claim | Where | Claim | Test file | Test | Last verified run |\n|---|---|---|---|---|---|\n";
const TEST_FILE =
  'import { it } from "vitest";\nit("reproduces the claim", () => {});\nit.skip("a skipped one", () => {});\n';

/** A tree with every D11 document present and linked, plus the given files (which replace defaults). */
function tree(files: Record<string, string>): { root: string; files: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-check-docs-"));
  dirs.push(root);
  const base: Record<string, string> = {
    "README.md": GOOD_README,
    "docs/claims.md": CLAIMS_HEADER,
    "test/x/a.test.ts": TEST_FILE,
  };
  const others = DOC_SET.filter((d) => d !== "README.md" && d !== "docs/claims.md");
  base["docs/concepts.md"] = `# Concepts\n\n${others
    .filter((d) => d !== "docs/concepts.md")
    .map((d) => `- [d](${path.posix.relative("docs", d)})`)
    .join("\n")}\n`;
  for (const d of others) if (d !== "docs/concepts.md") base[d] = `# ${d}\n\nplain text\n`;
  const all = { ...base, ...files };
  for (const [rel, text] of Object.entries(all)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return { root, files: Object.keys(all).sort() };
}

const run = (files: Record<string, string>, release = false) => checkDocs({ ...tree(files), release, today: TODAY });
const rulesOf = (problems: string[]) => problems.map((p) => p.split(" ")[1]);

describe("check-docs on a complete tree", () => {
  it("passes a tree with every document, linked, and no claims", () => {
    const r = run({});
    expect(r.problems).toEqual([]);
    expect(r.pending).toEqual([]);
  });
});

describe("broken-link", () => {
  it("fails a link to a missing file and a missing anchor, and passes the twins", () => {
    const bad = run({ "docs/what-it-cannot-see.md": "# W\n\n[a](missing.md) [b](limits.md#nowhere)\n" });
    expect(bad.problems.filter((p) => p.includes("broken-link"))).toHaveLength(2);
    const good = run({
      "docs/what-it-cannot-see.md": "# W\n\n[b](limits.md#docslimitsmd) [c](#w) [u](https://example.org/x)\n",
    });
    expect(good.problems).toEqual([]);
  });

  it("fails a link that leaves the repository or points into the design workspace", () => {
    const folder = String.fromCharCode(97, 105, 100, 108, 99);
    const r = run({ "docs/what-it-cannot-see.md": `# W\n\n[a](../../outside.md) [b](../${folder}/x.md)\n` });
    expect(r.problems.filter((p) => p.includes("broken-link"))).toHaveLength(2);
  });

  it("does not read links inside code spans or fences", () => {
    const r = run({
      "docs/what-it-cannot-see.md": "# W\n\n`[a](missing.md)`\n\n```illustration\n[b](missing.md)\n```\n",
    });
    expect(r.problems).toEqual([]);
  });

  it("slugs headings as GitHub does", () => {
    expect(slug("The `crankpath.yaml` reference: keys")).toBe("the-crankpathyaml-reference-keys");
    expect(slug("Opacity first (D12)")).toBe("opacity-first-d12");
  });
});

describe("unreachable", () => {
  it("fails a document no chain of links from README.md reaches, and passes once linked", () => {
    const bad = run({ "docs/orphan.md": "# O\n" });
    expect(bad.problems).toEqual(["docs/orphan.md:1 unreachable no chain of links from README.md reaches it"]);
    const good = run({ "docs/orphan.md": "# O\n", "docs/limits.md": "# L\n\n[o](orphan.md)\n" });
    expect(good.problems).toEqual([]);
  });

  it("does not require test notes, reviews or the build notes to be reachable", () => {
    const r = run({ "test/fixtures/a/README.md": "# a\n", "reviews/r.md": "# r\n", "BUILD-NOTES.md": "# b\n" });
    expect(r.problems).toEqual([]);
  });

  it("never reads the corpus copies' upstream Markdown", () => {
    const r = run({ "test/corpus/up/README.md": "# up\n\n[gone](nowhere.md)\n\n```mermaid\nnot a diagram\n```\n" });
    expect(r.problems).toEqual([]);
  });
});

describe("Mermaid", () => {
  const diagram = (body: string, after = "Text fallback: a to b.") =>
    run({ "docs/limits.md": `# L\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\n${after}\n` });

  it("passes a flowchart with a fallback", () => {
    expect(diagram('flowchart LR\n  a["A"] -->|"reads"| b["B"]\n  subgraph s["S"]\n    c\n  end').problems).toEqual([]);
  });

  it("fails a diagram with no fallback, or an empty one", () => {
    expect(rulesOf(diagram("flowchart LR\n  a --> b", "no fallback here").problems)).toEqual(["mermaid-fallback"]);
    expect(rulesOf(diagram("flowchart LR\n  a --> b", "Text fallback:").problems)).toEqual(["mermaid-fallback"]);
  });

  it("fails an unknown header, a missing direction, an unbalanced line, a stray statement and an open subgraph", () => {
    expect(checkMermaidText("flowchrt LR\n  a --> b")).toHaveLength(1);
    expect(checkMermaidText("flowchart\n  a --> b")).toHaveLength(1);
    expect(checkMermaidText('flowchart LR\n  a["A] --> b')).not.toEqual([]);
    expect(checkMermaidText("flowchart LR\n  a --> b\n  this is prose")).toHaveLength(1);
    expect(checkMermaidText("flowchart LR\n  subgraph s\n  a --> b")).toHaveLength(1);
    expect(checkMermaidText("flowchart LR\n  end")).toHaveLength(1);
    expect(checkMermaidText("")).toHaveLength(1);
    expect(diagram("flowchart LR\n  a --> b\n  this is prose").problems.map((p) => p.split(" ")[1])).toEqual([
      "mermaid-parse",
    ]);
  });

  it("accepts edge chains, & groups, shapes, classes and comments", () => {
    expect(
      checkMermaidText(
        "flowchart TD\n  %% a comment\n  a([start]) --> b{choice} -.-> c[(store)]\n  a & b ==> d:::warn\n  classDef warn stroke-dasharray: 5 5\n  direction LR",
      ),
    ).toEqual([]);
    expect(checkMermaidText("sequenceDiagram\n  A->>B: hello")).toEqual([]);
  });
});

describe("output-caption and claim-missing", () => {
  const OUT = "```text\nRun status: ANALYSED WITH GAPS\n```\n";

  it("passes an output fence with a command, a run date and a claim marker", () => {
    const r = run({
      "docs/limits.md": `# L\n\n<!-- claim CL-1 -->\nOutput of \`crankpath ./repo\`, run 2026-11-16:\n\n${OUT}`,
      "docs/claims.md": `${CLAIMS_HEADER}| CL-1 | docs/limits.md | the status | test/x/a.test.ts | reproduces the claim | 2026-11-16 |\n`,
    });
    expect(r.problems).toEqual([]);
    expect(r.claims).toBe(1);
  });

  it("fails an output fence with no command, no date, a future date, an impossible date or no marker", () => {
    const claims = `${CLAIMS_HEADER}| CL-1 | l | s | test/x/a.test.ts | reproduces the claim | 2026-11-16 |\n`;
    const cases = [
      "Output, run 2026-11-16:",
      "Output of `crankpath ./repo`:",
      "Output of `crankpath ./repo`, run 2026-12-01:",
      "Output of `crankpath ./repo`, run 2026-02-30:",
    ];
    for (const caption of cases) {
      const r = run({ "docs/limits.md": `# L\n\n<!-- claim CL-1 -->\n${caption}\n\n${OUT}`, "docs/claims.md": claims });
      expect(rulesOf(r.problems), caption).toEqual(["output-caption"]);
    }
    const harness = run({
      "docs/limits.md": `# L\n\n<!-- claim CL-1 -->\nOutput of \`node scripts/action-local.mjs a\`, run 2026-11-16:\n\n${OUT}`,
      "docs/claims.md": claims,
    });
    expect(harness.problems).toEqual([]);
    const unmarked = run({ "docs/limits.md": `# L\n\nOutput of \`crankpath ./repo\`, run 2026-11-16:\n\n${OUT}` });
    expect(rulesOf(unmarked.problems)).toEqual(["claim-missing"]);
  });

  it("detects output by content in any fence, and by the crankpath-output info string", () => {
    expect(showsOutput({ info: "", body: "cycle c-0b9310f2  label: extracted" })).toBe(true);
    expect(showsOutput({ info: "json", body: '{\n  "schemaVersion": 1\n}' })).toBe(true);
    expect(showsOutput({ info: "crankpath-output", body: "anything" })).toBe(true);
    expect(showsOutput({ info: "mermaid", body: "%% crankpath 0.1.0\nflowchart LR" })).toBe(true);
    expect(showsOutput({ info: "yaml", body: "cranks:\n  - creates: x" })).toBe(false);
  });

  it("fails a prose cycle id or opacity count with no marker, and passes it with one", () => {
    const bad = run({
      "docs/limits.md": "# L\n\nThe cycle c-0b9310f2 is found.\n\nAt least 3 of 9 sources are opaque.\n",
    });
    expect(rulesOf(bad.problems)).toEqual(["claim-missing", "claim-missing"]);
    const good = run({
      "docs/limits.md": "# L\n\nThe cycle c-0b9310f2 is found. <!-- claim CL-2 -->\n",
      "docs/claims.md": `${CLAIMS_HEADER}| CL-2 | l | c | test/x/a.test.ts | reproduces the claim | 2026-11-16 |\n`,
    });
    expect(good.problems).toEqual([]);
  });

  it("does not apply the content rules to the records (research, lookups, design copies, census)", () => {
    const r = run({
      "docs/research.md": `# R\n\nThe cycle c-0b9310f2.\n\n${OUT}`,
      "docs/limits.md": "# L\n\n[r](research.md)\n",
    });
    expect(r.problems).toEqual([]);
  });
});

describe("fence kinds (review m2)", () => {
  const doc = (fence: string, caption = "Some text:") => run({ "docs/limits.md": `# L\n\n${caption}\n\n${fence}\n` });

  it("treats every text or unlabelled fence as output, whatever its lines say", () => {
    for (const body of ["External preconditions: none", "Opacity: nothing opaque, all fine", "anything at all"]) {
      expect(rulesOf(doc(`\`\`\`text\n${body}\n\`\`\``).problems), body).toEqual(["output-caption", "claim-missing"]);
      expect(rulesOf(doc(`\`\`\`\n${body}\n\`\`\``).problems), body).toEqual(["output-caption", "claim-missing"]);
    }
  });

  it("passes a code fence, refuses an unknown info string", () => {
    expect(doc("```yaml\na: 1\n```").problems).toEqual([]);
    expect(doc("```bash\nnpm ci\n```").problems).toEqual([]);
    expect(rulesOf(doc("```output\nx\n```").problems)).toEqual(["fence-kind"]);
  });

  it("asks a measurement for a date and a command or the words outside the repository, not a claim", () => {
    expect(
      doc("```measurement\npeak 5 MB\n```", "Measured with `node scripts/m.mjs`, run 2026-11-15:").problems,
    ).toEqual([]);
    expect(
      doc("```measurement\npeak 5 MB\n```", "Measured by a script kept outside the repository, run 2026-11-15:")
        .problems,
    ).toEqual([]);
    expect(rulesOf(doc("```measurement\npeak 5 MB\n```", "Measured, run 2026-11-15:").problems)).toEqual([
      "measurement-caption",
    ]);
    expect(rulesOf(doc("```measurement\npeak 5 MB\n```", "Measured with `node scripts/m.mjs`:").problems)).toEqual([
      "measurement-caption",
    ]);
  });

  it("refuses an illustration that holds crankpath output lines", () => {
    expect(doc("```illustration\nnode A needs node B\n```").problems).toEqual([]);
    expect(rulesOf(doc("```illustration\nRun status: ANALYSED\n```").problems)).toEqual(["fence-kind"]);
  });

  it("asks a claim marker of a prose count of the form N of M <word>", () => {
    expect(rulesOf(run({ "docs/limits.md": "# L\n\nIt found 3 of 9 Applications unreadable.\n" }).problems)).toEqual([
      "claim-missing",
    ]);
    expect(
      run({ "docs/limits.md": "# L\n\nOne chart varied in 3 of 5 runs. <!-- measured 2026-11-16 -->\n" }).problems,
    ).toEqual([]);
    expect(
      rulesOf(
        run({ "docs/limits.md": "# L\n\nThe cycle c-0b9310f2 in 3 of 5 runs. <!-- measured 2026-11-16 -->\n" })
          .problems,
      ),
    ).toEqual(["claim-missing"]);
  });
});

describe("claim-map", () => {
  const marked = "# L\n\nThe cycle c-0b9310f2 is found. <!-- claim CL-3 -->\n";
  const row = (file: string, title: string, date = "2026-11-16", id = "CL-3") =>
    `${CLAIMS_HEADER}| ${id} | l | c | ${file} | ${title} | ${date} |\n`;

  it("fails a marker with no row", () => {
    expect(rulesOf(run({ "docs/limits.md": marked }).problems)).toEqual(["claim-map"]);
  });

  it("fails a row nobody marks", () => {
    const r = run({ "docs/claims.md": row("test/x/a.test.ts", "reproduces the claim") });
    expect(r.problems).toEqual(["docs/claims.md:5 claim-map CL-3 is not marked in any user doc"]);
  });

  it("fails a missing test file, a file that is not a test, a missing title and a skipped test", () => {
    for (const [file, title] of [
      ["test/x/nope.test.ts", "reproduces the claim"],
      ["README.md", "reproduces the claim"],
      ["test/x/a.test.ts", "a title no test has"],
      ["test/x/a.test.ts", "a skipped one"],
    ] as const) {
      const r = run({ "docs/limits.md": marked, "docs/claims.md": row(file, title) });
      expect(rulesOf(r.problems), `${file} ${title}`).toEqual(["claim-map"]);
    }
  });

  it("fails a bad or future run date and a duplicate row", () => {
    expect(
      rulesOf(
        run({ "docs/limits.md": marked, "docs/claims.md": row("test/x/a.test.ts", "reproduces the claim", "soon") })
          .problems,
      ),
    ).toEqual(["claim-map"]);
    expect(
      rulesOf(
        run({
          "docs/limits.md": marked,
          "docs/claims.md": row("test/x/a.test.ts", "reproduces the claim", "2027-01-01"),
        }).problems,
      ),
    ).toEqual(["claim-map"]);
    const dup = `${row("test/x/a.test.ts", "reproduces the claim")}| CL-3 | l | c | test/x/a.test.ts | reproduces the claim | 2026-11-16 |\n`;
    expect(rulesOf(run({ "docs/limits.md": marked, "docs/claims.md": dup }).problems)).toEqual(["claim-map"]);
  });

  it("parses rows and finds titles in any quote form", () => {
    expect(parseClaimMap(row("test/x/a.test.ts", "t")).map((r) => [r.id, r.file, r.title, r.run])).toEqual([
      ["CL-3", "test/x/a.test.ts", "t", "2026-11-16"],
    ]);
    expect(findTest("test('t', () => {})", "t")).toBe("ok");
    expect(findTest("it(`t`, () => {})", "t")).toBe("ok");
    expect(findTest('it.todo("t")', "t")).toBe("skipped");
    expect(findTest('const x = "t";', "t")).toBe("missing");
    expect(findTest('it("t", () => {})', "")).toBe("missing");
  });
});

describe("readme-order", () => {
  it("fails a README whose first section is not the opacity statement, or whose second is not the homelab cycles", () => {
    const swapped = GOOD_README.replace("## Opacity first", "## Intro").replace(
      "## The two homelab cycles",
      "## Other",
    );
    expect(rulesOf(run({ "README.md": swapped }).problems)).toEqual(["readme-order", "readme-order"]);
  });
});

describe("forbidden-claim", () => {
  it("fails a forbidden word in prose, and passes it in a code span or after a negation", () => {
    for (const text of [
      "The run has no cycles.",
      "All GREEN.",
      "A certified plan.",
      "We guarantee order.",
      "All clear.",
    ])
      expect(rulesOf(run({ "docs/limits.md": `# L\n\n${text}\n` }).problems), text).toEqual(["forbidden-claim"]);
    expect(
      run({ "docs/limits.md": "# L\n\nIt never prints `no cycles` and cannot guarantee a fit.\n" }).problems,
    ).toEqual([]);
    expect(forbiddenUse("there are no cycles", /\bno cycles\b/i)).toBe(true);
    expect(forbiddenUse("this does not guarantee it", /\bguarantee[sd]?\b/i)).toBe(false);
  });
});

describe("doc-set and pending hooks", () => {
  it("lists a missing D11 document as pending, and fails it in release mode", () => {
    const { root, files } = tree({});
    fs.rmSync(path.join(root, "SECURITY.md"));
    const offline = checkDocs({ root, files: files.filter((f) => f !== "SECURITY.md"), today: TODAY });
    expect(offline.problems.filter((p) => p.includes("doc-set"))).toEqual([]);
    expect(offline.pending).toEqual(["SECURITY.md:1 the document does not exist yet (D11; a release fails)"]);
    const release = checkDocs({ root, files: files.filter((f) => f !== "SECURITY.md"), today: TODAY, release: true });
    expect(release.problems.filter((p) => p.includes("doc-set"))).toEqual([
      "SECURITY.md:1 doc-set the document is missing (D11)",
    ]);
  });

  it("lists a pending hook, and fails it in release mode", () => {
    const files = { "docs/limits.md": "# L\n\n<!-- pending: the real census -->\n" };
    expect(run(files).pending).toEqual(["docs/limits.md:3 the real census"]);
    expect(run(files).problems).toEqual([]);
    expect(rulesOf(run(files, true).problems)).toEqual(["pending-hook"]);
    const angled = { "docs/limits.md": "# L\n\n<!-- pending: what render:<path> does -->\n" };
    expect(run(angled).pending).toEqual(["docs/limits.md:3 what render:<path> does"]);
  });
});
