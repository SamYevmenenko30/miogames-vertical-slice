import type { WheelSlice } from '../domain/wheel';

export type WheelVersion = {
  wheelId: string;
  version: number;
  slices: WheelSlice[];
  createdBy: string;
  createdAt: Date;
};

export interface WheelRepositoryPort {
  /** Creates the wheel if absent and appends a new version. Returns the version. */
  appendVersion(input: { wheelId: string; name: string; slices: WheelSlice[]; createdBy: string }): Promise<WheelVersion>;
  liveVersion(wheelId: string): Promise<WheelVersion | null>;
  versionAt(wheelId: string, version: number): Promise<WheelVersion | null>;
}

export type NewEntitlement = {
  id: string;
  playerId: string;
  wheelId: string;
  wheelVersion: number;
  ruleId: string;
  serverSeed: string;
  seedHash: string;
  sourceEventId: string;
  grantedAt: Date;
  expiresAt: Date;
};

export interface RewardRuleRepositoryPort {
  activeRules(): Promise<import('../domain/reward-rule').RewardRule[]>;
}

export interface EntitlementRepositoryPort {
  grant(entitlements: NewEntitlement[]): Promise<void>;
}
