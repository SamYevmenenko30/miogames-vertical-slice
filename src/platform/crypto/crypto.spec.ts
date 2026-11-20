import { describe, expect, it } from 'vitest';
import { hmacHex, randomSeedHex, sha256Hex, uniform01, verifySignature } from './crypto';

const secret = 'operator-secret';
const body = '{"event":"deposit.completed","amount":"50.00"}';

describe('platform/crypto', () => {
  it('S15 — a signature over the exact body and timestamp verifies', () => {
    const timestamp = 1_700_000_000;
    const signature = hmacHex(secret, `${timestamp}.${body}`);
    expect(
      verifySignature({ secret, payload: body, signature, timestamp, nowSeconds: timestamp + 5, toleranceSeconds: 300 }),
    ).toBe(true);
  });

  it('S15 — a signature over a tampered body is rejected', () => {
    const timestamp = 1_700_000_000;
    const signature = hmacHex(secret, `${timestamp}.${body}`);
    const tampered = body.replace('50.00', '5000.00');
    expect(
      verifySignature({ secret, payload: tampered, signature, timestamp, nowSeconds: timestamp, toleranceSeconds: 300 }),
    ).toBe(false);
  });

  it('S15 — a signature from a different secret is rejected', () => {
    const timestamp = 1_700_000_000;
    const signature = hmacHex('another-secret', `${timestamp}.${body}`);
    expect(
      verifySignature({ secret, payload: body, signature, timestamp, nowSeconds: timestamp, toleranceSeconds: 300 }),
    ).toBe(false);
  });

  it('S15 — a timestamp outside the tolerance window is rejected even with a valid signature', () => {
    const timestamp = 1_700_000_000;
    const signature = hmacHex(secret, `${timestamp}.${body}`);
    expect(
      verifySignature({ secret, payload: body, signature, timestamp, nowSeconds: timestamp + 301, toleranceSeconds: 300 }),
    ).toBe(false);
    expect(
      verifySignature({ secret, payload: body, signature, timestamp, nowSeconds: timestamp - 301, toleranceSeconds: 300 }),
    ).toBe(false);
  });

  it('S15 — a signature of the wrong length is rejected without throwing', () => {
    expect(() =>
      verifySignature({ secret, payload: body, signature: 'deadbeef', timestamp: 1, nowSeconds: 1, toleranceSeconds: 300 }),
    ).not.toThrow();
    expect(
      verifySignature({ secret, payload: body, signature: 'deadbeef', timestamp: 1, nowSeconds: 1, toleranceSeconds: 300 }),
    ).toBe(false);
  });

  it('S16 — the draw primitive is deterministic for the same seed and label', () => {
    const seed = 'a'.repeat(64);
    expect(uniform01(seed, 'spin-1')).toBe(uniform01(seed, 'spin-1'));
    expect(uniform01(seed, 'spin-1')).not.toBe(uniform01(seed, 'spin-2'));
  });

  it('S16 — it stays inside [0, 1)', () => {
    for (let i = 0; i < 1000; i += 1) {
      const value = uniform01(randomSeedHex(), `spin-${i}`);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('S16 — over 100k samples the mean is within 0.01 of 0.5', () => {
    const seed = randomSeedHex();
    let total = 0;
    const n = 100_000;
    for (let i = 0; i < n; i += 1) total += uniform01(seed, `draw-${i}`);
    expect(Math.abs(total / n - 0.5)).toBeLessThan(0.01);
  });

  it('S16 — a seed is 32 bytes of hex and never repeats', () => {
    const seeds = new Set(Array.from({ length: 500 }, () => randomSeedHex()));
    expect(seeds.size).toBe(500);
    expect([...seeds][0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('S16 — the commitment is the hash of the seed', () => {
    const seed = randomSeedHex();
    expect(sha256Hex(seed)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(seed)).toBe(sha256Hex(seed));
  });
});
