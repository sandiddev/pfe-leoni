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

export type AlertRow = Prisma.StockItemGetPayload<{ select: typeof boardSelection }>;

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

  return { rows, totalCount };
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

export async function findParameterForClass(abcClass: AbcClass) {
  return db.replenishmentParameter.findUnique({ where: { abcClass } });
}

export const alertRepository = {
  findBoard,
  countByLevel,
  findParameterForClass,
};

export type AlertRepository = typeof alertRepository;
