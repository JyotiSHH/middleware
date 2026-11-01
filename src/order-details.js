// Full-order view for the admin endpoint. Same whitelist discipline as merge.js:
// every field is picked by name, so anything Shopify adds later (including new
// customer fields) is dropped instead of being handed to the caller.
import { toIsoOrNull } from './merge.js';

const FULFILLMENT_STATES = new Set([
  'PENDING', 'OPEN', 'SUCCESS', 'CANCELLED', 'ERROR', 'FAILURE',
]);

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);
const list = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []);
const int = (value, fallback = 0) => (Number.isInteger(value) ? value : fallback);

// Shopify returns money as decimal strings; we keep them as strings so no
// precision is lost rounding through a float.
const money = (bag, currencyCode) => {
  const presentment = bag?.presentmentMoney;
  if (!presentment) return null;
  return {
    amount: text(presentment.amount) ?? '0',
    currencyCode: text(presentment.currencyCode) ?? currencyCode,
  };
};

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function buildLineItem(item) {
  const currency = item.originalUnitPriceSet?.presentmentMoney?.currencyCode ?? null;
  return {
    title: text(item.title),
    variantTitle: item.variantTitle === 'Default Title' ? null : text(item.variantTitle),
    sku: text(item.sku),
    quantity: int(item.quantity),
    // quantity minus anything refunded or removed by an edit
    currentQuantity: int(item.currentQuantity, int(item.quantity)),
    unfulfilledQuantity: int(item.unfulfilledQuantity),
    requiresShipping: Boolean(item.requiresShipping),
    unitPrice: money(item.originalUnitPriceSet, currency),
    discountedTotal: money(item.discountedTotalSet, currency),
    image: text(item.image?.url) ? { url: item.image.url, alt: text(item.image.altText) } : null,
    // false for custom items and deleted products
    hasProduct: Boolean(item.product),
  };
}

function buildFulfillment(fulfillment) {
  return {
    status: FULFILLMENT_STATES.has(fulfillment.status) ? fulfillment.status : null,
    displayStatus: text(fulfillment.displayStatus),
    createdAt: toIsoOrNull(fulfillment.createdAt),
    updatedAt: toIsoOrNull(fulfillment.updatedAt),
    deliveredAt: toIsoOrNull(fulfillment.deliveredAt),
    estimatedDeliveryAt: toIsoOrNull(fulfillment.estimatedDeliveryAt),
    totalQuantity: int(fulfillment.totalQuantity),
    tracking: list(fulfillment.trackingInfo).map((info) => ({
      carrier: text(info.company),
      number: text(info.number),
      url: text(info.url) ? safeUrl(info.url) : null,
    })),
  };
}

function buildShippingLine(line, currencyCode) {
  if (!line || typeof line !== 'object') return null;
  return {
    title: text(line.title),
    code: text(line.code),
    carrier: text(line.carrierIdentifier),
    price: money(line.originalPriceSet, currencyCode),
  };
}

export function buildOrderDetails(order) {
  const currencyCode = text(order.currencyCode);
  const lineItems = list(order.lineItems?.nodes).map(buildLineItem);
  const quantitySum = lineItems.reduce((sum, item) => sum + item.quantity, 0);

  return {
    orderNumber: order.name.replace(/^#/, ''),
    name: order.name,
    createdAt: toIsoOrNull(order.createdAt),
    updatedAt: toIsoOrNull(order.updatedAt),
    processedAt: toIsoOrNull(order.processedAt),
    closedAt: toIsoOrNull(order.closedAt),
    cancelledAt: toIsoOrNull(order.cancelledAt),
    cancelReason: text(order.cancelReason),
    financialStatus: text(order.displayFinancialStatus),
    fulfillmentStatus: text(order.displayFulfillmentStatus),
    tags: Array.isArray(order.tags) ? order.tags.map(text).filter(Boolean) : [],
    currencyCode,
    itemCount: int(order.subtotalLineItemsQuantity, quantitySum),
    totals: {
      subtotal: money(order.subtotalPriceSet, currencyCode),
      shipping: money(order.totalShippingPriceSet, currencyCode),
      tax: money(order.totalTaxSet, currencyCode),
      discounts: money(order.totalDiscountsSet, currencyCode),
      total: money(order.totalPriceSet, currencyCode),
      refunded: money(order.totalRefundedSet, currencyCode),
    },
    shippingLine: buildShippingLine(order.shippingLine, currencyCode),
    fulfillments: list(order.fulfillments).map(buildFulfillment),
    lineItems,
    // true only if the order has more items than our paging cap could fetch
    hasMoreLineItems: Boolean(order.lineItems?.pageInfo?.hasNextPage),
  };
}
