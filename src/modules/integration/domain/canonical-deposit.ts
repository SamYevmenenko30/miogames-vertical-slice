import type { MoneyShape } from './money';

/** What every operator dialect translates into, and all the core ever sees. */
export type CanonicalDeposit = {
  operator: string;
  operatorEventId: string;
  externalPlayerId: string;
  amount: MoneyShape;
  occurredAt: string;
};

/**
 * Three outcomes, not two.
 *
 * `unsupported` is an event we understand and do not act on (a withdrawal): the
 * caller may acknowledge and forget it. `invalid` is an event we cannot trust:
 * the caller must refuse it loudly. Collapsing the two would make a broken
 * deposit look like a withdrawal and disappear.
 */
export type TranslationResult =
  | { outcome: 'translated'; event: CanonicalDeposit }
  | { outcome: 'unsupported'; reason: string }
  | { outcome: 'invalid'; reason: string };
