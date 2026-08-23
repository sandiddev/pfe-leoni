import { InvalidInputError } from "../errors/domain-error";

/**
 * Recommended order quantity (brief section 3.3).
 *
 *     Need            = Max - Current Stock      (only if Current Stock <= Min)
 *     Number of boxes = ceil(Need / VPE)
 *     Recommended Qty = Number of boxes x VPE
 *
 * The rounding up to a whole number of boxes is not a cosmetic detail: LTN4
 * picks and ships full boxes (VPE / EUP is the standard pack size), so asking
 * for 1 800 units of an article packed 500 to a box is a request nobody can
 * fulfil exactly. Rounding *up* rather than down keeps the delivered quantity
 * at or above the need, which is the safe direction when the cost of being
 * wrong is a stopped production line.
 */
export interface OrderQuantityInputs {
  readonly currentStock: number;
  readonly min: number;
  readonly max: number;
  /** VPE / EUP: number of units per box. */
  readonly vpe: number;
}

export interface OrderQuantity {
  /** True when `currentStock <= min`, i.e. a replenishment is warranted. */
  readonly isReplenishmentNeeded: boolean;
  /** Raw shortfall to the target level, before packaging is considered. */
  readonly need: number;
  /** Whole boxes to request. */
  readonly boxCount: number;
  /** What the storekeeper should actually ask LTN4 for. */
  readonly recommendedQuantity: number;
}

/** Raw shortfall to the target level. Zero when stock is already at or above Max. */
export function computeNeed(inputs: Pick<OrderQuantityInputs, "currentStock" | "max">): number {
  return Math.max(0, inputs.max - inputs.currentStock);
}

/** Whole boxes needed to cover `need`, given a pack size of `vpe`. */
export function computeBoxCount(need: number, vpe: number): number {
  if (!Number.isFinite(vpe) || vpe <= 0) {
    throw new InvalidInputError(
      "VPE (units per box) must be greater than zero; an article cannot be packed zero to a box.",
      { vpe },
    );
  }
  if (need <= 0) return 0;
  return Math.ceil(need / vpe);
}

/**
 * Full computation, returning the intermediate values as well as the answer.
 *
 * The intermediates are part of the return type on purpose: the alert screen
 * has to *show* the storekeeper why 2 000 units are proposed ("besoin 1 800,
 * soit 4 boites de 500"), and recomputing that explanation in the UI would be a
 * second implementation of the same rule waiting to drift.
 */
export function computeOrderQuantity(inputs: OrderQuantityInputs): OrderQuantity {
  const { currentStock, min, max, vpe } = inputs;

  if (!Number.isFinite(currentStock) || !Number.isFinite(min) || !Number.isFinite(max)) {
    throw new InvalidInputError("Stock and thresholds must be finite numbers.", { ...inputs });
  }
  if (min > max) {
    throw new InvalidInputError("Min cannot exceed Max.", { min, max });
  }

  const isReplenishmentNeeded = currentStock <= min;

  // Above the trigger there is nothing to propose, even though `max - stock`
  // would still be positive. Proposing an order at every level below Max would
  // bury the real alerts in noise.
  if (!isReplenishmentNeeded) {
    return { isReplenishmentNeeded: false, need: 0, boxCount: 0, recommendedQuantity: 0 };
  }

  const need = computeNeed({ currentStock, max });
  const boxCount = computeBoxCount(need, vpe);

  return {
    isReplenishmentNeeded: true,
    need,
    boxCount,
    recommendedQuantity: boxCount * vpe,
  };
}
