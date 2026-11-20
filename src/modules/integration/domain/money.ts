/**
 * Money, with the float problem designed out rather than tested for.
 *
 * Amounts live as integer minor units plus a currency. The only place a decimal
 * string exists is at the edge, where an operator's dialect speaks one — and the
 * conversion is integer arithmetic on the digits, never `parseFloat` (`0.1 + 0.2`
 * is the oldest bug in billing).
 */
const EXPONENTS: Record<string, number> = { EUR: 2, USD: 2, GBP: 2 };

export type MoneyShape = { amountMinor: number; currency: string };

export class Money {
  private constructor(
    readonly amountMinor: number,
    readonly currency: string,
  ) {}

  static supportedCurrency(currency: string): string {
    const code = currency.toUpperCase();
    if (!(code in EXPONENTS)) {
      throw new Error(`unsupported currency ${code}: this platform settles in ${Object.keys(EXPONENTS).join(', ')}`);
    }
    return code;
  }

  static fromMinorUnits(amountMinor: number, currency: string): Money {
    const code = Money.supportedCurrency(currency);
    if (!Number.isInteger(amountMinor)) {
      throw new Error(`amount in minor units must be an integer, got ${amountMinor}`);
    }
    if (amountMinor < 0) throw new Error(`amount must not be negative, got ${amountMinor}`);
    return new Money(amountMinor, code);
  }

  static fromDecimalString(amount: string, currency: string): Money {
    const code = Money.supportedCurrency(currency);
    if (!/^\d+(\.\d+)?$/.test(amount)) {
      throw new Error(`amount must be a non-negative decimal number, got ${JSON.stringify(amount)}`);
    }
    const exponent = EXPONENTS[code]!;
    const [whole, fraction = ''] = amount.split('.') as [string, string?];
    if (fraction.length > exponent) {
      throw new Error(`amount ${amount} has more decimal precision than ${code} has (${exponent})`);
    }
    const padded = fraction.padEnd(exponent, '0');
    return new Money(Number(`${whole}${padded}`), code);
  }

  atLeast(other: Money): boolean {
    if (other.currency !== this.currency) {
      throw new Error(`cannot compare ${this.currency} with another currency (${other.currency}): no conversion is defined here`);
    }
    return this.amountMinor >= other.amountMinor;
  }

  toDecimalString(): string {
    const exponent = EXPONENTS[this.currency]!;
    const digits = String(this.amountMinor).padStart(exponent + 1, '0');
    return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
  }

  toJSON(): MoneyShape {
    return { amountMinor: this.amountMinor, currency: this.currency };
  }
}
