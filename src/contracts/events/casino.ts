import { z } from 'zod';

/** Money crosses every boundary as minor units plus a currency. Never a float. */
export const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/),
});

/**
 * The one canonical deposit event. Both operator dialects translate INTO this,
 * and the gamification rules engine sees nothing else (ADR-0002).
 */
export const CASINO_DEPOSIT_OBSERVED = 'casino.deposit.observed';

export const casinoDepositObservedSchema = z.object({
  operator: z.string().min(1),
  /** The operator's own event id — the deduplication key. Never synthesised. */
  operatorEventId: z.string().min(1),
  externalPlayerId: z.string().min(1),
  amount: moneySchema,
  /** The operator's claim about when it happened. We decide nothing from it. */
  occurredAt: z.string().datetime(),
});

export type CasinoDepositObserved = z.infer<typeof casinoDepositObservedSchema>;
export type MoneyShape = z.infer<typeof moneySchema>;
