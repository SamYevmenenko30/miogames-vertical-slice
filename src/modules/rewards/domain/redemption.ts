export type RedemptionStatus = 'pending_issuance' | 'issuing' | 'issued' | 'failed';

export type RewardPayload =
  | { kind: 'free_spins'; count: number }
  | { kind: 'bonus_cash'; amountMinor: number; currency: string };

export type StoreItem = {
  itemId: string;
  name: string;
  price: number;
  reward: RewardPayload;
};

export type Redemption = {
  id: string;
  tenantId: string;
  playerId: string;
  itemId: string;
  price: number;
  reward: RewardPayload;
  status: RedemptionStatus;
  /** Attempts that FAILED. A redemption issued on its first call reports 0. */
  attempts: number;
  lastError: string | null;
  externalRef: string | null;
  /**
   * How many times a worker has claimed this redemption in order to ask the
   * operator for the grant — recorded before the call, so an attempt lost to a
   * dying process still counts. More than one on an `issued` redemption means the
   * operator may have granted the reward more than once (TD-0011).
   */
  grantRequests: number;
  grantRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const CURRENCIES = new Set(['EUR', 'USD', 'GBP']);

export function validateStoreItem(input: { name?: unknown; price?: unknown; reward?: unknown }): {
  name: string;
  price: number;
  reward: RewardPayload;
} {
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : '';
  if (!name) throw new Error('name is required');
  if (typeof input.price !== 'number' || !Number.isInteger(input.price) || input.price <= 0) {
    throw new Error('price must be a positive integer number of coins');
  }
  const reward = input.reward as Partial<RewardPayload> | undefined;
  if (!reward || typeof reward !== 'object') throw new Error('reward is required');
  if (reward.kind === 'free_spins') {
    const count = (reward as { count?: unknown }).count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
      throw new Error('a free_spins reward needs a positive integer count');
    }
    return { name, price: input.price, reward: { kind: 'free_spins', count } };
  }
  if (reward.kind === 'bonus_cash') {
    const { amountMinor, currency } = reward as { amountMinor?: unknown; currency?: unknown };
    if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new Error('a bonus_cash reward needs a positive integer amountMinor');
    }
    if (typeof currency !== 'string' || !CURRENCIES.has(currency)) {
      throw new Error('a bonus_cash reward needs a supported currency');
    }
    return { name, price: input.price, reward: { kind: 'bonus_cash', amountMinor, currency } };
  }
  throw new Error(`unknown reward kind ${String((reward as { kind?: unknown }).kind)}`);
}
