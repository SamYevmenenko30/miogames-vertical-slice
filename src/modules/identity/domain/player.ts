export type PlayerId = string;

export type Player = {
  id: PlayerId;
  tenantId: string;
};

/** The operator's own identifier for the player, unique within a tenant. */
export type ExternalPlayerId = string;

export type PlayerClaims = {
  tenantId: string;
  playerId: PlayerId;
};
