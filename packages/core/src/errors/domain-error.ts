/**
 * Base class for every rule violation expressed by the domain layer.
 *
 * The domain does not know what HTTP is. It throws these; the tRPC error
 * formatter in @leoni/api is the single place that decides which status code a
 * given `code` maps to. That keeps the transport concern out of the rules, and
 * it means the same error surfaces correctly whether it was raised by a tRPC
 * call, by the nightly recalculation job or by a unit test.
 */
export abstract class DomainError extends Error {
  /** Stable, transport-agnostic identifier. Mapped to a tRPC code in @leoni/api. */
  abstract readonly code: string;

  /** Structured detail for the client — never a raw stack or SQL fragment. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    // `new.target` gives the concrete subclass, so the name is always accurate
    // without each subclass having to repeat itself.
    this.name = new.target.name;
    this.details = details;
  }
}

/** A business invariant was violated — a rule the user could have satisfied. */
export class BusinessRuleError extends DomainError {
  override readonly code = "BUSINESS_RULE_VIOLATION";
}

/** A caller supplied a value the domain cannot interpret (negative lead time, zero VPE). */
export class InvalidInputError extends DomainError {
  override readonly code = "INVALID_INPUT";
}

/** A request was moved along a path the workflow does not allow. */
export class TransitionNotAllowedError extends DomainError {
  override readonly code = "TRANSITION_NOT_ALLOWED";
}

/** The actor's role does not carry the permission the operation requires. */
export class ForbiddenActionError extends DomainError {
  override readonly code = "FORBIDDEN_ACTION";
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
