import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { scopedWhere } from '../../../../platform/db/scoped';
import { currentTenantId } from '../../../../platform/db/tenant-context';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { PlayerRepositoryPort } from '../../application/ports';
import type { ExternalPlayerId, Player, PlayerId } from '../../domain/player';
import { player, playerIdentity } from './identity.schema';

export class PlayerRepository implements PlayerRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  async findByExternalId(externalPlayerId: ExternalPlayerId): Promise<Player | null> {
    const rows = await this.uow.tx
      .select({ playerId: playerIdentity.playerId })
      .from(playerIdentity)
      .where(scopedWhere(playerIdentity, eq(playerIdentity.externalPlayerId, externalPlayerId)))
      .limit(1);
    const row = rows[0];
    return row ? { id: row.playerId, tenantId: currentTenantId() } : null;
  }

  async externalIdOf(playerId: PlayerId): Promise<ExternalPlayerId | null> {
    const rows = await this.uow.tx
      .select({ externalPlayerId: playerIdentity.externalPlayerId })
      .from(playerIdentity)
      .where(scopedWhere(playerIdentity, eq(playerIdentity.playerId, playerId)))
      .limit(1);
    return rows[0]?.externalPlayerId ?? null;
  }

  async findById(playerId: PlayerId): Promise<Player | null> {
    const rows = await this.uow.tx
      .select()
      .from(player)
      .where(scopedWhere(player, eq(player.id, playerId)))
      .limit(1);
    const row = rows[0];
    return row ? { id: row.id, tenantId: row.tenantId } : null;
  }

  /**
   * Create the player and its identity row.
   *
   * The identity insert is the one that can lose a race, so it decides: if the
   * unique constraint rejects ours, the winner's player id comes back from the
   * `DO UPDATE ... RETURNING` and the player row we optimistically created is
   * removed again. Both happen inside the caller's transaction, so there is no
   * window in which an orphan player exists for anyone else to see — and no
   * check-then-act for two concurrent first-sights to slip through.
   */
  async create(externalPlayerId: ExternalPlayerId): Promise<Player> {
    const tenantId = currentTenantId();
    const candidateId = randomUUID();

    await this.uow.tx.insert(player).values({ id: candidateId, tenantId });

    const [link] = await this.uow.tx
      .insert(playerIdentity)
      .values({ tenantId, externalPlayerId, playerId: candidateId })
      .onConflictDoUpdate({
        target: [playerIdentity.tenantId, playerIdentity.externalPlayerId],
        // A no-op update, there only so the existing row comes back in RETURNING.
        set: { externalPlayerId },
      })
      .returning({ playerId: playerIdentity.playerId });

    const winner = link!.playerId;
    if (winner !== candidateId) {
      await this.uow.tx.delete(player).where(eq(player.id, candidateId));
    }
    return { id: winner, tenantId };
  }
}
