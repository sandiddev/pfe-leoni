# CLAUDE.md — operating rules for this repository

Application: **réapprovisionnement des stocks entre LTN1 et LTN4** (LEONI, PFE 2026).
LTN1 consumes and requests; LTN4 supplies and ships. The project replaces an email-driven
process with a traceable, role-based, KPI-instrumented workflow.

Read this before writing code. It is the contract, not a suggestion.

---

## 1. Where does this code go?

| If you are writing…                                   | It goes in                            |
| ----------------------------------------------------- | ------------------------------------- |
| A formula, a threshold, a workflow rule, a permission | `packages/core`                       |
| A Zod schema, a DTO type, a French label              | `packages/contracts`                  |
| A Prisma model, a migration, seed data                | `packages/db`                         |
| A tRPC procedure                                      | `packages/api/src/modules/<feature>/` |
| A reusable component or a design token                | `packages/ui`                         |
| A page, a route, a screen-specific component          | `apps/web`                            |
| Anything reading `process.env`                        | `packages/env` — **nowhere else**     |

**When in doubt, push logic down.** A rule in `core` is testable in milliseconds and
readable by someone who knows logistics but not React. The same rule in a component is
neither.

---

## 2. The dependency rule

```
apps/web ──► @leoni/api ──► @leoni/core          (business rules)
        │              └──► @leoni/db            (persistence — repositories only)
        ├──► @leoni/ui  ──► @leoni/contracts
        └──► @leoni/auth ──► @leoni/db
             everything  ──► @leoni/contracts ──► @leoni/core
```

- **`@leoni/core` imports nothing.** No workspace package, no framework, no Node built-in,
  not even Zod. If a formula seems to need one, pass the value in as an argument instead.
- **`@leoni/db` is imported only by `*.repository.ts` and `@leoni/auth`.**
- **`@leoni/ui` never imports** `api`, `db` or `auth`. Components receive data as props.
- **`apps/web` never touches the database.** Add a tRPC procedure and call that.

Enforced two ways, and both will stop you:

1. **pnpm** — a package cannot import what its `package.json` does not declare.
2. **ESLint** — `pnpm lint` fails with a message explaining _why_, not just _what_.

Verify the rules are live at any time:

```bash
pnpm lint
```

---

## 3. Feature modules (`packages/api`)

Every feature is four files, and the dependency between them runs one way only:

```
<feature>.router.ts      validate input · declare permission · call the service
       ▼
<feature>.service.ts     business rules · calls @leoni/core · decides what to record
       ▼
<feature>.repository.ts  the ONLY place Prisma appears · owns the transaction
       ▼
<feature>.mapper.ts      Prisma row ⇄ DTO (Decimal → number happens here)
```

`packages/api/src/modules/article/` is the complete reference. **Copy it.** Do not invent a
different arrangement for the next module.

- A router that contains an `if` about business state is a bug — move it to the service.
- A service that mentions `db.` is a bug — move it to the repository.

**Injection.** A service entry point takes a parameter object whose `repository` defaults to
the real one:

```ts
export async function list({
  actor, input, repository = articleRepository,
}: ServiceParams<ArticleListInput>): Promise<Page<ArticleListItem>> { … }
```

That seam is what lets the rules be unit-tested with a plain object stub and no Postgres — see
`article.service.test.ts`. It lives on the service, not the router: a `*.router.ts` may not
import a `*.repository`, and that rule is worth more than the symmetry. The port is
`typeof articleRepository`, never a hand-written parallel interface.

**The transaction rule.** Every write that changes a request's status **must** write
`RequestStatusHistory` in the same transaction. Not optionally. That trail is the point of the
project. The same applies to `AuditLog` for master-data and parameter edits.

Because a service may not import `@leoni/db`, it cannot open the transaction itself. So:

> the **service** decides which facts to record — what changed, by whom, what the change is
> called; the **repository** guarantees they land atomically, taking the history or audit row
> as part of its input and writing both inside one `db.$transaction`.

`updateWithAudit` in `article.repository.ts` is the reference. What must never exist is a
repository method that writes the row and returns, leaving the trail to a second call that a
later refactor can drop.

---

## 4. TypeScript rules

Enforced by `packages/tooling/tsconfig` and `packages/tooling/eslint-config`:

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `verbatimModuleSyntax`.
- **`any` is banned.** Use `unknown` and narrow.
- **`!` (non-null) is banned** outside tests. Write a helper that throws with a real message.
- **`as` is banned** except `as const` and the always-safe widening `as unknown`. Use
  `satisfies`, or narrow with a type guard. Enforced by `no-restricted-syntax` — note that
  `consistent-type-assertions` alone does _not_ express this, which is how three casts got in.
- **`import type { X }`, never `import { type X }`.** With `verbatimModuleSyntax` the inline
  form still emits a side-effect import, which drags server modules into browser bundles.
  This has already bitten this codebase once.
- **No `enum`.** Use a `const` array + `(typeof X)[number]` union, like `ROLES` in `core`.
- **No default exports** (Next.js pages, layouts and `proxy.ts` excepted — the framework
  requires them).
- **No `export *`.** Re-export explicitly by name so a package's public surface is readable.
- Zod schema is the single source of truth: derive types with `z.infer`, never hand-write a
  parallel interface.
- Close every `switch` over a union with `assertNever(value)`.

**Errors:** services throw `DomainError` subclasses from `@leoni/core`. The tRPC
`errorFormatter` in `packages/api/src/trpc.ts` is the only place that decides HTTP codes.
Never `throw new Error("string")` for a business rule.

---

## 5. Clean-code rules

- One responsibility per file; the file name is its export.
- Functions ≤ ~40 lines, ≤ 4 parameters — beyond that, take a parameter object.
- **No magic numbers.** Anything the logistics team might tune lives in
  `ReplenishmentParameter` in the database, not in source. This is a hard requirement of
  the brief (§3.4), not a preference. The per-class fallbacks are written **once**, in
  `DEFAULT_CLASS_PARAMETERS` (`@leoni/core`). If you are about to write `?? 1` beside a
  threshold, read [docs/business-rules.md](docs/business-rules.md) §1 first — that exact
  fallback was a live bug.
- Functions are capped at 60 lines and 4 parameters by lint (off for tests, the seed, and
  `.tsx`, where the length is markup rather than logic).
- Naming: `PascalCase` types/components, `camelCase` values, `SCREAMING_SNAKE` constants,
  `kebab-case` files, `<feature>.<layer>.ts` in the API.
- **Comments explain _why_, never _what_.** If a line needs a comment to say what it does,
  rename something instead.

---

## 6. Language

**Interface in French. Code in English.** (Brief §6.2.)

- Identifiers, types, comments, commit messages: English.
- Every user-visible string: French — and enum labels come from
  `packages/contracts/src/labels/fr.ts`, never inline in a component.
- Routes are French (`/demandes`, `/alertes`, `/parametres`).
- Vocabulary must match the report: _réapprovisionnement, seuil mini/maxi, stock de
  sécurité, couverture, VPE, FIFO, rupture_. See `GLOSSARY_FR`.

---

## 7. Design system

- **Never write a raw hex colour or a Tailwind arbitrary value** (`bg-[#0056A4]`,
  `w-[347px]`). Both are lint errors. Add a semantic token in
  `packages/ui/src/styles/globals.css` and use the generated utility.
- Tokens are named by **role**, not appearance: `bg-status-critical`, not `bg-orange-600`.
- Stock levels and request statuses have their own tokens, so every screen renders
  "Critique" identically. Use `<AlertLevelBadge>` and `<RequestStatusBadge>` — do not
  re-derive a colour from a status.
- Quantities use the `.tabular` class or `TableNumericCell`: figures are read in columns.
- Format numbers and dates with the helpers in `@leoni/ui` (`formatQuantity`,
  `formatCoverage`, `formatDate`), never with ad-hoc `toLocaleString` calls.

---

## 8. Commands

```bash
pnpm docker:up          # Postgres 17 + Adminer (localhost:8100)
pnpm install
pnpm db:migrate         # apply migrations
pnpm db:seed            # deterministic demo data — safe to re-run
pnpm dev                # http://localhost:4300
```

```bash
pnpm typecheck && pnpm lint && pnpm test
```

```bash
pnpm db:check          # schema valid, and no change left without a migration
```

Demo accounts (password `Leoni2026!`):

| Email                       | Role                   |
| --------------------------- | ---------------------- |
| `admin@leoni.tn`            | Administrateur         |
| `magasinier.ltn1@leoni.tn`  | Magasinier LTN1        |
| `responsable.ltn1@leoni.tn` | Responsable magasin    |
| `responsable.ltn4@leoni.tn` | Responsable LTN4       |
| `logistique@leoni.tn`       | Responsable logistique |

---

## 9. Things that will waste your time if you do not know them

- **Node ≥ 24** and **pnpm 11**. Node 20 is too old for Prisma 7, ESLint 10 and pnpm 11.
- **TypeScript is pinned to 6.0.3**, not 7.x: `typescript-eslint` requires `<6.1`, and
  type-aware linting is what enforces the architecture. Revisit when it supports TS 7.
- **Third-party versions live in `pnpm-workspace.yaml` under `catalog:`.** Packages
  reference `"catalog:"`, never a literal range. Upgrade in one place.
- **The dev port is 4300**, not 3000 — Windows reserves 2851–3506 on this machine.
- **There is one `.env`, at the repository root.** The Prisma CLI, the seed and Next each
  load it explicitly; do not create per-package copies.
- **Adding a Prisma enum value requires the matching change in `@leoni/core`.** The parity
  test in `packages/db/src/enum-parity.test.ts` will fail the build otherwise — on purpose,
  and in both directions: a whole new enum with no domain union fails too.
- **`prisma migrate dev` needs a TTY.** See section 10 for the non-interactive recipe.

---

## 10. Changing the database

The schema is `packages/db/prisma/schema/*.prisma` — one file per concern, not one big file.
A change to it is never finished until a migration carries it, and these steps are what the
hooks and tests check for you.

**1. Edit the schema.** The conventions below are enforced by
`packages/db/src/schema-conventions.test.ts`, per model:

| Rule                                          | Why                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@@map("snake_case")` on every model          | The database is read directly through psql and Adminer during the defence                                   |
| `@db.Decimal(p, s)` on every `Decimal`        | Without it Postgres gets `numeric(65,30)` — a precision nobody chose                                        |
| Never `Float`                                 | `Int` for quantities, `Decimal` for rates. A float part count renders as 999.9999999                        |
| Explicit `onDelete` on every relation you own | Prisma's implicit default is `Restrict` when required and `SetNull` when optional — write the decision down |
| An index on every foreign key you own         | Postgres does not create one. Unindexed FK = sequential scan on the join, longer lock on the parent delete  |
| A creation timestamp on every model           | Every KPI in §6.5 is a question about time                                                                  |

**2. Write the migration.** `prisma migrate dev` needs a TTY, so in a non-interactive shell:

```bash
cd packages/db && mkdir -p "prisma/migrations/$(date +%Y%m%d%H%M%S)_short_snake_case_name"
```

```bash
cd packages/db && pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema --script > prisma/migrations/<the_dir_you_just_made>/migration.sql
```

**3. Apply and check.**

```bash
pnpm --filter @leoni/db exec prisma migrate deploy && pnpm db:check && pnpm test
```

`pnpm db:check` validates the schema and exits non-zero if the database and the schema still
disagree — i.e. if a change has no migration. It is the answer to "did I forget a migration?".

**Never edit a committed migration.** Prisma checksums every applied migration, so editing the
SQL afterwards makes `migrate deploy` fail on every _other_ machine with "migration modified
after being applied", while yours keeps working — the damage is invisible from where it was
done. A migration is history; to change the schema, add another one. A `PreToolUse` hook
refuses the edit (an uncommitted migration is still a draft, and editing that is fine).

**Adding an enum, a status or an ABC-like set?** It belongs in `@leoni/core` in the `ROLES`
shape _and_ in the schema, and `enum-parity.test.ts` checks both directions. Adding it to only
one side fails the build.

---

## 11. Business rules

The formulas and the workflow are one thing; the invariants they must never violate are
another. [docs/business-rules.md](docs/business-rules.md) states each one with its reason and
the test that proves it. **Read it before writing a feature module** — most of what looks like
a decision has already been made there.

The ones that cause the worst damage when broken:

- `safetyStock ≤ min ≤ max`, for one consistent set of inputs. Call `computeThresholds()`.
- A proposed quantity is always a whole multiple of VPE, rounded **up**.
- Thresholds round **up**, or the safety margin erodes silently.
- Stock exactly at Min is **CRITICAL**, not WARNING — the margin is fully consumed.
- Coverage is `null` for an unconsumed article, never `Infinity` and never `0`; and it sorts
  last in **both** directions.
- The consumption average divides by the window length, never by the days that had movements.
- `currentStock` never changes without a `StockMovement` in the same transaction.
- A status never changes without a `RequestStatusHistory` row in the same transaction.
- Site scoping is never a client-supplied filter, and a lookup by id is re-checked on the row
  that came back — a `WHERE` clause cannot protect a `findUnique`.
- `LATE` is never a status.
- Every tunable number is a row in `ReplenishmentParameter`; `DEFAULT_CLASS_PARAMETERS` is the
  only fallback.

---

## 12. What actually stops you

A rule nobody has watched fail is a comment. This table says what enforces each rule and how
to make it fire — three rules in this file were honour-system until recently, and each was
already being violated.

| Rule                                        | Enforced by                                                 | See it fire                                                   |
| ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Package A may not import package B          | **pnpm** (undeclared dep) + ESLint `no-restricted-imports`  | add `import { db } from "@leoni/db"` to a service             |
| Router ⇸ repository, service ⇸ trpc, …      | ESLint `api.js`, per-file-suffix                            | import a `*.repository` from a `*.router.ts`                  |
| `@leoni/core` imports nothing               | ESLint `domain.js`                                          | import Zod into `packages/core`                               |
| Domain never reads the clock                | ESLint `domain.js` (`Date.now`, argless `new Date()`)       | call `Date.now()` in a formula                                |
| `as` outside `as const` / `as unknown`      | ESLint `no-restricted-syntax`                               | `const x = y as string`                                       |
| `process.env` outside `@leoni/env`          | ESLint `no-restricted-syntax`                               | `process.env["FOO"]` in `apps/web`                            |
| `any`, `!`, `enum`, `export *`, default exp | ESLint + `tsconfig`                                         | any of them, anywhere                                         |
| `import { type X }`                         | `@typescript-eslint/no-import-type-side-effects`            | use the inline form                                           |
| ≤ 60 lines, ≤ 4 params                      | ESLint `max-lines-per-function`, `max-params`               | add a fifth parameter                                         |
| Raw hex / Tailwind arbitrary values         | ESLint `react.js`, `next.js`                                | `bg-[#0056A4]` in a component                                 |
| Prisma enum ⇄ `@leoni/core` union           | `packages/db/src/enum-parity.test.ts` (**both directions**) | add a value, or a whole enum, to the schema only              |
| Transition roles ⇄ permission matrix        | `packages/core/src/workflow/transitions.test.ts`            | add a role to `allowedRoles` that lacks the permission        |
| Every action has a French label             | the compiler (`TransitionAction` types the label map)       | add a transition action without wording it                    |
| Class defaults ⇄ Prisma column defaults     | `packages/db/src/parameter-parity.test.ts`                  | change a `@default` to a value no class uses                  |
| Domain coverage ≥ 95%                       | `vitest --coverage`, wired into `pnpm test`                 | add an untested exported function to `@leoni/core`            |
| Service coverage ≥ 85%                      | `vitest --coverage` in `@leoni/api`                         | add an untested branch to a service                           |
| **Everything above, per edit**              | `.claude/hooks/eslint-file.sh` via `PostToolUse`            | edit any `.ts` with a violation — it reports in the same turn |

Convention only — nothing enforces these, so they are on you:

- comments explain _why_, never _what_;
- French for user-visible strings (the label maps are typed, but a hardcoded string in JSX is
  invisible to lint);
- naming (`PascalCase` / `camelCase` / `SCREAMING_SNAKE` / `kebab-case`);
- one responsibility per file.

**The hook is not a merge gate.** It constrains Claude Code, not a human with a terminal, and
nothing here stops a violation reaching `origin/main`. A GitHub Actions workflow running
`pnpm typecheck && pnpm lint && pnpm test` on Node 24 is one file, if that gate is wanted.

Before saying a change is done:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

And if the change touched `prisma/schema/`, also:

```bash
pnpm db:check
```

---

## 13. Further reading

| Document                                         | What it answers                               |
| ------------------------------------------------ | --------------------------------------------- |
| [docs/business-rules.md](docs/business-rules.md) | The invariants, and the test that proves each |
| [docs/architecture.md](docs/architecture.md)     | Why the layers exist and how a request flows  |
| [docs/domain.md](docs/domain.md)                 | The formulas, the workflow, the glossary      |
| [docs/conventions.md](docs/conventions.md)       | The rules above, with the reasoning           |
| [docs/design-system.md](docs/design-system.md)   | Tokens, when to add a primitive vs a pattern  |
| [docs/adr/](docs/adr/)                           | One short record per locked decision          |
