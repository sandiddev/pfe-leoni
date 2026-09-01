import { describe, expect, it } from "vitest";

import { BusinessRuleError, DEFAULT_CLASS_PARAMETERS, NotFoundError } from "@leoni/core";
import { Prisma } from "@leoni/db";

import type { Actor } from "../../context";
import type { ArticleRepository, CreateArticleOptions, StockItemRow } from "./article.repository";
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
  readonly override?: ReturnType<typeof override> | null;
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
    findAllSites: async () => [{ id: "site-ltn1" }, { id: "site-ltn4" }],
    findByReference: async () => null,
    findByReferences: async () => [],
    findSitesWithCodes: async () => [
      { id: "site-ltn1", code: "LTN1" },
      { id: "site-ltn4", code: "LTN4" },
    ],
    createWithAudit: notStubbed("createWithAudit"),
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


describe("article parameters", () => {
  it("prefers an article's own parameters over its class default", async () => {
    const page = await service.list({
      actor: actor(),
      input: listInput,
      repository: stubRepository({
        findMany: async () => ({
          rows: [row({ currentStock: 300, override: override(4, 0) })],
          totalCount: 1,
        }),
      }),
    });

    // 100/day, lead 2, override safety 4 -> min 600, extra 0 -> max 600.
    expect(page.items[0]?.recommendedQuantity).toBe(300);
  });

  it("falls back to the class default when no override is written", async () => {
    const page = await service.list({
      actor: actor(),
      input: listInput,
      repository: stubRepository({
        findMany: async () => ({ rows: [row({ currentStock: 300 })], totalCount: 1 }),
      }),
    });

    // Class A defaults: 2 safety days, 3 extra -> min 400, max 700.
    expect(page.items[0]?.recommendedQuantity).toBe(400);
  });
});

describe("article creation", () => {
  function captureCreate() {
    const calls: CreateArticleOptions[] = [];
    return {
      capture: async (options: CreateArticleOptions) => {
        calls.push(options);
      },
      first: () => {
        const first = calls[0];
        if (first === undefined) throw new Error("createWithAudit was never called.");
        return first;
      },
    };
  }

  const input = {
    reference: "REF-NEW",
    designation: "Connecteur 4 voies",
    vpe: 250,
    leadTimeDays: 3,
    abcClass: "B",
    initialStock: 0,
  } as const;

  it("creates a stock row at every plant, in the same call as the article", async () => {
    // Every screen reads StockItem, not Article. An article created without its
    // stock rows exists in the database and nowhere in the interface.
    const written = captureCreate();

    await service.create({
      actor: actor({ role: "ADMIN", siteId: null }),
      input,
      repository: stubRepository({ createWithAudit: written.capture }),
    });

    expect(written.first().stockItems).toEqual([
      { siteId: "site-ltn1", currentStock: 0 },
      { siteId: "site-ltn4", currentStock: 0 },
    ]);
  });

  it("carries an opening balance onto every plant's stock row", async () => {
    const written = captureCreate();

    await service.create({
      actor: actor({ role: "ADMIN", siteId: null }),
      input: { ...input, initialStock: 400 },
      repository: stubRepository({ createWithAudit: written.capture }),
    });

    expect(written.first().stockItems.every((item) => item.currentStock === 400)).toBe(true);
  });

  it("records the creation in the audit trail with no before-image", async () => {
    const written = captureCreate();

    await service.create({
      actor: actor({ role: "ADMIN", siteId: null }),
      input,
      repository: stubRepository({ createWithAudit: written.capture }),
    });

    const audit = written.first().audit;
    expect(audit.action).toBe("CREATE");
    expect(audit.before).toBeNull();
    expect(audit.after).toMatchObject({ reference: "REF-NEW", vpe: 250, abcClass: "B" });
  });

  it("refuses a reference that already exists, in French", async () => {
    // Left to the unique index, this would surface as a Postgres constraint
    // name in a warehouse screen.
    await expect(
      service.create({
        actor: actor({ role: "ADMIN", siteId: null }),
        input,
        repository: stubRepository({ findByReference: async () => ({ id: "article-existing" }) }),
      }),
    ).rejects.toThrow(/existe deja/i);
  });

  it("refuses to create an article when no plant is configured", async () => {
    await expect(
      service.create({
        actor: actor({ role: "ADMIN", siteId: null }),
        input,
        repository: stubRepository({ findAllSites: async () => [] }),
      }),
    ).rejects.toThrow(BusinessRuleError);
  });
});

describe("CSV catalogue import (brief section 6.1)", () => {
  const HEADER = "reference,designation,vpe,leadTimeDays,abcClass,initialStock,siteCode";

  /**
   * The recalculation, stubbed out.
   *
   * What the import does to thresholds is `runRecalculation`'s business and is
   * tested there. Injecting a no-op keeps these tests about the file.
   */
  const noRecalculation = async () => ({
    evaluated: 0,
    changed: 0,
    nowCritical: 0,
    reclassified: 0,
    runAt: new Date("2026-09-01"),
  });
  const VALID = `${HEADER}\nBTR-1,Boitier 12 voies,250,2,A,1000,LTN1`;

  /** Captures whether anything was written at all. */
  function captureWrites() {
    const created: string[] = [];
    const updated: string[] = [];

    return {
      created,
      updated,
      stubs: {
        createWithAudit: async (options: { readonly data: { readonly reference: string } }) => {
          created.push(options.data.reference);
        },
        updateWithAudit: async (options: { readonly articleId: string }) => {
          updated.push(options.articleId);
        },
      },
    };
  }

  it("imports a valid file and reports what it did", async () => {
    const writes = captureWrites();

    const result = await service.importFromCsv({
      actor: actor(),
      content: VALID,
      recalculate: noRecalculation,
      repository: stubRepository({
        findAllSites: async () => [{ id: "site-ltn1" }, { id: "site-ltn4" }],
        ...writes.stubs,
      }),
    });

    expect(result).toEqual({ rows: 1, imported: 1, updated: 0, errors: [] });
    expect(writes.created).toEqual(["BTR-1"]);
  });

  it("writes nothing at all when any row is invalid", async () => {
    // The rule the whole feature turns on. A half-imported catalogue is the
    // failure mode that costs a day to unpick.
    const writes = captureWrites();

    const result = await service.importFromCsv({
      actor: actor(),
      content:
        `${HEADER}\n` +
        `BTR-1,Boitier 12 voies,250,2,A,1000,LTN1\n` +
        `BTR-2,Cosse,0,2,A,0,LTN1\n`,
      recalculate: noRecalculation,
      repository: stubRepository({
        findAllSites: async () => [{ id: "site-ltn1" }],
        ...writes.stubs,
      }),
    });

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
    expect(writes.created).toEqual([]);
    expect(writes.updated).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("numbers errors the way a spreadsheet does, counting the header", async () => {
    // Line 2 is the first data row. Getting this wrong makes every message
    // technically correct and practically useless.
    const result = await service.importFromCsv({
      actor: actor(),
      content: `${HEADER}\nBTR-1,Boitier,250,2,Z,0,LTN1`,
      recalculate: noRecalculation,
      repository: stubRepository(),
    });

    expect(result.errors[0]).toMatchObject({ line: 2, column: "abcClass" });
  });

  it("refuses a file whose columns are missing, without reading rows", async () => {
    const result = await service.importFromCsv({
      actor: actor(),
      content: "reference,designation\nBTR-1,Boitier",
      recalculate: noRecalculation,
      repository: stubRepository(),
    });

    expect(result.errors.map((error) => error.column)).toEqual([
      "vpe",
      "leadTimeDays",
      "abcClass",
      "initialStock",
      "siteCode",
    ]);
    expect(result.errors.every((error) => error.line === 1)).toBe(true);
  });

  it("catches a reference repeated inside the file", async () => {
    // The unique index would fail on the second occurrence after committing the
    // first, which is exactly the partial write this import forbids.
    const result = await service.importFromCsv({
      actor: actor(),
      content: `${HEADER}\nBTR-1,Boitier,250,2,A,0,LTN1\nBTR-1,Boitier bis,250,2,A,0,LTN1`,
      recalculate: noRecalculation,
      repository: stubRepository(),
    });

    expect(result.errors[0]).toMatchObject({ line: 3, column: "reference" });
    expect(result.errors[0]?.message).toContain("ligne 2");
  });

  it("refuses a site code this installation does not have", async () => {
    const result = await service.importFromCsv({
      actor: actor(),
      content: `${HEADER}\nBTR-1,Boitier,250,2,A,0,LTN9`,
      recalculate: noRecalculation,
      repository: stubRepository(),
    });

    expect(result.errors[0]).toMatchObject({ line: 2, column: "siteCode" });
  });

  it("updates an existing reference instead of refusing it", async () => {
    // A catalogue export is the upstream source of truth for designation, pack
    // size and lead time; re-importing after those change is the normal use.
    const writes = captureWrites();

    const result = await service.importFromCsv({
      actor: actor(),
      content: VALID,
      recalculate: noRecalculation,
      repository: stubRepository({
        findByReferences: async () => [
          {
            id: "article-1",
            reference: "BTR-1",
            designation: "Ancien libelle",
            vpe: 100,
            leadTimeDays: 5,
            abcClass: "C" as const,
            isActive: true,
          },
        ],
        findAllSites: async () => [{ id: "site-ltn1" }],
        ...writes.stubs,
      }),
    });

    expect(result).toMatchObject({ imported: 0, updated: 1 });
    expect(writes.created).toEqual([]);
    expect(writes.updated).toEqual(["article-1"]);
  });

  it("uppercases the reference so the natural key is stable", async () => {
    const writes = captureWrites();

    await service.importFromCsv({
      actor: actor(),
      content: `${HEADER}\nbtr-1,Boitier,250,2,a,0,ltn1`,
      recalculate: noRecalculation,
      repository: stubRepository({
        findAllSites: async () => [{ id: "site-ltn1" }],
        ...writes.stubs,
      }),
    });

    expect(writes.created).toEqual(["BTR-1"]);
  });

  it("puts the opening stock only at the plant the file named", async () => {
    const stockItems: { siteId: string; currentStock: number }[] = [];

    await service.importFromCsv({
      actor: actor(),
      content: `${HEADER}\nBTR-1,Boitier,250,2,A,1000,LTN4`,
      recalculate: noRecalculation,
      repository: stubRepository({
        findAllSites: async () => [{ id: "site-ltn1" }, { id: "site-ltn4" }],
        createWithAudit: async (options) => {
          stockItems.push(...options.stockItems);
        },
      }),
    });

    expect(stockItems).toEqual([
      { siteId: "site-ltn1", currentStock: 0 },
      { siteId: "site-ltn4", currentStock: 1_000 },
    ]);
  });

  it("survives a file that Excel wrote with a BOM", async () => {
    // Without stripping it, the first header becomes "\uFEFFreference" and the
    // column is silently unmatchable — reported as a missing `reference`.
    const result = await service.importFromCsv({
      actor: actor(),
      content: `\uFEFF${VALID}`,
      recalculate: noRecalculation,
      repository: stubRepository({
        findAllSites: async () => [{ id: "site-ltn1" }],
        createWithAudit: async () => undefined,
      }),
    });

    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(1);
  });
});
