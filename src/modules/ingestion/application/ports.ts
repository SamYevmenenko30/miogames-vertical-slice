import type { StoredEnvelope } from '../domain/envelope';

export interface EnvelopeRepositoryPort {
  store(envelope: StoredEnvelope): Promise<void>;
}

export interface DedupRepositoryPort {
  /**
   * Claim an operator event id for this tenant. Returns the event id that WON —
   * ours when we claimed it, theirs when someone else already had.
   */
  claim(operatorEventId: string, eventId: string): Promise<{ eventId: string; claimed: boolean }>;
}
