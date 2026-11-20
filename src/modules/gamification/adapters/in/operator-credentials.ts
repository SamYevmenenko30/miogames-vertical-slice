import type { Request } from 'express';
import { UnauthorizedError } from '../../../../platform/http/errors';

/**
 * `Authorization: Bearer <keyId>.<secret>` — the operator's own API credentials.
 *
 * There are no roles yet (TD-0006): any holder of a tenant's credentials can
 * change that tenant's odds, and the audit log names the key id used so the
 * change is attributable. A malformed header fails the same way a wrong secret
 * does.
 */
export function operatorCredentials(req: Request): { keyId: string; secret: string } {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+([^.\s]+)\.(.+)$/.exec(header.trim());
  if (!match) {
    throw new UnauthorizedError(
      'credentials.invalid',
      'Provide Authorization: Bearer <keyId>.<secret> with the operator API credentials.',
    );
  }
  return { keyId: match[1]!, secret: match[2]! };
}
