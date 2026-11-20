-- A redemption that reaches `issuing` must be able to come back.
--
-- `claimForIssuance` moved `pending_issuance → issuing` and the retry sweep only
-- ever looked for `pending_issuance`, so a worker that died between the operator
-- call and recording its outcome left the redemption in `issuing` for good: the
-- coins were debited, no reward was issued, and nothing retried or refunded it.
-- Found by review; `rewards/AGENTS.md` had claimed the opposite.
--
-- The fix is the same shape the outbox already uses for the same problem: the
-- claim takes a LEASE, and a claim that goes stale is re-claimable. Re-attempting
-- is safe because the operator call carries `redemption:<id>` as its idempotency
-- key, so an operator that already granted the reward returns the same reference
-- rather than granting a second one.
alter table rewards.redemption
  add column claimed_at timestamptz,
  add column claimed_by text;

-- Rows that were ALREADY wedged in `issuing` when this migration ran have
-- claimed_at NULL, and the sweep treats NULL as "stale" precisely so that they
-- heal on the next tick instead of needing a hand-written UPDATE.
create index redemption_stale_claim_idx
  on rewards.redemption (status, claimed_at)
  where status = 'issuing';
