export type IngestOutcome = 'accepted' | 'duplicate' | 'invalid' | 'unsupported';

export type IngestDecision =
  | { outcome: 'accepted'; eventId: string }
  | { outcome: 'duplicate'; eventId: string }
  | { outcome: 'unsupported'; reason: string }
  | { outcome: 'invalid'; reason: string };

export type StoredEnvelope = {
  tenantId: string;
  operator: string;
  operatorEventId: string | null;
  raw: Record<string, unknown>;
  outcome: IngestOutcome;
  eventId: string | null;
  error: string | null;
};
