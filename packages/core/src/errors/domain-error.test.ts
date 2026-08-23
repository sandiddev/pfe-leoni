import { describe, expect, it } from "vitest";

import {
  BusinessRuleError,
  DomainError,
  ForbiddenActionError,
  InvalidInputError,
  isDomainError,
  TransitionNotAllowedError,
} from "./domain-error";

describe("the domain error hierarchy", () => {
  it("names itself after the concrete subclass", () => {
    // The name is what appears in logs and in the tRPC error payload, so it has
    // to identify the actual rule that was broken.
    expect(new BusinessRuleError("nope").name).toBe("BusinessRuleError");
    expect(new InvalidInputError("nope").name).toBe("InvalidInputError");
  });

  it("carries a stable transport-agnostic code", () => {
    expect(new BusinessRuleError("x").code).toBe("BUSINESS_RULE_VIOLATION");
    expect(new InvalidInputError("x").code).toBe("INVALID_INPUT");
    expect(new TransitionNotAllowedError("x").code).toBe("TRANSITION_NOT_ALLOWED");
    expect(new ForbiddenActionError("x").code).toBe("FORBIDDEN_ACTION");
  });

  it("defaults to empty details rather than undefined", () => {
    // Callers can always read `.details` without a null check.
    expect(new BusinessRuleError("x").details).toStrictEqual({});
  });

  it("keeps the structured details it was given", () => {
    const error = new InvalidInputError("bad vpe", { vpe: 0 });
    expect(error.details).toStrictEqual({ vpe: 0 });
  });

  it("is recognisable through isDomainError", () => {
    expect(isDomainError(new BusinessRuleError("x"))).toBe(true);
    expect(isDomainError(new Error("plain"))).toBe(false);
    expect(isDomainError("not an error")).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });

  it("remains a real Error, so stack traces and instanceof still work", () => {
    const error = new ForbiddenActionError("x");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.message).toBe("x");
  });
});
