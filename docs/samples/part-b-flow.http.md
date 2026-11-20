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
  "event_id": "a-097b09c3-8cad-4c09-a9bb-2e0c7cd5e146",
  "user_id": "player-casino-a",
  "amount": "50.00",
  "currency": "EUR",
  "occurred_at": "2026-11-20T18:19:26.977Z"
}
```

## casino-a — POST /v1/ingest (accepted)

```http
POST /v1/ingest/casino-a/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795198766
x-mio-signature: d61f951200d1954e897b822733f1a0d33abdba3fab8575553b1bc2c5fada8703
x-mio-key-id: key-casino-a

{"event":"deposit.completed","event_id":"a-097b09c3-8cad-4c09-a9bb-2e0c7cd5e146","user_id":"player-casino-a","amount":"50.00","currency":"EUR","occurred_at":"2026-11-20T18:19:26.977Z"}
```

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8

{
  "status": "accepted",
  "eventId": "ab8a3415-e572-49bf-a1ec-4f30ddaef4ec"
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
  "token": "eyJ0IjoidGVuYW50LWEiLCJwIjoiYTkyMDAyYjctNzRkNC00ZjNhLTgzZGMtZjk3ODUyZGU3YzE4IiwiZXhwIjoxNzk1MjAyMzY3fQ.5993617b6e15b6611060e128e0808ca024245c903839ff5fdfa7fb68ff7d6f30",
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
  "spinId": "9a45a847-2880-4ef5-94cd-74ade59ee0a1",
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
    "seed": "02ec7525c50c6abeede0558fb40dddfa75d76ea8670144765ec84bf8b0f5e4ae",
    "seedHash": "6a6a70276a0f9a852686aa98a86a283324d2680a7f5075f63eb5a096355232db",
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
  "redemptionId": "ca99cc64-cc12-4c1a-b0de-1a031fa3acc7",
  "status": "pending_issuance",
  "itemId": "free-spins-50",
  "price": 100
}
```

## casino-a — GET /v1/redemptions/:id (issued)

```http
GET /v1/redemptions/ca99cc64-cc12-4c1a-b0de-1a031fa3acc7 HTTP/1.1
authorization: [redacted]
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "redemptionId": "ca99cc64-cc12-4c1a-b0de-1a031fa3acc7",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100,
  "reward": {
    "kind": "free_spins",
    "count": 50
  },
  "attempts": 0,
  "lastError": null,
  "externalRef": "A-d3583b70-31d4-475a-b7b6-185247be0a07",
  "createdAt": "2026-11-20T18:19:27.454Z",
  "updatedAt": "2026-11-20T18:19:27.599Z"
}
```

## casino-a — POST /v1/ingest (duplicate)

```http
POST /v1/ingest/casino-a/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795198766
x-mio-signature: d61f951200d1954e897b822733f1a0d33abdba3fab8575553b1bc2c5fada8703
x-mio-key-id: key-casino-a

{"event":"deposit.completed","event_id":"a-097b09c3-8cad-4c09-a9bb-2e0c7cd5e146","user_id":"player-casino-a","amount":"50.00","currency":"EUR","occurred_at":"2026-11-20T18:19:26.977Z"}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "status": "duplicate",
  "eventId": "ab8a3415-e572-49bf-a1ec-4f30ddaef4ec"
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
  "redemptionId": "ca99cc64-cc12-4c1a-b0de-1a031fa3acc7",
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
    "eventId": "b-8810edd6-09f7-4a48-abef-270270de95c7",
    "type": "PLAYER_DEPOSIT",
    "emittedAt": "2026-11-20T18:19:27.728Z"
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
x-mio-timestamp: 1795198767
x-mio-signature: bc95537fff91e0f1dfd9627f7653afe99c3ccb5b29cc6ecfceee80ed6210cbd9
x-mio-key-id: key-casino-b

{"meta":{"eventId":"b-8810edd6-09f7-4a48-abef-270270de95c7","type":"PLAYER_DEPOSIT","emittedAt":"2026-11-20T18:19:27.728Z"},"payload":{"playerRef":"player-casino-b","amountCents":5000,"ccy":"EUR"}}
```

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8

{
  "status": "accepted",
  "eventId": "db692862-12ae-4713-8ae5-b6acf3fef6e5"
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
  "token": "eyJ0IjoidGVuYW50LWIiLCJwIjoiOTllZTI1MGEtMTg4Yy00NDU0LWI1MmYtZjgxNTU1ZWY2OGE4IiwiZXhwIjoxNzk1MjAyMzY3fQ.89f5101d87b29fde35fda07a2c1ae386d3fae865d504aa13354293a3d7e30dff",
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
  "spinId": "046f5900-c563-4a8a-a6e0-605de3aa863e",
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
    "seed": "b1f69fd44572b68a929937510d332fc7f3092e13b89db65be8d6d62ff9779ff9",
    "seedHash": "f3a7013c253a2683287ed5ba3a9eff26d006860483cc913dad08c9c4e730b3b1",
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
  "redemptionId": "ae65e894-097e-44d5-a7f9-53333e500857",
  "status": "pending_issuance",
  "itemId": "free-spins-50",
  "price": 100
}
```

## casino-b — GET /v1/redemptions/:id (issued)

```http
GET /v1/redemptions/ae65e894-097e-44d5-a7f9-53333e500857 HTTP/1.1
authorization: [redacted]
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "redemptionId": "ae65e894-097e-44d5-a7f9-53333e500857",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100,
  "reward": {
    "kind": "free_spins",
    "count": 50
  },
  "attempts": 0,
  "lastError": null,
  "externalRef": "B-b79cf0d3-6ea7-48d5-b7a0-a2a5cd81e97e",
  "createdAt": "2026-11-20T18:19:28.089Z",
  "updatedAt": "2026-11-20T18:19:28.209Z"
}
```

## casino-b — POST /v1/ingest (duplicate)

```http
POST /v1/ingest/casino-b/events HTTP/1.1
content-type: application/json
x-mio-timestamp: 1795198767
x-mio-signature: bc95537fff91e0f1dfd9627f7653afe99c3ccb5b29cc6ecfceee80ed6210cbd9
x-mio-key-id: key-casino-b

{"meta":{"eventId":"b-8810edd6-09f7-4a48-abef-270270de95c7","type":"PLAYER_DEPOSIT","emittedAt":"2026-11-20T18:19:27.728Z"},"payload":{"playerRef":"player-casino-b","amountCents":5000,"ccy":"EUR"}}
```

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8

{
  "status": "duplicate",
  "eventId": "db692862-12ae-4713-8ae5-b6acf3fef6e5"
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
  "redemptionId": "ae65e894-097e-44d5-a7f9-53333e500857",
  "status": "issued",
  "itemId": "free-spins-50",
  "price": 100
}
```
