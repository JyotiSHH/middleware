import { requireAdminKey } from './auth.js';
import { getConfig } from './config.js';
import { AppError } from './errors.js';
import { buildShipment, cancelledShipment } from './merge.js';
import { buildOrderDetails } from './order-details.js';
import { fetchShipment } from './status-api.js';
import { lookupOrderDetails } from './shopify.js';
import { parseOrderNumber } from './validate.js';

// Platform-agnostic core for GET /api/orders/:orderNumber.
// Takes { method, url, apiKey } and returns { status, headers, body }.
// Dependencies are injectable for tests, like handleTrack.
const defaultDeps = { getConfig, lookupOrderDetails, fetchShipment };

// No CORS headers on purpose: this endpoint is authenticated with a shared key,
// which must never be shipped to a browser. Only server-to-server callers.
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
  console.error('[order-details] unexpected error:', err);
  const error = new AppError('INTERNAL_ERROR', 500, 'Unexpected server error');
  return json(500, { ok: false, error: error.toJSON() });
}

// "/api/orders/1001" -> "1001". The trailing segment is the only source, so a
// bare "/api/orders" is rejected rather than silently listing anything.
const orderSegment = (url) => {
  const { pathname } = new URL(url, 'http://localhost');
  return decodeURIComponent(pathname.replace(/\/+$/, '').split('/').pop() ?? '');
};

export async function handleOrderDetails(req, deps = defaultDeps) {
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
    // Auth first: an unauthenticated caller must not be able to tell a real
    // order number from a missing one by comparing 404s against 401s.
    requireAdminKey(cfg, req.apiKey);

    const orderNumber = parseOrderNumber(orderSegment(req.url));
    if (!orderNumber) {
      throw new AppError('INVALID_ORDER_NUMBER', 400, 'Use digits only, optionally starting with #');
    }

    const shopifyOrder = await deps.lookupOrderDetails(cfg, orderNumber);
    if (!shopifyOrder) {
      throw new AppError('ORDER_NOT_FOUND', 404, `No order #${orderNumber}`);
    }
    const order = buildOrderDetails(shopifyOrder);

    // Same conflict rule as /api/track: Shopify owns the order lifecycle, so a
    // cancelled order shows cancelled and skips the Status API call entirely.
    if (order.cancelledAt) {
      return json(200, {
        ok: true,
        order,
        shipment: cancelledShipment(order),
        shipmentError: null,
        statusSource: 'shopify',
      });
    }

    const result = await deps.fetchShipment(cfg, orderNumber);
    const shipment = buildShipment(result.shipment);
    const shipmentError =
      result.error ??
      (shipment ? null : { code: 'STATUS_UNAVAILABLE', message: 'Empty status response', retryable: true });

    return json(200, { ok: true, order, shipment, shipmentError, statusSource: 'status_api' });
  } catch (err) {
    return errorResponse(err);
  }
}
