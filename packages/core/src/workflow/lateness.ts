import { isTerminalStatus, type RequestStatus } from "./request-status";

/**
 * Lateness of a request (brief section 5, "Late").
 *
 * Modelled as a derived indicator rather than a status — see the note at the
 * top of `request-status.ts`. Keeping it derived means it is always correct
 * without a background job having to sweep and re-stamp rows, and a request
 * that becomes late does not lose the record of where it actually is.
 */
export interface LatenessInputs {
  readonly status: RequestStatus;
  /** Date LTN4's delivery was expected. `null` when none was committed. */
  readonly expectedDeliveryAt: Date | null;
  /** When the material was actually received, if it has been. */
  readonly receivedAt: Date | null;
  /** Evaluation date, passed in so the calculation stays deterministic. */
  readonly now: Date;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface Lateness {
  readonly isLate: boolean;
  /** Whole days past the commitment; 0 when not late. */
  readonly daysLate: number;
}

export function assessLateness(inputs: LatenessInputs): Lateness {
  const { status, expectedDeliveryAt, receivedAt, now } = inputs;

  if (expectedDeliveryAt === null) return { isLate: false, daysLate: 0 };

  // A cancelled or rejected request was never going to be delivered, and a
  // closed one is settled: neither is meaningfully "late".
  if (isTerminalStatus(status)) return { isLate: false, daysLate: 0 };

  // Once the goods are in, lateness is measured against the actual arrival
  // rather than continuing to grow with the clock.
  const reference = receivedAt ?? now;
  if (reference <= expectedDeliveryAt) return { isLate: false, daysLate: 0 };

  const daysLate = Math.floor(
    (reference.getTime() - expectedDeliveryAt.getTime()) / MILLISECONDS_PER_DAY,
  );

  return { isLate: true, daysLate: Math.max(1, daysLate) };
}
