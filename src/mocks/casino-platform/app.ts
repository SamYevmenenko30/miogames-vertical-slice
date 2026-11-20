import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';

/**
 * Two simulated casino operators, with genuinely different dialects on both
 * sides — and the ability to behave badly on request, which is what the
 * reliability tests need.
 *
 * It duplicates both dialects on purpose: a mock that imported our translators
 * could not catch a translation bug (see modules/integration/AGENTS.md).
 *
 * Behaviour is chosen per request with `x-mock-behaviour`:
 *   fail          → 500
 *   delay:<ms>    → answer after <ms>
 *   garbage       → 200 with a body that is not the dialect
 *   timeout       → never answer (the caller's timeout must fire)
 * or configured for the next N calls with POST /:operator/_mock/flaky {failures}.
 *
 * It also COUNTS the reward grants it is asked for, readable at
 * GET /:operator/_mock/reward-calls. "Two workers must produce one operator call"
 * is a claim about how many times the operator was asked, and a test that does not
 * count cannot make it — which is how a redemption-issuance test came to assert
 * the final status instead, and passed with the claim's mechanism deleted.
 */
export function createCasinoMock(): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const flaky = new Map<string, number>();
  /** How many reward grants each operator has been asked for, 500s included. */
  const rewardCalls = new Map<string, number>();
  // A STICKY behaviour, for the cases a per-request header cannot reach: the
  // caller under test is the adapter, and a test cannot set headers on a call it
  // does not make.
  const sticky = new Map<string, string>();

  const behave = async (req: Request, res: Response): Promise<'handled' | 'continue'> => {
    const operator = req.path.split('/')[1] ?? '';
    const remaining = flaky.get(operator) ?? 0;
    if (remaining > 0) {
      flaky.set(operator, remaining - 1);
      res.status(500).json({ error: 'operator is having a bad day' });
      return 'handled';
    }
    const behaviour = String(req.header('x-mock-behaviour') ?? sticky.get(operator) ?? '');
    if (behaviour === 'fail') {
      res.status(500).json({ error: 'operator rejected the request' });
      return 'handled';
    }
    if (behaviour === 'timeout') return 'handled'; // deliberately never answers
    if (behaviour.startsWith('delay:')) {
      const ms = Number(behaviour.slice('delay:'.length)) || 0;
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    if (behaviour === 'garbage') {
      res.status(200).json({ unexpected: 'this is not the dialect you asked for' });
      return 'handled';
    }
    return 'continue';
  };

  app.post('/:operator/_mock/behaviour', (req, res) => {
    const behaviour = String((req.body as { behaviour?: string }).behaviour ?? 'none');
    if (behaviour === 'none') sticky.delete(req.params.operator);
    else sticky.set(req.params.operator, behaviour);
    res.status(200).json({ operator: req.params.operator, behaviour });
  });

  app.get('/:operator/_mock/reward-calls', (req, res) => {
    res.status(200).json({ operator: req.params.operator, calls: rewardCalls.get(req.params.operator) ?? 0 });
  });

  app.post('/:operator/_mock/reset', (req, res) => {
    const operator = req.params.operator;
    flaky.delete(operator);
    sticky.delete(operator);
    rewardCalls.delete(operator);
    res.status(200).json({ operator, reset: true });
  });

  app.post('/:operator/_mock/flaky', (req, res) => {
    const failures = Number((req.body as { failures?: number }).failures ?? 0);
    flaky.set(req.params.operator, failures);
    res.status(200).json({ operator: req.params.operator, failures });
  });

  // ---- operator A: flat REST, major-unit decimal strings --------------------
  app.post('/casino-a/deposits', async (req, res) => {
    if ((await behave(req, res)) === 'handled') return;
    const body = req.body as { userId?: string; amount?: string; currency?: string };
    res.status(200).json({
      event: 'deposit.completed',
      event_id: `a-${randomUUID()}`,
      user_id: body.userId ?? 'player-77',
      amount: body.amount ?? '50.00',
      currency: body.currency ?? 'EUR',
      occurred_at: new Date().toISOString(),
    });
  });

  app.post('/casino-a/rewards', async (req, res) => {
    rewardCalls.set('casino-a', (rewardCalls.get('casino-a') ?? 0) + 1);
    if ((await behave(req, res)) === 'handled') return;
    const body = req.body as { user_id?: string; reward_type?: string; reward_value?: number };
    // A real operator refuses a nonsensical grant rather than accepting it
    // politely — which is what makes a 4xx a TERMINAL failure for us: retrying
    // it can never help.
    if (!body.user_id || !body.reward_type || !(Number(body.reward_value) > 0)) {
      res.status(400).json({ error: 'user_id, reward_type and a positive reward_value are required' });
      return;
    }
    res.status(200).json({ status: 'granted', reference: `A-${randomUUID()}` });
  });

  // ---- operator B: envelope, minor units, command-style rewards -------------
  app.post('/casino-b/deposits', async (req, res) => {
    if ((await behave(req, res)) === 'handled') return;
    const body = req.body as { playerRef?: string; amountCents?: number; ccy?: string };
    res.status(200).json({
      meta: { eventId: `b-${randomUUID()}`, type: 'PLAYER_DEPOSIT', emittedAt: new Date().toISOString() },
      payload: {
        playerRef: body.playerRef ?? 'player-77',
        amountCents: body.amountCents ?? 5000,
        ccy: body.ccy ?? 'EUR',
      },
    });
  });

  app.post('/casino-b/commands', async (req, res) => {
    rewardCalls.set('casino-b', (rewardCalls.get('casino-b') ?? 0) + 1);
    if ((await behave(req, res)) === 'handled') return;
    const body = req.body as { command?: string; playerRef?: string; reward?: { kind?: string; units?: number } };
    if (body.command !== 'GRANT_REWARD' || !body.playerRef || !body.reward?.kind || !(Number(body.reward?.units) > 0)) {
      res.status(422).json({ status: 'REJECTED', reason: 'malformed command' });
      return;
    }
    res.status(200).json({ status: 'ACCEPTED', result: { commandRef: `B-${randomUUID()}` } });
  });

  // ---- operator C: nested objects, unix seconds, PUT grants with a state field
  app.post('/casino-c/deposits', async (req, res) => {
    if ((await behave(req, res)) === 'handled') return;
    const body = req.body as { ref?: string; value?: string; ccy?: string };
    res.status(200).json({
      type: 'PAYMENT_SETTLED',
      id: `c-${randomUUID()}`,
      account: { ref: body.ref ?? 'player-77' },
      money: { value: body.value ?? '50.00', ccy: body.ccy ?? 'EUR' },
      ts: Math.floor(Date.now() / 1000),
    });
  });

  app.put('/casino-c/grants', async (req, res) => {
    if ((await behave(req, res)) === 'handled') return;
    const body = req.body as { account?: string; grant?: { type?: string; qty?: number } };
    if (!body.account || !body.grant?.type || !(Number(body.grant?.qty) > 0)) {
      res.status(400).json({ state: 'REJECTED', reason: 'account and a positive grant are required' });
      return;
    }
    rewardCalls.set("casino-c", (rewardCalls.get("casino-c") ?? 0) + 1);
    res.status(200).json({ id: `C-${randomUUID()}`, state: 'OK' });
  });

  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}
