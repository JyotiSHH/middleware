import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '../src/errors.js';
import { handleOrderList } from '../src/order-list-handler.js';
import { cfg, shopifyOrder } from './helpers.js';

const KEY = 'admin-key';
const get = (qs = '', apiKey = KEY) => ({ method: 'GET', url: `/api/orders?${qs}`, apiKey });

function deps({
  nodes = [shopifyOrder(), shopifyOrder({ name: '#1002' })],
  pageInfo = { hasNextPage: false, endCursor: 'c1' },
  config = cfg,
} = {}) {
  const calls = [];
  return {
    calls,
    getConfig: () => config,
    listOrders: async (_cfg, params) => {
      calls.push(params);
      if (nodes instanceof Error) throw nodes;
      return { nodes, pageInfo };
    },
  };
}

test('returns the order list with pageInfo', async () => {
  const res = await handleOrderList(get(), deps());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.orders.map((o) => o.orderNumber), ['1001', '1002']);
  assert.deepEqual(res.body.pageInfo, { hasNextPage: false, endCursor: 'c1' });
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('each order carries the same PII-free shape as /api/track', async () => {
  const [order] = (await handleOrderList(get(), deps())).body.orders;
  assert.deepEqual(Object.keys(order).sort(), [
    'cancelledAt', 'createdAt', 'hasMoreLineItems', 'itemCount',
    'lineItems', 'name', 'orderNumber', 'total',
  ]);
  assert.equal(order.total.currencyCode, 'INR');
  assert.equal(order.lineItems.length, 2);
});

test('passes validated paging and filters through to Shopify', async () => {
  const d = deps();
  await handleOrderList(get('limit=50&cursor=abc&status=open'), d);
  assert.deepEqual(d.calls, [{ limit: 50, cursor: 'abc', query: 'status:open' }]);
});

test('no shipment or tracking data in the list response', async () => {
  const res = await handleOrderList(get(), deps());
  assert.equal(res.body.shipment, undefined);
  assert.equal(JSON.stringify(res.body).includes('tracking'), false);
});

test('missing or wrong key: 401 and no Shopify call', async () => {
  for (const req of [{ method: 'GET', url: '/api/orders' }, get('', 'wrong')]) {
    const d = deps();
    const res = await handleOrderList(req, d);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
    assert.deepEqual(d.calls, []);
  }
});

test('unset ADMIN_API_KEY disables the endpoint', async () => {
  const d = deps({ config: { ...cfg, adminApiKey: null } });
  const res = await handleOrderList(get(), d);
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'CONFIG_ERROR');
  assert.deepEqual(d.calls, []);
});

test('never sends CORS headers', async () => {
  const res = await handleOrderList(get(), deps());
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
});

test('non-GET: 405 with Allow and no Shopify call', async () => {
  const d = deps();
  const res = await handleOrderList({ ...get(), method: 'DELETE' }, d);
  assert.equal(res.status, 405);
  assert.equal(res.headers.Allow, 'GET');
  assert.deepEqual(d.calls, []);
});

test('a bad filter is rejected before any Shopify call', async () => {
  const d = deps();
  const res = await handleOrderList(get('limit=9999'), d);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_QUERY');
  assert.deepEqual(d.calls, []);
});

test('empty store returns an empty list, not an error', async () => {
  const res = await handleOrderList(get(), deps({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.orders, []);
  assert.deepEqual(res.body.pageInfo, { hasNextPage: false, endCursor: null });
});

test('skips malformed nodes instead of crashing', async () => {
  const res = await handleOrderList(get(), deps({ nodes: [null, shopifyOrder(), { name: null }] }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.orders.map((o) => o.orderNumber), ['1001']);
});

test('Shopify failure surfaces its AppError status', async () => {
  const nodes = new AppError('ORDER_LOOKUP_TIMEOUT', 504, 'Shopify did not respond in time');
  const res = await handleOrderList(get(), deps({ nodes }));
  assert.equal(res.status, 504);
  assert.equal(res.body.error.code, 'ORDER_LOOKUP_TIMEOUT');
});

test('an unexpected throw becomes a generic 500', async () => {
  const res = await handleOrderList(get(), deps({ nodes: new TypeError('boom') }));
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
});

test('reports hasNextPage with the cursor to continue from', async () => {
  const d = deps({ pageInfo: { hasNextPage: true, endCursor: 'next-cursor' } });
  const res = await handleOrderList(get('limit=1'), d);
  assert.deepEqual(res.body.pageInfo, { hasNextPage: true, endCursor: 'next-cursor' });
});
