# Sample requests and responses

> Captured by `pnpm smoke` from a real run — not written by hand. Secrets are redacted.

## casino-a — the operator emits a deposit event

```http
POST /casino-a/deposits HTTP/1.1
content-type: application/json

{"userId":"player-casino-a","amount":"50.00","currency":"EUR"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "event": "deposit.completed",
  "event_id": "a-59d60583-81ab-4dde-bb47-a2d1db5c9662",
  "user_id": "player-casino-a",
  "amount": "50.00",
  "currency": "EUR",
  "occurred_at": "2026-11-20T14:54:06.006Z"
}
```

## casino-a — POST /v1/ingest (accepted)

```http
POST /v1/ingest/casino-a/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795186446
x-mio-signature: bd05276cb495508208510908addcf4a62b950a1dc438813a45896360d656da27
x-mio-key-id: key-casino-a

{"event":"deposit.completed","event_id":"a-59d60583-81ab-4dde-bb47-a2d1db5c9662","user_id":"player-casino-a","amount":"50.00","currency":"EUR","occurred_at":"2026-11-20T14:54:06.006Z"}
```

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8

{
  "status": "accepted",
  "eventId": "356cc3df-8354-4750-9180-f656e8994a51"
}
```

## casino-a — POST /v1/sessions

```http
POST /v1/sessions HTTP/1.1
content-type: application/json
authorization: [redacted]

{"externalPlayerId":"player-casino-a"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "token": "eyJ0IjoidGVuYW50LWEiLCJwIjoiNzQ0ODhlNWQtZjEyMS00YTlkLTk1YTMtODQzNjM4NWNjNWJmIiwiZXhwIjoxNzk1MTkwMDQ2fQ.aad4e88aa2dcee17e4396971de051e2998584548e14bdedd67a79aa1c0d8e6e1",
  "expiresInSeconds": 3600
}
```

## casino-a — POST /v1/spins

```http
POST /v1/spins HTTP/1.1
content-type: application/json
authorization: [redacted]

{"clientSeed":"ignored-on-purpose"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "spinId": "b7fb4f82-e2e5-4a30-aabc-0eaf710b4abc",
  "wheelId": "welcome",
  "wheelVersion": 1,
  "sliceId": "free-spins-10",
  "prize": {
    "kind": "free_spins",
    "count": 10
  },
  "coinsCredited": 0,
  "balance": 0,
  "remainingSpins": 1,
  "fairness": {
    "seed": "0950279a402ad2c50576501c0ef4bebb0122b66c418378ed91c541a9032fc0c4",
    "seedHash": "9c2b654d79cc4af519080ef09cd8f3e298454f01df60b06545eaf3253ee516fa",
    "wheelVersion": 1
  }
}
```

## casino-a — GET /v1/store-items

```http
GET /v1/store-items HTTP/1.1
authorization: [redacted]
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "items": [
    {
      "itemId": "free-spins-50",
      "name": "50 free spins",
      "price": 100,
      "reward": {
        "kind": "free_spins",
        "count": 50
      }
    }
  ]
}
```

## casino-a — POST /v1/redemptions

```http
POST /v1/redemptions HTTP/1.1
content-type: application/json
authorization: [redacted]
idempotency-key: smoke-tenant-a-1

{"itemId":"free-spins-50"}
```

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8

{
  "redemptionId": "01194343-82a2-4dd3-9005-9b3c1811a480",
  "status": "pending_issuance",
  "itemId": "free-spins-50",
  "price": 100
}
```

## casino-a — GET /v1/redemptions/:id (issued)

```http
GET /v1/redemptions/01194343-82a2-4dd3-9005-9b3c1811a480 HTTP/1.1
authorization: [redacted]
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "redemptionId": "01194343-82a2-4dd3-9005-9b3c1811a480",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100,
  "reward": {
    "kind": "free_spins",
    "count": 50
  },
  "attempts": 0,
  "lastError": null,
  "externalRef": "A-a49b81c1-cbc9-4e08-871b-101d5c4a50b4",
  "createdAt": "2026-11-20T14:54:06.725Z",
  "updatedAt": "2026-11-20T14:54:06.870Z"
}
```

## casino-a — POST /v1/ingest (duplicate)

```http
POST /v1/ingest/casino-a/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795186446
x-mio-signature: bd05276cb495508208510908addcf4a62b950a1dc438813a45896360d656da27
x-mio-key-id: key-casino-a

{"event":"deposit.completed","event_id":"a-59d60583-81ab-4dde-bb47-a2d1db5c9662","user_id":"player-casino-a","amount":"50.00","currency":"EUR","occurred_at":"2026-11-20T14:54:06.006Z"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "status": "duplicate",
  "eventId": "356cc3df-8354-4750-9180-f656e8994a51"
}
```

## casino-a — POST /v1/redemptions (same Idempotency-Key)

```http
POST /v1/redemptions HTTP/1.1
content-type: application/json
authorization: [redacted]
idempotency-key: smoke-tenant-a-1

{"itemId":"free-spins-50"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "redemptionId": "01194343-82a2-4dd3-9005-9b3c1811a480",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100
}
```

## casino-b — the operator emits a deposit event

```http
POST /casino-b/deposits HTTP/1.1
content-type: application/json

{"playerRef":"player-casino-b","amountCents":5000,"ccy":"EUR"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "meta": {
    "eventId": "b-90505137-f396-4ef9-b003-e7e0db052784",
    "type": "PLAYER_DEPOSIT",
    "emittedAt": "2026-11-20T14:54:07.072Z"
  },
  "payload": {
    "playerRef": "player-casino-b",
    "amountCents": 5000,
    "ccy": "EUR"
  }
}
```

## casino-b — POST /v1/ingest (accepted)

```http
POST /v1/ingest/casino-b/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795186447
x-mio-signature: 75273a20b79540d48f69b7d2cfbb88aa457f9fff0c1287d2a26e29bb0641727b
x-mio-key-id: key-casino-b

{"meta":{"eventId":"b-90505137-f396-4ef9-b003-e7e0db052784","type":"PLAYER_DEPOSIT","emittedAt":"2026-11-20T14:54:07.072Z"},"payload":{"playerRef":"player-casino-b","amountCents":5000,"ccy":"EUR"}}
```

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8

{
  "status": "accepted",
  "eventId": "45f827f1-f314-4953-a746-afcd84eec4de"
}
```

## casino-b — POST /v1/sessions

```http
POST /v1/sessions HTTP/1.1
content-type: application/json
authorization: [redacted]

{"externalPlayerId":"player-casino-b"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "token": "eyJ0IjoidGVuYW50LWIiLCJwIjoiNDQxYTRmMDktNGJlYi00N2ZiLWE4NzctMWE3ODJjYmFkYWJiIiwiZXhwIjoxNzk1MTkwMDQ3fQ.f75cb25bf8f5715045edb839f7023e5953e35c16f7d9696046af48513692954e",
  "expiresInSeconds": 3600
}
```

## casino-b — POST /v1/spins

```http
POST /v1/spins HTTP/1.1
content-type: application/json
authorization: [redacted]

{"clientSeed":"ignored-on-purpose"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "spinId": "2c794dd5-36a1-43b6-a232-924eb35b13b4",
  "wheelId": "welcome",
  "wheelVersion": 1,
  "sliceId": "coins-200",
  "prize": {
    "kind": "coins",
    "amount": 200
  },
  "coinsCredited": 200,
  "balance": 200,
  "remainingSpins": 1,
  "fairness": {
    "seed": "e588011d8816a0fe5051e5b7e1422296806ea08c07ff5a2f7ab7bb49d4102c73",
    "seedHash": "d1d1f0ef433a32eed2c6a781e001f1961ea2cd7cf19f4e2c0c9d386582e4b4f3",
    "wheelVersion": 1
  }
}
```

## casino-b — GET /v1/store-items

```http
GET /v1/store-items HTTP/1.1
authorization: [redacted]
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "items": [
    {
      "itemId": "free-spins-50",
      "name": "50 free spins",
      "price": 100,
      "reward": {
        "kind": "free_spins",
        "count": 50
      }
    }
  ]
}
```

## casino-b — POST /v1/redemptions

```http
POST /v1/redemptions HTTP/1.1
content-type: application/json
authorization: [redacted]
idempotency-key: smoke-tenant-b-1

{"itemId":"free-spins-50"}
```

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8

{
  "redemptionId": "7dbf0e8e-8afb-4c79-96f3-7f43a7ec8364",
  "status": "pending_issuance",
  "itemId": "free-spins-50",
  "price": 100
}
```

## casino-b — GET /v1/redemptions/:id (issued)

```http
GET /v1/redemptions/7dbf0e8e-8afb-4c79-96f3-7f43a7ec8364 HTTP/1.1
authorization: [redacted]
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "redemptionId": "7dbf0e8e-8afb-4c79-96f3-7f43a7ec8364",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100,
  "reward": {
    "kind": "free_spins",
    "count": 50
  },
  "attempts": 0,
  "lastError": null,
  "externalRef": "B-55267252-00fb-47ec-9422-0ccbdd4a9113",
  "createdAt": "2026-11-20T14:54:07.426Z",
  "updatedAt": "2026-11-20T14:54:07.529Z"
}
```

## casino-b — POST /v1/ingest (duplicate)

```http
POST /v1/ingest/casino-b/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795186447
x-mio-signature: 75273a20b79540d48f69b7d2cfbb88aa457f9fff0c1287d2a26e29bb0641727b
x-mio-key-id: key-casino-b

{"meta":{"eventId":"b-90505137-f396-4ef9-b003-e7e0db052784","type":"PLAYER_DEPOSIT","emittedAt":"2026-11-20T14:54:07.072Z"},"payload":{"playerRef":"player-casino-b","amountCents":5000,"ccy":"EUR"}}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "status": "duplicate",
  "eventId": "45f827f1-f314-4953-a746-afcd84eec4de"
}
```

## casino-b — POST /v1/redemptions (same Idempotency-Key)

```http
POST /v1/redemptions HTTP/1.1
content-type: application/json
authorization: [redacted]
idempotency-key: smoke-tenant-b-1

{"itemId":"free-spins-50"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "redemptionId": "7dbf0e8e-8afb-4c79-96f3-7f43a7ec8364",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100
}
```
