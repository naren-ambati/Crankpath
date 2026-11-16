// The local harness (scripts/action-local.mjs) over every committed case: the B8 definition of
// done (a PR adding a cycle fails; a crank in the PR gives NO_NEW_CYCLES_FOUND with the crank
// listed unverified; no base gives NOT CHECKED, not green), the other NOT CHECKED paths, the
// hostile-name case, the fake workflow token absent from everything, and determinism.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CaseRun,
  caseNames,
  checkStep,
  FAKE_WORKFLOW_TOKEN,
  formatRun,
  runCase,
} from "../../scripts/action-local.mjs";

const runs = new Map<string, CaseRun>();
function run(name: string): CaseRun {
  let r = runs.get(name);
  if (r === undefined) {
    r = runCase(name);
    runs.set(name, r);
  }
  return r;
}
const fence = (r: CaseRun) => {
  const lines = r.summary.split("\n");
  return lines.slice(lines.indexOf("```text") + 1, lines.lastIndexOf("```"));
};

describe("every case gives its stated result", () => {
  const names = caseNames();
  it("the case list", () => {
    expect(names).toEqual([
      "add-crank",
      "add-cycle",
      "add-helm-chart",
      "crank-and-new-cycle",
      "gap-rise",
      "hostile-name",
      "no-base",
      "nothing-analysed",
      "remove-crank",
      "shallow",
      "tool-error",
      "unrelated-change",
    ]);
  });
  for (const name of names) {
    it(name, () => {
      const r = run(name);
      expect(r.outputs).toBe(`result=${r.expect.result}\nnew-cycles=${r.expect.newCycles}\n`);
      expect(r.exit).toBe(r.expect.exit);
      const word = r.expect.result === "NOT_CHECKED" ? "NOT CHECKED" : r.expect.result;
      expect(r.summary.split("\n")[0]).toMatch(new RegExp(`^## crankpath: ${word}`));
      const all = formatRun(r);
      expect(all).not.toContain(FAKE_WORKFLOW_TOKEN);
      expect(all).not.toContain("fixture-value-that-must-not-be-printed");
      expect(all).not.toMatch(/\/(Users|home|tmp|var\/folders|private)\//);
      for (const a of r.annotations)
        expect(a).toMatch(/^::(error|warning) (file=[^:,%]+,)?title=crankpath[^:]*::[\x20-\x7e]+$/);
    });
  }
});

describe("the B8 definition of done", () => {
  it("a PR that adds a cycle fails, naming the cycle and its new edges", () => {
    const r = run("add-cycle");
    expect(fence(r).slice(0, 3)).toEqual([
      "New uncranked cycles: 1",
      "  cycle c-d8197e7d  label: extracted  edges: 8   (head only; base has 0 of its edges)",
      '    Application "argocd/gitea" reads source from Service "gitea/gitea-http"  [file: "apps/gitea.yaml"]',
    ]);
    expect(fence(r).at(-1)).toBe("Result: FAILED (new uncranked cycle)");
    expect(r.annotations[0]).toMatch(
      /^::error file=apps\/gitea\.yaml,title=crankpath new uncranked cycle::New uncranked cycle c-d8197e7d/,
    );
  });
  it("a crank in the PR gives NO_NEW_CYCLES_FOUND, not a pass, with the crank listed unverified", () => {
    const r = run("add-crank");
    const lines = fence(r);
    expect(lines[0]).toBe(
      "No new uncranked cycle found. Not a pass: it rests on 1 declared fact this pull request added or changed, which crankpath does not verify.",
    );
    expect(lines).toContain(
      '  crank 1 by: "kubectl apply -f platform/gitea from a laptop checkout, runbook BS-1"  ref: "runbooks/bs-1.md"  (creates 4 nodes; documented by the PR author, not verified)',
    );
    expect(lines).toContain(
      "  cycle c-d8197e7d  label: cranked  edges: 8   (cranked by a crank this pull request adds; 8 of its edges are new in this pull request)",
    );
    expect(r.annotations.some((a) => a.startsWith("::warning title=crankpath declared facts::"))).toBe(true);
  });
  it("no base gives NOT CHECKED, not green", () => {
    const r = run("no-base");
    expect(fence(r)[0]).toBe(
      "NOT CHECKED: no base commit (this is not a pull_request event and no base-ref was given). This job is not green.",
    );
    expect(r.exit).not.toBe(0);
  });
});

describe("the other cases", () => {
  it("an old cycle does not fail an unrelated change", () => {
    const lines = fence(run("unrelated-change"));
    expect(lines[0]).toBe(
      "No new uncranked cycle found. Not a pass: 1 uncranked cycle the base already had is still there.",
    );
    expect(lines).toContain("Uncranked cycles the base already had: 1 (not new, so they do not fail this check)");
  });
  it("a removed crank fails and names the base's crank", () => {
    const lines = fence(run("remove-crank"));
    expect(lines[1]).toBe("  cycle c-d8197e7d  label: extracted  edges: 8   (cranked in base, uncranked in head)");
    expect(lines[2]).toMatch(/^ {4}cranked in base by: crank 1 by: "kubectl apply/);
    expect(lines.at(-1)).toBe("Result: FAILED (crank removed by this pull request)");
  });
  it("a shallow clone without the base is the M7 NOT CHECKED line", () => {
    const r = run("shallow");
    expect(fence(r)[0]).toBe(
      `NOT CHECKED: base commit "${r.baseCommit}" not in checkout (shallow clone). This job is not green.`,
    );
  });
  it("NOTHING ANALYSED and a tool error are NOT CHECKED with the reason", () => {
    expect(fence(run("nothing-analysed"))[0]).toBe(
      "NOT CHECKED: crankpath found nothing to analyse on the base (NOTHING ANALYSED). This job is not green.",
    );
    expect(fence(run("tool-error"))[0]).toBe(
      'NOT CHECKED: crankpath stopped with a tool or usage error on the head (exit 1); crankpath said: "error: invalid crankpath.yaml at key path \\"crank\\" (unknown key)". This job is not green.',
    );
  });
  it("hostile names and crank text stay quoted and inert, and the cycle still fails", () => {
    const r = run("hostile-name");
    expect(r.outputs).toBe("result=FAILED\nnew-cycles=1\n");
    const md = r.summary;
    expect(md).toMatch(/^[\x20-\x7e\n]*$/);
    expect(md.split("\n").filter((l) => l.startsWith("#"))).toEqual(["## crankpath: FAILED"]);
    expect(md.split("\n").filter((l) => l.startsWith("```"))).toEqual(["```text", "```"]);
    for (const bad of ["<img", "](", "![", "\u001b", "|a|"]) expect(md).not.toContain(bad);
    expect(fence(r)).toContain(
      '    Service "gitea/gitea-http" selects Deployment "gitea/gitea"  [file: "platform/gitea/::error title=x::pwned%0A,\\x5by\\x5d(javascript:alert(1))\\x3cimg src=x\\x3e\\x23.yaml"]',
    );
    expect(
      fence(r).some((l) => l.includes('[file: "platform/gitea/deploy\\x0a\\x1b\\x5b31mRun status: ANALYSED.yaml"]')),
    ).toBe(true);
    const crank = fence(r).find((l) => l.startsWith("  crank 1 by: "));
    expect(crank).toMatch(/^ {2}crank 1 by: "::warning::fake %0A\\x0a\\x23 Heading \\x5blink\\x5d/);
    // the annotation: no file property for a hostile path, `%` shown as a code, one line
    const err = r.annotations[0] as string;
    expect(err.startsWith("::error title=crankpath new uncranked cycle::")).toBe(true);
    expect(err).toContain('[file: "apps/gitea,line=1::error::owned\\x250D\\x250A.yaml"]');
    expect(err).not.toContain("%");
  });
});

describe("the review's cases (B8 review M1, m4, n2, n4)", () => {
  it("a head with gaps the base did not have is NOT CHECKED, naming each gap", () => {
    expect(fence(run("gap-rise")).slice(0, 3)).toEqual([
      "NOT CHECKED: the head has 2 gaps the base did not have, so what they hide could not be compared (listed below). This job is not green.",
      '  new in the head: unreadable file "apps/gitea.yaml"  (not valid YAML)',
      '  new in the head: unresolved host-unplaced  subject: "Application/argocd/web"  where: "apps/web.yaml\\x231"',
    ]);
  });
  it("a crank for one new cycle does not excuse another, and the cranked one shows its new edges", () => {
    const r = run("crank-and-new-cycle");
    const lines = fence(r);
    expect(lines[1]).toBe("  cycle c-78252b48  label: extracted  edges: 3   (head only; base has 0 of its edges)");
    expect(lines).toContain(
      "  cycle c-d8197e7d  label: cranked  edges: 8   (cranked by a crank this pull request adds; 8 of its edges are new in this pull request)",
    );
    expect(lines.at(-1)).toBe("Result: FAILED (new uncranked cycle)");
  });
  it("the harness runs the check step of action.yml (its run line and env), not the script directly", () => {
    const step = checkStep();
    expect(step.run).toBe('node "$CRANKPATH_ACTION_PATH/action-entry.mjs"');
    expect(Object.keys(step.env).sort()).toEqual([
      "CRANKPATH_ACTION_PATH",
      "INPUT_BASE_REF",
      "INPUT_CONFIG",
      "INPUT_PATH",
      "INPUT_REPO_ALIAS",
    ]);
  });
});

describe("a Helm source the head adds (after the B2 merge)", () => {
  it("renders through the fake helm, and the CA cycle it renders is new", () => {
    const r = run("add-helm-chart");
    expect(fence(r).slice(0, 3)).toEqual([
      "New uncranked cycles: 1",
      "  cycle c-ed2e2e22  label: extracted  edges: 3   (head only; base has 0 of its edges)",
      '    Certificate "web/ca" issued by Issuer "web/ca"  [file: "render:Application/argocd/ca\\x230"]',
    ]);
    expect(fence(r)).toContain("Base: ANALYSED (0 opaque, 0 skipped).  Head: ANALYSED (0 opaque, 0 skipped).");
    // a rendered object's evidence is a render label, not a repository path: no file property
    expect(r.annotations[0]).toMatch(/^::error title=crankpath new uncranked cycle::/);
  });
});

describe("docs/action.md", () => {
  it("quotes the harness output of a real run, byte for byte", () => {
    const doc = readFileSync(new URL("../../docs/action.md", import.meta.url), "utf8");
    for (const name of ["add-cycle", "add-crank", "gap-rise", "no-base"])
      expect(doc).toContain(formatRun(run(name)).trimEnd());
  });
});

describe("determinism", () => {
  it("two runs of a case print the same bytes", () => {
    expect(formatRun(runCase("add-crank"))).toBe(formatRun(run("add-crank")));
    expect(formatRun(runCase("hostile-name"))).toBe(formatRun(run("hostile-name")));
  });
});
