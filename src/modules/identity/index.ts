/**
 * The identity module's public surface. Other modules may import THIS file and
 * nothing else from here (enforced by lint).
 */
export { IdentityFacade } from './application/identity.facade';
export type { NewTenant } from './application/ports';
export type { AuthenticatedOperator, OperatorCode, Tenant, TenantId } from './domain/tenant';
export type { ExternalPlayerId, Player, PlayerClaims, PlayerId } from './domain/player';
