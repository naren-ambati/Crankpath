import { describe, expect, it } from "vitest";
import {
  flattenParams,
  holdsTemplate,
  type ParamSet,
  renderString,
  renderValue,
  sanitizeName,
} from "../../src/u3-discovery-expansion/generator-template.js";
import {
  checkPattern,
  DirectoryIndex,
  matchPath,
  StepBudget,
} from "../../src/u3-discovery-expansion/generator-paths.js";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

const flat: ParamSet = {
  values: { path: "apps/web", "path.basename": "web", "path[0]": "apps", "values.env": "prod" },
  gaps: new Map([["server", { reason: "cluster-inputs-missing", detail: "no server" }]]),
};
const nested: ParamSet = {
  values: {
    path: { path: "apps/web", basename: "web", segments: ["apps", "web"] },
    n: 3,
    ok: true,
    f: 1.5,
    m: { a: "b" },
  },
  gaps: new Map(),
};

describe("fasttemplate mode (Argo CD's default, BR3.10, BR3.12)", () => {
  it("replaces string parameters with the tag trimmed, and leaves an unknown tag as written", () => {
    expect(renderString("{{path.basename}}-{{ path[0] }}", flat, "fast", false)).toEqual({
      ok: true,
      text: "web-apps",
    });
    expect(renderString("x {{nope}} {{ }} y", flat, "fast", false)).toEqual({ ok: true, text: "x {{nope}} {{ }} y" });
    expect(renderString("{{values.env}}", flat, "fast", false)).toEqual({ ok: true, text: "prod" });
  });
  it("leaves text alone unless {{ and }} are on one line (Argo CD's isTemplatedRegex)", () => {
    expect(renderString("{{path\n}}", flat, "fast", false)).toEqual({ ok: true, text: "{{path\n}}" });
    expect(renderString("plain", flat, "fast", false)).toEqual({ ok: true, text: "plain" });
  });
  it("refuses an unterminated tag and a parameter crankpath cannot know", () => {
    expect(renderString("{{path}} {{oops", flat, "fast", false)).toMatchObject({
      ok: false,
      reason: "unsupported-template",
    });
    expect(renderString("{{server}}", flat, "fast", false)).toEqual({
      ok: false,
      reason: "cluster-inputs-missing",
      detail: "no server",
    });
  });
});

describe("Go template mode", () => {
  it("evaluates a field chain and index of a chain", () => {
    expect(renderString("{{ .path.basename }}/{{index .path.segments 0}}", nested, "go", false)).toEqual({
      ok: true,
      text: "web/apps",
    });
    expect(renderString("{{.n}} {{.ok}}", nested, "go", false)).toEqual({ ok: true, text: "3 true" });
  });
  it("prints <no value> for a missing last key, and refuses it under missingkey=error", () => {
    expect(renderString("{{.nope}}", nested, "go", false)).toEqual({ ok: true, text: "<no value>" });
    expect(renderString("{{.nope}}", nested, "go", true)).toMatchObject({ ok: false, reason: "unsupported-template" });
    expect(renderString("{{.nope.deeper}}", nested, "go", false)).toMatchObject({ ok: false });
    expect(renderString("{{.n.x}}", nested, "go", false)).toMatchObject({ ok: false });
  });
  it("refuses every other construct, and values it does not print as Go does", () => {
    for (const t of [
      "{{ .path.basename | upper }}",
      '{{ printf "%s" .n }}',
      "{{- .n }}",
      "{{ .n -}}",
      "{{/* c */}}",
      "{{ $x := .n }}",
      "{{ if .ok }}x{{ end }}",
      "{{ index .path.segments 9 }}",
      "{{ .f }}",
      "{{ .m }}",
      "{{ .path }}",
      "{{ .n",
    ]) {
      expect(renderString(t, nested, "go", false), t).toMatchObject({ ok: false, reason: "unsupported-template" });
    }
  });
});

describe("rendering a whole template value", () => {
  it("renders every string, keeps other scalars, and names the first failing field", () => {
    const r = renderValue({ a: ["{{path}}", 1, { b: "{{path.basename}}" }] }, flat, "fast", false, "spec");
    expect(r).toEqual({ ok: true, value: { a: ["apps/web", 1, { b: "web" }] } });
    const bad = renderValue({ x: { y: ["ok", "{{server}}"] } }, flat, "fast", false, "spec");
    expect(bad).toMatchObject({
      ok: false,
      field: "spec.x.y[1]",
      text: "{{server}}",
      reason: "cluster-inputs-missing",
    });
  });
  it("refuses a templated map key (Argo CD templates values only)", () => {
    expect(renderValue({ "{{path}}": "x" }, flat, "fast", false, "spec")).toMatchObject({
      ok: false,
      text: "{{path}}",
    });
  });
  it("handles a deep value without recursion", () => {
    let v: unknown = "{{path}}";
    for (let i = 0; i < 20_000; i++) v = { a: v };
    expect(renderValue(v as never, flat, "fast", false, "spec").ok).toBe(true);
    expect(holdsTemplate(v as never)).toBe(true);
    expect(holdsTemplate({ a: ["x", { b: "y" }] })).toBe(false);
  });
});

describe("parameter helpers", () => {
  it("sanitizes names as Argo CD's SanitizeName does", () => {
    expect(sanitizeName("My_App.v2--")).toBe("my-app.v2");
    expect(sanitizeName("-.Ünï code.-")).toBe("n--code");
    expect(sanitizeName("x".repeat(300)).length).toBe(253);
  });
  it("flattens a file's object as fasttemplate does, and makes a gap of what it cannot print", () => {
    const f = flattenParams({ cluster: { name: "a", tier: 2, list: ["x", "y"] }, bad: 1.5, none: null, on: true });
    expect(f.values).toEqual({
      "cluster.name": "a",
      "cluster.tier": "2",
      "cluster.list.0": "x",
      "cluster.list.1": "y",
      on: "true",
    });
    expect([...f.gaps.keys()].sort()).toEqual(["bad", "none"]);
  });
});

describe("path patterns (path.Match for directories, git pathspec for files)", () => {
  it("matches directories segment by segment, never across /", () => {
    const b = new StepBudget(1_000_000);
    expect(matchPath("directory", "apps/*", "apps/web", b)).toBe(true);
    expect(matchPath("directory", "apps/*", "apps/web/x", b)).toBe(false);
    expect(matchPath("directory", "apps/w?b", "apps/web", b)).toBe(true);
    expect(matchPath("directory", "*", "apps", b)).toBe(true);
    expect(matchPath("directory", "apps", "Apps", b)).toBe(false);
  });
  it("matches files with * and ? across /, and a literal as the path or a directory above it", () => {
    const b = new StepBudget(1_000_000);
    expect(matchPath("file", "clusters/*.json", "clusters/a/b.json", b)).toBe(true);
    expect(matchPath("file", "clusters/*.json", "clusters/a.yaml", b)).toBe(false);
    expect(matchPath("file", "clusters", "clusters/a/b.json", b)).toBe(true);
    expect(matchPath("file", "clusters", "clustersx/a.json", b)).toBe(false);
  });
  it("refuses classes, escapes and empty patterns by name", () => {
    expect(checkPattern("apps/[ab]*").ok).toBe(false);
    expect(checkPattern("apps\\*").ok).toBe(false);
    expect(checkPattern("").ok).toBe(false);
    expect(checkPattern("apps/*").ok).toBe(true);
  });
  it("counts steps and stops when the budget is spent", () => {
    const b = new StepBudget(10);
    expect(matchPath("directory", "apps/*", "apps/web", b)).toBeNull();
  });
  it("never backtracks: a hostile pattern costs pattern x path steps", () => {
    const b = new StepBudget(10_000_000);
    const t0 = cpuStart();
    expect(matchPath("file", `${"*a".repeat(500)}b`, "a".repeat(2000), b)).toBe(false);
    expect(cpuSince(t0)).toBeLessThan(2000);
  });
  it("indexes directories by depth and first segment", () => {
    const idx = new DirectoryIndex(["apps", "apps/a", "apps/b", "system/x", "a/b/c"]);
    expect(idx.candidates("apps/*")).toEqual(["apps/a", "apps/b"]);
    expect(idx.candidates("*/*")).toEqual(["apps/a", "apps/b", "system/x"]);
    expect(idx.candidates("nope/*")).toEqual([]);
  });
});
