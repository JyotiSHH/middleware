import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseListParams } from '../src/order-list.js';

const parse = (qs) => parseListParams(new URL(`http://x/api/orders?${qs}`).searchParams);
const rejects = (qs, label) =>
  assert.throws(
    () => parse(qs),
    (err) => {
      assert.equal(err.code, 'INVALID_QUERY');
      assert.equal(err.status, 400);
      return true;
    },
    label,
  );

test('defaults to 25 orders, no cursor, no filter', () => {
  assert.deepEqual(parse(''), { limit: 25, cursor: null, query: null });
});

test('accepts limit, cursor and the boundary values', () => {
  assert.equal(parse('limit=1').limit, 1);
  assert.equal(parse('limit=250').limit, 250);
  assert.equal(parse('cursor=abc123').cursor, 'abc123');
});

test('rejects a limit outside 1..250 or non-numeric', () => {
  for (const qs of ['limit=0', 'limit=251', 'limit=-1', 'limit=abc', 'limit=1.5', 'limit=1e3']) {
    rejects(qs, qs);
  }
});

test('an out-of-range limit says so, rather than "not a number"', () => {
  assert.throws(() => parse('limit=9999'), (err) => {
    assert.match(err.message, /between 1 and 250/);
    return true;
  });
});

test('builds Shopify search terms from the status filters', () => {
  assert.equal(parse('status=open').query, 'status:open');
  assert.equal(parse('status=cancelled').query, 'status:cancelled');
  assert.equal(parse('financialStatus=PAID').query, 'financial_status:paid');
  assert.equal(parse('fulfillmentStatus=unfulfilled').query, 'fulfillment_status:unfulfilled');
});

test('status=any means no term at all', () => {
  assert.equal(parse('status=any').query, null);
});

test('combines filters with AND', () => {
  assert.equal(
    parse('status=open&fulfillmentStatus=unfulfilled').query,
    'status:open AND fulfillment_status:unfulfilled',
  );
});

test('normalises dates to ISO and brackets a range', () => {
  const { query } = parse('createdAtMin=2026-01-01&createdAtMax=2026-02-01T10:00:00Z');
  assert.equal(query, 'created_at:>=2026-01-01T00:00:00.000Z AND created_at:<=2026-02-01T10:00:00.000Z');
});

test('rejects unknown enum values and bad dates', () => {
  for (const qs of ['status=deleted', 'financialStatus=free', 'fulfillmentStatus=maybe', 'createdAtMin=yesterday']) {
    rejects(qs, qs);
  }
});

test('blank params are treated as absent, not as errors', () => {
  assert.deepEqual(parse('limit=&cursor=&status=&createdAtMin='), { limit: 25, cursor: null, query: null });
});

test('cannot inject extra search syntax through a filter', () => {
  rejects('status=' + encodeURIComponent('open OR status:closed'));
  rejects('financialStatus=' + encodeURIComponent("paid') OR name:'#1001"));
  rejects('fulfillmentStatus=' + encodeURIComponent('fulfilled AND name:#1001'));
});
