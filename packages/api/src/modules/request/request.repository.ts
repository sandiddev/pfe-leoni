import type { RequestListInput } from "@leoni/contracts";
import type { AlertLevel, RequestPriority, RequestStatus, Role } from "@leoni/core";
import type { Prisma } from "@leoni/db";
import { db } from "@leoni/db";

import { guarded } from "../../shared/conflict";
import type { NotificationWrite } from "../../shared/notification";

/**
 * Persistence for the request workflow.
 *
 * Two invariants live here and nowhere else: a status never changes without a
 * `RequestStatusHistory` row in the same transaction, and a receipt never
 * raises a stock level without a `StockMovement` in the same transaction. Both
 * are the reason this project replaces an email thread, so neither is allowed
 * to be a second call that a later refactor can drop.
 */

const listSelection = {
  id: true,
  code: true,
  status: true,
  priority: true,
  expectedDeliveryAt: true,
  receivedAt: true,
  createdAt: true,
  fromSite: { select: { code: true } },
  toSite: { select: { code: true } },
  createdBy: { select: { name: true } },
  lines: { select: { requestedQuantity: true } },
} satisfies Prisma.ReplenishmentRequestSelect;

export type RequestRow = Prisma.ReplenishmentRequestGetPayload<{ select: typeof listSelection }>;

const detailSelection = {
  ...listSelection,
  reason: true,
  fromSiteId: true,
  toSiteId: true,
  createdById: true,
  submittedAt: true,
  approvedAt: true,
  sentAt: true,
  preparedAt: true,
  shippedAt: true,
  closedAt: true,
  approvedBy: { select: { name: true } },
  lines: {
    select: {
      id: true,
      articleId: true,
      requestedQuantity: true,
      approvedQuantity: true,
      preparedQuantity: true,
      shippedQuantity: true,
      receivedQuantity: true,
      vpeSnapshot: true,
      suggestedQuantity: true,
      note: true,
      article: { select: { reference: true, designation: true } },
    },
    orderBy: { article: { reference: "asc" } },
  },
  statusHistory: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      action: true,
      reason: true,
      occurredAt: true,
      user: { select: { name: true } },
    },
    orderBy: { occurredAt: "asc" },
  },
  comments: {
    select: { id: true, content: true, createdAt: true, user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.ReplenishmentRequestSelect;

export type RequestDetailRow = Prisma.ReplenishmentRequestGetPayload<{
  select: typeof detailSelection;
}>;

interface FindManyOptions {
  readonly input: RequestListInput;
  /** Already resolved by the site-scoping middleware. `null` means all plants. */
  readonly siteId: string | null;
  readonly actorUserId: string;
  /** Requests whose commitment is already past, evaluated by the service. */
  readonly lateBefore: Date;
}

function buildWhere(options: FindManyOptions): Prisma.ReplenishmentRequestWhereInput {
  const { input, siteId, actorUserId, lateBefore } = options;

  const where: Prisma.ReplenishmentRequestWhereInput = {};

  // A request spans both plants, so a single-site actor sees it whichever end
  // they are: LTN4 must read the demand it has to fulfil.
  if (siteId !== null) {
    where.OR = [{ fromSiteId: siteId }, { toSiteId: siteId }];
  }

  if (input.status !== undefined) where.status = input.status;
  if (input.priority !== undefined) where.priority = input.priority;
  if (input.onlyMine) where.createdById = actorUserId;

  if (input.search !== undefined && input.search !== "") {
    where.AND = [
      {
        OR: [
          { code: { contains: input.search, mode: "insensitive" } },
          {
            lines: {
              some: { article: { reference: { contains: input.search, mode: "insensitive" } } },
            },
          },
        ],
      },
    ];
  }

  if (input.onlyLate) {
    // Lateness is derived, not stored, so the database can only narrow to the
    // rows that could be late; the service decides which actually are.
    where.expectedDeliveryAt = { lt: lateBefore };
    where.status = { notIn: ["CLOSED", "REJECTED", "CANCELLED"] };
  }

  return where;
}

export async function findMany(options: FindManyOptions): Promise<{
  rows: RequestRow[];
  totalCount: number;
}> {
  const where = buildWhere(options);
  const { input } = options;

  const [rows, totalCount] = await db.$transaction([
    db.replenishmentRequest.findMany({
      where,
      select: listSelection,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor === undefined || input.cursor === null
        ? {}
        : { cursor: { id: input.cursor }, skip: 1 }),
    }),
    db.replenishmentRequest.count({ where }),
  ]);

  return { rows, totalCount };
}

export async function findById(requestId: string): Promise<RequestDetailRow | null> {
  return db.replenishmentRequest.findUnique({ where: { id: requestId }, select: detailSelection });
}

/** The two plants, so a new request knows where it goes without the client saying. */
export async function findSites() {
  return db.site.findMany({ select: { id: true, code: true, type: true } });
}

/**
 * The article facts a new line must snapshot.
 *
 * VPE is copied onto the line because the article master may be re-imported
 * with a different pack size, and a closed request must still make arithmetic
 * sense years later.
 */
export async function findArticlesForRequest(articleIds: readonly string[], siteId: string) {
  const rows = await db.stockItem.findMany({
    where: { siteId, articleId: { in: [...articleIds] } },
    select: {
      currentStock: true,
      minThreshold: true,
      maxThreshold: true,
      article: { select: { id: true, reference: true, vpe: true, abcClass: true } },
    },
  });

  // Unwrapped here, not in the service: these feed `computeOrderQuantity` in
  // `@leoni/core`, and the domain sees only `number` by design.
  return rows.map((row) => ({
    ...row,
    minThreshold: row.minThreshold.toNumber(),
    maxThreshold: row.maxThreshold.toNumber(),
  }));
}

/**
 * The highest code issued this year, so the next one can follow it.
 *
 * Deliberately not a count. Counting worked until drafts became deletable:
 * removing one lowers the count, the next creation reuses a number that is
 * already taken, and `replenishment_request_code_key` rejects it. The smoke
 * test found that the first time it deleted a draft and then created another
 * request — a sequence a jury would reproduce in about ninety seconds.
 *
 * Ordering by `code` descending is a string sort, which is exactly right here
 * because the suffix is zero-padded to a fixed width.
 */
export async function findLastRequestCode(year: number): Promise<string | null> {
  const last = await db.replenishmentRequest.findFirst({
    where: { code: { startsWith: `DR-${String(year)}-` } },
    select: { code: true },
    orderBy: { code: "desc" },
  });

  return last?.code ?? null;
}

/**
 * Who to tell about a stock event at one plant.
 *
 * By site rather than by role, unlike `findRecipients` below: a shortage is
 * about a shelf in a building, so the building is the right question. Cross-site
 * accounts are excluded on purpose — the administrator and the logistics manager
 * watch the alert board, and copying them on every article that crosses its
 * reorder point is how a bell menu stops being read.
 */
export async function findSiteRecipients(siteId: string): Promise<readonly string[]> {
  const users = await db.user.findMany({
    where: { siteId, isActive: true },
    select: { id: true },
  });

  return users.map((user) => user.id);
}

export async function findRecipients(roles: readonly Role[]): Promise<readonly string[]> {
  const users = await db.user.findMany({
    // ponytail: role implies plant today (LTN1_STOREKEEPER is at LTN1). A third
    // site would need the site in this query as well.
    where: { role: { in: [...roles] }, isActive: true },
    select: { id: true },
  });

  return users.map((user) => user.id);
}

/**
 * A notification the service asked for, written with the change that caused it.
 *
 * Re-exported from `shared/notification` rather than declared twice: the stock
 * module raises the same kind of row from its own transaction, and two shapes
 * would be two ways for the notification centre to receive a payload it cannot
 * render.
 */
export type { NotificationWrite } from "../../shared/notification";

export interface LineQuantityWrite {
  readonly lineId: string;
  /** The column the action owns, decided by the service. */
  readonly field: "approvedQuantity" | "preparedQuantity" | "shippedQuantity" | "receivedQuantity";
  readonly quantity: number;
}

export interface CreateRequestLineWrite {
  readonly articleId: string;
  readonly requestedQuantity: number;
  readonly vpeSnapshot: number;
  readonly suggestedQuantity: number | null;
  readonly note: string | null;
}

export interface CreateRequestOptions {
  readonly requestId: string;
  readonly code: string;
  readonly priority: RequestPriority;
  readonly fromSiteId: string;
  readonly toSiteId: string;
  readonly createdById: string;
  readonly expectedDeliveryAt: Date | null;
  readonly lines: readonly CreateRequestLineWrite[];
}

/**
 * Creates a request, its lines and the history row that records the creation.
 *
 * The history row is not optional even here: a request whose trail starts at
 * its first transition cannot answer "who raised this, and when".
 */
export async function createWithHistory(options: CreateRequestOptions): Promise<void> {
  await db.$transaction([
    db.replenishmentRequest.create({
      data: {
        id: options.requestId,
        code: options.code,
        status: "DRAFT",
        priority: options.priority,
        fromSiteId: options.fromSiteId,
        toSiteId: options.toSiteId,
        createdById: options.createdById,
        expectedDeliveryAt: options.expectedDeliveryAt,
        lines: { create: [...options.lines] },
      },
    }),
    db.requestStatusHistory.create({
      data: {
        requestId: options.requestId,
        fromStatus: null,
        toStatus: "DRAFT",
        action: "create",
        userId: options.createdById,
      },
    }),
  ]);
}

export interface UpdateDraftOptions {
  readonly requestId: string;
  readonly priority: RequestPriority;
  readonly expectedDeliveryAt: Date | null;
  readonly lines: readonly CreateRequestLineWrite[];
}

/**
 * Replaces a draft's lines.
 *
 * Delete-then-create rather than a diff: the line identifiers are internal and
 * nothing outside the request references them yet, so preserving them buys
 * nothing and a diff protocol buys three more ways to be wrong.
 *
 * No history row. A draft has not entered the process — correcting one before
 * submission is not a status change, and recording it as one would fill the
 * trail with noise that hides the transitions that matter.
 */
export async function updateDraft(options: UpdateDraftOptions): Promise<void> {
  await db.$transaction([
    db.replenishmentRequestLine.deleteMany({ where: { requestId: options.requestId } }),
    db.replenishmentRequest.update({
      where: { id: options.requestId },
      data: {
        priority: options.priority,
        expectedDeliveryAt: options.expectedDeliveryAt,
        lines: { create: [...options.lines] },
      },
    }),
  ]);
}

/**
 * Removes a draft entirely.
 *
 * The one place in this application where deleting a trail is correct: a draft
 * that was never submitted is not part of the process, and keeping a history
 * row for a request nobody else ever saw would make the audit harder to read
 * rather than more complete. Everything after `submit` is permanent.
 *
 * The lines, the history row and the comments go with it through `onDelete:
 * Cascade`, which the schema already declares.
 */
export async function deleteDraft(requestId: string): Promise<void> {
  await db.replenishmentRequest.delete({ where: { id: requestId } });
}

/** A stock effect a receipt produces, computed by the service. */
export interface StockEntryWrite {
  readonly articleId: string;
  readonly movementId: string;
  readonly lotId: string;
  readonly stockItemId: string;
  readonly storageLocationId: string;
  readonly quantity: number;
  /**
   * The level the service read and computed `newStock` from.
   *
   * Carried so the write can assert nothing moved in between. Without it the
   * update is "set the stock to the number I worked out a moment ago", which
   * discards any movement recorded by somebody else in that moment.
   */
  readonly expectedCurrentStock: number;
  readonly newStock: number;
  readonly alertLevel: AlertLevel;
}

/** One lot the dispatch draws from, and what it must still hold to be valid. */
export interface LotDrawWrite {
  readonly lotId: string;
  /** The lot's quantity after the draw, not the amount taken. */
  readonly quantity: number;
  readonly expectedQuantity: number;
}

/**
 * What a dispatch takes off the supplying plant's books.
 *
 * The mirror of `StockEntryWrite`. It draws from existing lots rather than
 * creating one, which is the whole difference between goods arriving and goods
 * leaving: an entry needs a shelf to go on, an exit needs to know which boxes
 * were picked.
 */
export interface StockExitWrite {
  readonly articleId: string;
  readonly movementId: string;
  readonly stockItemId: string;
  readonly quantity: number;
  readonly expectedCurrentStock: number;
  readonly newStock: number;
  readonly alertLevel: AlertLevel;
  readonly lotDraws: readonly LotDrawWrite[];
  /** The oldest lot drawn from — the shelf a picker actually went to. */
  readonly drawnFromLotId: string | null;
}

/**
 * One end of a transfer, in the shape the transaction writes.
 *
 * Both directions reduce to the same three statements — settle the lots, write
 * the journal row, move the level — so they are written once. The differences
 * are data: an arrival creates the lot it lands in, a dispatch draws down lots
 * that already exist, and the movement type says which happened.
 *
 * Mapping the two plans onto this before the transaction keeps every `db.` call
 * inline in the statement list, which `audited-writes.test.ts` requires: it
 * reads this source to check that a `stockItem` mutation sits in a span that
 * also writes `stockMovement`, and a helper containing the calls would hide the
 * pairing from the only thing that verifies it.
 *
 * The statements are emitted lots-first, and that order is load-bearing: a
 * statement list runs in order and Postgres checks the foreign key immediately,
 * so a movement created before the lot it points at fails on
 * `stock_movement_lotId_fkey` — which is exactly what happened the first time
 * this met a real database.
 */
interface TransferLeg {
  readonly movementId: string;
  readonly stockItemId: string;
  readonly type: "TRANSFER_IN" | "TRANSFER_OUT";
  readonly quantity: number;
  readonly expectedCurrentStock: number;
  readonly newStock: number;
  readonly alertLevel: AlertLevel;
  /**
   * The lot an arrival lands in. A list rather than a nullable single so both
   * lot cases read the same way in the statement list — one `.map()` each.
   */
  readonly lotsToCreate: readonly { readonly id: string; readonly storageLocationId: string }[];
  /** Set on a dispatch: the lots the goods were picked from, oldest first. */
  readonly lotDraws: readonly LotDrawWrite[];
  /** The lot the journal row points at. */
  readonly lotId: string | null;
}

export interface ApplyTransitionOptions {
  readonly requestId: string;
  readonly fromStatus: RequestStatus;
  readonly toStatus: RequestStatus;
  readonly action: string;
  readonly reason: string | null;
  readonly userId: string;
  /** Milestone column this transition stamps, if any. */
  readonly timestampField: string | null;
  readonly occurredAt: Date;
  readonly setApprovedBy: boolean;
  readonly expectedDeliveryAt: Date | null;
  readonly lineQuantities: readonly LineQuantityWrite[];
  readonly notifications: readonly NotificationWrite[];
  /** Non-empty only for `confirmReceipt`: goods arriving at the consuming plant. */
  readonly stockEntries: readonly StockEntryWrite[];
  /** Non-empty only for `ship`: goods leaving the supplying plant. */
  readonly stockExits: readonly StockExitWrite[];
}

/** The columns the transition itself changes on the request row. */
function transitionData(options: ApplyTransitionOptions): Prisma.ReplenishmentRequestUpdateInput {
  const data: Prisma.ReplenishmentRequestUpdateInput = { status: options.toStatus };

  if (options.reason !== null) data.reason = options.reason;
  if (options.expectedDeliveryAt !== null) data.expectedDeliveryAt = options.expectedDeliveryAt;
  if (options.setApprovedBy) data.approvedBy = { connect: { id: options.userId } };
  if (options.timestampField !== null) {
    Object.assign(data, { [options.timestampField]: options.occurredAt });
  }

  return data;
}

/** The line-quantity updates the action decided on, as statements. */
function lineStatements(options: ApplyTransitionOptions) {
  return options.lineQuantities.map((line) =>
    db.replenishmentRequestLine.update({
      where: { id: line.lineId },
      data: { [line.field]: line.quantity },
    }),
  );
}

/**
 * The two plans as one list of legs.
 *
 * Pure data: no `db.` call appears here, so the statements it feeds stay inside
 * the transaction span where the audited-writes check can see them.
 */
function transferLegs(options: ApplyTransitionOptions): readonly TransferLeg[] {
  const arrivals = options.stockEntries.map((entry) => ({
    movementId: entry.movementId,
    stockItemId: entry.stockItemId,
    // Not `ENTRY`: goods arriving against a request came from the other plant,
    // not from outside. `isConsumption` excludes transfers, which is what keeps
    // an inter-plant move out of either plant's demand average.
    type: "TRANSFER_IN" as const,
    quantity: entry.quantity,
    expectedCurrentStock: entry.expectedCurrentStock,
    newStock: entry.newStock,
    alertLevel: entry.alertLevel,
    lotsToCreate: [{ id: entry.lotId, storageLocationId: entry.storageLocationId }],
    lotDraws: [],
    lotId: entry.lotId,
  }));

  const dispatches = options.stockExits.map((exit) => ({
    movementId: exit.movementId,
    stockItemId: exit.stockItemId,
    type: "TRANSFER_OUT" as const,
    quantity: exit.quantity,
    expectedCurrentStock: exit.expectedCurrentStock,
    newStock: exit.newStock,
    alertLevel: exit.alertLevel,
    lotsToCreate: [],
    lotDraws: exit.lotDraws,
    lotId: exit.drawnFromLotId,
  }));

  return [...arrivals, ...dispatches];
}

/**
 * The history row a transition leaves behind.
 *
 * Only the payload is built here; the `db.requestStatusHistory.create` call
 * stays inline in the transaction. That split matters:
 * `audited-writes.test.ts` reads this source for `db.<model>.` calls inside the
 * `$transaction` span, so moving the *call* into a helper would hide the
 * status/trail pairing from the only thing that verifies it — while moving the
 * *field list* out changes nothing it looks at.
 */
function historyData(
  options: ApplyTransitionOptions,
): Prisma.RequestStatusHistoryUncheckedCreateInput {
  return {
    requestId: options.requestId,
    fromStatus: options.fromStatus,
    toStatus: options.toStatus,
    action: options.action,
    reason: options.reason,
    userId: options.userId,
    occurredAt: options.occurredAt,
  };
}

/** The journal row for one leg of a transfer. */
function movementData(
  leg: TransferLeg,
  options: ApplyTransitionOptions,
): Prisma.StockMovementUncheckedCreateInput {
  return {
    id: leg.movementId,
    stockItemId: leg.stockItemId,
    type: leg.type,
    quantity: leg.quantity,
    occurredAt: options.occurredAt,
    reference: options.requestId,
    userId: options.userId,
    lotId: leg.lotId,
  };
}

/** The lot an arrival lands in. */
function arrivalLotData(
  lot: { readonly id: string; readonly storageLocationId: string },
  leg: TransferLeg,
  options: ApplyTransitionOptions,
): Prisma.StockLotUncheckedCreateInput {
  return {
    id: lot.id,
    stockItemId: leg.stockItemId,
    storageLocationId: lot.storageLocationId,
    quantity: leg.quantity,
    fifoDate: options.occurredAt,
  };
}

/**
 * Writes notifications on their own, for the nightly sweep.
 *
 * No accompanying row to be atomic with: a lateness warning records a *date
 * having passed*, not a change this application made. That is also why it is a
 * separate method rather than a parameter on `applyTransition` — there is no
 * transition here to attach it to.
 */
export async function recordNotifications(writes: readonly NotificationWrite[]): Promise<number> {
  if (writes.length === 0) return 0;

  const result = await db.notification.createMany({
    data: writes.map((write) => ({
      userId: write.userId,
      type: write.type,
      title: write.title,
      body: write.body,
      payload: { ...write.payload },
    })),
  });

  return result.count;
}

/** The notifications the service asked for, as statements. */
function notificationStatements(options: ApplyTransitionOptions) {
  return options.notifications.map((notification) =>
    db.notification.create({
      data: {
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        payload: { ...notification.payload },
      },
    }),
  );
}

/**
 * Applies a transition: the status, its milestone, the line quantities, the
 * history row, any notifications, and the stock it moved — off the supplying
 * plant on a dispatch, onto the consuming plant on a receipt.
 *
 * All of it in one `db.$transaction`. The rule is not a preference: a status
 * that moved without its history row is a workflow nobody can audit, and a
 * receipt that raised a stock level without a journal row is a figure nobody
 * can explain. Splitting this into two calls is how both happen.
 *
 * The stock writes are spelled out inline rather than lifted into a helper on
 * purpose. `audited-writes.test.ts` checks that a mutation on `stockItem` sits
 * inside a transaction span that also writes `stockMovement`, and it reads the
 * source: a helper hides the pairing from the only thing that verifies it. That
 * check caught exactly this refactor, so the shape stays.
 */
export async function applyTransition(options: ApplyTransitionOptions): Promise<void> {
  await guarded(
    () =>
      db.$transaction([
        db.replenishmentRequest.update({
          // The status the service validated against is part of the key: if
          // somebody else moved the request meanwhile, nothing matches and the
          // whole transaction rolls back instead of applying twice.
          where: { id: options.requestId, status: options.fromStatus },
          data: transitionData(options),
        }),

        db.requestStatusHistory.create({ data: historyData(options) }),

        ...lineStatements(options),

        // Lots first — see `TransferLeg` for why the order is load-bearing.
        ...transferLegs(options).flatMap((leg) => [
          ...leg.lotsToCreate.map((lot) =>
            db.stockLot.create({ data: arrivalLotData(lot, leg, options) }),
          ),
          ...leg.lotDraws.map((draw) =>
            db.stockLot.update({
              // Guarded on what FIFO allocated against: another picker drawing
              // from the same lot invalidates this arithmetic.
              where: { id: draw.lotId, quantity: draw.expectedQuantity },
              data: { quantity: draw.quantity },
            }),
          ),
          db.stockMovement.create({ data: movementData(leg, options) }),
          db.stockItem.update({
            // Same guard as the status above: `newStock` was computed from
            // `expectedCurrentStock`, so the write is only valid while that is
            // still what the row holds.
            where: { id: leg.stockItemId, currentStock: leg.expectedCurrentStock },
            data: { currentStock: leg.newStock, alertLevel: leg.alertLevel },
          }),
        ]),

        ...notificationStatements(options),
      ]),
    "Cette demande a change entre-temps. Rechargez la page et reessayez.",
    { requestId: options.requestId, fromStatus: options.fromStatus },
  );
}

/**
 * The supplying plant's stock for the lines being shipped.
 *
 * Every lot, oldest first, because a dispatch draws FIFO — unlike
 * `findReceiptTargets`, which needs only the most recent shelf to put goods
 * back on. Selecting the whole lot set is the difference between "where does
 * this live" and "which boxes physically leave".
 */
export async function findDispatchTargets(articleIds: readonly string[], siteId: string) {
  const rows = await db.stockItem.findMany({
    where: { siteId, articleId: { in: [...articleIds] } },
    select: {
      id: true,
      articleId: true,
      currentStock: true,
      minThreshold: true,
      // The level before the dispatch: a notification fires on the crossing.
      alertLevel: true,
      article: { select: { abcClass: true, reference: true, designation: true } },
      lots: {
        select: { id: true, quantity: true, fifoDate: true },
        orderBy: { fifoDate: "asc" },
      },
    },
  });

  return rows.map((row) => ({ ...row, minThreshold: row.minThreshold.toNumber() }));
}

/**
 * Where a receipt puts the goods away, and what the level becomes.
 *
 * One query for every line of the request, because a receipt of twenty lines
 * would otherwise issue twenty round trips inside a user-facing mutation.
 */
export async function findReceiptTargets(articleIds: readonly string[], siteId: string) {
  const rows = await db.stockItem.findMany({
    where: { siteId, articleId: { in: [...articleIds] } },
    select: {
      id: true,
      articleId: true,
      currentStock: true,
      minThreshold: true,
      article: { select: { abcClass: true } },
      lots: {
        select: { storageLocationId: true },
        orderBy: { fifoDate: "desc" },
        take: 1,
      },
    },
  });

  return rows.map((row) => ({ ...row, minThreshold: row.minThreshold.toNumber() }));
}

/** Fallback shelf when an article has never been stored at this plant before. */
export async function findDefaultLocation(siteId: string) {
  return db.storageLocation.findFirst({
    where: { siteId },
    select: { id: true },
    orderBy: { code: "asc" },
  });
}

/** The warning margin in force for a class, as a number the domain can use. */
export async function findParameterForClass(abcClass: "A" | "B" | "C") {
  const row = await db.replenishmentParameter.findUnique({ where: { abcClass } });

  return row === null ? null : { warningMarginRatio: row.warningMarginRatio.toNumber() };
}

export async function findAttachments(requestId: string) {
  return db.requestAttachment.findMany({
    where: { requestId },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
      uploadedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** The row and the plants it belongs to, so a download can be authorised. */
export async function findAttachmentById(attachmentId: string) {
  return db.requestAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      storagePath: true,
      request: { select: { fromSiteId: true, toSiteId: true } },
    },
  });
}

/**
 * Open requests past their promised delivery date that nobody has been told about.
 *
 * The `NOT` clause is the whole idempotency story. A late request stays late
 * every night until it arrives, so a job that notified on the state rather than
 * on the transition would send the same warning daily until people filtered the
 * bell menu away. Excluding requests that already carry a `REQUEST_LATE`
 * notification means each one is announced exactly once.
 *
 * Terminal statuses are excluded for the reason `assessLateness` gives: a
 * cancelled request was never going to be delivered and a closed one is settled,
 * so neither is meaningfully late.
 */
export async function findRequestsBecomingLate(asOf: Date) {
  return db.replenishmentRequest.findMany({
    where: {
      expectedDeliveryAt: { lt: asOf },
      receivedAt: null,
      status: { notIn: ["CLOSED", "REJECTED", "CANCELLED", "RECEIVED"] },
      NOT: {
        // Correlated on the request id in the payload, because `Notification`
        // has no foreign key to a request — it carries a JSON payload so one
        // table can serve stock alerts and workflow events alike.
        id: { in: await notifiedLateRequestIds() },
      },
    },
    select: {
      id: true,
      code: true,
      status: true,
      expectedDeliveryAt: true,
      createdById: true,
      toSiteId: true,
    },
  });
}

/** Requests that already carry a lateness warning. */
async function notifiedLateRequestIds(): Promise<string[]> {
  const notifications = await db.notification.findMany({
    where: { type: "REQUEST_LATE" },
    select: { payload: true },
  });

  return notifications.flatMap((notification) => {
    const payload = notification.payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return [];

    const requestId = Reflect.get(payload, "requestId");
    return typeof requestId === "string" ? [requestId] : [];
  });
}

export interface RecordAttachmentOptions {
  readonly requestId: string;
  readonly fileName: string;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uploadedById: string;
}

export async function recordAttachment(options: RecordAttachmentOptions): Promise<{ id: string }> {
  return db.requestAttachment.create({ data: { ...options }, select: { id: true } });
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  await db.requestAttachment.delete({ where: { id: attachmentId } });
}

export async function addComment(options: {
  readonly requestId: string;
  readonly userId: string;
  readonly content: string;
}): Promise<void> {
  await db.requestComment.create({
    data: {
      requestId: options.requestId,
      userId: options.userId,
      content: options.content,
    },
  });
}

export const requestRepository = {
  findMany,
  findById,
  findSites,
  findArticlesForRequest,
  findReceiptTargets,
  findDispatchTargets,
  findDefaultLocation,
  findParameterForClass,
  findRecipients,
  findSiteRecipients,
  findRequestsBecomingLate,
  recordNotifications,
  findLastRequestCode,
  createWithHistory,
  updateDraft,
  deleteDraft,
  applyTransition,
  addComment,
  findAttachments,
  findAttachmentById,
  recordAttachment,
  deleteAttachment,
};

export type RequestRepository = typeof requestRepository;
