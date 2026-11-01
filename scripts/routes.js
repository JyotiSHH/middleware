// Prints every endpoint this middleware exposes: npm run routes
// Single source of truth for the route table, shared with dev-server.js so the
// startup banner and the docs can never drift apart.
import { pathToFileURL } from 'node:url';

export const ROUTES = [
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

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// Colour only when stdout is a terminal, so piping to a file stays clean.
const paint = (code, s) => (process.stdout.isTTY ? `${code}${s}${RESET}` : s);

export function printRoutes({ baseUrl = 'http://localhost:3000', params = true } = {}) {
  const authLabel = (auth) =>
    auth === 'public' ? paint(GREEN, 'public   ') : paint(YELLOW, 'x-api-key');

  console.log(`\n${paint(BOLD, 'order-tracking middleware')} ${paint(DIM, `- ${baseUrl}`)}\n`);

  for (const route of ROUTES) {
    console.log(`  ${paint(BOLD, route.method.padEnd(4))} ${paint(CYAN, route.path)}`);
    console.log(`       ${authLabel(route.auth)}  ${route.summary}`);
    console.log(`       ${paint(DIM, route.file)}\n`);
  }

  if (!params) return;

  for (const [path, rows] of Object.entries(QUERY_PARAMS)) {
    console.log(`  ${paint(BOLD, `${path} query params`)}`);
    const width = Math.max(...rows.map(([name]) => name.length));
    for (const [name, description] of rows) {
      console.log(`    ${paint(CYAN, name.padEnd(width))}  ${paint(DIM, description)}`);
    }
    console.log();
  }

  console.log(paint(DIM, '  Admin endpoints need:  -H "x-api-key: $ADMIN_API_KEY"'));
  console.log(paint(DIM, '  Full reference:        README.md\n'));
}

// Run directly (npm run routes) rather than imported by dev-server.js.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  printRoutes();
}
