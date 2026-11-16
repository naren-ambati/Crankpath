// Copies examples/refusals/repo to the directory given and adds platform/web/big.yaml there: a
// sparse file of 10,000,001 bytes, one byte over crankpath's per-file limit (fileBytes,
// docs/limits.md). It is made at run time because a file that size does not belong in the
// repository; sparse, it takes almost no disk. The symlink in the estate is copied as a link.
//
//   node examples/refusals/make-copy.mjs <new directory>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const to = process.argv[2];
if (to === undefined) {
  console.error("usage: node examples/refusals/make-copy.mjs <new directory>");
  process.exit(1);
}
if (fs.existsSync(to)) {
  console.error("make-copy: the directory exists already; give a new one");
  process.exit(1);
}
const from = path.join(path.dirname(fileURLToPath(import.meta.url)), "repo");
fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
const big = path.join(to, "platform", "web", "big.yaml");
fs.writeFileSync(big, "", { flag: "wx" });
fs.truncateSync(big, 10_000_001);
