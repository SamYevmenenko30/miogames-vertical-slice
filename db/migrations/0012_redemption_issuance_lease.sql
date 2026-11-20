-- A redemption that reaches `issuing` must be able to come back.
--
-- `claimForIssuance` moved `pending_issuance → issuing` and the retry sweep only
-- ever looked for `pending_issuance`, so a worker that died between the operator
-- call and recording its outcome left the redemption in `issuing` for good: the
-- coins were debited, no reward was issued, and nothing retried or refunded it.
-- Found by review; `rewards/AGENTS.md` had claimed the opposite.
--
-- The fix is the same shape the outbox already uses for the same problem: the
-- claim takes a LEASE, and a claim that goes stale is re-claimable.
--
-- This comment used to end "re-attempting is safe because the operator call
-- carries `redemption:<id>` as its idempotency key, so an operator that already
-- granted the reward returns the same reference rather than granting a second
-- one". That was a promise about somebody else's system, and the round-two review
-- measured it false inside this one: neither simulated operator keeps a key store,
-- so a re-claim grants twice. The claim is instead RECORDED before the operator is
-- asked — see migration 0013 and TD-0011 — so a recovery can be reconciled rather
-- than being mistaken for a clean first attempt.
alter table rewards.redemption
  add column claimed_at timestamptz,
  add column claimed_by text;

-- Rows that were ALREADY wedged in `issuing` when this migration ran have
-- claimed_at NULL, and the sweep treats NULL as "stale" precisely so that they
-- heal on the next tick instead of needing a hand-written UPDATE.
create index redemption_stale_claim_idx
  on rewards.redemption (status, claimed_at)
  where status = 'issuing';
