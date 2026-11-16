#!/usr/bin/env node
// The crankpath binary (`bin` in package.json). All behaviour is in cli-shell.ts.

import { INTERNAL_ERROR, main } from "./cli-shell.js";

// A reader that closes standard output early (`crankpath ... | head`) ends the run quietly with
// exit 1 (the report was not delivered whole): no message and no stack. Any other stream error
// gets crankpath's one fixed line. The closed reader is EPIPE, or ENOTCONN: on macOS a write that
// meets a reader's close part-way through fails with ENOTCONN in a few percent of runs (B2's merge
// of main, the cause of B1's closed-pipe test failing now and then).
const READER_GONE: ReadonlySet<string> = new Set(["EPIPE", "ENOTCONN"]);
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (!READER_GONE.has(e.code ?? "")) process.stderr.write(`${INTERNAL_ERROR}\n`);
  process.exit(1);
});

// No signal handler: the run is one synchronous call, so a handler could not run before it ends.
// SIGINT and SIGTERM end crankpath at once (the default action); a private directory left under
// the cache's tmp/ is removed by the next run (B2 review pass 2, M2).

process.exitCode = main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  toolPath: process.env.PATH ?? "",
  isTTY: process.stdout.isTTY === true,
  ...(process.env.NO_COLOR === undefined ? {} : { noColor: process.env.NO_COLOR }),
});
