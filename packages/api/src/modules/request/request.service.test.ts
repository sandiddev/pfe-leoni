import { describe, expect, it } from "vitest";

import {
  ForbiddenActionError,
  NotFoundError,
  REQUEST_STATUSES,
  ROLES,
  TRANSITIONS,
} from "@leoni/core";
import type { RequestStatus, Role, TransitionAction } from "@leoni/core";
import { Prisma } from "@leoni/db";

import type { Actor } from "../../context";
import type {
  ApplyTransitionOptions,
  CreateRequestOptions,
  RequestDetailRow,
  RequestRepository,
  RequestRow,
  UpdateDraftOptions,
} from "./request.repository";
import * as service from "./request.service";

/**
 * The workflow, without a database.
 *
 * The suite below is deliberately driven off `TRANSITIONS` itself rather than
 * off a list written here: a table copied into a test proves the copy, not the
 * table. Every move the domain defines is exercised for the role that may make
 * it and for every role that may not, so adding a stage to the process
 * automatically extends the coverage instead of quietly escaping it.
 */

const LTN4 = "site-ltn4";
const LTN1 = "site-ltn1";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "user-1",
    name: "Test",
    email: "test@leoni.tn",
    role: "LTN1_STOREKEEPER",
    siteId: LTN1,
    ...overrides,
  };
}

function stubRepository(overrides: Partial<RequestRepository> = {}): RequestRepository {
  const notStubbed = (name: string) => () => {
    throw new Error(`${name} was called but not stubbed in this test.`);
  };

  return {
    findMany: notStubbed("findMany"),
    findById: notStubbed("findById"),
    findSites: async () => [
      { id: LTN4, code: "LTN4", type: "SUPPLYING" },
      { id: LTN1, code: "LTN1", type: "CONSUMING" },
    ],
    findArticlesForRequest: notStubbed("findArticlesForRequest"),
    findReceiptTargets: notStubbed("findReceiptTargets"),
    findDispatchTargets: notStubbed("findDispatchTargets"),
    findDefaultLocation: async () => ({ id: "loc-default" }),
    findParameterForClass: async () => null,
    findRecipients: async () => [],
    findSiteRecipients: async () => ["user-ltn4"],
    findRequestsBecomingLate: async () => [],
    recordNotifications: async () => 0,
    findLastRequestCode: async () => null,
    createWithHistory: notStubbed("createWithHistory"),
    updateDraft: async () => undefined,
    deleteDraft: async () => undefined,
    applyTransition: async () => undefined,
    addComment: notStubbed("addComment"),
    findAttachments: async () => [],
    findAttachmentById: notStubbed("findAttachmentById"),
    recordAttachment: async () => ({ id: "attachment-1" }),
    deleteAttachment: async () => undefined,
    ...overrides,
  };
}

interface DetailOptions {
  readonly status?: RequestStatus;
  readonly lines?: readonly Partial<RequestDetailRow["lines"][number]>[];
  readonly createdById?: string;
}

function detail(options: DetailOptions = {}): RequestDetailRow {
  const { status = "DRAFT", createdById = "user-1" } = options;

  const lines = (options.lines ?? [{}]).map((overrides, index) => ({
    id: `line-${String(index)}`,
    articleId: `article-${String(index)}`,
    requestedQuantity: 500,
    approvedQuantity: null,
    preparedQuantity: null,
    shippedQuantity: null,
    receivedQuantity: null,
    vpeSnapshot: 100,
    suggestedQuantity: 500,
    note: null,
    article: { reference: `REF-${String(index)}`, designation: "Article" },
    ...overrides,
  }));

  return {
    id: "request-1",
    code: "DR-2026-0001",
    status,
    priority: "NORMAL",
    expectedDeliveryAt: null,
    receivedAt: null,
    createdAt: new Date("2026-03-01"),
    fromSite: { code: "LTN4" },
    toSite: { code: "LTN1" },
    createdBy: { name: "Magasinier" },
    reason: null,
    fromSiteId: LTN4,
    toSiteId: LTN1,
    createdById,
    submittedAt: null,
    approvedAt: null,
    sentAt: null,
    preparedAt: null,
    shippedAt: null,
    closedAt: null,
    approvedBy: null,
    lines,
    statusHistory: [],
    comments: [],
  };
}

/** Records what the service handed the repository. */
function captureTransition() {
  const calls: ApplyTransitionOptions[] = [];
  return {
    capture: async (options: ApplyTransitionOptions) => {
      calls.push(options);
    },
    count: () => calls.length,
    options: () => {
      const first = calls[0];
      if (first === undefined) throw new Error("applyTransition was never called.");
      return first;
    },
  };
}

// --- The transition table, exercised in both directions ---------------------

interface Move {
  readonly from: RequestStatus;
  readonly to: RequestStatus;
  readonly action: TransitionAction;
  readonly allowedRoles: readonly Role[];
  readonly requiresReason: boolean;
}

const MOVES: readonly Move[] = REQUEST_STATUSES.flatMap((from) =>
  TRANSITIONS[from].map((definition) => ({
    from,
    to: definition.to,
    action: definition.action,
    allowedRoles: definition.allowedRoles,
    requiresReason: definition.requiresReason,
  })),
);

describe("request workflow - every transition the domain defines", () => {
  it("found the transition table", () => {
    // Guards against a fold that silently produced nothing.
    expect(MOVES.length).toBeGreaterThan(10);
  });

  it.each(MOVES.map((move) => [`${move.from} -> ${move.action}`, move] as const))(
    "%s is accepted for a role that may perform it",
    async (_label, move) => {
      const role = move.allowedRoles[0];
      if (role === undefined) throw new Error(`${move.action} lists no allowed role.`);

      const written = captureTransition();

      const result = await service.transition({
        actor: actor({ role, siteId: role === "LTN4_RESPONSIBLE" ? LTN4 : LTN1 }),
        input: {
          requestId: "request-1",
          action: move.action,
          ...(move.requiresReason ? { reason: "Motif suffisamment detaille" } : {}),
        },
        repository: stubRepository({
          findById: async () => detail({ status: move.from }),
          findReceiptTargets: async () => [receiptTarget()],
          findDispatchTargets: async () => [dispatchTarget()],
          applyTransition: written.capture,
        }),
      });

      expect(result.status).toBe(move.to);
      // The history row is not optional: it travels with the status change.
      expect(written.options().fromStatus).toBe(move.from);
      expect(written.options().toStatus).toBe(move.to);
      expect(written.options().action).toBe(move.action);
    },
  );

  it.each(MOVES.map((move) => [`${move.from} -> ${move.action}`, move] as const))(
    "%s is refused for every role that may not perform it",
    async (_label, move) => {
      const forbidden = ROLES.filter((role) => !move.allowedRoles.includes(role));

      for (const role of forbidden) {
        await expect(
          service.transition({
            actor: actor({ role, siteId: role === "LTN4_RESPONSIBLE" ? LTN4 : LTN1 }),
            input: {
              requestId: "request-1",
              action: move.action,
              ...(move.requiresReason ? { reason: "Motif suffisamment detaille" } : {}),
            },
            repository: stubRepository({
              findById: async () => detail({ status: move.from }),
              findReceiptTargets: async () => [receiptTarget()],
            }),
          }),
        ).rejects.toThrow();
      }
    },
  );

  const REASONED = MOVES.filter((move) => move.requiresReason);

  it.each(REASONED.map((move) => [`${move.from} -> ${move.action}`, move] as const))(
    "%s is refused without a justification",
    async (_label, move) => {
      const role = move.allowedRoles[0];
      if (role === undefined) throw new Error(`${move.action} lists no allowed role.`);

      await expect(
        service.transition({
          actor: actor({ role, siteId: role === "LTN4_RESPONSIBLE" ? LTN4 : LTN1 }),
          input: { requestId: "request-1", action: move.action },
          repository: stubRepository({ findById: async () => detail({ status: move.from }) }),
        }),
      ).rejects.toThrow(/justification/i);
    },
  );
});

describe("request workflow - transitions that do not exist", () => {
  it("refuses an action that is not possible from the current state", async () => {
    await expect(
      service.transition({
        actor: actor({ role: "ADMIN", siteId: null }),
        input: { requestId: "request-1", action: "ship" },
        repository: stubRepository({ findById: async () => detail({ status: "DRAFT" }) }),
      }),
    ).rejects.toThrow(/n est pas possible/i);
  });

  it("refuses any action from a terminal state", async () => {
    await expect(
      service.transition({
        actor: actor({ role: "ADMIN", siteId: null }),
        input: { requestId: "request-1", action: "close" },
        repository: stubRepository({ findById: async () => detail({ status: "CLOSED" }) }),
      }),
    ).rejects.toThrow();
  });

  it("reports an unknown request as not found", async () => {
    await expect(
      service.transition({
        actor: actor(),
        input: { requestId: "gone", action: "submit" },
        repository: stubRepository({ findById: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("request workflow - line quantities", () => {
  it("carries the requested quantity forward on approval", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN1_WAREHOUSE_MANAGER" }),
      input: { requestId: "request-1", action: "approve" },
      repository: stubRepository({
        findById: async () => detail({ status: "PENDING_APPROVAL" }),
        applyTransition: written.capture,
      }),
    });

    expect(written.options().lineQuantities).toEqual([
      { lineId: "line-0", field: "approvedQuantity", quantity: 500 },
    ]);
  });

  it("records a smaller authorised quantity when one is given", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN1_WAREHOUSE_MANAGER" }),
      input: {
        requestId: "request-1",
        action: "approve",
        lines: [{ lineId: "line-0", quantity: 300 }],
      },
      repository: stubRepository({
        findById: async () => detail({ status: "PENDING_APPROVAL" }),
        applyTransition: written.capture,
      }),
    });

    expect(written.options().lineQuantities[0]?.quantity).toBe(300);
  });

  it("prepares what was approved, not what was asked for", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "markReady" },
      repository: stubRepository({
        findById: async () =>
          detail({ status: "IN_PREPARATION", lines: [{ approvedQuantity: 300 }] }),
        applyTransition: written.capture,
      }),
    });

    expect(written.options().lineQuantities).toEqual([
      { lineId: "line-0", field: "preparedQuantity", quantity: 300 },
    ]);
  });

  it("ships what was prepared", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "ship" },
      repository: stubRepository({
        findById: async () =>
          detail({ status: "READY", lines: [{ approvedQuantity: 300, preparedQuantity: 250 }] }),
        findDispatchTargets: async () => [dispatchTarget()],
        applyTransition: written.capture,
      }),
    });

    expect(written.options().lineQuantities[0]).toEqual({
      lineId: "line-0",
      field: "shippedQuantity",
      quantity: 250,
    });
  });

  it("records nothing on a line for an action that changes no quantity", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor(),
      input: { requestId: "request-1", action: "submit" },
      repository: stubRepository({
        findById: async () => detail({ status: "DRAFT" }),
        applyTransition: written.capture,
      }),
    });

    expect(written.options().lineQuantities).toEqual([]);
  });
});

describe("request workflow - receipt writes stock", () => {
  it("produces the stock entry in the same call as the status change", async () => {
    // Two calls would let a later refactor drop one and leave a request marked
    // received with no material anywhere.
    const written = captureTransition();

    const result = await service.transition({
      actor: actor(),
      input: { requestId: "request-1", action: "confirmReceipt" },
      repository: stubRepository({
        findById: async () =>
          detail({ status: "SHIPPED", lines: [{ shippedQuantity: 400 }] }),
        findReceiptTargets: async () => [receiptTarget({ currentStock: 100 })],
        applyTransition: written.capture,
      }),
    });

    expect(written.count()).toBe(1);
    const entry = written.options().stockEntries[0];
    expect(entry?.quantity).toBe(400);
    expect(entry?.newStock).toBe(500);
    expect(result.stockEntries[0]?.newStock).toBe(500);
  });

  it("recomputes the alert level from the stock the receipt produced", async () => {
    const result = await service.transition({
      actor: actor(),
      input: { requestId: "request-1", action: "confirmReceipt" },
      repository: stubRepository({
        findById: async () => detail({ status: "SHIPPED", lines: [{ shippedQuantity: 50 }] }),
        // 0 + 50 against a Min of 400 is still critical, and must say so.
        findReceiptTargets: async () => [receiptTarget({ currentStock: 0, minThreshold: 400 })],
      }),
    });

    expect(result.stockEntries[0]?.alertLevel).toBe("CRITICAL");
  });

  it("puts the goods on the shelf the article was last stored on", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor(),
      input: { requestId: "request-1", action: "confirmReceipt" },
      repository: stubRepository({
        findById: async () => detail({ status: "SHIPPED", lines: [{ shippedQuantity: 10 }] }),
        findReceiptTargets: async () => [receiptTarget({ locationId: "loc-known" })],
        applyTransition: written.capture,
      }),
    });

    expect(written.options().stockEntries[0]?.storageLocationId).toBe("loc-known");
  });

  it("falls back to the plant's first shelf for an article never stored there", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor(),
      input: { requestId: "request-1", action: "confirmReceipt" },
      repository: stubRepository({
        findById: async () => detail({ status: "SHIPPED", lines: [{ shippedQuantity: 10 }] }),
        findReceiptTargets: async () => [receiptTarget({ locationId: null })],
        applyTransition: written.capture,
      }),
    });

    expect(written.options().stockEntries[0]?.storageLocationId).toBe("loc-default");
  });

  it("refuses a receipt when the plant has no storage location at all", async () => {
    await expect(
      service.transition({
        actor: actor(),
        input: { requestId: "request-1", action: "confirmReceipt" },
        repository: stubRepository({
          findById: async () => detail({ status: "SHIPPED", lines: [{ shippedQuantity: 10 }] }),
          findReceiptTargets: async () => [receiptTarget({ locationId: null })],
          findDefaultLocation: async () => null,
        }),
      }),
    ).rejects.toThrow(/emplacement/i);
  });

  it("writes no stock entry for a line that arrived empty", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor(),
      input: {
        requestId: "request-1",
        action: "confirmReceipt",
        lines: [{ lineId: "line-0", quantity: 0 }],
      },
      repository: stubRepository({
        findById: async () => detail({ status: "SHIPPED", lines: [{ shippedQuantity: 400 }] }),
        findReceiptTargets: async () => [receiptTarget()],
        applyTransition: written.capture,
      }),
    });

    expect(written.options().stockEntries).toEqual([]);
  });

  it("touches no stock on a transition that moves nothing physical", async () => {
    // `markReady` is a declaration about a pallet, not a movement of it. Ship
    // and receipt are the two that touch stock; everything else must not.
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "markReady" },
      repository: stubRepository({
        findById: async () => detail({ status: "IN_PREPARATION" }),
        applyTransition: written.capture,
      }),
    });

    expect(written.options().stockEntries).toEqual([]);
    expect(written.options().stockExits).toEqual([]);
  });
});

describe("request workflow - dispatch debits the supplying plant", () => {
  it("takes the shipped quantity off LTN4", async () => {
    // A reapprovisionnement is a transfer (domain section 1). Crediting LTN1
    // without debiting LTN4 created units from nothing on every request, and
    // LTN4's alert board was computed from a level that never fell.
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "ship" },
      repository: stubRepository({
        findById: async () => detail({ status: "READY", lines: [{ preparedQuantity: 400 }] }),
        findDispatchTargets: async () => [dispatchTarget({ currentStock: 5_000 })],
        applyTransition: written.capture,
      }),
    });

    const [exit] = written.options().stockExits;
    expect(exit?.quantity).toBe(400);
    expect(exit?.expectedCurrentStock).toBe(5_000);
    expect(exit?.newStock).toBe(4_600);
    // Nothing arrives anywhere on a dispatch: the goods are in transit, on
    // neither plant's books.
    expect(written.options().stockEntries).toEqual([]);
  });

  it("draws the boxes FIFO, oldest lot first", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "ship" },
      repository: stubRepository({
        findById: async () => detail({ status: "READY", lines: [{ preparedQuantity: 3_500 }] }),
        findDispatchTargets: async () => [dispatchTarget()],
        applyTransition: written.capture,
      }),
    });

    const [exit] = written.options().stockExits;
    // 3 000 from the January lot, then 500 from the February one.
    expect(exit?.lotDraws).toEqual([
      { lotId: "lot-old", quantity: 0, expectedQuantity: 3_000 },
      { lotId: "lot-new", quantity: 1_500, expectedQuantity: 2_000 },
    ]);
    // The movement points at the oldest lot drawn — the shelf a picker went to.
    expect(exit?.drawnFromLotId).toBe("lot-old");
  });

  it("recomputes LTN4's own alert level from what is left", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "ship" },
      repository: stubRepository({
        findById: async () => detail({ status: "READY", lines: [{ preparedQuantity: 4_700 }] }),
        findDispatchTargets: async () => [dispatchTarget({ currentStock: 5_000, minThreshold: 400 })],
        applyTransition: written.capture,
      }),
    });

    // 300 left against a reorder point of 400: at or below Min is CRITICAL.
    expect(written.options().stockExits[0]?.alertLevel).toBe("CRITICAL");
  });

  it("tells LTN4 when its own stock crosses into shortage", async () => {
    // The supplying plant is the one that just lost the goods. Before this, LTN4
    // learned it had gone below its own reorder point from the alert board,
    // whenever somebody next looked.
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "ship" },
      repository: stubRepository({
        findById: async () => detail({ status: "READY", lines: [{ preparedQuantity: 4_700 }] }),
        findDispatchTargets: async () => [
          dispatchTarget({ currentStock: 5_000, minThreshold: 400, alertLevel: "NORMAL" }),
        ],
        findSiteRecipients: async () => ["user-ltn4"],
        applyTransition: written.capture,
      }),
    });

    // 300 left against a Min of 400 — critical, and news because it was normal.
    const shortages = written
      .options()
      .notifications.filter((entry) => entry.type === "STOCK_CRITICAL");

    expect(shortages).toHaveLength(1);
    expect(shortages[0]?.userId).toBe("user-ltn4");
    expect(shortages[0]?.payload).toMatchObject({ level: "CRITICAL", currentStock: 300 });
  });

  it("says nothing when the dispatch leaves LTN4 comfortable", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "ship" },
      repository: stubRepository({
        findById: async () => detail({ status: "READY", lines: [{ preparedQuantity: 500 }] }),
        findDispatchTargets: async () => [
          dispatchTarget({ currentStock: 5_000, minThreshold: 400, alertLevel: "NORMAL" }),
        ],
        applyTransition: written.capture,
      }),
    });

    expect(
      written.options().notifications.filter((entry) => entry.type.startsWith("STOCK_")),
    ).toEqual([]);
  });

  it("does not renotify a plant that was already short", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "ship" },
      repository: stubRepository({
        findById: async () => detail({ status: "READY", lines: [{ preparedQuantity: 100 }] }),
        findDispatchTargets: async () => [
          dispatchTarget({
            currentStock: 300,
            minThreshold: 400,
            alertLevel: "CRITICAL",
            lots: [{ id: "lot-only", quantity: 300, fifoDate: new Date("2026-01-01") }],
          }),
        ],
        applyTransition: written.capture,
      }),
    });

    expect(
      written.options().notifications.filter((entry) => entry.type.startsWith("STOCK_")),
    ).toEqual([]);
  });

  it("refuses to ship more than the supplying plant holds", async () => {
    // Shipping what LTN4 does not have is a declared shortage
    // (`declarePartial`), not a stock level going negative.
    await expect(
      service.transition({
        actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
        input: { requestId: "request-1", action: "ship" },
        repository: stubRepository({
          findById: async () => detail({ status: "READY", lines: [{ preparedQuantity: 900 }] }),
          findDispatchTargets: async () => [
            dispatchTarget({
              currentStock: 500,
              lots: [{ id: "lot-only", quantity: 500, fifoDate: new Date("2026-01-01") }],
            }),
          ],
          applyTransition: async () => undefined,
        }),
      }),
    ).rejects.toThrow(/Stock insuffisant a l expedition/);
  });
});

describe("request workflow - milestones and notifications", () => {
  it("stamps the milestone the target status owns", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN1_WAREHOUSE_MANAGER" }),
      input: { requestId: "request-1", action: "approve" },
      repository: stubRepository({
        findById: async () => detail({ status: "PENDING_APPROVAL" }),
        applyTransition: written.capture,
      }),
    });

    expect(written.options().timestampField).toBe("approvedAt");
    expect(written.options().setApprovedBy).toBe(true);
  });

  it("stamps nothing for a status with no milestone", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "startPreparation" },
      repository: stubRepository({
        findById: async () => detail({ status: "SENT_TO_LTN4" }),
        applyTransition: written.capture,
      }),
    });

    expect(written.options().timestampField).toBeNull();
  });

  it("notifies whoever may make the next move, and the requester", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ userId: "storekeeper" }),
      input: { requestId: "request-1", action: "submit" },
      repository: stubRepository({
        findById: async () => detail({ status: "DRAFT", createdById: "storekeeper" }),
        findRecipients: async () => ["manager"],
        applyTransition: written.capture,
      }),
    });

    const recipients = written.options().notifications.map((entry) => entry.userId);
    // The actor is not told about their own action.
    expect(recipients).toEqual(["manager"]);
    expect(written.options().notifications[0]?.type).toBe("REQUEST_CREATED");
  });

  it("tells the requester when someone else acts on their request", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN1_WAREHOUSE_MANAGER", userId: "manager" }),
      input: { requestId: "request-1", action: "approve" },
      repository: stubRepository({
        findById: async () => detail({ status: "PENDING_APPROVAL", createdById: "storekeeper" }),
        findRecipients: async () => [],
        applyTransition: written.capture,
      }),
    });

    expect(written.options().notifications.map((entry) => entry.userId)).toContain("storekeeper");
  });

  it("stays quiet for a transition nobody needs to hear about", async () => {
    const written = captureTransition();

    await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "startPreparation" },
      repository: stubRepository({
        findById: async () => detail({ status: "SENT_TO_LTN4" }),
        applyTransition: written.capture,
      }),
    });

    expect(written.options().notifications).toEqual([]);
  });
});

describe("request workflow - site scoping", () => {
  it("lets LTN4 act on a request raised by LTN1", async () => {
    // A request spans both plants; the supplier has to see what it must fulfil.
    const result = await service.transition({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { requestId: "request-1", action: "startPreparation" },
      repository: stubRepository({ findById: async () => detail({ status: "SENT_TO_LTN4" }) }),
    });

    expect(result.status).toBe("IN_PREPARATION");
  });

  it("refuses an actor whose plant is at neither end", async () => {
    await expect(
      service.byId({
        actor: actor({ role: "LTN1_STOREKEEPER", siteId: "site-elsewhere" }),
        input: { requestId: "request-1" },
        repository: stubRepository({ findById: async () => detail() }),
      }),
    ).rejects.toThrow(ForbiddenActionError);
  });

  it("refuses a comment on a request from another plant", async () => {
    await expect(
      service.comment({
        actor: actor({ siteId: "site-elsewhere" }),
        input: { requestId: "request-1", content: "Bonjour" },
        repository: stubRepository({ findById: async () => detail() }),
      }),
    ).rejects.toThrow(ForbiddenActionError);
  });
});

describe("request creation", () => {
  it("rounds every requested quantity up to a whole pack", async () => {
    const written = captureCreate();

    await service.create({
      actor: actor(),
      input: {
        priority: "NORMAL",
        lines: [{ articleId: "article-1", requestedQuantity: 1_750 }],
      },
      repository: stubRepository({
        findArticlesForRequest: async () => [articleForRequest()],
        createWithHistory: written.capture,
      }),
    });

    // VPE 500: 1 750 becomes four packs.
    expect(written.options().lines[0]?.requestedQuantity).toBe(2_000);
    expect(written.options().lines[0]?.vpeSnapshot).toBe(500);
  });

  it("snapshots what the domain would have proposed beside what was asked", async () => {
    const written = captureCreate();

    await service.create({
      actor: actor(),
      input: {
        priority: "URGENT",
        lines: [{ articleId: "article-1", requestedQuantity: 500 }],
      },
      repository: stubRepository({
        findArticlesForRequest: async () => [articleForRequest()],
        createWithHistory: written.capture,
      }),
    });

    // Stock 1 200, min 1 500, max 3 000, VPE 500: need 1 800, four packs, 2 000.
    expect(written.options().lines[0]?.suggestedQuantity).toBe(2_000);
    expect(written.options().priority).toBe("URGENT");
  });

  it("names the supplying and consuming plants from the site table", async () => {
    const written = captureCreate();

    await service.create({
      actor: actor(),
      input: { priority: "NORMAL", lines: [{ articleId: "article-1", requestedQuantity: 500 }] },
      repository: stubRepository({
        findArticlesForRequest: async () => [articleForRequest()],
        createWithHistory: written.capture,
      }),
    });

    expect(written.options().fromSiteId).toBe(LTN4);
    expect(written.options().toSiteId).toBe(LTN1);
  });

  it("numbers the request after the highest code already issued", async () => {
    const written = captureCreate();

    await service.create({
      actor: actor(),
      input: { priority: "NORMAL", lines: [{ articleId: "article-1", requestedQuantity: 500 }] },
      repository: stubRepository({
        findArticlesForRequest: async () => [articleForRequest()],
        findLastRequestCode: async () => "DR-2026-0041",
        createWithHistory: written.capture,
      }),
    });

    expect(written.options().code).toMatch(/^DR-\d{4}-0042$/);
  });

  it("starts at 0001 in a year with no requests", async () => {
    const written = captureCreate();

    await service.create({
      actor: actor(),
      input: { priority: "NORMAL", lines: [{ articleId: "article-1", requestedQuantity: 500 }] },
      repository: stubRepository({
        findArticlesForRequest: async () => [articleForRequest()],
        createWithHistory: written.capture,
      }),
    });

    expect(written.options().code).toMatch(/^DR-\d{4}-0001$/);
  });

  it("does not reuse a number after a draft is deleted", async () => {
    // Counting rows was the original implementation. Deleting a draft lowers
    // the count, the next creation reuses a taken number, and the unique index
    // rejects it — which is exactly what the smoke test hit.
    const written = captureCreate();

    await service.create({
      actor: actor(),
      input: { priority: "NORMAL", lines: [{ articleId: "article-1", requestedQuantity: 500 }] },
      repository: stubRepository({
        findArticlesForRequest: async () => [articleForRequest()],
        // Twenty requests were created; three drafts were deleted since.
        findLastRequestCode: async () => "DR-2026-0020",
        createWithHistory: written.capture,
      }),
    });

    expect(written.options().code).toMatch(/^DR-\d{4}-0021$/);
  });

  it("refuses a line for an article the requesting plant does not hold", async () => {
    await expect(
      service.create({
        actor: actor(),
        input: { priority: "NORMAL", lines: [{ articleId: "unknown", requestedQuantity: 100 }] },
        repository: stubRepository({ findArticlesForRequest: async () => [] }),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses to build a request when the plants are not configured", async () => {
    await expect(
      service.create({
        actor: actor(),
        input: { priority: "NORMAL", lines: [{ articleId: "article-1", requestedQuantity: 100 }] },
        repository: stubRepository({ findSites: async () => [] }),
      }),
    ).rejects.toThrow(/sites/i);
  });
});

describe("request list and detail", () => {
  it("scopes the list to the actor's plant", async () => {
    let seenSiteId: string | null | undefined;

    await service.list({
      actor: actor(),
      input: { limit: 25, cursor: null, onlyMine: false, onlyLate: false },
      repository: stubRepository({
        findMany: async ({ siteId }) => {
          seenSiteId = siteId;
          return { rows: [], totalCount: 0 };
        },
      }),
    });

    expect(seenSiteId).toBe(LTN1);
  });

  it("marks a request past its commitment as late without changing its status", async () => {
    const page = await service.list({
      actor: actor(),
      input: { limit: 25, cursor: null, onlyMine: false, onlyLate: false },
      repository: stubRepository({
        findMany: async () => ({ rows: [listRow()], totalCount: 1 }),
      }),
    });

    expect(page.items[0]?.isLate).toBe(true);
    expect(page.items[0]?.status).toBe("IN_PREPARATION");
  });

  it("offers only the actions the role may actually perform", async () => {
    const found = await service.byId({
      actor: actor({ role: "LTN1_WAREHOUSE_MANAGER" }),
      input: { requestId: "request-1" },
      repository: stubRepository({
        findById: async () => detail({ status: "PENDING_APPROVAL" }),
      }),
    });

    expect(found.availableActions.map((entry) => entry.action).sort()).toEqual([
      "approve",
      "reject",
    ]);
  });

  it("offers nothing from a terminal state", async () => {
    const found = await service.byId({
      actor: actor({ role: "ADMIN", siteId: null }),
      input: { requestId: "request-1" },
      repository: stubRepository({ findById: async () => detail({ status: "CLOSED" }) }),
    });

    expect(found.availableActions).toEqual([]);
  });

  it("returns the trail and the discussion with the request", async () => {
    const found = await service.byId({
      actor: actor(),
      input: { requestId: "request-1" },
      repository: stubRepository({
        findById: async () => ({
          ...detail({ status: "PENDING_APPROVAL" }),
          statusHistory: [
            {
              id: "history-0",
              fromStatus: null,
              toStatus: "DRAFT" as const,
              action: "create",
              reason: null,
              occurredAt: new Date("2026-03-01"),
              user: { name: "Magasinier" },
            },
            {
              id: "history-1",
              fromStatus: "DRAFT" as const,
              toStatus: "PENDING_APPROVAL" as const,
              action: "submit",
              reason: null,
              occurredAt: new Date("2026-03-02"),
              user: null,
            },
          ],
          comments: [
            {
              id: "comment-0",
              content: "Urgent pour la ligne 3",
              createdAt: new Date("2026-03-02"),
              user: { name: "Magasinier" },
            },
          ],
        }),
      }),
    });

    expect(found.history.map((entry) => entry.action)).toEqual(["create", "submit"]);
    // A history row written by the nightly job has no author, and says so.
    expect(found.history[1]?.userName).toBeNull();
    expect(found.comments[0]?.content).toBe("Urgent pour la ligne 3");
  });

  it("falls back to \"create\" for a stored action the domain no longer knows", async () => {
    // The column is a plain string; narrowing here is what lets the screen
    // index the French label map without a cast.
    const found = await service.byId({
      actor: actor(),
      input: { requestId: "request-1" },
      repository: stubRepository({
        findById: async () => ({
          ...detail(),
          statusHistory: [
            {
              id: "history-0",
              fromStatus: null,
              toStatus: "DRAFT" as const,
              action: "someRetiredAction",
              reason: null,
              occurredAt: new Date("2026-03-01"),
              user: null,
            },
          ],
        }),
      }),
    });

    expect(found.history[0]?.action).toBe("create");
  });

  it("returns the five quantity columns on each line", async () => {
    const found = await service.byId({
      actor: actor(),
      input: { requestId: "request-1" },
      repository: stubRepository({
        findById: async () =>
          detail({
            status: "RECEIVED",
            lines: [
              {
                approvedQuantity: 400,
                preparedQuantity: 350,
                shippedQuantity: 350,
                receivedQuantity: 340,
              },
            ],
          }),
      }),
    });

    expect(found.lines[0]).toMatchObject({
      requestedQuantity: 500,
      approvedQuantity: 400,
      preparedQuantity: 350,
      shippedQuantity: 350,
      receivedQuantity: 340,
      vpeSnapshot: 100,
    });
  });

  it("keeps the extra pagination row out of the page", async () => {
    const page = await service.list({
      actor: actor(),
      input: { limit: 1, cursor: null, onlyMine: false, onlyLate: false },
      repository: stubRepository({
        findMany: async () => ({ rows: [listRow("a"), listRow("b")], totalCount: 2 }),
      }),
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("a");
  });

  it("reports an unknown request as not found on detail", async () => {
    await expect(
      service.byId({
        actor: actor(),
        input: { requestId: "gone" },
        repository: stubRepository({ findById: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("records a comment against the request", async () => {
    let written: { requestId: string; userId: string; content: string } | null = null;

    await service.comment({
      actor: actor(),
      input: { requestId: "request-1", content: "Livraison partielle acceptee" },
      repository: stubRepository({
        findById: async () => detail(),
        addComment: async (options) => {
          written = options;
        },
      }),
    });

    expect(written).toEqual({
      requestId: "request-1",
      userId: "user-1",
      content: "Livraison partielle acceptee",
    });
  });

  it("reports an unknown request as not found on comment", async () => {
    await expect(
      service.comment({
        actor: actor(),
        input: { requestId: "gone", content: "Bonjour" },
        repository: stubRepository({ findById: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("draft correction", () => {
  const draftLines = [{ articleId: "article-1", requestedQuantity: 600 }];

  it("replaces the lines and re-rounds them to whole packs", async () => {
    const calls: UpdateDraftOptions[] = [];

    await service.updateDraft({
      actor: actor(),
      input: { requestId: "request-1", priority: "HIGH", lines: draftLines },
      repository: stubRepository({
        findById: async () => detail({ status: "DRAFT", createdById: "user-1" }),
        findArticlesForRequest: async () => [articleForRequest()],
        updateDraft: async (options) => {
          calls.push(options);
        },
      }),
    });

    // VPE 500: 600 becomes two packs, exactly as a new request would.
    expect(calls[0]?.lines[0]?.requestedQuantity).toBe(1_000);
    expect(calls[0]?.priority).toBe("HIGH");
  });

  it("keeps the suggested quantity beside the corrected one", async () => {
    const calls: UpdateDraftOptions[] = [];

    await service.updateDraft({
      actor: actor(),
      input: { requestId: "request-1", priority: "NORMAL", lines: draftLines },
      repository: stubRepository({
        findById: async () => detail({ status: "DRAFT" }),
        findArticlesForRequest: async () => [articleForRequest()],
        updateDraft: async (options) => {
          calls.push(options);
        },
      }),
    });

    expect(calls[0]?.lines[0]?.suggestedQuantity).toBe(2_000);
  });

  it.each(["PENDING_APPROVAL", "APPROVED", "SHIPPED", "CLOSED", "CANCELLED"] as const)(
    "refuses to edit a request in %s",
    async (status) => {
      // Past DRAFT the request is in the process, and the process has its own
      // actions for changing it.
      await expect(
        service.updateDraft({
          actor: actor({ role: "ADMIN", siteId: null }),
          input: { requestId: "request-1", priority: "NORMAL", lines: draftLines },
          repository: stubRepository({ findById: async () => detail({ status }) }),
        }),
      ).rejects.toThrow(/brouillon/i);
    },
  );

  it("refuses to edit somebody else's draft", async () => {
    // Both storekeepers are at LTN1, so site scoping alone would allow this.
    await expect(
      service.updateDraft({
        actor: actor({ userId: "someone-else" }),
        input: { requestId: "request-1", priority: "NORMAL", lines: draftLines },
        repository: stubRepository({
          findById: async () => detail({ status: "DRAFT", createdById: "user-1" }),
        }),
      }),
    ).rejects.toThrow(ForbiddenActionError);
  });

  it("lets an administrator correct anybody's draft", async () => {
    await expect(
      service.updateDraft({
        actor: actor({ role: "ADMIN", siteId: null }),
        input: { requestId: "request-1", priority: "NORMAL", lines: draftLines },
        repository: stubRepository({
          findById: async () => detail({ status: "DRAFT", createdById: "somebody" }),
          findArticlesForRequest: async () => [articleForRequest()],
        }),
      }),
    ).resolves.toEqual({ requestId: "request-1" });
  });

  it("deletes a draft", async () => {
    const deleted: string[] = [];

    await service.deleteDraft({
      actor: actor(),
      input: { requestId: "request-1" },
      repository: stubRepository({
        findById: async () => detail({ status: "DRAFT", createdById: "user-1" }),
        deleteDraft: async (requestId) => {
          deleted.push(requestId);
        },
      }),
    });

    expect(deleted).toEqual(["request-1"]);
  });

  it("refuses to delete a submitted request", async () => {
    // Anything in the process is cancelled with a reason, never removed.
    await expect(
      service.deleteDraft({
        actor: actor({ role: "ADMIN", siteId: null }),
        input: { requestId: "request-1" },
        repository: stubRepository({ findById: async () => detail({ status: "SENT_TO_LTN4" }) }),
      }),
    ).rejects.toThrow(/brouillon/i);
  });

  it("reports an unknown draft as not found", async () => {
    await expect(
      service.deleteDraft({
        actor: actor(),
        input: { requestId: "gone" },
        repository: stubRepository({ findById: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("attachments", () => {
  const attachment = {
    id: "attachment-1",
    fileName: "bon-de-livraison.pdf",
    mimeType: "application/pdf",
    storagePath: "abc.pdf",
    request: { fromSiteId: LTN4, toSiteId: LTN1 },
  };

  it("lists what is attached to a request", async () => {
    const items = await service.listAttachments({
      actor: actor(),
      input: { requestId: "request-1" },
      repository: stubRepository({
        findById: async () => detail(),
        findAttachments: async () => [
          {
            id: "attachment-1",
            fileName: "bon-de-livraison.pdf",
            mimeType: "application/pdf",
            sizeBytes: 12_345,
            createdAt: new Date("2026-03-01"),
            uploadedBy: { name: "Magasinier" },
          },
        ],
      }),
    });

    expect(items[0]).toMatchObject({ fileName: "bon-de-livraison.pdf", uploadedByName: "Magasinier" });
  });

  it("refuses to list attachments on another plant's request", async () => {
    await expect(
      service.listAttachments({
        actor: actor({ siteId: "site-elsewhere" }),
        input: { requestId: "request-1" },
        repository: stubRepository({ findById: async () => detail() }),
      }),
    ).rejects.toThrow(ForbiddenActionError);
  });

  it("records the uploader, not whoever the payload names", async () => {
    const calls: { uploadedById: string; storagePath: string }[] = [];

    await service.recordAttachment({
      actor: actor({ userId: "magasinier" }),
      input: {
        requestId: "request-1",
        fileName: "bon.pdf",
        storagePath: "abc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
      },
      repository: stubRepository({
        findById: async () => detail(),
        recordAttachment: async (options) => {
          calls.push(options);
          return { id: "attachment-1" };
        },
      }),
    });

    expect(calls[0]?.uploadedById).toBe("magasinier");
  });

  it("refuses to attach to another plant's request", async () => {
    await expect(
      service.recordAttachment({
        actor: actor({ siteId: "site-elsewhere" }),
        input: {
          requestId: "request-1",
          fileName: "bon.pdf",
          storagePath: "abc.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
        },
        repository: stubRepository({ findById: async () => detail() }),
      }),
    ).rejects.toThrow(ForbiddenActionError);
  });

  it("resolves a download only for someone allowed to read the request", async () => {
    const found = await service.attachmentForDownload({
      actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
      input: { attachmentId: "attachment-1" },
      repository: stubRepository({ findAttachmentById: async () => attachment }),
    });

    expect(found.storagePath).toBe("abc.pdf");
  });

  it("refuses a download from a plant at neither end", async () => {
    // A file served by identifier with no authorisation is the classic way an
    // upload feature leaks a document to the wrong plant.
    await expect(
      service.attachmentForDownload({
        actor: actor({ siteId: "site-elsewhere" }),
        input: { attachmentId: "attachment-1" },
        repository: stubRepository({ findAttachmentById: async () => attachment }),
      }),
    ).rejects.toThrow(ForbiddenActionError);
  });

  it("reports an unknown attachment as not found", async () => {
    await expect(
      service.attachmentForDownload({
        actor: actor(),
        input: { attachmentId: "gone" },
        repository: stubRepository({ findAttachmentById: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("detaches a file without touching the bytes on disk", async () => {
    const deleted: string[] = [];

    await service.removeAttachment({
      actor: actor(),
      input: { attachmentId: "attachment-1" },
      repository: stubRepository({
        findAttachmentById: async () => attachment,
        deleteAttachment: async (attachmentId) => {
          deleted.push(attachmentId);
        },
      }),
    });

    expect(deleted).toEqual(["attachment-1"]);
  });
});

// --- Fixtures ---------------------------------------------------------------

function captureCreate() {
  const calls: CreateRequestOptions[] = [];
  return {
    capture: async (options: CreateRequestOptions) => {
      calls.push(options);
    },
    options: () => {
      const first = calls[0];
      if (first === undefined) throw new Error("createWithHistory was never called.");
      return first;
    },
  };
}

interface ReceiptTargetOptions {
  readonly currentStock?: number;
  readonly minThreshold?: number;
  readonly locationId?: string | null;
}

interface DispatchTargetOptions {
  readonly currentStock?: number;
  readonly minThreshold?: number;
  /** The supplying plant's level before the dispatch. */
  readonly alertLevel?: "NORMAL" | "WARNING" | "CRITICAL" | "RUPTURE";
  readonly lots?: readonly { id: string; quantity: number; fifoDate: Date }[];
}

/** The supplying plant's stock for one line, as `findDispatchTargets` returns it. */
function dispatchTarget(options: DispatchTargetOptions = {}) {
  const {
    currentStock = 5_000,
    minThreshold = 400,
    alertLevel = "NORMAL",
    lots = [
      { id: "lot-old", quantity: 3_000, fifoDate: new Date("2026-01-01") },
      { id: "lot-new", quantity: 2_000, fifoDate: new Date("2026-02-01") },
    ],
  } = options;

  return {
    id: "stock-ltn4",
    articleId: "article-0",
    currentStock,
    minThreshold: new Prisma.Decimal(minThreshold),
    alertLevel,
    article: {
      abcClass: "A" as const,
      reference: "REF-001",
      designation: "Boitier connecteur 12 voies",
    },
    // Copied into a mutable array: Prisma returns one, and the stub has to
    // match the repository's signature rather than a narrower readonly view.
    lots: [...lots],
  };
}

function receiptTarget(options: ReceiptTargetOptions = {}) {
  const { currentStock = 100, minThreshold = 400, locationId = "loc-known" } = options;

  return {
    id: "stock-1",
    articleId: "article-0",
    currentStock,
    minThreshold: new Prisma.Decimal(minThreshold),
    article: { abcClass: "A" as const },
    lots: locationId === null ? [] : [{ storageLocationId: locationId }],
  };
}

function articleForRequest() {
  return {
    currentStock: 1_200,
    minThreshold: new Prisma.Decimal(1_500),
    maxThreshold: new Prisma.Decimal(3_000),
    article: { id: "article-1", reference: "REF-001", vpe: 500, abcClass: "A" as const },
  };
}

function listRow(id = "request-1"): RequestRow {
  return {
    id,
    code: "DR-2026-0001",
    status: "IN_PREPARATION",
    priority: "NORMAL",
    // Committed in the past and not yet received: late, but still in preparation.
    expectedDeliveryAt: new Date("2020-01-01"),
    receivedAt: null,
    createdAt: new Date("2026-03-01"),
    fromSite: { code: "LTN4" },
    toSite: { code: "LTN1" },
    createdBy: { name: "Magasinier" },
    lines: [{ requestedQuantity: 500 }],
  };
}

describe("late-request warnings (ADR 0003)", () => {
  const overdue = (overrides: Record<string, unknown> = {}) => ({
    id: "request-1",
    code: "DR-2026-0042",
    status: "SENT_TO_LTN4" as const,
    expectedDeliveryAt: new Date("2026-08-25"),
    createdById: "user-storekeeper",
    toSiteId: LTN1,
    ...overrides,
  });

  it("tells the requester and the approver, once", async () => {
    const written: { userId: string; type: string }[] = [];

    const result = await service.notifyLateRequests({
      asOf: new Date("2026-09-01"),
      repository: stubRepository({
        findRequestsBecomingLate: async () => [overdue()],
        findRecipients: async () => ["user-manager"],
        recordNotifications: async (writes) => {
          written.push(...writes.map((w) => ({ userId: w.userId, type: w.type })));
          return writes.length;
        },
      }),
    });

    expect(result).toEqual({ late: 1, notified: 2 });
    expect(written.map((w) => w.userId).sort()).toEqual(["user-manager", "user-storekeeper"]);
    expect(written.every((w) => w.type === "REQUEST_LATE")).toBe(true);
  });

  it("does not tell the same person twice when they are both", async () => {
    // The storekeeper who raised it may also hold the approving role in a small
    // team; two identical warnings in one menu reads as a bug.
    const written: string[] = [];

    await service.notifyLateRequests({
      asOf: new Date("2026-09-01"),
      repository: stubRepository({
        findRequestsBecomingLate: async () => [overdue({ createdById: "user-manager" })],
        findRecipients: async () => ["user-manager"],
        recordNotifications: async (writes) => {
          written.push(...writes.map((w) => w.userId));
          return writes.length;
        },
      }),
    });

    expect(written).toEqual(["user-manager"]);
  });

  it("reports how many days late, through the domain", async () => {
    let body = "";

    await service.notifyLateRequests({
      asOf: new Date("2026-09-01"),
      repository: stubRepository({
        findRequestsBecomingLate: async () => [
          overdue({ expectedDeliveryAt: new Date("2026-08-25") }),
        ],
        findRecipients: async () => [],
        recordNotifications: async (writes) => {
          body = writes[0]?.body ?? "";
          return writes.length;
        },
      }),
    });

    expect(body).toContain("7 jour(s)");
  });

  it("re-checks lateness in the domain rather than trusting the query", async () => {
    // The WHERE clause narrows the rows; `assessLateness` decides what late
    // means. A row that slipped through — a terminal status, or a date that is
    // not actually past — must produce nothing.
    const written: string[] = [];

    const result = await service.notifyLateRequests({
      asOf: new Date("2026-09-01"),
      repository: stubRepository({
        findRequestsBecomingLate: async () => [
          overdue({ status: "CANCELLED" }),
          overdue({ id: "request-2", expectedDeliveryAt: new Date("2026-09-30") }),
        ],
        findRecipients: async () => ["user-manager"],
        recordNotifications: async (writes) => {
          written.push(...writes.map((w) => w.userId));
          return writes.length;
        },
      }),
    });

    expect(written).toEqual([]);
    expect(result.notified).toBe(0);
  });

  it("asks nobody anything when nothing is overdue", async () => {
    // The common case every night: no recipient query, no write.
    let askedRecipients = false;

    const result = await service.notifyLateRequests({
      asOf: new Date("2026-09-01"),
      repository: stubRepository({
        findRequestsBecomingLate: async () => [],
        findRecipients: async () => {
          askedRecipients = true;
          return [];
        },
      }),
    });

    expect(result).toEqual({ late: 0, notified: 0 });
    expect(askedRecipients).toBe(false);
  });
});
