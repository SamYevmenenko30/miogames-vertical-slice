export type RewardRule = {
  id: string;
  minDepositMinor: number;
  currency: string;
  wheelId: string;
  spins: number;
  ttlHours: number;
};

export type DepositAmount = { amountMinor: number; currency: string };

/**
 * Tiered: the highest matching threshold wins and ONLY ONE rule applies
 * (decision by Sam, 2026-11-20).
 *
 * Proportional granting — one spin per €25 — was the alternative. It needs a
 * per-event cap and makes the cost of a promotion unpredictable, which is a
 * product property, not a code preference.
 *
 * A tie on the threshold is resolved by rule id so that the result does not
 * depend on the order rows came back in.
 */
export function selectRule(rules: RewardRule[], deposit: DepositAmount): RewardRule | null {
  const matching = rules.filter(
    (rule) => rule.currency === deposit.currency && deposit.amountMinor >= rule.minDepositMinor,
  );
  if (matching.length === 0) return null;
  return [...matching].sort(
    (a, b) => b.minDepositMinor - a.minDepositMinor || a.id.localeCompare(b.id),
  )[0]!;
}
