import { describe, expect, it } from 'vitest';
import { selectRule, type RewardRule } from '../domain/reward-rule';

const rules: RewardRule[] = [
  { id: 'bronze', minDepositMinor: 2000, currency: 'EUR', wheelId: 'welcome', spins: 1, ttlHours: 168 },
  { id: 'gold', minDepositMinor: 10000, currency: 'EUR', wheelId: 'welcome', spins: 5, ttlHours: 168 },
  { id: 'usd', minDepositMinor: 2000, currency: 'USD', wheelId: 'welcome-usd', spins: 1, ttlHours: 168 },
];

describe('gamification — reward rules', () => {
  it('S1 — a deposit at the threshold matches', () => {
    expect(selectRule(rules, { amountMinor: 2000, currency: 'EUR' })?.id).toBe('bronze');
  });

  it('S1 — a deposit above the threshold matches', () => {
    expect(selectRule(rules, { amountMinor: 5000, currency: 'EUR' })?.id).toBe('bronze');
  });

  it('S4 — the highest matching tier wins, and only one rule applies', () => {
    const chosen = selectRule(rules, { amountMinor: 15000, currency: 'EUR' });
    expect(chosen?.id).toBe('gold');
    expect(chosen?.spins).toBe(5);
  });

  it('S3 — a deposit below every threshold matches nothing', () => {
    expect(selectRule(rules, { amountMinor: 1999, currency: 'EUR' })).toBeNull();
  });

  it('S8 — a rule only matches its own currency', () => {
    expect(selectRule(rules, { amountMinor: 15000, currency: 'USD' })?.id).toBe('usd');
    expect(selectRule(rules, { amountMinor: 15000, currency: 'GBP' })).toBeNull();
  });

  it('S4 — an empty rule set matches nothing', () => {
    expect(selectRule([], { amountMinor: 100000, currency: 'EUR' })).toBeNull();
  });

  it('S4 — two rules with the same threshold are resolved deterministically by id', () => {
    const tie: RewardRule[] = [
      { id: 'b', minDepositMinor: 2000, currency: 'EUR', wheelId: 'w', spins: 1, ttlHours: 1 },
      { id: 'a', minDepositMinor: 2000, currency: 'EUR', wheelId: 'w', spins: 9, ttlHours: 1 },
    ];
    expect(selectRule(tie, { amountMinor: 3000, currency: 'EUR' })?.id).toBe('a');
    expect(selectRule([...tie].reverse(), { amountMinor: 3000, currency: 'EUR' })?.id).toBe('a');
  });
});
