import type { AuthenticatedOperator, Tenant } from '../domain/tenant';
import type { ExternalPlayerId, Player, PlayerId } from '../domain/player';

export type NewTenant = {
  id: string;
  name: string;
  operator: string;
  keyId: string;
  secret: string;
};

export interface TenantRepositoryPort {
  /** Create a tenant with its first API key. Used by the seed and by onboarding. */
  provisionTenant(tenant: NewTenant): Promise<Tenant>;
  findByKeyId(
    keyId: string,
  ): Promise<{ tenant: Tenant; secretDigest: string; secretEncrypted: string | null; active: boolean } | null>;
  deactivateKey(keyId: string): Promise<void>;
  findById(tenantId: string): Promise<Tenant | null>;
  authenticatedOperatorOf(tenant: Tenant, keyId: string): AuthenticatedOperator;
}

export interface PlayerRepositoryPort {
  /** Scoped to the tenant in context. Creates nothing. */
  findByExternalId(externalPlayerId: ExternalPlayerId): Promise<Player | null>;
  findById(playerId: PlayerId): Promise<Player | null>;
  /** Creates the player and its identity row; the unique constraint settles races. */
  create(externalPlayerId: ExternalPlayerId): Promise<Player>;
  /** The operator's own id for this player, for an outbound call. */
  externalIdOf(playerId: PlayerId): Promise<ExternalPlayerId | null>;
}
