import type { CanonicalDeposit, TranslationResult } from '../domain/canonical-deposit';

/** One operator's inbound dialect. The only thing that varies per operator. */
export interface InboundDialect {
  readonly operator: string;
  /** Never throws: a payload that cannot be read comes back as `invalid`. */
  translateDeposit(raw: unknown): TranslationResult;
}

export const INBOUND_DIALECTS = Symbol('InboundDialects');

/** What a reward issuance looks like before an operator's dialect is applied. */
export type RewardIntent = {
  externalPlayerId: string;
  kind: 'free_spins' | 'bonus_cash';
  /** Free spins: a count. Bonus cash: minor units of the reward currency. */
  units: number;
  currency?: string;
  /** Carried to the operator so a retry is recognisable on their side too. */
  idempotencyKey: string;
};

export type IssuanceResult =
  | { outcome: 'issued'; reference: string }
  | { outcome: 'retryable'; reason: string }
  | { outcome: 'terminal'; reason: string };

/** Implemented per operator in adapters/out (MIO-010). */
export interface CasinoRewardPort {
  readonly operator: string;
  issue(intent: RewardIntent): Promise<IssuanceResult>;
}

export const CASINO_REWARD_ADAPTERS = Symbol('CasinoRewardAdapters');

export type { CanonicalDeposit, TranslationResult };
