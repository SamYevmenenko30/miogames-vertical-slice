import { z } from 'zod';

export const REWARDS_REDEMPTION_REQUESTED = 'rewards.redemption.requested';
export const REWARDS_REDEMPTION_ISSUED = 'rewards.redemption.issued';
export const REWARDS_REDEMPTION_FAILED = 'rewards.redemption.failed';

export const rewardPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('free_spins'), count: z.number().int().positive() }),
  z.object({
    kind: z.literal('bonus_cash'),
    amountMinor: z.number().int().positive(),
    currency: z.string().length(3),
  }),
]);

export const rewardsRedemptionRequestedSchema = z.object({
  redemptionId: z.string().min(1),
  playerId: z.string().min(1),
  itemId: z.string().min(1),
  reward: rewardPayloadSchema,
  requestedAt: z.string().datetime(),
});

export const rewardsRedemptionIssuedSchema = z.object({
  redemptionId: z.string().min(1),
  externalRef: z.string().min(1),
  issuedAt: z.string().datetime(),
});

export const rewardsRedemptionFailedSchema = z.object({
  redemptionId: z.string().min(1),
  attempts: z.number().int().nonnegative(),
  reason: z.string().min(1),
  refundedCoins: z.number().int().nonnegative(),
  failedAt: z.string().datetime(),
});

export type RewardsRedemptionRequested = z.infer<typeof rewardsRedemptionRequestedSchema>;
export type RewardsRedemptionIssued = z.infer<typeof rewardsRedemptionIssuedSchema>;
export type RewardsRedemptionFailed = z.infer<typeof rewardsRedemptionFailedSchema>;
