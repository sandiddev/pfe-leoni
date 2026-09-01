import { describe, expect, it } from "vitest";

import {
  ABC_CLASSES,
  ALERT_LEVELS,
  MEASUREMENT_UNITS,
  MOVEMENT_TYPES,
  NOTIFICATION_TYPES,
  RECALCULATION_TRIGGERS,
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  ROLES,
  SITE_TYPES,
} from "@leoni/core";

import * as prismaEnums from "./generated/prisma/enums";

/**
 * The domain package and the database each declare these value sets, and they
 * have to agree: the domain owns what a status *means*, the database owns how
 * it is *stored*. Neither can import the other — the domain is deliberately
 * dependency-free, and the generated client is emitted code — so the agreement
 * cannot be expressed in the type system.
 *
 * These tests are that agreement. Adding a status to the Prisma schema without
 * adding it to `@leoni/core` (or the reverse) fails here, at build time, rather
 * than as an unhandled case in a `switch` somewhere in production.
 *
 * The check runs in **both** directions on purpose. Comparing only the pairs
 * someone remembered to list is how a new Prisma enum arrives with no domain
 * counterpart and no test failure — which is what had already happened to five
 * of the nine enums in this schema.
 */

/**
 * Each Prisma enum beside the domain union that must match it.
 *
 * Paired explicitly rather than looked up by name from a record: indexing two
 * objects by a `string` key needs a cast on both sides, and the whole point of
 * this file is that agreements should be checked, not asserted.
 */
const ENUM_PAIRS = [
  { name: "AbcClass", domain: ABC_CLASSES, prisma: prismaEnums.AbcClass },
  { name: "AlertLevel", domain: ALERT_LEVELS, prisma: prismaEnums.AlertLevel },
  { name: "MeasurementUnit", domain: MEASUREMENT_UNITS, prisma: prismaEnums.MeasurementUnit },
  { name: "MovementType", domain: MOVEMENT_TYPES, prisma: prismaEnums.MovementType },
  { name: "NotificationType", domain: NOTIFICATION_TYPES, prisma: prismaEnums.NotificationType },
  {
    name: "RecalculationTrigger",
    domain: RECALCULATION_TRIGGERS,
    prisma: prismaEnums.RecalculationTrigger,
  },
  { name: "RequestPriority", domain: REQUEST_PRIORITIES, prisma: prismaEnums.RequestPriority },
  { name: "RequestStatus", domain: REQUEST_STATUSES, prisma: prismaEnums.RequestStatus },
  { name: "Role", domain: ROLES, prisma: prismaEnums.Role },
  { name: "SiteType", domain: SITE_TYPES, prisma: prismaEnums.SiteType },
] as const;

/**
 * Prisma emits each enum as a frozen object of value -> value, alongside its
 * type aliases. Filtering to plain objects is what separates the enums from the
 * types the same module exports.
 */
function prismaEnumNames(): string[] {
  return Object.entries(prismaEnums)
    .filter(([, value]) => typeof value === "object" && value !== null)
    .map(([name]) => name)
    .toSorted();
}

function valuesOf(enumObject: unknown): string[] {
  if (typeof enumObject !== "object" || enumObject === null) {
    throw new Error("Not a Prisma enum object.");
  }
  return Object.values(enumObject)
    .filter((value): value is string => typeof value === "string")
    .toSorted();
}

describe("enum parity between @leoni/core and the Prisma schema", () => {
  it("declares a domain union for every Prisma enum", () => {
    // The direction that actually catches new work: a `enum Foo` added to the
    // schema with no matching const array in @leoni/core fails right here.
    expect(prismaEnumNames()).toStrictEqual(ENUM_PAIRS.map((pair) => pair.name).toSorted());
  });

  it.each(ENUM_PAIRS.map((pair) => [pair.name, pair] as const))(
    "agrees on the members of %s",
    (_name, pair) => {
      expect(valuesOf(pair.prisma)).toStrictEqual([...pair.domain].toSorted());
    },
  );

  it("does not store LATE as a request status", () => {
    // Lateness is derived from expectedDeliveryAt, not stored, so that a late
    // request still shows where it actually is in the process.
    expect([...REQUEST_STATUSES]).not.toContain("LATE");
    expect(valuesOf(prismaEnums.RequestStatus)).not.toContain("LATE");
  });
});
