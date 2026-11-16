// An error in a --config file names that file as given, not `crankpath.yaml` (B9, the lead's request
// after B3): the user must be told which file to fix. The default file keeps its name.
import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { estate, run } from "../helpers/scan.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
function make(files: Record<string, string>): string {
  const d = estate(files);
  dirs.push(d);
  return d;
}
const BAD = "cranks:\n  - reroute: {node: Application/argocd/a, to: github.com}\n    by: x\n";

describe("the config file an error names", () => {
  it("names a --config file as given, quoted, for a key-path error", () => {
    const root = make({ "x.yaml": "a: 1\n" });
    const cfg = make({ "conf/facts.yaml": BAD });
    const r = run([root, "--config", "conf/facts.yaml"], cfg);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(
      'error: invalid --config file "conf/facts.yaml" at key path "cranks[0].reroute" (unknown key)\n',
    );
  });

  it("names a --config file that cannot be read", () => {
    const root = make({ "x.yaml": "a: 1\n" });
    const r = run([root, "--config", "missing.yaml"], root);
    expect(r.stderr).toBe('error: invalid --config file "missing.yaml" (not readable: not found)\n');
  });

  it("quotes and escapes a hostile --config name", () => {
    const root = make({ "x.yaml": "a: 1\n" });
    const r = run([root, "--config", "a\u001b[2Jb.yaml"], root);
    expect(r.stderr).toBe('error: invalid --config file "a\\x1b[2Jb.yaml" (not readable: not found)\n');
  });

  it("keeps the name crankpath.yaml for the default file", () => {
    const root = make({ "crankpath.yaml": BAD });
    expect(run([root], root).stderr).toBe(
      'error: invalid crankpath.yaml at key path "cranks[0].reroute" (unknown key)\n',
    );
  });
});
