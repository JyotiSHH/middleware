import { requireAdminKey } from './auth.js';
import { getConfig } from './config.js';
import { AppError } from './errors.js';
import { buildOrder } from './merge.js';
import { parseListParams } from './order-list.js';
import { listOrders } from './shopify.js';

// Platform-agnostic core for GET /api/orders.
// Takes { method, url, apiKey } and returns { status, headers, body }.
const defaultDeps = { getConfig, listOrders };

// No CORS headers, same reason as the single-order endpoint: the admin key must
// never be shipped to a browser, so this is server-to-server only.
const json = (status, body, extraHeaders) => ({
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  },
  body,
});

function errorResponse(err) {
  if (err instanceof AppError) {
    return json(err.status, { ok: false, error: err.toJSON() });
  }
  console.error('[order-list] unexpected error:', err);
  const error = new AppError('INTERNAL_ERROR', 500, 'Unexpected server error');
  return json(500, { ok: false, error: error.toJSON() });
}

export async function handleOrderList(req, deps = defaultDeps) {
  let cfg;
  try {
    cfg = deps.getConfig();
  } catch (err) {
    return errorResponse(err);
  }

  try {
    if (req.method !== 'GET') {
      const err = new AppError('METHOD_NOT_ALLOWED', 405, 'Use GET');
      return json(405, { ok: false, error: err.toJSON() }, { Allow: 'GET' });
    }
    requireAdminKey(cfg, req.apiKey);

    const { searchParams } = new URL(req.url, 'http://localhost');
    const params = parseListParams(searchParams);

    const { nodes, pageInfo } = await deps.listOrders(cfg, params);
    // Shipment data is deliberately absent: it would mean one Status API call
    // per order, against a 30 req/min key. Use /api/orders/:orderNumber for that.
    const orders = nodes.filter((node) => node?.name).map(buildOrder);

    return json(200, {
      ok: true,
      orders,
      pageInfo: {
        hasNextPage: Boolean(pageInfo.hasNextPage),
        endCursor: pageInfo.endCursor ?? null,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
