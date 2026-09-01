import { describe, expect, it } from "vitest";

import { BusinessRuleError, NotFoundError } from "@leoni/core";
import { Prisma } from "@leoni/db";

import type { Actor } from "../../context";
import type {
  RecordMovementOptions,
  StockLotRow,
  StockMovementRow,
  StockRepository,
} from "./stock.repository";
import * as service from "./stock.service";

/**
 * Service-level rules for the stock module, without a database.
 *
 * What is worth asserting here is not SQL but the three decisions the service
 * makes on the way to a write: whether the movement is possible at all, which
 * lots FIFO draws it from, and — the one the whole module exists for — that the
 * journal row, the lots and the new level are handed over as a single set of
 * facts rather than in two calls a refactor could separate.
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

function stubRepository(overrides: Partial<StockRepository> = {}): StockRepository {
  const notStubbed = (name: string) => () => {
    throw new Error(`${name} was called but not stubbed in this test.`);
  };

  return {
    findMovements: notStubbed("findMovements"),
    findLotsByLocation: notStubbed("findLotsByLocation"),
    findStorageLocations: notStubbed("findStorageLocations"),
    findStorageLocationById: notStubbed("findStorageLocationById"),
    findStockItemForMovement: notStubbed("findStockItemForMovement"),
    // No row written means the class defaults apply, which is the normal path.
    findParameterForClass: async () => null,
    recordMovementWithStockUpdate: notStubbed("recordMovementWithStockUpdate"),
    ...overrides,
  };
}

interface StockItemOptions {
  readonly currentStock?: number;
  readonly minThreshold?: number;
  readonly siteId?: string;
  readonly lots?: readonly { id: string; quantity: number; fifoDate: Date }[];
}

function stockItem(options: StockItemOptions = {}) {
  const {
    currentStock = 1_000,
    minThreshold = 400,
    siteId = LTN1,
    lots = [
      { id: "lot-old", quantity: 600, fifoDate: new Date("2026-01-05") },
      { id: "lot-new", quantity: 400, fifoDate: new Date("2026-02-20") },
    ],
  } = options;

  return {
    id: "stock-1",
    currentStock,
    minThreshold: new Prisma.Decimal(minThreshold),
    siteId,
    article: { id: "article-1", reference: "REF-001", abcClass: "A" as const },
    lots: [...lots],
  };
}

const LOCATION = { id: "loc-1", siteId: LTN1 };

const listInput = { limit: 25, cursor: null } as const;

describe("stock service - journal", () => {
  it("scopes the journal to the actor's plant", async () => {
    let seenSiteId: string | null | undefined;

    await service.list({
      actor: actor(),
      input: listInput,
      repository: stubRepository({
        findMovements: async ({ siteId }) => {
          seenSiteId = siteId;
          return { rows: [], totalCount: 0 };
        },
      }),
    });

    expect(seenSiteId).toBe(LTN1);
  });

  it("refuses a single-site actor asking for the other plant", async () => {
    await expect(
      service.list({
        actor: actor({ siteId: LTN1 }),
        input: { ...listInput, siteId: LTN4 },
        repository: stubRepository(),
      }),
    ).rejects.toThrow(/votre site/i);
  });

  it("keeps the extra pagination row out of the page and returns it as a cursor", async () => {
    const rows = Array.from({ length: 3 }, (_unused, index) => movementRow(`movement-${String(index)}`));

    const page = await service.list({
      actor: actor(),
      input: { limit: 2, cursor: null },
      repository: stubRepository({
        findMovements: async () => ({ rows, totalCount: 3 }),
      }),
    });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("movement-1");
  });

  it("reports no next page when the extra row is absent", async () => {
    const page = await service.list({
      actor: actor(),
      input: { limit: 2, cursor: null },
      repository: stubRepository({
        findMovements: async () => ({ rows: [movementRow("only")], totalCount: 1 }),
      }),
    });

    expect(page.nextCursor).toBeNull();
  });

  it("lists what each shelf holds", async () => {
    const items = await service.byLocation({
      actor: actor(),
      input: {},
      repository: stubRepository({ findLotsByLocation: async () => [lotRow()] }),
    });

    expect(items[0]?.locationCode).toBe("A-01");
    expect(items[0]?.quantity).toBe(600);
  });

  it("offers only the destinations of the actor's plant", async () => {
    let seenSiteId: string | null | undefined;

    await service.storageLocations({
      actor: actor(),
      input: {},
      repository: stubRepository({
        findStorageLocations: async (siteId) => {
          seenSiteId = siteId;
          return [{ id: "loc-1", code: "A-01", description: null, siteId: LTN1 }];
        },
      }),
    });

    expect(seenSiteId).toBe(LTN1);
  });
});

describe("stock service - recording a movement", () => {
  it("refuses an exit larger than the stock", async () => {
    // Clamping to zero would hide the discrepancy instead of surfacing it.
    await expect(
      service.record({
        actor: actor(),
        input: { articleId: "article-1", type: "EXIT", quantity: 1_001 },
        repository: stubRepository({ findStockItemForMovement: async () => stockItem() }),
      }),
    ).rejects.toThrow(BusinessRuleError);
  });

  it("allows an exit that empties the stock exactly", async () => {
    const written = captureWrite();

    const result = await service.record({
      actor: actor(),
      input: { articleId: "article-1", type: "EXIT", quantity: 1_000 },
      repository: stubRepository({
        findStockItemForMovement: async () => stockItem(),
        recordMovementWithStockUpdate: written.capture,
      }),
    });

    expect(result.newStock).toBe(0);
    expect(result.alertLevel).toBe("RUPTURE");
  });

  it("draws from the oldest lot first", async () => {
    const written = captureWrite();

    await service.record({
      actor: actor(),
      input: { articleId: "article-1", type: "EXIT", quantity: 700 },
      repository: stubRepository({
        findStockItemForMovement: async () => stockItem(),
        recordMovementWithStockUpdate: written.capture,
      }),
    });

    // 600 from the January lot, then 100 from the February one.
    expect(written.options().lotWrites).toEqual([
      { kind: "draw", lotId: "lot-old", quantity: 0 },
      { kind: "draw", lotId: "lot-new", quantity: 300 },
    ]);
  });

  it("records the movement, the lots and the new level in one call", async () => {
    // Two calls would let a later refactor drop the journal row and leave a
    // stock figure nobody can explain.
    const written = captureWrite();

    await service.record({
      actor: actor(),
      input: { articleId: "article-1", type: "EXIT", quantity: 100 },
      repository: stubRepository({
        findStockItemForMovement: async () => stockItem(),
        recordMovementWithStockUpdate: written.capture,
      }),
    });

    expect(written.count()).toBe(1);
    const options = written.options();
    expect(options.newStock).toBe(900);
    expect(options.lotWrites.length).toBeGreaterThan(0);
    expect(options.userId).toBe("user-1");
  });

  it("lands an entry on the requested shelf as a new lot", async () => {
    const written = captureWrite();

    await service.record({
      actor: actor(),
      input: {
        articleId: "article-1",
        type: "ENTRY",
        quantity: 500,
        storageLocationId: "loc-1",
        occurredAt: new Date("2026-03-01"),
      },
      repository: stubRepository({
        findStockItemForMovement: async () => stockItem(),
        findStorageLocationById: async () => LOCATION,
        recordMovementWithStockUpdate: written.capture,
      }),
    });

    const options = written.options();
    expect(options.newStock).toBe(1_500);
    expect(options.lotWrites).toEqual([
      {
        kind: "create",
        storageLocationId: "loc-1",
        quantity: 500,
        fifoDate: new Date("2026-03-01"),
      },
    ]);
    expect(options.newLotId).not.toBeNull();
  });

  it("requires a destination for an entry", async () => {
    await expect(
      service.record({
        actor: actor(),
        input: { articleId: "article-1", type: "ENTRY", quantity: 500 },
        repository: stubRepository({ findStockItemForMovement: async () => stockItem() }),
      }),
    ).rejects.toThrow(/emplacement/i);
  });

  it("refuses a destination belonging to the other plant", async () => {
    await expect(
      service.record({
        actor: actor(),
        input: {
          articleId: "article-1",
          type: "ENTRY",
          quantity: 500,
          storageLocationId: "loc-ltn4",
        },
        repository: stubRepository({
          findStockItemForMovement: async () => stockItem(),
          findStorageLocationById: async () => ({ id: "loc-ltn4", siteId: LTN4 }),
        }),
      }),
    ).rejects.toThrow(/site/i);
  });

  it("reports a missing destination as not found", async () => {
    await expect(
      service.record({
        actor: actor(),
        input: {
          articleId: "article-1",
          type: "ENTRY",
          quantity: 5,
          storageLocationId: "loc-gone",
        },
        repository: stubRepository({
          findStockItemForMovement: async () => stockItem(),
          findStorageLocationById: async () => null,
        }),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("reports an unknown article as not found", async () => {
    await expect(
      service.record({
        actor: actor(),
        input: { articleId: "nope", type: "EXIT", quantity: 1 },
        repository: stubRepository({ findStockItemForMovement: async () => null }),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("re-checks the plant on the row that came back", async () => {
    // A WHERE clause cannot protect a lookup that fell back to "any plant".
    await expect(
      service.record({
        actor: actor({ role: "LTN4_RESPONSIBLE", siteId: LTN4 }),
        input: { articleId: "article-1", type: "EXIT", quantity: 1 },
        repository: stubRepository({
          findStockItemForMovement: async () => stockItem({ siteId: LTN1 }),
        }),
      }),
    ).rejects.toThrow(/site/i);
  });

  it("recomputes the alert level from the new stock and the class warning band", async () => {
    const written = captureWrite();

    const result = await service.record({
      actor: actor(),
      input: { articleId: "article-1", type: "EXIT", quantity: 600 },
      repository: stubRepository({
        findStockItemForMovement: async () => stockItem({ currentStock: 1_000, minThreshold: 400 }),
        recordMovementWithStockUpdate: written.capture,
      }),
    });

    // 400 left, exactly at Min: the margin is fully consumed, so CRITICAL.
    expect(result.newStock).toBe(400);
    expect(result.alertLevel).toBe("CRITICAL");
    expect(written.options().alertLevel).toBe("CRITICAL");
  });

  it("uses the written warning margin when one exists", async () => {
    const result = await service.record({
      actor: actor(),
      input: { articleId: "article-1", type: "EXIT", quantity: 500 },
      repository: stubRepository({
        findStockItemForMovement: async () => stockItem({ currentStock: 1_000, minThreshold: 400 }),
        findParameterForClass: async () => parameterRow(0.3),
        recordMovementWithStockUpdate: async () => undefined,
      }),
    });

    // 500 left, above Min but inside a 30% warning band (400 -> 520).
    expect(result.alertLevel).toBe("WARNING");
  });
});

describe("stock service - inventory count", () => {
  it("replaces the level with the counted quantity", async () => {
    const written = captureWrite();

    const result = await service.adjust({
      actor: actor({ role: "ADMIN", siteId: null }),
      input: {
        articleId: "article-1",
        countedQuantity: 850,
        reason: "Inventaire tournant du 1er mars",
      },
      repository: stubRepository({
        findStockItemForMovement: async () => stockItem({ currentStock: 1_000 }),
        recordMovementWithStockUpdate: written.capture,
      }),
    });

    expect(result.previousStock).toBe(1_000);
    expect(result.newStock).toBe(850);
    // The journal records the figure that was counted, not the difference.
    expect(written.options().quantity).toBe(850);
    expect(written.options().type).toBe("ADJUSTMENT");
  });

  it("draws the shortfall FIFO when the count is lower", async () => {
    const written = captureWrite();

    await service.adjust({
      actor: actor({ role: "ADMIN", siteId: null }),
      input: { articleId: "article-1", countedQuantity: 300, reason: "Ecart constate en rayon" },
      repository: stubRepository({
        findStockItemForMovement: async () => stockItem({ currentStock: 1_000 }),
        recordMovementWithStockUpdate: written.capture,
      }),
    });

    // 700 missing: the whole January lot and 100 of the February one.
    expect(written.options().lotWrites).toEqual([
      { kind: "draw", lotId: "lot-old", quantity: 0 },
      { kind: "draw", lotId: "lot-new", quantity: 300 },
    ]);
  });

  it("puts a surplus on the shelf that was counted", async () => {
    const written = captureWrite();

    await service.adjust({
      actor: actor({ role: "ADMIN", siteId: null }),
      input: {
        articleId: "article-1",
        countedQuantity: 1_200,
        storageLocationId: "loc-1",
        reason: "Retour de production non saisi",
      },
      repository: stubRepository({
        findStockItemForMovement: async () => stockItem({ currentStock: 1_000 }),
        findStorageLocationById: async () => LOCATION,
        recordMovementWithStockUpdate: written.capture,
      }),
    });

    expect(written.options().lotWrites[0]).toMatchObject({ kind: "create", quantity: 200 });
  });

  it("carries the reason into the journal", async () => {
    const written = captureWrite();

    await service.adjust({
      actor: actor({ role: "ADMIN", siteId: null }),
      input: { articleId: "article-1", countedQuantity: 900, reason: "Casse constatee au poste 4" },
      repository: stubRepository({
        findStockItemForMovement: async () => stockItem({ currentStock: 1_000 }),
        recordMovementWithStockUpdate: written.capture,
      }),
    });

    expect(written.options().note).toBe("Casse constatee au poste 4");
  });
});

// --- Fixtures ---------------------------------------------------------------

/** Records what the service handed the repository, so a test can assert on it. */
function captureWrite() {
  const calls: RecordMovementOptions[] = [];

  return {
    capture: async (options: RecordMovementOptions) => {
      calls.push(options);
    },
    count: () => calls.length,
    options: () => {
      const first = calls[0];
      if (first === undefined) throw new Error("recordMovementWithStockUpdate was never called.");
      return first;
    },
  };
}

function parameterRow(warningMarginRatio: number) {
  return {
    id: "parameter-a",
    abcClass: "A" as const,
    articleId: null,
    safetyDays: new Prisma.Decimal(2),
    extraCoverageDays: new Prisma.Decimal(3),
    averagingWindowDays: 30,
    warningMarginRatio: new Prisma.Decimal(warningMarginRatio),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function movementRow(id: string): StockMovementRow {
  return {
    id,
    type: "EXIT",
    quantity: 100,
    occurredAt: new Date("2026-03-01"),
    reference: "BL-1234",
    user: { name: "Magasinier" },
    lot: { storageLocation: { code: "A-01" } },
    stockItem: {
      site: { code: "LTN1" },
      article: { id: "article-1", reference: "REF-001", designation: "Fil 0.5" },
    },
  };
}

function lotRow(): StockLotRow {
  return {
    id: "lot-old",
    quantity: 600,
    fifoDate: new Date("2026-01-05"),
    storageLocation: { id: "loc-1", code: "A-01" },
    stockItem: { article: { id: "article-1", reference: "REF-001", designation: "Fil 0.5" } },
  };
}
