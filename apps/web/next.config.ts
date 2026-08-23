import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";
import path from "node:path";

/**
 * Next reads `.env` from the application directory, but in a monorepo the
 * single source of truth is the repository root — one file, one place the
 * database password lives. This runs before the config is evaluated and
 * therefore before `@leoni/env` validates anything.
 */
loadEnv({ path: path.resolve(import.meta.dirname, "..", "..", ".env"), quiet: true });

const config: NextConfig = {
  reactStrictMode: true,

  // Next 16 writes its own CLAUDE.md / AGENTS.md on dev start. This repository
  // authors those files deliberately (see the root CLAUDE.md), and a generated
  // one silently overwriting the project's rules would be worse than useless.
  agentRules: false,

  /**
   * Workspace packages ship TypeScript source rather than a build step.
   *
   * The alternative — compiling each package to dist/ before Next can use it —
   * buys nothing here (there is exactly one consumer) and costs a build to
   * rerun on every edit. Next compiles them with the same toolchain it uses for
   * the app, so a change in @leoni/core is picked up by hot reload directly.
   */
  transpilePackages: [
    "@leoni/api",
    "@leoni/auth",
    "@leoni/contracts",
    "@leoni/core",
    "@leoni/db",
    "@leoni/env",
    "@leoni/ui",
  ],

  typescript: {
    // Type errors fail the build. `pnpm typecheck` runs the same check faster,
    // but a build that silently ships broken types is worse than a slow build.
    ignoreBuildErrors: false,
  },

  // Next 16 no longer runs ESLint during `next build`; linting is its own task
  // in the Turborepo pipeline (`pnpm lint`).
};

export default config;
