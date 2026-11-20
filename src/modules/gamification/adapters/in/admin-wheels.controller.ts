import { Body, Controller, Get, HttpCode, Param, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { withTenant } from '../../../../platform/db/tenant-context';
import { UnauthorizedError, UnprocessableError } from '../../../../platform/http/errors';
import { newTraceId, withRequestContext } from '../../../../platform/observability/logger';
import { IdentityFacade } from '../../../identity';
import { WheelConfigService } from '../../application/wheel-config.service';
import { operatorCredentials } from './operator-credentials';

/**
 * Admin is an inbound ADAPTER on the module that owns the data, not a module of
 * its own. An `admin` module would need read-write access to every other
 * module's tables, which is how a god-module is born (architecture/README §2).
 */
@Controller('v1/admin/wheels')
export class AdminWheelsController {
  constructor(
    private readonly identity: IdentityFacade,
    private readonly wheels: WheelConfigService,
  ) {}

  @Put(':wheelId')
  @HttpCode(201)
  async upsert(
    @Param('wheelId') wheelId: string,
    @Body() body: { name?: string; slices?: unknown },
    @Req() req: Request,
  ): Promise<{ wheelId: string; version: number }> {
    const operator = await this.authenticate(req);
    if (body?.slices === undefined) {
      throw new UnprocessableError('wheel.invalid-configuration', 'slices are required');
    }
    return withRequestContext({ traceId: newTraceId(), tenantId: operator.tenantId }, async () =>
      withTenant(operator.tenantId, async () => {
        const version = await this.wheels.createVersion({
          tenantId: operator.tenantId,
          wheelId,
          name: typeof body.name === 'string' && body.name.trim() ? body.name : wheelId,
          slices: body.slices,
          actor: `admin:${operator.keyId}`,
        });
        return { wheelId, version: version.version };
      }),
    );
  }

  @Get(':wheelId')
  async read(
    @Param('wheelId') wheelId: string,
    @Query('version') version: string | undefined,
    @Req() req: Request,
  ): Promise<{ wheelId: string; version: number; slices: unknown; createdBy: string }> {
    const operator = await this.authenticate(req);
    const asked = version === undefined ? undefined : Number(version);
    if (asked !== undefined && !Number.isInteger(asked)) {
      throw new UnprocessableError('wheel.invalid-version', 'version must be an integer');
    }
    return withTenant(operator.tenantId, async () => {
      const found = await this.wheels.read(wheelId, asked);
      return { wheelId: found.wheelId, version: found.version, slices: found.slices, createdBy: found.createdBy };
    });
  }

  private async authenticate(req: Request): Promise<{ tenantId: string; keyId: string }> {
    const { keyId, secret } = operatorCredentials(req);
    const operator = await this.identity.authenticate(keyId, secret);
    if (!operator) {
      throw new UnauthorizedError('credentials.invalid', 'The operator API credentials were not accepted.');
    }
    return { tenantId: operator.tenantId, keyId: operator.keyId };
  }
}
