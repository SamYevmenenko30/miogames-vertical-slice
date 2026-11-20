import { describe, expect, it } from 'vitest';
import { FixedClock, SystemClock } from './clock';

describe('platform/clock', () => {
  it('S19 — the system clock reports real time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('S19 — a fixed clock can be advanced, and the application sees the new now', () => {
    const clock = new FixedClock(new Date('2026-11-20T10:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-11-20T10:00:00.000Z');
    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe('2026-11-20T10:01:30.000Z');
  });

  it('S19 — a fixed clock can be set to an absolute instant', () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
    clock.set(new Date('2027-03-04T05:06:07.000Z'));
    expect(clock.now().toISOString()).toBe('2027-03-04T05:06:07.000Z');
  });
});
