import { describe, expect, it } from "vitest";

import { BusinessRuleError } from "../errors/domain-error";
import { allocateFifo, type FifoLot, totalAvailable } from "./fifo";

function lot(id: string, quantity: number, day: number): FifoLot {
  return { id, quantity, fifoDate: new Date(Date.UTC(2026, 0, day)) };
}

const LOTS: readonly FifoLot[] = [lot("recent", 500, 20), lot("oldest", 300, 5), lot("mid", 200, 10)];

describe("totalAvailable", () => {
  it("sums the lots", () => {
    expect(totalAvailable(LOTS)).toBe(1_000);
  });

  it("is zero for no lots", () => {
    expect(totalAvailable([])).toBe(0);
  });
});

describe("allocateFifo", () => {
  it("draws from the oldest lot first", () => {
    expect(allocateFifo(LOTS, 250)).toEqual([{ lotId: "oldest", quantity: 250, remaining: 50 }]);
  });

  it("spills into the next-oldest once a lot is exhausted", () => {
    expect(allocateFifo(LOTS, 450)).toEqual([
      { lotId: "oldest", quantity: 300, remaining: 0 },
      { lotId: "mid", quantity: 150, remaining: 50 },
    ]);
  });

  it("empties every lot when the whole stock is drawn", () => {
    const allocations = allocateFifo(LOTS, 1_000);
    expect(allocations.map((allocation) => allocation.lotId)).toEqual(["oldest", "mid", "recent"]);
    expect(allocations.every((allocation) => allocation.remaining === 0)).toBe(true);
  });

  it("breaks a tie on the identifier so two runs agree", () => {
    const sameDay = [lot("b", 10, 1), lot("a", 10, 1)];
    expect(allocateFifo(sameDay, 5)[0]?.lotId).toBe("a");
  });

  it("skips an emptied lot rather than emitting a zero allocation", () => {
    const withEmpty = [lot("empty", 0, 1), lot("full", 10, 2)];
    expect(allocateFifo(withEmpty, 5)).toEqual([{ lotId: "full", quantity: 5, remaining: 5 }]);
  });

  it("allocates nothing for a non-positive quantity", () => {
    expect(allocateFifo(LOTS, 0)).toEqual([]);
    expect(allocateFifo(LOTS, -5)).toEqual([]);
  });

  it("refuses to pick more than the shelf holds", () => {
    // A partial pick the caller silently accepts is how a stock level and a
    // shelf stop agreeing.
    expect(() => allocateFifo(LOTS, 1_001)).toThrow(BusinessRuleError);
  });
});
