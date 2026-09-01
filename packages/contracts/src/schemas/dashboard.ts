import { z } from "zod";

import type { AlertLevel, RequestStatus } from "@leoni/core";

import { idSchema } from "./common";

/**
 * The KPIs (brief section 6.5).
 *
 * All five are questions about the past, which is why `StockAlertSnapshot`
 * exists: alert levels are recomputed on read from the current stock, and the
 * present cannot answer "how many articles were at risk in February".
 */

export const dashboardInputSchema = z.object({
  siteId: idSchema.optional(),
  /** Length of the observation window. Ninety days of snapshots are seeded. */
  days: z.number().int().min(7).max(365).default(90),
});

export type DashboardInput = z.infer<typeof dashboardInputSchema>;

export const dashboardExportInputSchema = dashboardInputSchema;

export type DashboardExportInput = z.infer<typeof dashboardExportInputSchema>;

// --- Outputs ----------------------------------------------------------------

/** One day of the stock-out history. */
export interface StockOutPoint {
  readonly date: Date;
  readonly trackedArticles: number;
  readonly rupture: number;
  readonly critical: number;
  readonly warning: number;
  /** Share of tracked articles in rupture that day, as a percentage. */
  readonly stockOutRate: number;
}

/**
 * Service level (`GLOSSARY_FR.serviceLevel`).
 *
 * A request counts as served when every line arrived in full. Counting lines
 * instead of requests would flatter the figure: nine complete lines and one
 * missing still stops the line the tenth feeds.
 */
export interface ServiceLevel {
  readonly closedRequests: number;
  readonly fullyServed: number;
  /** Percentage; `null` when nothing has closed yet, never a misleading 0. */
  readonly rate: number | null;
  readonly onTime: number;
  readonly onTimeRate: number | null;
}

/**
 * Real against theoretical lead time.
 *
 * The theoretical figure is the delay the article master declares; the real one
 * is measured from the milestone timestamps the workflow stamps. The gap
 * between them is the number the logistics manager steers on.
 */
export interface LeadTimeSummary {
  readonly measuredRequests: number;
  /** Days from transmission to receipt, averaged. `null` with no data. */
  readonly averageRealDays: number | null;
  readonly averageTheoreticalDays: number | null;
  /** Days from creation to approval — where the old email process was slowest. */
  readonly averageApprovalDays: number | null;
}

export interface StatusCount {
  readonly status: RequestStatus;
  readonly count: number;
}

export interface AlertDistribution {
  readonly level: AlertLevel;
  readonly count: number;
}

export interface DashboardSummary {
  readonly windowDays: number;
  readonly generatedAt: Date;

  readonly trackedArticles: number;
  readonly alertDistribution: readonly AlertDistribution[];
  readonly openRequests: number;
  readonly lateRequests: number;

  readonly serviceLevel: ServiceLevel;
  readonly leadTime: LeadTimeSummary;
  readonly stockOutHistory: readonly StockOutPoint[];
  readonly requestsByStatus: readonly StatusCount[];
}

/** A CSV the logistics manager can take into a spreadsheet (`report:export`). */
export interface DashboardExport {
  readonly fileName: string;
  readonly content: string;
}
