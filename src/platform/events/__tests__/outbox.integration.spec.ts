import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../test/db.helper';
import { FixedClock } from '../../clock/clock';
import { createDatabase, type Database } from '../../db/database';
import { UnitOfWork } from '../../db/unit-of-work';
import { silentLogger } from '../../observability/logger';
import { IdempotentConsumer, type DeliveredEvent } from '../idempotent-consumer';
import { OutboxEventBus } from '../outbox';
import { OutboxRelay } from '../relay';

let testDb: TestDb;
let database: Database;
let uow: UnitOfWork;
let bus: OutboxEventBus;
let clock: FixedClock;

class RecordingConsumer extends IdempotentConsumer {
  readonly name = 'recording';
  readonly eventName = 'probe.thing.happened';
  readonly handled: string[] = [];
  failTimes = 0;

  constructor(unitOfWork: UnitOfWork) {
    super(unitOfWork);
  }

  protected async handle(event: DeliveredEvent): Promise<void> {
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      throw new Error('handler blew up');
    }
    this.handled.push(event.id);
  }
}

const publish = async (id: string) =>
  uow.withTransaction(async () =>
    bus.publish({
      name: 'probe.thing.happened',
      tenantId: 'tenant-a',
      aggregateType: 'probe',
      aggregateId: id,
      payload: { id },
    }),
  );

const outboxRows = async () =>
  testDb.sql`select id, name, published_at, attempts, claimed_at from infra.outbox order by id`;

beforeAll(async () => {
  testDb = await createTestDb('outbox');
  database = createDatabase({ url: testDb.url });
  uow = new UnitOfWork(database);
  clock = new FixedClock(new Date('2026-11-20T12:00:00.000Z'));
  bus = new OutboxEventBus(uow, clock);
});

afterAll(async () => {
  await database?.close();
  await testDb?.drop();
});

beforeEach(async () => {
  // Clean on the way IN: the previous file's crash is not this file's problem to inherit.
  await testDb.sql`truncate infra.outbox, infra.processed_event restart identity`;
});

describe('platform/events — the outbox', () => {
  it('S9 — an event published in a rolled-back transaction leaves no row', async () => {
    await expect(
      uow.withTransaction(async () => {
        await bus.publish({
          name: 'probe.thing.happened',
          tenantId: 'tenant-a',
          aggregateType: 'probe',
          aggregateId: 'rolled-back',
          payload: {},
        });
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(await outboxRows()).toHaveLength(0);
  });

  it('S9 — publishing outside a unit of work is refused', async () => {
    await expect(
      bus.publish({
        name: 'probe.thing.happened',
        tenantId: 'tenant-a',
        aggregateType: 'probe',
        aggregateId: 'no-tx',
        payload: {},
      }),
    ).rejects.toThrowError(/unit of work/i);
  });

  it('S10 — the relay dispatches a published event and marks it published', async () => {
    const consumer = new RecordingConsumer(uow);
    const relay = new OutboxRelay({ uow, database, handlers: [consumer], clock, logger: silentLogger, batchSize: 10 });
    await publish('one');

    expect(await relay.drainOnce()).toBe(1);
    expect(consumer.handled).toHaveLength(1);
    const rows = await outboxRows();
    expect(rows[0]!.published_at).not.toBeNull();

    // A second drain has nothing to do.
    expect(await relay.drainOnce()).toBe(0);
    expect(consumer.handled).toHaveLength(1);
  });

  it('S10 — two relays draining the same outbox dispatch each row exactly once', async () => {
    const consumer = new RecordingConsumer(uow);
    const make = () =>
      new OutboxRelay({ uow, database, handlers: [consumer], clock, logger: silentLogger, batchSize: 10 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) await publish(id);

    const [first, second] = await Promise.all([make().drainOnce(), make().drainOnce()]);
    expect(first + second).toBe(5);
    expect(consumer.handled).toHaveLength(5);
    expect(new Set(consumer.handled).size).toBe(5);
  });

  it('S10 — a row claimed by a relay that never came back is re-claimed after the claim timeout', async () => {
    const consumer = new RecordingConsumer(uow);
    const relay = new OutboxRelay({
      uow,
      database,
      handlers: [consumer],
      clock,
      logger: silentLogger,
      batchSize: 10,
      claimTimeoutMs: 60_000,
    });
    await publish('abandoned');
    await testDb.sql`update infra.outbox set claimed_at = now() - interval '10 minutes', claimed_by = 'dead-relay'`;

    expect(await relay.drainOnce()).toBe(1);
    expect(consumer.handled).toHaveLength(1);
    const rows = await outboxRows();
    expect(rows[0]!.published_at).not.toBeNull();
  });

  it('S12 — a handler that throws leaves the event unpublished, with an attempt recorded', async () => {
    const consumer = new RecordingConsumer(uow);
    consumer.failTimes = 1;
    const relay = new OutboxRelay({ uow, database, handlers: [consumer], clock, logger: silentLogger, batchSize: 10 });
    await publish('fails-once');

    await relay.drainOnce();
    let rows = await outboxRows();
    expect(rows[0]!.published_at).toBeNull();
    expect(rows[0]!.attempts).toBe(1);
    const processed = await testDb.sql`select count(*)::int as n from infra.processed_event`;
    expect(processed[0]!.n).toBe(0);

    // S10 — eventual recovery: the next drain succeeds once the handler stops failing.
    clock.advance(60_000);
    await relay.drainOnce();
    rows = await outboxRows();
    expect(rows[0]!.published_at).not.toBeNull();
    expect(consumer.handled).toHaveLength(1);
  });
});

describe('platform/events — idempotent consumers', () => {
  it('S11 — the same event delivered twice performs the effect once', async () => {
    const consumer = new RecordingConsumer(uow);
    const event: DeliveredEvent = {
      id: '4242',
      name: 'probe.thing.happened',
      tenantId: 'tenant-a',
      aggregateType: 'probe',
      aggregateId: 'twice',
      payload: {},
      occurredAt: clock.now(),
    };

    await consumer.consume(event);
    await consumer.consume(event);

    expect(consumer.handled).toEqual(['4242']);
    const rows = await testDb.sql`select consumer, event_id from infra.processed_event`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.consumer).toBe('recording');
  });

  it('S12 — the effect and the processed-event record commit together', async () => {
    const consumer = new RecordingConsumer(uow);
    consumer.failTimes = 1;
    const event: DeliveredEvent = {
      id: '4343',
      name: 'probe.thing.happened',
      tenantId: 'tenant-a',
      aggregateType: 'probe',
      aggregateId: 'atomic',
      payload: {},
      occurredAt: clock.now(),
    };

    await expect(consumer.consume(event)).rejects.toThrow('handler blew up');
    const rows = await testDb.sql`select count(*)::int as n from infra.processed_event`;
    expect(rows[0]!.n).toBe(0);

    // Retried, it now runs — exactly once.
    await consumer.consume(event);
    await consumer.consume(event);
    expect(consumer.handled).toEqual(['4343']);
  });
});
