import type { AppConfig } from '../../../../platform/config/config';
import type { CasinoRewardPort, IssuanceResult, RewardIntent } from '../../application/ports';

/**
 * Operator C issues rewards with a PUT, nests the grant, and reports success in a
 * `state` field rather than by status alone — so "did it work" is a different
 * question here than for A or B, which is the half of an adapter that cannot be
 * configuration.
 */
const TYPES: Record<string, string> = { free_spins: 'FREE_SPINS', bonus_cash: 'CASH' };

export class CasinoCRewardAdapter implements CasinoRewardPort {
  readonly operator = 'casino-c';

  constructor(private readonly config: AppConfig) {}

  async issue(intent: RewardIntent): Promise<IssuanceResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.issuanceTimeoutMs);
    try {
      const response = await fetch(`${this.config.casinoMockBaseUrl}/casino-c/grants`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-request-ref': intent.idempotencyKey },
        body: JSON.stringify({
          account: intent.externalPlayerId,
          grant: { type: TYPES[intent.kind] ?? intent.kind.toUpperCase(), qty: intent.units },
          ref: intent.idempotencyKey,
        }),
        signal: controller.signal,
      });

      if (response.status >= 500) {
        return { outcome: 'retryable', reason: `operator C answered ${response.status}` };
      }
      if (!response.ok) {
        return { outcome: 'terminal', reason: `operator C rejected the grant with ${response.status}` };
      }
      const body = (await response.json()) as { id?: unknown; state?: unknown };
      if (body.state !== 'OK' || typeof body.id !== 'string' || body.id.length === 0) {
        return { outcome: 'terminal', reason: 'operator C answered 200 without state=OK and an id' };
      }
      return { outcome: 'issued', reference: body.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = controller.signal.aborted || /abort/i.test(message);
      return {
        outcome: 'retryable',
        reason: aborted
          ? `operator C hit the issuance timeout after ${this.config.issuanceTimeoutMs}ms`
          : `operator C unreachable: ${message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
