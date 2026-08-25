import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    environment: "node",
    include: ["src/**/*.test.ts"],

    /**
     * A fake environment, so these tests never touch a real one.
     *
     * The service tests stub their repository and open no connection, but they
     * build the Prisma-shaped rows a repository would have returned — and
     * importing `Prisma` for `Decimal` loads @leoni/db, which validates the
     * environment at module load. Without these the suite fails on a missing
     * DATABASE_URL rather than on anything it is testing.
     *
     * The values are deliberately obvious nonsense. A test that somehow tried
     * to connect would fail loudly on `nowhere:1/none`, which is a much better
     * outcome than one that silently reached a developer's dev database.
     */
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://unused:unused@nowhere:1/none",
      BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-to-pass",
      BETTER_AUTH_URL: "http://localhost:4300",
      NEXT_PUBLIC_APP_URL: "http://localhost:4300",
      JOB_SECRET: "test-job-secret-value",
    },

    coverage: {
      provider: "v8",
      /**
       * Services, mappers and middlewares — the layers that hold a decision.
       *
       * Repositories are deliberately outside it: their content is SQL, and a
       * unit test can only assert that a stub was called, which measures
       * nothing. Routers too — they validate, declare a permission and
       * delegate, so covering them means covering tRPC. Both belong to the
       * integration harness (TEST_DATABASE_URL) when it is built; counting them
       * here would only invite a number chased with meaningless tests.
       */
      include: [
        "src/modules/**/*.service.ts",
        "src/modules/**/*.mapper.ts",
        "src/middlewares/**/*.ts",
      ],
      exclude: ["src/**/*.test.ts"],
      /**
       * Lower than the domain layer's 95 on purpose. `@leoni/core` holds the
       * formulas — a wrong line there mis-orders stock — while this layer
       * orchestrates. What must stay covered is the reasoning: site scoping,
       * pagination, and the audit trail.
       */
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
