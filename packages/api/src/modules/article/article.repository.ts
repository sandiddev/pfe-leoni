import type { ArticleListInput } from "@leoni/contracts";
import type { AbcClass } from "@leoni/core";
import { db, Prisma } from "@leoni/db";

import type { AuditEntry } from "../../shared/audit";

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
export async function findParameterForClass(abcClass: AbcClass) {
  return db.replenishmentParameter.findUnique({ where: { abcClass } });
}

export async function findParameterForArticle(articleId: string) {
  return db.replenishmentParameter.findUnique({ where: { articleId } });
}

export interface UpdateArticleData {
  readonly designation: string;
  readonly vpe: number;
  readonly leadTimeDays: number;
  readonly abcClass: AbcClass;
  readonly isActive: boolean;
}

export interface UpdateArticleOptions {
  readonly articleId: string;
  readonly data: UpdateArticleData;
  /** Built by the service. Written in the same transaction as the row. */
  readonly audit: AuditEntry;
}

/**
 * Updates an article and records the change, atomically.
 *
 * The two writes are one transaction rather than two calls because a master
 * data edit with no trail is exactly what this application exists to replace.
 * If the audit insert fails — a constraint, a dropped connection — the article
 * edit must fail with it, or the trail has a hole nobody will notice until
 * someone asks who changed a lead time.
 *
 * Nullable Json columns need Prisma's explicit `DbNull`: passing a bare `null`
 * would be read as "JSON null", a different value in Postgres.
 */
export async function updateWithAudit(options: UpdateArticleOptions): Promise<void> {
  const { articleId, data, audit } = options;

  await db.$transaction([
    db.article.update({ where: { id: articleId }, data }),
    db.auditLog.create({
      data: {
        entity: audit.entity,
        entityId: audit.entityId,
        action: audit.action,
        before: audit.before ?? Prisma.DbNull,
        after: audit.after ?? Prisma.DbNull,
        actorId: audit.actorId,
      },
    }),
  ]);
}

export interface CreateArticleData {
  readonly reference: string;
  readonly designation: string;
  readonly vpe: number;
  readonly leadTimeDays: number;
  readonly abcClass: AbcClass;
}

export interface CreateArticleOptions {
  readonly articleId: string;
  readonly data: CreateArticleData;
  /** One stock row per plant, decided by the service. */
  readonly stockItems: readonly { readonly siteId: string; readonly currentStock: number }[];
  readonly audit: AuditEntry;
}

/**
 * Creates an article, its stock row at every plant, and the audit entry.
 *
 * The stock rows are not optional and not a follow-up call. Every screen in
 * this application reads `StockItem`, not `Article`: the alert board, the
 * catalogue, the request line editor. An article created without them exists
 * in the database and nowhere in the interface, which is a worse outcome than
 * a failed creation because nothing reports it.
 *
 * `currentStock` is written directly rather than through a movement, because
 * an opening balance is not a movement — nothing arrived. The journal starts
 * empty and honest, and the first real entry is the first real event.
 */
export async function createWithAudit(options: CreateArticleOptions): Promise<void> {
  const { articleId, data, stockItems, audit } = options;

  await db.$transaction([
    db.article.create({
      data: {
        id: articleId,
        ...data,
        stockItems: {
          create: stockItems.map((item) => ({
            siteId: item.siteId,
            currentStock: item.currentStock,
          })),
        },
      },
    }),
    db.auditLog.create({
      data: {
        entity: audit.entity,
        entityId: audit.entityId,
        action: audit.action,
        before: audit.before ?? Prisma.DbNull,
        after: audit.after ?? Prisma.DbNull,
        actorId: audit.actorId,
      },
    }),
  ]);
}

/** Guards the unique reference before Postgres does, so the message is French. */
export async function findByReference(reference: string) {
  return db.article.findUnique({ where: { reference }, select: { id: true } });
}

/** Existing references, so an import can tell a create from an update. */
export async function findByReferences(references: readonly string[]) {
  return db.article.findMany({
    where: { reference: { in: [...references] } },
    select: {
      id: true,
      reference: true,
      designation: true,
      vpe: true,
      leadTimeDays: true,
      abcClass: true,
      isActive: true,
    },
  });
}

/** Plants by code, which is how a CSV names them. */
export async function findSitesWithCodes() {
  return db.site.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } });
}

/** Every plant an article must have a stock row at. */
export async function findAllSites() {
  return db.site.findMany({ select: { id: true }, orderBy: { code: "asc" } });
}

/**
 * The master-data fields an update compares against and audits.
 *
 * Selected rather than fetched whole: the service needs five columns to decide
 * whether the thresholds went stale and to record the before-image, and
 * returning `createdAt`/`updatedAt` alongside them would invite them into the
 * audit payload, where a timestamp buries the two numbers that matter.
 */
export async function findRawArticle(articleId: string) {
  return db.article.findUnique({
    where: { id: articleId },
    select: {
      designation: true,
      vpe: true,
      leadTimeDays: true,
      abcClass: true,
      isActive: true,
    },
  });
}

/**
 * The repository as one value, so a service can be handed a different one.
 *
 * The service imports this object rather than the individual functions, which
 * is what lets `article.service.test.ts` pass a plain stub and exercise the
 * business rules — site scoping, pagination, the coverage re-sort — with no
 * Postgres and no fixtures. Before this seam existed the service layer had no
 * tests at all, while the domain layer sat at a 95% coverage gate.
 *
 * The router cannot do the wiring: a `*.router.ts` may not import a
 * `*.repository`, and that rule is worth more than the convenience. So the
 * default lives on the service's parameter and the router stays ignorant.
 */
export const articleRepository = {
  findMany,
  findAllSites,
  findByReference,
  findByReferences,
  findSitesWithCodes,
  createWithAudit,
  findByArticleAndSite,
  findLots,
  findRecentMovements,
  findThresholdHistory,
  findParameterForClass,
  findParameterForArticle,
  findRawArticle,
  updateWithAudit,
};

/**
 * Derived from the implementation rather than hand-written beside it.
 *
 * A parallel interface is a second declaration of the same shape, and the one
 * that drifts is always the one nothing validates. `typeof` cannot drift, and a
 * test stub still gets checked against every signature.
 */
export type ArticleRepository = typeof articleRepository;
