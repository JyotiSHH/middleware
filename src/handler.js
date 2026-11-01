import { getConfig } from './config.js';
import { corsHeaders } from './cors.js';
import { AppError } from './errors.js';
import { buildOrder, buildShipment, cancelledShipment } from './merge.js';
import { fetchShipment } from './status-api.js';
import { lookupOrder } from './shopify.js';
import { parseOrderNumber } from './validate.js';

// Platform-agnostic core: takes { method, url } and returns
// { status, headers, body }. Dependencies are injectable for tests.
const defaultDeps = { getConfig, lookupOrder, fetchShipment };

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

function errorResponse(err, cors) {
  if (err instanceof AppError) {
    return json(err.status, { ok: false, error: err.toJSON() }, cors);
  }
  console.error('[track] unexpected error:', err);
  const error = new AppError('INTERNAL_ERROR', 500, 'Unexpected server error');
  return json(500, { ok: false, error: error.toJSON() }, cors);
}

export async function handleTrack(req, deps = defaultDeps) {
  let cfg;
  try {
    cfg = deps.getConfig();
  } catch (err) {
    return errorResponse(err, corsHeaders());
  }

  const cors = corsHeaders();
  if (req.method === 'OPTIONS') return { status: 204, headers: cors, body: null };

  try {
    if (req.method !== 'GET') {
      throw new AppError('METHOD_NOT_ALLOWED', 405, 'Use GET');
    }

    const raw = new URL(req.url, 'http://localhost').searchParams.get('order');
    const orderNumber = parseOrderNumber(raw);
    if (!orderNumber) {
      throw new AppError('INVALID_ORDER_NUMBER', 400, 'Use digits only, optionally starting with #');
    }

    const shopifyOrder = await deps.lookupOrder(cfg, orderNumber);
    if (!shopifyOrder) {
      throw new AppError('ORDER_NOT_FOUND', 404, `No order #${orderNumber}`);
    }
    const order = buildOrder(shopifyOrder);

    // Cancelled in Shopify: Shopify wins, and we skip the Status API call entirely.
    if (order.cancelledAt) {
      return json(
        200,
        { ok: true, order, shipment: cancelledShipment(order), shipmentError: null, statusSource: 'shopify' },
        cors,
      );
    }

    const result = await deps.fetchShipment(cfg, orderNumber);
    const shipment = buildShipment(result.shipment);
    const shipmentError =
      result.error ??
      (shipment ? null : { code: 'STATUS_UNAVAILABLE', message: 'Empty status response', retryable: true });

    return json(200, { ok: true, order, shipment, shipmentError, statusSource: 'status_api' }, cors);
  } catch (err) {
    return errorResponse(err, cors);
  }
}
