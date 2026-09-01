import { InvalidInputError } from "../errors/domain-error";
import { assertNever } from "../shared/assert-never";
import type { MovementType } from "../shared/enums";

/**
 * What a movement does to a stock level.
 *
 * `StockMovement.quantity` is always positive and the type carries the meaning,
 * so the arithmetic has to live somewhere. Here rather than in the repository:
 * "a transfer in adds, an exit subtracts, an inventory count replaces" is a
 * statement about how the store works, and it is read by both the movement
 * entry screen and the consumption average.
 */

/** Only an outbound exit is consumption. */
const CONSUMPTION_TYPES: readonly MovementType[] = ["EXIT"];

/**
 * Whether the movement counts towards the rolling consumption average.
 *
 * A transfer out to another plant leaves the store but is not demand from the
 * production line, and an inventory correction is not demand at all. Counting
 * either would inflate every threshold derived from the average.
 */
export function isConsumption(type: MovementType): boolean {
  return CONSUMPTION_TYPES.includes(type);
}

export interface ApplyMovementInputs {
  readonly currentStock: number;
  readonly type: MovementType;
  /** Always positive. For an ADJUSTMENT this is the counted quantity. */
  readonly quantity: number;
}

/**
 * The stock level after the movement.
 *
 * ADJUSTMENT is a *replacement*, not a delta: an inventory count establishes
 * what is physically on the shelf, and recording the difference instead would
 * mean the journal never states the figure that was actually counted — which is
 * the one number a stock discrepancy investigation needs.
 */
export function applyMovement(inputs: ApplyMovementInputs): number {
  const { currentStock, type, quantity } = inputs;

  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new InvalidInputError("A movement quantity must be a whole, non-negative number.", {
      quantity,
    });
  }

  switch (type) {
    case "ENTRY":
    case "TRANSFER_IN":
      return currentStock + quantity;
    case "EXIT":
    case "TRANSFER_OUT":
      return currentStock - quantity;
    case "ADJUSTMENT":
      return quantity;
    default:
      return assertNever(type);
  }
}

/**
 * Whether the movement would take the stock below zero.
 *
 * Checked before the write rather than repaired after it: a negative stock
 * level is not a state the shop floor can be in, and clamping it to zero would
 * hide the discrepancy that caused it instead of surfacing it to a human.
 */
export function wouldGoNegative(inputs: ApplyMovementInputs): boolean {
  return applyMovement(inputs) < 0;
}
