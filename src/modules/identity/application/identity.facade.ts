import { decryptSecret, sha256Hex, verifySignature } from '../../../platform/crypto/crypto';
import type { UnitOfWork } from '../../../platform/db/unit-of-work';
import type { ExternalPlayerId, Player, PlayerClaims, PlayerId } from '../domain/player';
import type { AuthenticatedOperator, Tenant } from '../domain/tenant';
import type { NewTenant, PlayerRepositoryPort, TenantRepositoryPort } from './ports';
import type { PlayerTokenService } from './player-token.service';

/**
 * The module's public surface. Two questions, no others: who is calling, and
 * whose player is this.
 */
export class IdentityFacade {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tenants: TenantRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly tokens: PlayerTokenService,
    /** Decrypts stored signing secrets. Derived from the platform secret. */
    private readonly secretKey: Buffer = Buffer.alloc(32),
  ) {}

  /**
   * Verify an operator webhook signature.
   *
   * This lives here, and not in the ingestion module, because the signing secret
   * must not leave the module that owns credentials. Ingestion asks "is this
   * signature valid for this key id"; it never sees the key.
   */
  async verifyOperatorSignature(input: {
    keyId: string;
    payload: string;
    signature: string;
    timestamp: number;
    nowSeconds: number;
    toleranceSeconds: number;
  }): Promise<AuthenticatedOperator | null> {
    const found = await this.uow.withTransaction(async () => this.tenants.findByKeyId(input.keyId));
    if (!found || !found.active || found.tenant.status !== 'active' || !found.secretEncrypted) return null;

    let secret: string;
    try {
      secret = decryptSecret(found.secretEncrypted, this.secretKey);
    } catch {
      return null;
    }
    const ok = verifySignature({
      secret,
      payload: input.payload,
      signature: input.signature,
      timestamp: input.timestamp,
      nowSeconds: input.nowSeconds,
      toleranceSeconds: input.toleranceSeconds,
    });
    return ok ? this.tenants.authenticatedOperatorOf(found.tenant, input.keyId) : null;
  }

  /**
   * Resolve an operator's API credentials. A wrong secret, an unknown key id and a
   * deactivated key all return null: the caller must not be able to tell which,
   * or the endpoint becomes a key-id oracle.
   */
  async authenticate(keyId: string, secret: string): Promise<AuthenticatedOperator | null> {
    const found = await this.uow.withTransaction(async () => this.tenants.findByKeyId(keyId));
    if (!found || !found.active || found.tenant.status !== 'active') return null;
    if (found.secretDigest !== sha256Hex(secret)) return null;
    return this.tenants.authenticatedOperatorOf(found.tenant, keyId);
  }

  async provisionTenant(tenant: NewTenant): Promise<Tenant> {
    return this.uow.withTransaction(async () => this.tenants.provisionTenant(tenant));
  }

  async findTenantById(tenantId: string): Promise<Tenant | null> {
    return this.uow.withTransaction(async () => this.tenants.findById(tenantId));
  }

  /**
   * Provision the player on first sight. Only ever called from an authenticated
   * operator event — never from a client-supplied identifier.
   */
  async ensurePlayer(externalPlayerId: ExternalPlayerId): Promise<PlayerId> {
    return this.uow.withTransaction(async () => {
      const existing = await this.players.findByExternalId(externalPlayerId);
      if (existing) return existing.id;
      const created = await this.players.create(externalPlayerId);
      return created.id;
    });
  }

  async findPlayerByExternalId(externalPlayerId: ExternalPlayerId): Promise<Player | null> {
    return this.uow.withTransaction(async () => this.players.findByExternalId(externalPlayerId));
  }

  async findPlayerById(playerId: PlayerId): Promise<Player | null> {
    return this.uow.withTransaction(async () => this.players.findById(playerId));
  }

  async issuePlayerToken(playerId: PlayerId): Promise<string> {
    const player = await this.findPlayerById(playerId);
    if (!player) throw new Error(`no such player in this tenant: ${playerId}`);
    return this.tokens.issue({ tenantId: player.tenantId, playerId: player.id });
  }

  verifyPlayerToken(token: string): PlayerClaims {
    return this.tokens.verify(token);
  }
}
