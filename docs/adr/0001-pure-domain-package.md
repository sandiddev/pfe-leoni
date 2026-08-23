# 1. A dependency-free domain package

**Status:** accepted · **Date:** 2026-08-22

## Context

The brief (§6.2) requires a clean separation between the domain layer — the replenishment
formulas and the request workflow — and both the UI and persistence, so that the business
logic can be unit-tested. The formulas are also the part of the work a jury will read line
by line and challenge.

## Decision

`@leoni/core` imports **nothing**: no workspace package, no framework, no Zod, no Node
built-in. It may not read the clock either — `now: Date` is always a parameter.

Lint rules make a violation fail `pnpm lint` with an explanatory message.

## Consequences

**Good.** The whole rule set runs in ~200 ms with no database and no browser. A reader who
knows logistics but not TypeScript tooling can follow `thresholds.ts` end to end. Every
calculation is deterministic, so its tests are reproducible and the reference example from
the brief can be asserted verbatim.

**Cost.** Callers must gather inputs and pass them in — the service loads
`ReplenishmentParameter` and hands the numbers to `computeThresholds` rather than the
formula fetching them itself. This is the trade being made deliberately.

**Rejected alternative.** Full hexagonal architecture with repository interfaces in the
domain and a DI container. It would add a class and an interface per use case for a project
with one database and one consumer, and the testability benefit is already obtained.
