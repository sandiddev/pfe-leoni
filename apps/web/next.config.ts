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

  /**
   * The headers that do not vary per request.
   *
   * The Content-Security-Policy is deliberately absent here and lives in
   * `proxy.ts` instead: it carries a per-request nonce, which a static header
   * cannot.
   */
  headers() {
    // Next accepts a plain array here as well as a promise; there is nothing to
    // await, and `async` with no `await` is a lie the linter rightly refuses.
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          // The application is served over HTTPS on the LEONI network; a
          // downgrade is what a session cookie should never survive.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          // A CSV export or an uploaded PDF must not be re-interpreted as
          // something executable because a browser guessed at its content.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Request codes and article references travel in paths; a full
          // referrer would leak them to anything a user clicks through to.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // `frame-ancestors` in the CSP is what modern browsers enforce; this
          // is for the ones that do not.
          { key: "X-Frame-Options", value: "DENY" },
          // Nothing here needs a camera, a microphone or a location.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ]);
  },
};

export default config;
