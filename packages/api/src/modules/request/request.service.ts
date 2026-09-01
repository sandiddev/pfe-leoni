import type {
  AttachmentItem,
  AttachmentListInput,
  CommentRequestInput,
  CreateRequestInput,
  DeleteAttachmentInput,
  DeleteDraftInput,
  Page,
  RecordAttachmentInput,
  RequestByIdInput,
  RequestDetail,
  RequestListInput,
  RequestListItem,
  TransitionRequestInput,
  TransitionResult,
  UpdateDraftInput,
} from "@leoni/contracts";
import { REQUEST_ACTION_LABELS_FR } from "@leoni/contracts";
import type {
  AbcClass,
  NotificationType,
  RequestStatus,
  Role,
  TransitionAction,
} from "@leoni/core";
import {
  applyMovement,
  assertTransition,
  BusinessRuleError,
  canAccessSite,
  computeOrderQuantity,
  defaultParametersForClass,
  ForbiddenActionError,
  NotFoundError,
  resolveAlertLevel,
  transitionsFrom,
} from "@leoni/core";

import type { Actor } from "../../context";
import { resolveSiteFilter } from "../../middlewares/site-scope";
import * as mapper from "./request.mapper";
import type {
  CreateRequestLineWrite,
  LineQuantityWrite,
  NotificationWrite,
  RequestRepository,
  StockEntryWrite,
} from "./request.repository";
import { requestRepository } from "./request.repository";

/**
 * Business rules for the replenishment workflow.
 *
 * Every state change goes through `transition`, and every legality question it
 * asks is answered by `@leoni/core`: which moves exist from a status, which
 * roles may make them, and which demand a justification. Nothing about the
 * workflow is restated here — restating it is how a UI and a server end up
 * disagreeing about whether a storekeeper may approve their own request.
 */

interface ServiceParams<TInput> {
  readonly actor: Actor;
  readonly input: TInput;
  /** Injected by the tests. Defaults to the Prisma-backed repository. */
  readonly repository?: RequestRepository;
}

/**
 * A request spans two plants, so a single-site actor may read it from either
 * end: LTN4 has to see the demand it is being asked to fulfil.
 */
function assertCanSeeRequest(actor: Actor, fromSiteId: string, toSiteId: string): void {
  const allowed =
    canAccessSite(actor.role, actor.siteId, fromSiteId) ||
    canAccessSite(actor.role, actor.siteId, toSiteId);

  if (!allowed) {
    throw new ForbiddenActionError("Cette demande ne concerne pas votre site.", {
      role: actor.role,
      siteId: actor.siteId,
    });
  }
}

export async function list({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<RequestListInput>): Promise<Page<RequestListItem>> {
  const siteId = resolveSiteFilter(actor, input.siteId);
  const now = new Date();

  const { rows, totalCount } = await repository.findMany({
    input,
    siteId,
    actorUserId: actor.userId,
    lateBefore: now,
  });

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  return {
    items: page.map((row) => mapper.toListItem(row, now)),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    totalCount,
  };
}

export async function byId({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<RequestByIdInput>): Promise<RequestDetail> {
  const row = await repository.findById(input.requestId);

  if (row === null) {
    throw new NotFoundError(`Demande introuvable : ${input.requestId}`, {
      requestId: input.requestId,
    });
  }

  // A filter cannot protect a lookup by id, so the plants are checked on the
  // row that came back.
  assertCanSeeRequest(actor, row.fromSiteId, row.toSiteId);

  return mapper.toDetail(row, actor.role, new Date());
}

/**
 * Which plant supplies and which consumes.
 *
 * Read from the site table rather than taken from the client: the direction of
 * a replenishment is a property of the plants, and letting a payload state it
 * would allow a request that ships from the plant that is short.
 */
async function resolveTransferSites(
  repository: RequestRepository,
): Promise<{ fromSiteId: string; toSiteId: string }> {
  const sites = await repository.findSites();

  const supplying = sites.find((site) => site.type === "SUPPLYING");
  const consuming = sites.find((site) => site.type === "CONSUMING");

  if (supplying === undefined || consuming === undefined) {
    throw new BusinessRuleError(
      "Les sites fournisseur et consommateur ne sont pas configures.",
      {},
    );
  }

  return { fromSiteId: supplying.id, toSiteId: consuming.id };
}

/** Width of the sequence in a code, as in DR-2026-0042. */
const CODE_SEQUENCE_WIDTH = 4;

/**
 * DR-2026-0042: the reference a storekeeper reads out over the phone.
 *
 * Derived from the highest code already issued this year, never from a count.
 * A count is only equal to the highest sequence while nothing is ever removed,
 * and drafts are removable — so a deletion would make the next creation collide
 * on the unique index.
 */
async function nextCode(repository: RequestRepository, now: Date): Promise<string> {
  const year = now.getFullYear();
  const last = await repository.findLastRequestCode(year);

  const previous = last === null ? 0 : Number.parseInt(last.slice(-CODE_SEQUENCE_WIDTH), 10);
  const next = Number.isFinite(previous) ? previous + 1 : 1;

  return `DR-${String(year)}-${String(next).padStart(CODE_SEQUENCE_WIDTH, "0")}`;
}

export async function create({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<CreateRequestInput>): Promise<{ requestId: string; code: string }> {
  const { fromSiteId, toSiteId } = await resolveTransferSites(repository);
  const lines = await buildLines(repository, toSiteId, input.lines);

  const now = new Date();
  const requestId = crypto.randomUUID();
  const code = await nextCode(repository, now);

  await repository.createWithHistory({
    requestId,
    code,
    priority: input.priority,
    fromSiteId,
    toSiteId,
    createdById: actor.userId,
    expectedDeliveryAt: input.expectedDeliveryAt ?? null,
    lines,
  });

  return { requestId, code };
}


// --- Planning: what a transition records ------------------------------------

/**
 * The line column each action owns, and the column it carries forward from.
 *
 * An approval writes the authorised quantity, a shipment the shipped one. The
 * client names the action, never the column: a payload that chose the column
 * could write "received" while approving, which is how a service-level KPI
 * quietly becomes fiction.
 */
const QUANTITY_PLAN: Partial<
  Record<
    TransitionAction,
    { readonly field: LineQuantityWrite["field"]; readonly from: readonly LineField[] }
  >
> = {
  approve: { field: "approvedQuantity", from: ["requestedQuantity"] },
  startPreparation: { field: "preparedQuantity", from: ["approvedQuantity", "requestedQuantity"] },
  prepareAvailable: { field: "preparedQuantity", from: ["approvedQuantity", "requestedQuantity"] },
  resumePreparation: { field: "preparedQuantity", from: ["approvedQuantity", "requestedQuantity"] },
  declarePartial: { field: "preparedQuantity", from: ["approvedQuantity", "requestedQuantity"] },
  markReady: { field: "preparedQuantity", from: ["approvedQuantity", "requestedQuantity"] },
  ship: { field: "shippedQuantity", from: ["preparedQuantity", "approvedQuantity"] },
  confirmReceipt: { field: "receivedQuantity", from: ["shippedQuantity", "preparedQuantity"] },
};

type LineField =
  | "requestedQuantity"
  | "approvedQuantity"
  | "preparedQuantity"
  | "shippedQuantity";

interface PlannableLine {
  readonly id: string;
  readonly requestedQuantity: number;
  readonly approvedQuantity: number | null;
  readonly preparedQuantity: number | null;
  readonly shippedQuantity: number | null;
}

/** The first stage that actually recorded a figure, walking back the chain. */
function carriedForward(line: PlannableLine, from: readonly LineField[]): number {
  for (const field of from) {
    const value = line[field];
    if (value !== null) return value;
  }
  return line.requestedQuantity;
}

interface LineQuantityPlanInputs {
  readonly action: TransitionAction;
  readonly lines: readonly PlannableLine[];
  readonly overrides: readonly { readonly lineId: string; readonly quantity: number }[];
}

/**
 * What each line records for this action.
 *
 * A caller that says nothing gets the previous stage's figure carried forward,
 * which is the overwhelmingly common case: LTN4 usually prepares what was
 * approved. A caller that names a smaller quantity is declaring a partial, and
 * that number is the one the shortfall is computed from.
 */
function planLineQuantities(inputs: LineQuantityPlanInputs): readonly LineQuantityWrite[] {
  const plan = QUANTITY_PLAN[inputs.action];
  if (plan === undefined) return [];

  const overrides = new Map(inputs.overrides.map((entry) => [entry.lineId, entry.quantity]));

  return inputs.lines.map((line) => ({
    lineId: line.id,
    field: plan.field,
    quantity: overrides.get(line.id) ?? carriedForward(line, plan.from),
  }));
}

/**
 * The events worth telling someone about.
 *
 * Not every transition earns a notification: "preparation resumed" is visible
 * on the request and interrupting five people with it trains them to ignore the
 * bell. Only the six moments that change what somebody has to do are here.
 */
const NOTIFICATION_BY_ACTION: Partial<Record<TransitionAction, NotificationType>> = {
  submit: "REQUEST_CREATED",
  approve: "REQUEST_APPROVED",
  reject: "REQUEST_REJECTED",
  transmit: "REQUEST_CREATED",
  ship: "REQUEST_SHIPPED",
  confirmReceipt: "REQUEST_RECEIVED",
  declareStockOut: "LTN4_STOCK_OUT",
};

interface NotificationPlanInputs {
  readonly action: TransitionAction;
  readonly to: RequestStatus;
  readonly request: { readonly id: string; readonly code: string; readonly createdById: string };
  readonly actorUserId: string;
  readonly findRecipients: (roles: readonly Role[]) => Promise<readonly string[]>;
}

/**
 * Who hears about a transition.
 *
 * The recipients are derived from the transition table rather than listed here:
 * whoever may perform the *next* move is exactly who now has something to do.
 * That means adding a stage to the workflow routes its notifications without
 * anyone remembering to, and it cannot drift from the permissions.
 *
 * The requester is always told, because it is their line that is waiting.
 * Nobody is told about their own action.
 */
async function planNotifications(
  inputs: NotificationPlanInputs,
): Promise<readonly NotificationWrite[]> {
  const type = NOTIFICATION_BY_ACTION[inputs.action];
  if (type === undefined) return [];

  const nextRoles = [
    ...new Set(transitionsFrom(inputs.to).flatMap((candidate) => candidate.allowedRoles)),
  ];

  const recipients = new Set(await inputs.findRecipients(nextRoles));
  recipients.add(inputs.request.createdById);
  recipients.delete(inputs.actorUserId);

  const title = `${REQUEST_ACTION_LABELS_FR[inputs.action]} — ${inputs.request.code}`;

  return [...recipients].map((userId) => ({
    userId,
    type,
    title,
    body: null,
    payload: { requestId: inputs.request.id, code: inputs.request.code, status: inputs.to },
  }));
}

/** A stock item a receipt puts goods into, as the repository returns it. */
interface ReceiptTarget {
  readonly id: string;
  readonly articleId: string;
  readonly currentStock: number;
  readonly minThreshold: { toNumber: () => number };
  readonly article: { readonly abcClass: AbcClass };
  readonly lots: readonly { readonly storageLocationId: string }[];
}

export interface ReceiptPlanInputs {
  readonly targets: readonly ReceiptTarget[];
  /** Shelf to use for an article never stored at this plant before. */
  readonly fallbackLocationId: string | null;
  readonly warningMarginByClass: ReadonlyMap<AbcClass, number | null>;
  readonly quantitiesByArticleId: ReadonlyMap<string, number>;
}

/**
 * What a receipt does to the stock at the consuming plant.
 *
 * Computed before the transaction opens, because the alert level is a domain
 * decision and the repository may not make one — and written inside the same
 * transaction as the status change, because a receipt that raised a level
 * without a journal row is a figure nobody can explain.
 */
function planReceipt(inputs: ReceiptPlanInputs): readonly StockEntryWrite[] {
  const entries: StockEntryWrite[] = [];

  for (const target of inputs.targets) {
    const quantity = inputs.quantitiesByArticleId.get(target.articleId) ?? 0;
    if (quantity <= 0) continue;

    // The shelf the article was last put on, so a receipt does not scatter one
    // reference across the store.
    const locationId = target.lots[0]?.storageLocationId ?? inputs.fallbackLocationId;
    if (locationId === null) {
      throw new BusinessRuleError(
        "Aucun emplacement de stockage n est configure pour le site demandeur.",
        { articleId: target.articleId },
      );
    }

    const newStock = applyMovement({
      currentStock: target.currentStock,
      type: "ENTRY",
      quantity,
    });

    const configured = inputs.warningMarginByClass.get(target.article.abcClass);
    const warningMarginRatio =
      configured ?? defaultParametersForClass(target.article.abcClass).warningMarginRatio;

    entries.push({
      articleId: target.articleId,
      movementId: crypto.randomUUID(),
      lotId: crypto.randomUUID(),
      stockItemId: target.id,
      storageLocationId: locationId,
      quantity,
      expectedCurrentStock: target.currentStock,
      newStock,
      alertLevel: resolveAlertLevel({
        currentStock: newStock,
        min: target.minThreshold.toNumber(),
        warningMarginRatio,
      }),
    });
  }

  return entries;
}

/**
 * Turns request lines into the snapshot the repository writes.
 *
 * Shared by `create` and `updateDraft`: both have to resolve the VPE, round to
 * whole packs and record what the domain would have proposed, and two copies of
 * that would be two ways for a corrected draft to disagree with the original.
 */
async function buildLines(
  repository: RequestRepository,
  toSiteId: string,
  lines: CreateRequestInput["lines"],
): Promise<readonly CreateRequestLineWrite[]> {
  const stockItems = await repository.findArticlesForRequest(
    lines.map((line) => line.articleId),
    toSiteId,
  );

  const byArticleId = new Map(stockItems.map((item) => [item.article.id, item]));

  return lines.map((line) => {
    const stockItem = byArticleId.get(line.articleId);
    if (stockItem === undefined) {
      throw new NotFoundError(`Article introuvable au site demandeur : ${line.articleId}`, {
        articleId: line.articleId,
      });
    }

    const vpe = stockItem.article.vpe;

    // What the domain would have proposed, kept beside what the human asked
    // for: the gap between the two is how the suggestion earns trust.
    const suggestion = computeOrderQuantity({
      currentStock: stockItem.currentStock,
      min: stockItem.minThreshold.toNumber(),
      max: stockItem.maxThreshold.toNumber(),
      vpe,
    });

    return {
      articleId: line.articleId,
      // A part is ordered in whole packs, rounded up, whatever was typed.
      requestedQuantity: Math.ceil(line.requestedQuantity / vpe) * vpe,
      vpeSnapshot: vpe,
      suggestedQuantity: suggestion.isReplenishmentNeeded ? suggestion.recommendedQuantity : null,
      note: line.note ?? null,
    };
  });
}

/**
 * Only the person who raised a draft, or an Administrator, may change it.
 *
 * Not a permission: `request:create` says you may raise requests, not that you
 * may rewrite somebody else's. And not a site check either — both storekeepers
 * are at LTN1, so site scoping would let one edit the other's draft.
 */
function assertOwnsDraft(actor: Actor, request: { status: RequestStatus; createdById: string }) {
  if (request.status !== "DRAFT") {
    throw new BusinessRuleError(
      "Seule une demande en brouillon peut etre modifiee. Utilisez les actions du workflow.",
      { status: request.status },
    );
  }

  if (actor.role !== "ADMIN" && request.createdById !== actor.userId) {
    throw new ForbiddenActionError("Vous ne pouvez modifier que vos propres brouillons.", {
      userId: actor.userId,
    });
  }
}

/**
 * Corrects a draft before it is submitted.
 *
 * The lines are replaced wholesale and the quantities re-rounded, so a
 * corrected draft is built by exactly the same rules as a new one.
 */
export async function updateDraft({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<UpdateDraftInput>): Promise<{ requestId: string }> {
  const request = await repository.findById(input.requestId);

  if (request === null) {
    throw new NotFoundError(`Demande introuvable : ${input.requestId}`, {
      requestId: input.requestId,
    });
  }

  assertCanSeeRequest(actor, request.fromSiteId, request.toSiteId);
  assertOwnsDraft(actor, request);

  await repository.updateDraft({
    requestId: input.requestId,
    priority: input.priority,
    expectedDeliveryAt: input.expectedDeliveryAt ?? null,
    lines: await buildLines(repository, request.toSiteId, input.lines),
  });

  return { requestId: input.requestId };
}

/** Discards a draft. Anything past `submit` is cancelled, never deleted. */
export async function deleteDraft({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<DeleteDraftInput>): Promise<void> {
  const request = await repository.findById(input.requestId);

  if (request === null) {
    throw new NotFoundError(`Demande introuvable : ${input.requestId}`, {
      requestId: input.requestId,
    });
  }

  assertCanSeeRequest(actor, request.fromSiteId, request.toSiteId);
  assertOwnsDraft(actor, request);

  await repository.deleteDraft(input.requestId);
}

/** The milestone each status stamps, so real lead time stays measurable. */
const TIMESTAMP_BY_STATUS: Partial<Record<RequestStatus, string>> = {
  PENDING_APPROVAL: "submittedAt",
  APPROVED: "approvedAt",
  SENT_TO_LTN4: "sentAt",
  READY: "preparedAt",
  SHIPPED: "shippedAt",
  RECEIVED: "receivedAt",
  CLOSED: "closedAt",
};

/**
 * The target status of an action, from the state the request is actually in.
 *
 * The client names the action, never the destination: an action is unique
 * within a status, and letting a payload choose the target would make the
 * transition table advisory.
 */
function resolveTarget(status: RequestStatus, action: TransitionAction): RequestStatus {
  const transition = transitionsFrom(status).find((candidate) => candidate.action === action);

  if (transition === undefined) {
    throw new BusinessRuleError(
      `L action "${action}" n est pas possible depuis l etat ${status}.`,
      { status, action },
    );
  }

  return transition.to;
}

interface TransitionPlan {
  readonly lineQuantities: readonly LineQuantityWrite[];
  readonly notifications: readonly NotificationWrite[];
  readonly stockEntries: readonly StockEntryWrite[];
}

/**
 * Everything a receipt has to know before the transaction opens.
 *
 * Loaded here because the service may not import `@leoni/db`, and the
 * repository may not decide what an alert level becomes.
 */
async function loadReceiptInputs(
  repository: RequestRepository,
  toSiteId: string,
  articleIds: readonly string[],
): Promise<Omit<ReceiptPlanInputs, "quantitiesByArticleId">> {
  const [targets, fallback] = await Promise.all([
    repository.findReceiptTargets(articleIds, toSiteId),
    repository.findDefaultLocation(toSiteId),
  ]);

  const parameters = await Promise.all(
    [...new Set(targets.map((target) => target.article.abcClass))].map(async (abcClass) => ({
      abcClass,
      row: await repository.findParameterForClass(abcClass),
    })),
  );

  return {
    targets,
    fallbackLocationId: fallback?.id ?? null,
    warningMarginByClass: new Map(
      parameters.map(({ abcClass, row }) => [
        abcClass,
        row === null ? null : row.warningMarginRatio.toNumber(),
      ]),
    ),
  };
}

interface BuildPlanInputs {
  readonly repository: RequestRepository;
  readonly actor: Actor;
  readonly request: NonNullable<Awaited<ReturnType<RequestRepository["findById"]>>>;
  readonly transition: { readonly action: TransitionAction; readonly to: RequestStatus };
  readonly input: TransitionRequestInput;
}

async function buildPlan(inputs: BuildPlanInputs): Promise<TransitionPlan> {
  const { repository, actor, request, transition, input } = inputs;

  const lineQuantities = planLineQuantities({
    action: transition.action,
    lines: request.lines,
    overrides: input.lines ?? [],
  });

  const notifications = await planNotifications({
    action: transition.action,
    to: transition.to,
    request: { id: request.id, code: request.code, createdById: request.createdById },
    actorUserId: actor.userId,
    findRecipients: (roles: readonly Role[]) => repository.findRecipients(roles),
  });

  if (transition.action !== "confirmReceipt") {
    return { lineQuantities, notifications, stockEntries: [] };
  }

  const quantitiesByArticleId = new Map(
    request.lines.map((line) => {
      const write = lineQuantities.find((candidate) => candidate.lineId === line.id);
      return [line.articleId, write?.quantity ?? 0];
    }),
  );

  const receiptInputs = await loadReceiptInputs(
    repository,
    request.toSiteId,
    [...quantitiesByArticleId.keys()],
  );

  return {
    lineQuantities,
    notifications,
    stockEntries: planReceipt({ ...receiptInputs, quantitiesByArticleId }),
  };
}

/**
 * The single entry point for all fifteen workflow actions.
 *
 * One function rather than fifteen procedures, because the sequence is the same
 * every time — check the plants, ask the domain whether the move is legal for
 * this role, work out what it records — and fifteen copies of that sequence is
 * fifteen chances for one of them to skip the history row.
 */
export async function transition({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<TransitionRequestInput>): Promise<TransitionResult> {
  const request = await repository.findById(input.requestId);

  if (request === null) {
    throw new NotFoundError(`Demande introuvable : ${input.requestId}`, {
      requestId: input.requestId,
    });
  }

  assertCanSeeRequest(actor, request.fromSiteId, request.toSiteId);

  const to = resolveTarget(request.status, input.action);

  // The domain decides: whether the move exists, whether this role may make it,
  // and whether it needs a justification. Not this file.
  assertTransition({
    from: request.status,
    to,
    role: actor.role,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });

  const plan = await buildPlan({
    repository,
    actor,
    request,
    transition: { action: input.action, to },
    input,
  });

  await repository.applyTransition({
    requestId: request.id,
    fromStatus: request.status,
    toStatus: to,
    action: input.action,
    reason: input.reason ?? null,
    userId: actor.userId,
    timestampField: TIMESTAMP_BY_STATUS[to] ?? null,
    occurredAt: new Date(),
    setApprovedBy: input.action === "approve",
    expectedDeliveryAt: input.expectedDeliveryAt ?? null,
    lineQuantities: plan.lineQuantities,
    notifications: plan.notifications,
    stockEntries: plan.stockEntries,
  });

  return {
    requestId: request.id,
    status: to,
    stockEntries: plan.stockEntries.map((entry) => ({
      articleId: entry.articleId,
      quantity: entry.quantity,
      newStock: entry.newStock,
      alertLevel: entry.alertLevel,
    })),
  };
}

export async function listAttachments({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<AttachmentListInput>): Promise<readonly AttachmentItem[]> {
  const request = await repository.findById(input.requestId);

  if (request === null) {
    throw new NotFoundError(`Demande introuvable : ${input.requestId}`, {
      requestId: input.requestId,
    });
  }

  assertCanSeeRequest(actor, request.fromSiteId, request.toSiteId);

  const rows = await repository.findAttachments(input.requestId);

  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedByName: row.uploadedBy.name,
    createdAt: row.createdAt,
  }));
}

/**
 * Records a file that has already been written to disk.
 *
 * Called by the upload route, never by the browser: the row exists only once
 * the bytes do. The reverse order would produce a link to a file that is not
 * there, which is worse than a file nobody references — an orphaned file is a
 * cleanup job, an orphaned row is a broken screen.
 */
export async function recordAttachment({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<RecordAttachmentInput>): Promise<{ attachmentId: string }> {
  const request = await repository.findById(input.requestId);

  if (request === null) {
    throw new NotFoundError(`Demande introuvable : ${input.requestId}`, {
      requestId: input.requestId,
    });
  }

  assertCanSeeRequest(actor, request.fromSiteId, request.toSiteId);

  const created = await repository.recordAttachment({
    requestId: input.requestId,
    fileName: input.fileName,
    storagePath: input.storagePath,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    uploadedById: actor.userId,
  });

  return { attachmentId: created.id };
}

/**
 * Where a file lives, once the caller is allowed to read it.
 *
 * The download route calls this rather than reading the row itself: a file
 * served by identifier with no authorisation is the classic way an upload
 * feature leaks, and the check belongs beside every other one.
 *
 * The bytes on disk are deliberately left alone by `remove`. A delivery note
 * detached by mistake is recoverable; one deleted from disk is not, and the
 * cost of keeping it is a few kilobytes.
 */
export async function attachmentForDownload({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<DeleteAttachmentInput>): Promise<{
  fileName: string;
  mimeType: string;
  storagePath: string;
}> {
  const attachment = await repository.findAttachmentById(input.attachmentId);

  if (attachment === null) {
    throw new NotFoundError(`Piece jointe introuvable : ${input.attachmentId}`, {
      attachmentId: input.attachmentId,
    });
  }

  assertCanSeeRequest(actor, attachment.request.fromSiteId, attachment.request.toSiteId);

  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    storagePath: attachment.storagePath,
  };
}

export async function removeAttachment({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<DeleteAttachmentInput>): Promise<void> {
  const attachment = await repository.findAttachmentById(input.attachmentId);

  if (attachment === null) {
    throw new NotFoundError(`Piece jointe introuvable : ${input.attachmentId}`, {
      attachmentId: input.attachmentId,
    });
  }

  assertCanSeeRequest(actor, attachment.request.fromSiteId, attachment.request.toSiteId);

  await repository.deleteAttachment(input.attachmentId);
}

export async function comment({
  actor,
  input,
  repository = requestRepository,
}: ServiceParams<CommentRequestInput>): Promise<void> {
  const request = await repository.findById(input.requestId);

  if (request === null) {
    throw new NotFoundError(`Demande introuvable : ${input.requestId}`, {
      requestId: input.requestId,
    });
  }

  assertCanSeeRequest(actor, request.fromSiteId, request.toSiteId);

  await repository.addComment({
    requestId: input.requestId,
    userId: actor.userId,
    content: input.content,
  });
}

