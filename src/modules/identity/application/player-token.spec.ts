import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../../platform/clock/clock';
import { PlayerTokenService } from './player-token.service';

const secret = 'platform-player-token-secret-32ch';

const service = (clock: FixedClock) => new PlayerTokenService(secret, 3600, clock);

describe('identity — player tokens', () => {
  it('S9 — a token resolves back to the tenant and player it was issued for', () => {
    const clock = new FixedClock(new Date('2026-11-20T12:00:00.000Z'));
    const tokens = service(clock);
    const token = tokens.issue({ tenantId: 'tenant-a', playerId: 'player-1' });
    expect(tokens.verify(token)).toEqual({ tenantId: 'tenant-a', playerId: 'player-1' });
  });

  it('S10 — a tampered token does not verify', () => {
    const clock = new FixedClock(new Date('2026-11-20T12:00:00.000Z'));
    const tokens = service(clock);
    const token = tokens.issue({ tenantId: 'tenant-a', playerId: 'player-1' });
    const [body, signature] = token.split('.');
    const tamperedBody = Buffer.from(
      JSON.stringify({ t: 'tenant-b', p: 'player-1', exp: 9_999_999_999 }),
    ).toString('base64url');

    expect(() => tokens.verify(`${tamperedBody}.${signature!}`)).toThrowError(/signature/i);
    expect(() => tokens.verify(`${body!}.${'0'.repeat(signature!.length)}`)).toThrowError(/signature/i);
  });

  it('S10 — a token signed with another secret does not verify', () => {
    const clock = new FixedClock(new Date('2026-11-20T12:00:00.000Z'));
    const foreign = new PlayerTokenService('a-different-secret-of-32-characters', 3600, clock);
    const token = foreign.issue({ tenantId: 'tenant-a', playerId: 'player-1' });
    expect(() => service(clock).verify(token)).toThrowError(/signature/i);
  });

  it('S10 — a malformed token does not verify and does not throw something unexpected', () => {
    const clock = new FixedClock(new Date('2026-11-20T12:00:00.000Z'));
    const tokens = service(clock);
    for (const bad of ['', 'nodot', 'a.b.c', '.', 'YWJj.']) {
      expect(() => tokens.verify(bad)).toThrowError(/token/i);
    }
  });

  it('S11 — an expired token is rejected, and the failure names expiry', () => {
    const clock = new FixedClock(new Date('2026-11-20T12:00:00.000Z'));
    const tokens = new PlayerTokenService(secret, 1, clock);
    const token = tokens.issue({ tenantId: 'tenant-a', playerId: 'player-1' });
    expect(tokens.verify(token)).toMatchObject({ playerId: 'player-1' });

    clock.advance(2000);
    expect(() => tokens.verify(token)).toThrowError(/expired/i);
  });
});
