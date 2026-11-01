// Turns raw upstream data into exactly the fields the UI renders.
// Every field is picked by name (a whitelist), so anything new or sensitive the
// upstream APIs add later is dropped instead of leaking to the browser.

const MILESTONE_STATES = new Set(['completed', 'current', 'pending', 'failed', 'skipped']);

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);
const list = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []);

// Bad or missing timestamps become null, so the UI can show "Date unavailable"
// instead of "Invalid Date".
export function toIsoOrNull(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

// Only http(s) links reach the page (blocks javascript: and other schemes).
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// HELD_AT_CUSTOMS -> "Held at customs": fallback when the API sends no label.
function humanize(code) {
  if (!text(code)) return null;
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function buildOrder(order) {
  const lineItems = list(order.lineItems?.nodes).map((item) => ({
    title: text(item.title),
    variantTitle: item.variantTitle === 'Default Title' ? null : text(item.variantTitle),
    quantity: Number.isInteger(item.quantity) ? item.quantity : 0,
    image: text(item.image?.url) ? { url: item.image.url, alt: text(item.image.altText) } : null,
    // false for custom items and deleted products
    hasProduct: Boolean(item.product),
  }));

  const money = order.totalPriceSet?.presentmentMoney;
  const quantitySum = lineItems.reduce((sum, item) => sum + item.quantity, 0);

  return {
    orderNumber: order.name.replace(/^#/, ''),
    name: order.name,
    createdAt: toIsoOrNull(order.createdAt),
    cancelledAt: toIsoOrNull(order.cancelledAt),
    total: { amount: text(money?.amount) ?? '0', currencyCode: text(money?.currencyCode) },
    itemCount: Number.isInteger(order.subtotalLineItemsQuantity) ? order.subtotalLineItemsQuantity : quantitySum,
    lineItems,
    hasMoreLineItems: Boolean(order.lineItems?.pageInfo?.hasNextPage),
  };
}

export function buildShipment(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const tracking = raw.tracking && typeof raw.tracking === 'object' ? raw.tracking : null;
  const trackingId = text(tracking?.tracking_id);
  const carrier = text(tracking?.carrier);

  return {
    flow: raw.flow === 'return' ? 'return' : 'forward',
    status: text(raw.current_status),
    statusLabel: text(raw.status_label) ?? humanize(raw.current_status),
    expectedDelivery: toIsoOrNull(raw.expected_delivery),
    deliveredAt: toIsoOrNull(raw.delivered_at),
    tracking:
      trackingId || carrier ? { id: trackingId, carrier, url: safeUrl(tracking.tracking_url) } : null,
    milestones: list(raw.milestones).map((m) => ({
      code: text(m.code),
      label: text(m.label) ?? humanize(m.code),
      state: MILESTONE_STATES.has(m.state) ? m.state : 'pending',
      timestamp: toIsoOrNull(m.timestamp),
    })),
    // The API guarantees newest-first; we keep its order.
    history: list(raw.history).map((h) => ({
      timestamp: toIsoOrNull(h.timestamp),
      code: text(h.code),
      message: text(h.message) ?? humanize(h.code),
      location: text(h.location),
    })),
  };
}

// Conflict rule: Shopify owns the order lifecycle. If Shopify says the order is
// cancelled, we show cancelled no matter what the Status API says, and we do not
// show tracking, an expected date or later milestones (they would be misleading).
export function cancelledShipment(order) {
  return {
    flow: 'forward',
    status: 'CANCELLED',
    statusLabel: 'Cancelled',
    expectedDelivery: null,
    deliveredAt: null,
    tracking: null,
    milestones: [
      { code: 'ORDER_PLACED', label: 'Order Placed', state: 'completed', timestamp: order.createdAt },
      { code: 'CANCELLED', label: 'Cancelled', state: 'failed', timestamp: order.cancelledAt },
    ],
    history: [],
  };
}
