# Demonstration

The click-path for a live walkthrough, in the order a jury will follow it. Every figure
below comes from `pnpm db:seed`, which is deterministic — the same run produces the same
numbers every time.

## Before the room fills up

```bash
pnpm db:migrate && pnpm db:seed
```

Assumes Postgres is already running and `DATABASE_URL` points at it.

```bash
pnpm dev
```

The application is on **http://localhost:4300** (not 3000 — Windows reserves 2851–3506 on
the development machine).

Confirm it works end to end without touching a browser:

```bash
pnpm --filter @leoni/api smoke
```

That script drives the real API against the real database — the workflow, the stock
movements, the CRUD, the permissions. If it prints "All checks passed", nothing in the demo
can fail for a reason nobody has seen.

## Accounts

Password for all five: `Leoni2026!`

| Address                     | Role                     | What they can show                                |
| --------------------------- | ------------------------ | ------------------------------------------------- |
| `magasinier.ltn1@leoni.tn`  | Magasinier LTN1          | Alerts, movements, raising and receiving requests |
| `responsable.ltn1@leoni.tn` | Responsable magasin LTN1 | Approving, transmitting, recalculating thresholds |
| `responsable.ltn4@leoni.tn` | Responsable LTN4         | Preparing, shipping, declaring a shortage         |
| `logistique@leoni.tn`       | Responsable logistique   | Every KPI, both plants, read-only                 |
| `admin@leoni.tn`            | Administrateur           | Articles, sites, shelves, users, audit log        |

Keep two browsers (or one plus a private window) open: half the point of the system is that
five people see different things on the same screen.

## The core loop, in eight minutes

**1. The problem, as a storekeeper sees it** — sign in as `magasinier.ltn1`.

`/alertes` opens on the board sorted by severity then by remaining coverage. Point out that
the _Qte preconisee_ column is not a guess: hover it and the tooltip reads
`Besoin 1 800, soit 4 boite(s) de 500`. That is brief §3.3, computed by `@leoni/core` and
unit-tested against the exact example in the report.

**2. From alert to request in one gesture** — tick two or three critical rows, press
**Creer une demande**. The form arrives prefilled with the proposed quantities. Change one
of them to something that is not a multiple of the pack size, and note after saving that it
was rounded up: a part is ordered in whole boxes, always.

**3. The draft is still yours** — on the request page, the lines are editable and there is a
**Supprimer le brouillon** button. This is deliberate: before submission nothing has entered
the process. Press **Soumettre a validation** and watch both disappear — from here on the
request only moves through the workflow.

**4. Separation of duties** — as `responsable.ltn1`, open the same request. The action bar
now shows _Valider_ and _Refuser_ and nothing else, because the buttons are generated from
the domain transition table for this role and this exact status. Try _Refuser_: it demands a
justification of at least ten characters, and the reason lands in the history.

Press **Valider**. A dialog asks for the quantity per line, prefilled with what was
requested — this is the moment to show that each stage records its *own* figure rather than
rubber-stamping the last one. Type something that is not a multiple of the pack size and the
confirm button refuses: LTN4 picks whole boxes. Approve a smaller quantity than was asked
for, then **Transmettre a LTN4** — which asks for nothing, because transmitting moves no
goods.

**5. The other plant** — as `responsable.ltn4`, the request is in the queue. _Demarrer la
preparation_, _Marquer comme prete_, _Expedier_ — each asking for its own quantity, each
prefilled from the stage before.

Show _Declarer une rupture partielle_: it asks for both a quantity and a reason, which is
exactly what the exception is. Prepare less than was approved and the shortfall stays on the
line for the rest of the walkthrough — the preparation loop re-reads its own column, so
marking the pallet ready afterwards does not quietly restore the approved figure.

**Expedier is the moment to open a second window on `/stock` as LTN4.** A dispatch is one
half of a transfer: it draws the boxes FIFO and takes them off *this* plant's books, with a
`TRANSFER_OUT` in the journal. The toast says how many units left.

**6. Receipt moves stock** — back as `magasinier.ltn1`, **Confirmer la reception**. The toast
says how many units went into stock. Open `/stock`: the entry is in the journal, on a shelf,
with an author and a timestamp. That movement and the status change were written in one
transaction — a receipt cannot exist without the stock it delivered.

The receipt is the *other* half of the transfer, a `TRANSFER_IN`. Between the dispatch and
this moment the goods were on neither plant's books, which is what a lorry in motion actually
means (ADR 0006). Nothing was created and nothing vanished: the two plants together hold what
they held before.

Close the request. The five quantity columns now read across: asked, authorised, prepared,
shipped, received.

## The numbers, for the logistics manager

Sign in as `logistique@leoni.tn` and open `/tableau-de-bord`.

- **Taux de service** — share of requests delivered complete, measured against what was
  _authorised_ rather than what was asked for.
- **Delai reel contre theorique** — the gap the whole project exists to shrink, computed from
  the milestone timestamps the workflow stamps.
- **Evolution du taux de rupture** — ninety days of `StockAlertSnapshot`. Say why the table
  exists: alert levels are recomputed on read, so the present cannot answer a question about
  February.
- **Exporter (CSV)** — the same figures, generated server-side so the export cannot disagree
  with the chart above it.

Note what this role _cannot_ do: no write button anywhere, and `/administration` shows the
audit log but not the user list.

## Master data, for the administrator

Sign in as `admin@leoni.tn`.

- **`/articles`** — sortable columns, a searchable catalogue, **Nouvel article**. Open any
  reference: the detail page has the lots in FIFO order, the movement journal, the threshold
  history as a chart, and — the tab worth pausing on — **Modele de l etude contre modele
  enrichi**, which is the comparison the report is written around.
- **Seuils tab** — give one critical article its own parameters. Explain that the class
  defaults move a whole ABC class and this moves one reference (brief §3.4). Then
  `/parametres` → **Recalculer les seuils**, and show the run report.
- **`/parametres`** — the four tunable numbers per class. Widening the class A safety margin
  is a form submission, not a redeployment. Every edit is in the audit log.
- **`/administration`** — three tabs. Create a user and show that the password appears once
  and is never stored. Try to delete a storage location that holds stock: it refuses and says
  what is on it, rather than failing with a database error.

## If something goes wrong

- **A screen is empty** — check the account's site. A single-site role sees only its own
  plant, by design; `logistique` and `admin` see both.
- **An action is missing** — that is the point. The buttons come from the transition table
  for that role and status. Sign in as the role that owns the step.
- **The database drifted** — `pnpm db:seed` is safe to re-run and resets the demo data.

## What is deliberately not built

Say it before you are asked:

- **A column _mapping_ for the CSV import** (§6.1) — the import itself is built, against a
  column contract this application defines and publishes as a model file. Accepting an
  arbitrary spreadsheet and mapping its headers is what is not built: guessing at somebody
  else's column names is how `delai` silently lands in `vpe`. A source export is mapped onto
  the model once, by hand, outside the application.
- **E-mail notifications** — no mail server is guaranteed on the LEONI network (§6.2), so the
  in-app centre is the delivery mechanism.
- **`LATE` as a status** (ADR 0003) — a request can be late while it is still in preparation.
  Storing it would overwrite where the request actually is, so it is derived and shown beside
  the status. The nightly job _notifies_ about lateness, which writes no status and stamps no
  row: an always-correct indicator is of no use to somebody who does not open the screen.
- **Sign-in rate limiting** — a deliberate scope decision, on the one unauthenticated
  endpoint. Say so rather than being asked.
- **Browser and component tests** — the workflow is covered end to end by `smoke.ts` against a
  real database, which cannot see whether a button sends the right payload. That gap is
  recorded rather than papered over.
