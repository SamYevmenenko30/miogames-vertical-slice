import { describe, expect, it } from 'vitest';
import { validateSlices, weightedPick, type WheelSlice } from '../domain/wheel';

const slices: WheelSlice[] = [
  { id: 'small', weight: 50, prize: { kind: 'coins', amount: 10 } },
  { id: 'medium', weight: 30, prize: { kind: 'coins', amount: 50 } },
  { id: 'large', weight: 15, prize: { kind: 'free_spins', count: 10 } },
  { id: 'jackpot', weight: 5, prize: { kind: 'bonus_cash', amountMinor: 1000, currency: 'EUR' } },
];

describe('gamification — the draw', () => {
  it('S6 — zero picks the first slice and a value just under one picks the last', () => {
    expect(weightedPick(slices, 0).id).toBe('small');
    expect(weightedPick(slices, 0.999999).id).toBe('jackpot');
  });

  it('S6 — a value lands in the slice whose cumulative interval contains it', () => {
    // total weight 100: small [0,50) medium [50,80) large [80,95) jackpot [95,100)
    expect(weightedPick(slices, 0.49).id).toBe('small');
    expect(weightedPick(slices, 0.5).id).toBe('medium');
    expect(weightedPick(slices, 0.79).id).toBe('medium');
    expect(weightedPick(slices, 0.8).id).toBe('large');
    expect(weightedPick(slices, 0.94).id).toBe('large');
    expect(weightedPick(slices, 0.95).id).toBe('jackpot');
  });

  it('S6 — it is a pure function: the same input always gives the same slice', () => {
    for (const u of [0, 0.1, 0.5, 0.9, 0.9999]) {
      expect(weightedPick(slices, u).id).toBe(weightedPick(slices, u).id);
    }
  });

  it('S6 — over 100k uniform draws each slice is within 1.5 points of its weight share', () => {
    const counts = new Map<string, number>();
    const n = 100_000;
    for (let i = 0; i < n; i += 1) {
      const slice = weightedPick(slices, (i + 0.5) / n);
      counts.set(slice.id, (counts.get(slice.id) ?? 0) + 1);
    }
    for (const slice of slices) {
      const share = ((counts.get(slice.id) ?? 0) / n) * 100;
      expect(Math.abs(share - slice.weight)).toBeLessThan(1.5);
    }
  });

  it('S6 — a value outside [0,1) is a programming error, not a silent clamp', () => {
    expect(() => weightedPick(slices, 1)).toThrowError(/uniform/i);
    expect(() => weightedPick(slices, -0.1)).toThrowError(/uniform/i);
  });
});

describe('gamification — configuration validation', () => {
  it('S4 — a valid table passes', () => {
    expect(() => validateSlices(slices)).not.toThrow();
  });

  it('S4 — fewer than two slices is refused', () => {
    expect(() => validateSlices([slices[0]!])).toThrowError(/two/i);
  });

  it('S4 — a weight of zero or below is refused', () => {
    expect(() => validateSlices([{ ...slices[0]!, weight: 0 }, slices[1]!])).toThrowError(/weight/i);
    expect(() => validateSlices([{ ...slices[0]!, weight: -3 }, slices[1]!])).toThrowError(/weight/i);
  });

  it('S4 — a non-integer weight is refused', () => {
    expect(() => validateSlices([{ ...slices[0]!, weight: 1.5 }, slices[1]!])).toThrowError(/integer/i);
  });

  it('S4 — a duplicate slice id is refused', () => {
    expect(() => validateSlices([slices[0]!, { ...slices[1]!, id: 'small' }])).toThrowError(/duplicate/i);
  });

  it('S4 — an unknown prize kind is refused at configuration time', () => {
    const bad = [{ id: 'x', weight: 1, prize: { kind: 'yacht' } }, slices[1]!] as unknown as WheelSlice[];
    expect(() => validateSlices(bad)).toThrowError(/prize|kind/i);
  });

  it('S4 — a coins prize with a non-positive amount is refused', () => {
    expect(() =>
      validateSlices([{ id: 'x', weight: 1, prize: { kind: 'coins', amount: 0 } }, slices[1]!]),
    ).toThrowError(/amount/i);
  });

  it('S4 — a nothing prize is valid: a wheel may have losing slices', () => {
    expect(() => validateSlices([{ id: 'x', weight: 1, prize: { kind: 'nothing' } }, slices[1]!])).not.toThrow();
  });
});
