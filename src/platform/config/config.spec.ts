import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://mio:mio@localhost:5440/mio',
  PLAYER_TOKEN_SECRET: 'x'.repeat(32),
};

describe('platform/config', () => {
  it('S1 — a missing required setting fails at startup, naming the variable', () => {
    const { DATABASE_URL: _omitted, ...withoutUrl } = valid;
    expect(() => loadConfig(withoutUrl)).toThrowError(/DATABASE_URL/);
  });

  it('S1 — it does not substitute a default for a missing required setting', () => {
    const { PLAYER_TOKEN_SECRET: _omitted, ...withoutSecret } = valid;
    expect(() => loadConfig(withoutSecret)).toThrowError(/PLAYER_TOKEN_SECRET/);
  });

  it('S2 — a non-numeric duration fails, naming the variable', () => {
    expect(() => loadConfig({ ...valid, OUTBOX_POLL_MS: 'abc' })).toThrowError(/OUTBOX_POLL_MS/);
  });

  it('S2 — a malformed connection string fails, naming the variable', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: 'not-a-url' })).toThrowError(/DATABASE_URL/);
  });

  it('S3 — the loaded configuration is frozen', () => {
    const config = loadConfig(valid);
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      (config as unknown as Record<string, unknown>).port = 1;
    }).toThrow();
  });

  it('S2 — documented defaults apply when a setting is optional', () => {
    const config = loadConfig(valid);
    expect(config.outboxPollMs).toBe(250);
    expect(config.issuanceTimeoutMs).toBe(2000);
    expect(config.issuanceMaxAttempts).toBe(5);
    expect(config.hmacToleranceSeconds).toBe(300);
  });
});
