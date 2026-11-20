import { randomUUID } from 'node:crypto';
import { GAMIFICATION_SPIN_COMPLETED } from '../../../contracts/events';
import type { Clock } from '../../../platform/clock/clock';
import { uniform01 } from '../../../platform/crypto/crypto';
import type { UnitOfWork } from '../../../platform/db/unit-of-work';
import { ConflictError } from '../../../platform/http/errors';
import type { EventBusPort } from '../../../platform/events/outbox';
import type { LedgerFacade } from '../../ledger';
import { weightedPick, type Prize, type WheelSlice } from '../domain/wheel';
import type { EntitlementRepositoryPort, SpinRepositoryPort, WheelRepositoryPort } from './ports';

export type SpinResult = {
  spinId: string;
  wheelId: string;
  wheelVersion: number;
  sliceId: string;
  prize: Prize;
  coinsCredited: number;
  balance: number;
  remainingSpins: number;
  fairness: { seed: string; seedHash: string; wheelVersion: number };
};

/**
 * One transaction: claim, draw, credit, record.
 *
 * The draw is `weightedPick(pinnedSlices, uniform01(serverSeed, spinId))` and
 * takes NO client input. The seed was generated and its hash published when the
 * entitlement was granted, so revealing the seed now lets the player recompute
 * the result and see that we did not choose it after the fact (ADR-0004).
 */
export class SpinUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly entitlements: EntitlementRepositoryPort,
    private readonly wheels: WheelRepositoryPort,
    private readonly spins: SpinRepositoryPort,
    private readonly ledger: LedgerFacade,
    private readonly bus: EventBusPort,
    private readonly clock: Clock,
  ) {}

  async execute(playerId: string): Promise<SpinResult> {
    return this.uow.withTransaction(async () => {
      const now = this.clock.now();
      const entitlement = await this.entitlements.claimOne(playerId, now);
      if (!entitlement) {
        throw new ConflictError(
          'spin.no-entitlement',
          'There is no unspent, unexpired spin for this player.',
        );
      }

      const version = await this.wheels.versionAt(entitlement.wheelId, entitlement.wheelVersion);
      if (!version) {
        // wheel_version is append-only, so this is corruption, not a case.
        throw new Error(
          `entitlement ${entitlement.id} pins ${entitlement.wheelId} v${entitlement.wheelVersion}, which is missing`,
        );
      }

      const spinId = randomUUID();
      const slice: WheelSlice = weightedPick(version.slices, uniform01(entitlement.serverSeed, spinId));

      const coins = slice.prize.kind === 'coins' ? slice.prize.amount : 0;
      let balance = await this.ledger.balanceOf(playerId);
      if (coins > 0) {
        await this.ledger.credit({
          playerId,
          coins,
          reason: `spin.prize:${slice.id}`,
          idempotencyKey: `spin:${spinId}`,
        });
        balance += coins;
      }

      await this.spins.record({
        id: spinId,
        playerId,
        entitlementId: entitlement.id,
        wheelId: entitlement.wheelId,
        wheelVersion: entitlement.wheelVersion,
        serverSeed: entitlement.serverSeed,
        seedHash: entitlement.seedHash,
        sliceId: slice.id,
        prize: slice.prize,
        coinsCredited: coins,
        spunAt: now,
      });

      // Published in the same transaction as the spin. No consumer exists in this
      // slice; a new game mode subscribes here rather than being wired into the
      // deposit path (Part E question 3).
      await this.bus.publish({
        name: GAMIFICATION_SPIN_COMPLETED,
        tenantId: entitlement.tenantId,
        aggregateType: 'spin',
        aggregateId: spinId,
        payload: {
          spinId,
          playerId,
          wheelId: entitlement.wheelId,
          wheelVersion: entitlement.wheelVersion,
          sliceId: slice.id,
          coinsCredited: coins,
          spunAt: now.toISOString(),
        },
      });

      return {
        spinId,
        wheelId: entitlement.wheelId,
        wheelVersion: entitlement.wheelVersion,
        sliceId: slice.id,
        prize: slice.prize,
        coinsCredited: coins,
        balance,
        remainingSpins: await this.entitlements.countClaimable(playerId, now),
        fairness: {
          seed: entitlement.serverSeed,
          seedHash: entitlement.seedHash,
          wheelVersion: entitlement.wheelVersion,
        },
      };
    });
  }
}
