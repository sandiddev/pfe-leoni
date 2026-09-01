import type { RequestListInput } from "@leoni/contracts";
import type {
  AlertLevel,
  NotificationType,
  RequestPriority,
  RequestStatus,
  Role,
} from "@leoni/core";
import type { Prisma } from "@leoni/db";
import { db } from "@leoni/db";

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
          { lines: { some: { article: { reference: { contains: input.search, mode: "insensitive" } } } } },
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
  return db.stockItem.findMany({
    where: { siteId, articleId: { in: [...articleIds] } },
    select: {
      currentStock: true,
      minThreshold: true,
      maxThreshold: true,
      article: { select: { id: true, reference: true, vpe: true, abcClass: true } },
    },
  });
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

export async function findRecipients(roles: readonly Role[]): Promise<readonly string[]> {
  const users = await db.user.findMany({
    // ponytail: role implies plant today (LTN1_STOREKEEPER is at LTN1). A third
    // site would need the site in this query as well.
    where: { role: { in: [...roles] }, isActive: true },
    select: { id: true },
  });

  return users.map((user) => user.id);
}

/** A notification the service asked for, written with the change that caused it. */
export interface NotificationWrite {
  readonly userId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string | null;
  readonly payload: Prisma.InputJsonValue;
}

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
  readonly newStock: number;
  readonly alertLevel: AlertLevel;
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
  /** Non-empty only for `confirmReceipt`, which is the one that touches stock. */
  readonly stockEntries: readonly StockEntryWrite[];
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

/** The notifications the service asked for, as statements. */
function notificationStatements(options: ApplyTransitionOptions) {
  return options.notifications.map((notification) =>
    db.notification.create({
      data: {
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        payload: notification.payload,
      },
    }),
  );
}

/**
 * Applies a transition: the status, its milestone, the line quantities, the
 * history row, any notifications, and — on a receipt — the stock it put away.
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
  await db.$transaction([
    db.replenishmentRequest.update({
      where: { id: options.requestId },
      data: transitionData(options),
    }),

    db.requestStatusHistory.create({
      data: {
        requestId: options.requestId,
        fromStatus: options.fromStatus,
        toStatus: options.toStatus,
        action: options.action,
        reason: options.reason,
        userId: options.userId,
        occurredAt: options.occurredAt,
      },
    }),

    ...lineStatements(options),

    // The lot before the movement that points at it: a statement list runs in
    // order and Postgres checks the foreign key immediately.
    ...options.stockEntries.flatMap((entry) => [
      db.stockLot.create({
        data: {
          id: entry.lotId,
          stockItemId: entry.stockItemId,
          storageLocationId: entry.storageLocationId,
          quantity: entry.quantity,
          fifoDate: options.occurredAt,
        },
      }),
      db.stockMovement.create({
        data: {
          id: entry.movementId,
          stockItemId: entry.stockItemId,
          type: "ENTRY",
          quantity: entry.quantity,
          occurredAt: options.occurredAt,
          reference: options.requestId,
          userId: options.userId,
          lotId: entry.lotId,
        },
      }),
      db.stockItem.update({
        where: { id: entry.stockItemId },
        data: { currentStock: entry.newStock, alertLevel: entry.alertLevel },
      }),
    ]),

    ...notificationStatements(options),
  ]);
}

/**
 * Where a receipt puts the goods away, and what the level becomes.
 *
 * One query for every line of the request, because a receipt of twenty lines
 * would otherwise issue twenty round trips inside a user-facing mutation.
 */
export async function findReceiptTargets(articleIds: readonly string[], siteId: string) {
  return db.stockItem.findMany({
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
}

/** Fallback shelf when an article has never been stored at this plant before. */
export async function findDefaultLocation(siteId: string) {
  return db.storageLocation.findFirst({
    where: { siteId },
    select: { id: true },
    orderBy: { code: "asc" },
  });
}

export async function findParameterForClass(abcClass: "A" | "B" | "C") {
  return db.replenishmentParameter.findUnique({ where: { abcClass } });
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
  findDefaultLocation,
  findParameterForClass,
  findRecipients,
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
