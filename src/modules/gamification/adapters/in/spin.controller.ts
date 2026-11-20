import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { withTenant } from '../../../../platform/db/tenant-context';
import { NotFoundError, UnauthorizedError, UnprocessableError } from '../../../../platform/http/errors';
import { newTraceId, withRequestContext } from '../../../../platform/observability/logger';
import { IdentityFacade } from '../../../identity';
import type { SpinResult } from '../../application/spin.usecase';
import { SpinUseCase } from '../../application/spin.usecase';
import { operatorCredentials } from './operator-credentials';

/**
 * The player-facing surface.
 *
 * `POST /v1/sessions` is server-to-server: the operator presents its own
 * credentials and an external player id, and gets a short-lived token scoped to
 * that player and tenant. `POST /v1/spins` takes that token and nothing else —
 * the request body is ignored on purpose, and a test asserts that it is.
 */
@Controller('v1')
export class SpinController {
  constructor(
    private readonly identity: IdentityFacade,
    private readonly spins: SpinUseCase,
  ) {}

  @Post('sessions')
  @HttpCode(200)
  async createSession(
    @Body() body: { externalPlayerId?: string },
    @Req() req: Request,
  ): Promise<{ token: string; expiresInSeconds: number }> {
    const { keyId, secret } = operatorCredentials(req);
    const operator = await this.identity.authenticate(keyId, secret);
    if (!operator) {
      throw new UnauthorizedError('credentials.invalid', 'The operator API credentials were not accepted.');
    }
    const externalPlayerId = typeof body?.externalPlayerId === 'string' ? body.externalPlayerId.trim() : '';
    if (!externalPlayerId) {
      throw new UnprocessableError('session.invalid', 'externalPlayerId is required.');
    }

    return withTenant(operator.tenantId, async () => {
      const playerId = await this.identity.ensurePlayer(externalPlayerId);
      return { token: await this.identity.issuePlayerToken(playerId), expiresInSeconds: 3600 };
    });
  }

  @Post('spins')
  @HttpCode(200)
  async spin(@Req() req: Request): Promise<SpinResult> {
    const token = bearer(req);
    const claims = this.identity.verifyPlayerToken(token);

    return withRequestContext(
      { traceId: newTraceId(), tenantId: claims.tenantId, playerId: claims.playerId },
      async () =>
        withTenant(claims.tenantId, async () => {
          const player = await this.identity.findPlayerById(claims.playerId);
          if (!player) throw new NotFoundError('player', claims.playerId);
          return this.spins.execute(claims.playerId);
        }),
    );
  }
}

function bearer(req: Request): string {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!match) throw new UnauthorizedError('player-token.missing', 'A player token is required.');
  return match[1]!.trim();
}
