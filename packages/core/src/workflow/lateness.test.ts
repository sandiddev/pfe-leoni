import { describe, expect, it } from "vitest";

import { assessLateness } from "./lateness";

const NOW = new Date("2026-08-22T12:00:00.000Z");
const EXPECTED = new Date("2026-08-18T12:00:00.000Z");

describe("assessLateness", () => {
  it("counts whole days past the committed delivery date", () => {
    const result = assessLateness({
      status: "IN_TRANSIT",
      expectedDeliveryAt: EXPECTED,
      receivedAt: null,
      now: NOW,
    });

    expect(result).toStrictEqual({ isLate: true, daysLate: 4 });
  });

  it("is not late before the commitment falls due", () => {
    const result = assessLateness({
      status: "IN_PREPARATION",
      expectedDeliveryAt: new Date("2026-08-25T12:00:00.000Z"),
      receivedAt: null,
      now: NOW,
    });

    expect(result).toStrictEqual({ isLate: false, daysLate: 0 });
  });

  it("stops the clock at the actual arrival instead of letting it grow", () => {
    // The request arrived one day late; three days later it is still one day
    // late, not four. The KPI measures the delivery, not the reporting date.
    const result = assessLateness({
      status: "RECEIVED",
      expectedDeliveryAt: EXPECTED,
      receivedAt: new Date("2026-08-19T12:00:00.000Z"),
      now: NOW,
    });

    expect(result).toStrictEqual({ isLate: true, daysLate: 1 });
  });

  it("reports at least one day for a delivery that slipped by hours", () => {
    const result = assessLateness({
      status: "IN_TRANSIT",
      expectedDeliveryAt: new Date("2026-08-22T08:00:00.000Z"),
      receivedAt: null,
      now: NOW,
    });

    expect(result).toStrictEqual({ isLate: true, daysLate: 1 });
  });

  it("does not call a cancelled or rejected request late", () => {
    // Neither was ever going to be delivered, so counting them as late would
    // corrupt the on-time-delivery KPI.
    for (const status of ["CANCELLED", "REJECTED", "CLOSED"] as const) {
      expect(
        assessLateness({ status, expectedDeliveryAt: EXPECTED, receivedAt: null, now: NOW }),
      ).toStrictEqual({ isLate: false, daysLate: 0 });
    }
  });

  it("is not late when LTN4 committed to no date", () => {
    expect(
      assessLateness({
        status: "IN_PREPARATION",
        expectedDeliveryAt: null,
        receivedAt: null,
        now: NOW,
      }),
    ).toStrictEqual({ isLate: false, daysLate: 0 });
  });
});
