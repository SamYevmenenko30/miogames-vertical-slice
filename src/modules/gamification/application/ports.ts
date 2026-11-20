import type { SpinEntitlement } from '../domain/entitlement';
import type { RewardRule } from '../domain/reward-rule';
import type { Prize, WheelSlice } from '../domain/wheel';

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
  activeRules(): Promise<RewardRule[]>;
}


export type RecordedSpin = {
  id: string;
  playerId: string;
  entitlementId: string;
  wheelId: string;
  wheelVersion: number;
  serverSeed: string;
  seedHash: string;
  sliceId: string;
  prize: Prize;
  coinsCredited: number;
  spunAt: Date;
};

export interface SpinRepositoryPort {
  record(spin: RecordedSpin): Promise<void>;
}

export interface EntitlementRepositoryPort {
  grant(entitlements: NewEntitlement[]): Promise<void>;
  claimOne(playerId: string, now: Date): Promise<SpinEntitlement | null>;
  countClaimable(playerId: string, now: Date): Promise<number>;
  expireDue(now: Date): Promise<number>;
}
