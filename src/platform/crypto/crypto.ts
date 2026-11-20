import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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
