-- A webhook secret must be recoverable: HMAC verification needs the key itself,
-- not a digest of it. MIO-002 stored only a digest, which is right for something
-- you compare and wrong for a shared signing key — found while implementing the
-- ingest endpoint that has to verify a signature.
--
-- The secret is stored encrypted (AES-256-GCM, key derived from the platform
-- secret by HKDF), so "never stored in the clear" still holds. The digest stays:
-- `authenticate(keyId, secret)` compares, and comparing a digest is the right
-- shape for that.

alter table identity.tenant_api_key
  add column secret_encrypted text;

comment on column identity.tenant_api_key.secret_encrypted is
  'AES-256-GCM ciphertext of the operator signing secret (see platform/crypto).';
