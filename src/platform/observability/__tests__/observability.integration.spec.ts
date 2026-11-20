import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from '../../../test/api.helper';
import { createLogger, withRequestContext } from '../logger';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi('observability');
});

afterAll(async () => {
  await api?.close();
});

describe('platform/observability — request context', () => {
  it('S1 — a failing request carries a trace id in the header and the body, and they match', async () => {
    const res = await request(api.app.getHttpServer()).post('/v1/ingest/casino-a/events').send('{}');
    expect(res.status).toBe(401);
    expect(res.headers['x-trace-id']).toMatch(/^[0-9a-f-]{8,}$/);
    expect(res.body.traceId).toBe(res.headers['x-trace-id']);
  });

  it('S1 — a successful request carries one too', async () => {
    const res = await request(api.app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-trace-id']).toMatch(/^[0-9a-f-]{8,}$/);
  });

  it('S1 — two requests get different trace ids', async () => {
    const a = await request(api.app.getHttpServer()).get('/health');
    const b = await request(api.app.getHttpServer()).get('/health');
    expect(a.headers['x-trace-id']).not.toBe(b.headers['x-trace-id']);
  });

  it('S2 — log lines written by different layers share the request trace id', () => {
    const written: string[] = [];
    const logger = createLogger('info', { write: (line) => written.push(line) });

    withRequestContext({ traceId: 'trace-123', tenantId: 'tenant-a' }, () => {
      logger.info({ step: 'first' }, 'one');
      logger.child({ layer: 'adapter' }).info({ step: 'second' }, 'two');
    });

    expect(written).toHaveLength(2);
    for (const line of written) {
      const parsed = JSON.parse(line) as { traceId?: string; tenantId?: string };
      expect(parsed.traceId).toBe('trace-123');
      expect(parsed.tenantId).toBe('tenant-a');
    }
  });

  it('S6 — secrets are redacted', () => {
    const written: string[] = [];
    const logger = createLogger('info', { write: (line) => written.push(line) });

    logger.info(
      { secret: 'hunter2', apiKey: 'key-a.secret-a', signature: 'deadbeef', authorization: 'Bearer x', keep: 'visible' },
      'sensitive',
    );

    const line = written[0]!;
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('secret-a');
    expect(line).not.toContain('deadbeef');
    expect(line).toContain('visible');
    expect(line).toContain('[redacted]');
  });
});

describe('platform/observability — health', () => {
  it('S3 — health reports the applied schema version', async () => {
    const res = await request(api.app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(res.body.schemaVersion).toMatch(/^\d{4}_.+\.sql$/);
  });

  it('S3 — with the database unreachable it answers 503 and does not claim ok', async () => {
    // An API pointed at a database that is not there — the shape of an outage,
    // without having to break a working pool from the outside.
    const broken = await startTestApi('observability-broken', {
      DATABASE_URL: 'postgres://mio_app:mio_app@localhost:5440/mio_absent_database',
    });
    try {
      const res = await request(broken.app.getHttpServer()).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.ok).toBe(false);
      expect(res.body.schemaVersion).toBeNull();
    } finally {
      await broken.close();
    }
  });
});
