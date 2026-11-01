import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchShipment } from '../src/status-api.js';
import { cfg } from './helpers.js';

const respond = (status, body = {}, headers = {}) => async () => Response.json(body, { status, headers });

test('success returns raw shipment and sends the api key', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', respond(200, { current_status: 'DELIVERED' }));
  const r = await fetchShipment(cfg, '1001');
  assert.equal(r.shipment.current_status, 'DELIVERED');
  assert.equal(r.error, null);
  const [url, opts] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, 'https://status.example.com/v1/shipments/1001');
  assert.equal(opts.headers['x-api-key'], 'key');
});

test('maps each error status to a code', async (t) => {
  const cases = [
    [404, 'NO_SHIPMENT', true],
    [401, 'STATUS_CONFIG_ERROR', false],
    [500, 'STATUS_UNAVAILABLE', true],
    [503, 'STATUS_UNAVAILABLE', true],
  ];
  t.mock.method(console, 'error', () => {});
  for (const [status, code, retryable] of cases) {
    t.mock.method(globalThis, 'fetch', respond(status));
    const r = await fetchShipment(cfg, '1001');
    assert.equal(r.error.code, code, `HTTP ${status}`);
    assert.equal(r.error.retryable, retryable);
  }
});

test('429 passes Retry-After through', async (t) => {
  t.mock.method(globalThis, 'fetch', respond(429, {}, { 'Retry-After': '12' }));
  const r = await fetchShipment(cfg, '1001');
  assert.equal(r.error.code, 'STATUS_RATE_LIMITED');
  assert.equal(r.error.retryAfter, 12);
});

test('timeout becomes STATUS_TIMEOUT', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('timed out', 'TimeoutError');
  });
  const r = await fetchShipment(cfg, '1001');
  assert.equal(r.error.code, 'STATUS_TIMEOUT');
});
