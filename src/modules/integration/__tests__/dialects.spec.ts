import { describe, expect, it } from 'vitest';
import { CasinoADialect } from '../adapters/in/casino-a.dialect';
import { CasinoBDialect } from '../adapters/in/casino-b.dialect';
import { DialectRegistry } from '../application/dialect-registry';

const a = new CasinoADialect();
const b = new CasinoBDialect();

const depositA = {
  event: 'deposit.completed',
  event_id: 'a-evt-1',
  user_id: 'player-77',
  amount: '50.00',
  currency: 'EUR',
  occurred_at: '2026-11-20T11:00:00.000Z',
};

const depositB = {
  meta: { eventId: 'b-evt-1', type: 'PLAYER_DEPOSIT', emittedAt: '2026-11-20T11:00:00.000Z' },
  payload: { playerRef: 'player-77', amountCents: 5000, ccy: 'EUR' },
};

describe('integration — operator A dialect', () => {
  it('S2 — a flat deposit becomes the canonical event', () => {
    const result = a.translateDeposit(depositA);
    expect(result).toEqual({
      outcome: 'translated',
      event: {
        operator: 'casino-a',
        operatorEventId: 'a-evt-1',
        externalPlayerId: 'player-77',
        amount: { amountMinor: 5000, currency: 'EUR' },
        occurredAt: '2026-11-20T11:00:00.000Z',
      },
    });
  });

  it('S4 — a missing player id is invalid, and names the field', () => {
    const result = a.translateDeposit({ ...depositA, user_id: '' });
    expect(result.outcome).toBe('invalid');
    if (result.outcome === 'invalid') expect(result.reason).toMatch(/user_id/);
  });

  it('S4 — a missing event id is invalid rather than synthesised', () => {
    const { event_id: _dropped, ...withoutId } = depositA;
    const result = a.translateDeposit(withoutId);
    expect(result.outcome).toBe('invalid');
    if (result.outcome === 'invalid') expect(result.reason).toMatch(/event_id/);
  });

  it('S4 — a negative amount, unknown currency and broken timestamp are each invalid', () => {
    expect(a.translateDeposit({ ...depositA, amount: '-5.00' }).outcome).toBe('invalid');
    expect(a.translateDeposit({ ...depositA, currency: 'XYZ' }).outcome).toBe('invalid');
    expect(a.translateDeposit({ ...depositA, occurred_at: 'yesterday' }).outcome).toBe('invalid');
  });

  it('S5 — another event type is unsupported, not invalid', () => {
    const result = a.translateDeposit({ ...depositA, event: 'withdrawal.completed' });
    expect(result.outcome).toBe('unsupported');
  });

  it('S4 — a payload that is not an object at all is invalid, not a crash', () => {
    for (const bad of [null, undefined, 42, 'text', []]) {
      expect(() => a.translateDeposit(bad)).not.toThrow();
      expect(a.translateDeposit(bad).outcome).toBe('invalid');
    }
  });
});

describe('integration — operator B dialect', () => {
  it('S3 — an enveloped deposit becomes the same canonical event', () => {
    const fromA = a.translateDeposit(depositA);
    const fromB = b.translateDeposit(depositB);
    expect(fromB.outcome).toBe('translated');
    if (fromA.outcome !== 'translated' || fromB.outcome !== 'translated') throw new Error('both must translate');
    expect({ ...fromB.event, operator: 'x', operatorEventId: 'x' }).toEqual({
      ...fromA.event,
      operator: 'x',
      operatorEventId: 'x',
    });
    expect(fromB.event.operator).toBe('casino-b');
    expect(fromB.event.operatorEventId).toBe('b-evt-1');
  });

  it('S5 — B reports its own unsupported type', () => {
    const result = b.translateDeposit({ ...depositB, meta: { ...depositB.meta, type: 'PLAYER_WITHDRAWAL' } });
    expect(result.outcome).toBe('unsupported');
  });

  it('S4 — a fractional amountCents is invalid', () => {
    const result = b.translateDeposit({ ...depositB, payload: { ...depositB.payload, amountCents: 50.5 } });
    expect(result.outcome).toBe('invalid');
    if (result.outcome === 'invalid') expect(result.reason).toMatch(/amountCents|integer/i);
  });

  it('S4 — a missing envelope is invalid, not a crash', () => {
    expect(b.translateDeposit({ payload: depositB.payload }).outcome).toBe('invalid');
    expect(b.translateDeposit({ meta: depositB.meta }).outcome).toBe('invalid');
  });
});

describe('integration — the dialect registry', () => {
  it('S7 — resolves a dialect by operator code', () => {
    const registry = new DialectRegistry([a, b]);
    expect(registry.forOperator('casino-a')).toBe(a);
    expect(registry.forOperator('casino-b')).toBe(b);
  });

  it('S7 — an unknown operator code is a configuration error naming the code', () => {
    const registry = new DialectRegistry([a, b]);
    expect(() => registry.forOperator('casino-zed')).toThrowError(/casino-zed/);
  });

  it('S7 — two dialects claiming the same operator code is refused at construction', () => {
    expect(() => new DialectRegistry([a, new CasinoADialect()])).toThrowError(/casino-a/);
  });
});
