import type { NextFunction, Request, Response } from 'express';
import { newTraceId, withRequestContext } from './logger';

/**
 * One trace id per request, returned to the caller.
 *
 * Returned on purpose: a support conversation that starts with an identifier is
 * a different conversation from one that starts with "around half past four".
 * The id is NOT accepted from the caller (MIO-012 Q1) — that is how two
 * requests' logs get collided, deliberately or otherwise. Inbound tracing
 * arrives as validated `traceparent`, which is another ticket.
 */
export function requestContext() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const traceId = newTraceId();
    res.setHeader('x-trace-id', traceId);
    withRequestContext({ traceId }, () => next());
  };
}
