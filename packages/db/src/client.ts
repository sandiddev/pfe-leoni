import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "@leoni/env";

import { PrismaClient } from "./generated/prisma/client";

/**
 * The single Prisma client for the whole application.
 *
 * Prisma 7 talks to Postgres through a driver adapter rather than its own
 * bundled engine, so the connection pool is `pg`. The pool size is set
 * deliberately: the application runs on one LEONI host, and an unbounded pool
 * would let a burst of dashboard queries exhaust the server's connection slots
 * and lock out the storekeepers actually recording movements.
 *
 * In development Next.js reloads modules on every edit. Constructing a new
 * client each time would open a new pool each time and exhaust Postgres within
 * minutes of ordinary work, so the instance is cached on `globalThis` — which
 * survives module reloads. In production the module is evaluated once and the
 * cache is never read.
 */
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  leoniPrisma: PrismaClient | undefined;
};

export const db: PrismaClient = globalForPrisma.leoniPrisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.leoniPrisma = db;
}
