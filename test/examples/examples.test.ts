// The examples under examples/ (docs/examples.md) cannot drift from what the docs show. Every
// offline run of examples/expected.json is run here with the built CLI, as a user runs it (from the
// repository root, node alone on PATH): the exit code must be the written one, the output must meet
// every fact written down before the first run, and stdout and stderr must equal the pinned files
// examples/<example>/expected/<run>.stdout and .stderr byte for byte. The checks are the ones
// scripts/examples.mjs and docs/images/capture.mjs use (scripts/examples-lib.mjs).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allRuns,
  CLI,
  checkRun,
  comparePinned,
  DOC_FILE,
  docQuotes,
  EXAMPLES,
  factProblems,
  loadExpected,
  quotedText,
  readPinned,
  ROOT,
  type Run,
  runEnv,
  runExample,
  shapeProblems,
} from "../../scripts/examples-lib.mjs";

const expected = loadExpected();
const offline = allRuns(expected).filter(([, ex]) => ex.lane === "offline");
const THIN = expected.examples["thin-slice"]?.runs.find((r) => r.name === "text") as Run;

describe("examples/expected.json", () => {
  it("is well formed: known lanes, keys and facts, unique run names, sameAs naming a run", () => {
    expect(shapeProblems(expected)).toEqual([]);
  });

  it("names every example directory, and every directory it names exists", () => {
    const dirs = fs
      .readdirSync(EXAMPLES, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(dirs).toEqual(Object.keys(expected.examples).sort());
  });

  it("holds no pinned file without a run, and every edit names a run and says why", () => {
    for (const [name, ex] of Object.entries(expected.examples)) {
      const dir = path.join(EXAMPLES, name, "expected");
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
      const wanted = ex.runs.flatMap((r) => [`${r.name}.stderr`, `${r.name}.stdout`]).sort();
      expect(files, name).toEqual(ex.lane === "offline" ? wanted : []);
    }
    for (const e of expected.edits) {
      expect(
        expected.examples[e.example]?.runs.some((r) => r.name === e.run),
        `${e.example}/${e.run}`,
      ).toBe(true);
      expect(e.why.length).toBeGreaterThan(20);
    }
  });
});

describe("every offline example, run with the built CLI", () => {
  it("has the CLI built (npm run build)", () => {
    expect(fs.existsSync(CLI)).toBe(true);
  });

  for (const [name, , run] of offline) {
    it(`${name}/${run.name}: exit ${run.exit}, the written facts, and the pinned stdout and stderr byte for byte`, () => {
      const result = runExample(run);
      expect(checkRun(run, result)).toEqual([]);
      expect(comparePinned(name, run, result)).toEqual([]);
    });
  }

  for (const [name, , run] of offline.filter(([, , r]) => r.sameAs !== undefined)) {
    it(`${name}/${run.name}: its output is the output of ${run.sameAs}`, () => {
      const [otherName, otherRun] = (run.sameAs as string).split("/") as [string, string];
      expect(readPinned(name, run.name)).toEqual(readPinned(otherName, otherRun));
    });
  }
});

describe("docs/examples.md", () => {
  const doc = fs.readFileSync(DOC_FILE, "utf8");

  it("quotes every output it shows from a pinned run, byte for byte", () => {
    const quotes = docQuotes(doc);
    expect(quotes.length).toBeGreaterThan(10);
    for (const q of quotes) {
      const want = quotedText(q.example, q.run, q.stream, q.key);
      expect(want, `docs/examples.md:${q.line} names ${q.example}/${q.run}, which is not pinned`).not.toBeNull();
      expect(q.body, `docs/examples.md:${q.line}: the quote of ${q.example}/${q.run} is not its pinned output`).toBe(
        want,
      );
      expect(expected.examples[q.example]?.runs.some((r) => r.name === q.run)).toBe(true);
    }
  });

  it("shows or names every example, and every examples/ path it names exists", () => {
    for (const name of Object.keys(expected.examples))
      expect(doc, name).toMatch(new RegExp(`examples/${name}[/\\s\`)]|${name}/`));
    for (const m of doc.matchAll(/(?<![\w./-])examples\/[A-Za-z0-9._/-]*[A-Za-z0-9_-]/g))
      expect(fs.existsSync(path.join(ROOT, m[0])), `docs/examples.md names ${m[0]}`).toBe(true);
  });

  it("states the homelab goldens as they are pinned", () => {
    const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
    const plain = read("test/golden/homelab/expected.json");
    const cranked = read("test/golden/homelab-cranked/expected.json");
    const cycle = cranked.cycles[0];
    expect(plain.runStatus.state).toBe("NOTHING ANALYSED");
    expect(doc).toContain(`the ${plain.undeployed.charts} chart directories nothing deploys`);
    expect(cranked.cycles).toHaveLength(1);
    expect([cycle.label, cycle.labelBeforeCranks, cycle.crankedBy]).toEqual(["cranked", "extracted", ["crank:1"]]);
    expect(doc).toContain(`${cranked.runStatus.counts.nodes} nodes and ${cranked.edges.total} edges`);
    expect(doc).toContain(`\`${cycle.id}\` of ${cycle.nodes.length} nodes and ${cycle.edgeCount} edges`);
    expect(doc).toContain(`creates the chart's ${cranked.cranks[0].createdNodes} objects`);
    expect(doc).toContain(`its ${cranked.cranks[0].reroutedEdges.length - 1} Applications rerouted`);
    expect(cranked.plan.steps[0].manual).toBe(true);
    expect(doc).toContain(`the plan has ${cranked.plan.steps.length} steps, step 1 the manual crank`);
    expect(doc).toContain(`the run is \`${cranked.runStatus.state}\``);
  });
});

describe("the checks can fail", () => {
  it("a changed estate fails the pin: the thin slice without its Service is not the pinned output", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-example-test-"));
    try {
      const copy = path.join(tmp, "repo");
      fs.cpSync(path.join(EXAMPLES, "thin-slice", "repo"), copy, { recursive: true });
      fs.rmSync(path.join(copy, "platform", "gitea", "service.yaml"));
      const broken: Run = { ...THIN, args: [copy, ...THIN.args.slice(1)] };
      const result = runExample(broken);
      expect(comparePinned("thin-slice", THIN, result).length).toBeGreaterThan(0);
      expect(checkRun(THIN, result)).toContain('stdout: no line "Cycles: 1 uncranked"');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("each kind of fact reports a text that breaks it", () => {
    const text = "Run status: ANALYSED WITH GAPS\n  Cycles: 1 uncranked\n";
    expect(factProblems({ lines: ["Run status: ANALYSED"] }, text, "s")).toHaveLength(1);
    expect(factProblems({ contains: ["label: cranked"] }, text, "s")).toHaveLength(1);
    expect(factProblems({ absent: ["WITH GAPS"] }, text, "s")).toHaveLength(1);
    expect(factProblems({ startCounts: { "Cycles:": 2 } }, text, "s")).toHaveLength(1);
    expect(factProblems({ empty: true }, text, "s")).toHaveLength(1);
    expect(factProblems({ lines: ["Cycles: 1 uncranked"], startCounts: { "Run status:": 1 } }, text, "s")).toEqual([]);
  });

  it("a misspelt fact or an unknown lane is a shape problem, never ignored", () => {
    const bad = structuredClone(expected);
    const run = bad.examples["thin-slice"]?.runs[0] as Run & { stdout: Record<string, unknown> };
    run.stdout.contain = ["x"];
    (bad.examples["thin-slice"] as { lane: string }).lane = "maybe";
    expect(shapeProblems(bad)).toEqual(
      expect.arrayContaining([
        "thin-slice: lane must be one of offline, live",
        "thin-slice/text: stdout: unknown fact contain",
      ]),
    );
  });
});

// Colour is only written to a terminal (C6, FR8.8). A pseudo-terminal comes from Python's pty
// module, as in docs/images/capture.mjs; without python3 on PATH this check is skipped, never passed.
// (3.10 or later: an older pty.spawn never returns once the child has exited and its input is at its end)
const PYTHON = (process.env.PATH ?? "")
  .split(path.delimiter)
  .map((d) => path.join(d, "python3"))
  .find(
    (p) =>
      fs.existsSync(p) &&
      spawnSync(p, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"]).status === 0,
  );
const PTY = "import os,pty,sys; sys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))";

describe.skipIf(PYTHON === undefined)("colour on a pseudo-terminal (needs python3 3.10+; else skipped)", () => {
  function onPty(extraArgs: string[], extraEnv: Record<string, string> = {}) {
    const r = spawnSync(PYTHON as string, ["-c", PTY, process.execPath, CLI, ...THIN.args, ...extraArgs], {
      cwd: ROOT,
      encoding: "utf8",
      env: runEnv(extraEnv),
      input: "",
      timeout: 60_000,
    });
    return { exit: r.status, out: (r.stdout ?? "").replaceAll("\r\n", "\n") };
  }

  it("colours the status words on a terminal, and --no-color and NO_COLOR=1 each turn it off", () => {
    const pinned = readPinned("thin-slice", "text")?.stdout;
    const plain = onPty([]);
    expect(plain.exit).toBe(0);
    expect(plain.out).toContain("\u001b[");
    expect(plain.out.replace(new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, "g"), "")).toBe(pinned);
    const flag = onPty(["--no-color"]);
    const env = onPty([], { NO_COLOR: "1" });
    expect(flag.out).toBe(pinned);
    expect(env.out).toBe(pinned);
  });
});
