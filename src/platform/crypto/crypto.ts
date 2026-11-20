import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** 32 bytes of hex. One per spin entitlement, revealed only after the draw. */
export function randomSeedHex(): string {
  return randomBytes(32).toString('hex');
}

export type SignatureCheck = {
  secret: string;
  /** The raw request body, byte for byte as received. */
  payload: string;
  signature: string;
  timestamp: number;
  nowSeconds: number;
  toleranceSeconds: number;
};

/**
 * Verify an operator webhook signature.
 *
 * The signed string is `${timestamp}.${rawBody}`: without the timestamp inside
 * the MAC, a captured request can be replayed forever, and without the tolerance
 * window the timestamp is decoration.
 */
export function verifySignature({
  secret,
  payload,
  signature,
  timestamp,
  nowSeconds,
  toleranceSeconds,
}: SignatureCheck): boolean {
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(hmacHex(secret, `${timestamp}.${payload}`), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself leak length
  // through an exception path — so check the length first and compare in constant
  // time only when it can succeed.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * The draw primitive: a uniform value in [0, 1) derived from a seed and a label.
 *
 * Deterministic by construction — the same (seed, label) always yields the same
 * number, which is what makes a spin recomputable by a player or a regulator
 * (ADR-0004). Nothing the client sends is an input.
 */
export function uniform01(seedHex: string, label: string): number {
  const digest = createHmac('sha256', Buffer.from(seedHex, 'hex')).update(label, 'utf8').digest();
  // 53 bits is exactly what a double can hold without losing integers, so the
  // mapping to [0, 1) stays uniform instead of quietly clustering.
  const value = digest.readBigUInt64BE(0) >> 11n;
  return Number(value) / 2 ** 53;
}

/**
 * Webhook secrets must be RECOVERABLE, which is the opposite of a password.
 *
 * MIO-002 stored only a digest, which is correct for something you compare and
 * wrong for a shared signing key: HMAC verification needs the key itself. So the
 * secret is encrypted at rest (AES-256-GCM) with a key derived from the platform
 * secret by HKDF, and the derivation's `info` string keeps that key separate from
 * the one signing player tokens. In production both would be KMS-managed —
 * TD-0009.
 */
export function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(purpose, 'utf8'), 32));
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('unrecognised secret ciphertext');
  const [, iv, tag, body] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
