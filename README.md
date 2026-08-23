# Réapprovisionnement LTN1 ↔ LTN4

Système de gestion et de réapprovisionnement des stocks entre les sites **LTN1** (site
consommateur) et **LTN4** (magasin central) de LEONI Tunisie.

Replaces an email-driven inter-plant replenishment process with an automated, traceable,
KPI-instrumented workflow: automatic need detection, suggested quantities aligned to
packaging, a tracked request lifecycle, dynamic Min/Max thresholds, and decision-support
dashboards.

> PFE 2026 — the interface is in French; the code is in English.

---

## Prerequisites

| Tool   | Version    | Note                                                   |
| ------ | ---------- | ------------------------------------------------------ |
| Node   | **≥ 24**   | Node 20 is too old for Prisma 7, ESLint 10 and pnpm 11 |
| pnpm   | **11**     | `npm install -g pnpm`                                  |
| Docker | any recent | Runs Postgres 17                                       |

## Getting started

```bash
cp .env.example .env
```

```bash
pnpm docker:up && pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev
```

- Application → <http://localhost:4300>
- Adminer (database browser) → <http://localhost:8100>

### Demo accounts

Password for all of them: `Leoni2026!`

| Email                       | Rôle                     | Voit                          |
| --------------------------- | ------------------------ | ----------------------------- |
| `admin@leoni.tn`            | Administrateur           | Les deux sites, tout          |
| `magasinier.ltn1@leoni.tn`  | Magasinier LTN1          | LTN1                          |
| `responsable.ltn1@leoni.tn` | Responsable magasin LTN1 | LTN1                          |
| `responsable.ltn4@leoni.tn` | Responsable LTN4         | LTN4                          |
| `logistique@leoni.tn`       | Responsable logistique   | Les deux sites, lecture seule |

The seed is deterministic and safe to re-run: 150 articles spread across all four alert
levels, 20 requests covering every workflow status, 30 days of movement history and 90 days
of alert snapshots — so every screen is populated.

---

## Commands

```bash
pnpm dev            # dev server (port 4300)
pnpm build          # build everything
pnpm typecheck      # tsc --noEmit across the workspace
pnpm lint           # ESLint, including the architecture rules
pnpm test           # unit tests
pnpm db:seed        # rebuild demo data
pnpm db:studio      # Prisma Studio
pnpm docker:down    # stop Postgres
```

---

## Layout

```
apps/web/          Next.js 16 — screens, tRPC & auth handlers
packages/
  core/            Pure domain: formulas, workflow, permissions (149 tests)
  contracts/       Zod schemas, DTOs, French labels
  db/              Prisma schema, migrations, seed
  auth/            better-auth configuration
  api/             tRPC routers, services, repositories
  ui/              Design system
  env/             Validated environment
  tooling/         Shared tsconfig / ESLint / Prettier
docs/              Architecture, domain, conventions, design system, ADRs
```

---

## Documentation

| Document                                       | Contents                                               |
| ---------------------------------------------- | ------------------------------------------------------ |
| [CLAUDE.md](CLAUDE.md)                         | The operating rules — read this first                  |
| [docs/architecture.md](docs/architecture.md)   | Layers, dependency rules, request lifecycle            |
| [docs/domain.md](docs/domain.md)               | Formulas, workflow, glossary FR/EN, stated assumptions |
| [docs/conventions.md](docs/conventions.md)     | TypeScript and clean-code rules, with reasoning        |
| [docs/design-system.md](docs/design-system.md) | Tokens, components, accessibility                      |
| [docs/adr/](docs/adr/)                         | One record per architectural decision                  |

---

## Stack

Next.js 16 · React 19 · tRPC 11 · Prisma 7 · PostgreSQL 17 · better-auth 1.7 ·
Tailwind 4 · TypeScript 6 · pnpm workspaces + Turborepo · Vitest

TypeScript is pinned to 6.0.3 rather than 7.x because `typescript-eslint` requires `<6.1`,
and type-aware linting is what enforces the architecture rules. See
[docs/adr/0002-typescript-6-not-7.md](docs/adr/0002-typescript-6-not-7.md).
