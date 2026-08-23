import type { ArticleListInput } from "@leoni/contracts";
import { db, type Prisma } from "@leoni/db";

/**
 * Persistence for the article module.
 *
 * This is the only file in the feature allowed to mention Prisma. Everything
 * above it — the service, the router — deals in plain values, which is what
 * makes the business rules testable without a database and keeps the SQL in one
 * reviewable place.
 *
 * Nothing here makes a decision. A repository answers questions and records
 * facts; whether a user is *allowed* to ask, and what the answer *means*, are
 * the service's concern.
 */

/** Everything a list row needs, fetched in one query. */
const listSelection = {
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
    },
  },
} satisfies Prisma.StockItemSelect;

export type StockItemRow = Prisma.StockItemGetPayload<{ select: typeof listSelection }>;

interface FindManyOptions {
  readonly input: ArticleListInput;
  /** Already resolved by the site-scoping middleware. `null` means all plants. */
  readonly siteId: string | null;
}

/**
 * Builds the WHERE clause.
 *
 * Split out from the query so that the list and its total count are guaranteed
 * to filter identically — a count that disagrees with the rows it is counting
 * is a pagination bug that only appears at the last page.
 */
function buildWhere(options: FindManyOptions): Prisma.StockItemWhereInput {
  const { input, siteId } = options;

  const where: Prisma.StockItemWhereInput = {
    article: {
      ...(input.includeInactive ? {} : { isActive: true }),
      ...(input.abcClass === undefined ? {} : { abcClass: input.abcClass }),
      ...(input.search === undefined || input.search === ""
        ? {}
        : {
            OR: [
              { reference: { contains: input.search, mode: "insensitive" } },
              { designation: { contains: input.search, mode: "insensitive" } },
            ],
          }),
    },
  };

  if (siteId !== null) where.siteId = siteId;
  if (input.alertLevel !== undefined) where.alertLevel = input.alertLevel;

  if (input.storageLocationId !== undefined) {
    where.lots = { some: { storageLocationId: input.storageLocationId } };
  }

  if (input.onlyReplenishable) {
    // "Needs replenishing" is exactly the two levels at or below the reorder
    // point, which is why the level is persisted rather than computed in SQL.
    where.alertLevel = { in: ["CRITICAL", "RUPTURE"] };
  }

  return where;
}

function buildOrderBy(input: ArticleListInput): Prisma.StockItemOrderByWithRelationInput[] {
  const direction = input.sortDirection;

  switch (input.sortBy) {
    case "reference":
      return [{ article: { reference: direction } }];
    case "designation":
      return [{ article: { designation: direction } }];
    case "currentStock":
      return [{ currentStock: direction }];
    case "alertLevel":
      // Postgres orders an enum by its declaration order, which in
      // schema.prisma runs NORMAL -> WARNING -> CRITICAL -> RUPTURE. Descending
      // therefore puts the most severe first, which is what the board wants.
      return [{ alertLevel: direction }, { article: { reference: "asc" } }];
    case "coverageDays":
      // Coverage is stock divided by consumption and is not a column. Sorting
      // by stock is the closest stable proxy the database can offer; the
      // service re-sorts the page precisely once the values are computed.
      return [{ currentStock: direction }];
  }
}

export async function findMany(options: FindManyOptions): Promise<{
  rows: StockItemRow[];
  totalCount: number;
}> {
  const where = buildWhere(options);
  const { input } = options;

  // One round trip rather than two sequential ones: the count is needed on
  // every page render and the list is the slowest query on the busiest screen.
  const [rows, totalCount] = await db.$transaction([
    db.stockItem.findMany({
      where,
      select: listSelection,
      orderBy: buildOrderBy(input),
      // One extra row is fetched purely to discover whether another page
      // exists, without a second count query.
      take: input.limit + 1,
      ...(input.cursor === undefined || input.cursor === null
        ? {}
        : { cursor: { id: input.cursor }, skip: 1 }),
    }),
    db.stockItem.count({ where }),
  ]);

  return { rows, totalCount };
}

export async function findByArticleAndSite(
  articleId: string,
  siteId: string | null,
): Promise<StockItemRow | null> {
  return db.stockItem.findFirst({
    where: { articleId, ...(siteId === null ? {} : { siteId }) },
    select: listSelection,
    // Without a site filter a cross-site role gets a deterministic plant rather
    // than whichever row the planner happens to return first.
    orderBy: { site: { code: "asc" } },
  });
}

export async function findLots(stockItemId: string) {
  return db.stockLot.findMany({
    where: { stockItemId, quantity: { gt: 0 } },
    select: {
      id: true,
      quantity: true,
      fifoDate: true,
      storageLocation: { select: { code: true } },
    },
    // FIFO: oldest entry first, which is the picking order the brief requires.
    orderBy: { fifoDate: "asc" },
  });
}

export async function findRecentMovements(stockItemId: string, limit: number) {
  return db.stockMovement.findMany({
    where: { stockItemId },
    select: {
      id: true,
      type: true,
      quantity: true,
      occurredAt: true,
      reference: true,
      user: { select: { name: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}

export async function findThresholdHistory(stockItemId: string, limit: number) {
  return db.thresholdHistory.findMany({
    where: { stockItemId },
    select: {
      computedAt: true,
      averageDailyConsumption: true,
      minThreshold: true,
      maxThreshold: true,
      safetyStock: true,
      trigger: true,
    },
    orderBy: { computedAt: "desc" },
    take: limit,
  });
}

/** The parameters in force for a class, used to recompute a suggestion. */
export async function findParameterForClass(abcClass: "A" | "B" | "C") {
  return db.replenishmentParameter.findUnique({ where: { abcClass } });
}

export async function findParameterForArticle(articleId: string) {
  return db.replenishmentParameter.findUnique({ where: { articleId } });
}

export interface UpdateArticleData {
  readonly designation: string;
  readonly vpe: number;
  readonly leadTimeDays: number;
  readonly abcClass: "A" | "B" | "C";
  readonly isActive: boolean;
}

export async function update(articleId: string, data: UpdateArticleData) {
  return db.article.update({ where: { id: articleId }, data });
}

export async function findRawArticle(articleId: string) {
  return db.article.findUnique({ where: { id: articleId } });
}
