import type { TranslationResult } from '../../domain/canonical-deposit';
import { Money } from '../../domain/money';
import type { InboundDialect } from '../../application/ports';

/**
 * Operator B: an envelope, amounts already in minor units.
 *
 *   { "meta": { "eventId": "...", "type": "PLAYER_DEPOSIT", "emittedAt": "..." },
 *     "payload": { "playerRef": "...", "amountCents": 5000, "ccy": "EUR" } }
 */
export class CasinoBDialect implements InboundDialect {
  readonly operator = 'casino-b';

  translateDeposit(raw: unknown): TranslationResult {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { outcome: 'invalid', reason: 'the payload is not a JSON object' };
    }
    const body = raw as { meta?: unknown; payload?: unknown };
    const meta = object(body.meta);
    const payload = object(body.payload);
    if (!meta) return { outcome: 'invalid', reason: 'meta is required' };
    if (!payload) return { outcome: 'invalid', reason: 'payload is required' };

    if (meta.type !== 'PLAYER_DEPOSIT') {
      return { outcome: 'unsupported', reason: `operator B event ${String(meta.type)} is not acted on` };
    }

    const operatorEventId = str(meta.eventId);
    if (!operatorEventId) return { outcome: 'invalid', reason: 'meta.eventId is required' };
    const externalPlayerId = str(payload.playerRef);
    if (!externalPlayerId) return { outcome: 'invalid', reason: 'payload.playerRef is required' };

    if (typeof payload.amountCents !== 'number' || !Number.isInteger(payload.amountCents)) {
      return { outcome: 'invalid', reason: 'payload.amountCents must be an integer number of minor units' };
    }
    const currency = str(payload.ccy);
    if (!currency) return { outcome: 'invalid', reason: 'payload.ccy is required' };

    let money: Money;
    try {
      money = Money.fromMinorUnits(payload.amountCents, currency);
    } catch (error) {
      return { outcome: 'invalid', reason: `payload.amountCents/ccy: ${(error as Error).message}` };
    }

    const occurredAt = str(meta.emittedAt);
    if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
      return { outcome: 'invalid', reason: 'meta.emittedAt is required and must be an ISO-8601 timestamp' };
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
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
