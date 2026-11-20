import { and, desc, eq, sql } from 'drizzle-orm';
import { scopedWhere } from '../../../../platform/db/scoped';
import { currentTenantId } from '../../../../platform/db/tenant-context';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';
import type { WheelRepositoryPort, WheelVersion } from '../../application/ports';
import type { WheelSlice } from '../../domain/wheel';
import { wheel, wheelVersion } from './gamification.schema';

export class WheelRepository implements WheelRepositoryPort {
  constructor(private readonly uow: UnitOfWork) {}

  async appendVersion(input: {
    wheelId: string;
    name: string;
    slices: WheelSlice[];
    createdBy: string;
  }): Promise<WheelVersion> {
    const tenantId = currentTenantId();
    await this.uow.tx
      .insert(wheel)
      .values({ tenantId, id: input.wheelId, name: input.name })
      .onConflictDoUpdate({ target: [wheel.tenantId, wheel.id], set: { name: input.name } });

    // The next version number is computed inside the transaction, and the
    // primary key is what settles a race: two concurrent writers cannot both
    // create version N.
    const [row] = await this.uow.tx
      .insert(wheelVersion)
      .values({
        tenantId,
        wheelId: input.wheelId,
        version: sql`(select coalesce(max(v.version), 0) + 1 from gamification.wheel_version v
                      where v.tenant_id = ${tenantId} and v.wheel_id = ${input.wheelId})`,
        slices: input.slices,
        createdBy: input.createdBy,
      })
      .returning();
    return toVersion(row!);
  }

  async liveVersion(wheelId: string): Promise<WheelVersion | null> {
    const rows = await this.uow.tx
      .select()
      .from(wheelVersion)
      .where(scopedWhere(wheelVersion, eq(wheelVersion.wheelId, wheelId)))
      .orderBy(desc(wheelVersion.version))
      .limit(1);
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async versionAt(wheelId: string, version: number): Promise<WheelVersion | null> {
    const rows = await this.uow.tx
      .select()
      .from(wheelVersion)
      .where(
        and(scopedWhere(wheelVersion), eq(wheelVersion.wheelId, wheelId), eq(wheelVersion.version, version)),
      )
      .limit(1);
    return rows[0] ? toVersion(rows[0]) : null;
  }
}

function toVersion(row: {
  wheelId: string;
  version: number;
  slices: unknown;
  createdBy: string;
  createdAt: Date;
}): WheelVersion {
  return {
    wheelId: row.wheelId,
    version: Number(row.version),
    slices: row.slices as WheelSlice[],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}
