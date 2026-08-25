# Business rules

The invariants of the réapprovisionnement process, stated so they can be checked.

Every rule below is implemented today and has a test that fails if it breaks. This file is
the index: it says what the rule is, why it is that way, and where the code and the proof
live. If you are about to write a feature module, read this first — most of what looks like
a decision has already been made here.

`docs/domain.md` explains the formulas and the workflow narratively. This file is the
contract.

---

## 1. Thresholds

### `safetyStock ≤ min ≤ max`, always

```
Safety Stock = Average Daily Consumption × Safety Days
Min          = Average Daily Consumption × (Lead Time + Safety Days)
Max          = Min + Average Daily Consumption × Extra Coverage Days
```

**Where** `packages/core/src/replenishment/thresholds.ts` · **Proof** `thresholds.test.ts`,
`class-parameters.test.ts`

Use `computeThresholds()` rather than the three functions separately. It is the only thing
that guarantees the invariant holds for **one consistent set of inputs** — three calls with
arguments assembled at different moments can silently produce `min > max`.

### Thresholds round up, never down

`roundThreshold(1499.2) === 1500`.

**Where** `packages/core/src/shared/rounding.ts` · **Proof** `shared.test.ts`

A minimum of 1 499.2 units that triggers at 1 499 has had its safety margin quietly eroded
by rounding. Rounding up costs one unit of stock; rounding down costs it out of the margin
that exists precisely to absorb variability.

### Every tunable number is a row, not a constant

**Where** `ReplenishmentParameter` (the table) and `DEFAULT_CLASS_PARAMETERS`
(`packages/core/src/replenishment/class-parameters.ts`) · **Proof**
`packages/db/src/parameter-parity.test.ts`

Brief §3.4 is explicit: changing the safety margin for class A must be a form submission,
not a redeployment. `DEFAULT_CLASS_PARAMETERS` is the **only** place the A/B/C defaults are
written, and it applies only when no row exists.

There used to be four copies of those defaults and they disagreed — the service fell back to
`1 / 10` for every class while the seed wrote `2 / 3` for class A. A class-A article whose
parameter row was missing therefore received class-C thresholds, silently, with numbers that
still looked plausible on screen. If you find yourself writing `?? 1` next to a threshold,
that is this bug coming back.

### The per-class ordering is deliberate

|         | Safety days | Extra coverage days |
| ------- | ----------- | ------------------- |
| Class A | 2           | 3                   |
| Class B | 1.5         | 5                   |
| Class C | 1           | 10                  |

**Proof** `class-parameters.test.ts` asserts A > B > C on safety days and A < B < C on extra
coverage.

A fast-moving class A reference gets the **widest** safety margin (stopping the line over it
is expensive) and the **tightest** restock target (holding weeks of a fast mover ties up floor
space). Class C inverts both: a thin margin is enough, and a large restock quantity is cheap
to hold and saves repeated transfers between the plants. Inverting one of these leaves the
numbers plausible and the reasoning wrong, which is why the ordering is a test.

---

## 2. Order quantities

### A proposed quantity is always a whole multiple of VPE, rounded up

```
Need            = Max − Current Stock      (only when Current Stock ≤ Min)
Number of boxes = ceil(Need / VPE)
Recommended Qty = Number of boxes × VPE
```

**Where** `packages/core/src/replenishment/order-quantity.ts` · **Proof**
`order-quantity.test.ts`, `article.service.test.ts`

LTN4 picks and ships full boxes. Asking for 1 800 units of an article packed 500 to a box is
a request nobody can fulfil exactly. Rounding **up** keeps the delivered quantity at or above
the need, which is the safe direction when the cost of being wrong is a stopped line.

### Nothing is proposed above the reorder point

Even though `Max − Stock` is still positive there.

**Where** `computeOrderQuantity`, the `isReplenishmentNeeded` guard

Proposing an order at every level below Max would bury the real alerts in noise, and an alert
board nobody trusts is the spreadsheet this project replaces.

### The intermediate values are part of the answer

`need`, `boxCount` and `recommendedQuantity` are all returned, because the screen must show
_why_ 2 000 units are proposed — "besoin 1 800, soit 4 boîtes de 500". Recomputing that
explanation in a component would be a second implementation of the same rule.

---

## 3. Alerts

### The bands

```
RUPTURE   stock ≤ 0                      the line is starved now
CRITICAL  stock ≤ min                    replenishment is overdue
WARNING   stock ≤ min × (1 + margin)     approaching the reorder point
NORMAL    otherwise
```

**Where** `packages/core/src/replenishment/alert-level.ts` · **Proof** `alert-level.test.ts`

**The reorder point itself is CRITICAL, not WARNING.** Stock exactly at Min means the safety
margin is fully consumed. An off-by-one here reads as a warning for an article that is already
overdue.

The warning margin (default 0.2) is a stated assumption, not from the brief: it gives the
storekeeper roughly a fifth of a lead time of notice, enough to batch the article into an
existing request rather than raise an urgent one. It is a parameter per ABC class.

### `alertLevel` is stored, and only the domain writes it

**Where** `StockItem.alertLevel` · **ADR** `docs/adr/0004-persist-computed-alert-level.md`

Derived data, deliberately persisted: Postgres cannot be asked through Prisma to compare
`currentStock <= minThreshold * 1.2` in a `WHERE`, and the alert board must be filterable and
sortable by severity on an index rather than by loading the catalogue into memory.

The price of that decision is a rule: the column is written by `resolveAlertLevel`, in the
**same transaction** as the stock or threshold change that caused it. A path that changes
stock without rewriting the level produces a board that disagrees with the numbers beside it.

---

## 4. Consumption and coverage

### The average divides by the window, never by the days that had movements

**Where** `packages/core/src/replenishment/consumption.ts` · **Proof** `consumption.test.ts`

3 000 units consumed once in a 30-day window is 100/day, not 3 000/day. Dividing by active
days would overstate demand tenfold for an article consumed once a fortnight, and every
threshold derived from it inherits the overstatement.

Only outbound movements are consumption. An entry or an inventory adjustment is not demand.

### Coverage is `null` for an article with no consumption — never `Infinity`, never `0`

**Where** `packages/core/src/replenishment/coverage.ts` · **Proof** `coverage.test.ts`,
`article.service.test.ts`

`Infinity` sorts to the top of a best-covered table and formats as a meaningless value on
screen; `0` says "about to run out", which is the opposite of the truth. `null` forces every
call site to decide how to present "this article is not moving".

The consequence is a sorting rule: a null coverage sorts **last in both directions**. Reversing
the array would put the non-moving articles at the top of a descending list, reading as though
they were the best covered.

---

## 5. The request workflow

### The nominal path

```
DRAFT → PENDING_APPROVAL → APPROVED → SENT_TO_LTN4 → IN_PREPARATION
      → READY → SHIPPED → IN_TRANSIT → RECEIVED → CLOSED
```

Exception states: `PARTIALLY_AVAILABLE`, `LTN4_STOCK_OUT`, `REJECTED`, `CANCELLED`.

**Where** `packages/core/src/workflow/transitions.ts` — one table, consulted by both the
server (to authorise) and the UI (to render the action bar). That is why a storekeeper never
sees a button the server will refuse.

### `LATE` is not a status

**Where** `packages/core/src/workflow/lateness.ts` · **ADR**
`docs/adr/0003-lateness-is-derived.md` · **Proof** `lateness.test.ts`, `enum-parity.test.ts`

The brief lists it among the exception states, but lateness is orthogonal to workflow
position: a request can be late while in preparation, or late while in transit. Encoding it as
a status would overwrite the real state and lose the information about where the request
actually is. It is derived from `expectedDeliveryAt`, and the enum parity test asserts that
no `LATE` value exists on either side.

### No status change without its history row, in the same transaction

**Where** `RequestStatusHistory` · **Pattern** `packages/api/src/shared/audit.ts`

Not conditionally, not "usually". The audit trail is the deliverable of this project — it is
what replaces the email thread. A trail with holes is worse than none, because it is trusted.

The service decides which facts to record; the repository guarantees they land atomically. The
service cannot open the transaction itself (it may not import `@leoni/db`), so a repository
method that changes state takes the history row as part of its input. `updateWithAudit` in
`article.repository.ts` is the reference implementation.

### A justification is mandatory where the process owes an explanation

`reject`, `cancel`, `declarePartial`, `declareStockOut`.

**Proof** `transitions.test.ts`

A rejection or an LTN4 shortage that nobody has to explain is exactly the opacity this project
exists to remove.

### No single role can drive a request from draft to closed

No non-`ADMIN` role can perform `submit`, `approve` **and** `transmit`.

**Proof** `transitions.test.ts`

Separation of duties: the storekeeper who raises a request must not be the one who approves it.
`ADMIN` is exempt by design — it is the break-glass role, and the audit trail is what governs
its use.

### Every non-terminal status has a way out

**Proof** `transitions.test.ts`

A status with no transitions that is not `CLOSED`, `REJECTED` or `CANCELLED` is a trap: the
request is stuck and only a database edit moves it.

---

## 6. Stock

### `currentStock` never changes without a `StockMovement` in the same transaction

**Where** `StockItem.currentStock` (denormalised sum of the lots), `StockMovement` (the
immutable journal)

The column is denormalised on purpose — the alert board reads it for every article on every
page load, and recomputing it from the journal each time would not survive a catalogue of any
size. What makes that safe is the rule: the journal and the column move together, or the stock
becomes unexplainable and the consumption average uncomputable.

### FIFO is the picking order

`StockLot.fifoDate` ascending. **Where** `article.repository.ts` `findLots` · **Proof**
`article.service.test.ts`

### Quantities are integers; rates and thresholds are `Decimal(12,3)`

Physical parts come in whole units. `Decimal` never reaches the browser — the mapper converts
it, in one named place, because a threshold that arrives in the UI as
`{ s: 1, e: 3, d: [1500] }` renders as nothing anyone can read.

---

## 7. Authorisation

### Site scoping is never a client-supplied filter

**Where** `packages/api/src/middlewares/site-scope.ts` · **Proof** `article.service.test.ts`

A request may _ask_ for a site; what it receives is the intersection of that ask with what the
actor is allowed to see. `resolveSiteFilter` returns the **effective** site rather than
validating the requested one and passing it through.

A user belongs to exactly one plant. `ADMIN` and `LOGISTICS_MANAGER` span both.

### A lookup by id is re-checked on the row that came back

**Where** `assertCanAccessSite`

A `WHERE` clause cannot protect a `findUnique`. Without the second check an LTN4 user reads an
LTN1 stock item by guessing its identifier — and the article service test asserts exactly that
attack fails.

### A missing record and an invisible one give the same error

`NotFoundError`, same message. Distinguishing them lets a user enumerate the other plant's
catalogue one identifier at a time.

### Anything unrecognised fails closed

An unknown role string, a user with no site, a deactivated account: all resolve to no identity
rather than to a default. **Where** `packages/api/src/context.ts`, `site-scope.ts`

### Procedures declare permissions, not roles

`permissionProcedure("request:approve")`, so "who may approve a request" is one statement in
`@leoni/core/access` instead of a list repeated at five call sites and updated in four of them.

`ACTION_PERMISSIONS` maps each workflow action to its permission, and
`transitions.test.ts` asserts every role in every `allowedRoles` actually holds it. Those two
guards used to be independent, and nothing failed the build when they disagreed.

### `role` and `siteId` are never accepted as input

**Where** `packages/auth/src/server.ts`, `input: false` on both fields

If they were writable from a sign-in payload, a user could grant themselves `ADMIN` by editing
a request body. They are set only through the administration module, which checks `user:write`.

### `isActive` is re-read on every request

**Where** `packages/auth/src/server.ts` — no `cookieCache`

The Administrator disables an account rather than deleting it, so the audit trail keeps a
resolvable author. That must take effect on the next click, not when the cookie expires. A
five-minute session cache is five minutes a dismissed employee keeps recording movements.

---

## 8. Language

Interface in French, code in English (brief §6.2).

Every user-visible string is French, and enum labels come from
`packages/contracts/src/labels/fr.ts` — never inline in a component. `TransitionAction` now
types that label map, so a workflow action without French wording fails to compile.

Vocabulary must match the report: _réapprovisionnement, seuil mini/maxi, stock de sécurité,
couverture, VPE, FIFO, rupture_. See `GLOSSARY_FR`.

---

## 9. Determinism

The domain layer never reads the clock. `now: Date` is always a parameter — enforced by lint
(`no-restricted-properties` on `Date.now`, and a ban on argless `new Date()` in
`@leoni/core`).

A formula that reads the clock cannot be tested against a fixed expectation, and a threshold
history computed by such a formula cannot be reproduced afterwards to explain itself.

ABC classification breaks ties by `articleId` for the same reason: a classification that
reshuffles on every recalculation makes the threshold history impossible to interpret.
