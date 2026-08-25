import { describe, expect, it } from "vitest";

import { DEFAULT_CLASS_PARAMETERS, NotFoundError } from "@leoni/core";
import { Prisma } from "@leoni/db";

import type { Actor } from "../../context";
import type { ArticleRepository, StockItemRow } from "./article.repository";
import * as service from "./article.service";

/**
 * Service-level rules, without a database.
 *
 * What is worth testing here is not SQL — the repository owns that — but the
 * decisions the service makes on the way: which site an actor actually gets
 * whatever they asked for, where the extra pagination row goes, how an article
 * with no consumption sorts, and whether a master-data edit leaves a trail.
 *
 * Every one of those was previously uncovered, because the service imported its
 * repository directly and could not be exercised without Postgres.
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

interface RowOptions {
  readonly id?: string;
  readonly reference?: string;
  readonly siteId?: string;
  readonly currentStock?: number;
  readonly averageDailyConsumption?: number;
  readonly abcClass?: "A" | "B" | "C";
}

/** One row shaped exactly as `listSelection` returns it. */
function row(options: RowOptions = {}): StockItemRow {
  const {
    id = "stock-1",
    reference = "REF-001",
    siteId = LTN1,
    currentStock = 1_000,
    averageDailyConsumption = 100,
    abcClass = "A",
  } = options;

  return {
    id,
    currentStock,
    averageDailyConsumption: new Prisma.Decimal(averageDailyConsumption),
    minThreshold: new Prisma.Decimal(400),
    maxThreshold: new Prisma.Decimal(700),
    safetyStock: new Prisma.Decimal(200),
    alertLevel: "NORMAL",
    lastRecalculatedAt: null,
    site: { id: siteId, code: siteId === LTN1 ? "LTN1" : "LTN4" },
    article: {
      id: `article-${reference}`,
      reference,
      designation: `Article ${reference}`,
      abcClass,
      vpe: 100,
      leadTimeDays: 2,
      isActive: true,
    },
  };
}

/**
 * A repository whose every method fails loudly.
 *
 * Overriding only what a test needs is what keeps each case readable; a method
 * a test did not expect to be called throws with its own name rather than
 * returning a plausible empty value and passing for the wrong reason.
 */
function stubRepository(overrides: Partial<ArticleRepository> = {}): ArticleRepository {
  const notStubbed = (name: string) => () => {
    throw new Error(`${name} was called but not stubbed in this test.`);
  };

  return {
    findMany: notStubbed("findMany"),
    findByArticleAndSite: notStubbed("findByArticleAndSite"),
    findLots: notStubbed("findLots"),
    findRecentMovements: notStubbed("findRecentMovements"),
    findThresholdHistory: notStubbed("findThresholdHistory"),
    // Every list and detail call loads these; returning null means "no row
    // written", which is the DEFAULT_CLASS_PARAMETERS path.
    findParameterForClass: async () => null,
    findParameterForArticle: notStubbed("findParameterForArticle"),
    findRawArticle: notStubbed("findRawArticle"),
    updateWithAudit: notStubbed("updateWithAudit"),
    ...overrides,
  };
}

const listInput = {
  limit: 25,
  cursor: null,
  onlyReplenishable: false,
  includeInactive: false,
  sortBy: "reference",
  sortDirection: "asc",
} as const;

describe("article service — site scoping (brief section 4)", () => {
  it("refuses a single-site actor asking for the other plant", async () => {
    // The filter is a convenience for the user, never an authorisation input.
    await expect(
      service.list({
        actor: actor({ siteId: LTN1 }),
        input: { ...listInput, siteId: LTN4 },
        repository: stubRepository(),
      }),
    ).rejects.toThrow(/votre site/i);
  });

  it("scopes a single-site actor to its own plant when none is requested", async () => {
    let seenSiteId: string | null | undefined;

    await service.list({
      actor: actor({ siteId: LTN1 }),
      input: listInput,
      repository: stubRepository({
        findMany: async ({ siteId }) => {
          seenSiteId = siteId;
          return { rows: [], totalCount: 0 };
        },
      }),
    });

    expect(seenSiteId).toBe(LTN1);
  });

  it("fails closed for a single-site account with no plant assigned", async () => {
    // A misconfigured account must see nothing, not everything.
    await expect(
      service.list({
        actor: actor({ siteId: null }),
        input: listInput,
        repository: stubRepository(),
      }),
    ).rejects.toThrow(/aucun site/i);
  });

  it("lets a cross-site role see both plants", async () => {
    let seenSiteId: string | null | undefined = "unset";

    await service.list({
      actor: actor({ role: "LOGISTICS_MANAGER", siteId: null }),
      input: listInput,
      repository: stubRepository({
        findMany: async ({ siteId }) => {
          seenSiteId = siteId;
          return { rows: [], totalCount: 0 };
        },
      }),
    });

    // null means "no restriction", which only a cross-site role ever gets.
    expect(seenSiteId).toBeNull();
  });

  it("blocks a detail lookup on another plant's row even with the right id", async () => {
    // A WHERE clause cannot protect a findUnique, so the row that came back is
    // re-checked. Without this an LTN1 user reads LTN4 stock by guessing an id.
    await expect(
      service.byId({
        actor: actor({ siteId: LTN1 }),
        input: { articleId: "article-REF-001" },
        repository: stubRepository({
          findByArticleAndSite: async () => row({ siteId: LTN4 }),
        }),
      }),
    ).rejects.toThrow(/site/i);
  });
});

describe("article service — the detail screen", () => {
  it("assembles lots FIFO-ordered, the journal, the history and the legacy comparison", async () => {
    const detail = await service.byId({
      actor: actor({ siteId: LTN1 }),
      input: { articleId: "article-REF-001" },
      repository: stubRepository({
        findByArticleAndSite: async () => row({ averageDailyConsumption: 100 }),
        findLots: async () => [
          {
            id: "lot-old",
            quantity: 400,
            fifoDate: new Date("2026-01-01"),
            storageLocation: { code: "A-01" },
          },
          {
            id: "lot-new",
            quantity: 600,
            fifoDate: new Date("2026-06-01"),
            storageLocation: { code: "A-02" },
          },
        ],
        findRecentMovements: async () => [
          {
            id: "mov-1",
            type: "EXIT",
            quantity: 100,
            occurredAt: new Date("2026-06-02"),
            reference: "BL-42",
            user: { name: "Magasinier LTN1" },
          },
        ],
        findThresholdHistory: async () => [
          {
            computedAt: new Date("2026-06-01"),
            averageDailyConsumption: new Prisma.Decimal(100),
            minThreshold: new Prisma.Decimal(400),
            maxThreshold: new Prisma.Decimal(700),
            safetyStock: new Prisma.Decimal(200),
            trigger: "SCHEDULED",
          },
        ],
      }),
    });

    expect(detail.lots.map((lot) => lot.locationCode)).toStrictEqual(["A-01", "A-02"]);
    expect(detail.recentMovements[0]?.userName).toBe("Magasinier LTN1");
    // Decimal must not reach the browser: a threshold that arrives as
    // `{ s: 1, e: 3, d: [400] }` renders as nothing anyone can read.
    expect(detail.thresholdHistory[0]?.minThreshold).toBe(400);
    expect(typeof detail.coverageDays).toBe("number");

    // The study's original model, for the comparison screen: Min = 100 x 2.
    expect(detail.legacyThresholds.min).toBe(200);
  });

  it("raises NotFoundError when the article does not exist at the actor's plant", async () => {
    // Same error as "you may not see it", on purpose: telling the two apart
    // would let a user enumerate the other plant's catalogue by identifier.
    await expect(
      service.byId({
        actor: actor({ siteId: LTN1 }),
        input: { articleId: "article-does-not-exist" },
        repository: stubRepository({ findByArticleAndSite: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("reports a null author for a movement written by the nightly job", async () => {
    const detail = await service.byId({
      actor: actor({ siteId: LTN1 }),
      input: { articleId: "article-REF-001" },
      repository: stubRepository({
        findByArticleAndSite: async () => row(),
        findLots: async () => [],
        findRecentMovements: async () => [
          {
            id: "mov-job",
            type: "ADJUSTMENT",
            quantity: 5,
            occurredAt: new Date("2026-06-02"),
            reference: null,
            user: null,
          },
        ],
        findThresholdHistory: async () => [],
      }),
    });

    expect(detail.recentMovements[0]?.userName).toBeNull();
  });
});

describe("article service — pagination", () => {
  it("does not return the extra row fetched to detect the next page", async () => {
    // The repository takes limit + 1 on purpose; the last one is a probe.
    const rows = Array.from({ length: 4 }, (_, index) =>
      row({ id: `stock-${String(index)}`, reference: `REF-00${String(index)}` }),
    );

    const page = await service.list({
      actor: actor(),
      input: { ...listInput, limit: 3 },
      repository: stubRepository({
        findMany: async () => ({ rows, totalCount: 10 }),
      }),
    });

    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBe("stock-2");
    expect(page.totalCount).toBe(10);
  });

  it("reports no next cursor on the last page", async () => {
    const page = await service.list({
      actor: actor(),
      input: { ...listInput, limit: 3 },
      repository: stubRepository({
        findMany: async () => ({ rows: [row()], totalCount: 1 }),
      }),
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });
});

describe("article service — coverage sorting", () => {
  /** Three articles: 20 days of cover, 2 days, and one not consumed at all. */
  const mixed = [
    row({ id: "slow", reference: "SLOW", currentStock: 2_000, averageDailyConsumption: 100 }),
    row({ id: "fast", reference: "FAST", currentStock: 200, averageDailyConsumption: 100 }),
    row({ id: "dead", reference: "DEAD", currentStock: 500, averageDailyConsumption: 0 }),
  ];

  it("puts an article with no consumption last when sorting ascending", async () => {
    const page = await service.list({
      actor: actor(),
      input: { ...listInput, sortBy: "coverageDays", sortDirection: "asc" },
      repository: stubRepository({ findMany: async () => ({ rows: mixed, totalCount: 3 }) }),
    });

    expect(page.items.map((item) => item.stockItemId)).toStrictEqual(["fast", "slow", "dead"]);
    expect(page.items.at(-1)?.coverageDays).toBeNull();
  });

  it("also puts it last when sorting descending", async () => {
    // A null coverage means "not moving", which is not the best-covered
    // article. Sorting it to the top of a descending list would read as though
    // it were, which is why the service does not simply reverse the array.
    const page = await service.list({
      actor: actor(),
      input: { ...listInput, sortBy: "coverageDays", sortDirection: "desc" },
      repository: stubRepository({ findMany: async () => ({ rows: mixed, totalCount: 3 }) }),
    });

    expect(page.items.map((item) => item.stockItemId)).toStrictEqual(["dead", "slow", "fast"]);
  });
});

describe("article service — parameters", () => {
  it("falls back to the class defaults when no parameter row exists", async () => {
    // 100/day, lead time 2, class A: safety 2 days, extra coverage 3 days.
    // Min = 100 x (2 + 2) = 400, Max = 400 + 100 x 3 = 700.
    const page = await service.list({
      actor: actor(),
      input: listInput,
      repository: stubRepository({
        findMany: async () => ({
          rows: [row({ abcClass: "A", averageDailyConsumption: 100 })],
          totalCount: 1,
        }),
        findParameterForClass: async () => null,
      }),
    });

    const item = page.items[0];
    expect(DEFAULT_CLASS_PARAMETERS.A.safetyDays).toBe(2);
    // The suggestion is computed from the class defaults, not from a flat 1/10
    // fallback — which is what the service used to apply to every class.
    expect(item?.recommendedQuantity).toBe(0); // stock 1 000 is above Min
    expect(item?.isReplenishmentNeeded).toBe(false);
  });

  it("lets a stored parameter row override the class defaults", async () => {
    // Section 3.4: the logistics team must be able to retune a class from the
    // Parameters screen without a redeployment. If the service ignored the row
    // and used the defaults, that screen would be decorative.
    const page = await service.list({
      actor: actor(),
      input: listInput,
      repository: stubRepository({
        findMany: async () => ({
          rows: [row({ abcClass: "A", currentStock: 100, averageDailyConsumption: 100 })],
          totalCount: 1,
        }),
        findParameterForClass: async () => ({
          id: "param-a",
          abcClass: "A",
          articleId: null,
          // Far wider than the class-A default of 2 / 3 days.
          safetyDays: new Prisma.Decimal(10),
          extraCoverageDays: new Prisma.Decimal(20),
          averagingWindowDays: 30,
          warningMarginRatio: new Prisma.Decimal(0.2),
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
        }),
      }),
    });

    // Min = 100 x (2 + 10) = 1 200; Max = 1 200 + 100 x 20 = 3 200.
    // Need = 3 200 - 100 = 3 100, which is 31 boxes of 100.
    expect(page.items[0]?.recommendedQuantity).toBe(3_100);
  });

  it("proposes whole boxes for an article at or below its reorder point", async () => {
    const page = await service.list({
      actor: actor(),
      input: listInput,
      repository: stubRepository({
        findMany: async () => ({
          rows: [row({ currentStock: 100, averageDailyConsumption: 100 })],
          totalCount: 1,
        }),
      }),
    });

    const item = page.items[0];
    expect(item?.isReplenishmentNeeded).toBe(true);
    // VPE is 100, so whatever the need, the proposal is a multiple of it.
    expect((item?.recommendedQuantity ?? 0) % 100).toBe(0);
    expect(item?.recommendedQuantity).toBeGreaterThanOrEqual(item?.need ?? 0);
  });
});

describe("article service — update", () => {
  const existing = {
    designation: "Ancienne designation",
    vpe: 100,
    leadTimeDays: 2,
    abcClass: "A" as const,
    isActive: true,
  };

  const input = {
    articleId: "article-1",
    designation: "Nouvelle designation",
    vpe: 100,
    leadTimeDays: 2,
    abcClass: "A" as const,
    isActive: true,
  };

  it("raises NotFoundError — not a bare Error — for a missing article", async () => {
    // A plain Error would reach the tRPC formatter unrecognised and surface as
    // a 500 with its message withheld.
    await expect(
      service.update({
        actor: actor({ role: "ADMIN", siteId: null }),
        input,
        repository: stubRepository({ findRawArticle: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("writes an audit entry naming the actor and both sides of the change", async () => {
    let written: Parameters<ArticleRepository["updateWithAudit"]>[0] | undefined;

    await service.update({
      actor: actor({ userId: "admin-7", role: "ADMIN", siteId: null }),
      input,
      repository: stubRepository({
        findRawArticle: async () => existing,
        updateWithAudit: async (options) => {
          written = options;
        },
      }),
    });

    expect(written?.audit.entity).toBe("Article");
    expect(written?.audit.action).toBe("UPDATE");
    expect(written?.audit.actorId).toBe("admin-7");
    expect(written?.audit.before?.["designation"]).toBe("Ancienne designation");
    expect(written?.audit.after?.["designation"]).toBe("Nouvelle designation");
  });

  it("records only the fields the operation can change", async () => {
    let written: Parameters<ArticleRepository["updateWithAudit"]>[0] | undefined;

    await service.update({
      actor: actor({ role: "ADMIN", siteId: null }),
      input,
      repository: stubRepository({
        findRawArticle: async () => existing,
        updateWithAudit: async (options) => {
          written = options;
        },
      }),
    });

    // Timestamps and ids would bury the two numbers that matter.
    expect(Object.keys(written?.audit.before ?? {}).toSorted()).toStrictEqual([
      "abcClass",
      "designation",
      "isActive",
      "leadTimeDays",
      "vpe",
    ]);
  });

  it("flags the thresholds as stale when the lead time changes", async () => {
    const result = await service.update({
      actor: actor({ role: "ADMIN", siteId: null }),
      input: { ...input, leadTimeDays: 5 },
      repository: stubRepository({
        findRawArticle: async () => existing,
        updateWithAudit: async () => undefined,
      }),
    });

    expect(result.thresholdsNeedRecalculation).toBe(true);
  });

  it("flags them when the ABC class changes, since the parameters change with it", async () => {
    const result = await service.update({
      actor: actor({ role: "ADMIN", siteId: null }),
      input: { ...input, abcClass: "C" },
      repository: stubRepository({
        findRawArticle: async () => existing,
        updateWithAudit: async () => undefined,
      }),
    });

    expect(result.thresholdsNeedRecalculation).toBe(true);
  });

  it("does not flag them for a designation-only edit", async () => {
    // Renaming an article changes no number, and telling the administrator to
    // recalculate every threshold would train them to ignore the warning.
    const result = await service.update({
      actor: actor({ role: "ADMIN", siteId: null }),
      input,
      repository: stubRepository({
        findRawArticle: async () => existing,
        updateWithAudit: async () => undefined,
      }),
    });

    expect(result.thresholdsNeedRecalculation).toBe(false);
  });
});
