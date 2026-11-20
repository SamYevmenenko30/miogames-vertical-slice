import type { Clock } from '../../../platform/clock/clock';
import { hmacHex } from '../../../platform/crypto/crypto';
import { UnauthorizedError } from '../../../platform/http/errors';
import type { PlayerClaims } from '../domain/player';

type TokenBody = { t: string; p: string; exp: number };

/**
 * The player API is reached with a short-lived token the operator exchanges for,
 * server to server, using its API credentials.
 *
 * Signed with the PLATFORM secret, not the tenant's (MIO-002 Q2): rotating an
 * operator's API credentials must not log its players out. The tenant id is inside
 * the signed payload, so a rotated or stolen key cannot mint tokens for someone
 * else's tenant.
 */
export class PlayerTokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
    private readonly clock: Clock,
  ) {}

  issue(claims: PlayerClaims): string {
    const body: TokenBody = {
      t: claims.tenantId,
      p: claims.playerId,
      exp: Math.floor(this.clock.now().getTime() / 1000) + this.ttlSeconds,
    };
    const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
    return `${encoded}.${hmacHex(this.secret, encoded)}`;
  }

  verify(token: string): PlayerClaims {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new UnauthorizedError('player-token.malformed', 'The player token is not a valid token.');
    }
    const [encoded, signature] = parts as [string, string];

    // Signature first: nothing is parsed from an unverified body.
    const expected = hmacHex(this.secret, encoded);
    if (expected.length !== signature.length || !timingSafeStringEqual(expected, signature)) {
      throw new UnauthorizedError('player-token.signature', 'The player token signature did not verify.');
    }

    let body: TokenBody;
    try {
      body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenBody;
    } catch {
      throw new UnauthorizedError('player-token.malformed', 'The player token payload is not readable.');
    }
    if (typeof body?.t !== 'string' || typeof body?.p !== 'string' || typeof body?.exp !== 'number') {
      throw new UnauthorizedError('player-token.malformed', 'The player token payload is incomplete.');
    }
    if (body.exp * 1000 <= this.clock.now().getTime()) {
      throw new UnauthorizedError('player-token.expired', 'The player token has expired.');
    }
    return { tenantId: body.t, playerId: body.p };
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
