import express, { type RequestHandler } from 'express';

/**
 * The ingest endpoint verifies an HMAC over the RAW body, byte for byte, so it
 * must not be handed a re-serialised object: `JSON.stringify(JSON.parse(x))` is
 * not `x`. Those routes get the body as text and parse it themselves, which also
 * lets a non-JSON body come back as problem+json instead of body-parser's own
 * error page.
 */
const RAW_PREFIXES = ['/v1/ingest'];

export function rawBodyJson(): RequestHandler {
  const text = express.text({ type: '*/*', limit: '1mb' });
  const json = express.json({ limit: '1mb' });
  return (req, res, next) =>
    RAW_PREFIXES.some((prefix) => req.path.startsWith(prefix)) ? text(req, res, next) : json(req, res, next);
}
