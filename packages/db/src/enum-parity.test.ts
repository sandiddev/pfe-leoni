import { describe, expect, it } from "vitest";

import { ABC_CLASSES, ALERT_LEVELS, REQUEST_STATUSES, ROLES } from "@leoni/core";

import { AbcClass, AlertLevel, RequestStatus, Role } from "./generated/prisma/enums";

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
 */
function prismaValues(enumObject: Readonly<Record<string, string>>): string[] {
  return Object.values(enumObject).sort();
}

function domainValues(values: readonly string[]): string[] {
  return [...values].sort();
}

describe("enum parity between @leoni/core and the Prisma schema", () => {
  it("agrees on the set of roles", () => {
    expect(prismaValues(Role)).toStrictEqual(domainValues(ROLES));
  });

  it("agrees on the set of request statuses", () => {
    expect(prismaValues(RequestStatus)).toStrictEqual(domainValues(REQUEST_STATUSES));
  });

  it("agrees on the set of alert levels", () => {
    expect(prismaValues(AlertLevel)).toStrictEqual(domainValues(ALERT_LEVELS));
  });

  it("agrees on the set of ABC classes", () => {
    expect(prismaValues(AbcClass)).toStrictEqual(domainValues(ABC_CLASSES));
  });

  it("does not store LATE as a request status", () => {
    // Lateness is derived from expectedDeliveryAt, not stored, so that a late
    // request still shows where it actually is in the process.
    expect(prismaValues(RequestStatus)).not.toContain("LATE");
  });
});
