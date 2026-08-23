import { describe, expect, it } from "vitest";

import { findTransition, transitionsFrom } from "./can-transition";
import {
  EXCEPTION_STATUSES,
  isExceptionStatus,
  isRequestStatus,
  isTerminalStatus,
  NOMINAL_STATUS_SEQUENCE,
  nominalStepIndex,
  REQUEST_STATUSES,
  TERMINAL_STATUSES,
} from "./request-status";

describe("request status guards", () => {
  it("recognises every declared status", () => {
    for (const status of REQUEST_STATUSES) {
      expect(isRequestStatus(status)).toBe(true);
    }
  });

  it("rejects a status that is not part of the process", () => {
    // "LATE" is deliberately absent: lateness is a derived indicator, not a
    // state (see the note at the top of request-status.ts).
    expect(isRequestStatus("LATE")).toBe(false);
    expect(isRequestStatus("")).toBe(false);
  });

  it("identifies the terminal statuses", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminalStatus(status)).toBe(true);
      expect(transitionsFrom(status)).toStrictEqual([]);
    }
    expect(isTerminalStatus("DRAFT")).toBe(false);
  });

  it("identifies the exception statuses", () => {
    for (const status of EXCEPTION_STATUSES) {
      expect(isExceptionStatus(status)).toBe(true);
    }
    expect(isExceptionStatus("IN_PREPARATION")).toBe(false);
  });
});

describe("nominalStepIndex (the progress stepper)", () => {
  it("places each nominal status at its position on the happy path", () => {
    expect(nominalStepIndex("DRAFT")).toBe(0);
    expect(nominalStepIndex("CLOSED")).toBe(NOMINAL_STATUS_SEQUENCE.length - 1);
    expect(nominalStepIndex("READY")).toBeGreaterThan(nominalStepIndex("APPROVED") ?? -1);
  });

  it("returns null for a status that is off the happy path", () => {
    // The stepper renders these as a deviation rather than as a step.
    expect(nominalStepIndex("REJECTED")).toBeNull();
    expect(nominalStepIndex("LTN4_STOCK_OUT")).toBeNull();
    expect(nominalStepIndex("PARTIALLY_AVAILABLE")).toBeNull();
  });
});

describe("findTransition", () => {
  it("finds a defined transition", () => {
    expect(findTransition("DRAFT", "PENDING_APPROVAL")?.action).toBe("submit");
  });

  it("returns undefined for a transition that does not exist", () => {
    expect(findTransition("DRAFT", "CLOSED")).toBeUndefined();
  });
});
