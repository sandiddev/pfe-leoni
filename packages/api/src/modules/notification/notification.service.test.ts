import { describe, expect, it } from "vitest";

import type { Actor } from "../../context";
import type { NotificationRepository, NotificationRow } from "./notification.repository";
import * as service from "./notification.service";

/**
 * The notification centre, without a database.
 *
 * The rule this module lives or dies by is that every operation is bounded by
 * the caller's own identity and never by anything the client sends. The tests
 * below assert that boundary, and that a malformed payload degrades into a
 * missing link rather than a crashed screen.
 */

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "user-1",
    name: "Test",
    email: "test@leoni.tn",
    role: "LTN1_STOREKEEPER",
    siteId: "site-ltn1",
    ...overrides,
  };
}

function stubRepository(overrides: Partial<NotificationRepository> = {}): NotificationRepository {
  const notStubbed = (name: string) => () => {
    throw new Error(`${name} was called but not stubbed in this test.`);
  };

  return {
    findMany: notStubbed("findMany"),
    countUnread: notStubbed("countUnread"),
    markRead: notStubbed("markRead"),
    markAllRead: notStubbed("markAllRead"),
    ...overrides,
  };
}

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "notification-1",
    type: "REQUEST_APPROVED",
    title: "Valider — DR-2026-0001",
    body: null,
    payload: { requestId: "request-1", code: "DR-2026-0001" },
    readAt: null,
    createdAt: new Date("2026-03-01"),
    ...overrides,
  };
}

const listInput = { limit: 25, cursor: null, onlyUnread: false } as const;

describe("notification list", () => {
  it("reads only the caller's own notifications", async () => {
    let seenUserId: string | undefined;

    await service.list({
      actor: actor({ userId: "user-42" }),
      input: listInput,
      repository: stubRepository({
        findMany: async (userId) => {
          seenUserId = userId;
          return { rows: [], totalCount: 0 };
        },
      }),
    });

    expect(seenUserId).toBe("user-42");
  });

  it("exposes the request identifier so the notification can link to it", async () => {
    const page = await service.list({
      actor: actor(),
      input: listInput,
      repository: stubRepository({
        findMany: async () => ({ rows: [row()], totalCount: 1 }),
      }),
    });

    expect(page.items[0]?.requestId).toBe("request-1");
  });

  it("degrades a payload with no request into a notification with no link", async () => {
    const page = await service.list({
      actor: actor(),
      input: listInput,
      repository: stubRepository({
        findMany: async () => ({
          rows: [row({ type: "STOCK_RUPTURE", payload: { articleId: "article-1" } })],
          totalCount: 1,
        }),
      }),
    });

    expect(page.items[0]?.requestId).toBeNull();
  });

  it.each([null, "not an object", 42, { requestId: 7 }])(
    "survives the malformed payload %s",
    async (payload) => {
      // The column is Json: nothing guarantees a shape, and a screen should not
      // crash because an old row was written differently.
      const page = await service.list({
        actor: actor(),
        input: listInput,
        repository: stubRepository({
          findMany: async () => ({ rows: [row({ payload })], totalCount: 1 }),
        }),
      });

      expect(page.items[0]?.requestId).toBeNull();
    },
  );

  it("keeps the extra pagination row out of the page", async () => {
    const page = await service.list({
      actor: actor(),
      input: { ...listInput, limit: 1 },
      repository: stubRepository({
        findMany: async () => ({
          rows: [row({ id: "a" }), row({ id: "b" })],
          totalCount: 2,
        }),
      }),
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("a");
  });

  it("reports no next page when the extra row is absent", async () => {
    const page = await service.list({
      actor: actor(),
      input: listInput,
      repository: stubRepository({
        findMany: async () => ({ rows: [row()], totalCount: 1 }),
      }),
    });

    expect(page.nextCursor).toBeNull();
  });
});

describe("notification read state", () => {
  it("counts only the caller's unread notifications", async () => {
    let seenUserId: string | undefined;

    const result = await service.unreadCount({
      actor: actor({ userId: "user-42" }),
      repository: stubRepository({
        countUnread: async (userId) => {
          seenUserId = userId;
          return 3;
        },
      }),
    });

    expect(seenUserId).toBe("user-42");
    expect(result.count).toBe(3);
  });

  it("marks one notification read, scoped to the caller", async () => {
    let seen: { userId: string; notificationId: string } | null = null;

    await service.markRead({
      actor: actor({ userId: "user-42" }),
      input: { notificationId: "notification-9" },
      repository: stubRepository({
        markRead: async (userId, notificationId) => {
          seen = { userId, notificationId };
        },
      }),
    });

    // Somebody else's identifier matches nothing rather than erroring, which is
    // what stops the API confirming that a notification exists.
    expect(seen).toEqual({ userId: "user-42", notificationId: "notification-9" });
  });

  it("marks everything read and reports how many that was", async () => {
    const result = await service.markAllRead({
      actor: actor(),
      repository: stubRepository({ markAllRead: async () => 7 }),
    });

    expect(result.count).toBe(7);
  });
});
