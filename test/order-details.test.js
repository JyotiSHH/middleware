import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOrderDetails } from '../src/order-details.js';
import { detailLineItem, shopifyOrderDetails } from './helpers.js';

test('maps the full order, keeping money as strings', () => {
  const order = buildOrderDetails(shopifyOrderDetails());
  assert.equal(order.orderNumber, '1001');
  assert.equal(order.financialStatus, 'PAID');
  assert.equal(order.fulfillmentStatus, 'PARTIALLY_FULFILLED');
  assert.deepEqual(order.totals.total, { amount: '2499.0', currencyCode: 'INR' });
  assert.deepEqual(order.totals.tax, { amount: '303.0', currencyCode: 'INR' });
  assert.equal(order.itemCount, 4);
  assert.equal(order.lineItems.length, 2);
  assert.equal(order.hasMoreLineItems, false);
  assert.deepEqual(order.shippingLine, {
    title: 'Standard',
    code: 'STD',
    carrier: 'bluedart',
    price: { amount: '99.0', currencyCode: 'INR' },
  });
});

test('drops empty tags and normalises "Default Title" and missing product', () => {
  const order = buildOrderDetails(shopifyOrderDetails());
  assert.deepEqual(order.tags, ['vip']);
  const mug = order.lineItems[1];
  assert.equal(mug.variantTitle, null);
  assert.equal(mug.sku, null);
  assert.equal(mug.image, null);
  assert.equal(mug.hasProduct, false);
});

test('maps fulfillments and their tracking', () => {
  const [fulfillment] = buildOrderDetails(shopifyOrderDetails()).fulfillments;
  assert.equal(fulfillment.status, 'SUCCESS');
  assert.equal(fulfillment.deliveredAt, '2026-03-28T14:00:00Z');
  assert.deepEqual(fulfillment.tracking, [
    { carrier: 'BlueDart', number: 'BD123', url: 'https://track.example/BD123' },
  ]);
});

test('blocks non-http tracking urls', () => {
  const order = shopifyOrderDetails();
  order.fulfillments[0].trackingInfo = [{ company: 'X', number: '1', url: 'javascript:alert(1)' }];
  assert.equal(buildOrderDetails(order).fulfillments[0].tracking[0].url, null);
});

test('unknown fulfillment status becomes null instead of leaking through', () => {
  const order = shopifyOrderDetails();
  order.fulfillments[0].status = 'SOMETHING_NEW';
  assert.equal(buildOrderDetails(order).fulfillments[0].status, null);
});

test('bad timestamps and missing money become null, not Invalid Date', () => {
  const order = buildOrderDetails(
    shopifyOrderDetails({
      updatedAt: 'not-a-date',
      closedAt: null,
      totalRefundedSet: null,
      shippingLine: null,
    }),
  );
  assert.equal(order.updatedAt, null);
  assert.equal(order.closedAt, null);
  assert.equal(order.totals.refunded, null);
  assert.equal(order.shippingLine, null);
});

test('falls back to summing quantities when subtotalLineItemsQuantity is absent', () => {
  const order = buildOrderDetails(shopifyOrderDetails({ subtotalLineItemsQuantity: null }));
  assert.equal(order.itemCount, 4);
});

test('never includes customer, address or note fields', () => {
  const order = buildOrderDetails(
    shopifyOrderDetails({
      customer: { email: 'shopper@example.com' },
      shippingAddress: { address1: '12 Main St', phone: '+919000000000' },
      note: 'call me on 9000000000',
      email: 'shopper@example.com',
    }),
  );
  const serialised = JSON.stringify(order);
  for (const leak of ['shopper@example.com', 'Main St', '9000000000', 'note']) {
    assert.equal(serialised.includes(leak), false, `leaked ${leak}`);
  }
});

test('carries refunds and edits through currentQuantity', () => {
  const order = shopifyOrderDetails({
    lineItems: {
      pageInfo: { hasNextPage: true, endCursor: 'c9' },
      nodes: [detailLineItem({ quantity: 3, currentQuantity: 1, unfulfilledQuantity: 1 })],
    },
  });
  const built = buildOrderDetails(order);
  assert.equal(built.lineItems[0].currentQuantity, 1);
  assert.equal(built.lineItems[0].unfulfilledQuantity, 1);
  assert.equal(built.hasMoreLineItems, true);
});
