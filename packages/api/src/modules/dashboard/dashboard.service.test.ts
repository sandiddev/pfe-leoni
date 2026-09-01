import { describe, expect, it } from "vitest";

import type { Actor } from "../../context";
import type { DashboardRepository } from "./dashboard.repository";
import * as service from "./dashboard.service";

/**
 * The KPIs, computed against fixed series.
 *
 * Each figure here is one the jury will read off a chart, so the tests pin the
 * arithmetic rather than the plumbing: what counts as served, what a lead time
 * is measured between, and — the recurring rule of this codebase — that a rate
 * with no denominator is `null` rather than a confident zero.
 */

const LTN1 = "site-ltn1";
const LTN4 = "site-ltn4";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "user-1",
    name: "Test",
    email: "test@leoni.tn",
    role: "LOGISTICS_MANAGER",
    siteId: null,
    ...overrides,
  };
}

function stubRepository(overrides: Partial<DashboardRepository> = {}): DashboardRepository {
  return {
    countTrackedArticles: async () => 0,
    countByAlertLevel: async () => [],
    findSnapshots: async () => [],
    countRequestsByStatus: async () => [],
    countOpenRequests: async () => 0,
    countLateRequests: async () => 0,
    findSettledRequests: async () => [],
    ...overrides,
  };
}

const input = { days: 90 } as const;

interface SettledOptions {
  readonly requested?: number;
  readonly approved?: number | null;
  readonly received?: number | null;
  readonly leadTimeDays?: number;
  readonly sentAt?: Date | null;
  readonly receivedAt?: Date | null;
  readonly expectedDeliveryAt?: Date | null;
  readonly submittedAt?: Date | null;
  readonly approvedAt?: Date | null;
}

function settled(options: SettledOptions = {}) {
  const {
    requested = 500,
    approved = 500,
    received = 500,
    leadTimeDays = 2,
    sentAt = new Date("2026-03-01T00:00:00Z"),
    receivedAt = new Date("2026-03-04T00:00:00Z"),
    expectedDeliveryAt = new Date("2026-03-05T00:00:00Z"),
    submittedAt = new Date("2026-02-27T00:00:00Z"),
    approvedAt = new Date("2026-02-28T00:00:00Z"),
  } = options;

  return {
    createdAt: new Date("2026-02-26T00:00:00Z"),
    submittedAt,
    approvedAt,
    sentAt,
    receivedAt,
    expectedDeliveryAt,
    lines: [
      {
        requestedQuantity: requested,
        approvedQuantity: approved,
        receivedQuantity: received,
        article: { leadTimeDays },
      },
    ],
  };
}

describe("service level", () => {
  it("counts a request served only when every line arrived in full", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [
          settled({ approved: 500, received: 500 }),
          settled({ approved: 500, received: 400 }),
        ],
      }),
    });

    expect(data.serviceLevel.closedRequests).toBe(2);
    expect(data.serviceLevel.fullyServed).toBe(1);
    expect(data.serviceLevel.rate).toBe(50);
  });

  it("measures against what was authorised, not what was asked for", async () => {
    // A manager who approves 300 of 500 has changed the commitment; holding
    // LTN4 to the original figure would report a shortfall nobody promised.
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [settled({ requested: 500, approved: 300, received: 300 })],
      }),
    });

    expect(data.serviceLevel.rate).toBe(100);
  });

  it("falls back to the requested quantity when nothing was authorised", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [settled({ requested: 500, approved: null, received: 500 })],
      }),
    });

    expect(data.serviceLevel.rate).toBe(100);
  });

  it("reports no rate at all when nothing has closed yet", async () => {
    // Zero would read as "we serve nobody", which is a different claim.
    const data = await service.summary({ actor: actor(), input, repository: stubRepository() });

    expect(data.serviceLevel.rate).toBeNull();
    expect(data.serviceLevel.onTimeRate).toBeNull();
  });

  it("counts an on-time delivery against the committed date", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [
          settled({
            receivedAt: new Date("2026-03-04T00:00:00Z"),
            expectedDeliveryAt: new Date("2026-03-05T00:00:00Z"),
          }),
          settled({
            receivedAt: new Date("2026-03-09T00:00:00Z"),
            expectedDeliveryAt: new Date("2026-03-05T00:00:00Z"),
          }),
        ],
      }),
    });

    expect(data.serviceLevel.onTime).toBe(1);
    expect(data.serviceLevel.onTimeRate).toBe(50);
  });

  it("excludes a request with no committed date from on-time delivery", async () => {
    // Penalising LTN4 for a promise never made would make the KPI unusable.
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [settled({ expectedDeliveryAt: null })],
      }),
    });

    expect(data.serviceLevel.onTimeRate).toBeNull();
  });
});

describe("lead time, real against theoretical", () => {
  it("measures the real delay from transmission to receipt", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [
          settled({
            sentAt: new Date("2026-03-01T00:00:00Z"),
            receivedAt: new Date("2026-03-04T00:00:00Z"),
            leadTimeDays: 2,
          }),
        ],
      }),
    });

    expect(data.leadTime.averageRealDays).toBe(3);
    expect(data.leadTime.averageTheoreticalDays).toBe(2);
    expect(data.leadTime.measuredRequests).toBe(1);
  });

  it("takes the slowest line as the theoretical delay of the request", async () => {
    // The truck leaves when everything is picked, not when the fastest part is.
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [
          {
            ...settled(),
            lines: [
              {
                requestedQuantity: 1,
                approvedQuantity: 1,
                receivedQuantity: 1,
                article: { leadTimeDays: 2 },
              },
              {
                requestedQuantity: 1,
                approvedQuantity: 1,
                receivedQuantity: 1,
                article: { leadTimeDays: 9 },
              },
            ],
          },
        ],
      }),
    });

    expect(data.leadTime.averageTheoreticalDays).toBe(9);
  });

  it("skips a request that was never transmitted", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [settled({ sentAt: null })],
      }),
    });

    expect(data.leadTime.measuredRequests).toBe(0);
    expect(data.leadTime.averageRealDays).toBeNull();
  });

  it("measures the approval delay, where the email process was slowest", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [
          settled({
            submittedAt: new Date("2026-02-27T00:00:00Z"),
            approvedAt: new Date("2026-03-01T00:00:00Z"),
          }),
        ],
      }),
    });

    expect(data.leadTime.averageApprovalDays).toBe(2);
  });

  it("falls back to creation when a request was never formally submitted", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [
          settled({ submittedAt: null, approvedAt: new Date("2026-02-28T00:00:00Z") }),
        ],
      }),
    });

    expect(data.leadTime.averageApprovalDays).toBe(2);
  });

  it("reports nothing rather than zero when no request was ever approved", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSettledRequests: async () => [settled({ approvedAt: null })],
      }),
    });

    expect(data.leadTime.averageApprovalDays).toBeNull();
  });
});

describe("stock-out history", () => {
  it("builds one point per day from the snapshots", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSnapshots: async () => [
          { snapshotDate: new Date("2026-03-01"), level: "RUPTURE" },
          { snapshotDate: new Date("2026-03-01"), level: "NORMAL" },
          { snapshotDate: new Date("2026-03-01"), level: "NORMAL" },
          { snapshotDate: new Date("2026-03-01"), level: "NORMAL" },
          { snapshotDate: new Date("2026-03-02"), level: "CRITICAL" },
          { snapshotDate: new Date("2026-03-02"), level: "NORMAL" },
        ],
      }),
    });

    expect(data.stockOutHistory).toHaveLength(2);
    expect(data.stockOutHistory[0]).toMatchObject({
      trackedArticles: 4,
      rupture: 1,
      stockOutRate: 25,
    });
    expect(data.stockOutHistory[1]).toMatchObject({ critical: 1, rupture: 0, stockOutRate: 0 });
  });

  it("divides by the articles photographed that day, not by today's catalogue", async () => {
    // An article added last week did not exist in February.
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        countTrackedArticles: async () => 1_000,
        findSnapshots: async () => [
          { snapshotDate: new Date("2026-02-01"), level: "RUPTURE" },
          { snapshotDate: new Date("2026-02-01"), level: "NORMAL" },
        ],
      }),
    });

    expect(data.stockOutHistory[0]?.stockOutRate).toBe(50);
  });

  it("returns the days in chronological order", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        findSnapshots: async () => [
          { snapshotDate: new Date("2026-03-05"), level: "NORMAL" },
          { snapshotDate: new Date("2026-03-01"), level: "NORMAL" },
        ],
      }),
    });

    expect(data.stockOutHistory.map((point) => point.date.toISOString().slice(0, 10))).toEqual([
      "2026-03-01",
      "2026-03-05",
    ]);
  });
});

describe("current state and scoping", () => {
  it("lists every alert level, including the empty ones", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        countByAlertLevel: async () => [{ level: "CRITICAL", count: 4 }],
      }),
    });

    expect(data.alertDistribution).toEqual([
      { level: "NORMAL", count: 0 },
      { level: "WARNING", count: 0 },
      { level: "CRITICAL", count: 4 },
      { level: "RUPTURE", count: 0 },
    ]);
  });

  it("lists every request status, including the empty ones", async () => {
    const data = await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        countRequestsByStatus: async () => [{ status: "IN_PREPARATION", count: 2 }],
      }),
    });

    expect(data.requestsByStatus).toHaveLength(14);
    expect(data.requestsByStatus.find((entry) => entry.status === "IN_PREPARATION")?.count).toBe(2);
    expect(data.requestsByStatus.find((entry) => entry.status === "DRAFT")?.count).toBe(0);
  });

  it("scopes every figure to the actor's plant", async () => {
    const seen: (string | null)[] = [];

    await service.summary({
      actor: actor({ role: "LTN1_STOREKEEPER", siteId: LTN1 }),
      input,
      repository: stubRepository({
        countTrackedArticles: async (siteId) => {
          seen.push(siteId);
          return 0;
        },
        findSnapshots: async (siteId) => {
          seen.push(siteId);
          return [];
        },
        countOpenRequests: async (siteId) => {
          seen.push(siteId);
          return 0;
        },
      }),
    });

    expect(seen).toEqual([LTN1, LTN1, LTN1]);
  });

  it("refuses a single-site actor asking for the other plant", async () => {
    await expect(
      service.summary({
        actor: actor({ role: "LTN1_STOREKEEPER", siteId: LTN1 }),
        input: { ...input, siteId: LTN4 },
        repository: stubRepository(),
      }),
    ).rejects.toThrow(/votre site/i);
  });

  it("lets a cross-site role see both plants", async () => {
    let seenSiteId: string | null | undefined;

    await service.summary({
      actor: actor(),
      input,
      repository: stubRepository({
        countTrackedArticles: async (siteId) => {
          seenSiteId = siteId;
          return 0;
        },
      }),
    });

    expect(seenSiteId).toBeNull();
  });
});

describe("CSV export", () => {
  it("exports the same figures the screen rendered", async () => {
    const result = await service.exportCsv({
      actor: actor(),
      input,
      repository: stubRepository({
        countTrackedArticles: async () => 150,
        findSettledRequests: async () => [settled()],
        findSnapshots: async () => [{ snapshotDate: new Date("2026-03-01"), level: "RUPTURE" }],
      }),
    });

    expect(result.fileName).toMatch(/^indicateurs-reapprovisionnement-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.content).toContain("Articles suivis;150");
    expect(result.content).toContain("Taux de service (%);100");
    expect(result.content).toContain("2026-03-01;1;1;0;0;100");
  });

  it("leaves an unmeasurable indicator empty rather than writing zero", async () => {
    const result = await service.exportCsv({
      actor: actor(),
      input,
      repository: stubRepository(),
    });

    expect(result.content).toContain("Taux de service (%);\n");
  });
});
