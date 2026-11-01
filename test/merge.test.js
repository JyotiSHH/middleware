import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOrder, buildShipment, cancelledShipment, toIsoOrNull } from '../src/merge.js';
import { shopifyOrder } from './helpers.js';

test('order: only whitelisted fields, PII dropped even if present upstream', () => {
  const order = buildOrder({
    ...shopifyOrder(),
    email: 'a@b.com',
    customer: { id: 'gid://shopify/Customer/9', firstName: 'Asha' },
    shippingAddress: { phone: '+910000000000' },
  });
  const out = JSON.stringify(order);
  for (const pii of ['a@b.com', 'Customer', 'Asha', '+910000000000']) assert.ok(!out.includes(pii));
  assert.deepEqual(Object.keys(order).sort(), [
    'cancelledAt', 'createdAt', 'hasMoreLineItems', 'itemCount', 'lineItems', 'name', 'orderNumber', 'total',
  ]);
});

test('order: deleted product, missing image, Default Title variant', () => {
  const [, mug] = buildOrder(shopifyOrder()).lineItems;
  assert.deepEqual(mug, { title: 'Old mug', variantTitle: null, quantity: 1, image: null, hasProduct: false });
});

test('order: zero / missing total', () => {
  assert.equal(buildOrder(shopifyOrder({ totalPriceSet: null })).total.amount, '0');
});

test('shipment: bad timestamps become null, unknown state becomes pending, labels fall back', () => {
  const s = buildShipment({
    current_status: 'HELD_AT_CUSTOMS',
    milestones: [
      { code: 'ORDER_PLACED', label: 'Order Placed', state: 'completed', timestamp: 'not-a-date' },
      { code: 'HELD_AT_CUSTOMS', label: null, state: 'weird', timestamp: undefined },
    ],
    history: null,
  });
  assert.equal(s.statusLabel, 'Held at customs');
  assert.equal(s.milestones[0].timestamp, null);
  assert.equal(s.milestones[1].label, 'Held at customs');
  assert.equal(s.milestones[1].state, 'pending');
  assert.deepEqual(s.history, []);
  assert.equal(s.flow, 'forward');
});

test('shipment: unsafe tracking url dropped, null tracking stays null', () => {
  const s = buildShipment({ tracking: { tracking_id: '1', carrier: 'X', tracking_url: 'javascript:alert(1)' } });
  assert.equal(s.tracking.url, null);
  assert.equal(buildShipment({ tracking: null }).tracking, null);
});

test('cancelled: only placed + cancelled milestones, no tracking', () => {
  const order = buildOrder(shopifyOrder({ cancelledAt: '2026-03-26T09:00:00Z' }));
  const s = cancelledShipment(order);
  assert.deepEqual(s.milestones.map((m) => m.state), ['completed', 'failed']);
  assert.equal(s.tracking, null);
  assert.equal(s.expectedDelivery, null);
});

test('toIsoOrNull accepts date-only strings', () => {
  assert.equal(toIsoOrNull('2026-03-30'), '2026-03-30');
  assert.equal(toIsoOrNull(''), null);
});
