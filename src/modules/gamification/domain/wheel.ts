/**
 * The wheel: a weighted table and a pure function over it.
 *
 * Weights are integers and relative — they need not sum to anything, because the
 * draw divides by their total. A table that must sum to 1.0 invites a float, and
 * a float in a probability table is a bug waiting for a regulator.
 */
export type Prize =
  | { kind: 'coins'; amount: number }
  | { kind: 'free_spins'; count: number }
  | { kind: 'bonus_cash'; amountMinor: number; currency: string }
  | { kind: 'nothing' };

export type WheelSlice = {
  id: string;
  weight: number;
  prize: Prize;
};

const PRIZE_KINDS = new Set(['coins', 'free_spins', 'bonus_cash', 'nothing']);
const CURRENCIES = new Set(['EUR', 'USD', 'GBP']);

export function validateSlices(slices: unknown): WheelSlice[] {
  if (!Array.isArray(slices)) throw new Error('slices must be an array');
  if (slices.length < 2) throw new Error('a wheel needs at least two slices');

  const seen = new Set<string>();
  for (const candidate of slices) {
    if (typeof candidate !== 'object' || candidate === null) throw new Error('each slice must be an object');
    const slice = candidate as Partial<WheelSlice>;
    if (typeof slice.id !== 'string' || slice.id.trim() === '') throw new Error('each slice needs a non-empty id');
    if (seen.has(slice.id)) throw new Error(`duplicate slice id ${slice.id}`);
    seen.add(slice.id);

    if (typeof slice.weight !== 'number') throw new Error(`slice ${slice.id}: weight must be a number`);
    if (!Number.isInteger(slice.weight)) throw new Error(`slice ${slice.id}: weight must be an integer`);
    if (slice.weight <= 0) throw new Error(`slice ${slice.id}: weight must be greater than zero`);

    validatePrize(slice.id, slice.prize);
  }
  return slices as WheelSlice[];
}

function validatePrize(sliceId: string, prize: unknown): void {
  if (typeof prize !== 'object' || prize === null) throw new Error(`slice ${sliceId}: prize must be an object`);
  const kind = (prize as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !PRIZE_KINDS.has(kind)) {
    // Refused at configuration time, not discovered at spin time.
    throw new Error(`slice ${sliceId}: unknown prize kind ${String(kind)}; expected one of ${[...PRIZE_KINDS].join(', ')}`);
  }
  if (kind === 'coins') {
    const amount = (prize as { amount?: unknown }).amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      throw new Error(`slice ${sliceId}: a coins prize needs a positive integer amount`);
    }
  }
  if (kind === 'free_spins') {
    const count = (prize as { count?: unknown }).count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
      throw new Error(`slice ${sliceId}: a free_spins prize needs a positive integer count`);
    }
  }
  if (kind === 'bonus_cash') {
    const { amountMinor, currency } = prize as { amountMinor?: unknown; currency?: unknown };
    if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new Error(`slice ${sliceId}: a bonus_cash prize needs a positive integer amountMinor`);
    }
    if (typeof currency !== 'string' || !CURRENCIES.has(currency)) {
      throw new Error(`slice ${sliceId}: a bonus_cash prize needs a supported currency`);
    }
  }
}

export function totalWeight(slices: WheelSlice[]): number {
  return slices.reduce((sum, slice) => sum + slice.weight, 0);
}

/**
 * Pick the slice whose cumulative weight interval contains `uniform * total`.
 *
 * A value outside [0, 1) is a programming error and throws: clamping it would
 * silently bias the first or last slice, which is the kind of bug that only
 * shows up in a regulator's audit.
 */
export function weightedPick(slices: WheelSlice[], uniform: number): WheelSlice {
  if (!(uniform >= 0 && uniform < 1)) {
    throw new Error(`the uniform value must be in [0, 1), got ${uniform}`);
  }
  const total = totalWeight(slices);
  const target = uniform * total;
  let cumulative = 0;
  for (const slice of slices) {
    cumulative += slice.weight;
    if (target < cumulative) return slice;
  }
  // Unreachable while total > 0 and uniform < 1; the last slice is the honest
  // answer if floating point ever lands exactly on the boundary.
  return slices[slices.length - 1]!;
}
