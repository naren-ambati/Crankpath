import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup/no-network.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      // the core folders that exist so far; grow this list as units appear
      include: ["src/u1-graph-model/**/*.ts", "src/u2-intake-config/**/*.ts"],
      thresholds: { lines: 80 },
    },
  },
});
