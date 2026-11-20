# rewards

The bonus store and the redemption lifecycle: price an item, debit coins, ask the operator to
issue the reward, track the outcome, refund when issuance finally fails.

## Invariants this module enforces

- The debit, the redemption row and the outbox event are **one** transaction. The external call
  is never inside it — an HTTP call in a transaction holds a database connection open for as long
  as someone else's timeout.
- `UNIQUE (tenant_id, player_id, idempotency_key)`. The key is scoped to the player as well as
  the tenant, because one player's retry must never return another player's receipt.
- A redemption copies the item's price and reward payload at creation. Removing the item does not
  change a redemption in flight — the same reasoning as a spin pinning its wheel version.
- `pending_issuance → issuing` is a conditional UPDATE, so two workers cannot both start issuing
  the same reward.
- Leaving `issuing` without an external reference refunds the coins, keyed
  `redemption:<id>:refund`, so a worker that dies mid-refund retries into the same key instead of
  paying twice.
- `Idempotency-Key` is required, not optional. A redemption we cannot make safe to retry is one
  we should not accept.

## Traps

- The controller's constructor uses **value** imports for `RedeemUseCase` and `RewardsFacade`.
  `import type` erases the design-time metadata Nest resolves by, and the resulting error names
  no parameter — "the argument at index [1]" — which is easy to misread as a missing provider.
- `GET /v1/redemptions/:id` answers 404 for another player's or another tenant's id, never 403.
- Every outbound failure must be classified `retryable` or `terminal`. Defaulting to retry on a
  terminal failure burns the attempt budget against a request that can never succeed.
