import { and, eq, isNull, sql } from 'drizzle-orm';
import { scopedWhere } from '../../../../platform/db/scoped';
import { currentTenantId } from '../../../../platform/db/tenant-context';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { NewRedemption, RedemptionRepositoryPort } from '../../application/ports';
import type { Redemption, RedemptionStatus, RewardPayload } from '../../domain/redemption';
import { redemption } from './rewards.schema';

export class RedemptionRepository implements RedemptionRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  async create(input: NewRedemption): Promise<{ redemption: Redemption; claimed: boolean }> {
    const tenantId = currentTenantId();
    const inserted = await this.uow.tx
      .insert(redemption)
      .values({
        id: input.id,
        tenantId,
        playerId: input.playerId,
        itemId: input.itemId,
        price: input.price,
        reward: input.reward,
        idempotencyKey: input.idempotencyKey,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .onConflictDoNothing({ target: [redemption.tenantId, redemption.playerId, redemption.idempotencyKey] })
      .returning();

    if (inserted[0]) return { redemption: toRedemption(inserted[0]), claimed: true };

    const existing = await this.uow.tx
      .select()
      .from(redemption)
      .where(
        and(
          scopedWhere(redemption),
          eq(redemption.playerId, input.playerId),
          eq(redemption.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing[0]) throw new Error(`idempotency key ${input.idempotencyKey} conflicted but no redemption is visible`);
    return { redemption: toRedemption(existing[0]), claimed: false };
  }

  async findForPlayer(id: string, playerId: string): Promise<Redemption | null> {
    const rows = await this.uow.tx
      .select()
      .from(redemption)
      .where(and(scopedWhere(redemption), eq(redemption.id, id), eq(redemption.playerId, playerId)))
      .limit(1);
    return rows[0] ? toRedemption(rows[0]) : null;
  }

  async findById(id: string): Promise<Redemption | null> {
    const rows = await this.uow.tx
      .select()
      .from(redemption)
      .where(and(scopedWhere(redemption), eq(redemption.id, id)))
      .limit(1);
    return rows[0] ? toRedemption(rows[0]) : null;
  }

  /**
   * Move `pending_issuance` → `issuing` and stamp a LEASE on the row.
   *
   * A conditional UPDATE, so two workers cannot both start issuing the same
   * reward: the loser's predicate is re-evaluated after the row lock is granted
   * and no longer matches, so it gets nothing.
   *
   * It also claims an `issuing` row whose lease has gone stale. Without that, a
   * worker that died between the operator call and recording its outcome left the
   * redemption in `issuing` forever — coins debited, no reward, no refund, and
   * nothing looking for it (the sweep only ever read `pending_issuance`).
   * A NULL `claimed_at` counts as stale so that rows wedged before migration 0012
   * heal on the next tick.
   *
   * Staleness is measured on the DATABASE clock (`now()`), not the injected one,
   * for the same reason the outbox relay does it: deciding that another process
   * is dead needs the one clock every process shares. The retry SCHEDULE still
   * comes from the injected clock — see `dueForRetry`.
   *
   * The claim is also the RECORD that the operator is about to be asked:
   * `grant_requests` is incremented here, in the transaction that commits before
   * the call goes out, so an attempt lost to a dying process is still counted.
   * `claim` is unique per claim, not per process, and the three write-backs
   * require it — see `markIssued`.
   */
  async claimForIssuance(id: string, now: Date, claim: string, leaseMs: number): Promise<Redemption | null> {
    const tenantId = currentTenantId();
    const rows = await this.uow.tx.execute<RedemptionRow>(sql`
      update rewards.redemption
         set status = 'issuing',
             claimed_at = now(),
             claimed_by = ${claim},
             grant_requests = grant_requests + 1,
             grant_requested_at = now(),
             updated_at = ${now.toISOString()}::timestamptz
       where tenant_id = ${tenantId}
         and id = ${id}
         and (
           status = 'pending_issuance'
           or (
             status = 'issuing'
             and (claimed_at is null or claimed_at < now() - make_interval(secs => ${leaseMs / 1000}))
           )
         )
      returning id, tenant_id, player_id, item_id, price, reward, status, idempotency_key,
                attempts, last_error, external_ref, grant_requests, grant_requested_at,
                created_at, updated_at
    `);
    const row = rows[0];
    return row ? fromRow(row) : null;
  }

  /**
   * Make a freshly requested redemption due for the sweep. The outbox consumer
   * calls this instead of issuing inline, so the operator call never happens
   * inside the consumer's transaction (see IssueRewardUseCase).
   */
  async markDueForIssuance(id: string, now: Date): Promise<void> {
    await this.uow.tx
      .update(redemption)
      .set({ nextAttemptAt: now, updatedAt: now })
      .where(
        and(
          scopedWhere(redemption),
          eq(redemption.id, id),
          eq(redemption.status, 'pending_issuance'),
          // Only when it has no schedule yet: a redelivered event must not pull a
          // backoff the sweep has already set forward.
          isNull(redemption.nextAttemptAt),
        ),
      );
  }

  /**
   * The three write-backs below record the outcome of ONE claim, and each of them
   * requires that claim to still be held. They return whether they matched.
   *
   * `claimForIssuance` was always a careful conditional UPDATE and these were
   * keyed on `(tenant, id)` alone, which made the lease a guarantee about
   * STARTING and no guarantee at all about FINISHING — and the finish is where
   * the money moves. The round-two review measured both halves of the hole: a
   * worker whose lease expired while its operator call was in flight wrote its
   * failure back over a peer's success, so the reward was issued AND the coins
   * refunded; and the mirror case, a `scheduleRetry` resurrecting an already
   * issued redemption into `pending_issuance` for the sweep to grant again.
   *
   * `claim` must therefore be unique per CLAIM, not per process: one worker that
   * re-claims a redemption its own earlier attempt is still inside is exactly the
   * case that has to be refused, and two containers were measured sharing pid 25.
   */
  async markIssued(id: string, claim: string, externalRef: string, now: Date): Promise<boolean> {
    const rows = await this.uow.tx
      .update(redemption)
      .set({ status: 'issued', externalRef, lastError: null, nextAttemptAt: null, claimedAt: null, claimedBy: null, updatedAt: now })
      .where(this.stillClaimed(id, claim))
      .returning({ id: redemption.id });
    return rows.length === 1;
  }

  async scheduleRetry(id: string, claim: string, attempts: number, error: string, nextAttemptAt: Date, now: Date): Promise<boolean> {
    const rows = await this.uow.tx
      .update(redemption)
      .set({
        status: 'pending_issuance',
        attempts,
        lastError: error.slice(0, 2000),
        nextAttemptAt,
        claimedAt: null,
        claimedBy: null,
        updatedAt: now,
      })
      .where(this.stillClaimed(id, claim))
      .returning({ id: redemption.id });
    return rows.length === 1;
  }

  async markFailed(id: string, claim: string, attempts: number, error: string, now: Date): Promise<boolean> {
    const rows = await this.uow.tx
      .update(redemption)
      .set({ status: 'failed', attempts, lastError: error.slice(0, 2000), nextAttemptAt: null, claimedAt: null, claimedBy: null, updatedAt: now })
      .where(this.stillClaimed(id, claim))
      .returning({ id: redemption.id });
    return rows.length === 1;
  }

  /**
   * "This redemption, and I am still the one issuing it." Both halves matter:
   * `claimed_by` alone would match a row a peer has already moved to `issued` and
   * then re-claimed under the same name, and `status` alone is what the defect
   * above had.
   */
  private stillClaimed(id: string, claim: string) {
    return and(
      scopedWhere(redemption),
      eq(redemption.id, id),
      eq(redemption.status, 'issuing'),
      eq(redemption.claimedBy, claim),
    );
  }

  async statusOf(id: string): Promise<RedemptionStatus | null> {
    const rows = await this.uow.tx
      .select({ status: redemption.status })
      .from(redemption)
      .where(and(scopedWhere(redemption), eq(redemption.id, id)))
      .limit(1);
    return (rows[0]?.status as RedemptionStatus | undefined) ?? null;
  }

  /**
   * Work the sweep must pick up, across every tenant — this runs outside any
   * tenant scope and carries the tenant forward from each row.
   *
   * Two kinds, and they are measured on two different clocks on purpose:
   *
   *   - a RETRY that is due. Due-ness is measured against the same clock that
   *     scheduled it — the injected one. Mixing the two here made attempt counts
   *     depend on how far the database clock had drifted from the test's fixed
   *     one: two attempts inside one drain, non-deterministically.
   *   - an issuance whose LEASE has expired, i.e. the worker holding it is
   *     presumed dead. That is a statement about another process, so it is
   *     measured on the database clock, the only one every process shares — the
   *     same split the outbox relay makes.
   */
  async dueForRetry(now: Date, limit: number, leaseMs: number): Promise<Array<{ id: string; tenantId: string }>> {
    const rows = await this.uow.tx.execute<{ id: string; tenant_id: string }>(sql`
      select id, tenant_id from rewards.redemption
       where (
               status = 'pending_issuance'
               and next_attempt_at is not null
               and next_attempt_at <= ${now.toISOString()}::timestamptz
             )
          or (
               status = 'issuing'
               and (claimed_at is null or claimed_at < now() - make_interval(secs => ${leaseMs / 1000}))
             )
       order by next_attempt_at nulls first, claimed_at nulls first
       limit ${limit}
    `);
    return rows.map((row) => ({ id: row.id, tenantId: row.tenant_id }));
  }
}

type RedemptionRow = {
  id: string;
  tenant_id: string;
  player_id: string;
  item_id: string;
  price: number;
  reward: unknown;
  status: string;
  idempotency_key: string;
  attempts: number;
  last_error: string | null;
  external_ref: string | null;
  grant_requests: number;
  grant_requested_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** The same mapping as `toRedemption`, for the statements Drizzle does not express. */
function fromRow(row: RedemptionRow): Redemption {
  return toRedemption({
    id: row.id,
    tenantId: row.tenant_id,
    playerId: row.player_id,
    itemId: row.item_id,
    price: Number(row.price),
    reward: row.reward,
    status: row.status,
    attempts: Number(row.attempts),
    lastError: row.last_error,
    externalRef: row.external_ref,
    grantRequests: Number(row.grant_requests),
    grantRequestedAt: row.grant_requested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toRedemption(row: {
  id: string;
  tenantId: string;
  playerId: string;
  itemId: string;
  price: number;
  reward: unknown;
  status: string;
  attempts: number;
  lastError: string | null;
  externalRef: string | null;
  grantRequests: number;
  grantRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Redemption {
  return {
    id: row.id,
    tenantId: row.tenantId,
    playerId: row.playerId,
    itemId: row.itemId,
    price: Number(row.price),
    reward: row.reward as RewardPayload,
    status: row.status as RedemptionStatus,
    attempts: Number(row.attempts),
    lastError: row.lastError,
    externalRef: row.externalRef,
    grantRequests: Number(row.grantRequests),
    grantRequestedAt: row.grantRequestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
