import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "core",
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      // The domain layer is the part the jury will read line by line and the
      // part a bug in would silently mis-order stock. It carries the strictest
      // coverage gate in the repository.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
