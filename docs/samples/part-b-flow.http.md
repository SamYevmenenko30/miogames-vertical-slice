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
  "event_id": "a-845c6040-e12e-4368-93d8-e12a223b5966",
  "user_id": "player-casino-a",
  "amount": "50.00",
  "currency": "EUR",
  "occurred_at": "2026-11-20T15:08:58.724Z"
}
```

## casino-a — POST /v1/ingest (accepted)

```http
POST /v1/ingest/casino-a/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795187338
x-mio-signature: e017d1e4357036a11b8741d5bbb3a04ed176ffcc9331b476341e75267fdf7e13
x-mio-key-id: key-casino-a

{"event":"deposit.completed","event_id":"a-845c6040-e12e-4368-93d8-e12a223b5966","user_id":"player-casino-a","amount":"50.00","currency":"EUR","occurred_at":"2026-11-20T15:08:58.724Z"}
```

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8

{
  "status": "accepted",
  "eventId": "488c25cd-4ad3-4ccd-89cb-8ef02bc73f19"
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
  "token": "eyJ0IjoidGVuYW50LWEiLCJwIjoiMDU3M2Y5ZWMtMzg4Ny00NjJmLWJkN2ItZjQ1OTk3NTAwNzljIiwiZXhwIjoxNzk1MTkwOTM4fQ.f10db437f8913c6f198bf27238b521cb0abd5f004a6ea22594b5f052d8f84afa",
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
  "spinId": "8fa7ce9c-4cd8-4f20-bdb0-01b344c9e388",
  "wheelId": "welcome",
  "wheelVersion": 1,
  "sliceId": "coins-10",
  "prize": {
    "kind": "coins",
    "amount": 10
  },
  "coinsCredited": 10,
  "balance": 10,
  "remainingSpins": 1,
  "fairness": {
    "seed": "79fd3d2a57b25a2f59a07bd70b13e36768427bda615d8fc41288a631cc3c7a9c",
    "seedHash": "b90a06d26ecd360555404fabd8056d4d84901e3b5937921ceb1f0ea7aea44112",
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
  "redemptionId": "0390756e-c911-49da-b4ed-5890654fcbb1",
  "status": "pending_issuance",
  "itemId": "free-spins-50",
  "price": 100
}
```

## casino-a — GET /v1/redemptions/:id (issued)

```http
GET /v1/redemptions/0390756e-c911-49da-b4ed-5890654fcbb1 HTTP/1.1
authorization: [redacted]
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "redemptionId": "0390756e-c911-49da-b4ed-5890654fcbb1",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100,
  "reward": {
    "kind": "free_spins",
    "count": 50
  },
  "attempts": 0,
  "lastError": null,
  "externalRef": "A-a77ba833-3833-4f96-832e-dee8672811b8",
  "createdAt": "2026-11-20T15:08:59.240Z",
  "updatedAt": "2026-11-20T15:08:59.334Z"
}
```

## casino-a — POST /v1/ingest (duplicate)

```http
POST /v1/ingest/casino-a/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795187338
x-mio-signature: e017d1e4357036a11b8741d5bbb3a04ed176ffcc9331b476341e75267fdf7e13
x-mio-key-id: key-casino-a

{"event":"deposit.completed","event_id":"a-845c6040-e12e-4368-93d8-e12a223b5966","user_id":"player-casino-a","amount":"50.00","currency":"EUR","occurred_at":"2026-11-20T15:08:58.724Z"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "status": "duplicate",
  "eventId": "488c25cd-4ad3-4ccd-89cb-8ef02bc73f19"
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
  "redemptionId": "0390756e-c911-49da-b4ed-5890654fcbb1",
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
    "eventId": "b-93158ce0-f187-451b-a8df-12a887238a0b",
    "type": "PLAYER_DEPOSIT",
    "emittedAt": "2026-11-20T15:08:59.469Z"
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
x-mio-timestamp: 1795187339
x-mio-signature: b1eb3c9f5614fb85c19a53181b2556910441240665d56ffd70dcad8ff0691f73
x-mio-key-id: key-casino-b

{"meta":{"eventId":"b-93158ce0-f187-451b-a8df-12a887238a0b","type":"PLAYER_DEPOSIT","emittedAt":"2026-11-20T15:08:59.469Z"},"payload":{"playerRef":"player-casino-b","amountCents":5000,"ccy":"EUR"}}
```

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8

{
  "status": "accepted",
  "eventId": "d5773d5b-2401-4ed6-a0f3-0f6c1943470a"
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
  "token": "eyJ0IjoidGVuYW50LWIiLCJwIjoiODI1ZjYzNDMtNGUyMi00Y2Q0LWFjNWYtZTUxNjE2YjY4NjM0IiwiZXhwIjoxNzk1MTkwOTM5fQ.42735c6b97b0259595f17873724af1b71f1fa999d5986556aef0a2f900004879",
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
  "spinId": "939a98ad-fa86-4a6c-88d4-7417bd0a9992",
  "wheelId": "welcome",
  "wheelVersion": 1,
  "sliceId": "coins-10",
  "prize": {
    "kind": "coins",
    "amount": 10
  },
  "coinsCredited": 10,
  "balance": 10,
  "remainingSpins": 1,
  "fairness": {
    "seed": "a6359573e8cd459ed9a3a82348456bf04f311aa7fc4f5b095131614769e66c0e",
    "seedHash": "71c2524e19aa5091a41fce162174e3758a3e2532a6005e800f924defd2193f70",
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
  "redemptionId": "d2b4ac44-80ee-4272-90a4-a179f32a97ac",
  "status": "pending_issuance",
  "itemId": "free-spins-50",
  "price": 100
}
```

## casino-b — GET /v1/redemptions/:id (issued)

```http
GET /v1/redemptions/d2b4ac44-80ee-4272-90a4-a179f32a97ac HTTP/1.1
authorization: [redacted]
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "redemptionId": "d2b4ac44-80ee-4272-90a4-a179f32a97ac",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100,
  "reward": {
    "kind": "free_spins",
    "count": 50
  },
  "attempts": 0,
  "lastError": null,
  "externalRef": "B-1383e8af-a04f-4fb2-96c4-1f7914476b04",
  "createdAt": "2026-11-20T15:08:59.821Z",
  "updatedAt": "2026-11-20T15:08:59.891Z"
}
```

## casino-b — POST /v1/ingest (duplicate)

```http
POST /v1/ingest/casino-b/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795187339
x-mio-signature: b1eb3c9f5614fb85c19a53181b2556910441240665d56ffd70dcad8ff0691f73
x-mio-key-id: key-casino-b

{"meta":{"eventId":"b-93158ce0-f187-451b-a8df-12a887238a0b","type":"PLAYER_DEPOSIT","emittedAt":"2026-11-20T15:08:59.469Z"},"payload":{"playerRef":"player-casino-b","amountCents":5000,"ccy":"EUR"}}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "status": "duplicate",
  "eventId": "d5773d5b-2401-4ed6-a0f3-0f6c1943470a"
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
  "redemptionId": "d2b4ac44-80ee-4272-90a4-a179f32a97ac",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100
}
```
