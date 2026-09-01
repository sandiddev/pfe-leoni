import type { StockByLocationInput, StockMovementListInput } from "@leoni/contracts";
import type { AlertLevel, MovementType } from "@leoni/core";
import type { Prisma } from "@leoni/db";
import { db } from "@leoni/db";

import { guarded } from "../../shared/conflict";
import type { NotificationWrite } from "../../shared/notification";

/**
 * Persistence for the stock module.
 *
 * The only file in the feature that mentions Prisma, and the only place the
 * invariant "currentStock never changes without a StockMovement in the same
 * transaction" can actually be guaranteed. Everything the service decides —
 * which lots to draw, what the new level and alert level are — arrives here as
 * plain values and is written in one statement list.
 */

const movementSelection = {
  id: true,
  type: true,
  quantity: true,
  occurredAt: true,
  reference: true,
  user: { select: { name: true } },
  lot: { select: { storageLocation: { select: { code: true } } } },
  stockItem: {
    select: {
      site: { select: { code: true } },
      article: { select: { id: true, reference: true, designation: true } },
    },
  },
} satisfies Prisma.StockMovementSelect;

export type StockMovementRow = Prisma.StockMovementGetPayload<{ select: typeof movementSelection }>;

const lotSelection = {
  id: true,
  quantity: true,
  fifoDate: true,
  storageLocation: { select: { id: true, code: true } },
  stockItem: {
    select: { article: { select: { id: true, reference: true, designation: true } } },
  },
} satisfies Prisma.StockLotSelect;

export type StockLotRow = Prisma.StockLotGetPayload<{ select: typeof lotSelection }>;

interface FindMovementsOptions {
  readonly input: StockMovementListInput;
  /** Already resolved by the site-scoping middleware. `null` means all plants. */
  readonly siteId: string | null;
}

function buildWhere(options: FindMovementsOptions): Prisma.StockMovementWhereInput {
  const { input, siteId } = options;

  const occurredAt: Prisma.DateTimeFilter = {};
  if (input.from !== undefined) occurredAt.gte = input.from;
  if (input.to !== undefined) occurredAt.lte = input.to;

  const article: Prisma.ArticleWhereInput = {};
  if (input.articleId !== undefined) article.id = input.articleId;
  if (input.search !== undefined && input.search !== "") {
    article.OR = [
      { reference: { contains: input.search, mode: "insensitive" } },
      { designation: { contains: input.search, mode: "insensitive" } },
    ];
  }

  const stockItem: Prisma.StockItemWhereInput = {};
  if (siteId !== null) stockItem.siteId = siteId;
  if (Object.keys(article).length > 0) stockItem.article = article;

  const where: Prisma.StockMovementWhereInput = {};
  if (Object.keys(stockItem).length > 0) where.stockItem = stockItem;
  if (input.type !== undefined) where.type = input.type;
  if (Object.keys(occurredAt).length > 0) where.occurredAt = occurredAt;
  if (input.storageLocationId !== undefined) {
    where.lot = { storageLocationId: input.storageLocationId };
  }

  return where;
}

export async function findMovements(options: FindMovementsOptions): Promise<{
  rows: StockMovementRow[];
  totalCount: number;
}> {
  const where = buildWhere(options);
  const { input } = options;

  const [rows, totalCount] = await db.$transaction([
    db.stockMovement.findMany({
      where,
      select: movementSelection,
      // Two keys, because several movements of one delivery share a timestamp
      // and a cursor over a non-unique ordering silently repeats rows.
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor === undefined || input.cursor === null
        ? {}
        : { cursor: { id: input.cursor }, skip: 1 }),
    }),
    db.stockMovement.count({ where }),
  ]);

  return { rows, totalCount };
}

export async function findLotsByLocation(
  input: StockByLocationInput,
  siteId: string | null,
): Promise<StockLotRow[]> {
  return db.stockLot.findMany({
    where: {
      quantity: { gt: 0 },
      ...(input.storageLocationId === undefined
        ? {}
        : { storageLocationId: input.storageLocationId }),
      ...(siteId === null ? {} : { stockItem: { siteId } }),
    },
    select: lotSelection,
    orderBy: [{ storageLocation: { code: "asc" } }, { fifoDate: "asc" }],
  });
}

export async function findStorageLocations(siteId: string | null) {
  return db.storageLocation.findMany({
    where: siteId === null ? {} : { siteId },
    select: { id: true, code: true, description: true, siteId: true },
    orderBy: { code: "asc" },
  });
}

/**
 * The stock item a movement is about, with the lots FIFO will draw from.
 *
 * Returns the article's parameters too, because the service recomputes the
 * alert level from the new stock and cannot ask the database a second question
 * between deciding and writing.
 */
/**
 * The stock item a movement is about, with `Decimal` already unwrapped.
 *
 * The conversion happens here rather than in the service, because
 * `minThreshold` is `Decimal(12,3)` in Postgres and `Decimal` is a Prisma
 * runtime class. A service that unwraps it knows a persistence detail, and the
 * cost is not theoretical: the service tests had to `import { Prisma }` and
 * build `new Prisma.Decimal(...)` fixtures, which is the opposite of the
 * "plain object stub and no Postgres" seam CLAUDE.md section 3 describes.
 */
export async function findStockItemForMovement(articleId: string, siteId: string | null) {
  const row = await db.stockItem.findFirst({
    where: { articleId, ...(siteId === null ? {} : { siteId }) },
    select: {
      id: true,
      currentStock: true,
      minThreshold: true,
      siteId: true,
      // The level before the movement: a notification fires on the *crossing*
      // into shortage, not on the state, so the previous value is required.
      alertLevel: true,
      article: { select: { id: true, reference: true, designation: true, abcClass: true } },
      lots: {
        where: { quantity: { gt: 0 } },
        select: { id: true, quantity: true, fifoDate: true },
        orderBy: { fifoDate: "asc" },
      },
    },
    orderBy: { site: { code: "asc" } },
  });

  return row === null ? null : { ...row, minThreshold: row.minThreshold.toNumber() };
}

/** The class parameters in force, as numbers the domain can use directly. */
export async function findParameterForClass(abcClass: "A" | "B" | "C") {
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

export async function findStorageLocationById(storageLocationId: string) {
  return db.storageLocation.findUnique({
    where: { id: storageLocationId },
    select: { id: true, siteId: true },
  });
}

/**
 * One lot the movement touches.
 *
 * A discriminated union rather than a record of nullable fields: an inbound
 * movement always knows its destination shelf and an outbound one always knows
 * which lot it drew from, and modelling both as optional would let a caller
 * ask for a lot with no location — which the foreign key would refuse at
 * runtime instead of the compiler refusing it here.
 */
/**
 * Who to tell about a stock event at one plant.
 *
 * By site rather than by role. `findRecipients` in the request module resolves
 * roles instead and carries a `ponytail:` note that role implies plant today —
 * true, and it is the assumption a third site breaks. A shortage is about a
 * shelf in a building, so the building is the right question to ask.
 *
 * Cross-site accounts are deliberately excluded: the administrator and the
 * logistics manager watch the alert board, and copying them on every article
 * that crosses its reorder point is how the bell menu stops being read.
 */
export async function findSiteRecipients(siteId: string): Promise<readonly string[]> {
  const users = await db.user.findMany({
    where: { siteId, isActive: true },
    select: { id: true },
  });

  return users.map((user) => user.id);
}

export type LotWrite =
  | {
      readonly kind: "create";
      readonly storageLocationId: string;
      readonly quantity: number;
      readonly fifoDate: Date;
      /** Supplier batch, when the storekeeper recorded one. */
      readonly batchReference: string | null;
      readonly supplierReference: string | null;
    }
  | {
      readonly kind: "draw";
      readonly lotId: string;
      /** The lot's quantity after the draw, not the amount taken. */
      readonly quantity: number;
      /** What the lot held when FIFO allocated against it, for the guard. */
      readonly expectedQuantity: number;
    };

export interface RecordMovementOptions {
  /** Generated by the service so the movement can be linked before it exists. */
  readonly movementId: string;
  readonly stockItemId: string;
  readonly type: MovementType;
  readonly quantity: number;
  readonly occurredAt: Date;
  readonly reference: string | null;
  readonly note: string | null;
  readonly userId: string;
  /** Decided by the service from the FIFO allocation. */
  readonly lotWrites: readonly LotWrite[];
  /** Identifier for a lot the service asked to create, if any. */
  readonly newLotId: string | null;
  /** Decided by the service; written in the same transaction as the movement. */
  readonly notifications: readonly NotificationWrite[];
  /** The level the service read and computed `newStock` from. */
  readonly expectedCurrentStock: number;
  readonly newStock: number;
  readonly alertLevel: AlertLevel;
}

/**
 * Writes a movement, its lots and the new stock level, atomically.
 *
 * The whole point of the module is here. A `currentStock` that moved without a
 * journal row is a figure nobody can explain, and a journal row without the
 * matching level is a figure nobody can trust — so neither is allowed to
 * succeed alone.
 *
 * The identifiers are generated by the service rather than by Postgres so the
 * movement can point at the lot it created in the same statement list, without
 * a round trip in the middle of the transaction.
 */
export async function recordMovementWithStockUpdate(options: RecordMovementOptions): Promise<void> {
  const { stockItemId, lotWrites, newLotId, newStock, alertLevel } = options;

  const drawnFrom = lotWrites.find((write) => write.kind === "draw")?.lotId ?? null;

  await guarded(
    () =>
      db.$transaction([
        // The lots first. Prisma runs a statement list in order and Postgres checks
        // the foreign key immediately, so a movement created before the lot it
        // points at fails on `stock_movement_lotId_fkey` — which is exactly what
        // happened the first time this ran against a real database.
        ...lotWrites.map((write) =>
          write.kind === "create"
            ? db.stockLot.create({
                data: {
                  ...(newLotId === null ? {} : { id: newLotId }),
                  stockItemId,
                  storageLocationId: write.storageLocationId,
                  quantity: write.quantity,
                  fifoDate: write.fifoDate,
                  batchReference: write.batchReference,
                  supplierReference: write.supplierReference,
                },
              })
            : db.stockLot.update({
                // Guarded on the quantity FIFO allocated against: another picker
                // drawing from the same lot invalidates this arithmetic.
                where: { id: write.lotId, quantity: write.expectedQuantity },
                data: { quantity: write.quantity },
              }),
        ),

        db.stockMovement.create({
          data: {
            id: options.movementId,
            stockItemId,
            type: options.type,
            quantity: options.quantity,
            occurredAt: options.occurredAt,
            reference: options.reference,
            note: options.note,
            userId: options.userId,
            // An inbound movement points at the lot it created; an outbound one at
            // the oldest lot it drew from, which is the one a picker went to.
            lotId: newLotId ?? drawnFrom,
          },
        }),

        db.stockItem.update({
          where: { id: stockItemId, currentStock: options.expectedCurrentStock },
          data: { currentStock: newStock, alertLevel },
        }),

        // In the same transaction as the level that caused them: a notification
        // written by a second call can announce a movement that rolled back.
        ...options.notifications.map((notification) =>
          db.notification.create({
            data: {
              userId: notification.userId,
              type: notification.type,
              title: notification.title,
              body: notification.body,
              payload: { ...notification.payload },
            },
          }),
        ),
      ]),
    "Le stock de cet article a change entre-temps. Rechargez la page et reessayez.",
    { stockItemId },
  );
}

export const stockRepository = {
  findSiteRecipients,
  findMovements,
  findLotsByLocation,
  findStorageLocations,
  findStorageLocationById,
  findStockItemForMovement,
  findParameterForClass,
  recordMovementWithStockUpdate,
};

export type StockRepository = typeof stockRepository;
