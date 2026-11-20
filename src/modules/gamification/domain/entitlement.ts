export type EntitlementState = 'granted' | 'consumed' | 'expired';

export type SpinEntitlement = {
  id: string;
  tenantId: string;
  playerId: string;
  wheelId: string;
  wheelVersion: number;
  ruleId: string;
  state: EntitlementState;
  /** Revealed only after the spin (ADR-0004). */
  serverSeed: string;
  seedHash: string;
  grantedAt: Date;
  expiresAt: Date;
};

export function expiryFrom(grantedAt: Date, ttlHours: number): Date {
  return new Date(grantedAt.getTime() + ttlHours * 3600 * 1000);
}
