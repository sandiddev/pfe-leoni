import type { AlertBoardInput } from "@leoni/contracts";
import type { AbcClass, AlertLevel } from "@leoni/core";
import type { Prisma } from "@leoni/db";
import { db } from "@leoni/db";

/**
 * Persistence for the alert board.
 *
 * `StockItem.alertLevel` is a persisted, indexed column — computed by the
 * domain and written in the same transaction as the stock or threshold change
 * that caused it (ADR 0004). That is what lets this file filter and order by
 * severity in Postgres instead of loading the catalogue into memory to sort it.
 */

const boardSelection = {
  id: true,
  currentStock: true,
  averageDailyConsumption: true,
  minThreshold: true,
  maxThreshold: true,
  safetyStock: true,
  alertLevel: true,
  lastRecalculatedAt: true,
  site: { select: { id: true, code: true } },
  article: {
    select: {
      id: true,
      reference: true,
      designation: true,
      abcClass: true,
      unit: true,
      vpe: true,
      leadTimeDays: true,
      isActive: true,
      // The article's own parameters, if somebody overrode them. Selected with
      // the row rather than fetched per article: this list is up to a hundred
      // rows and a lookup each would be a hundred round trips.
      parameter: {
        select: {
          safetyDays: true,
          extraCoverageDays: true,
          averagingWindowDays: true,
          warningMarginRatio: true,
        },
      },
    },
  },
} satisfies Prisma.StockItemSelect;

type BoardRow = Prisma.StockItemGetPayload<{ select: typeof boardSelection }>;

/** The override, once `Decimal` is gone. */
interface PlainParameter {
  readonly safetyDays: number;
  readonly extraCoverageDays: number;
  readonly averagingWindowDays: number;
  readonly warningMarginRatio: number;
}

/**
 * Spelled out rather than inferred.
 *
 * TypeScript cannot *name* the inferred shape without reaching into the
 * generated Prisma enums directory, which is exactly the reach `@leoni/db`'s
 * barrel exists to prevent. Declaring the type is cheaper than importing a
 * symbol only to satisfy the inference.
 */
type PlainBoardRow = Omit<BoardRow, "article"> & {
  readonly article: Omit<BoardRow["article"], "parameter"> & {
    readonly parameter: PlainParameter | null;
  };
};

/**
 * The article-level parameter override, with `Decimal` already unwrapped.
 *
 * The row's own thresholds stay as they come and are converted by the mapper on
 * the way to the DTO — that is the mapper's job. This one is different: the
 * override is consumed by the *service*, which hands it to `@leoni/core`, and a
 * service that unwraps a `Decimal` knows a persistence detail it is not
 * supposed to (CLAUDE.md section 3, and the header of `stock.prisma`).
 */
function withPlainParameters(row: BoardRow): PlainBoardRow {
  const override = row.article.parameter;

  return {
    ...row,
    article: {
      ...row.article,
      parameter:
        override === null
          ? null
          : {
              safetyDays: override.safetyDays.toNumber(),
              extraCoverageDays: override.extraCoverageDays.toNumber(),
              averagingWindowDays: override.averagingWindowDays,
              warningMarginRatio: override.warningMarginRatio.toNumber(),
            },
    },
  };
}

/**
 * Derived from the implementation rather than declared beside it, for the same
 * reason `AlertRepository` is: a hand-written parallel shape is the one that
 * drifts.
 */
export type AlertRow = PlainBoardRow;

/** The three levels that mean something needs attention. */
const AT_RISK: readonly AlertLevel[] = ["WARNING", "CRITICAL", "RUPTURE"];

interface FindBoardOptions {
  readonly input: AlertBoardInput;
  /** Already resolved by the site-scoping middleware. `null` means all plants. */
  readonly siteId: string | null;
}

function buildWhere(options: FindBoardOptions): Prisma.StockItemWhereInput {
  const { input, siteId } = options;

  const where: Prisma.StockItemWhereInput = {
    article: {
      isActive: true,
      ...(input.abcClass === undefined ? {} : { abcClass: input.abcClass }),
    },
  };

  if (siteId !== null) where.siteId = siteId;

  if (input.level !== undefined) {
    where.alertLevel = input.level;
  } else if (!input.includeNormal) {
    where.alertLevel = { in: [...AT_RISK] };
  }

  return where;
}

export async function findBoard(options: FindBoardOptions): Promise<{
  rows: AlertRow[];
  totalCount: number;
}> {
  const where = buildWhere(options);
  const { input } = options;

  const [rows, totalCount] = await db.$transaction([
    db.stockItem.findMany({
      where,
      select: boardSelection,
      // Postgres orders an enum by declaration order, which in schema.prisma
      // runs NORMAL -> WARNING -> CRITICAL -> RUPTURE, so descending puts the
      // most severe first. The reference breaks ties so the cursor is stable.
      orderBy: [{ alertLevel: "desc" }, { article: { reference: "asc" } }],
      take: input.limit + 1,
      ...(input.cursor === undefined || input.cursor === null
        ? {}
        : { cursor: { id: input.cursor }, skip: 1 }),
    }),
    db.stockItem.count({ where }),
  ]);

  return { rows: rows.map(withPlainParameters), totalCount };
}

/** One grouped count instead of four queries the dashboard used to make. */
export async function countByLevel(
  siteId: string | null,
): Promise<readonly { alertLevel: AlertLevel; count: number }[]> {
  const grouped = await db.stockItem.groupBy({
    by: ["alertLevel"],
    where: { article: { isActive: true }, ...(siteId === null ? {} : { siteId }) },
    _count: { _all: true },
  });

  return grouped.map((group) => ({ alertLevel: group.alertLevel, count: group._count._all }));
}

/** The class parameters in force, as numbers the domain can use directly. */
export async function findParameterForClass(abcClass: AbcClass) {
  const row = await db.replenishmentParameter.findUnique({ where: { abcClass } });

  return row === null
    ? null
    : {
        safetyDays: row.safetyDays.toNumber(),
        extraCoverageDays: row.extraCoverageDays.toNumber(),
        averagingWindowDays: row.averagingWindowDays,
        warningMarginRatio: row.warningMarginRatio.toNumber(),
      };
}

/** Every tracked stock item, with what a daily snapshot has to record. */
export async function findSnapshotSubjects() {
  const rows = await db.stockItem.findMany({
    where: { article: { isActive: true } },
    select: {
      id: true,
      currentStock: true,
      minThreshold: true,
      averageDailyConsumption: true,
      alertLevel: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    minThreshold: row.minThreshold.toNumber(),
    averageDailyConsumption: row.averageDailyConsumption.toNumber(),
  }));
}

/** One day's alert state for one stock item, as the domain computed it. */
export interface AlertSnapshotWrite {
  readonly stockItemId: string;
  readonly level: AlertLevel;
  readonly currentStock: number;
  readonly minThreshold: number;
  readonly coverageDays: number | null;
  readonly snapshotDate: Date;
}

/**
 * Appends one day's snapshots, idempotently.
 *
 * `skipDuplicates` against the `@@unique([stockItemId, snapshotDate])` index is
 * what makes the job safe to retry: the scheduler may fire twice after a
 * network failure, and a KPI that moves when nothing happened is worse than one
 * that is a day stale. The consequence is that the *first* run of a day wins —
 * a second run does not correct the figures — which is the right trade for a
 * daily series read as a trend.
 *
 * Chunked for the same reason the seed is: the pattern has to survive a
 * catalogue ten times this size.
 */
export async function appendAlertSnapshots(writes: readonly AlertSnapshotWrite[]): Promise<number> {
  const CHUNK_SIZE = 1_000;
  let written = 0;

  for (let offset = 0; offset < writes.length; offset += CHUNK_SIZE) {
    const result = await db.stockAlertSnapshot.createMany({
      data: [...writes.slice(offset, offset + CHUNK_SIZE)],
      skipDuplicates: true,
    });
    written += result.count;
  }

  return written;
}

export const alertRepository = {
  findBoard,
  countByLevel,
  findParameterForClass,
  findSnapshotSubjects,
  appendAlertSnapshots,
};

export type AlertRepository = typeof alertRepository;
