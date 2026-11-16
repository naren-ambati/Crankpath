#!/usr/bin/env node
// The crankpath binary (`bin` in package.json). All behaviour is in cli-shell.ts.

import { INTERNAL_ERROR, main } from "./cli-shell.js";

// A reader that closes standard output early (`crankpath ... | head`) ends the run quietly with
// exit 1 (the report was not delivered whole): no message and no stack. Any other stream error
// gets crankpath's one fixed line.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code !== "EPIPE") process.stderr.write(`${INTERNAL_ERROR}\n`);
  process.exit(1);
});

process.exitCode = main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  isTTY: process.stdout.isTTY === true,
  ...(process.env.NO_COLOR === undefined ? {} : { noColor: process.env.NO_COLOR }),
});
