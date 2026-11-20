import type { TranslationResult } from '../domain/canonical-deposit';
import type { DialectRegistry } from './dialect-registry';
import type { CasinoRewardPort, IssuanceResult, RewardIntent } from './ports';

/**
 * The integration layer's public surface: translate an operator's event inbound,
 * and issue a reward outbound. No other module knows an operator dialect exists.
 */
export class IntegrationFacade {
  constructor(
    private readonly dialects: DialectRegistry,
    private readonly rewardAdapters: CasinoRewardPort[] = [],
  ) {}

  translateDeposit(operator: string, raw: unknown): TranslationResult {
    return this.dialects.forOperator(operator).translateDeposit(raw);
  }

  supportedOperators(): string[] {
    return this.dialects.operators();
  }

  async issueReward(operator: string, intent: RewardIntent): Promise<IssuanceResult> {
    const adapter = this.rewardAdapters.find((candidate) => candidate.operator === operator);
    if (!adapter) {
      return { outcome: 'terminal', reason: `no reward adapter is registered for operator ${operator}` };
    }
    return adapter.issue(intent);
  }
}
