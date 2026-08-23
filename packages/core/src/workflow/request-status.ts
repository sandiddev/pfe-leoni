/**
 * Replenishment request lifecycle (brief section 5).
 *
 * Nominal path:
 *   DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT_TO_LTN4 -> IN_PREPARATION
 *         -> READY -> SHIPPED -> IN_TRANSIT -> RECEIVED -> CLOSED
 *
 * Exception states: REJECTED, CANCELLED, PARTIALLY_AVAILABLE, LTN4_STOCK_OUT.
 *
 * STATED ASSUMPTION — "Late" is deliberately *not* a status.
 * The brief lists it among the exception states, but lateness is orthogonal to
 * workflow position: a request can be late while it is still in preparation, or
 * late while in transit. Encoding it as a status would overwrite the real state
 * and lose the information about where the request actually is. It is therefore
 * derived (`isLate`, from `expectedDeliveryAt` against the current date) and
 * displayed as an indicator alongside the status. See `lateness.ts`.
 */
export const REQUEST_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT_TO_LTN4",
  "IN_PREPARATION",
  "PARTIALLY_AVAILABLE",
  "LTN4_STOCK_OUT",
  "READY",
  "SHIPPED",
  "IN_TRANSIT",
  "RECEIVED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Statuses from which no further transition is possible. */
export const TERMINAL_STATUSES = ["CLOSED", "REJECTED", "CANCELLED"] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/** Statuses that represent a deviation from the nominal path. */
export const EXCEPTION_STATUSES = [
  "PARTIALLY_AVAILABLE",
  "LTN4_STOCK_OUT",
  "REJECTED",
  "CANCELLED",
] as const;

/** The happy path, in order — used to render the progress stepper. */
export const NOMINAL_STATUS_SEQUENCE = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT_TO_LTN4",
  "IN_PREPARATION",
  "READY",
  "SHIPPED",
  "IN_TRANSIT",
  "RECEIVED",
  "CLOSED",
] as const;

export function isRequestStatus(value: string): value is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: RequestStatus): boolean {
  return (TERMINAL_STATUSES as readonly RequestStatus[]).includes(status);
}

export function isExceptionStatus(status: RequestStatus): boolean {
  return (EXCEPTION_STATUSES as readonly RequestStatus[]).includes(status);
}

/**
 * Position on the nominal path, for the progress stepper.
 * Returns `null` for statuses that are off the happy path.
 */
export function nominalStepIndex(status: RequestStatus): number | null {
  const index = (NOMINAL_STATUS_SEQUENCE as readonly RequestStatus[]).indexOf(status);
  return index === -1 ? null : index;
}
