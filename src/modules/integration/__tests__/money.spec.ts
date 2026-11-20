import { describe, expect, it } from 'vitest';
import { Money } from '../domain/money';

describe('integration — money', () => {
  it('S6 — a major-unit decimal string converts exactly', () => {
    expect(Money.fromDecimalString('50.00', 'EUR').amountMinor).toBe(5000);
    expect(Money.fromDecimalString('0.01', 'EUR').amountMinor).toBe(1);
    expect(Money.fromDecimalString('1234567.89', 'EUR').amountMinor).toBe(123456789);
    expect(Money.fromDecimalString('50', 'EUR').amountMinor).toBe(5000);
    expect(Money.fromDecimalString('50.5', 'EUR').amountMinor).toBe(5050);
  });

  it('S6 — more precision than the currency has is refused', () => {
    expect(() => Money.fromDecimalString('50.001', 'EUR')).toThrowError(/precision|decimal/i);
  });

  it('S6 — a non-numeric or negative amount is refused', () => {
    for (const bad of ['', 'abc', '-1.00', '1,00', '1.2.3', ' 50.00 ']) {
      expect(() => Money.fromDecimalString(bad, 'EUR')).toThrowError(/amount/i);
    }
  });

  it('S6 — an unsupported currency is refused by name', () => {
    expect(() => Money.fromDecimalString('50.00', 'XYZ')).toThrowError(/XYZ/);
    expect(() => Money.fromMinorUnits(5000, 'xyz')).toThrowError(/XYZ/i);
  });

  it('S6 — minor units stay integers, and a fractional minor unit is refused', () => {
    expect(Money.fromMinorUnits(5000, 'EUR').amountMinor).toBe(5000);
    expect(() => Money.fromMinorUnits(50.5, 'EUR')).toThrowError(/integer/i);
    expect(() => Money.fromMinorUnits(-1, 'EUR')).toThrowError(/amount/i);
  });

  it('S6 — a currency is compared case-insensitively but stored upper-case', () => {
    expect(Money.fromMinorUnits(100, 'eur').currency).toBe('EUR');
  });

  it('S6 — comparison and formatting do not use floats', () => {
    const fifty = Money.fromDecimalString('50.00', 'EUR');
    expect(fifty.atLeast(Money.fromMinorUnits(5000, 'EUR'))).toBe(true);
    expect(fifty.atLeast(Money.fromMinorUnits(5001, 'EUR'))).toBe(false);
    expect(fifty.toDecimalString()).toBe('50.00');
    expect(() => fifty.atLeast(Money.fromMinorUnits(5000, 'USD'))).toThrowError(/currency/i);
  });
});
