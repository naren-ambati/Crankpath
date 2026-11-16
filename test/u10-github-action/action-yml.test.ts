// The composite Action's definition (C10, BR10.6, NFR1.1): its inputs and outputs, every action it
// uses pinned by full commit id with a dated comment that docs/lookups.md also holds, no input
// interpolated into a command, the CLI built from the Action's own checkout with
// `npm ci --ignore-scripts` and never installed from a registry.

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const YML = read("action/action.yml");
const ACTION = parse(YML) as {
  name: string;
  inputs: Record<string, { default: string; required: boolean }>;
  outputs: Record<string, { value: string }>;
  runs: {
    using: string;
    steps: { uses?: string; run?: string; env?: Record<string, string>; id?: string; shell?: string }[];
  };
};
const BUILD = read("action/build.sh");
/** A workflow expression, `$` + `{{ x }}` (spelt out so it is not read as a template placeholder). */
const expr = (x: string) => `$${"{{"} ${x} }}`;

describe("action.yml (C10)", () => {
  it("is a composite Action with C10's inputs, defaults and outputs", () => {
    expect(ACTION.runs.using).toBe("composite");
    expect(Object.keys(ACTION.inputs)).toEqual(["path", "config", "base-ref", "repo-alias"]);
    expect(ACTION.inputs.path?.default).toBe(".");
    expect(ACTION.inputs.config?.default).toBe("");
    expect(ACTION.inputs["base-ref"]?.default).toBe(expr("github.event.pull_request.base.sha"));
    expect(ACTION.inputs["repo-alias"]?.default).toBe("");
    expect(ACTION.outputs).toEqual({
      result: expect.objectContaining({ value: expr("steps.check.outputs.result") }),
      "new-cycles": expect.objectContaining({ value: expr("steps.check.outputs.new-cycles") }),
    });
    expect(ACTION.runs.steps.some((s) => s.id === "check")).toBe(true);
  });
  it("pins every action it uses by a full commit id with a dated comment, recorded in docs/lookups.md", () => {
    const uses = ACTION.runs.steps.flatMap((s) => (s.uses === undefined ? [] : [s.uses]));
    expect(uses.length).toBeGreaterThan(0);
    const lookups = read("docs/lookups.md");
    for (const u of uses) {
      const m = /^([\w.-]+\/[\w.-]+)@([0-9a-f]{40})$/.exec(u);
      expect(m, u).not.toBeNull();
      const [, name, sha] = m as RegExpExecArray;
      const at = YML.indexOf(u);
      const comment = YML.slice(YML.lastIndexOf("\n", YML.lastIndexOf("#", at)), at);
      expect(comment).toMatch(
        new RegExp(
          `# ${name} v[0-9.]+, released \\d{4}-\\d{2}-\\d{2}, commit read from the GitHub API on \\d{4}-\\d{2}-\\d{2}`,
        ),
      );
      expect(lookups).toContain(sha as string);
    }
  });
  it("never interpolates an input or context value into a command", () => {
    for (const s of ACTION.runs.steps) {
      if (s.run === undefined) continue;
      expect(s.run).not.toContain("${{");
      expect(s.shell).toBe("bash");
      for (const v of Object.values(s.env ?? {}))
        expect(v).toMatch(/^\$\{\{ (inputs\.[\w-]+|github\.action_path) \}\}$/);
    }
    const entry = ACTION.runs.steps.find((s) => s.id === "check");
    expect(Object.keys(entry?.env ?? {}).sort()).toEqual([
      "CRANKPATH_ACTION_PATH",
      "INPUT_BASE_REF",
      "INPUT_CONFIG",
      "INPUT_PATH",
      "INPUT_REPO_ALIAS",
    ]);
  });
  it("builds the CLI from its own checkout and never installs crankpath from a registry (BR10.6)", () => {
    expect(BUILD).toMatch(/^npm ci --ignore-scripts$/m);
    expect(BUILD).toMatch(/^npm run build$/m);
    expect(BUILD).toContain('cd "$here/.."');
    const commands = [BUILD, ...ACTION.runs.steps.map((s) => s.run ?? "")].join("\n");
    expect(commands).not.toMatch(/npm (install|i|add)\b|npx|yarn|pnpm|crankpath@/);
    const setup = ACTION.runs.steps.find((s) => s.uses?.startsWith("actions/setup-node@")) as {
      with?: Record<string, unknown>;
    };
    expect(setup.with).toEqual({ "node-version": "22", "package-manager-cache": false });
  });
  it("says it has not run on a hosted runner, and the guide says so too", () => {
    expect(YML).toContain("has not run on a GitHub-hosted runner");
    expect(read("docs/action.md")).toMatch(/has never run on a GitHub-hosted runner/);
  });
});
