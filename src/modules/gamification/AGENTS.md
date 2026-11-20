# gamification

The rules engine and the wheel: a signal becomes spin entitlements, and a spin becomes a
deterministic, server-authoritative outcome.

## Invariants this module enforces

- A wheel configuration is **versioned and never updated in place**, enforced by an append-only
  trigger on `wheel_version`. A rollback is a new version carrying the old slices, so an
  entitlement pinned to a bad version still draws what it was promised.
- Weights are positive integers and relative; the draw divides by their total. Nothing here holds
  a probability as a float.
- A prize kind is a closed set, checked at configuration time. Discovering an unknown kind at
  spin time would mean failing a player's spin for an admin's typo.
- `weightedPick` throws on a uniform value outside `[0, 1)` rather than clamping: a clamp
  silently biases the first or last slice.
- Admin writes are audited in the same transaction as the change. A configuration change that is
  not audited did not happen.

## Traps

- Admin is an inbound **adapter** here, not a module. Do not create an `admin` module: it would
  need write access to every other module's tables.
- The next version number is computed inside the insert, and the primary key settles a race — two
  concurrent writers cannot both create version N.
- `read` answers 404 for another tenant's wheel id, never 403. A 403 confirms the id exists.
