import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleOrderDetails } from '../src/order-details-handler.js';
import { cfg, shopifyOrderDetails } from './helpers.js';

const KEY = 'admin-key';
const get = (path = '/api/orders/1001', apiKey = KEY) => ({ method: 'GET', url: path, apiKey });

function deps({
  order = shopifyOrderDetails(),
  shipment = { shipment: { current_status: 'IN_TRANSIT' }, error: null },
  config = cfg,
} = {}) {
  const calls = { lookup: 0, status: 0 };
  return {
    calls,
    getConfig: () => {
      if (config instanceof Error) throw config;
      return config;
    },
    lookupOrderDetails: async () => {
      calls.lookup++;
      if (order instanceof Error) throw order;
      return order;
    },
    fetchShipment: async () => {
      calls.status++;
      return shipment;
    },
  };
}

test('happy path returns the full order plus shipment', async () => {
  const res = await handleOrderDetails(get(), deps());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.order.orderNumber, '1001');
  assert.equal(res.body.order.financialStatus, 'PAID');
  assert.equal(res.body.order.fulfillments.length, 1);
  assert.equal(res.body.shipment.status, 'IN_TRANSIT');
  assert.equal(res.body.statusSource, 'status_api');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('accepts a #-prefixed, url-encoded order number', async () => {
  const res = await handleOrderDetails(get('/api/orders/%231001'), deps());
  assert.equal(res.status, 200);
});

test('missing key: 401 and no upstream calls', async () => {
  const d = deps();
  const res = await handleOrderDetails({ method: 'GET', url: '/api/orders/1001' }, d);
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.deepEqual(d.calls, { lookup: 0, status: 0 });
});

test('wrong key: 401 before the order number is even parsed', async () => {
  const d = deps();
  const res = await handleOrderDetails(get('/api/orders/not-a-number', 'wrong'), d);
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
  assert.equal(d.calls.lookup, 0);
});

test('unset ADMIN_API_KEY disables the endpoint', async () => {
  const d = deps({ config: { ...cfg, adminApiKey: null } });
  const res = await handleOrderDetails(get(), d);
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'CONFIG_ERROR');
  assert.equal(d.calls.lookup, 0);
});

test('never sends CORS headers, even with a valid key', async () => {
  const res = await handleOrderDetails(get(), deps());
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
});

test('non-GET: 405 with an Allow header and no upstream calls', async () => {
  const d = deps();
  const res = await handleOrderDetails({ ...get(), method: 'POST' }, d);
  assert.equal(res.status, 405);
  assert.equal(res.body.error.code, 'METHOD_NOT_ALLOWED');
  assert.equal(res.headers.Allow, 'GET');
  assert.deepEqual(d.calls, { lookup: 0, status: 0 });
});

test('bare /api/orders and a bad segment: 400, no upstream calls', async () => {
  for (const path of ['/api/orders', '/api/orders/', '/api/orders/10O1', '/api/orders/12345678901']) {
    const d = deps();
    const res = await handleOrderDetails(get(path), d);
    assert.equal(res.status, 400, path);
    assert.equal(res.body.error.code, 'INVALID_ORDER_NUMBER');
    assert.deepEqual(d.calls, { lookup: 0, status: 0 });
  }
});

test('unknown order: 404', async () => {
  const res = await handleOrderDetails(get('/api/orders/9999'), deps({ order: null }));
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ORDER_NOT_FOUND');
});

test('cancelled order: Shopify wins and the Status API is skipped', async () => {
  const order = shopifyOrderDetails({ cancelledAt: '2026-03-26T08:00:00Z', cancelReason: 'CUSTOMER' });
  const d = deps({ order });
  const res = await handleOrderDetails(get(), d);
  assert.equal(res.status, 200);
  assert.equal(res.body.order.cancelReason, 'CUSTOMER');
  assert.equal(res.body.shipment.status, 'CANCELLED');
  assert.equal(res.body.shipment.tracking, null);
  assert.equal(res.body.statusSource, 'shopify');
  assert.equal(res.body.shipmentError, null);
  assert.equal(d.calls.status, 0);
});

test('status failure still returns the order with a shipmentError', async () => {
  const shipment = { shipment: null, error: { code: 'NO_SHIPMENT', retryable: true } };
  const res = await handleOrderDetails(get(), deps({ shipment }));
  assert.equal(res.status, 200);
  assert.equal(res.body.order.orderNumber, '1001');
  assert.equal(res.body.shipment, null);
  assert.equal(res.body.error, undefined);
  assert.equal(res.body.shipmentError.code, 'NO_SHIPMENT');
});

test('empty status response becomes STATUS_UNAVAILABLE', async () => {
  const shipment = { shipment: null, error: null };
  const res = await handleOrderDetails(get(), deps({ shipment }));
  assert.equal(res.body.shipmentError.code, 'STATUS_UNAVAILABLE');
});

test('Shopify failure surfaces its AppError status', async () => {
  const { AppError } = await import('../src/errors.js');
  const order = new AppError('ORDER_LOOKUP_TIMEOUT', 504, 'Shopify did not respond in time');
  const res = await handleOrderDetails(get(), deps({ order }));
  assert.equal(res.status, 504);
  assert.equal(res.body.error.code, 'ORDER_LOOKUP_TIMEOUT');
  assert.equal(res.body.error.retryable, true);
});

test('an unexpected throw becomes a generic 500', async () => {
  const res = await handleOrderDetails(get(), deps({ order: new TypeError('boom') }));
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.equal(res.body.error.message, 'Unexpected server error');
});
