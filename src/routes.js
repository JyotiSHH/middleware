// The service's route table and identity: the single source of truth for the
// health response and the `npm run routes` CLI.
export const SERVICE = 'order-tracking-middleware';

// Keep in step with package.json; test/info.test.js asserts they match.
export const VERSION = '1.0.0';

export const ROUTES = [
  {
    method: 'GET',
    path: '/',
    auth: 'public',
    summary: 'Health check: service status and whether config is present',
    file: 'api/index.js',
  },
  {
    method: 'GET',
    path: '/api/track?order=1001',
    auth: 'public',
    summary: 'Order + shipment for the storefront tracking section',
    file: 'api/track.js',
  },
  {
    method: 'GET',
    path: '/api/orders',
    auth: 'x-api-key',
    summary: 'List all orders, newest first, cursor-paginated',
    file: 'api/orders/index.js',
  },
  {
    method: 'GET',
    path: '/api/orders/1001',
    auth: 'x-api-key',
    summary: 'Full detail for one order (money, fulfillments, SKUs)',
    file: 'api/orders/[order].js',
  },
];

export const QUERY_PARAMS = {
  '/api/track': [['order', 'required. 1001 or #1001']],
  '/api/orders': [
    ['limit', '1-250, default 25'],
    ['cursor', 'pageInfo.endCursor from the previous page'],
    ['status', 'open | closed | cancelled | any'],
    ['financialStatus', 'paid | pending | refunded | partially_refunded | ...'],
    ['fulfillmentStatus', 'fulfilled | unfulfilled | partial | shipped | unshipped'],
    ['createdAtMin', 'ISO 8601 date'],
    ['createdAtMax', 'ISO 8601 date'],
  ],
};
