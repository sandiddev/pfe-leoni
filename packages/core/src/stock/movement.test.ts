import { describe, expect, it } from "vitest";

import { InvalidInputError } from "../errors/domain-error";
import { MOVEMENT_TYPES } from "../shared/enums";
import { applyMovement, isConsumption, wouldGoNegative } from "./movement";

describe("isConsumption", () => {
  it("counts an exit", () => {
    expect(isConsumption("EXIT")).toBe(true);
  });

  it("does not count a transfer out", () => {
    // Material leaving for the other plant is not demand from the line, and
    // counting it would inflate every threshold derived from the average.
    expect(isConsumption("TRANSFER_OUT")).toBe(false);
  });

  it.each(["ENTRY", "ADJUSTMENT", "TRANSFER_IN"] as const)("does not count %s", (type) => {
    expect(isConsumption(type)).toBe(false);
  });
});

describe("applyMovement", () => {
  it("adds an entry", () => {
    expect(applyMovement({ currentStock: 100, type: "ENTRY", quantity: 40 })).toBe(140);
  });

  it("adds a transfer in", () => {
    expect(applyMovement({ currentStock: 100, type: "TRANSFER_IN", quantity: 40 })).toBe(140);
  });

  it("subtracts an exit", () => {
    expect(applyMovement({ currentStock: 100, type: "EXIT", quantity: 40 })).toBe(60);
  });

  it("subtracts a transfer out", () => {
    expect(applyMovement({ currentStock: 100, type: "TRANSFER_OUT", quantity: 40 })).toBe(60);
  });

  it("replaces the level on an inventory count", () => {
    // The counted figure is what is on the shelf, whatever the system believed.
    expect(applyMovement({ currentStock: 100, type: "ADJUSTMENT", quantity: 87 })).toBe(87);
  });

  it("handles every movement type", () => {
    for (const type of MOVEMENT_TYPES) {
      expect(Number.isFinite(applyMovement({ currentStock: 10, type, quantity: 5 }))).toBe(true);
    }
  });

  it.each([-1, 1.5, Number.NaN])("rejects the quantity %s", (quantity) => {
    expect(() => applyMovement({ currentStock: 10, type: "ENTRY", quantity })).toThrow(
      InvalidInputError,
    );
  });
});

describe("wouldGoNegative", () => {
  it("is true when an exit exceeds the stock", () => {
    expect(wouldGoNegative({ currentStock: 10, type: "EXIT", quantity: 11 })).toBe(true);
  });

  it("is false when the exit empties the stock exactly", () => {
    expect(wouldGoNegative({ currentStock: 10, type: "EXIT", quantity: 10 })).toBe(false);
  });

  it("is false for an entry", () => {
    expect(wouldGoNegative({ currentStock: 0, type: "ENTRY", quantity: 10 })).toBe(false);
  });
});
