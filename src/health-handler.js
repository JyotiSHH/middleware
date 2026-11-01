import { checkConfig } from './config.js';
import { AppError } from './errors.js';
import { SERVICE, VERSION } from './routes.js';

// Platform-agnostic core for the index route: GET / (and GET /api).
// A health check, not a service directory. It makes no upstream call, so an
// uptime monitor can poll it as often as it likes for free, and it needs no key
// so a broken deploy stays diagnosable before anything else works.
const defaultDeps = { checkConfig };

const json = (status, body, extraHeaders) => ({
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  },
  body,
});

export function handleHealth(req, deps = defaultDeps) {
  if (req.method !== 'GET') {
    const err = new AppError('METHOD_NOT_ALLOWED', 405, 'Use GET');
    return json(405, { ok: false, error: err.toJSON() }, { Allow: 'GET' });
  }

  const config = deps.checkConfig();
  const body = {
    ok: config.ok,
    status: config.ok ? 'ok' : 'unhealthy',
    service: SERVICE,
    version: VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    // Names only, never values: enough to fix a bad deploy, nothing more.
    checks: config.ok
      ? { config: { ok: true, adminApiKey: config.optional.ADMIN_API_KEY } }
      : { config: { ok: false, missing: config.missing } },
  };

  // 503 so an uptime monitor treats a misconfigured deploy as down.
  return json(config.ok ? 200 : 503, body);
}
