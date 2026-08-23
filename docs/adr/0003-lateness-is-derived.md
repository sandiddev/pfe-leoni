# 3. Lateness is a derived indicator, not a workflow status

**Status:** accepted · **Date:** 2026-08-22
**Deviates from the brief — deliberately, and stated as an assumption.**

## Context

The brief (§5) lists "Late" among the exception states of the request lifecycle, alongside
Rejected, Cancelled, Partially available and LTN4 stock-out.

## Decision

`LATE` is **not** a `RequestStatus`. Lateness is computed from `expectedDeliveryAt` against
the current date (or the actual `receivedAt`), exposed as `isLate` / `daysLate`, and
rendered as an indicator next to the status.

## Rationale

Lateness is _orthogonal_ to workflow position. A request can be late while still in
preparation, or late while in transit. Making it a status would overwrite the real state and
lose the information about where the request actually is — which is precisely the visibility
the project exists to provide.

The other four exception states are genuinely different: each is a decision someone took,
recorded with an author and a reason.

## Consequences

**Good.** The indicator is always correct without a nightly job sweeping and re-stamping
rows. A request that becomes late keeps showing its real position. The on-time-delivery KPI
measures the delivery rather than the reporting date, because lateness is measured against
the actual arrival once the goods are in.

**Cost.** A reviewer comparing the code to the brief will not find a `LATE` enum value. The
deviation is documented here, in `request-status.ts`, and in `docs/domain.md` §6 so it can
be defended rather than discovered.
