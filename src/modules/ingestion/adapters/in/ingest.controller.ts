import { Controller, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../../../../platform/config/config';
import { CLOCK, type Clock } from '../../../../platform/clock/clock';
import { withTenant } from '../../../../platform/db/tenant-context';
import { BadRequestError, UnauthorizedError, UnprocessableError } from '../../../../platform/http/errors';
import { LOGGER, withRequestContext, newTraceId, type Logger } from '../../../../platform/observability/logger';
import { IdentityFacade } from '../../../identity';
import { IngestionFacade } from '../../application/ingestion.facade';

/**
 * The operator webhook.
 *
 * Authentication is an HMAC over `${timestamp}.${rawBody}`, verified by the
 * identity module (the signing secret must not leave the module that owns
 * credentials). A wrong secret, an unknown key id and a stale timestamp all
 * answer the same 401: distinguishing them would make this a key-id oracle.
 */
@Controller('v1/ingest')
export class IngestController {
  constructor(
    private readonly identity: IdentityFacade,
    private readonly ingestion: IngestionFacade,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Post(':operator/events')
  async ingest(@Param('operator') operator: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const rawBody = typeof req.body === 'string' ? req.body : '';
    const keyId = header(req, 'x-mio-key-id');
    const signature = header(req, 'x-mio-signature');
    const timestamp = Number(header(req, 'x-mio-timestamp'));

    const unauthenticated = new UnauthorizedError(
      'signature.invalid',
      'The request could not be authenticated. Check the key id, the signature and the timestamp.',
    );
    if (!keyId || !signature || !Number.isFinite(timestamp)) {
      this.logger.warn({ keyId, operator, ip: req.ip }, 'ingest rejected: missing signature headers');
      throw unauthenticated;
    }

    const authenticated = await this.identity.verifyOperatorSignature({
      keyId,
      payload: rawBody,
      signature,
      timestamp,
      nowSeconds: Math.floor(this.clock.now().getTime() / 1000),
      toleranceSeconds: this.config.hmacToleranceSeconds,
    });
    if (!authenticated) {
      // Logged with the key id presented and the source, which is where a
      // brute-force pattern is visible. Not stored as an envelope: that table is
      // tenant-owned and we have no tenant (MIO-004 Q2).
      this.logger.warn({ keyId, operator, ip: req.ip }, 'ingest rejected: signature did not verify');
      throw unauthenticated;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new BadRequestError('payload.not-json', 'The request body is not valid JSON.');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BadRequestError('payload.not-object', 'The request body must be a JSON object.');
    }

    await withRequestContext(
      { traceId: newTraceId(), tenantId: authenticated.tenantId, operator: authenticated.operator },
      async () => {
        const decision = await withTenant(authenticated.tenantId, async () =>
          this.ingestion.ingestDepositEvent({
            tenantId: authenticated.tenantId,
            operator: authenticated.operator,
            raw: parsed as Record<string, unknown>,
          }),
        );

        switch (decision.outcome) {
          case 'accepted':
            res.status(202).json({ status: 'accepted', eventId: decision.eventId });
            return;
          case 'duplicate':
            // 200, not 202: nothing new was accepted. The first event id comes
            // back so a retrying operator can reconcile.
            res.status(200).json({ status: 'duplicate', eventId: decision.eventId });
            return;
          case 'unsupported':
            // Acknowledged. An operator must not have to tell our feature set
            // apart from an error.
            res.status(202).json({ status: 'ignored', reason: decision.reason });
            return;
          case 'invalid':
            throw new UnprocessableError('payload.invalid', decision.reason);
        }
      },
    );
  }
}

function header(req: Request, name: string): string {
  const value = req.header(name);
  return typeof value === 'string' ? value.trim() : '';
}
