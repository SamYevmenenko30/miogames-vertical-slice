import { z } from 'zod';

/**
 * Emitted when a spin completes. Nothing in this slice consumes it — and that is
 * the point: a new game mode (missions, PvP, a leaderboard) subscribes to this
 * instead of being wired into the deposit path or the integration layer. See
 * docs/scaling.md, Part E question 3.
 */
export const GAMIFICATION_SPIN_COMPLETED = 'gamification.spin.completed';

export const gamificationSpinCompletedSchema = z.object({
  spinId: z.string().min(1),
  playerId: z.string().min(1),
  wheelId: z.string().min(1),
  wheelVersion: z.number().int().positive(),
  sliceId: z.string().min(1),
  coinsCredited: z.number().int().nonnegative(),
  spunAt: z.string().datetime(),
});

export type GamificationSpinCompleted = z.infer<typeof gamificationSpinCompletedSchema>;
