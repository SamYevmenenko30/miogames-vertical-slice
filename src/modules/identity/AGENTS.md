# identity

Who is calling, and whose player this is. Tenants, their API credentials, players, and the
mapping between an operator's player id and ours.

## Invariants this module enforces

- `(tenant_id, external_player_id)` is unique. One operator player maps to exactly one of ours,
  and that constraint — not a prior read — is what settles two concurrent first-sights.
- A player row is created only by `ensurePlayer`, which is only ever reached from an
  authenticated operator event. There is no path from a client-supplied identifier to a new row.
- `authenticate` returns `null` identically for a wrong secret, an unknown key id and a
  deactivated key. Distinguishing them would make the endpoint a key-id oracle.
- The secret is never stored: `tenant_api_key.secret_digest` holds SHA-256 of it.
- Player tokens are signed with the **platform** secret, and the tenant id is inside the signed
  payload. Rotating an operator's API credentials does not log its players out, and a stolen key
  cannot mint tokens for another tenant.

## Traps

- `TenantRepository` is deliberately **not** tenant-scoped: resolving "which tenant is this key"
  is the step that establishes the tenant. Everything else in this module is scoped, and
  `PlayerRepository` builds every predicate with `scopedWhere`.
- `create()` inserts the player optimistically and deletes it again if the identity insert loses
  the race. That is correct only because both happen in the caller's transaction — do not move
  either half out of it.
- A player id is a UUID generated in the application, not by the database, because the identity
  insert needs it before the row exists.
