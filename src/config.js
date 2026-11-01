import { AppError } from './errors.js';

const REQUIRED = [
  'SHOP_DOMAIN',
  'SHOPIFY_CLIENT_ID',
  'SHOPIFY_CLIENT_SECRET',
  'STATUS_API_BASE',
  'STATUS_API_KEY',
];

const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// Non-throwing variant for the health endpoint: reports the names of missing
// required vars so a bad deploy is diagnosable without reading the logs.
export const checkConfig = (env = process.env) => ({
  ok: REQUIRED.every((key) => Boolean(env[key])),
  missing: REQUIRED.filter((key) => !env[key]),
  optional: { ADMIN_API_KEY: Boolean(env.ADMIN_API_KEY) },
});

export function getConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    // Log names only, never values.
    console.error(`[config] missing env vars: ${missing.join(', ')}`);
    throw new AppError('CONFIG_ERROR', 500, 'Middleware is not configured');
  }

  return {
    shopDomain: env.SHOP_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    shopifyClientId: env.SHOPIFY_CLIENT_ID,
    shopifyClientSecret: env.SHOPIFY_CLIENT_SECRET,
    shopifyApiVersion: env.SHOPIFY_API_VERSION || '2026-10',
    statusApiBase: env.STATUS_API_BASE.replace(/\/+$/, ''),
    statusApiKey: env.STATUS_API_KEY,
    // Optional on purpose: only the admin order-details endpoint needs it, and a
    // missing key must fail that endpoint closed rather than break /api/track.
    adminApiKey: env.ADMIN_API_KEY || null,
    shopifyTimeoutMs: positiveInt(env.SHOPIFY_TIMEOUT_MS, 5000),
    statusTimeoutMs: positiveInt(env.STATUS_TIMEOUT_MS, 7000),
  };
}
