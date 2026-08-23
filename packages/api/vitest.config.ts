import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The API layer is tested against a real Postgres (TEST_DATABASE_URL), and
    // that harness is not built yet. Passing explicitly — rather than leaving
    // `pnpm test` red — keeps the signal meaningful: a red suite must mean a
    // real failure, not a package that has no tests yet.
    passWithNoTests: true,
  },
});
