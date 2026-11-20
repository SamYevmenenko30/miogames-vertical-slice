import type { TranslationResult } from '../../domain/canonical-deposit';
import { Money } from '../../domain/money';
import type { InboundDialect } from '../../application/ports';

/**
 * Operator C: nested objects, a unix timestamp, and its own event vocabulary.
 *
 *   { "type": "PAYMENT_SETTLED", "id": "...", "account": { "ref": "..." },
 *     "money": { "value": "50.00", "ccy": "EUR" }, "ts": 1763600000 }
 *
 * Deliberately unlike both A (flat, ISO time) and B (envelope, minor units): the
 * point of a third operator is to find out whether the integration layer really
 * absorbs a shape nobody designed for.
 */
export class CasinoCDialect implements InboundDialect {
  readonly operator = 'casino-c';

  translateDeposit(raw: unknown): TranslationResult {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { outcome: 'invalid', reason: 'the payload is not a JSON object' };
    }
    const body = raw as Record<string, unknown>;

    if (body.type !== 'PAYMENT_SETTLED') {
      return { outcome: 'unsupported', reason: `operator C event ${String(body.type)} is not acted on` };
    }

    const operatorEventId = str(body.id);
    if (!operatorEventId) return { outcome: 'invalid', reason: 'id is required and must be a non-empty string' };

    const account = object(body.account);
    const externalPlayerId = account ? str(account.ref) : null;
    if (!externalPlayerId) return { outcome: 'invalid', reason: 'account.ref is required' };

    const money = object(body.money);
    const value = money ? str(money.value) : null;
    const currency = money ? str(money.ccy) : null;
    if (!value) return { outcome: 'invalid', reason: 'money.value is required and must be a decimal string' };
    if (!currency) return { outcome: 'invalid', reason: 'money.ccy is required' };

    let amount: Money;
    try {
      amount = Money.fromDecimalString(value, currency);
    } catch (error) {
      return { outcome: 'invalid', reason: `money: ${(error as Error).message}` };
    }

    // Seconds, not milliseconds, and not ISO — the one conversion this dialect
    // owns. A value that is plausibly milliseconds is refused rather than
    // silently read as the year 57000.
    const ts = body.ts;
    if (typeof ts !== 'number' || !Number.isInteger(ts) || ts <= 0 || ts > 4_000_000_000) {
      return { outcome: 'invalid', reason: 'ts is required and must be a unix timestamp in SECONDS' };
    }

    return {
      outcome: 'translated',
      event: {
        operator: this.operator,
        operatorEventId,
        externalPlayerId,
        amount: amount.toJSON(),
        occurredAt: new Date(ts * 1000).toISOString(),
      },
    };
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
