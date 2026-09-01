import { describe, expect, it } from "vitest";

import { Prisma } from "@leoni/db";

import type { Actor } from "../../context";
import type { AlertRepository, AlertRow } from "./alert.repository";
import * as service from "./alert.service";

/**
 * What the board decides, without a database.
 *
 * The severity is already a column and the arithmetic is already tested in
 * `@leoni/core`. What is worth asserting here is the part that only exists in
 * this service: the order a storekeeper reads the board in, and the fact that
 * a summary reports every level rather than only the ones with rows.
 */

const LTN1 = "site-ltn1";
const LTN4 = "site-ltn4";

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

function stubRepository(overrides: Partial<AlertRepository> = {}): AlertRepository {
  const notStubbed = (name: string) => () => {
    throw new Error(`${name} was called but not stubbed in this test.`);
  };

  return {
    findBoard: notStubbed("findBoard"),
    countByLevel: notStubbed("countByLevel"),
    // No row written means the class defaults apply, which is the normal path.
    findParameterForClass: async () => null,
    ...overrides,
  };
}

interface RowOptions {
  readonly id?: string;
  readonly reference?: string;
  readonly alertLevel?: "NORMAL" | "WARNING" | "CRITICAL" | "RUPTURE";
  readonly currentStock?: number;
  readonly averageDailyConsumption?: number;
  readonly siteId?: string;
  readonly override?: ReturnType<typeof override> | null;
}

function row(options: RowOptions = {}): AlertRow {
  const {
    id = "stock-1",
    reference = "REF-001",
    alertLevel = "CRITICAL",
    currentStock = 300,
    averageDailyConsumption = 100,
    siteId = LTN1,
  } = options;

  return {
    id,
    currentStock,
    averageDailyConsumption: new Prisma.Decimal(averageDailyConsumption),
    minThreshold: new Prisma.Decimal(400),
    maxThreshold: new Prisma.Decimal(700),
    safetyStock: new Prisma.Decimal(200),
    alertLevel,
    lastRecalculatedAt: null,
    site: { id: siteId, code: siteId === LTN1 ? "LTN1" : "LTN4" },
    article: {
      id: `article-${reference}`,
      reference,
      designation: `Article ${reference}`,
      abcClass: "A",
      vpe: 100,
      leadTimeDays: 2,
      isActive: true,
      parameter: options.override ?? null,
    },
  };
}

/** A written article-level override, in the shape Prisma returns it. */
function override(safetyDays: number, extraCoverageDays: number) {
  return {
    safetyDays: new Prisma.Decimal(safetyDays),
    extraCoverageDays: new Prisma.Decimal(extraCoverageDays),
    averagingWindowDays: 30,
    warningMarginRatio: new Prisma.Decimal(0.2),
  };
}

const boardInput = { limit: 25, cursor: null, includeNormal: false } as const;

describe("alert board - ordering", () => {
  it("puts the most severe first whatever order the database returned", async () => {
    const page = await service.board({
      actor: actor(),
      input: boardInput,
      repository: stubRepository({
        findBoard: async () => ({
          rows: [
            row({ id: "w", reference: "W", alertLevel: "WARNING" }),
            row({ id: "r", reference: "R", alertLevel: "RUPTURE", currentStock: 0 }),
            row({ id: "c", reference: "C", alertLevel: "CRITICAL" }),
          ],
          totalCount: 3,
        }),
      }),
    });

    expect(page.items.map((item) => item.alertLevel)).toEqual([
      "RUPTURE",
      "CRITICAL",
      "WARNING",
    ]);
  });

  it("puts the article that runs out soonest first within one severity", async () => {
    const page = await service.board({
      actor: actor(),
      input: boardInput,
      repository: stubRepository({
        findBoard: async () => ({
          rows: [
            // 300 units at 20/day is 15 days of cover; at 100/day it is 3.
            row({ id: "slow", reference: "SLOW", averageDailyConsumption: 20 }),
            row({ id: "fast", reference: "FAST", averageDailyConsumption: 100 }),
          ],
          totalCount: 2,
        }),
      }),
    });

    expect(page.items.map((item) => item.reference)).toEqual(["FAST", "SLOW"]);
  });

  it("sorts an unconsumed article last rather than as zero days of cover", async () => {
    const page = await service.board({
      actor: actor(),
      input: boardInput,
      repository: stubRepository({
        findBoard: async () => ({
          rows: [
            row({ id: "dead", reference: "DEAD", averageDailyConsumption: 0 }),
            row({ id: "live", reference: "LIVE", averageDailyConsumption: 100 }),
          ],
          totalCount: 2,
        }),
      }),
    });

    expect(page.items[0]?.reference).toBe("LIVE");
    expect(page.items[1]?.coverageDays).toBeNull();
  });

  it("breaks a tie on the reference so two loads agree", async () => {
    const page = await service.board({
      actor: actor(),
      input: boardInput,
      repository: stubRepository({
        findBoard: async () => ({
          rows: [row({ id: "b", reference: "B" }), row({ id: "a", reference: "A" })],
          totalCount: 2,
        }),
      }),
    });

    expect(page.items.map((item) => item.reference)).toEqual(["A", "B"]);
  });
});

describe("alert board - suggestion and scoping", () => {
  it("attaches the quantity to order, rounded up to whole packs", async () => {
    const page = await service.board({
      actor: actor(),
      input: boardInput,
      // 100/day, lead 2 days, class A defaults (2 safety, 3 extra):
      // min 400, max 700, stock 300 -> need 400 -> 4 packs of 100.
      repository: stubRepository({
        findBoard: async () => ({ rows: [row()], totalCount: 1 }),
      }),
    });

    const item = page.items[0];
    expect(item?.isReplenishmentNeeded).toBe(true);
    expect(item?.need).toBe(400);
    expect(item?.boxCount).toBe(4);
    expect(item?.recommendedQuantity).toBe(400);
  });

  it("uses a written parameter row over the class default", async () => {
    const page = await service.board({
      actor: actor(),
      input: boardInput,
      repository: stubRepository({
        findBoard: async () => ({ rows: [row()], totalCount: 1 }),
        findParameterForClass: async () => parameterRow(),
      }),
    });

    // 100/day, lead 2, safety 1, extra 10 -> min 300, max 1300, stock 300.
    // Stock is at Min, so a replenishment is due: need 1000, 10 packs.
    expect(page.items[0]?.recommendedQuantity).toBe(1_000);
  });

  it("prefers an article's own parameters over its class default", async () => {
    // The board and the article detail page must propose the same quantity:
    // two answers to the same question is worse than either answer.
    const page = await service.board({
      actor: actor(),
      input: boardInput,
      repository: stubRepository({
        findBoard: async () => ({
          rows: [row({ override: override(4, 0) })],
          totalCount: 1,
        }),
      }),
    });

    // 100/day, lead 2, override safety 4 -> min 600, extra 0 -> max 600.
    // Stock 300 is below Min, so need 300, rounded to 3 packs of 100.
    expect(page.items[0]?.recommendedQuantity).toBe(300);
  });

  it("scopes the board to the actor's plant", async () => {
    let seenSiteId: string | null | undefined;

    await service.board({
      actor: actor(),
      input: boardInput,
      repository: stubRepository({
        findBoard: async ({ siteId }) => {
          seenSiteId = siteId;
          return { rows: [], totalCount: 0 };
        },
      }),
    });

    expect(seenSiteId).toBe(LTN1);
  });

  it("refuses a single-site actor asking for the other plant", async () => {
    await expect(
      service.board({
        actor: actor({ siteId: LTN1 }),
        input: { ...boardInput, siteId: LTN4 },
        repository: stubRepository(),
      }),
    ).rejects.toThrow(/votre site/i);
  });

  it("lets a cross-site role see both plants", async () => {
    let seenSiteId: string | null | undefined;

    await service.board({
      actor: actor({ role: "LOGISTICS_MANAGER", siteId: null }),
      input: boardInput,
      repository: stubRepository({
        findBoard: async ({ siteId }) => {
          seenSiteId = siteId;
          return { rows: [], totalCount: 0 };
        },
      }),
    });

    expect(seenSiteId).toBeNull();
  });

  it("keeps the extra pagination row out of the page", async () => {
    const rows = [row({ id: "a", reference: "A" }), row({ id: "b", reference: "B" })];

    const page = await service.board({
      actor: actor(),
      input: { ...boardInput, limit: 1 },
      repository: stubRepository({ findBoard: async () => ({ rows, totalCount: 2 }) }),
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("a");
  });

  it("reports no next page when the extra row is absent", async () => {
    const page = await service.board({
      actor: actor(),
      input: { ...boardInput, limit: 5 },
      repository: stubRepository({
        findBoard: async () => ({ rows: [row()], totalCount: 1 }),
      }),
    });

    expect(page.nextCursor).toBeNull();
  });
});

describe("alert summary", () => {
  it("reports every level, including the ones with no rows", async () => {
    // A tile that disappears when the news is good is a bug, not a saving.
    const counts = await service.summary({
      actor: actor(),
      input: {},
      repository: stubRepository({
        countByLevel: async () => [
          { alertLevel: "CRITICAL", count: 3 },
          { alertLevel: "NORMAL", count: 120 },
        ],
      }),
    });

    expect(counts).toEqual({
      NORMAL: 120,
      WARNING: 0,
      CRITICAL: 3,
      RUPTURE: 0,
      actionable: 3,
    });
  });

  it("counts the two levels at or below the reorder point as actionable", async () => {
    const counts = await service.summary({
      actor: actor(),
      input: {},
      repository: stubRepository({
        countByLevel: async () => [
          { alertLevel: "WARNING", count: 7 },
          { alertLevel: "CRITICAL", count: 3 },
          { alertLevel: "RUPTURE", count: 2 },
        ],
      }),
    });

    // A warning has not reached the reorder point, so it is not actionable yet.
    expect(counts.actionable).toBe(5);
  });

  it("scopes the summary to the actor's plant", async () => {
    let seenSiteId: string | null | undefined;

    await service.summary({
      actor: actor(),
      input: {},
      repository: stubRepository({
        countByLevel: async (siteId) => {
          seenSiteId = siteId;
          return [];
        },
      }),
    });

    expect(seenSiteId).toBe(LTN1);
  });
});

function parameterRow() {
  return {
    id: "parameter-a",
    abcClass: "A" as const,
    articleId: null,
    safetyDays: new Prisma.Decimal(1),
    extraCoverageDays: new Prisma.Decimal(10),
    averagingWindowDays: 30,
    warningMarginRatio: new Prisma.Decimal(0.2),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}
