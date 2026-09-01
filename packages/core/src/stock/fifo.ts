import { BusinessRuleError } from "../errors/domain-error";

/**
 * FIFO picking (brief section 5).
 *
 * Which lots an exit consumes is a logistics rule, not a database detail: the
 * oldest stock leaves first so that packaging and labelling do not age on a
 * shelf. Expressing it as a pure function over lots means it can be tested
 * without Postgres and reused by the preparation screen at LTN4, which proposes
 * the same picking order to the operator.
 */

export interface FifoLot {
  readonly id: string;
  readonly quantity: number;
  /** Entry date. Ties are broken on `id` so the order is deterministic. */
  readonly fifoDate: Date;
}

export interface FifoAllocation {
  readonly lotId: string;
  /** Units taken from this lot. Always positive. */
  readonly quantity: number;
  /** What is left in the lot afterwards. */
  readonly remaining: number;
}

/** Oldest first; identical dates fall back to the id so two runs agree. */
function byFifo(left: FifoLot, right: FifoLot): number {
  const byDate = left.fifoDate.getTime() - right.fifoDate.getTime();
  return byDate === 0 ? left.id.localeCompare(right.id) : byDate;
}

export function totalAvailable(lots: readonly FifoLot[]): number {
  return lots.reduce((sum, lot) => sum + lot.quantity, 0);
}

/**
 * How to draw `quantity` units out of `lots`, oldest first.
 *
 * Throws rather than allocating what it can: a partial pick that the caller
 * silently accepts is how a stock level and a shelf stop agreeing. The caller
 * that genuinely wants a partial pick — LTN4 declaring a shortage — asks for
 * the quantity it can actually supply.
 */
export function allocateFifo(lots: readonly FifoLot[], quantity: number): readonly FifoAllocation[] {
  if (quantity <= 0) return [];

  const available = totalAvailable(lots);
  if (available < quantity) {
    throw new BusinessRuleError(
      `Stock insuffisant : ${String(quantity)} unites demandees, ${String(available)} disponibles.`,
      { requested: quantity, available },
    );
  }

  const allocations: FifoAllocation[] = [];
  let outstanding = quantity;

  for (const lot of [...lots].sort(byFifo)) {
    if (outstanding === 0) break;
    if (lot.quantity <= 0) continue;

    const taken = Math.min(lot.quantity, outstanding);
    allocations.push({ lotId: lot.id, quantity: taken, remaining: lot.quantity - taken });
    outstanding -= taken;
  }

  return allocations;
}
