// The B1 interim opacity reason must be gone before a release (B1 deviation 1, BUILD-NOTES): no file of
// crankpath's source names it, so no build can produce it, and the report schema no longer lists it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INTERIM_REASON, interimReasonFiles } from "../../scripts/release-checks.mjs";
import { OPAQUE_REASONS } from "../../src/u1-graph-model/graph-model.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("the interim opacity reason", () => {
  it("is named by no file under src/", () => {
    expect(interimReasonFiles(ROOT).filter((f) => f.startsWith("src/"))).toEqual([]);
    expect(OPAQUE_REASONS as readonly string[]).not.toContain(INTERIM_REASON);
  });

  it("is not a word of the report schema", () => {
    expect(fs.readFileSync(path.join(ROOT, "schemas", "crankpath-report.schema.json"), "utf8")).not.toContain(
      INTERIM_REASON,
    );
  });
});
