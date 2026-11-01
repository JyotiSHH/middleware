export const cfg = {
  shopDomain: 'test-store.myshopify.com',
  shopifyClientId: 'id',
  shopifyClientSecret: 'secret',
  shopifyApiVersion: '2026-10',
  statusApiBase: 'https://status.example.com',
  statusApiKey: 'key',
  adminApiKey: 'admin-key',
  shopifyTimeoutMs: 1000,
  statusTimeoutMs: 1000,
};

export const shopifyOrder = (overrides = {}) => ({
  name: '#1001',
  createdAt: '2026-03-25T10:46:00Z',
  cancelledAt: null,
  subtotalLineItemsQuantity: 4,
  totalPriceSet: { presentmentMoney: { amount: '2499.0', currencyCode: 'INR' } },
  lineItems: {
    pageInfo: { hasNextPage: false },
    nodes: [
      { title: 'Tee', variantTitle: 'M / Blue', quantity: 3, image: { url: 'https://cdn.shopify.com/a.jpg', altText: null }, product: { id: 'gid://shopify/Product/1' } },
      { title: 'Old mug', variantTitle: 'Default Title', quantity: 1, image: null, product: null },
    ],
  },
  ...overrides,
});

const presentment = (amount, currencyCode = 'INR') => ({ presentmentMoney: { amount, currencyCode } });

export const detailLineItem = (overrides = {}) => ({
  title: 'Tee',
  variantTitle: 'M / Blue',
  sku: 'TEE-M-BLU',
  quantity: 3,
  currentQuantity: 3,
  unfulfilledQuantity: 0,
  requiresShipping: true,
  originalUnitPriceSet: presentment('699.0'),
  discountedTotalSet: presentment('2097.0'),
  image: { url: 'https://cdn.shopify.com/a.jpg', altText: null },
  product: { id: 'gid://shopify/Product/1' },
  ...overrides,
});

export const shopifyOrderDetails = (overrides = {}) => ({
  id: 'gid://shopify/Order/1',
  name: '#1001',
  createdAt: '2026-03-25T10:46:00Z',
  updatedAt: '2026-03-26T09:00:00Z',
  processedAt: '2026-03-25T10:46:00Z',
  closedAt: null,
  cancelledAt: null,
  cancelReason: null,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'PARTIALLY_FULFILLED',
  tags: ['vip', ''],
  subtotalLineItemsQuantity: 4,
  currencyCode: 'INR',
  subtotalPriceSet: presentment('2097.0'),
  totalShippingPriceSet: presentment('99.0'),
  totalTaxSet: presentment('303.0'),
  totalDiscountsSet: presentment('0.0'),
  totalPriceSet: presentment('2499.0'),
  totalRefundedSet: presentment('0.0'),
  shippingLine: {
    title: 'Standard',
    code: 'STD',
    carrierIdentifier: 'bluedart',
    originalPriceSet: presentment('99.0'),
  },
  fulfillments: [
    {
      status: 'SUCCESS',
      displayStatus: 'DELIVERED',
      createdAt: '2026-03-26T08:00:00Z',
      updatedAt: '2026-03-26T09:00:00Z',
      deliveredAt: '2026-03-28T14:00:00Z',
      estimatedDeliveryAt: null,
      totalQuantity: 3,
      trackingInfo: [{ company: 'BlueDart', number: 'BD123', url: 'https://track.example/BD123' }],
    },
  ],
  lineItems: {
    pageInfo: { hasNextPage: false, endCursor: 'c1' },
    nodes: [detailLineItem(), detailLineItem({ title: 'Old mug', variantTitle: 'Default Title', quantity: 1, currentQuantity: 1, sku: null, image: null, product: null })],
  },
  ...overrides,
});
