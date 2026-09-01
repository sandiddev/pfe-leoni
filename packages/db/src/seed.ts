// Must come first: populates process.env before @leoni/env validates it.
import "./load-env";

import { hashPassword } from "better-auth/crypto";
import { createLocalAccountIssuer } from "better-auth/db";
import { randomUUID } from "node:crypto";

import {
  ABC_CLASSES,
  type AlertLevel,
  assessStockItem,
  DEFAULT_AVERAGING_WINDOW_DAYS,
  DEFAULT_CLASS_PARAMETERS,
  DEFAULT_WARNING_MARGIN_RATIO,
  defaultParametersForClass,
  type RequestStatus,
  resolveAlertLevel,
  type Role,
} from "@leoni/core";
import { env } from "@leoni/env";

import { db } from "./client";
import { buildCatalogue, type SeedArticle } from "./seed/catalogue";

/**
 * Deterministic demo data (brief section 6.2).
 *
 * The goal is not "some rows exist" but "every screen has something worth
 * looking at during the defence": articles at all four alert levels, requests
 * sitting in every workflow status including the exception paths, a movement
 * history long enough for the rolling averages to be real, and ninety days of
 * alert snapshots so the KPI charts have a curve rather than a single point.
 *
 * Run with `pnpm db:seed`. It is idempotent by truncation: it clears the tables
 * it owns and rebuilds them, so re-running never accumulates duplicates.
 */

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MILLISECONDS_PER_DAY);
}

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * MILLISECONDS_PER_DAY);
}

/** Deterministic PRNG, so the seed is reproducible across machines. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const random = createRandom(42);

/**
 * Narrows an optional lookup, failing loudly instead of seeding a null.
 *
 * Used instead of a non-null assertion so that an inconsistency introduced
 * while editing the seed data stops the script with a sentence explaining what
 * is missing, rather than writing a broken row and surfacing hours later as an
 * unexplained empty screen.
 */
function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Seed data is inconsistent: ${what} is missing.`);
  }
  return value;
}

// The per-class parameters come from @leoni/core (section 3.4). The seed writes
// the defaults into the database rather than restating them: a seeded
// installation must start from exactly the values the application falls back to,
// or the first recalculation silently moves every threshold.

// ---------------------------------------------------------------------------
// Demo accounts — one per role (brief section 4)
// ---------------------------------------------------------------------------

interface SeedUser {
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  /** "LTN1", "LTN4", or null for the cross-site roles. */
  readonly siteCode: "LTN1" | "LTN4" | null;
}

const SEED_USERS: readonly SeedUser[] = [
  { email: "admin@leoni.tn", name: "Administrateur Systeme", role: "ADMIN", siteCode: null },
  {
    email: "magasinier.ltn1@leoni.tn",
    name: "Magasinier LTN1",
    role: "LTN1_STOREKEEPER",
    siteCode: "LTN1",
  },
  {
    email: "responsable.ltn1@leoni.tn",
    name: "Responsable Magasin LTN1",
    role: "LTN1_WAREHOUSE_MANAGER",
    siteCode: "LTN1",
  },
  {
    email: "responsable.ltn4@leoni.tn",
    name: "Responsable LTN4",
    role: "LTN4_RESPONSIBLE",
    siteCode: "LTN4",
  },
  {
    email: "logistique@leoni.tn",
    name: "Responsable Logistique",
    role: "LOGISTICS_MANAGER",
    siteCode: null,
  },
];

/**
 * How much stock each article should hold, expressed as a target alert level.
 *
 * Spread deliberately rather than randomly: the alert board must show every
 * severity on the first page, and a purely random draw reliably produces a
 * screen of all-green or all-red on the day of the defence.
 */
const ALERT_DISTRIBUTION: readonly AlertLevel[] = [
  "NORMAL",
  "NORMAL",
  "NORMAL",
  "NORMAL",
  "NORMAL",
  "WARNING",
  "WARNING",
  "CRITICAL",
  "CRITICAL",
  "RUPTURE",
];

/** Picks a stock level that lands the article on the requested alert level. */
function stockForLevel(level: AlertLevel, min: number, max: number): number {
  switch (level) {
    case "RUPTURE":
      return 0;
    case "CRITICAL":
      // Between just above zero and exactly Min.
      return Math.max(1, Math.round(min * (0.3 + random() * 0.7)));
    case "WARNING":
      // Inside the warning band: above Min, at or below Min x 1.2.
      return Math.round(min * (1 + random() * DEFAULT_WARNING_MARGIN_RATIO)) + 1;
    case "NORMAL":
      return Math.round(max * (0.75 + random() * 0.3));
  }
}

async function clearDatabase(): Promise<void> {
  // Ordered so that children go before parents; `deleteMany` does not cascade
  // in the order Prisma happens to feel like.
  await db.stockAlertSnapshot.deleteMany();
  await db.thresholdHistory.deleteMany();
  await db.requestStatusHistory.deleteMany();
  await db.requestComment.deleteMany();
  await db.requestAttachment.deleteMany();
  await db.replenishmentRequestLine.deleteMany();
  await db.replenishmentRequest.deleteMany();
  await db.stockMovement.deleteMany();
  await db.stockLot.deleteMany();
  await db.stockItem.deleteMany();
  await db.replenishmentParameter.deleteMany();
  await db.article.deleteMany();
  await db.notification.deleteMany();
  await db.auditLog.deleteMany();
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.user.deleteMany();
  await db.storageLocation.deleteMany();
  await db.site.deleteMany();
}

async function main(): Promise<void> {
  console.log("Seeding the LEONI replenishment database...");

  await clearDatabase();

  // --- Sites and storage locations -----------------------------------------
  const ltn1 = await db.site.create({
    data: { code: "LTN1", name: "LEONI Tunisie 1 (site consommateur)", type: "CONSUMING" },
  });
  const ltn4 = await db.site.create({
    data: { code: "LTN4", name: "LEONI Tunisie 4 (magasin central)", type: "SUPPLYING" },
  });

  const locationCodes = ["A-01", "A-02", "B-01", "B-02", "C-01"];
  await db.storageLocation.createMany({
    data: [
      ...locationCodes.map((code) => ({
        code,
        description: `Emplacement ${code}`,
        siteId: ltn1.id,
      })),
      ...locationCodes.map((code) => ({
        code,
        description: `Emplacement ${code}`,
        siteId: ltn4.id,
      })),
    ],
  });

  const ltn1Locations = await db.storageLocation.findMany({ where: { siteId: ltn1.id } });
  const ltn4Locations = await db.storageLocation.findMany({ where: { siteId: ltn4.id } });

  console.log(`  sites: 2, storage locations: ${String(locationCodes.length * 2)}`);

  // --- Users ---------------------------------------------------------------
  // From the validated environment rather than a second `?? "Leoni2026!"`:
  // @leoni/env already declares this variable and its default, and a duplicated
  // default is a password that can differ between the seed and the .env.example
  // the demo accounts are documented in.
  const password = env.SEED_USER_PASSWORD;
  // Hashed with better-auth's own hasher so the seeded accounts can actually
  // sign in through the normal login form, rather than being rows that look
  // right but fail authentication.
  const passwordHash = await hashPassword(password);

  const sitesByCode = { LTN1: ltn1.id, LTN4: ltn4.id } as const;
  const usersByRole = new Map<Role, string>();

  for (const seedUser of SEED_USERS) {
    const userId = randomUUID();

    const user = await db.user.create({
      data: {
        id: userId,
        name: seedUser.name,
        email: seedUser.email,
        emailVerified: true,
        role: seedUser.role,
        siteId: seedUser.siteCode === null ? null : sitesByCode[seedUser.siteCode],
        isActive: true,
        accounts: {
          create: {
            id: randomUUID(),
            // better-auth 1.7 matches a credential account on all three of
            // (providerId, issuer, accountId) at sign-in. Getting any one of
            // them wrong produces a row that looks correct in the database and
            // fails authentication, so the issuer is built with better-auth's
            // own helper rather than written as a literal.
            providerId: "credential",
            issuer: createLocalAccountIssuer("credential"),
            // For a credential account this is the user's own id: that is how
            // the stored password is linked back to the user.
            accountId: userId,
            password: passwordHash,
          },
        },
      },
    });
    usersByRole.set(seedUser.role, user.id);
  }

  console.log(`  users: ${String(SEED_USERS.length)} (password: ${password})`);

  // --- Replenishment parameters (section 3.4) ------------------------------
  await db.replenishmentParameter.createMany({
    data: ABC_CLASSES.map((abcClass) => ({
      abcClass,
      ...DEFAULT_CLASS_PARAMETERS[abcClass],
    })),
  });

  console.log(`  replenishment parameters: ${String(ABC_CLASSES.length)} class defaults`);

  // --- Articles, stock, movements ------------------------------------------
  const catalogue = buildCatalogue(150);
  const parametersByClass = new Map(
    ABC_CLASSES.map((abcClass) => [abcClass, defaultParametersForClass(abcClass)]),
  );

  interface SeededStock {
    readonly stockItemId: string;
    readonly article: SeedArticle;
    readonly min: number;
    readonly max: number;
    readonly currentStock: number;
    readonly level: AlertLevel;
  }

  const ltn1Stock: SeededStock[] = [];

  for (const [index, seedArticle] of catalogue.entries()) {
    const article = await db.article.create({
      data: {
        reference: seedArticle.reference,
        designation: seedArticle.designation,
        vpe: seedArticle.vpe,
        leadTimeDays: seedArticle.leadTimeDays,
        abcClass: seedArticle.abcClass,
        isActive: true,
      },
    });

    const parameter = required(
      parametersByClass.get(seedArticle.abcClass),
      `the replenishment parameter for class ${seedArticle.abcClass}`,
    );

    // The thresholds are computed by the domain package, not invented here.
    // Seeding through the real formulas is what guarantees the demo data is
    // consistent with what the application would compute on its own.
    const assessment = assessStockItem({
      currentStock: 0,
      averageDailyConsumption: seedArticle.dailyConsumption,
      leadTimeDays: seedArticle.leadTimeDays,
      safetyDays: parameter.safetyDays,
      extraCoverageDays: parameter.extraCoverageDays,
      vpe: seedArticle.vpe,
      warningMarginRatio: defaultParametersForClass(seedArticle.abcClass).warningMarginRatio,
    });

    const { min, max, safetyStock } = assessment.thresholds;

    const targetLevel = ALERT_DISTRIBUTION[index % ALERT_DISTRIBUTION.length] ?? "NORMAL";
    const currentStock = stockForLevel(targetLevel, min, max);

    // The level is resolved by the domain rather than assumed from the target:
    // `stockForLevel` aims at a band, the domain decides what the resulting
    // quantity actually means, and the stored column must agree with the domain.
    const ltn1Level = resolveAlertLevel({
      currentStock,
      min,
      warningMarginRatio: defaultParametersForClass(seedArticle.abcClass).warningMarginRatio,
    });

    // --- LTN1: the consuming plant ---
    const stockItem = await db.stockItem.create({
      data: {
        articleId: article.id,
        siteId: ltn1.id,
        currentStock,
        alertLevel: ltn1Level,
        averageDailyConsumption: seedArticle.dailyConsumption,
        minThreshold: min,
        maxThreshold: max,
        safetyStock,
        lastRecalculatedAt: daysAgo(1),
      },
    });

    ltn1Stock.push({
      stockItemId: stockItem.id,
      article: seedArticle,
      min,
      max,
      currentStock,
      level: ltn1Level,
    });

    // Lots, so FIFO picking has something to order by.
    if (currentStock > 0) {
      const lotCount = 1 + Math.floor(random() * 2);
      let remaining = currentStock;

      for (let lotIndex = 0; lotIndex < lotCount; lotIndex += 1) {
        const isLast = lotIndex === lotCount - 1;
        const quantity = isLast ? remaining : Math.ceil(remaining / 2);
        remaining -= quantity;

        const location = ltn1Locations[(index + lotIndex) % ltn1Locations.length];
        if (location === undefined || quantity <= 0) continue;

        await db.stockLot.create({
          data: {
            stockItemId: stockItem.id,
            storageLocationId: location.id,
            quantity,
            fifoDate: daysAgo(60 - lotIndex * 15),
          },
        });
      }
    }

    // --- LTN4: the supplying warehouse holds upstream stock ---
    // LTN4 carries several weeks of LTN1 demand. A handful of references are
    // deliberately short so the "LTN4 stock-out" path is demonstrable.
    const ltn4Stock = index % 17 === 0 ? 0 : Math.round(max * (2 + random() * 3));

    const ltn4StockItem = await db.stockItem.create({
      data: {
        articleId: article.id,
        siteId: ltn4.id,
        currentStock: ltn4Stock,
        alertLevel: resolveAlertLevel({
          currentStock: ltn4Stock,
          min: min * 2,
          warningMarginRatio: defaultParametersForClass(seedArticle.abcClass).warningMarginRatio,
        }),
        averageDailyConsumption: seedArticle.dailyConsumption,
        minThreshold: min * 2,
        maxThreshold: max * 3,
        safetyStock: safetyStock * 2,
        lastRecalculatedAt: daysAgo(1),
      },
    });

    // LTN4 is where picking actually happens, so its stock is split across
    // lots with distinct entry dates. Without them the FIFO suggestion
    // required by section 5 would have nothing to order by.
    if (ltn4Stock > 0) {
      const olderShare = Math.ceil(ltn4Stock * 0.4);
      const lotPlan = [
        { quantity: olderShare, ageInDays: 75 },
        { quantity: ltn4Stock - olderShare, ageInDays: 20 },
      ];

      for (const [lotIndex, lot] of lotPlan.entries()) {
        const location = ltn4Locations[(index + lotIndex) % ltn4Locations.length];
        if (location === undefined || lot.quantity <= 0) continue;

        await db.stockLot.create({
          data: {
            stockItemId: ltn4StockItem.id,
            storageLocationId: location.id,
            quantity: lot.quantity,
            fifoDate: daysAgo(lot.ageInDays),
          },
        });
      }
    }

    // --- Consumption history, so the rolling average is real ---
    const movements: {
      stockItemId: string;
      type: "EXIT";
      quantity: number;
      occurredAt: Date;
      reference: string;
    }[] = [];

    for (let day = DEFAULT_AVERAGING_WINDOW_DAYS; day >= 1; day -= 1) {
      // Consumption varies day to day; a perfectly flat history would make the
      // averaging window meaningless and the variability argument for the
      // safety stock impossible to illustrate.
      const variation = 0.6 + random() * 0.8;
      const quantity = Math.round(seedArticle.dailyConsumption * variation);
      if (quantity <= 0) continue;

      movements.push({
        stockItemId: stockItem.id,
        type: "EXIT",
        quantity,
        occurredAt: daysAgo(day),
        reference: `OF-${String(2_600 + day)}`,
      });
    }

    if (movements.length > 0) {
      await db.stockMovement.createMany({ data: movements });
    }
  }

  console.log(`  articles: ${String(catalogue.length)} (x2 sites = stock items)`);

  // --- Threshold history, so the "why did this change" screen has content ---
  const historySample = ltn1Stock.slice(0, 40);
  for (const stock of historySample) {
    const parameter = required(
      parametersByClass.get(stock.article.abcClass),
      `the replenishment parameter for class ${stock.article.abcClass}`,
    );

    for (const dayOffset of [30, 15, 1]) {
      const drift = 0.85 + random() * 0.3;
      const consumption = Math.round(stock.article.dailyConsumption * drift);
      const assessment = assessStockItem({
        currentStock: stock.currentStock,
        averageDailyConsumption: consumption,
        leadTimeDays: stock.article.leadTimeDays,
        safetyDays: parameter.safetyDays,
        extraCoverageDays: parameter.extraCoverageDays,
        vpe: stock.article.vpe,
      });

      await db.thresholdHistory.create({
        data: {
          stockItemId: stock.stockItemId,
          averageDailyConsumption: consumption,
          minThreshold: assessment.thresholds.min,
          maxThreshold: assessment.thresholds.max,
          safetyStock: assessment.thresholds.safetyStock,
          parametersSnapshot: {
            leadTimeDays: stock.article.leadTimeDays,
            safetyDays: parameter.safetyDays,
            extraCoverageDays: parameter.extraCoverageDays,
            averagingWindowDays: parameter.averagingWindowDays,
          },
          trigger: dayOffset === 1 ? "SCHEDULED" : "PARAMETER_CHANGE",
          computedAt: daysAgo(dayOffset),
        },
      });
    }
  }

  console.log(`  threshold history: ${String(historySample.length * 3)} entries`);

  // --- Requests in every status --------------------------------------------
  const storekeeperId = required(usersByRole.get("LTN1_STOREKEEPER"), "the LTN1 storekeeper");
  const managerId = required(
    usersByRole.get("LTN1_WAREHOUSE_MANAGER"),
    "the LTN1 warehouse manager",
  );
  const ltn4UserId = required(usersByRole.get("LTN4_RESPONSIBLE"), "the LTN4 responsible");

  const REQUEST_SCENARIOS: readonly {
    status: RequestStatus;
    daysAgo: number;
    reason?: string;
  }[] = [
    { status: "DRAFT", daysAgo: 0 },
    { status: "PENDING_APPROVAL", daysAgo: 1 },
    { status: "APPROVED", daysAgo: 2 },
    { status: "SENT_TO_LTN4", daysAgo: 3 },
    { status: "IN_PREPARATION", daysAgo: 4 },
    { status: "PARTIALLY_AVAILABLE", daysAgo: 5, reason: "Stock LTN4 insuffisant sur 2 lignes." },
    { status: "LTN4_STOCK_OUT", daysAgo: 6, reason: "Rupture fournisseur amont." },
    { status: "READY", daysAgo: 7 },
    { status: "SHIPPED", daysAgo: 8 },
    { status: "IN_TRANSIT", daysAgo: 9 },
    { status: "RECEIVED", daysAgo: 12 },
    { status: "CLOSED", daysAgo: 20 },
    { status: "REJECTED", daysAgo: 14, reason: "Quantite superieure au besoin reel." },
    { status: "CANCELLED", daysAgo: 16, reason: "Besoin couvert par une autre demande." },
    // A second batch so the list, the filters and the pagination have volume.
    { status: "CLOSED", daysAgo: 25 },
    { status: "CLOSED", daysAgo: 30 },
    { status: "PENDING_APPROVAL", daysAgo: 2 },
    { status: "IN_PREPARATION", daysAgo: 6 },
    { status: "SHIPPED", daysAgo: 11 },
    { status: "RECEIVED", daysAgo: 18 },
    // Two more drafts so the draft editor has something to open on a fresh
    // database: a screen that only exists when the demonstrator remembers to
    // create a request first is a screen that gets skipped.
    { status: "DRAFT", daysAgo: 1 },
    { status: "DRAFT", daysAgo: 3 },
  ];

  const REACHED_BY: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
    DRAFT: [],
    PENDING_APPROVAL: ["DRAFT"],
    APPROVED: ["DRAFT", "PENDING_APPROVAL"],
    SENT_TO_LTN4: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],
    IN_PREPARATION: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_LTN4"],
    PARTIALLY_AVAILABLE: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_LTN4"],
    LTN4_STOCK_OUT: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_LTN4"],
    READY: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_LTN4", "IN_PREPARATION"],
    SHIPPED: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_LTN4", "IN_PREPARATION", "READY"],
    IN_TRANSIT: [
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "SENT_TO_LTN4",
      "IN_PREPARATION",
      "READY",
      "SHIPPED",
    ],
    RECEIVED: [
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "SENT_TO_LTN4",
      "IN_PREPARATION",
      "READY",
      "SHIPPED",
      "IN_TRANSIT",
    ],
    CLOSED: [
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "SENT_TO_LTN4",
      "IN_PREPARATION",
      "READY",
      "SHIPPED",
      "IN_TRANSIT",
      "RECEIVED",
    ],
    REJECTED: ["DRAFT", "PENDING_APPROVAL"],
    CANCELLED: ["DRAFT", "PENDING_APPROVAL"],
  };

  const ACTION_FOR: Readonly<Record<RequestStatus, string>> = {
    DRAFT: "create",
    PENDING_APPROVAL: "submit",
    APPROVED: "approve",
    SENT_TO_LTN4: "transmit",
    IN_PREPARATION: "startPreparation",
    PARTIALLY_AVAILABLE: "declarePartial",
    LTN4_STOCK_OUT: "declareStockOut",
    READY: "markReady",
    SHIPPED: "ship",
    IN_TRANSIT: "markInTransit",
    RECEIVED: "confirmReceipt",
    CLOSED: "close",
    REJECTED: "reject",
    CANCELLED: "cancel",
  };

  const ACTOR_FOR: Readonly<Record<RequestStatus, string>> = {
    DRAFT: storekeeperId,
    PENDING_APPROVAL: storekeeperId,
    APPROVED: managerId,
    SENT_TO_LTN4: managerId,
    IN_PREPARATION: ltn4UserId,
    PARTIALLY_AVAILABLE: ltn4UserId,
    LTN4_STOCK_OUT: ltn4UserId,
    READY: ltn4UserId,
    SHIPPED: ltn4UserId,
    IN_TRANSIT: ltn4UserId,
    RECEIVED: storekeeperId,
    CLOSED: storekeeperId,
    REJECTED: managerId,
    CANCELLED: storekeeperId,
  };

  // Requests are raised for the articles that actually need replenishment,
  // which is what the alert-to-request flow does in the application.
  const replenishable = ltn1Stock.filter(
    (stock) => stock.level === "CRITICAL" || stock.level === "RUPTURE",
  );

  for (const [index, scenario] of REQUEST_SCENARIOS.entries()) {
    const lineCount = 2 + (index % 3);
    const lines = replenishable.slice(index * 2, index * 2 + lineCount);
    if (lines.length === 0) continue;

    const createdAt = daysAgo(scenario.daysAgo);
    const isPast = (status: RequestStatus): boolean =>
      REACHED_BY[scenario.status].includes(status) || scenario.status === status;

    const request = await db.replenishmentRequest.create({
      data: {
        code: `DR-2026-${String(index + 1).padStart(4, "0")}`,
        status: scenario.status,
        priority: index % 5 === 0 ? "URGENT" : index % 3 === 0 ? "HIGH" : "NORMAL",
        fromSiteId: ltn4.id,
        toSiteId: ltn1.id,
        createdById: storekeeperId,
        approvedById: isPast("APPROVED") ? managerId : null,
        createdAt,
        submittedAt: isPast("PENDING_APPROVAL") ? createdAt : null,
        approvedAt: isPast("APPROVED")
          ? new Date(createdAt.getTime() + MILLISECONDS_PER_DAY)
          : null,
        sentAt: isPast("SENT_TO_LTN4")
          ? new Date(createdAt.getTime() + MILLISECONDS_PER_DAY)
          : null,
        preparedAt: isPast("READY")
          ? new Date(createdAt.getTime() + 2 * MILLISECONDS_PER_DAY)
          : null,
        shippedAt: isPast("SHIPPED")
          ? new Date(createdAt.getTime() + 3 * MILLISECONDS_PER_DAY)
          : null,
        receivedAt: isPast("RECEIVED")
          ? new Date(createdAt.getTime() + 4 * MILLISECONDS_PER_DAY)
          : null,
        closedAt:
          scenario.status === "CLOSED"
            ? new Date(createdAt.getTime() + 5 * MILLISECONDS_PER_DAY)
            : null,
        // A few requests are deliberately overdue so the lateness indicator and
        // the on-time-delivery KPI have something to report.
        expectedDeliveryAt: index % 4 === 0 ? daysAgo(1) : daysFromNow(2),
        reason: scenario.reason ?? null,
      },
    });

    for (const line of lines) {
      const assessment = assessStockItem({
        currentStock: line.currentStock,
        averageDailyConsumption: line.article.dailyConsumption,
        leadTimeDays: line.article.leadTimeDays,
        safetyDays: defaultParametersForClass(line.article.abcClass).safetyDays,
        extraCoverageDays: defaultParametersForClass(line.article.abcClass).extraCoverageDays,
        vpe: line.article.vpe,
      });

      const suggested = assessment.order.recommendedQuantity;
      const requested = suggested;

      const articleRow = await db.article.findUniqueOrThrow({
        where: { reference: line.article.reference },
      });

      await db.replenishmentRequestLine.create({
        data: {
          requestId: request.id,
          articleId: articleRow.id,
          requestedQuantity: requested,
          suggestedQuantity: suggested,
          vpeSnapshot: line.article.vpe,
          approvedQuantity: isPast("APPROVED") ? requested : null,
          preparedQuantity: isPast("READY") ? requested : null,
          shippedQuantity: isPast("SHIPPED") ? requested : null,
          // A partially received line, so the shortfall case is visible.
          receivedQuantity: isPast("RECEIVED")
            ? index % 6 === 0
              ? Math.max(0, requested - line.article.vpe)
              : requested
            : null,
        },
      });
    }

    // Full audit trail: one row per transition actually traversed.
    const path: RequestStatus[] = [...REACHED_BY[scenario.status], scenario.status];
    let previous: RequestStatus | null = null;

    for (const [step, status] of path.entries()) {
      await db.requestStatusHistory.create({
        data: {
          requestId: request.id,
          fromStatus: previous,
          toStatus: status,
          action: ACTION_FOR[status],
          reason: status === scenario.status ? (scenario.reason ?? null) : null,
          userId: ACTOR_FOR[status],
          occurredAt: new Date(createdAt.getTime() + step * 6 * 60 * 60 * 1000),
        },
      });
      previous = status;
    }

    if (index % 3 === 0) {
      await db.requestComment.create({
        data: {
          requestId: request.id,
          userId: ltn4UserId,
          content: "Preparation en cours, expedition prevue avec le prochain transfert.",
          createdAt: new Date(createdAt.getTime() + 12 * 60 * 60 * 1000),
        },
      });
    }
  }

  console.log(`  requests: ${String(REQUEST_SCENARIOS.length)} covering every status`);

  // --- Ninety days of alert snapshots, so the KPI charts have a curve -------
  const snapshotSample = ltn1Stock.slice(0, 60);
  const snapshots: {
    stockItemId: string;
    level: AlertLevel;
    currentStock: number;
    minThreshold: number;
    coverageDays: number | null;
    snapshotDate: Date;
  }[] = [];

  for (let dayOffset = 90; dayOffset >= 1; dayOffset -= 1) {
    const date = daysAgo(dayOffset);
    date.setUTCHours(0, 0, 0, 0);

    for (const stock of snapshotSample) {
      const wobble = 0.5 + random() * 1.4;
      const historicalStock = Math.max(0, Math.round(stock.currentStock * wobble));
      const level = resolveAlertLevel({
        currentStock: historicalStock,
        min: stock.min,
        warningMarginRatio: defaultParametersForClass(stock.article.abcClass).warningMarginRatio,
      });

      snapshots.push({
        stockItemId: stock.stockItemId,
        level,
        currentStock: historicalStock,
        minThreshold: stock.min,
        coverageDays:
          stock.article.dailyConsumption > 0
            ? Math.round((historicalStock / stock.article.dailyConsumption) * 10) / 10
            : null,
        snapshotDate: date,
      });
    }
  }

  // Chunked: a single createMany of ~5 400 rows is fine, but the pattern
  // matters once the real catalogue is ten times this size.
  const CHUNK_SIZE = 1_000;
  for (let offset = 0; offset < snapshots.length; offset += CHUNK_SIZE) {
    await db.stockAlertSnapshot.createMany({
      data: snapshots.slice(offset, offset + CHUNK_SIZE),
      skipDuplicates: true,
    });
  }

  console.log(`  alert snapshots: ${String(snapshots.length)} (90 days x 60 articles)`);

  // --- Notifications --------------------------------------------------------
  const criticalStock = ltn1Stock.filter((stock) => stock.level === "RUPTURE").slice(0, 8);
  await db.notification.createMany({
    data: criticalStock.map((stock, index) => ({
      type: "STOCK_RUPTURE" as const,
      title: `Rupture de stock : ${stock.article.reference}`,
      body: `${stock.article.designation} est en rupture a LTN1.`,
      payload: { reference: stock.article.reference, level: "RUPTURE" },
      userId: storekeeperId,
      readAt: index < 3 ? daysAgo(1) : null,
      createdAt: daysAgo(index),
    })),
  });

  console.log(`  notifications: ${String(criticalStock.length)}`);

  // --- Summary --------------------------------------------------------------
  const levelCounts = new Map<AlertLevel, number>();
  for (const stock of ltn1Stock) {
    levelCounts.set(stock.level, (levelCounts.get(stock.level) ?? 0) + 1);
  }

  console.log("\nAlert distribution at LTN1:");
  for (const level of ["NORMAL", "WARNING", "CRITICAL", "RUPTURE"] as const) {
    console.log(`  ${level.padEnd(9)} ${String(levelCounts.get(level) ?? 0)}`);
  }
  console.log("\nSeed complete.");
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("Seed failed:", error);
    await db.$disconnect();
    process.exit(1);
  });
