import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import pino from 'pino';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(fields: LogFields, message?: string): void;
  info(fields: LogFields, message?: string): void;
  warn(fields: LogFields, message?: string): void;
  error(fields: LogFields, message?: string): void;
  child(bindings: LogFields): Logger;
}

export const LOGGER = Symbol('Logger');

/** What every log line carries, so "what happened to this redemption" is answerable. */
export type RequestContext = {
  traceId: string;
  tenantId?: string;
  playerId?: string;
  operator?: string;
};

const contextStore = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return contextStore.run(context, fn);
}

export function currentRequestContext(): RequestContext | null {
  return contextStore.getStore() ?? null;
}

export function currentTraceId(): string {
  return contextStore.getStore()?.traceId ?? randomUUID();
}

export function newTraceId(): string {
  return randomUUID();
}

export type LoggerSink = { write(line: string): void };

export function createLogger(level: string, sink?: LoggerSink): Logger {
  const root = pino(
    {
    level,
    // Context is attached at log time, not at child-creation time, so a line
    // written deep inside a use-case still carries the request's trace id.
    mixin: () => ({ ...(contextStore.getStore() ?? {}) }),
    redact: {
      paths: [
        'secret',
        'apiKey',
        'signature',
        'authorization',
        'token',
        'password',
        '*.secret',
        '*.apiKey',
        '*.signature',
        '*.token',
        'req.headers.authorization',
      ],
      censor: '[redacted]',
    },
    },
    // A sink only for the tests that assert what a line contains. Production
    // writes to stdout, which is what a log shipper reads.
    sink ? { write: (line: string) => sink.write(line) } : undefined,
  );
  return root as unknown as Logger;
}

const noop = () => {};
export const silentLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => silentLogger,
};
