import type { AppConfig } from '../../../../platform/config/config';
import type { CasinoRewardPort, IssuanceResult, RewardIntent } from '../../application/ports';

/**
 * Operator A: flat REST. `POST /casino-a/rewards` with `user_id`, `reward_type`
 * and `reward_value`, answering `{ reference }`.
 *
 * Every failure is classified. "Unknown" is not an option: the retry loop has to
 * decide something, and defaulting to retry on a terminal failure burns the
 * attempt budget against a request that can never succeed.
 */
export class CasinoARewardAdapter implements CasinoRewardPort {
  readonly operator = 'casino-a';

  constructor(private readonly config: AppConfig) {}

  async issue(intent: RewardIntent): Promise<IssuanceResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.issuanceTimeoutMs);
    try {
      const response = await fetch(`${this.config.casinoMockBaseUrl}/casino-a/rewards`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Carried so a retry is recognisable on their side too. We cannot make
          // them honour it; we can make it possible.
          'idempotency-key': intent.idempotencyKey,
        },
        body: JSON.stringify({
          user_id: intent.externalPlayerId,
          reward_type: intent.kind,
          reward_value: intent.units,
          currency: intent.currency,
        }),
        signal: controller.signal,
      });

      if (response.status >= 500) {
        return { outcome: 'retryable', reason: `operator A answered ${response.status}` };
      }
      if (!response.ok) {
        return { outcome: 'terminal', reason: `operator A rejected the request with ${response.status}` };
      }
      const body = (await response.json()) as { reference?: unknown };
      if (typeof body.reference !== 'string' || body.reference.length === 0) {
        // A success we cannot record is not a success: we would have no way to
        // answer "was this issued?" and no way to reconcile (MIO-010 Q1).
        return { outcome: 'terminal', reason: 'operator A answered 200 without a reference' };
      }
      return { outcome: 'issued', reference: body.reference };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = controller.signal.aborted || /abort/i.test(message);
      return {
        outcome: 'retryable',
        reason: aborted ? `operator A hit the issuance timeout after ${this.config.issuanceTimeoutMs}ms` : `operator A unreachable: ${message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
