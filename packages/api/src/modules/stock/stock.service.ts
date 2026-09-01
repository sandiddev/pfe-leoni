import type {
  AdjustStockInput,
  Page,
  RecordMovementInput,
  RecordMovementResult,
  StockByLocationInput,
  StockByLocationItem,
  StockMovementListInput,
  StockMovementListItem,
  StorageLocationOption,
} from "@leoni/contracts";
import type { AlertLevel, MovementType } from "@leoni/core";
import {
  allocateFifo,
  applyMovement,
  BusinessRuleError,
  defaultParametersForClass,
  InvalidInputError,
  NotFoundError,
  resolveAlertLevel,
  wouldGoNegative,
} from "@leoni/core";

import type { Actor } from "../../context";
import { assertCanAccessSite, resolveSiteFilter } from "../../middlewares/site-scope";
import * as mapper from "./stock.mapper";
import type { LotWrite, StockRepository } from "./stock.repository";
import { stockRepository } from "./stock.repository";

/**
 * Business rules for the stock module.
 *
 * The decisions worth reading are all in `record`: whether the movement is
 * possible at all, which lots FIFO draws it from, and what alert level the new
 * level implies. Each of those comes from `@leoni/core`; this file's job is to
 * gather the inputs, apply them in the right order, and hand the repository a
 * complete set of facts to write in one transaction.
 */

interface ServiceParams<TInput> {
  readonly actor: Actor;
  readonly input: TInput;
  /** Injected by the tests. Defaults to the Prisma-backed repository. */
  readonly repository?: StockRepository;
}

export async function list({
  actor,
  input,
  repository = stockRepository,
}: ServiceParams<StockMovementListInput>): Promise<Page<StockMovementListItem>> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const { rows, totalCount } = await repository.findMovements({ input, siteId });

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  return {
    items: page.map(mapper.toMovementListItem),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    totalCount,
  };
}

export async function byLocation({
  actor,
  input,
  repository = stockRepository,
}: ServiceParams<StockByLocationInput>): Promise<readonly StockByLocationItem[]> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const rows = await repository.findLotsByLocation(input, siteId);
  return rows.map(mapper.toStockByLocationItem);
}

export async function storageLocations({
  actor,
  input,
  repository = stockRepository,
}: ServiceParams<StockByLocationInput>): Promise<readonly StorageLocationOption[]> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const rows = await repository.findStorageLocations(siteId);
  return rows.map(mapper.toStorageLocationOption);
}

/** The stock item, its lots and the warning band in force for its class. */
async function loadTarget(
  repository: StockRepository,
  actor: Actor,
  articleId: string,
  requestedSiteId: string | undefined,
) {
  const siteId = resolveSiteFilter(actor, requestedSiteId);
  const stockItem = await repository.findStockItemForMovement(articleId, siteId);

  if (stockItem === null) {
    throw new NotFoundError(`Article introuvable dans le stock : ${articleId}`, { articleId });
  }

  // A filter cannot protect a lookup that fell back to "any plant", so the row
  // that came back is re-checked against the actor's own site.
  assertCanAccessSite(actor, stockItem.siteId);

  const parameterRow = await repository.findParameterForClass(stockItem.article.abcClass);
  const warningMarginRatio =
    parameterRow === null
      ? defaultParametersForClass(stockItem.article.abcClass).warningMarginRatio
      : parameterRow.warningMarginRatio.toNumber();

  return { stockItem, warningMarginRatio };
}

/** The shelf an inbound movement lands on, checked against the actor's plant. */
async function resolveDestination(
  repository: StockRepository,
  actor: Actor,
  storageLocationId: string | undefined,
): Promise<string> {
  if (storageLocationId === undefined) {
    throw new InvalidInputError(
      "Un emplacement de destination est requis pour une entree en stock.",
      {},
    );
  }

  const location = await repository.findStorageLocationById(storageLocationId);
  if (location === null) {
    throw new NotFoundError(`Emplacement introuvable : ${storageLocationId}`, {
      storageLocationId,
    });
  }

  assertCanAccessSite(actor, location.siteId);
  return location.id;
}

const INBOUND_TYPES: readonly MovementType[] = ["ENTRY", "TRANSFER_IN"];

interface LotPlanInputs {
  readonly type: MovementType;
  readonly quantity: number;
  readonly lots: readonly { id: string; quantity: number; fifoDate: Date }[];
  readonly destinationId: string | null;
  readonly occurredAt: Date;
}

/**
 * Which lots the movement touches.
 *
 * Inbound stock becomes a new lot dated by the movement, so FIFO can age it
 * correctly. Outbound stock is drawn from the oldest lots first, which is the
 * picking order the brief requires and the one `allocateFifo` implements.
 */
function planLots(inputs: LotPlanInputs): readonly LotWrite[] {
  const { type, quantity, lots, destinationId, occurredAt } = inputs;

  if (INBOUND_TYPES.includes(type)) {
    if (destinationId === null) {
      throw new InvalidInputError("Un emplacement est requis pour une entree en stock.", {});
    }
    return [
      { kind: "create", storageLocationId: destinationId, quantity, fifoDate: occurredAt },
    ];
  }

  return allocateFifo(lots, quantity).map((allocation) => ({
    kind: "draw" as const,
    lotId: allocation.lotId,
    quantity: allocation.remaining,
    // What the lot held before this draw. `remaining + quantity` rather than a
    // second lookup: FIFO already computed both halves from the row it read.
    expectedQuantity: allocation.remaining + allocation.quantity,
  }));
}

interface WriteMovementInputs {
  readonly repository: StockRepository;
  readonly actor: Actor;
  readonly type: MovementType;
  readonly details: {
    readonly articleId: string;
    readonly siteId: string | undefined;
    readonly quantity: number;
    readonly storageLocationId: string | undefined;
    readonly occurredAt: Date | undefined;
    readonly reference: string | null;
    readonly note: string | null;
  };
}

/**
 * The one path every movement takes.
 *
 * `record` and `adjust` differ only in their permission and in whether the
 * quantity is a delta or a count — everything after that is identical, and two
 * copies of it would be two chances for the stock level and the journal to stop
 * agreeing.
 */
async function writeMovement(inputs: WriteMovementInputs): Promise<RecordMovementResult> {
  const { repository, actor, type, details } = inputs;

  const { stockItem, warningMarginRatio } = await loadTarget(
    repository,
    actor,
    details.articleId,
    details.siteId,
  );

  const previousStock = stockItem.currentStock;
  const movement = { currentStock: previousStock, type, quantity: details.quantity };

  if (wouldGoNegative(movement)) {
    throw new BusinessRuleError(
      `Stock insuffisant pour ${stockItem.article.reference} : ` +
        `${String(details.quantity)} unites demandees, ${String(previousStock)} en stock.`,
      { articleId: details.articleId, requested: details.quantity, available: previousStock },
    );
  }

  const newStock = applyMovement(movement);
  const occurredAt = details.occurredAt ?? new Date();

  // An adjustment upwards needs a shelf for the surplus; downwards it draws
  // FIFO like any other exit. Both are expressed as the equivalent movement, so
  // there is one lot-planning path rather than a second one for corrections.
  const delta = newStock - previousStock;
  const effectiveType: MovementType =
    type === "ADJUSTMENT" ? (delta >= 0 ? "ENTRY" : "EXIT") : type;

  // Only an inbound movement needs a destination; an outbound one is told where
  // to draw from by FIFO. Asking for a shelf on an exit was a bug the tests
  // caught: a storekeeper recording a consumption has no destination to give.
  const destinationId = INBOUND_TYPES.includes(effectiveType)
    ? await resolveDestination(repository, actor, details.storageLocationId)
    : null;

  const lotWrites = planLots({
    type: effectiveType,
    quantity: Math.abs(delta),
    lots: stockItem.lots,
    destinationId,
    occurredAt,
  });

  const alertLevel: AlertLevel = resolveAlertLevel({
    currentStock: newStock,
    min: stockItem.minThreshold.toNumber(),
    warningMarginRatio,
  });

  const movementId = crypto.randomUUID();
  const newLotId = lotWrites.some((write) => write.kind === "create") ? crypto.randomUUID() : null;

  await repository.recordMovementWithStockUpdate({
    movementId,
    newLotId,
    stockItemId: stockItem.id,
    type,
    quantity: details.quantity,
    occurredAt,
    reference: details.reference,
    note: details.note,
    userId: actor.userId,
    lotWrites,
    expectedCurrentStock: previousStock,
    newStock,
    alertLevel,
  });

  return { movementId, stockItemId: stockItem.id, previousStock, newStock, alertLevel };
}

export async function record({
  actor,
  input,
  repository = stockRepository,
}: ServiceParams<RecordMovementInput>): Promise<RecordMovementResult> {
  return writeMovement({
    repository,
    actor,
    type: input.type,
    details: {
      articleId: input.articleId,
      siteId: input.siteId,
      quantity: input.quantity,
      storageLocationId: input.storageLocationId,
      occurredAt: input.occurredAt,
      reference: input.reference ?? null,
      note: null,
    },
  });
}

/**
 * Records an inventory count. Administrator only (`stock:adjust`).
 *
 * The reason is mandatory and lands in the movement's note, because an
 * unexplained correction to a stock figure is precisely the opacity this
 * project exists to remove.
 */
export async function adjust({
  actor,
  input,
  repository = stockRepository,
}: ServiceParams<AdjustStockInput>): Promise<RecordMovementResult> {
  return writeMovement({
    repository,
    actor,
    type: "ADJUSTMENT",
    details: {
      articleId: input.articleId,
      siteId: input.siteId,
      quantity: input.countedQuantity,
      storageLocationId: input.storageLocationId,
      occurredAt: undefined,
      reference: null,
      note: input.reason,
    },
  });
}
