import { describe, expect, it } from "vitest";

import { InvalidInputError } from "../errors/domain-error";
import { type ConsumptionSample, rollingAverageDailyConsumption } from "./consumption";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("rollingAverageDailyConsumption (brief section 2)", () => {
  it("averages over the window length, not over the days that had movements", () => {
    const samples: ConsumptionSample[] = [{ occurredAt: daysBefore(3), quantity: 3_000 }];

    // 3 000 / 30 = 100, not 3 000 / 1 = 3 000. Dividing by active days would
    // overstate demand tenfold for an intermittently consumed article.
    expect(rollingAverageDailyConsumption({ samples, windowDays: 30, now: NOW })).toBe(100);
  });

  it("sums every movement inside the window", () => {
    const samples: ConsumptionSample[] = [
      { occurredAt: daysBefore(1), quantity: 500 },
      { occurredAt: daysBefore(10), quantity: 500 },
      { occurredAt: daysBefore(29), quantity: 500 },
    ];

    expect(rollingAverageDailyConsumption({ samples, windowDays: 30, now: NOW })).toBe(50);
  });

  it("excludes movements older than the window", () => {
    const samples: ConsumptionSample[] = [
      { occurredAt: daysBefore(5), quantity: 300 },
      { occurredAt: daysBefore(45), quantity: 100_000 },
    ];

    expect(rollingAverageDailyConsumption({ samples, windowDays: 30, now: NOW })).toBe(10);
  });

  it("excludes movements dated in the future", () => {
    const samples: ConsumptionSample[] = [
      { occurredAt: new Date(NOW.getTime() + 60_000), quantity: 9_999 },
      { occurredAt: daysBefore(1), quantity: 70 },
    ];

    expect(rollingAverageDailyConsumption({ samples, windowDays: 7, now: NOW })).toBe(10);
  });

  it("reacts faster on a 7-day window than on a 90-day window", () => {
    const samples: ConsumptionSample[] = [{ occurredAt: daysBefore(2), quantity: 700 }];

    const short = rollingAverageDailyConsumption({ samples, windowDays: 7, now: NOW });
    const long = rollingAverageDailyConsumption({ samples, windowDays: 90, now: NOW });

    expect(short).toBe(100);
    expect(long).toBeLessThan(short);
  });

  it("returns zero when there has been no consumption", () => {
    expect(rollingAverageDailyConsumption({ samples: [], windowDays: 30, now: NOW })).toBe(0);
  });

  it("rejects a non-positive window", () => {
    expect(() => rollingAverageDailyConsumption({ samples: [], windowDays: 0, now: NOW })).toThrow(
      InvalidInputError,
    );
  });

  it("rejects a negative movement quantity", () => {
    const samples: ConsumptionSample[] = [{ occurredAt: daysBefore(1), quantity: -5 }];
    expect(() => rollingAverageDailyConsumption({ samples, windowDays: 30, now: NOW })).toThrow(
      InvalidInputError,
    );
  });
});
