// Captures the real output behind every image in docs/images (docs/images/README.md says how).
//
//   npm run build && node docs/images/capture.mjs [id ...]
//   CRANKPATH_IMAGES_TRIAL=<dir> node docs/images/capture.mjs [id ...]   (a trial, outside docs/images)
//
// Each scenario runs its commands from the repository root with the BUILT CLI, as
// `sh -c 'set -o pipefail; { <command>; } 2>&1'` (stdout and stderr merged in the order written; a
// command that ends in a pipe keeps the CLI's exit code), with PATH set to node's directory and
// /usr/bin:/bin only, so helm and kustomize are not found and the toolchain line is the one the
// pinned examples hold. In `command` and in the images, `crankpath` stands for
// `node dist/u9-cli-package/cli.js`. It writes docs/images/transcripts/<id>.json:
//   id, title, caption, alt, version (package.json), capturedAt (ISO), load (`uptime`, no hostname),
//   commands: [{ command, exit, seconds, output }]   (+ summary: the job summary Markdown, Action ids)
// The only edits to captured text are the two replacements in scrub(): the home directory becomes
// `~` and the system temporary directory `$TMPDIR/`. Anything else a command shows differently
// (a cut, a `tr` that drops a pseudo-terminal's carriage returns) is in the command itself.
//
// After each scenario its result is compared with what is written down for it, before the run:
// - an example command (`example: "<example>/<run>"`): the exit code of examples/expected.json, and
//   the output must be that run's pinned output exactly, or, when the command cuts it with a pipe,
//   lines of it in their order (colour codes removed first on a pseudo-terminal);
// - an Action command: the case's expected result and exit status (test/fixtures/action/<case>/case.json);
// - a file shown with cat: exit 0, and lines of that file in their order.
// A run that differs is NOT saved as <id>.json but as <id>-attempt<K>.json, the differences are
// printed and the script exits 1. Nothing is picked.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLI, loadExpected, ROOT, readPinned } from "../../scripts/examples-lib.mjs";

// CRANKPATH_IMAGES_TRIAL=<dir> writes the transcripts to <dir>/transcripts instead (a trial run of
// the tooling that leaves docs/images untouched).
const TRIAL = process.env.CRANKPATH_IMAGES_TRIAL;
const TR = TRIAL === undefined ? path.join(ROOT, "docs", "images", "transcripts") : path.join(TRIAL, "transcripts");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const S = path.join(os.tmpdir(), "crankpath-shots"); // scratch, shown as $TMPDIR/crankpath-shots
const PATH_ENV = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);
const expected = loadExpected();

const uptime = () => {
  const line = spawnSync("uptime", { encoding: "utf8" }).stdout.trim();
  return line.split(os.hostname()).join("<host>");
};

/** The two rewrites, and only these: the home directory and the temporary directory. */
export function scrub(/** @type {string} */ text) {
  let t = text;
  for (const d of [...new Set([os.tmpdir(), `/private${os.tmpdir()}`, fs.realpathSync(os.tmpdir())])])
    t = t.split(`${d.replace(/\/$/, "")}/`).join("$TMPDIR/");
  return t.split(os.homedir()).join("~");
}

// `python3` in a command is the first python3 on the caller's PATH that is 3.10 or later: an older
// pty.spawn never returns once the child has exited and its standard input is at its end.
const PYTHON = (process.env.PATH ?? "")
  .split(path.delimiter)
  .map((d) => path.join(d, "python3"))
  .find(
    (p) =>
      fs.existsSync(p) &&
      spawnSync(p, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"]).status === 0,
  );

const expand = (/** @type {string} */ cmd) =>
  cmd.replace(/(?<![\w./$-])crankpath(?=\s)/g, 'node "$CRANKCLI"').replace(/(?<![\w./$-])python3(?=\s)/g, '"$CRANKPY"');

function runCommand(/** @type {string} */ cmd) {
  const t0 = performance.now();
  const r = spawnSync("sh", ["-c", `set -o pipefail; { ${expand(cmd)}; } 2>&1`], {
    cwd: ROOT,
    encoding: "utf8",
    input: "",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 3 * 60_000,
    env: {
      PATH: PATH_ENV,
      CRANKCLI: CLI,
      CRANKPY: PYTHON ?? "python3-3.10-or-later-not-found",
      LANG: "C",
      LC_ALL: "C",
    },
  });
  return {
    exit: r.status ?? -1,
    seconds: Number(((performance.now() - t0) / 1000).toFixed(2)),
    output: r.stdout ?? "",
  };
}

// ---- comparison with what is written down
const ESC = String.fromCharCode(27);
const noColour = (/** @type {string} */ t) => t.replace(new RegExp(`${ESC}\\[\\d+m`, "g"), "");

/** Every line of `shown` appears in `full`, in order (a cut of it); empty lines are not counted. */
function isCut(/** @type {string} */ shown, /** @type {string} */ full) {
  const lines = full.split("\n");
  let at = 0;
  for (const l of shown.split("\n").filter((x) => x !== "")) {
    while (at < lines.length && lines[at] !== l) at += 1;
    if (at === lines.length) return l;
    at += 1;
  }
  return null;
}

const indent = (/** @type {string} */ l) => l.length - l.trimStart().length;

/**
 * The first shown line after which the cut leaves a statement unfinished, or null (release review m1).
 * crankpath wraps a long line with its continuation indented four more than the line it continues, so a
 * cut whose next line of the full output is such a continuation, not shown, ends mid-sentence.
 */
function endsMidStatement(/** @type {string} */ shown, /** @type {string} */ full) {
  const lines = full.split("\n");
  const kept = shown.split("\n").filter((x) => x !== "");
  let at = 0;
  /** @type {number[]} */
  const where = [];
  for (const l of kept) {
    while (at < lines.length && lines[at] !== l) at += 1;
    if (at === lines.length) return null; // not a cut: isCut reports it
    where.push(at);
    at += 1;
  }
  for (let i = 0; i < where.length; i++) {
    const p = /** @type {number} */ (where[i]);
    const next = lines[p + 1];
    if (next === undefined || next.trim() === "" || where[i + 1] === p + 1) continue;
    let head = p;
    while (head > 0 && indent(lines[head] ?? "") >= indent(lines[head - 1] ?? "") + 4 && (lines[head - 1] ?? "") !== "")
      head -= 1;
    if (indent(next) >= indent(lines[head] ?? "") + 4) return lines[p] ?? "";
  }
  return null;
}

function exampleRun(/** @type {string} */ id) {
  const [example, run] = id.split("/");
  const r = expected.examples[example ?? ""]?.runs.find((x) => x.name === run);
  if (r === undefined) throw new Error(`capture: no example run ${id}`);
  const pinned = readPinned(/** @type {string} */ (example), /** @type {string} */ (run));
  if (pinned === null) throw new Error(`capture: ${id} is not pinned`);
  return { exit: r.exit, full: pinned.stdout + pinned.stderr };
}

/** @param {string} id @param {{ cut?: boolean, pty?: boolean }} o */
const fromExample =
  (id, o = {}) =>
  (/** @type {{ exit: number, output: string }} */ c) => {
    const want = exampleRun(id);
    const out = [];
    if (c.exit !== want.exit) out.push(`exit expected ${want.exit} (${id}), got ${c.exit}`);
    const shown = o.pty === true ? noColour(c.output) : c.output;
    if (o.cut === true) {
      const missing = isCut(shown, want.full);
      if (missing !== null) out.push(`a line not in the pinned output of ${id}: ${JSON.stringify(missing)}`);
      const mid = missing === null ? endsMidStatement(shown, want.full) : null;
      if (mid !== null) out.push(`the cut of ${id} ends inside a wrapped statement, after ${JSON.stringify(mid)}`);
    } else if (shown !== want.full) out.push(`the output is not the pinned output of ${id}`);
    return out;
  };

const colour = (/** @type {boolean} */ want) => (/** @type {{ exit: number, output: string }} */ c) =>
  c.output.includes(`${ESC}[`) === want ? [] : [want ? "no colour code on the pseudo-terminal" : "a colour code"];

const fromFile = (/** @type {string} */ file) => (/** @type {{ exit: number, output: string }} */ c) => {
  const out = c.exit === 0 ? [] : [`exit expected 0, got ${c.exit}`];
  const missing = isCut(c.output, fs.readFileSync(path.join(ROOT, file), "utf8"));
  if (missing !== null) out.push(`a line not in ${file}: ${JSON.stringify(missing)}`);
  return out;
};

const fromAction = (/** @type {string} */ name) => (/** @type {{ exit: number, output: string }} */ c) => {
  const want = JSON.parse(
    fs.readFileSync(path.join(ROOT, "test", "fixtures", "action", name, "case.json"), "utf8"),
  ).expect;
  const out = c.exit === 0 ? [] : [`the harness exited ${c.exit}`];
  if (!c.output.includes(`\nexit status: ${want.exit}\n`)) out.push(`the Action's exit status is not ${want.exit}`);
  if (!c.output.includes(`\n  result=${want.result}\n`)) out.push(`the Action's result is not ${want.result}`);
  if (!c.output.includes(`\n  new-cycles=${want.newCycles}\n`)) out.push(`new-cycles is not ${want.newCycles}`);
  return out;
};

// ---- scenarios
const TS = "crankpath examples/thin-slice/repo --repo-url http://gitea-http.gitea:3000/ops/thin-slice";
const PTY = `python3 -c 'import os,pty,sys; sys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))'`;
const ptyRun = (/** @type {string} */ extra) =>
  `${PTY} ${TS}${extra} | tr -d '\\r' | sed -n -e '/Run status:/p' -e '/^Cycles:/,/^$/p'`;
const HOMELAB = "test/golden/homelab-cranked/expected.json";

/**
 * @typedef {{ cmd: string, check: (c: { exit: number, output: string }) => string[] }} Cmd
 * @typedef {{ id: string, title: string, caption: string, alt: string, commands: Cmd[], action?: string, mermaid?: boolean }} Scenario
 * @type {Scenario[]}
 */
const SCENARIOS = [
  {
    id: "hero",
    title: "The thin-slice cycle and the honest status line",
    caption:
      "Argo CD reads its Git source from the Gitea it deploys: one extracted cycle, every node blocked, and a status line that says ANALYSED only because everything was read.",
    alt: "Terminal output of crankpath on the thin-slice example: Run status ANALYSED, then Cycles: 1 uncranked, cycle c-d8197e7d labelled extracted with 5 nodes and 8 edges, its two shortest-cycle edges with their fields, and 7 of 7 nodes not startable from a cold start; exit 0",
    commands: [
      {
        cmd: `${TS} | sed -n -e '/^Run status:/p' -e '/^Cycles:/,/^$/p' -e '/^Not startable/,/startable$/p'`,
        check: fromExample("thin-slice/text", { cut: true }),
      },
    ],
  },
  {
    id: "thin-slice-text",
    title: "The thin-slice cycle, text report",
    caption:
      "The whole text report of the thin-slice example: what was read, the cycle, what it blocks, and what is assumed.",
    alt: "Terminal output of crankpath on examples/thin-slice: the toolchain and scanned lines, Run status ANALYSED, opacity 0 of 2 sources, one extracted cycle c-d8197e7d, 7 of 7 nodes not startable, no plan steps, and the not-modelled list; exit 0",
    commands: [{ cmd: TS, check: fromExample("thin-slice/text") }],
  },
  {
    id: "thin-slice-json",
    title: "The thin-slice cycle, JSON report",
    caption:
      "The same run with --format json: the first 48 lines of the schema-version-1 report, the cycle with its edges.",
    alt: "Terminal output of the first 48 lines of crankpath's JSON report on the thin-slice example: the cycles array with cycle c-d8197e7d, its edges with from, kind, source and to; exit 0",
    commands: [{ cmd: `${TS} --format json | sed -n '1,48p'`, check: fromExample("thin-slice/json", { cut: true }) }],
  },
  {
    id: "homelab-golden",
    title: "khuedoan/homelab at 8b9d40f, ids and counts only",
    caption:
      "The golden lane's pinned reduced output (node ids and counts only; no text of the GPL-3.0 repository): without a crank NOTHING ANALYSED, with the bootstrap crank one component of 12 nodes and 22 edges holding both cycles, cranked.",
    alt: "Two terminal commands printing parts of the golden lane's reduced JSON: the uncranked homelab golden is NOTHING ANALYSED with 31 chart directories undeployed; the cranked golden has one cycle c-35843cd4, cranked, was extracted, with its 12 node ids and edge count 22",
    commands: [
      {
        cmd: `cat test/golden/homelab/expected.json | sed -n -e '/"state"/p' -e '/"undeployed"/,/}/p'`,
        check: fromFile("test/golden/homelab/expected.json"),
      },
      {
        cmd: `cat ${HOMELAB} | sed -n -e '/"state"/p' -e '/^  "cycles": \\[/,/^  \\],/p' | sed -e '/"edges": \\[/,/^      \\],/d'`,
        check: fromFile(HOMELAB),
      },
    ],
  },
  {
    id: "cranked-uncranked",
    title: "The same estate without and with a crank",
    caption:
      "Without crankpath.yaml the cycle is uncranked and nothing can start; with the crank file the same cycle is cranked, the crank is documented and not verified, and the plan starts with the one manual step.",
    alt: "Two terminal commands on the thin-slice example: without a config the cycle c-d8197e7d is extracted and uncranked; with --config examples/crank/crankpath.yaml it is cranked (was extracted) by crank 1, and the plan has 7 steps, step 1 manual; both exit 0",
    commands: [
      {
        cmd: `${TS} | sed -n -e '/^Run status:/p' -e '/^Cycles:/,/^$/p'`,
        check: fromExample("crank/uncranked", { cut: true }),
      },
      {
        cmd: `${TS} --config examples/crank/crankpath.yaml | sed -n -e '/^Run status:/p' -e '/^Cycles:/,/^$/p' -e '/^Plan/,/^$/p'`,
        check: fromExample("crank/cranked", { cut: true }),
      },
    ],
  },
  {
    id: "declared",
    title: "declared (unverified): a cycle that needs a declared edge",
    caption:
      "No field shows that Vault reads its certificate's Secret, so without the declared edge crankpath finds none; with it, the cycle is labelled declared (unverified) and the run has a gap.",
    alt: "Two terminal commands on examples/declared: without a config, Cycles: none found among 8 nodes and 11 edges read; with the declared edge, cycle c-c5fcc8eb labelled declared (unverified), 5 nodes and 5 edges, the declared edge marked unverified, Run status ANALYSED WITH GAPS; both exit 0",
    commands: [
      {
        cmd: "crankpath examples/declared/repo --repo-url https://github.com/example-org/declared | sed -n -e '/^Run status:/,/^$/p' -e '/^Cycles:/,/^$/p'",
        check: fromExample("declared/without-edge", { cut: true }),
      },
      {
        cmd: "crankpath examples/declared/repo --repo-url https://github.com/example-org/declared --config examples/declared/crankpath.yaml | sed -n -e '/^Run status:/,/^$/p' -e '/^Cycles:/,/^$/p'",
        check: fromExample("declared/with-edge", { cut: true }),
      },
    ],
  },
  {
    id: "plan",
    title: "Reachability and the restoration plan",
    caption:
      "Every node is startable relative to the listed assumptions, and the plan orders all 16 in 11 steps, the first the one manual crank.",
    alt: "Terminal output of crankpath on examples/plan from the Not startable line to the Not verified statement: 0 of 16 nodes not startable, github.com available (declared, not verified), an 11-step plan whose step 1 is the manual crank, and the external and the crank listed as not verified; exit 0",
    commands: [
      {
        cmd: "crankpath examples/plan/repo --repo-url http://gitea-http.gitea:3000/ops/plan --config examples/plan/crankpath.yaml | sed -n '/^Not startable/,/^Not modelled/{/^Not modelled/!p;}'",
        check: fromExample("plan/text", { cut: true }),
      },
    ],
  },
  {
    id: "opaque",
    title: "Opaque and limit outcomes",
    caption:
      "An unreadable repository with its suggested entry (never applied), encrypted values, and an alias bomb refused by the limit: each named and counted, and the opacity line a floor.",
    alt: "Terminal output of crankpath on examples/opaque from Run status to the whole Cycles statement: ANALYSED WITH GAPS, at least 3 of 4 sources opaque, unreadable-repo with a suggested repos entry, limit, encrypted-values, the file refused for alias expansion over the limit, and no cycle found among what was read, with the opaque nodes, unresolved items and unreadable file it cannot see into; exit 0",
    commands: [
      {
        cmd: "crankpath examples/opaque/repo --repo-url https://github.com/example-org/opaque | sed -n -e '/^Run status:/,/^Cycles:/{/^Cycles:/!p;}' -e '/^Cycles:/,/^$/p'",
        check: fromExample("opaque/text", { cut: true }),
      },
    ],
  },
  {
    id: "exit-codes",
    title: "Every exit code",
    caption:
      "0 when the estate was analysed (a cycle is a finding, not an error), 1 for an input or usage error, 2 when there is nothing to analyse.",
    alt: "Four terminal commands: the thin-slice run exits 0 with Run status ANALYSED; a crankpath.yaml with a misspelt key and an unknown format each exit 1 with one error line; a directory with no source exits 2 with NOTHING ANALYSED",
    commands: [
      { cmd: `${TS} | sed -n '/^Run status:/p'`, check: fromExample("exit-codes/exit-0", { cut: true }) },
      {
        cmd: "crankpath examples/exit-codes/bad-config --repo-url https://github.com/example-org/bad-config",
        check: fromExample("exit-codes/exit-1-config"),
      },
      { cmd: `${TS} --format yaml`, check: fromExample("exit-codes/exit-1-usage") },
      { cmd: "crankpath examples/exit-codes/nothing", check: fromExample("exit-codes/exit-2-nothing") },
    ],
  },
  {
    id: "refusals",
    title: "Refusals and hostile names",
    caption:
      "A symlink, a path out of the root, a file over the size limit and names that imitate crankpath's output: each refused or skipped by name, every hostile string quoted with its control characters written out.",
    alt: "Terminal output of crankpath on a copy of examples/refusals from Run status to the whole Cycles statement: three opaque Applications, big.yaml refused as too large, escape.yaml as a symlink not followed, and three ConfigMaps skipped invalid-name with their names quoted and escapes shown as backslash x1b; exit 0",
    commands: [
      {
        cmd: "node examples/refusals/make-copy.mjs $S/refusals",
        check: (c) => (c.exit === 0 ? [] : ["make-copy failed"]),
      },
      {
        cmd: "crankpath $S/refusals --repo-url https://github.com/example-org/refusals | sed -n -e '/^Run status:/,/^Cycles:/{/^Cycles:/!p;}' -e '/^Cycles:/,/^$/p'",
        check: fromExample("refusals/text", { cut: true }),
      },
    ],
  },
  {
    id: "mermaid",
    title: "Mermaid output, rendered by Mermaid",
    caption:
      "--format mermaid on the thin slice, rendered by Mermaid 12.3.0 itself (which also shows that it parses), with crankpath's text fallback.",
    alt: "The Mermaid diagram crankpath wrote for the thin-slice example, rendered: seven nodes with thick arrows for the edges on cycle c-d8197e7d, a thin arrow from Application argocd/notes, a legend, then the text fallback listing the nodes and edges",
    mermaid: true,
    commands: [{ cmd: `${TS} --format mermaid`, check: fromExample("mermaid/mermaid") }],
  },
  {
    id: "explain",
    title: "--explain: the evidence behind a cycle",
    caption: "--explain prints each edge of the cycle with the file, the field and the rendered path it was read from.",
    alt: "Terminal output of the first 40 lines of crankpath --explain on the thin-slice example: cycle c-d8197e7d with its five numbered nodes and the evidence for edges 1 to 5; exit 0",
    commands: [{ cmd: `${TS} --explain | sed -n '1,40p'`, check: fromExample("explain/cycles", { cut: true }) }],
  },
  {
    id: "no-color",
    title: "Colour only on a terminal",
    caption: "The same run on a pseudo-terminal: coloured, then with --no-color and with NO_COLOR=1, plain.",
    alt: "Three terminal commands of the same thin-slice run on a pseudo-terminal: the first shows ANALYSED in bold and uncranked in red; with --no-color and with NO_COLOR=1 the same lines have no colour; all exit 0",
    commands: [
      {
        cmd: ptyRun(""),
        check: (c) => [...fromExample("no-color/flag", { cut: true, pty: true })(c), ...colour(true)(c)],
      },
      {
        cmd: ptyRun(" --no-color"),
        check: (c) => [...fromExample("no-color/flag", { cut: true })(c), ...colour(false)(c)],
      },
      {
        cmd: `NO_COLOR=1 ${ptyRun("")}`,
        check: (c) => [...fromExample("no-color/env", { cut: true })(c), ...colour(false)(c)],
      },
    ],
  },
  {
    id: "action-summary-fail",
    title: "The Action on a pull request that adds a cycle",
    caption:
      "The Action's own check step, run locally by scripts/action-local.mjs on its add-cycle fixture: FAILED, with the new uncranked cycle and its file. Not a run on a GitHub-hosted runner.",
    alt: "GitHub job summary written by the crankpath Action for the add-cycle fixture: crankpath: FAILED, one new uncranked cycle c-d8197e7d with its eight edges and files, base and head status, Result: FAILED; with the step's annotations",
    action: "add-cycle",
    commands: [{ cmd: "node scripts/action-local.mjs add-cycle", check: fromAction("add-cycle") }],
  },
  {
    id: "action-summary-pass",
    title: "The Action on a pull request that adds no cycle",
    caption:
      "The same harness on its unrelated-change fixture: NO_NEW_CYCLES_FOUND, which says it is not a pass and why. Not a run on a GitHub-hosted runner.",
    alt: "GitHub job summary written by the crankpath Action for the unrelated-change fixture: crankpath: NO_NEW_CYCLES_FOUND (not a pass), the old cycle c-d8197e7d still there and not new, base and head ANALYSED",
    action: "unrelated-change",
    commands: [{ cmd: "node scripts/action-local.mjs unrelated-change", check: fromAction("unrelated-change") }],
  },
];

/** The job summary the harness printed: everything after its `job summary (GITHUB_STEP_SUMMARY):` line. */
function summaryOf(/** @type {string} */ output) {
  const at = output.indexOf("job summary (GITHUB_STEP_SUMMARY):\n");
  return at < 0 ? "" : output.slice(at + "job summary (GITHUB_STEP_SUMMARY):\n".length).replace(/\n+$/, "\n");
}

function main() {
  const ids = process.argv.slice(2);
  for (const id of ids) if (!SCENARIOS.some((s) => s.id === id)) throw new Error(`capture: unknown scenario ${id}`);
  if (!fs.existsSync(CLI)) throw new Error("capture: run npm run build first (dist/u9-cli-package/cli.js is missing)");
  fs.mkdirSync(TR, { recursive: true });
  fs.rmSync(S, { recursive: true, force: true });
  fs.mkdirSync(S, { recursive: true });
  let failed = 0;
  const todo = SCENARIOS.filter((s) => ids.length === 0 || ids.includes(s.id));
  for (const sc of todo) {
    console.log(`\n== ${sc.id} ==`);
    const load = uptime();
    const commands = [];
    const diffs = [];
    for (const c of sc.commands) {
      const cmd = c.cmd.replaceAll("$S", S);
      const r = runCommand(cmd);
      const rec = { command: scrub(cmd), exit: r.exit, seconds: r.seconds, output: scrub(r.output) };
      commands.push(rec);
      console.log(`   exit ${r.exit}, ${r.seconds} s`);
      diffs.push(...c.check({ exit: r.exit, output: r.output }));
    }
    /** @type {Record<string, unknown>} */
    const t = {
      id: sc.id,
      title: sc.title,
      caption: sc.caption,
      alt: sc.alt,
      version: VERSION,
      capturedAt: new Date().toISOString(),
      load,
      commands,
    };
    if (sc.action !== undefined) {
      t.summary = summaryOf(/** @type {{ output: string }} */ (commands[0]).output);
      if (t.summary === "") diffs.push("the Action wrote no job summary");
    }
    if (sc.mermaid === true) t.mermaid = true;
    let name = sc.id;
    if (diffs.length > 0) {
      failed += 1;
      let k = 1;
      while (fs.existsSync(path.join(TR, `${sc.id}-attempt${k}.json`))) k += 1;
      name = `${sc.id}-attempt${k}`;
      t.id = name;
      console.log(`   DIFFERS from what is written down; saved as ${name}.json:`);
      for (const d of diffs) console.log(`     ${d}`);
    } else console.log("   matches what is written down");
    fs.writeFileSync(path.join(TR, `${name}.json`), `${JSON.stringify(t, null, 1)}\n`);
  }
  fs.rmSync(S, { recursive: true, force: true });
  console.log(`\ncapture: ${todo.length} scenario(s), ${failed} differing`);
  process.exit(failed === 0 ? 0 : 1);
}

export { SCENARIOS };
const invoked = process.argv[1];
if (invoked !== undefined && path.resolve(invoked) === fileURLToPath(import.meta.url)) main();
