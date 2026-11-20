import type { TranslationResult } from '../../domain/canonical-deposit';
import { Money } from '../../domain/money';
import type { InboundDialect } from '../../application/ports';

/**
 * Operator A: flat REST, amounts as major-unit decimal strings.
 *
 *   { "event": "deposit.completed", "event_id": "...", "user_id": "...",
 *     "amount": "50.00", "currency": "EUR", "occurred_at": "..." }
 */
export class CasinoADialect implements InboundDialect {
  readonly operator = 'casino-a';

  translateDeposit(raw: unknown): TranslationResult {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { outcome: 'invalid', reason: 'the payload is not a JSON object' };
    }
    const body = raw as Record<string, unknown>;

    if (body.event !== 'deposit.completed') {
      return { outcome: 'unsupported', reason: `operator A event ${String(body.event)} is not acted on` };
    }

    const operatorEventId = str(body.event_id);
    if (!operatorEventId) {
      // Never synthesised from the payload: two genuinely different deposits would
      // then collide and one would be silently swallowed (MIO-003 Q1).
      return { outcome: 'invalid', reason: 'event_id is required and must be a non-empty string' };
    }
    const externalPlayerId = str(body.user_id);
    if (!externalPlayerId) return { outcome: 'invalid', reason: 'user_id is required and must be a non-empty string' };

    const amount = str(body.amount);
    const currency = str(body.currency);
    if (!amount) return { outcome: 'invalid', reason: 'amount is required and must be a decimal string' };
    if (!currency) return { outcome: 'invalid', reason: 'currency is required' };

    let money: Money;
    try {
      money = Money.fromDecimalString(amount, currency);
    } catch (error) {
      return { outcome: 'invalid', reason: `amount/currency: ${(error as Error).message}` };
    }

    const occurredAt = str(body.occurred_at);
    if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
      return { outcome: 'invalid', reason: 'occurred_at is required and must be an ISO-8601 timestamp' };
    }

    return {
      outcome: 'translated',
      event: {
        operator: this.operator,
        operatorEventId,
        externalPlayerId,
        amount: money.toJSON(),
        occurredAt: new Date(occurredAt).toISOString(),
      },
    };
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
