import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, UnauthorizedError, UnprocessableError } from '../errors';
import { ProblemJsonFilter } from '../problem-json.filter';

@Controller('probe')
class ProbeController {
  @Get('not-found')
  notFound(): never {
    throw new NotFoundError('redemption', 'red-1');
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictError('spin.already-claimed', 'This entitlement was already spun.');
  }

  @Get('unprocessable')
  unprocessable(): never {
    throw new UnprocessableError('ledger.insufficient-balance', 'Balance is 10 coins, the item costs 50.', {
      balance: 10,
      price: 50,
    });
  }

  @Get('unauthorized')
  unauthorized(): never {
    throw new UnauthorizedError('signature.invalid', 'The request signature did not verify.');
  }

  @Get('boom')
  boom(): never {
    throw new Error('connection to 10.0.0.5:5432 refused while running "select * from tenant"');
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ProblemJsonFilter());
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('platform/http — problem+json', () => {
  it('S13 — a not-found error renders RFC 9457 with status 404', async () => {
    const res = await request(app.getHttpServer()).get('/probe/not-found');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: expect.stringContaining('not-found'),
      title: expect.any(String),
      status: 404,
      instance: '/probe/not-found',
    });
  });

  it('S13 — a conflict renders 409 and keeps its machine-readable type', async () => {
    const res = await request(app.getHttpServer()).get('/probe/conflict');
    expect(res.status).toBe(409);
    expect(res.body.type).toContain('spin.already-claimed');
    expect(res.body.detail).toBe('This entitlement was already spun.');
  });

  it('S13 — an unprocessable error renders 422 and carries its extensions', async () => {
    const res = await request(app.getHttpServer()).get('/probe/unprocessable');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ status: 422, balance: 10, price: 50 });
  });

  it('S13 — an unauthorized error renders 401', async () => {
    const res = await request(app.getHttpServer()).get('/probe/unauthorized');
    expect(res.status).toBe(401);
    expect(res.body.status).toBe(401);
  });

  it('S14 — an unexpected error renders 500 and leaks nothing', async () => {
    const res = await request(app.getHttpServer()).get('/probe/boom');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('10.0.0.5');
    expect(body).not.toContain('select * from tenant');
    expect(body).not.toMatch(/at .*\.ts:\d+/);
    expect(res.body.title).toMatch(/unexpected|internal/i);
  });

  it('S14 — the problem body always carries a trace id the logs can be searched by', async () => {
    const res = await request(app.getHttpServer()).get('/probe/boom');
    expect(res.body.traceId).toMatch(/^[0-9a-f-]{8,}$/);
  });
});
