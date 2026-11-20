# rewards

The bonus store and the redemption lifecycle: price an item, debit coins, ask the operator to
issue the reward, track the outcome, refund when issuance finally fails.

## Invariants this module enforces

- The debit, the redemption row and the outbox event are **one** transaction, and the external
  call is never part of it. Redeeming does not call an operator, and neither does the outbox
  consumer: it marks the redemption due and stops. `IssueRewardUseCase.execute` — the only thing
  that talks to an operator — has exactly one caller, the sweep, which invokes it with nothing
  open. That split exists because `UnitOfWork` is re-entrant: when the consumer issued inline,
  every `withTransaction` inside the use case joined the consumer's transaction and a pooled
  connection was held for the length of the operator's timeout. S13 asserts it, by observing
  `inTransaction()` at the moment of the call.
- `UNIQUE (tenant_id, player_id, idempotency_key)`. The key is scoped to the player as well as
  the tenant, because one player's retry must never return another player's receipt.
- A redemption copies the item's price and reward payload at creation. Removing the item does not
  change a redemption in flight — the same reasoning as a spin pinning its wheel version.
- `pending_issuance → issuing` is a conditional UPDATE, so two workers cannot both start issuing
  the same reward. `issuance.integration.spec.ts` S10 proves it by COUNTING the operator's calls,
  because "one operator call" cannot be checked by reading the final status.
- **The claim carries a LEASE** (`claimed_at` / `claimed_by`, migration 0012). A redemption left
  in `issuing` by a worker that died is re-claimed by the sweep once the lease expires, and a NULL
  `claimed_at` counts as stale. Without this the redemption wedged for good: coins debited, no
  reward, no refund, and nothing looking for it — the sweep only ever read `pending_issuance`.
  Re-attempting is safe because the operator call carries `redemption:<id>` as its idempotency key.
- The refund happens when issuance FAILS — out of attempts, or a terminal failure — keyed
  `redemption:<id>:refund`, so a worker that dies mid-refund retries into the same key instead of
  paying twice. It is not what recovers a crashed issuance; the lease above is. (This file used to
  say that merely "leaving `issuing` without an external reference refunds the coins", which no
  code did.)
- `Idempotency-Key` is required, not optional. A redemption we cannot make safe to retry is one
  we should not accept.

## Traps

- The controller's constructor uses **value** imports for `RedeemUseCase` and `RewardsFacade`.
  `import type` erases the design-time metadata Nest resolves by, and the resulting error names
  no parameter — "the argument at index [1]" — which is easy to misread as a missing provider.
- `GET /v1/redemptions/:id` answers 404 for another player's or another tenant's id, never 403.
- Every outbound failure must be classified `retryable` or `terminal`. Defaulting to retry on a
  terminal failure burns the attempt budget against a request that can never succeed.
