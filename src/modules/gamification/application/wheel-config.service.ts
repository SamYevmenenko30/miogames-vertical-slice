import type { AuditLog } from '../../../platform/audit/audit-log';
import type { UnitOfWork } from '../../../platform/db/unit-of-work';
import { NotFoundError, UnprocessableError } from '../../../platform/http/errors';
import { validateSlices } from '../domain/wheel';
import type { WheelRepositoryPort, WheelVersion } from './ports';

export class WheelConfigService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly wheels: WheelRepositoryPort,
    private readonly audit: AuditLog,
  ) {}

  async createVersion(input: {
    tenantId: string;
    wheelId: string;
    name: string;
    slices: unknown;
    actor: string;
  }): Promise<WheelVersion> {
    let slices;
    try {
      slices = validateSlices(input.slices);
    } catch (error) {
      throw new UnprocessableError('wheel.invalid-configuration', (error as Error).message);
    }

    return this.uow.withTransaction(async () => {
      const version = await this.wheels.appendVersion({
        wheelId: input.wheelId,
        name: input.name,
        slices,
        createdBy: input.actor,
      });
      // In the same transaction: a configuration change that is not audited did
      // not happen.
      await this.audit.record({
        tenantId: input.tenantId,
        actor: input.actor,
        action: 'wheel.version.created',
        subjectType: 'wheel',
        subjectId: input.wheelId,
        data: { version: version.version, slices },
      });
      return version;
    });
  }

  async read(wheelId: string, version?: number): Promise<WheelVersion> {
    const found = await this.uow.withTransaction(async () =>
      version === undefined ? this.wheels.liveVersion(wheelId) : this.wheels.versionAt(wheelId, version),
    );
    // 404, never 403: another tenant's wheel id must not be confirmed to exist.
    if (!found) throw new NotFoundError('wheel', version === undefined ? wheelId : `${wheelId}@${version}`);
    return found;
  }
}
