import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '../src/errors.js';
import { handleTrack } from '../src/handler.js';
import { cfg, shopifyOrder } from './helpers.js';

const get = (query) => ({ method: 'GET', url: `/api/track?${query}` });

function deps({ order = shopifyOrder(), shipment = { shipment: { current_status: 'IN_TRANSIT' }, error: null } } = {}) {
  const calls = { lookup: 0, status: 0 };
  return {
    calls,
    getConfig: () => cfg,
    lookupOrder: async () => {
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

test('happy path merges order + shipment', async () => {
  const d = deps();
  const res = await handleTrack(get('order=%231001'), d);
  assert.equal(res.status, 200);
  assert.equal(res.body.order.orderNumber, '1001');
  assert.equal(res.body.shipment.status, 'IN_TRANSIT');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('public endpoint: any origin may read it', async () => {
  for (const origin of ['https://www.wikipedia.org', 'http://localhost:9292', undefined]) {
    const res = await handleTrack({ ...get('order=1001'), origin }, deps());
    assert.equal(res.status, 200, origin);
    assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  }
});

test('invalid order number: 400 and no upstream calls', async () => {
  const d = deps();
  const res = await handleTrack(get('order=10O1'), d);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_ORDER_NUMBER');
  assert.deepEqual(d.calls, { lookup: 0, status: 0 });
});

test('errors are readable cross-origin too', async () => {
  const res = await handleTrack(get('order=10O1'), deps());
  assert.equal(res.status, 400);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
});

test('config failure still sends CORS headers', async () => {
  const d = deps();
  d.getConfig = () => {
    throw new AppError('CONFIG_ERROR', 500, 'Middleware is not configured');
  };
  const res = await handleTrack(get('order=1001'), d);
  assert.equal(res.status, 500);
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
});

test('order not found: 404 ORDER_NOT_FOUND', async () => {
  const res = await handleTrack(get('order=9999'), deps({ order: null }));
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ORDER_NOT_FOUND');
});

test('no shipment yet: 200 with order and shipmentError', async () => {
  const shipment = { shipment: null, error: { code: 'NO_SHIPMENT', retryable: true } };
  const res = await handleTrack(get('order=1009'), deps({ shipment }));
  assert.equal(res.status, 200);
  assert.equal(res.body.shipment, null);
  assert.equal(res.body.shipmentError.code, 'NO_SHIPMENT');
  assert.ok(res.body.order);
});

test('cancelled in Shopify wins and skips the Status API', async () => {
  const d = deps({ order: shopifyOrder({ cancelledAt: '2026-03-26T09:00:00Z' }) });
  const res = await handleTrack(get('order=1001'), d);
  assert.equal(res.body.shipment.status, 'CANCELLED');
  assert.equal(res.body.statusSource, 'shopify');
  assert.equal(d.calls.status, 0);
});

test('OPTIONS preflight returns 204 with CORS headers', async () => {
  const res = await handleTrack({ method: 'OPTIONS', url: '/api/track' }, deps());
  assert.equal(res.status, 204);
  assert.equal(res.headers['Access-Control-Allow-Methods'], 'GET, OPTIONS');
});

test('unexpected crash returns consistent INTERNAL_ERROR shape', async (t) => {
  t.mock.method(console, 'error', () => {});
  const res = await handleTrack(get('order=1001'), deps({ order: new TypeError('boom') }));
  assert.equal(res.status, 500);
  assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message', 'retryable']);
});
