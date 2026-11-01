// Admin key check for the order-details endpoint. Unlike /api/track, this one
// returns the full order (money breakdown, fulfillments, SKUs), so it is never
// open to the storefront: callers must present the shared ADMIN_API_KEY.
import { timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

// Compares without leaking the key length or a matching prefix through timing.
function keysMatch(provided, expected) {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireAdminKey(cfg, provided) {
  if (!cfg.adminApiKey) {
    // Fail closed: an unset key must never mean "let everyone in".
    console.error('[auth] ADMIN_API_KEY is not set; order-details endpoint is disabled');
    throw new AppError('CONFIG_ERROR', 500, 'Admin API key is not configured');
  }
  if (typeof provided !== 'string' || !keysMatch(provided, cfg.adminApiKey)) {
    throw new AppError('UNAUTHORIZED', 401, 'Missing or invalid x-api-key');
  }
}
