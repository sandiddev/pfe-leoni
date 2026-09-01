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
import { REQUEST_ACTION_LABELS_FR, REQUEST_STATUS_LABELS_FR } from "@leoni/contracts";
import type {
  AbcClass,
  AlertLevel,
  CarriedFromField,
  NotificationType,
  RequestStatus,
  Role,
  TransitionAction,
} from "@leoni/core";
import {
  allocateFifo,
  applyMovement,
  assertTransition,
  assessLateness,
  BusinessRuleError,
  canAccessSite,
  computeOrderQuantity,
  crossedIntoShortage,
  defaultParametersForClass,
  ForbiddenActionError,
  NotFoundError,
  quantityPlanFor,
  resolveAlertLevel,
  transitionsFrom,
  wouldGoNegative,
} from "@leoni/core";

import type { Actor } from "../../context";
import { resolveSiteFilter } from "../../middlewares/site-scope";
import { planShortageNotifications } from "../../shared/notification";
import * as mapper from "./request.mapper";
import type {
  CreateRequestLineWrite,
  LineQuantityWrite,
  NotificationWrite,
  RequestRepository,
  StockEntryWrite,
  StockExitWrite,
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

interface PlannableLine {
  readonly id: string;
  readonly requestedQuantity: number;
  readonly approvedQuantity: number | null;
  readonly preparedQuantity: number | null;
  readonly shippedQuantity: number | null;
}

/** The first stage that actually recorded a figure, walking back the chain. */
function carriedForward(line: PlannableLine, from: readonly CarriedFromField[]): number {
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
  // The table lives in the domain, so the dialog that asks for these figures
  // and the service that writes them cannot disagree about which stage owns
  // which column.
  const plan = quantityPlanFor(inputs.action);
  if (plan === null) return [];

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
 *
 * The other half of the transfer is `planDispatch`, which took the same goods
 * off the supplying plant when they were shipped.
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
      // The same arithmetic as an `ENTRY`, and a different fact: goods arriving
      // against a request came from the other plant, not from outside. The
      // journal row the repository writes says `TRANSFER_IN` for that reason,
      // and naming the same type here keeps the two from drifting.
      type: "TRANSFER_IN",
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

/** A stock item a dispatch draws from, as the repository returns it. */
interface DispatchTarget {
  readonly id: string;
  readonly articleId: string;
  readonly currentStock: number;
  readonly minThreshold: { toNumber: () => number };
  readonly alertLevel: AlertLevel;
  readonly article: {
    readonly abcClass: AbcClass;
    readonly reference: string;
    readonly designation: string;
  };
  readonly lots: readonly { readonly id: string; readonly quantity: number; readonly fifoDate: Date }[];
}

export interface DispatchPlanInputs {
  readonly targets: readonly DispatchTarget[];
  readonly warningMarginByClass: ReadonlyMap<AbcClass, number | null>;
  readonly quantitiesByArticleId: ReadonlyMap<string, number>;
}

/**
 * What a dispatch takes off the supplying plant.
 *
 * The mirror of `planReceipt`, and the half that was missing: a
 * réapprovisionnement is a *transfer* (domain section 1), so crediting LTN1
 * without debiting LTN4 created units from nothing on every request. LTN4's
 * own alert board was computed from a stock level that never fell.
 *
 * Boxes leave oldest-first through `allocateFifo`, the same allocator the manual
 * movement screen uses — a dispatch is a pick like any other, and two FIFO
 * implementations would be two answers to "which box went".
 */
function planDispatch(inputs: DispatchPlanInputs): readonly StockExitWrite[] {
  const exits: StockExitWrite[] = [];

  for (const target of inputs.targets) {
    const quantity = inputs.quantitiesByArticleId.get(target.articleId) ?? 0;
    if (quantity <= 0) continue;

    if (wouldGoNegative({ currentStock: target.currentStock, type: "TRANSFER_OUT", quantity })) {
      // Refused rather than clamped: LTN4 shipping more than it holds is a
      // declared shortage (`declarePartial`), not a stock level going negative.
      throw new BusinessRuleError(
        `Stock insuffisant a l expedition pour ${target.article.reference} : ` +
          `${String(quantity)} unites a expedier, ${String(target.currentStock)} en stock.`,
        { articleId: target.articleId, requested: quantity, available: target.currentStock },
      );
    }

    const allocations = allocateFifo(target.lots, quantity);
    const newStock = applyMovement({
      currentStock: target.currentStock,
      type: "TRANSFER_OUT",
      quantity,
    });

    const configured = inputs.warningMarginByClass.get(target.article.abcClass);
    const warningMarginRatio =
      configured ?? defaultParametersForClass(target.article.abcClass).warningMarginRatio;

    exits.push({
      articleId: target.articleId,
      movementId: crypto.randomUUID(),
      stockItemId: target.id,
      quantity,
      expectedCurrentStock: target.currentStock,
      newStock,
      alertLevel: resolveAlertLevel({
        currentStock: newStock,
        min: target.minThreshold.toNumber(),
        warningMarginRatio,
      }),
      lotDraws: allocations.map((allocation) => ({
        lotId: allocation.lotId,
        quantity: allocation.remaining,
        expectedQuantity: allocation.remaining + allocation.quantity,
      })),
      drawnFromLotId: allocations[0]?.lotId ?? null,
    });
  }

  return exits;
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
  readonly stockExits: readonly StockExitWrite[];
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

/** The warning margin per class, which both plans need and neither may guess. */
async function warningMarginByClass(
  repository: RequestRepository,
  classes: readonly AbcClass[],
): Promise<ReadonlyMap<AbcClass, number | null>> {
  const parameters = await Promise.all(
    [...new Set(classes)].map(async (abcClass) => ({
      abcClass,
      row: await repository.findParameterForClass(abcClass),
    })),
  );

  return new Map(
    parameters.map(({ abcClass, row }) => [
      abcClass,
      row === null ? null : row.warningMarginRatio.toNumber(),
    ]),
  );
}

async function loadDispatchInputs(
  repository: RequestRepository,
  fromSiteId: string,
  articleIds: readonly string[],
): Promise<Omit<DispatchPlanInputs, "quantitiesByArticleId">> {
  const targets = await repository.findDispatchTargets(articleIds, fromSiteId);

  return {
    targets,
    warningMarginByClass: await warningMarginByClass(
      repository,
      targets.map((target) => target.article.abcClass),
    ),
  };
}

/**
 * Shortage notifications for the plant a dispatch drew from.
 *
 * A dispatch can push the *supplying* plant below its own reorder point, and
 * LTN4 learning that from the alert board hours later is the delay this project
 * exists to remove.
 *
 * `crossedIntoShortage` in the domain owns what counts as news, so a dispatch, a
 * manual movement and a nightly recalculation all agree. Recipients are resolved
 * by site — "who works in the building this shelf is in" — and only once
 * something has actually crossed: the overwhelmingly common shipment crosses
 * nothing, and a query per shipment for an empty list is a query for nothing.
 */
async function planDispatchShortages(inputs: {
  readonly repository: RequestRepository;
  readonly fromSiteId: string;
  readonly targets: readonly DispatchTarget[];
  readonly exits: readonly StockExitWrite[];
}): Promise<readonly NotificationWrite[]> {
  const { repository, fromSiteId, targets, exits } = inputs;

  const crossed = exits.flatMap((exit) => {
    const target = targets.find((candidate) => candidate.articleId === exit.articleId);
    if (target === undefined) return [];
    if (!crossedIntoShortage(target.alertLevel, exit.alertLevel)) return [];
    return [{ exit, target }];
  });

  if (crossed.length === 0) return [];

  const recipients = await repository.findSiteRecipients(fromSiteId);

  return crossed.flatMap(({ exit, target }) =>
    planShortageNotifications({
      from: target.alertLevel,
      to: exit.alertLevel,
      subject: {
        articleId: exit.articleId,
        reference: target.article.reference,
        designation: target.article.designation,
        newStock: exit.newStock,
        minThreshold: target.minThreshold.toNumber(),
      },
      recipients,
    }),
  );
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

  // Only two transitions move stock: goods leaving LTN4 and goods arriving at
  // LTN1. Everything else is a status change with a trail.
  const movesStock = transition.action === "confirmReceipt" || transition.action === "ship";

  if (!movesStock) {
    return { lineQuantities, notifications, stockEntries: [], stockExits: [] };
  }

  const quantitiesByArticleId = new Map(
    request.lines.map((line) => {
      const write = lineQuantities.find((candidate) => candidate.lineId === line.id);
      return [line.articleId, write?.quantity ?? 0];
    }),
  );

  const articleIds = [...quantitiesByArticleId.keys()];

  if (transition.action === "ship") {
    // Debited from the supplying plant — `fromSiteId`, which is LTN4.
    const dispatchInputs = await loadDispatchInputs(repository, request.fromSiteId, articleIds);
    const stockExits = planDispatch({ ...dispatchInputs, quantitiesByArticleId });

    return {
      lineQuantities,
      // A dispatch can push the *supplying* plant below its own reorder point,
      // and LTN4 finding that out from the alert board hours later is the gap
      // this project exists to close. Appended to the transition's own
      // notifications so both land in the one transaction.
      notifications: [
        ...notifications,
        ...(await planDispatchShortages({
          repository,
          fromSiteId: request.fromSiteId,
          targets: dispatchInputs.targets,
          exits: stockExits,
        })),
      ],
      stockEntries: [],
      stockExits,
    };
  }

  const receiptInputs = await loadReceiptInputs(repository, request.toSiteId, articleIds);

  return {
    lineQuantities,
    notifications,
    stockEntries: planReceipt({ ...receiptInputs, quantitiesByArticleId }),
    stockExits: [],
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
    stockExits: plan.stockExits,
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
    stockExits: plan.stockExits.map((exit) => ({
      articleId: exit.articleId,
      quantity: exit.quantity,
      newStock: exit.newStock,
      alertLevel: exit.alertLevel,
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


/**
 * Warns about requests that have passed their promised delivery date.
 *
 * Called by the nightly job. This is *not* a retreat from ADR 0003 — lateness
 * stays derived, and nothing here writes a status or stamps a row. What it adds
 * is a nudge: `isLate` being always-correct on screen is only useful to somebody
 * who happens to open the screen, and the process this replaces was an email
 * chain precisely because nobody was watching.
 *
 * Announced once per request, not once per night. The repository excludes
 * requests that already carry a `REQUEST_LATE` notification, because a late
 * request stays late until it arrives and a nightly repeat is how a bell menu
 * gets ignored.
 *
 * The requester is told, and so is whoever approved on their site's behalf: the
 * storekeeper needs to chase it and the warehouse manager needs to know the
 * commitment slipped.
 */
export async function notifyLateRequests({
  asOf,
  repository = requestRepository,
}: {
  /** Passed in rather than read here, so the sweep is deterministic to test. */
  readonly asOf: Date;
  readonly repository?: RequestRepository;
}): Promise<{ readonly late: number; readonly notified: number }> {
  const overdue = await repository.findRequestsBecomingLate(asOf);
  if (overdue.length === 0) return { late: 0, notified: 0 };

  const approvers = await repository.findRecipients(["LTN1_WAREHOUSE_MANAGER"]);

  const writes = overdue.flatMap((request) => {
    const lateness = assessLateness({
      status: request.status,
      expectedDeliveryAt: request.expectedDeliveryAt,
      receivedAt: null,
      now: asOf,
    });

    // Re-checked through the domain rather than trusted from the SQL: the
    // `WHERE` clause narrows the rows, `assessLateness` decides what late means.
    if (!lateness.isLate) return [];

    const recipients = new Set([request.createdById, ...approvers]);

    return [...recipients].map((userId) => ({
      userId,
      type: "REQUEST_LATE" as const,
      title: `Demande en retard : ${request.code}`,
      body:
        `${String(lateness.daysLate)} jour(s) au-dela de la date de livraison annoncee. ` +
        `Statut actuel : ${REQUEST_STATUS_LABELS_FR[request.status]}.`,
      payload: {
        requestId: request.id,
        code: request.code,
        status: request.status,
        daysLate: lateness.daysLate,
      },
    }));
  });

  return { late: overdue.length, notified: await repository.recordNotifications(writes) };
}
