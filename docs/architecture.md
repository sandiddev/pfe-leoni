# Architecture

## Why this shape

The brief (§6.2) requires that _"the replenishment logic can be unit-tested"_ and that the
_"domain layer is independent from UI and persistence"_. That single requirement drives
everything below: the formulas live in a package that imports nothing, so they can be
tested in milliseconds, read by a logistician, and defended in front of a jury without
anyone having to understand React or Prisma.

Everything else is arranged so that constraint cannot quietly erode.

---

## Packages

```
apps/
  web/           Next.js 16 — UI, tRPC + auth route handlers, scheduled-job endpoint
packages/
  core/          PURE domain. Formulas, workflow, permissions. Imports NOTHING.
  contracts/     Zod schemas, DTO types, French label dictionaries
  db/            Prisma schema, migrations, client, seed
  auth/          better-auth configuration, session shape
  api/           tRPC: context, procedure builders, feature modules
  ui/            Design system: tokens, primitives, patterns
  env/           Typed, validated environment — the only reader of process.env
  tooling/       tsconfig bases, ESLint flat configs, Prettier config
```

## The dependency graph

```
                    ┌──────────────┐
                    │  apps/web    │
                    └──┬───┬───┬───┘
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
        ┌──────────┐  ┌────────┐  ┌──────────┐
        │@leoni/api│  │@leoni/ui│ │@leoni/auth│
        └────┬──┬──┘  └────┬────┘ └─────┬────┘
             │  │          │            │
             │  └──────────┼────────────┼──────┐
             ▼             ▼            ▼      ▼
      ┌────────────┐  ┌──────────────┐  ┌──────────┐
      │@leoni/core │◄─│@leoni/contracts│ │@leoni/db │
      └────────────┘  └──────────────┘  └──────────┘
         imports
         nothing
```

Four rules, and both pnpm and ESLint enforce them:

1. **`core` imports nothing.** Not a workspace package, not a framework, not Zod, not even
   `node:crypto`. If a formula appears to need one, the dependency belongs in the caller and
   the value is passed in as an argument. `core` also may not read the clock — `now: Date` is
   always a parameter, so every calculation is deterministic and its tests reproducible.
2. **`db` is imported only by `*.repository.ts` and by `auth`.**
3. **`ui` never imports `api`, `db` or `auth`.** Components receive data as props, which is
   what lets them be rendered in isolation for a test or a report screenshot.
4. **`apps/web` never touches the database.**

The enforcement is deliberately two-layered. **pnpm** makes a violation _impossible_: a
package cannot import what its `package.json` does not declare. **ESLint** makes it
_explicable_: the error message says why the rule exists and what to do instead.

---

## Inside `@leoni/api`: the feature module

```
packages/api/src/modules/article/
├── article.router.ts      validate · authorise · orchestrate
├── article.service.ts     business rules · transactions
├── article.repository.ts  the only file that may say `db.`
└── article.mapper.ts      Prisma row ⇄ DTO
```

The layering exists so a reader can open one file and find one concern:

- open `article.service.ts` → the whole business rule, no SQL in the way;
- open `article.repository.ts` → the whole persistence concern, no rule in the way.

**The mapper is not ceremony.** Prisma returns `Decimal` objects for the threshold and
consumption columns, and `Decimal` does not survive serialisation to a browser as a number.
Converting in one named place is what stops a threshold arriving in the UI as
`{ s: 1, e: 3, d: [1500] }`. The mapper is also where computed fields (alert level,
coverage, suggested quantity) are attached, so the numbers a screen renders are the ones the
domain produced rather than a second implementation living in a component.

---

## How a request flows

Taking "the storekeeper opens /articles and filters on Rupture":

```
1.  Server Component  apps/web/src/app/(app)/articles/page.tsx
       calls api.article.list(...)  — in-process, no HTTP
2.  Router            article.router.ts
       Zod validates the input
       permissionProcedure("article:read") checks the actor's role
3.  Service           article.service.ts
       resolveSiteFilter(actor, input.siteId)
         → whatever site was asked for, this is the site actually queried
       loads ReplenishmentParameter for each ABC class (once, not per row)
4.  Repository        article.repository.ts
       one $transaction: page of rows + total count, filtered identically
5.  Mapper            article.mapper.ts
       Decimal → number
       assessStockItem() from @leoni/core computes level, coverage, suggestion
6.  Back up           DTO → superjson → HTML
7.  Client            article-table.tsx
       renders; later filters re-query over HTTP through the same router
```

Server Components call the router **in-process**. A fetch to `localhost` from a server
component would serialise the arguments, open a socket to itself and deserialise the result,
all to reach a function already in memory. The browser goes through
`/api/trpc/[trpc]/route.ts`. Both paths run the same router with the same context factory,
so an authorisation rule cannot apply on one and not the other.

---

## Authorisation

Three layers, each doing something the others cannot:

| Layer                 | Where           | What it protects against                                                                                  |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| `proxy.ts`            | Edge            | A signed-out user seeing a flash of the app. **Not** a security control — it only checks a cookie exists. |
| `(app)/layout.tsx`    | Server          | A deactivated account browsing on an unexpired cookie. Asks the database.                                 |
| `permissionProcedure` | Every tRPC call | Everything else. This is the real boundary.                                                               |

The permission matrix itself lives in **`@leoni/core/access`**, not in `@leoni/auth`. Who may
approve a request is a statement about how LEONI works, not about how sessions are stored —
so it is unit-tested without a database, and swapping the auth library later would not put a
single business rule at risk.

The sidebar filters itself with the same `can()` the API uses. That keeps the UI honest, but
hiding a link is never mistaken for securing a route: the server checks again, always.

**Site scoping** deserves its own note. `resolveSiteFilter` returns the site a query is
_actually_ restricted to — the intersection of what the client asked for and what the actor
may see. A requested filter is a convenience, never an authorisation decision. And because a
filter cannot protect a `findUnique`, every lookup by id is re-checked with
`assertCanAccessSite` on the row that came back.

---

## Persistence notes

**Numeric convention.** Physical quantities are `Int` (units); rates and computed thresholds
are `Decimal(12,3)`. Repositories convert at the mapper boundary so `core` and `contracts`
only ever see `number`.

**Two deliberate denormalisations**, both kept correct in the same transaction as the change
that causes them:

- `StockItem.currentStock` — the alert board reads it for every article on every page load;
  recomputing it from the movement journal each time would not survive a real catalogue.
- `StockItem.alertLevel` — the level is a function of two columns and a ratio, and Prisma
  cannot express `currentStock ≤ minThreshold × 1.2` in a `WHERE` clause. Storing it makes
  the board filterable and sortable by severity with an index.

**`StockAlertSnapshot`** exists for a different reason: the KPIs of §6.5 (taux de rupture,
taux de service, évolution des articles à risque) are questions about the _past_, and the
past cannot be recomputed from a table that only ever holds the present.

**`ThresholdHistory.parametersSnapshot`** is JSON rather than a foreign key because the
parameter row it came from will itself be edited; a reference would make the history lie.

---

## Scheduled recalculation

Thresholds are recomputed daily (§3.5). The logic lives in the service layer and is invoked
two ways: a tRPC mutation ("Recalculer") and a route handler guarded by `JOB_SECRET`, to be
triggered by the host scheduler on the LEONI server. No external SaaS is involved (§6.2).

---

## What is built, and what is next

**Complete:** the domain package (formulas, workflow, permissions — 149 unit tests), the
database schema and seed, authentication with the five roles, the design system, and the
**article** module as a full vertical slice with its screen.

**Next**, each by copying the article module's four files:
`stock` · `alert` · `request` · `parameter` · `dashboard` · `notification` · `admin` ·
`import`.
