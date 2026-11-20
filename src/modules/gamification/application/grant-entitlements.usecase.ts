import { randomUUID } from 'node:crypto';
import type { Clock } from '../../../platform/clock/clock';
import { randomSeedHex, sha256Hex } from '../../../platform/crypto/crypto';
import type { UnitOfWork } from '../../../platform/db/unit-of-work';
import type { IdentityFacade } from '../../identity';
import { expiryFrom } from '../domain/entitlement';
import { selectRule } from '../domain/reward-rule';
import type { EntitlementRepositoryPort, RewardRuleRepositoryPort, WheelRepositoryPort } from './ports';

export type GrantInput = {
  externalPlayerId: string;
  amount: { amountMinor: number; currency: string };
  sourceEventId: string;
};

/**
 * A deposit becomes entitlements, or it becomes nothing. Either way the event is
 * processed exactly once (the consumer's claim and this work share one
 * transaction).
 */
export class GrantEntitlementsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly identity: IdentityFacade,
    private readonly rules: RewardRuleRepositoryPort,
    private readonly wheels: WheelRepositoryPort,
    private readonly entitlements: EntitlementRepositoryPort,
    private readonly clock: Clock,
  ) {}

  async execute(input: GrantInput): Promise<{ granted: number; ruleId: string | null }> {
    const rules = await this.rules.activeRules();
    const rule = selectRule(rules, input.amount);
    if (!rule) return { granted: 0, ruleId: null };

    // The player is provisioned HERE, not at ingestion: a player row should
    // appear when something is granted to it, not when a payload is parsed.
    const playerId = await this.identity.ensurePlayer(input.externalPlayerId);

    const wheel = await this.wheels.liveVersion(rule.wheelId);
    if (!wheel) {
      // Loud on purpose (MIO-005 Q1): the outbox retries and records the error,
      // rather than granting a spin with no odds behind it.
      throw new Error(
        `reward rule ${rule.id} names wheel ${rule.wheelId}, which has no configured version`,
      );
    }

    const grantedAt = this.clock.now();
    const expiresAt = expiryFrom(grantedAt, rule.ttlHours);
    const batch = Array.from({ length: rule.spins }, () => {
      const serverSeed = randomSeedHex();
      return {
        id: randomUUID(),
        playerId,
        wheelId: wheel.wheelId,
        wheelVersion: wheel.version,
        ruleId: rule.id,
        serverSeed,
        seedHash: sha256Hex(serverSeed),
        sourceEventId: input.sourceEventId,
        grantedAt,
        expiresAt,
      };
    });

    await this.entitlements.grant(batch);
    return { granted: batch.length, ruleId: rule.id };
  }
}
