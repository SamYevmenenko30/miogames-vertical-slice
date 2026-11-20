export { IntegrationFacade } from './application/integration.facade';
export { DialectRegistry } from './application/dialect-registry';
export {
  CASINO_REWARD_ADAPTERS,
  INBOUND_DIALECTS,
  type CasinoRewardPort,
  type InboundDialect,
  type IssuanceResult,
  type RewardIntent,
} from './application/ports';
export type { CanonicalDeposit, TranslationResult } from './domain/canonical-deposit';
export { Money, type MoneyShape } from './domain/money';
