-- A redemption whose outcome is unknown must not be recorded as a success.
--
-- Migration 0012 gave the issuance claim a lease, so a worker that dies between
-- the operator call and recording its outcome no longer wedges the redemption
-- forever. The round-two review measured what that recovery costs: the sweep
-- re-claims the redemption and asks the operator to grant the SAME reward a
-- second time. The only thing standing between that and a duplicate grant is the
-- operator honouring `Idempotency-Key: redemption:<id>`, and neither of this
-- repository's own simulated operators does. 0012's comment called a re-claim
-- safe; it is not, and that sentence is corrected there.
--
-- The duplicate grant cannot be removed from this side. What can be removed is
-- the silence: the row recorded `attempts = 0` after a recovery, because
-- `attempts` only advances on a FAILURE, so a redemption that may have been
-- granted twice was indistinguishable from one granted cleanly on the first
-- call. Nothing anywhere said a first grant had ever been requested.
--
-- So the claim becomes the record. `claimForIssuance` increments
-- `grant_requests` and stamps `grant_requested_at` in the transaction that
-- commits BEFORE the operator is called, which is what makes it survive the
-- process being killed during the call. `grant_requests > 1` on an `issued`
-- redemption means "the operator was asked more than once for this one reward,
-- reconcile it" — it is reported by `GET /v1/redemptions/:id` and logged when the
-- issuance completes. See TD-0011.
--
-- `attempts` is deliberately NOT re-pointed at this count: three MIO-010
-- statements are written against it meaning attempts that failed, and a second
-- column that means one thing is cheaper than one column that means two.
alter table rewards.redemption
  add column grant_requests integer not null default 0,
  add column grant_requested_at timestamptz;

-- Finding the redemptions a human has to reconcile with an operator is a report
-- someone runs under pressure, so it gets an index rather than a sequential scan:
-- every issued redemption the operator was asked for more than once.
create index redemption_reconcile_idx
  on rewards.redemption (tenant_id, grant_requested_at)
  where grant_requests > 1;
