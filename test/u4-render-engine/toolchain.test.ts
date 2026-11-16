import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildChildEnv, createCommandRunner } from "../../src/u4-render-engine/command-runner.js";
import { detectToolchain, findTool, parseToolVersion, TESTED_VERSIONS } from "../../src/u4-render-engine/toolchain.js";
import { createWorkDir } from "../../src/u4-render-engine/work-dir.js";
import { fakeDir, fakePath } from "../helpers/render.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crankpath-tools-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function detect(toolPath: string) {
  const work = createWorkDir(path.join(tmp, "cache"), true);
  const runner = createCommandRunner({
    binaries: { helm: findTool("helm", toolPath), kustomize: findTool("kustomize", toolPath) },
    env: buildChildEnv(work.homes),
  });
  return detectToolchain(runner, tmp);
}

describe("Toolchain (BR4.14 to BR4.16)", () => {
  it("records the tested pair as tested", () => {
    expect(TESTED_VERSIONS).toEqual({ helm: "v4.3.2", kustomize: "v5.8.1" });
    const t = detect(fakePath("tested"));
    expect(t.helm).toMatchObject({ present: true, version: "v4.3.2", tested: true });
    expect(t.kustomize).toMatchObject({ present: true, version: "v5.8.1", tested: true });
    expect(t.tested).toBe(true);
  });
  it("records another version as not tested", () => {
    const t = detect(fakePath("untested"));
    expect(t.helm).toMatchObject({ version: "v4.0.0", tested: false });
    expect(t.tested).toBe(false);
  });
  it("records a present tool whose version cannot be read as unrecognised, still present", () => {
    const t = detect(fakePath("garbled"));
    expect(t.helm).toMatchObject({ present: true, version: null, tested: false });
  });
  it("names a missing tool as not present", () => {
    const t = detect("");
    expect(t.helm).toMatchObject({ present: false, version: null });
    expect(t.kustomize.present).toBe(false);
    expect(t.tested).toBe(false);
  });
  it("searches absolute PATH entries only: a relative entry could be the scanned checkout", () => {
    const rel = path.relative(process.cwd(), fakeDir("tested"));
    expect(findTool("helm", rel)).toBeNull();
    expect(findTool("helm", `${path.delimiter}.${path.delimiter}`)).toBeNull();
    expect(findTool("helm", fakeDir("tested"))).toBe(path.join(fakeDir("tested"), "helm"));
  });
  it("skips a file that is not executable", () => {
    const d = fs.mkdtempSync(path.join(tmp, "bin-"));
    fs.writeFileSync(path.join(d, "helm"), "#!/bin/sh\n", { mode: 0o644 });
    expect(findTool("helm", d)).toBeNull();
  });
  it("reads a version from the first line only, bounded", () => {
    expect(parseToolVersion(Buffer.from("v4.3.2"))).toBe("v4.3.2");
    expect(parseToolVersion(Buffer.from("v4.3.2+g8346aaa\n"))).toBe("v4.3.2");
    expect(parseToolVersion(Buffer.from("kustomize/v5.0.0\n"))).toBe("v5.0.0");
    expect(parseToolVersion(Buffer.from("v5.8.1\nsomething else"))).toBe("v5.8.1");
    expect(parseToolVersion(Buffer.from("\x1b[31mv4.3.2"))).toBeNull();
    expect(parseToolVersion(Buffer.from(`${"x".repeat(300)}v4.3.2`))).toBeNull();
    expect(parseToolVersion(Buffer.from('version.BuildInfo{Version:"v4.3.2"}'))).toBeNull();
  });
});
