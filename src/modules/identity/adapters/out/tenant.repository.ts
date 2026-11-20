import { eq } from 'drizzle-orm';
import { encryptSecret, sha256Hex } from '../../../../platform/crypto/crypto';
import type { UnitOfWork } from '../../../../platform/db/unit-of-work';

import type { NewTenant, TenantRepositoryPort } from '../../application/ports';
import type { AuthenticatedOperator, Tenant } from '../../domain/tenant';
import { tenant, tenantApiKey } from './identity.schema';

/**
 * Tenants are the partition root, so this repository is deliberately NOT
 * tenant-scoped: resolving "which tenant is this key" is the step that
 * establishes the tenant in the first place.
 */
export class TenantRepository implements TenantRepositoryPort {
  constructor(
    private readonly uow: UnitOfWork,
    /** Derived from the platform secret; see platform/crypto.deriveKey. */
    private readonly encryptionKey: Buffer = Buffer.alloc(32),
  ) {}

  async provisionTenant(input: NewTenant): Promise<Tenant> {
    const [row] = await this.uow.tx
      .insert(tenant)
      .values({ id: input.id, name: input.name, operator: input.operator })
      .onConflictDoUpdate({ target: tenant.id, set: { name: input.name, operator: input.operator } })
      .returning();
    await this.uow.tx
      .insert(tenantApiKey)
      .values({
        keyId: input.keyId,
        tenantId: input.id,
        secretDigest: sha256Hex(input.secret),
        secretEncrypted: encryptSecret(input.secret, this.encryptionKey),
        active: true,
      })
      .onConflictDoUpdate({
        target: tenantApiKey.keyId,
        set: {
          secretDigest: sha256Hex(input.secret),
          secretEncrypted: encryptSecret(input.secret, this.encryptionKey),
          active: true,
        },
      });
    return toTenant(row!);
  }

  async findByKeyId(
    keyId: string,
  ): Promise<{ tenant: Tenant; secretDigest: string; secretEncrypted: string | null; active: boolean } | null> {
    const rows = await this.uow.tx
      .select({ tenant, key: tenantApiKey })
      .from(tenantApiKey)
      .innerJoin(tenant, eq(tenant.id, tenantApiKey.tenantId))
      .where(eq(tenantApiKey.keyId, keyId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      tenant: toTenant(row.tenant),
      secretDigest: row.key.secretDigest,
      secretEncrypted: row.key.secretEncrypted,
      active: row.key.active,
    };
  }

  async deactivateKey(keyId: string): Promise<void> {
    await this.uow.tx.update(tenantApiKey).set({ active: false }).where(eq(tenantApiKey.keyId, keyId));
  }

  async findById(tenantId: string): Promise<Tenant | null> {
    const rows = await this.uow.tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1);
    return rows[0] ? toTenant(rows[0]) : null;
  }

  authenticatedOperatorOf(found: Tenant, keyId: string): AuthenticatedOperator {
    return { tenantId: found.id, operator: found.operator, keyId };
  }
}

function toTenant(row: { id: string; name: string; operator: string; status: string }): Tenant {
  return {
    id: row.id,
    name: row.name,
    operator: row.operator,
    status: row.status === 'suspended' ? 'suspended' : 'active',
  };
}
