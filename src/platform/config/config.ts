import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { z } from 'zod';

/**
 * The only place in the application that reads process.env (enforced by lint,
 * probed by `pnpm gate-probes`). Every knob is typed, validated and documented
 * here, so "what can be configured" has one answer.
 */
const duration = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return fallback;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        ctx.addIssue({ code: 'custom', message: 'must be a positive integer number of milliseconds' });
        return z.NEVER;
      }
      return parsed;
    });

const count = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return fallback;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        ctx.addIssue({ code: 'custom', message: 'must be a positive integer' });
        return z.NEVER;
      }
      return parsed;
    });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: count(3000),
  WORKER_HEALTH_PORT: count(3002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * Who this process is, for every claim it takes on a shared row: the outbox
   * relay's and the issuance lease's.
   *
   * It was `${process.pid}` until the round-two review measured two worker
   * containers that were BOTH pid 25 — a container has its own PID namespace, so
   * replicas collide as a matter of course, and a claim could not name the worker
   * holding it. Set it to the pod name in a cluster; the default is unique per
   * process anyway, because a wrong answer here is a money write-back landing on
   * somebody else's row.
   */
  INSTANCE_ID: z.string().min(1).optional(),

  DATABASE_URL: z.string().min(1).refine((value) => URL.canParse(value), 'must be a valid connection string'),
  /**
   * The owner connection. Migrations run here, and so does the single deliberate
   * cross-tenant read (the issuance retry sweep), because row-level security does
   * not apply to a table's owner. Defaults to DATABASE_URL so a single-role
   * development setup still works — and `pnpm verify` runs the suite with them
   * genuinely separate.
   */
  DATABASE_OWNER_URL: z.string().optional(),
  DATABASE_POOL_MAX: count(10),

  /** Signs the short-lived player tokens an operator exchanges its player id for. */
  PLAYER_TOKEN_SECRET: z.string().min(16, 'must be at least 16 characters'),
  PLAYER_TOKEN_TTL_SECONDS: count(3600),

  /** How far an operator webhook's timestamp may be from ours before we refuse it. */
  HMAC_TOLERANCE_SECONDS: count(300),

  OUTBOX_POLL_MS: duration(250),
  OUTBOX_BATCH_SIZE: count(25),
  /** A row claimed by a relay that never came back is re-claimed after this. */
  OUTBOX_CLAIM_TIMEOUT_MS: duration(60_000),

  ISSUANCE_TIMEOUT_MS: duration(2000),
  /**
   * How long a `pending_issuance → issuing` claim is honoured before the sweep
   * treats the claiming worker as dead and re-claims the redemption. Measured on
   * the DATABASE clock, like the outbox's claim timeout and for the same reason:
   * detecting a dead peer needs the one clock every process shares.
   */
  ISSUANCE_CLAIM_TIMEOUT_MS: duration(60_000),
  ISSUANCE_MAX_ATTEMPTS: count(5),
  ISSUANCE_BASE_BACKOFF_MS: duration(1000),
  ISSUANCE_MAX_BACKOFF_MS: duration(300_000),

  /** Where the two simulated operators live. Real operators come from tenant configuration. */
  CASINO_MOCK_BASE_URL: z.string().default('http://localhost:3010'),
});

export type AppConfig = Readonly<{
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  workerHealthPort: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  instanceId: string;
  databaseUrl: string;
  databaseOwnerUrl: string;
  databasePoolMax: number;
  playerTokenSecret: string;
  playerTokenTtlSeconds: number;
  hmacToleranceSeconds: number;
  outboxPollMs: number;
  outboxBatchSize: number;
  outboxClaimTimeoutMs: number;
  issuanceTimeoutMs: number;
  issuanceClaimTimeoutMs: number;
  issuanceMaxAttempts: number;
  issuanceBaseBackoffMs: number;
  issuanceMaxBackoffMs: number;
  casinoMockBaseUrl: string;
}>;

/** Nest injection token. */
export const APP_CONFIG = Symbol('AppConfig');

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Name the variable and say what is wrong with it. A configuration error that
    // does not name its variable costs an engineer twenty minutes at the worst
    // possible moment.
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'} — ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    workerHealthPort: e.WORKER_HEALTH_PORT,
    logLevel: e.LOG_LEVEL,
    // Three parts, and each earns its place: the host says where to look, the pid
    // makes it readable in a shell on that host, and the random tail is the only
    // part that is actually guaranteed unique — a container's pid is not.
    instanceId: e.INSTANCE_ID ?? `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
    databaseUrl: e.DATABASE_URL,
    databaseOwnerUrl: e.DATABASE_OWNER_URL ?? e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    playerTokenSecret: e.PLAYER_TOKEN_SECRET,
    playerTokenTtlSeconds: e.PLAYER_TOKEN_TTL_SECONDS,
    hmacToleranceSeconds: e.HMAC_TOLERANCE_SECONDS,
    outboxPollMs: e.OUTBOX_POLL_MS,
    outboxBatchSize: e.OUTBOX_BATCH_SIZE,
    outboxClaimTimeoutMs: e.OUTBOX_CLAIM_TIMEOUT_MS,
    issuanceTimeoutMs: e.ISSUANCE_TIMEOUT_MS,
    issuanceClaimTimeoutMs: e.ISSUANCE_CLAIM_TIMEOUT_MS,
    issuanceMaxAttempts: e.ISSUANCE_MAX_ATTEMPTS,
    issuanceBaseBackoffMs: e.ISSUANCE_BASE_BACKOFF_MS,
    issuanceMaxBackoffMs: e.ISSUANCE_MAX_BACKOFF_MS,
    casinoMockBaseUrl: e.CASINO_MOCK_BASE_URL,
  });
}
