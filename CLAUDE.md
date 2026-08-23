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
<feature>.service.ts     business rules · calls @leoni/core · owns the transaction
       ▼
<feature>.repository.ts  the ONLY place Prisma appears
       ▼
<feature>.mapper.ts      Prisma row ⇄ DTO (Decimal → number happens here)
```

`packages/api/src/modules/article/` is the complete reference. **Copy it.** Do not invent a
different arrangement for the next module.

- A router that contains an `if` about business state is a bug — move it to the service.
- A service that mentions `db.` is a bug — move it to the repository.
- Every write that changes a request's status **must** write `RequestStatusHistory` in the
  same transaction. Not optionally. That trail is the point of the project.

---

## 4. TypeScript rules

Enforced by `packages/tooling/tsconfig` and `packages/tooling/eslint-config`:

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `verbatimModuleSyntax`.
- **`any` is banned.** Use `unknown` and narrow.
- **`!` (non-null) is banned** outside tests. Write a helper that throws with a real message.
- **`as` is banned** except `as const`. Use `satisfies`.
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
  the brief (§3.4), not a preference.
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
  test in `packages/db/src/enum-parity.test.ts` will fail the build otherwise — on purpose.
- **`prisma migrate dev` needs a TTY.** In a non-interactive shell use
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` and
  then `prisma migrate deploy`.

---

## 10. Further reading

| Document                                       | What it answers                              |
| ---------------------------------------------- | -------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)   | Why the layers exist and how a request flows |
| [docs/domain.md](docs/domain.md)               | The formulas, the workflow, the glossary     |
| [docs/conventions.md](docs/conventions.md)     | The rules above, with the reasoning          |
| [docs/design-system.md](docs/design-system.md) | Tokens, when to add a primitive vs a pattern |
| [docs/adr/](docs/adr/)                         | One short record per locked decision         |
