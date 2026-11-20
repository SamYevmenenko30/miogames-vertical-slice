import type { AppConfig } from '../../../../platform/config/config';
import type { CasinoRewardPort, IssuanceResult, RewardIntent } from '../../application/ports';

/**
 * Operator B: a command envelope. `POST /casino-b/commands` with
 * `{ command: 'GRANT_REWARD', playerRef, reward: { kind, units } }`, answering
 * `{ status, result: { commandRef } }` — and its own vocabulary for the reward
 * kind, which is the whole reason this is a separate adapter.
 */
const KINDS: Record<string, string> = { free_spins: 'FREE_SPINS', bonus_cash: 'BONUS_CASH' };

export class CasinoBRewardAdapter implements CasinoRewardPort {
  readonly operator = 'casino-b';

  constructor(private readonly config: AppConfig) {}

  async issue(intent: RewardIntent): Promise<IssuanceResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.issuanceTimeoutMs);
    try {
      const response = await fetch(`${this.config.casinoMockBaseUrl}/casino-b/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-command-id': intent.idempotencyKey },
        body: JSON.stringify({
          command: 'GRANT_REWARD',
          playerRef: intent.externalPlayerId,
          reward: { kind: KINDS[intent.kind] ?? intent.kind.toUpperCase(), units: intent.units },
        }),
        signal: controller.signal,
      });

      if (response.status >= 500) {
        return { outcome: 'retryable', reason: `operator B answered ${response.status}` };
      }
      if (!response.ok) {
        return { outcome: 'terminal', reason: `operator B rejected the command with ${response.status}` };
      }
      const body = (await response.json()) as { status?: unknown; result?: { commandRef?: unknown } };
      const reference = body.result?.commandRef;
      if (body.status !== 'ACCEPTED' || typeof reference !== 'string' || reference.length === 0) {
        return { outcome: 'terminal', reason: `operator B answered without an accepted command reference` };
      }
      return { outcome: 'issued', reference };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = controller.signal.aborted || /abort/i.test(message);
      return {
        outcome: 'retryable',
        reason: aborted ? `operator B hit the issuance timeout after ${this.config.issuanceTimeoutMs}ms` : `operator B unreachable: ${message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
