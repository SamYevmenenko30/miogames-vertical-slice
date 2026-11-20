import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The tenant is resolved once per request and carried in context, not passed as
 * a parameter through fourteen call sites. ADR-0006: the realistic leak is a
 * forgotten argument, so the correct thing has to be the only thing available.
 */
const store = new AsyncLocalStorage<string>();

export function withTenant<T>(tenantId: string, fn: () => T): T {
  if (!tenantId) throw new Error('withTenant requires a tenant id');
  return store.run(tenantId, fn);
}

export function currentTenantId(): string {
  const tenantId = store.getStore();
  if (!tenantId) {
    throw new Error(
      'No tenant in context. Every tenant-owned query runs inside withTenant(...) — see ADR-0006.',
    );
  }
  return tenantId;
}

export function currentTenantIdOrNull(): string | null {
  return store.getStore() ?? null;
}
