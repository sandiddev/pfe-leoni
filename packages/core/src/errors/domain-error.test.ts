import { describe, expect, it } from "vitest";

import {
  BusinessRuleError,
  ConflictError,
  DomainError,
  ForbiddenActionError,
  InvalidInputError,
  isDomainError,
  NotFoundError,
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
    expect(new NotFoundError("x").code).toBe("NOT_FOUND");
    expect(new ConflictError("x").code).toBe("CONFLICT");
  });

  it("separates a lost race from an illegal move", () => {
    // Both surface as HTTP 409, and they mean different things to the user: one
    // says reload, the other says you may not. Sharing a code would make the
    // UI unable to tell a stale screen from a forbidden action.
    expect(new ConflictError("x").code).not.toBe(new TransitionNotAllowedError("x").code);
    expect(new ConflictError("x", { requestId: "r1" }).details).toStrictEqual({
      requestId: "r1",
    });
  });

  it("routes a missing entity through the domain hierarchy, not a bare Error", () => {
    // A service that throws a plain `Error` for "not found" reaches the tRPC
    // error formatter unrecognised and surfaces as a 500 with its message
    // withheld — which is what an earlier ArticleNotFoundError did.
    const error = new NotFoundError("Article introuvable : abc", { articleId: "abc" });
    expect(isDomainError(error)).toBe(true);
    expect(error.details).toStrictEqual({ articleId: "abc" });
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
