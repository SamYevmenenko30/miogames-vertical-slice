import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { currentTenantId } from './tenant-context';

export type TenantOwned = { tenantId: PgColumn };

/**
 * The tenant predicate for a tenant-owned table. There is deliberately no
 * un-scoped accessor: a repository method cannot be written without this, and it
 * throws rather than defaulting when no tenant is in context.
 */
export function scopedWhere(table: TenantOwned, ...extra: Array<SQL | undefined>): SQL {
  const predicate = eq(table.tenantId, currentTenantId());
  const conditions = [predicate, ...extra.filter((c): c is SQL => c !== undefined)];
  return conditions.length === 1 ? predicate : (and(...conditions) as SQL);
}
