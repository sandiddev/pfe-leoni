import { describe, expect, it } from "vitest";

import { DEFAULT_CLASS_PARAMETERS, NotFoundError } from "@leoni/core";
import { Prisma } from "@leoni/db";

import type { Actor } from "../../context";
import type {
  ParameterRepository,
  ThresholdWrite,
  UpsertParameterOptions,
} from "./parameter.repository";
import * as service from "./parameter.service";

/**
 * The tuning parameters and the recalculation, without a database.
 *
 * The rules worth asserting are the ones a wrong answer would hide: that a
 * class with no row runs on the documented defaults rather than on somebody's
 * `?? 1`, that a recomputed threshold always leaves the row explaining it, and
 * that `safetyStock <= min <= max` survives whatever the journal contained.
 */

const LTN1 = "site-ltn1";
const LTN4 = "site-ltn4";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "user-admin",
    name: "Admin",
    email: "admin@leoni.tn",
    role: "ADMIN",
    siteId: null,
    ...overrides,
  };
}

function stubRepository(overrides: Partial<ParameterRepository> = {}): ParameterRepository {
  const notStubbed = (name: string) => () => {
    throw new Error(`${name} was called but not stubbed in this test.`);
  };

  return {
    findParameters: async () => [],
    findParameterForArticle: async () => null,
    findArticleForOverride: async () => ({ id: "article-1", reference: "REF-001", abcClass: "A" }),
    upsertArticleParameterWithAudit: async () => undefined,
    clearArticleParameterWithAudit: async () => undefined,
    upsertWithAudit: notStubbed("upsertWithAudit"),
    findRecalculationTargets: async () => [],
    findConsumptionSamples: async () => [],
    applyThresholdWithHistory: async () => undefined,
    findRecalculationHistory: notStubbed("findRecalculationHistory"),
    ...overrides,
  };
}

function parameterRow(abcClass: "A" | "B" | "C", safetyDays = 2, extraCoverageDays = 3) {
  return {
    id: `parameter-${abcClass}`,
    abcClass,
    safetyDays: new Prisma.Decimal(safetyDays),
    extraCoverageDays: new Prisma.Decimal(extraCoverageDays),
    averagingWindowDays: 30,
    warningMarginRatio: new Prisma.Decimal(0.2),
    updatedAt: new Date("2026-02-01"),
  };
}

interface TargetOptions {
  readonly id?: string;
  readonly currentStock?: number;
  readonly leadTimeDays?: number;
  readonly abcClass?: "A" | "B" | "C";
  readonly minThreshold?: number;
  readonly maxThreshold?: number;
  readonly safetyStock?: number;
  readonly alertLevel?: "NORMAL" | "WARNING" | "CRITICAL" | "RUPTURE";
  readonly override?: ReturnType<typeof override> | null;
}

function target(options: TargetOptions = {}) {
  const {
    id = "stock-1",
    currentStock = 1_200,
    leadTimeDays = 2,
    abcClass = "A",
    minThreshold = 0,
    maxThreshold = 0,
    safetyStock = 0,
    alertLevel = "NORMAL",
  } = options;

  return {
    id,
    currentStock,
    minThreshold: new Prisma.Decimal(minThreshold),
    maxThreshold: new Prisma.Decimal(maxThreshold),
    safetyStock: new Prisma.Decimal(safetyStock),
    alertLevel,
    article: { id: "article-1", leadTimeDays, abcClass, parameter: options.override ?? null },
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

/** Thirty days of 500/day, so the average is exactly the brief's example. */
function dailyExits(quantity: number, days: number, now: Date) {
  return Array.from({ length: days }, (_unused, index) => ({
    stockItemId: "stock-1",
    quantity,
    occurredAt: new Date(now.getTime() - (index + 0.5) * 24 * 60 * 60 * 1000),
  }));
}

function captureUpserts() {
  const calls: UpsertParameterOptions[] = [];
  return {
    capture: async (options: UpsertParameterOptions) => {
      calls.push(options);
    },
    first: () => {
      const first = calls[0];
      if (first === undefined) throw new Error("upsertWithAudit was never called.");
      return first;
    },
  };
}

function captureWrites() {
  const calls: ThresholdWrite[] = [];
  return {
    capture: async (write: ThresholdWrite) => {
      calls.push(write);
    },
    all: () => calls,
    first: () => {
      const first = calls[0];
      if (first === undefined) throw new Error("applyThresholdWithHistory was never called.");
      return first;
    },
  };
}

describe("parameter list", () => {
  it("lists a class with no row on its documented defaults", async () => {
    // A class missing from the screen is a class running on numbers nobody can
    // see; the previous bug was four disagreeing fallbacks.
    const items = await service.list({ actor: actor(), repository: stubRepository() });

    expect(items.map((item) => item.abcClass)).toEqual(["A", "B", "C"]);
    expect(items[0]).toMatchObject({
      abcClass: "A",
      safetyDays: DEFAULT_CLASS_PARAMETERS.A.safetyDays,
      extraCoverageDays: DEFAULT_CLASS_PARAMETERS.A.extraCoverageDays,
      isDefault: true,
      updatedAt: null,
    });
  });

  it("prefers a written row over the default and says so", async () => {
    const items = await service.list({
      actor: actor(),
      repository: stubRepository({ findParameters: async () => [parameterRow("B", 4, 9)] }),
    });

    const classB = items.find((item) => item.abcClass === "B");
    expect(classB).toMatchObject({ safetyDays: 4, extraCoverageDays: 9, isDefault: false });
    expect(items.find((item) => item.abcClass === "A")?.isDefault).toBe(true);
  });
});

describe("parameter update", () => {
  it("records both sides of the change", async () => {
    const written = captureUpserts();

    await service.update({
      actor: actor(),
      input: {
        abcClass: "A",
        safetyDays: 3,
        extraCoverageDays: 4,
        averagingWindowDays: 7,
        warningMarginRatio: 0.25,
      },
      repository: stubRepository({
        findParameters: async () => [parameterRow("A", 2, 3)],
        upsertWithAudit: written.capture,
      }),
    });

    const options = written.first();
    expect(options.audit.action).toBe("UPDATE");
    expect(options.audit.before).toEqual({
      safetyDays: 2,
      extraCoverageDays: 3,
      averagingWindowDays: 30,
      warningMarginRatio: 0.2,
    });
    expect(options.audit.after).toMatchObject({ safetyDays: 3, extraCoverageDays: 4 });
    expect(options.audit.actorId).toBe("user-admin");
  });

  it("records a first edit as a creation with no before-image", async () => {
    const written = captureUpserts();

    await service.update({
      actor: actor(),
      input: {
        abcClass: "C",
        safetyDays: 1,
        extraCoverageDays: 12,
        averagingWindowDays: 90,
        warningMarginRatio: 0.1,
      },
      repository: stubRepository({ upsertWithAudit: written.capture }),
    });

    const options = written.first();
    expect(options.audit.action).toBe("CREATE");
    expect(options.audit.before).toBeNull();
  });
});

describe("threshold recalculation (brief section 3.5)", () => {
  it("reproduces the brief's reference example", async () => {
    // 500/day, lead 2 days, safety 1, extra 3 -> min 1 500, max 3 000.
    const written = captureWrites();
    const now = new Date();

    await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findParameters: async () => [parameterRow("A", 1, 3)],
        findRecalculationTargets: async () => [target({ currentStock: 1_200 })],
        findConsumptionSamples: async () => dailyExits(500, 30, now),
        applyThresholdWithHistory: written.capture,
      }),
    });

    const write = written.first();
    expect(write.averageDailyConsumption).toBe(500);
    expect(write.minThreshold).toBe(1_500);
    expect(write.maxThreshold).toBe(3_000);
    expect(write.safetyStock).toBe(500);
  });

  it("keeps safetyStock <= min <= max whatever the journal held", async () => {
    const written = captureWrites();
    const now = new Date();

    await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findRecalculationTargets: async () => [target({ leadTimeDays: 0 })],
        findConsumptionSamples: async () => dailyExits(7, 3, now),
        applyThresholdWithHistory: written.capture,
      }),
    });

    const write = written.first();
    expect(write.safetyStock).toBeLessThanOrEqual(write.minThreshold);
    expect(write.minThreshold).toBeLessThanOrEqual(write.maxThreshold);
  });

  it("divides by the window length, not by the days that had movements", async () => {
    const written = captureWrites();
    const now = new Date();

    await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findParameters: async () => [parameterRow("A")],
        findRecalculationTargets: async () => [target()],
        // One movement of 300 in a 30-day window is 10/day, not 300/day.
        findConsumptionSamples: async () => dailyExits(300, 1, now),
        applyThresholdWithHistory: written.capture,
      }),
    });

    expect(written.first().averageDailyConsumption).toBe(10);
  });

  it("freezes the parameters it used into the history row", async () => {
    // A foreign key would make the history lie the moment a default is edited.
    const written = captureWrites();

    await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findParameters: async () => [parameterRow("A", 2, 3)],
        findRecalculationTargets: async () => [target({ leadTimeDays: 5 })],
        applyThresholdWithHistory: written.capture,
      }),
    });

    expect(written.first().parametersSnapshot).toEqual({
      safetyDays: 2,
      extraCoverageDays: 3,
      averagingWindowDays: 30,
      warningMarginRatio: 0.2,
      leadTimeDays: 5,
    });
    expect(written.first().trigger).toBe("MANUAL");
    expect(written.first().computedById).toBe("user-admin");
  });

  it("writes one history row per article, never a bare threshold", async () => {
    const written = captureWrites();

    await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findRecalculationTargets: async () => [
          target({ id: "stock-1" }),
          target({ id: "stock-2" }),
        ],
        applyThresholdWithHistory: written.capture,
      }),
    });

    expect(written.all().map((write) => write.stockItemId)).toEqual(["stock-1", "stock-2"]);
  });

  it("recomputes the alert level from the new thresholds", async () => {
    const written = captureWrites();
    const now = new Date();

    await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findParameters: async () => [parameterRow("A", 1, 3)],
        // 500/day gives a Min of 1 500; 1 500 in stock is exactly at Min.
        findRecalculationTargets: async () => [target({ currentStock: 1_500 })],
        findConsumptionSamples: async () => dailyExits(500, 30, now),
        applyThresholdWithHistory: written.capture,
      }),
    });

    expect(written.first().alertLevel).toBe("CRITICAL");
  });

  it("falls back to the class defaults when no row is written", async () => {
    const written = captureWrites();
    const now = new Date();

    await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findRecalculationTargets: async () => [target({ abcClass: "C", leadTimeDays: 0 })],
        findConsumptionSamples: async () => dailyExits(30, 30, now),
        applyThresholdWithHistory: written.capture,
      }),
    });

    // Class C defaults: 1 safety day, 10 extra coverage days.
    expect(written.first().minThreshold).toBe(30);
    expect(written.first().maxThreshold).toBe(330);
  });

  it("reports what the run evaluated and what it actually moved", async () => {
    const result = await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findRecalculationTargets: async () => [
          // Already up to date: no consumption, thresholds already zero.
          target({ id: "unchanged", minThreshold: 0, maxThreshold: 0, safetyStock: 0 }),
          target({ id: "moved", minThreshold: 999, maxThreshold: 999, safetyStock: 999 }),
        ],
      }),
    });

    expect(result.evaluated).toBe(2);
    expect(result.changed).toBe(1);
  });

  it("counts how many articles the run leaves at or below their reorder point", async () => {
    const now = new Date();

    const result = await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findParameters: async () => [parameterRow("A", 1, 3)],
        findRecalculationTargets: async () => [target({ id: "stock-1", currentStock: 100 })],
        findConsumptionSamples: async () => dailyExits(500, 30, now),
      }),
    });

    expect(result.nowCritical).toBe(1);
  });

  it("narrows the run to one class when asked", async () => {
    let seenClass: string | null | undefined;

    await service.recalculate({
      actor: actor(),
      input: { abcClass: "B" },
      repository: stubRepository({
        findRecalculationTargets: async (_siteId, abcClass) => {
          seenClass = abcClass;
          return [];
        },
      }),
    });

    expect(seenClass).toBe("B");
  });

  it("scopes the run to the actor's plant", async () => {
    let seenSiteId: string | null | undefined;

    await service.recalculate({
      actor: actor({ role: "LTN1_WAREHOUSE_MANAGER", siteId: LTN1 }),
      input: {},
      repository: stubRepository({
        findRecalculationTargets: async (siteId) => {
          seenSiteId = siteId;
          return [];
        },
      }),
    });

    expect(seenSiteId).toBe(LTN1);
  });

  it("refuses a single-site actor asking for the other plant", async () => {
    await expect(
      service.recalculate({
        actor: actor({ role: "LTN1_WAREHOUSE_MANAGER", siteId: LTN1 }),
        input: { siteId: LTN4 },
        repository: stubRepository(),
      }),
    ).rejects.toThrow(/votre site/i);
  });
});

describe("per-article parameter overrides (brief section 3.4)", () => {
  it("reports the class defaults when nothing is overridden, and says so", async () => {
    const found = await service.forArticle({
      actor: actor(),
      input: { articleId: "article-1" },
      repository: stubRepository({ findParameters: async () => [parameterRow("A", 2, 3)] }),
    });

    expect(found).toMatchObject({ safetyDays: 2, extraCoverageDays: 3, source: "CLASS" });
  });

  it("reports the override when one exists, and says so", async () => {
    const found = await service.forArticle({
      actor: actor(),
      input: { articleId: "article-1" },
      repository: stubRepository({
        findParameters: async () => [parameterRow("A", 2, 3)],
        findParameterForArticle: async () => ({
          id: "parameter-article",
          ...override(6, 1),
          updatedAt: new Date("2026-03-01"),
        }),
      }),
    });

    expect(found).toMatchObject({ safetyDays: 6, extraCoverageDays: 1, source: "ARTICLE" });
  });

  it("an override beats the class default in the recalculation", async () => {
    // This is the behavioural point of the whole feature: a single critical
    // reference treated more conservatively than the rest of its class.
    const written = captureWrites();
    const now = new Date();

    await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findParameters: async () => [parameterRow("A", 1, 3)],
        findRecalculationTargets: async () => [target({ override: override(4, 0) })],
        findConsumptionSamples: async () => dailyExits(100, 30, now),
        applyThresholdWithHistory: written.capture,
      }),
    });

    // 100/day, lead 2, override safety 4 -> min 600 (not 300 from the class),
    // extra 0 -> max 600.
    expect(written.first().minThreshold).toBe(600);
    expect(written.first().maxThreshold).toBe(600);
  });

  it("freezes the override, not the class, into the history row", async () => {
    const written = captureWrites();

    await service.recalculate({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findParameters: async () => [parameterRow("A", 1, 3)],
        findRecalculationTargets: async () => [target({ override: override(4, 0) })],
        applyThresholdWithHistory: written.capture,
      }),
    });

    expect(written.first().parametersSnapshot).toMatchObject({
      safetyDays: 4,
      extraCoverageDays: 0,
    });
  });

  it("records an override as a creation the first time", async () => {
    const calls: { audit: { action: string; before: unknown } }[] = [];

    await service.upsertForArticle({
      actor: actor(),
      input: {
        articleId: "article-1",
        safetyDays: 5,
        extraCoverageDays: 2,
        averagingWindowDays: 7,
        warningMarginRatio: 0.3,
      },
      repository: stubRepository({
        upsertArticleParameterWithAudit: async (options) => {
          calls.push(options);
        },
      }),
    });

    expect(calls[0]?.audit.action).toBe("CREATE");
    expect(calls[0]?.audit.before).toBeNull();
  });

  it("records a replaced override with both sides", async () => {
    const calls: { audit: { action: string; before: unknown; after: unknown } }[] = [];

    await service.upsertForArticle({
      actor: actor(),
      input: {
        articleId: "article-1",
        safetyDays: 5,
        extraCoverageDays: 2,
        averagingWindowDays: 7,
        warningMarginRatio: 0.3,
      },
      repository: stubRepository({
        findParameterForArticle: async () => ({
          id: "parameter-article",
          ...override(6, 1),
          updatedAt: new Date("2026-03-01"),
        }),
        upsertArticleParameterWithAudit: async (options) => {
          calls.push(options);
        },
      }),
    });

    expect(calls[0]?.audit.action).toBe("UPDATE");
    expect(calls[0]?.audit.before).toMatchObject({ safetyDays: 6, extraCoverageDays: 1 });
    expect(calls[0]?.audit.after).toMatchObject({ safetyDays: 5, extraCoverageDays: 2 });
  });

  it("clears an override and records what it was", async () => {
    const calls: { audit: { action: string; before: unknown } }[] = [];

    await service.clearForArticle({
      actor: actor(),
      input: { articleId: "article-1" },
      repository: stubRepository({
        findParameterForArticle: async () => ({
          id: "parameter-article",
          ...override(6, 1),
          updatedAt: new Date("2026-03-01"),
        }),
        clearArticleParameterWithAudit: async (options) => {
          calls.push(options);
        },
      }),
    });

    expect(calls[0]?.audit.action).toBe("DELETE");
    expect(calls[0]?.audit.before).toMatchObject({ safetyDays: 6 });
  });

  it("refuses to clear an override that does not exist", async () => {
    await expect(
      service.clearForArticle({
        actor: actor(),
        input: { articleId: "article-1" },
        repository: stubRepository(),
      }),
    ).rejects.toThrow(/pas de parametres propres/i);
  });

  it("reports an unknown article", async () => {
    await expect(
      service.forArticle({
        actor: actor(),
        input: { articleId: "gone" },
        repository: stubRepository({ findArticleForOverride: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("recalculation history", () => {
  it("returns what the last runs produced", async () => {
    const items = await service.history({
      actor: actor(),
      input: { limit: 10 },
      repository: stubRepository({
        findRecalculationHistory: async () => [
          {
            id: "history-1",
            averageDailyConsumption: new Prisma.Decimal(500),
            minThreshold: new Prisma.Decimal(1_500),
            maxThreshold: new Prisma.Decimal(3_000),
            safetyStock: new Prisma.Decimal(500),
            trigger: "MANUAL" as const,
            computedAt: new Date("2026-03-01"),
            stockItem: {
              site: { code: "LTN1" },
              article: { reference: "REF-001", designation: "Fil 0.5" },
            },
          },
        ],
      }),
    });

    expect(items[0]).toMatchObject({
      reference: "REF-001",
      siteCode: "LTN1",
      minThreshold: 1_500,
      trigger: "MANUAL",
    });
  });

  it("scopes the history to the actor's plant", async () => {
    let seenSiteId: string | null | undefined;

    await service.history({
      actor: actor({ role: "LTN1_STOREKEEPER", siteId: LTN1 }),
      input: { limit: 5 },
      repository: stubRepository({
        findRecalculationHistory: async (siteId) => {
          seenSiteId = siteId;
          return [];
        },
      }),
    });

    expect(seenSiteId).toBe(LTN1);
  });
});
