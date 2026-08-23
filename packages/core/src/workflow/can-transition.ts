import type { Role } from "../access/role";
import { TransitionNotAllowedError } from "../errors/domain-error";
import type { RequestStatus } from "./request-status";
import { type TransitionDefinition, TRANSITIONS } from "./transitions";

/** Every transition defined from `status`, regardless of who may perform it. */
export function transitionsFrom(status: RequestStatus): readonly TransitionDefinition[] {
  return TRANSITIONS[status];
}

/**
 * Transitions `role` may actually perform from `status`.
 *
 * This is what the UI calls to build the action bar, so a user is only ever
 * offered buttons the server would accept.
 */
export function availableTransitions(
  status: RequestStatus,
  role: Role,
): readonly TransitionDefinition[] {
  return TRANSITIONS[status].filter((transition) => transition.allowedRoles.includes(role));
}

export function findTransition(
  from: RequestStatus,
  to: RequestStatus,
): TransitionDefinition | undefined {
  return TRANSITIONS[from].find((transition) => transition.to === to);
}

export interface TransitionAttempt {
  readonly from: RequestStatus;
  readonly to: RequestStatus;
  readonly role: Role;
  /** Justification supplied by the actor, if any. */
  readonly reason?: string | undefined;
}

/**
 * Validates a state change and throws a precise error when it is refused.
 *
 * Called by the service layer inside the same transaction that writes the new
 * status and its history row, so an unauthorised transition can never be half
 * applied. The checks are ordered from most to least structural, because
 * "SHIPPED cannot become DRAFT" is a more useful message than "you lack the
 * permission to do a thing that is impossible anyway".
 */
export function assertTransition(attempt: TransitionAttempt): TransitionDefinition {
  const { from, to, role, reason } = attempt;

  const transition = findTransition(from, to);
  if (transition === undefined) {
    throw new TransitionNotAllowedError(`A request cannot move from ${from} to ${to}.`, {
      from,
      to,
      allowed: TRANSITIONS[from].map((candidate) => candidate.to),
    });
  }

  if (!transition.allowedRoles.includes(role)) {
    throw new TransitionNotAllowedError(
      `The role ${role} is not permitted to perform "${transition.action}".`,
      { from, to, role, allowedRoles: transition.allowedRoles },
    );
  }

  if (transition.requiresReason && (reason === undefined || reason.trim().length === 0)) {
    throw new TransitionNotAllowedError(
      `The transition "${transition.action}" requires a justification.`,
      { from, to, action: transition.action },
    );
  }

  return transition;
}

/** Non-throwing variant, for rendering decisions. */
export function canTransition(attempt: TransitionAttempt): boolean {
  try {
    assertTransition(attempt);
    return true;
  } catch {
    return false;
  }
}
