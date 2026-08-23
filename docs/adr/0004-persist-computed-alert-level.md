# 4. The alert level is computed by the domain and persisted

**Status:** accepted · **Date:** 2026-08-22

## Context

The alert board must be filterable and sortable by severity across the whole catalogue. The
level is a function of `currentStock`, `minThreshold` and a configurable ratio:

```
WARNING when currentStock <= minThreshold * (1 + warningMarginRatio)
```

Prisma cannot express a column-to-column comparison with an arithmetic factor in a `WHERE`
clause.

## Decision

Store `StockItem.alertLevel`, always written by `resolveAlertLevel()` from `@leoni/core`, in
the same transaction as the stock or threshold change that caused it. Index
`(siteId, alertLevel)`.

## Consequences

**Good.** Filtering and sorting by severity is an indexed query rather than loading the
catalogue into memory. The domain remains the only thing that decides what a level _means_.

**Cost.** A denormalisation that can drift if someone writes `currentStock` without
recomputing the level. Mitigated by confining stock writes to the repository layer and by
the rule — stated in `CLAUDE.md` and in the schema comment — that the two are always written
together.

**Note.** `StockItem.currentStock` is denormalised for the same reason and with the same
discipline.
