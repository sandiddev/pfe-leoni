# 6. A replenishment debits LTN4 at dispatch and credits LTN1 at receipt

**Status:** accepted · **Date:** 2026-09-01

## Context

A réapprovisionnement is a transfer of stock from LTN4 to LTN1 (`docs/domain.md` §1). A
transfer has two legs, and the workflow has several moments either could be attached to:
preparation, dispatch, or receipt.

Until now only one leg existed. `confirmReceipt` credited the consuming plant with an `ENTRY`
and nothing ever debited the supplying one, so every request created units out of nothing and
LTN4's own alert board was computed from a level that never fell. `TRANSFER_OUT` and
`TRANSFER_IN` were defined in `MOVEMENT_TYPES` and reachable only from the manual movement
dialog.

## Decision

`ship` writes a `TRANSFER_OUT` against the supplying plant, allocated FIFO. `confirmReceipt`
writes a `TRANSFER_IN` against the consuming plant, replacing the `ENTRY` it used to write.

Between the two, the goods are on **neither** plant's books.

## Rationale

Dispatch is the moment the boxes physically leave the shelf, so it is the moment the shelf
should stop claiming them. Waiting for receipt would leave LTN4's stock overstating by
everything currently on a lorry, for as long as a shipment stays open — and LTN4's reorder
decisions are made from exactly that figure.

The in-transit gap is not an accounting hole to be apologised for; it is the true state. The
goods are neither available to pick at LTN4 nor available to consume at LTN1. A model that
kept them on one plant's books would be asserting something false in order to make a total
balance.

Neither leg is an `ENTRY` or an `EXIT`, and that carries weight beyond naming: `isConsumption`
counts only `EXIT`, so a transfer never inflates either plant's rolling demand average, and
therefore never inflates the thresholds computed from it. An inter-plant move is not demand
from a production line.

A reservation at preparation time was considered and rejected. It would stop LTN4 promising
the same box to two requests, which is a real problem — but it needs a reserved-quantity
column, its own invariants, and release-on-cancel handling. That is a larger decision than
this one, and it can be added later without moving these two legs.

## Consequences

**Good.** Total units across the two plants are conserved by a full cycle, which is asserted
in `smoke.ts` rather than assumed. LTN4's alert level now falls when it ships, so the
supplying plant is warned about its own shortages — and a dispatch that would take it below
zero is refused as a `BusinessRuleError` rather than clamped.

**Cost.** A snapshot taken mid-transit shows fewer total units than were ordered, and anybody
reconciling the two plants against a delivery note has to account for what is on the road.
That is a property of the physical process, not of this model, but it will be asked about.

**Cost.** `applyTransition` now writes both directions. The two legs are mapped onto one
`TransferLeg` shape before the transaction so the statement list stays a single block — which
also keeps every `db.<model>.<mutation>` call inline where `audited-writes.test.ts` can see
it.
