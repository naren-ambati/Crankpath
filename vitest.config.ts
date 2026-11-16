import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup/no-network.ts"],
    // builds dist once when it is older than src, for the tests that run the built binary
    globalSetup: ["test/setup/build-dist.ts"],
    // A hang guard only, never a cost bound (those are CPU time, test/helpers/cpu-time.ts): 15 minutes, the
    // guard the adversarial suite already had, about 27 times the slowest test under the suite's own parallel
    // load (33.4 s, 2026-11-16). A 180 s guard was hit by that test with 30 CPU-bound processes running beside
    // the suite on 10 cores (load average 123); BUILD-NOTES, release round part B.
    testTimeout: 900_000,
    hookTimeout: 900_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      // the core units and the Action's modules (U10); the CLI shell (U9) and the fixtures are not part of the floor
      include: [
        "src/u1-graph-model/**/*.ts",
        "src/u2-intake-config/**/*.ts",
        "src/u3-discovery-expansion/**/*.ts",
        "src/u4-render-engine/**/*.ts",
        "src/u5-extractors-gitops/**/*.ts",
        "src/u6-extractors-workload/**/*.ts",
        "src/u7-graph-analysis/**/*.ts",
        "src/u8-output/**/*.ts",
        "action/**/*.mjs",
      ],
      thresholds: { lines: 80 },
    },
  },
});
