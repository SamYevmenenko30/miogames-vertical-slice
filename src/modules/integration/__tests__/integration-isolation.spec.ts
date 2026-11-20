import { describe, expect, it } from 'vitest';
import { CasinoADialect } from '../adapters/in/casino-a.dialect';
import { CasinoBDialect } from '../adapters/in/casino-b.dialect';
import { DialectRegistry } from '../application/dialect-registry';
import { IntegrationFacade } from '../application/integration.facade';

/**
 * This module holds no tenant-owned rows, so its isolation property is not about
 * a WHERE clause: it is that a tenant's events can only ever be read with that
 * tenant's own dialect. The facade takes the operator code from the caller's
 * resolved tenant, and nothing here falls back to another operator's reader.
 */
const facade = new IntegrationFacade(new DialectRegistry([new CasinoADialect(), new CasinoBDialect()]));

const depositB = {
  meta: { eventId: 'b-evt-1', type: 'PLAYER_DEPOSIT', emittedAt: '2026-11-20T11:00:00.000Z' },
  payload: { playerRef: 'player-77', amountCents: 5000, ccy: 'EUR' },
};

describe('integration — one tenant cannot be read with another operator dialect', () => {
  it("S7 — operator B's payload is refused by operator A's dialect rather than half-read", () => {
    const result = facade.translateDeposit('casino-a', depositB);
    expect(result.outcome).not.toBe('translated');
  });

  it('S7 — an operator with no adapter is refused, never served by a neighbour', () => {
    expect(() => facade.translateDeposit('casino-zed', depositB)).toThrowError(/casino-zed/);
  });

  it('S7 — issuing a reward for an unregistered operator is terminal, not routed elsewhere', async () => {
    const result = await facade.issueReward('casino-zed', {
      externalPlayerId: 'player-77',
      kind: 'free_spins',
      units: 10,
      idempotencyKey: 'k',
    });
    expect(result).toEqual({ outcome: 'terminal', reason: expect.stringContaining('casino-zed') });
  });
});
