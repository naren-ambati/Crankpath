// The bounded HCL seal reader (NFR1.1, BR6.10): what it reads, what it refuses, and that hostile
// input (deep braces, unterminated strings, huge text) ends in a named refusal, quickly, never a
// throw or a hang.

import { describe, expect, it } from "vitest";
import { HCL_VALUE_BYTES, readSealStanzas } from "../../src/u6-extractors-workload/hcl-seal-reader.js";
import { cpuSince, cpuStart } from "../helpers/cpu-time.js";

function seals(text: string) {
  const r = readSealStanzas(text);
  if (!r.ok) throw new Error(`refused: ${r.problem} at ${r.line}`);
  return r.seals.map((s) => ({ type: s.type, line: s.line, attributes: Object.fromEntries(s.attributes) }));
}
function problem(text: string) {
  const r = readSealStanzas(text);
  return r.ok ? "read" : `${r.problem}@${r.line}`;
}

const CONFIG = `ui = true
listener "tcp" {
  address     = "[::]:8200"
  tls_disable = 1
}
storage "raft" {
  path = "/vault/data"
  retry_join {
    leader_api_addr = "https://vault-0.vault-internal:8200"
  }
}
seal "awskms" {
  region     = "us-east-1"
  kms_key_id = "alias/unseal"
  endpoint   = ["a", "b"]
}
`;

describe("what the reader reads", () => {
  it("finds a top-level seal stanza with its type, line and direct attributes", () => {
    expect(seals(CONFIG)).toEqual([
      {
        type: "awskms",
        line: 12,
        attributes: { region: "us-east-1", kms_key_id: "alias/unseal", endpoint: null },
      },
    ]);
  });
  it("reads every seal stanza, numbers, booleans and a quoted key", () => {
    const text = `seal "transit" {\n  address = "https://v:8200"\n  disabled = true\n  priority = 2\n}\n"seal" "gcpckms" { region = "global" }\n`;
    expect(seals(text)).toEqual([
      { type: "transit", line: 1, attributes: { address: "https://v:8200", disabled: true, priority: 2 } },
      { type: "gcpckms", line: 6, attributes: { region: "global" } },
    ]);
  });
  it("finds no seal in a config without one, and an empty text is no seal", () => {
    expect(seals('ui = true\nstorage "file" { path = "/d" }\n')).toEqual([]);
    expect(seals("")).toEqual([]);
  });
  it("does not read a seal inside a comment, a string, a heredoc or a nested block", () => {
    const text = [
      '# seal "awskms" { region = "eu-west-1" }',
      '// seal "awskms" { region = "eu-west-1" }',
      '/* seal "awskms" {',
      '   region = "eu-west-1" } */',
      'note = "seal \\"awskms\\" { region = \\"eu-west-1\\" }"',
      "doc = <<EOF",
      'seal "awskms" { region = "eu-west-1" }',
      "EOF",
      'telemetry { seal "awskms" { region = "eu-west-1" } }',
      'seal "azurekeyvault" {',
      '  tenant_id = "t"',
      "}",
    ].join("\n");
    expect(seals(text)).toEqual([{ type: "azurekeyvault", line: 10, attributes: { tenant_id: "t" } }]);
  });
  it("reads an indented heredoc and keeps counting lines after it", () => {
    const text = 'x = <<-EOT\n  a\n  b\n  EOT\nseal "awskms" { region = <<EOF\nus-east-1\nEOF\n}\n';
    expect(seals(text)).toEqual([{ type: "awskms", line: 5, attributes: { region: "us-east-1" } }]);
  });
  it("keeps attributes of blocks nested in a seal out of the seal's own attributes", () => {
    const text = 'seal "pkcs11" {\n  inner { region = "x" }\n  region = "y"\n}\n';
    expect(seals(text)).toEqual([{ type: "pkcs11", line: 1, attributes: { inner: null, region: "y" } }]);
  });
});

describe("what the reader refuses, rather than guesses (NFR1.1)", () => {
  it.each([
    ['seal "awskms" { region = "us-east-1 }', "unterminated-string@1"],
    ['seal "awskms" { region = "us-east-1\n" }', "unterminated-string@1"],
    ['x = "a\\', "unterminated-string@1"],
    ['ui = true\n/* seal "awskms" {', "unterminated-comment@2"],
    ["x = <<EOF\nnever ends\n", "unterminated-heredoc@1"],
    ['seal "awskms" {\n region = "a"\n', "unbalanced@3"],
    ["}\n", "unbalanced@1"],
    ["x = [1, 2\n", "unbalanced@2"],
    ["x = @y\n", "unexpected-character@1"],
    ["x = <y\n", "unexpected-character@1"],
    ['seal = { awskms = { region = "a" } }', "unrecognised-seal@1"],
    ['seal awskms { region = "a" }', "unrecognised-seal@1"],
    ['seal "awskms" "x" { region = "a" }', "unrecognised-seal@1"],
    ['seal "awskms"\n', "unrecognised-seal@2"],
    ['seal "awskms" {\n region = "a"\n region = "b"\n}', "duplicate-attribute@3"],
    ["x = }", "unexpected-token@1"],
    ["x = = 1", "unexpected-token@1"],
    ["= 1", "unexpected-token@1"],
    ['{"seal": {"awskms": {}}}', "unexpected-token@1"],
    ["x = [ } ]", "unexpected-token@1"],
  ])("refuses %j as %s", (text, expected) => {
    expect(problem(text)).toBe(expected);
  });
  it("refuses a text over 1 MiB, the most a ConfigMap holds, without reading it", () => {
    expect(HCL_VALUE_BYTES).toBe(1048576);
    expect(problem(`# ${"x".repeat(HCL_VALUE_BYTES)}`)).toBe("too-large@1");
    expect(problem(`#${"x".repeat(HCL_VALUE_BYTES - 1)}`)).toBe("read");
  });
  it("counts bytes, not characters, against the limit", () => {
    expect(problem(`# ${"é".repeat(HCL_VALUE_BYTES / 2)}`)).toBe("too-large@1");
  });
});

describe("hostile input ends in a named refusal, quickly, and never throws", () => {
  const timed = (text: string) => {
    const start = cpuStart();
    const p = problem(text);
    return { p, ms: cpuSince(start) };
  };
  it("a megabyte of open braces", () => {
    const { p, ms } = timed(`x = ${"{".repeat(HCL_VALUE_BYTES - 8)}`);
    expect(p).toBe("unexpected-token@1");
    expect(ms).toBeLessThan(5000);
  });
  it("deep nesting of blocks, closed", () => {
    const depth = 200_000;
    const { p, ms } = timed(`${"a {".repeat(depth)}${"}".repeat(depth)}`);
    expect(p).toBe("read");
    expect(ms).toBeLessThan(5000);
  });
  it("deep nesting of lists, unclosed", () => {
    const { p } = timed(`x = ${"[".repeat(300_000)}`);
    expect(p).toBe("unbalanced@1");
  });
  it("one string of almost a megabyte, unterminated", () => {
    const { p, ms } = timed(`x = "${"a".repeat(HCL_VALUE_BYTES - 10)}`);
    expect(p).toBe("unterminated-string@1");
    expect(ms).toBeLessThan(5000);
  });
  it("many seal stanzas", () => {
    const text = 'seal "awskms" { region = "us-east-1" }\n'.repeat(20_000);
    const r = readSealStanzas(text);
    expect(r.ok && r.seals.length).toBe(20_000);
  });
  it("control characters stay data", () => {
    const r = readSealStanzas('seal "\u001b[2J" { region = "us-east-1" }');
    expect(r.ok && r.seals[0]?.type).toBe("\u001b[2J");
    expect(problem("x = \u0000")).toBe("unexpected-character@1");
  });
});

describe("review fixes: no guessing at values or escapes (m5, n3)", () => {
  it.each([
    ['seal "awskms" { region = us-east-1 }', "bare-identifier@1"],
    ['seal "transit" { address = foo.example.org }', "bare-identifier@1"],
    ['seal "awskms" { region = "\\u0075s-east-1" }', "bad-escape@1"],
    ['seal "awskms" { region = "\\x75s-east-1" }', "bad-escape@1"],
    ['x = "a\\\nb"', "unterminated-string@1"],
  ])("refuses %j as %s", (text, expected) => {
    expect(problem(text)).toBe(expected);
  });
  it("keeps the HCL booleans and the plain escapes", () => {
    expect(seals('seal "a" {\n disabled = false\n note = "q\\"\\\\\\n\\t\\r"\n}')).toEqual([
      { type: "a", line: 1, attributes: { disabled: false, note: 'q"\\\n\t\r' } },
    ]);
  });
});
