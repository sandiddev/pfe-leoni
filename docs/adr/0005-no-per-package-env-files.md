# 5. One .env at the repository root

**Status:** accepted · **Date:** 2026-08-22

## Context

Three processes need environment variables and none of them agree on where to look: Next
loads `.env` relative to `apps/web`, the Prisma CLI relative to its own working directory,
and the seed script not at all.

The obvious fix — a copy of `.env` in each package — was tried and reverted within the hour.

## Decision

One `.env`, at the repository root. Each consumer loads it explicitly by absolute path:

- `apps/web/next.config.ts` — runs before the app boots;
- `packages/db/prisma.config.ts` — for the Prisma CLI;
- `packages/db/src/load-env.ts` — imported first by the seed.

`process.env` is read in exactly two places: `@leoni/env` (validated with Zod), and
`prisma.config.ts`, which runs before the application exists and must not depend on auth
secrets to migrate a database.

## Consequences

A second copy of a connection string is a second place for it to go stale, and the stale one
is always the one someone is debugging against. One file removes the class of problem.

The cost is three explicit loader lines, each with a comment saying why.
