export { SpinUseCase, type SpinResult } from './application/spin.usecase';
export { GAMIFICATION_EVENT_HANDLERS, type GamificationEventHandlers } from './application/ports';
export { WheelConfigService } from './application/wheel-config.service';
export type { WheelVersion } from './application/ports';
export { totalWeight, validateSlices, weightedPick } from './domain/wheel';
export type { Prize, WheelSlice } from './domain/wheel';
