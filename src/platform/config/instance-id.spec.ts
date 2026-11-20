import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

/**
 * MIO-015 S6 — who is this process?
 *
 * `claimed_by` and the outbox relay's claim both answered "the pid", and the
 * round-two review measured two worker containers that were BOTH pid 25: a
 * container has its own PID namespace, so replicas collide as a matter of course.
 * That made the column unable to name the worker it claimed to name — and it
 * makes a `claimed_by = <me>` predicate on a money write-back worthless, which is
 * why this is a prerequisite for R2-B2 rather than a tidy-up.
 */
const minimal = {
  DATABASE_URL: 'postgres://mio:mio@localhost:5440/mio',
  PLAYER_TOKEN_SECRET: 'platform-player-token-secret-32ch',
};

describe('MIO-015 S6 — the instance id', () => {
  it('S6 — two independently loaded configurations never share an instance id', () => {
    const a = loadConfig({ ...minimal });
    const b = loadConfig({ ...minimal });

    // Same host, same pid, same environment — and still distinguishable, which
    // is the whole property a pid does not have.
    expect(a.instanceId).not.toBe(b.instanceId);
    expect(a.instanceId).toBeTruthy();
  });

  it('S6 — the instance id names the host it runs on', () => {
    const config = loadConfig({ ...minimal });

    // So a claim left behind by a dead worker says WHERE to look, which is what
    // the column was documented to be for.
    expect(config.instanceId).toContain(hostname());
  });

  it('S6 — INSTANCE_ID overrides it, so an orchestrator can name the pod', () => {
    const config = loadConfig({ ...minimal, INSTANCE_ID: 'worker-7' });

    expect(config.instanceId).toBe('worker-7');
  });
});
