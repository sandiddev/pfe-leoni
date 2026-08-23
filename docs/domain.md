# Domaine métier — réapprovisionnement LTN1 / LTN4

This document is the bridge between the logistics study and the code. Every formula
implemented in `packages/core` is traceable to a section here, and every section here is
traceable to the project brief.

---

## 1. Glossaire FR / EN

The interface is French and the code is English. This table is the mapping; use it in the
report and in `packages/contracts/src/labels/fr.ts` alike.

| Français                  | Code / identifier         | Meaning                                          |
| ------------------------- | ------------------------- | ------------------------------------------------ |
| Réapprovisionnement       | `replenishment`           | Transfer of stock LTN4 → LTN1                    |
| Seuil mini                | `minThreshold`            | Reorder point; at or below it, a need is raised  |
| Seuil maxi                | `maxThreshold`            | Target level after replenishment                 |
| Stock de sécurité         | `safetyStock`             | Buffer against consumption variability           |
| Couverture                | `coverageDays`            | Days of production the stock represents          |
| VPE / EUP                 | `vpe`                     | Units per box; orders are multiples of it        |
| FIFO                      | `fifoDate`                | Entry date driving picking order                 |
| Rupture                   | `RUPTURE`                 | Stock exhausted                                  |
| Délai de livraison        | `leadTimeDays`            | Days LTN4 needs to prepare and deliver           |
| Consommation moyenne/jour | `averageDailyConsumption` | Rolling mean over the averaging window           |
| Quantité préconisée       | `recommendedQuantity`     | What the storekeeper is proposed to request      |
| Classe ABC                | `abcClass`                | A high rotation, B medium, C low                 |
| Taux de service           | service level             | Share of requests delivered complete and on time |

---

## 2. Consommation moyenne

**Assumption (stated).** Consumption is expressed **per day** and computed as a rolling
average over a configurable window — 30 days by default, with 7 and 90 offered.

```
consommation moyenne/jour = Σ(sorties dans la fenêtre) / longueur de la fenêtre
```

The denominator is the **window length**, not the number of days that happened to have a
movement. Dividing by active days only would overstate demand for an article consumed once
a fortnight, and every threshold downstream would inherit that overstatement.

→ `packages/core/src/replenishment/consumption.ts`

---

## 3. Seuils Min / Max

### 3.1 Modèle initial de l'étude logistique

```
Min = Consommation moyenne × Délai de livraison
Max = Min + Stock de sécurité
```

Implemented, unchanged, in `legacy-thresholds.ts`. It is **not** used to drive the
application; it exists so the comparison below can be made with real numbers.

### 3.2 Modèle enrichi (celui qui pilote l'application)

```
Stock de sécurité = Consommation moyenne × Jours de sécurité
Min               = Consommation moyenne × (Délai de livraison + Jours de sécurité)
Max               = Min + Consommation moyenne × Jours de couverture supplémentaire
```

**Why this is an enrichment, not a correction.** The study's `Min = consommation × délai`
covers only LTN4's preparation and delivery time. The trigger therefore fires at the exact
moment there is _just_ enough stock to survive a perfectly nominal lead time. Any
variability in consumption during that window — which is precisely what a safety stock
exists to absorb — eats directly into production.

Moving the safety stock into the **trigger** means the minimum covers the delay _plus_ a
margin. The maximum then becomes an explicit post-replenishment coverage target rather than
an incidental ceiling.

Every input is **data**, read from `ReplenishmentParameter`, never a constant in source: the
logistics team tunes them per ABC class or per article through the Parameters screen,
without a redeployment.

→ `packages/core/src/replenishment/thresholds.ts`

### 3.3 Quantité à commander

```
Besoin            = Max − Stock actuel      (seulement si Stock actuel ≤ Min)
Nombre de boîtes  = ⌈ Besoin / VPE ⌉
Quantité préconisée = Nombre de boîtes × VPE
```

Rounding **up** to a whole box is not cosmetic: LTN4 picks and ships full boxes, so asking
for 1 800 units of an article packed 500 to a box is a request nobody can fulfil exactly.
Rounding up rather than down keeps the delivered quantity at or above the need, which is the
safe direction when the cost of being wrong is a stopped production line.

**Exemple de référence** (reproduced verbatim as a unit test):

| Donnée                    | Valeur                        |
| ------------------------- | ----------------------------- |
| Consommation moyenne      | 500 unités/jour               |
| Délai de livraison        | 2 jours                       |
| Stock de sécurité         | 500 unités (1 jour)           |
| Couverture supplémentaire | 3 jours                       |
| **Min**                   | (500 × 2) + 500 = **1 500**   |
| **Max**                   | 1 500 + (500 × 3) = **3 000** |
| Stock actuel              | 1 200                         |
| Besoin                    | 1 800                         |
| Nombre de boîtes          | ⌈1 800 / 500⌉ = 4             |
| **Quantité préconisée**   | **2 000**                     |

→ `packages/core/src/replenishment/order-quantity.ts`
→ Test: `thresholds.test.ts`, `order-quantity.test.ts`, `stock-assessment.test.ts`

### 3.4 Paramètres par défaut par classe ABC

| Classe | Rotation | Stock de sécurité | Couverture supplémentaire |
| ------ | -------- | ----------------- | ------------------------- |
| A      | Forte    | 2 jours           | 3 jours                   |
| B      | Moyenne  | 1,5 jour          | 5 jours                   |
| C      | Faible   | 1 jour            | 10 jours                  |

Stored in `ReplenishmentParameter`, editable from the Parameters screen. An article-level
row overrides its class defaults.

### 3.5 Recalcul et traçabilité

Thresholds are recomputed by a scheduled daily job and by a manual "Recalculer" action.
**Every recomputation writes a `ThresholdHistory` row** carrying the computed values and a
JSON snapshot of the parameters in force at that moment.

The snapshot is stored rather than referenced on purpose: the parameter row it came from
will itself be edited, and a foreign key would make the history lie the moment someone
changes a default.

---

## 4. Niveaux d'alerte

| Niveau     | Condition                   | Libellé  |
| ---------- | --------------------------- | -------- |
| `RUPTURE`  | `stock ≤ 0`                 | Rupture  |
| `CRITICAL` | `stock ≤ Min`               | Critique |
| `WARNING`  | `stock ≤ Min × (1 + marge)` | Alerte   |
| `NORMAL`   | sinon                       | Normal   |

**Assumption (stated).** The brief defines Critique and Rupture but leaves the early-warning
band open. The default margin is **0,2** (20 % above the reorder point): roughly a fifth of
a lead time of notice, enough to batch the article into an existing request rather than
raise an urgent one. It is a parameter (`warningMarginRatio`), not a constant.

The level is **computed by the domain** and **persisted** on `StockItem`. It is derived data
stored deliberately: Postgres cannot be asked through Prisma to compare
`currentStock ≤ minThreshold × 1.2` in a `WHERE` clause, and the alert board must be
filterable and sortable by severity with an index rather than by loading the whole catalogue
into memory. It is always written in the same transaction as the change that caused it.

→ `packages/core/src/replenishment/alert-level.ts`

---

## 5. Classification ABC

Articles are ranked by descending consumption value; the first accounting for 80 % of the
total are class A, the next 15 % class B, the remainder class C. The boundary article
belongs to the class it _completes_ — it is part of what makes up that 80 %.

Ties break on `articleId` so the result is stable between runs: a classification that
reshuffles on every recalculation would make the threshold history impossible to interpret.

**Note on precision.** The comparison uses a tolerance of `1e-9`. Binary floating point
cannot represent these shares exactly — `0.8 + 0.15` evaluates to `0.9500000000000001` — so
an article whose cumulative share is exactly 0,95 would otherwise test as _below_ the class
B limit and be misclassified. This was a real defect caught by the unit tests.

→ `packages/core/src/replenishment/abc-class.ts`

---

## 6. Cycle de vie d'une demande

```
DRAFT → PENDING_APPROVAL → APPROVED → SENT_TO_LTN4 → IN_PREPARATION
      → READY → SHIPPED → IN_TRANSIT → RECEIVED → CLOSED
```

États d'exception : `PARTIALLY_AVAILABLE`, `LTN4_STOCK_OUT`, `REJECTED`, `CANCELLED`.

**Assumption (stated) — "Late" is deliberately not a status.** The brief lists it among the
exception states, but lateness is _orthogonal_ to workflow position: a request can be late
while still in preparation, or late while in transit. Encoding it as a status would
overwrite the real state and lose the information about where the request actually is. It is
therefore **derived** (`isLate`, `daysLate`, from `expectedDeliveryAt`) and displayed as an
indicator alongside the status.

Consequences: the indicator is always correct without a background job sweeping and
re-stamping rows, and a request that becomes late keeps showing where it is.

→ `packages/core/src/workflow/lateness.ts`

### Table des transitions

`TRANSITIONS` in `packages/core/src/workflow/transitions.ts` is the **single source of
truth**, consulted twice per state change:

1. on the server, to authorise the transition;
2. in the UI, to decide which action buttons to render.

Deriving both from the same data is why a storekeeper never sees a button the server will
refuse, and why adding a state to the process is a change to one file rather than a hunt
through components.

Transitions marked `requiresReason` (rejection, cancellation, declared shortage) refuse to
proceed without a justification — an unexplained refusal is exactly the opacity this project
exists to remove.

---

## 7. Acteurs et périmètre

| Rôle                     | Périmètre                                                      |
| ------------------------ | -------------------------------------------------------------- |
| Administrateur           | Tout, les deux sites. Seul à modifier les données de référence |
| Magasinier LTN1          | LTN1 : mouvements, création de demandes, réception             |
| Responsable magasin LTN1 | LTN1 : validation, transmission à LTN4, annulation             |
| Responsable LTN4         | LTN4 : préparation, expédition, déclaration de rupture         |
| Responsable logistique   | Les deux sites, **lecture seule** : tableaux de bord, exports  |

**Assumptions (stated):** a user belongs to exactly one site; Administrateur and Responsable
logistique span both. Approval by the Responsable magasin LTN1 is mandatory before
transmission to LTN4. Receipt is confirmed by the Magasinier LTN1.

Site scoping is applied server-side on every query (`resolveSiteFilter`) and re-checked on
every record fetched by id (`assertCanAccessSite`) — a filter cannot protect a lookup by
identifier.

→ `packages/core/src/access/`

---

## 8. Hypothèses à défendre

Collected here for the report. Each is implemented as stated and configurable where relevant.

1. Consumption is per-day, rolling over a configurable window (default 30 d; 7/30/90).
2. VPE is units per box; every ordered quantity is a multiple of it.
3. ABC class comes from master data but is recomputable by Pareto 80/15/5.
4. One user ↔ one site; Administrateur and Responsable logistique are cross-site.
5. Approval is mandatory before transmission to LTN4.
6. `WARNING` triggers at `Min × (1 + 0,2)` — configurable per class.
7. Physical quantities are integers; consumption and thresholds are decimals, rounded up at
   the threshold boundary so the safety margin is never eroded by rounding.
8. The enriched formulas are an **enrichment** of the logistics study; the original formulas
   remain implemented for side-by-side comparison.
9. Lateness is a derived indicator, not a workflow state (§6).
