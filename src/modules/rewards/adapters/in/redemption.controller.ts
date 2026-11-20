import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { withTenant } from '../../../../platform/db/tenant-context';
import { BadRequestError, NotFoundError, UnauthorizedError, UnprocessableError } from '../../../../platform/http/errors';
import { newTraceId, withRequestContext } from '../../../../platform/observability/logger';
import { IdentityFacade } from '../../../identity';
// Value imports, not type imports: Nest reads the constructor's design-time
// metadata to resolve these, and `import type` erases it (the error reads
// "argument at index [1] is available" with no name, which is the tell).
import { RedeemUseCase } from '../../application/redeem.usecase';
import { RewardsFacade } from '../../application/rewards.facade';
import { validateStoreItem } from '../../domain/redemption';

@Controller('v1')
export class RedemptionController {
  constructor(
    private readonly identity: IdentityFacade,
    private readonly redeem: RedeemUseCase,
    private readonly rewards: RewardsFacade,
  ) {}

  @Put('admin/store-items/:itemId')
  @HttpCode(201)
  async upsertItem(
    @Param('itemId') itemId: string,
    @Body() body: { name?: unknown; price?: unknown; reward?: unknown },
    @Req() req: Request,
  ): Promise<{ itemId: string }> {
    const operator = await this.operator(req);
    let validated;
    try {
      validated = validateStoreItem(body ?? {});
    } catch (error) {
      throw new UnprocessableError('store-item.invalid', (error as Error).message);
    }
    return withTenant(operator.tenantId, async () => {
      await this.rewards.upsertStoreItem({ itemId, ...validated });
      return { itemId };
    });
  }

  @Get('store-items')
  async listItems(@Req() req: Request): Promise<{ items: unknown[] }> {
    const claims = this.identity.verifyPlayerToken(playerToken(req));
    return withTenant(claims.tenantId, async () => ({ items: await this.rewards.listStoreItems() }));
  }

  @Post('redemptions')
  async create(
    @Body() body: { itemId?: string },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const claims = this.identity.verifyPlayerToken(playerToken(req));
    const idempotencyKey = (req.header('idempotency-key') ?? '').trim();
    if (!idempotencyKey) {
      // Refused, not accepted hopefully: a redemption we cannot make safe to
      // retry is a redemption we should not take.
      throw new BadRequestError(
        'idempotency-key.required',
        'POST /v1/redemptions requires an Idempotency-Key header.',
      );
    }
    const itemId = typeof body?.itemId === 'string' ? body.itemId.trim() : '';
    if (!itemId) throw new UnprocessableError('redemption.invalid', 'itemId is required.');

    await withRequestContext(
      { traceId: newTraceId(), tenantId: claims.tenantId, playerId: claims.playerId },
      async () => {
        const { redemption, created } = await withTenant(claims.tenantId, async () =>
          this.redeem.execute({
            tenantId: claims.tenantId,
            playerId: claims.playerId,
            itemId,
            idempotencyKey,
          }),
        );
        res.status(created ? 202 : 200).json({
          redemptionId: redemption.id,
          status: redemption.status,
          itemId: redemption.itemId,
          price: redemption.price,
        });
      },
    );
  }

  @Get('redemptions/:id')
  async status(@Param('id') id: string, @Req() req: Request): Promise<unknown> {
    const claims = this.identity.verifyPlayerToken(playerToken(req));
    return withTenant(claims.tenantId, async () => {
      const found = await this.rewards.redemptionForPlayer(id, claims.playerId);
      // 404 for another player's or another tenant's redemption: a 403 would
      // confirm the id exists.
      if (!found) throw new NotFoundError('redemption', id);
      return {
        redemptionId: found.id,
        status: found.status,
        itemId: found.itemId,
        price: found.price,
        reward: found.reward,
        attempts: found.attempts,
        lastError: found.lastError,
        externalRef: found.externalRef,
        // How many times a worker has asked the operator to grant this reward,
        // and when it last did. Two on an `issued` redemption means a worker died
        // mid-issuance and the lease recovered it — the reward may have been
        // granted twice on the operator's side, and this is where anyone looking
        // for that finds it (TD-0011).
        grantRequests: found.grantRequests,
        grantRequestedAt: found.grantRequestedAt,
        createdAt: found.createdAt,
        updatedAt: found.updatedAt,
      };
    });
  }

  private async operator(req: Request): Promise<{ tenantId: string; keyId: string }> {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+([^.\s]+)\.(.+)$/.exec(header.trim());
    if (!match) {
      throw new UnauthorizedError('credentials.invalid', 'Operator API credentials are required.');
    }
    const operator = await this.identity.authenticate(match[1]!, match[2]!);
    if (!operator) throw new UnauthorizedError('credentials.invalid', 'The credentials were not accepted.');
    return { tenantId: operator.tenantId, keyId: operator.keyId };
  }
}

function playerToken(req: Request): string {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!match) throw new UnauthorizedError('player-token.missing', 'A player token is required.');
  return match[1]!.trim();
}
