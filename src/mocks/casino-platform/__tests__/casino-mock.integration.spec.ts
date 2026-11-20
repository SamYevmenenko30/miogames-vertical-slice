import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCasinoMock } from '../app';

let server: Server;

beforeAll(() => {
  server = createCasinoMock().listen(0);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('the simulated operators', () => {
  it('S9 — operator A emits its own flat dialect', async () => {
    const res = await request(server)
      .post('/casino-a/deposits')
      .send({ userId: 'player-77', amount: '50.00', currency: 'EUR' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      event: 'deposit.completed',
      user_id: 'player-77',
      amount: '50.00',
      currency: 'EUR',
    });
    expect(res.body.event_id).toMatch(/.+/);
  });

  it('S9 — operator B emits its own envelope with minor units', async () => {
    const res = await request(server)
      .post('/casino-b/deposits')
      .send({ playerRef: 'player-77', amountCents: 5000, ccy: 'EUR' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      meta: { type: 'PLAYER_DEPOSIT' },
      payload: { playerRef: 'player-77', amountCents: 5000, ccy: 'EUR' },
    });
  });

  it('S9 — a reward issuance succeeds and returns the operator own reference shape', async () => {
    const a = await request(server)
      .post('/casino-a/rewards')
      .send({ user_id: 'player-77', reward_type: 'free_spins', reward_value: 50 });
    expect(a.status).toBe(200);
    expect(a.body.reference).toMatch(/^A-/);

    const b = await request(server)
      .post('/casino-b/commands')
      .send({ command: 'GRANT_REWARD', playerRef: 'player-77', reward: { kind: 'FREE_SPINS', units: 50 } });
    expect(b.status).toBe(200);
    expect(b.body.result.commandRef).toMatch(/^B-/);
  });

  it('S9 — it can be told to fail', async () => {
    const res = await request(server)
      .post('/casino-a/rewards')
      .set('x-mock-behaviour', 'fail')
      .send({ user_id: 'player-77', reward_type: 'free_spins', reward_value: 50 });
    expect(res.status).toBe(500);
  });

  it('S9 — it can be told to be slow', async () => {
    const started = Date.now();
    const res = await request(server)
      .post('/casino-a/rewards')
      .set('x-mock-behaviour', 'delay:200')
      .send({ user_id: 'player-77', reward_type: 'free_spins', reward_value: 50 });
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });

  it('S9 — it can be told to answer with something that is not the dialect', async () => {
    const res = await request(server)
      .post('/casino-a/rewards')
      .set('x-mock-behaviour', 'garbage')
      .send({ user_id: 'player-77', reward_type: 'free_spins', reward_value: 50 });
    expect(res.status).toBe(200);
    expect(res.body.reference).toBeUndefined();
  });

  it('S9 — it can be told to fail a fixed number of times and then recover', async () => {
    await request(server).post('/casino-a/_mock/flaky').send({ failures: 2 });
    const first = await request(server).post('/casino-a/rewards').send({ user_id: 'p', reward_type: 'free_spins', reward_value: 1 });
    const second = await request(server).post('/casino-a/rewards').send({ user_id: 'p', reward_type: 'free_spins', reward_value: 1 });
    const third = await request(server).post('/casino-a/rewards').send({ user_id: 'p', reward_type: 'free_spins', reward_value: 1 });
    expect([first.status, second.status, third.status]).toEqual([500, 500, 200]);
  });
});
