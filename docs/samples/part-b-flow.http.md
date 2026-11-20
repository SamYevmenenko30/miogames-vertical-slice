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
  "event_id": "a-550a2295-636d-4027-b9fc-bcd934dafa4c",
  "user_id": "player-casino-a",
  "amount": "50.00",
  "currency": "EUR",
  "occurred_at": "2026-11-20T14:40:45.043Z"
}
```

## casino-a — POST /v1/ingest (accepted)

```http
POST /v1/ingest/casino-a/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795185645
x-mio-signature: e2435c69090fd03d64d04a389510564b074569ef647b4f96f72e0e80bfc4aaf5
x-mio-key-id: key-casino-a

{"event":"deposit.completed","event_id":"a-550a2295-636d-4027-b9fc-bcd934dafa4c","user_id":"player-casino-a","amount":"50.00","currency":"EUR","occurred_at":"2026-11-20T14:40:45.043Z"}
```

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8

{
  "status": "accepted",
  "eventId": "09a559ab-54ec-45bd-abba-85d5026f0d65"
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
  "token": "eyJ0IjoidGVuYW50LWEiLCJwIjoiMTdmYWQzNzYtZmI0YS00MDUyLWIzOWEtYWI3Nzc5YjhlNWU2IiwiZXhwIjoxNzk1MTg5MjQ1fQ.705b9f7cbcb42eee770d6f3d69f81bb5d8f8bf3397b70bf0b9bf4cf7e0cb3cd4",
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
  "spinId": "0c8d459a-ff70-4932-a55b-d3d259c6f14e",
  "wheelId": "welcome",
  "wheelVersion": 1,
  "sliceId": "coins-50",
  "prize": {
    "kind": "coins",
    "amount": 50
  },
  "coinsCredited": 50,
  "balance": 50,
  "remainingSpins": 1,
  "fairness": {
    "seed": "c0ba081b8aded76430aa333cff978da05facc19dae84a365913fea5609193090",
    "seedHash": "66ecc2a22e1b3badcaf663212f8893ab97543f190108e7e077116e277a1a96b5",
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
  "redemptionId": "10176e58-2066-4548-b639-79f9affb5ac0",
  "status": "pending_issuance",
  "itemId": "free-spins-50",
  "price": 100
}
```

## casino-a — GET /v1/redemptions/:id (issued)

```http
GET /v1/redemptions/10176e58-2066-4548-b639-79f9affb5ac0 HTTP/1.1
authorization: [redacted]
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "redemptionId": "10176e58-2066-4548-b639-79f9affb5ac0",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100,
  "reward": {
    "kind": "free_spins",
    "count": 50
  },
  "attempts": 0,
  "lastError": null,
  "externalRef": "A-14e6c56f-b99b-4d39-ace9-1d62df5de39d",
  "createdAt": "2026-11-20T14:40:45.663Z",
  "updatedAt": "2026-11-20T14:40:45.790Z"
}
```

## casino-a — POST /v1/ingest (duplicate)

```http
POST /v1/ingest/casino-a/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795185645
x-mio-signature: e2435c69090fd03d64d04a389510564b074569ef647b4f96f72e0e80bfc4aaf5
x-mio-key-id: key-casino-a

{"event":"deposit.completed","event_id":"a-550a2295-636d-4027-b9fc-bcd934dafa4c","user_id":"player-casino-a","amount":"50.00","currency":"EUR","occurred_at":"2026-11-20T14:40:45.043Z"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "status": "duplicate",
  "eventId": "09a559ab-54ec-45bd-abba-85d5026f0d65"
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
  "redemptionId": "10176e58-2066-4548-b639-79f9affb5ac0",
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
    "eventId": "b-b252e4f0-2a3e-4f84-b937-e3dfd94e3ca6",
    "type": "PLAYER_DEPOSIT",
    "emittedAt": "2026-11-20T14:40:45.993Z"
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
x-mio-timestamp: 1795185645
x-mio-signature: 10a006782905c260631397d114b8f091117d6b9e8199e6e2ce21a367f3c6124a
x-mio-key-id: key-casino-b

{"meta":{"eventId":"b-b252e4f0-2a3e-4f84-b937-e3dfd94e3ca6","type":"PLAYER_DEPOSIT","emittedAt":"2026-11-20T14:40:45.993Z"},"payload":{"playerRef":"player-casino-b","amountCents":5000,"ccy":"EUR"}}
```

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8

{
  "status": "accepted",
  "eventId": "b6a6903a-638f-4002-aeab-f5a7808c9dc9"
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
  "token": "eyJ0IjoidGVuYW50LWIiLCJwIjoiNDJlZTE3MWYtYjIwOS00NTVmLWE1ZWEtMjdlNmEwMWYwNmViIiwiZXhwIjoxNzk1MTg5MjQ2fQ.da7340dc09803f05d5ed135cf875a2a16443a80d15edd5e05c0716ee2ed9aeed",
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
  "spinId": "47791a14-0160-4b9c-870c-0d099b7d1a27",
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
    "seed": "1e8a5fdbc7a3c09f25da2ee68d8864d2f8a56daae4f192fb4f7adf1839b38028",
    "seedHash": "3e75db613773c11a3c91550a686c14c2442b8f19106e8db4b7dd80d831eaa6da",
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
  "redemptionId": "f00a79c2-5a18-4fe0-b6a6-209cfc840f49",
  "status": "pending_issuance",
  "itemId": "free-spins-50",
  "price": 100
}
```

## casino-b — GET /v1/redemptions/:id (issued)

```http
GET /v1/redemptions/f00a79c2-5a18-4fe0-b6a6-209cfc840f49 HTTP/1.1
authorization: [redacted]
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "redemptionId": "f00a79c2-5a18-4fe0-b6a6-209cfc840f49",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100,
  "reward": {
    "kind": "free_spins",
    "count": 50
  },
  "attempts": 0,
  "lastError": null,
  "externalRef": "B-52cfbd8d-2bc7-4561-9253-d617d504b2e8",
  "createdAt": "2026-11-20T14:40:46.396Z",
  "updatedAt": "2026-11-20T14:40:46.481Z"
}
```

## casino-b — POST /v1/ingest (duplicate)

```http
POST /v1/ingest/casino-b/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795185645
x-mio-signature: 10a006782905c260631397d114b8f091117d6b9e8199e6e2ce21a367f3c6124a
x-mio-key-id: key-casino-b

{"meta":{"eventId":"b-b252e4f0-2a3e-4f84-b937-e3dfd94e3ca6","type":"PLAYER_DEPOSIT","emittedAt":"2026-11-20T14:40:45.993Z"},"payload":{"playerRef":"player-casino-b","amountCents":5000,"ccy":"EUR"}}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "status": "duplicate",
  "eventId": "b6a6903a-638f-4002-aeab-f5a7808c9dc9"
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
  "redemptionId": "f00a79c2-5a18-4fe0-b6a6-209cfc840f49",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100
}
```
