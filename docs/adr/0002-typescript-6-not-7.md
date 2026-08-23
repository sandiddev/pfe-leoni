# 2. TypeScript pinned to 6.0.3, not 7.x

**Status:** accepted · **Date:** 2026-08-22

## Context

TypeScript 7.0.2 (the native compiler) is the current release. However
`typescript-eslint@8.67` declares `typescript: >=4.8.4 <6.1.0`.

Type-aware linting is not cosmetic here: `no-floating-promises`,
`no-unnecessary-condition`, `switch-exhaustiveness-check` and the import-restriction rules
that enforce the layer boundaries all require type information.

## Decision

Pin TypeScript to **6.0.3** — the newest release `typescript-eslint` supports. Every other
dependency takes its latest version.

## Consequences

We forgo the compile-speed improvements of TS 7. In exchange the architecture rules keep
working, which is worth more on a codebase whose main risk is drift.

Revisit when `typescript-eslint` ships TS 7 support: the change is one line in
`pnpm-workspace.yaml`, since versions are centralised in the pnpm catalog.
