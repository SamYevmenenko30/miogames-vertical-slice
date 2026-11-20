import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

/**
 * MIO-016 S6 — the four database limits are configuration with defaults, not
 * constants in the factory. A limit that can only be changed by a deploy is a
 * limit somebody will comment out at 3am instead of tuning.
 */
const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://mio:mio@localhost:5440/mio',
  PLAYER_TOKEN_SECRET: 'x'.repeat(32),
};

describe('platform/config — database timeouts', () => {
  it('S6 — the four limits have defaults, in the units their names claim', () => {
    const config = loadConfig(valid);
    expect(config.dbStatementTimeoutMs).toBe(15_000);
    expect(config.dbLockTimeoutMs).toBe(5_000);
    expect(config.dbIdleInTransactionTimeoutMs).toBe(30_000);
    expect(config.dbConnectTimeoutSeconds).toBe(10);
  });

  it('S6 — each limit is read from its own variable', () => {
    const config = loadConfig({
      ...valid,
      DB_STATEMENT_TIMEOUT_MS: '7000',
      DB_LOCK_TIMEOUT_MS: '800',
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '9000',
      DB_CONNECT_TIMEOUT_SECONDS: '3',
    });
    expect(config.dbStatementTimeoutMs).toBe(7000);
    expect(config.dbLockTimeoutMs).toBe(800);
    expect(config.dbIdleInTransactionTimeoutMs).toBe(9000);
    expect(config.dbConnectTimeoutSeconds).toBe(3);
  });

  it('S6 — a value that is not a positive integer fails, naming the variable', () => {
    expect(() => loadConfig({ ...valid, DB_STATEMENT_TIMEOUT_MS: 'soon' })).toThrowError(
      /DB_STATEMENT_TIMEOUT_MS/,
    );
    expect(() => loadConfig({ ...valid, DB_LOCK_TIMEOUT_MS: '0' })).toThrowError(/DB_LOCK_TIMEOUT_MS/);
    expect(() => loadConfig({ ...valid, DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '-1' })).toThrowError(
      /DB_IDLE_IN_TRANSACTION_TIMEOUT_MS/,
    );
    expect(() => loadConfig({ ...valid, DB_CONNECT_TIMEOUT_SECONDS: '1.5' })).toThrowError(
      /DB_CONNECT_TIMEOUT_SECONDS/,
    );
  });
});
