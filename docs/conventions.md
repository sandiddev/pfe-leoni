# Conventions

The rules are enforced by `pnpm lint` and `pnpm typecheck`. This document exists to record
_why_ each one is there, so that a future reader can tell a deliberate constraint from an
arbitrary one — and knows which are safe to change.

`CLAUDE.md` is the short version. This is the reasoning.

---

## TypeScript

### Compiler flags

Set in `packages/tooling/tsconfig/base.json`.

| Flag                                                                            | Why                                                                                                                    |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `strict`                                                                        | Baseline.                                                                                                              |
| `noUncheckedIndexedAccess`                                                      | `array[i]` is `T \| undefined`. Most real crashes in a data-heavy app are an index that was not there.                 |
| `exactOptionalPropertyTypes`                                                    | `{ a?: string }` and `{ a: string \| undefined }` stop being confused. This caught two genuine bugs while wiring tRPC. |
| `noPropertyAccessFromIndexSignature`                                            | Forces `process.env["X"]`, making every environment read visibly a lookup that can fail.                               |
| `verbatimModuleSyntax`                                                          | Imports are emitted as written — which makes the `import type` rule below matter.                                      |
| `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals/Parameters` | Cheap, catch real slips. `noUnusedLocals` is what revealed that LTN4 had no FIFO lots in the seed.                     |

### `import type { X }`, never `import { type X }`

Not a style preference. With `verbatimModuleSyntax`, an import whose specifiers are _all_
inline-type still emits:

```js
import {} from "./server"; // a side-effect import — the module still loads
```

`packages/auth/src/client.ts` imported only a type from `./server` in the inline form. The
browser bundle therefore pulled the better-auth server config, and through it Prisma. The
symptom was an opaque Turbopack failure (`build-manifest.json` ENOENT) that cost real time.

`import type { X }` is erased completely. `@typescript-eslint/no-import-type-side-effects`
is on to catch the rest.

### Banned constructs

| Banned                   | Instead                              | Why                                                                                                                                                                        |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `any`                    | `unknown` + narrowing                | `any` disables checking silently and spreads.                                                                                                                              |
| `!` (non-null)           | a helper that throws with a message  | `required(value, "the LTN1 storekeeper")` tells you what was missing at 2 a.m.; `!` tells you nothing. Allowed in tests.                                                   |
| `as` (except `as const`) | `satisfies`                          | A cast is a claim the compiler cannot verify. The one sanctioned exception is `toBrandedId`, documented in place.                                                          |
| `enum`                   | `const` array + `(typeof X)[number]` | TS enums have surprising runtime semantics and do not tree-shake. The `ROLES` pattern in `core` gives the union _and_ an iterable list. Prisma 7 generates the same shape. |
| default exports          | named exports                        | A default can be renamed at every import site, which defeats grep and rename-refactors. Next.js pages, layouts and `proxy.ts` are exempt — the framework requires them.    |
| `export *`               | explicit re-exports                  | A barrel hides a package's public surface. `packages/core/src/index.ts` doubles as its API documentation because of this.                                                  |

### Errors

Services throw `DomainError` subclasses from `@leoni/core`:

```
DomainError
├── BusinessRuleError        an invariant the user could have satisfied
├── InvalidInputError        a value the domain cannot interpret
├── TransitionNotAllowedError a state change the workflow forbids
└── ForbiddenActionError     the role lacks the permission
```

The tRPC `errorFormatter` is the **only** place that maps them to HTTP codes. The domain does
not know what HTTP is, so the same violation surfaces identically whether it was raised by a
tRPC call, the nightly job, or a unit test.

Anything that is not a recognised domain error becomes `INTERNAL_SERVER_ERROR` with its
message withheld — deliberately, so a Prisma constraint name or a connection string never
reaches a browser.

Never `throw new Error("string")` for a business rule.

---

## Clean code

- **One responsibility per file; the file name is its export.**
- **Functions ≤ ~40 lines, ≤ 4 parameters.** Beyond four, take a parameter object — every
  domain function does (`computeThresholds({ ... })`), which also makes call sites readable
  without checking the signature.
- **No magic numbers.** Anything the logistics team might tune lives in
  `ReplenishmentParameter` in the database. This is a hard requirement of the brief (§3.4):
  changing the safety margin for class A must be a form submission, not a redeployment.
- **Comments explain _why_, never _what_.** If a line needs a comment to say what it does,
  rename something instead. The comments worth writing are the ones recording a decision:
  why coverage returns `null` and not `Infinity`, why the ABC comparison needs an epsilon.

### Naming

| Kind              | Convention             | Example                              |
| ----------------- | ---------------------- | ------------------------------------ |
| Types, components | `PascalCase`           | `ArticleListItem`, `AlertLevelBadge` |
| Values, functions | `camelCase`            | `computeThresholds`                  |
| Constants         | `SCREAMING_SNAKE`      | `REQUEST_STATUSES`                   |
| Files             | `kebab-case`           | `alert-level.ts`                     |
| API modules       | `<feature>.<layer>.ts` | `article.service.ts`                 |
| Permissions       | `entity:verb`          | `request:approve`                    |

---

## The API layer

Covered in [architecture.md](architecture.md); the rules that lint enforces:

- a **router** may not import a repository, a mapper, or `@leoni/db`;
- a **service** may not import a router or `trpc.ts` — it throws domain errors instead;
- a **repository** may not import a service or a router;
- a **mapper** depends on nothing local;
- nothing in the package may import `react`, `next` or `@leoni/ui`.

Each rule has an explanatory message. To see them fire, add `import { db } from "@leoni/db"`
to a service and run `pnpm lint`.

**The transaction rule.** Every write that changes a request's status writes
`RequestStatusHistory` in the same transaction. Not conditionally, not "usually". The audit
trail is the deliverable.

---

## Validation

A Zod schema is the single source of truth for a shape. Derive the type with `z.infer`;
never hand-write a parallel interface. Two declarations of the same shape drift, and the one
that drifts is the one that is not validated at runtime.

Input validation lives in `@leoni/contracts` so the router and any future client share it.

**A filter is not an authorisation.** `articleListInputSchema` accepts `siteId`, but the
service intersects it with what the actor may actually see. Validation says the request is
_well-formed_; it never says the request is _allowed_.

---

## Tests

- **`@leoni/core` carries the strictest gate**: 95 % statements/lines/functions, 90 %
  branches. It is the part a bug in would silently mis-order stock, and the part the jury
  will read.
- The reference example from brief §3.3 is asserted **verbatim** in `thresholds.test.ts` and
  `stock-assessment.test.ts`. If those fail, the application no longer implements the model
  the report defends.
- Tests name the behaviour, not the function: _"triggers exactly at the reorder point, not
  one unit below"_, not _"computeOrderQuantity works"_.
- `enum-parity.test.ts` in `@leoni/db` asserts the Prisma enums and the `@leoni/core` unions
  are identical. Neither can import the other, so this test _is_ the contract between them.

---

## Language

**Interface French, code English** (brief §6.2).

Enum labels come from `packages/contracts/src/labels/fr.ts` — typed as
`Record<Union, string>`, so adding a status to the domain without translating it fails the
build. A French string inline in a component is a defect: the same term must read
identically on screen, in the CSV export and in the PDF report, and three inline copies
drift while one map does not.

The vocabulary is the logistics team's, not a developer's: _réapprovisionnement, seuil
mini/maxi, stock de sécurité, couverture, VPE, FIFO, rupture_. Keeping it in one reviewable
file lets them correct terminology without touching a component.

---

## Dependencies

Third-party versions live in `pnpm-workspace.yaml` under `catalog:`. Packages reference
`"catalog:"`, never a literal range — a dependency can only be upgraded in one place.

`allowBuilds` in the same file lists the packages permitted to run install scripts. Native
post-install scripts are denied by default; each entry is a reviewed decision with a comment
saying what breaks without it.
