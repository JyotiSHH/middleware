// Recon: runs every test order through Shopify + the Status API and prints a
// table of the cases each one exercises. Raw results go to ./recon (gitignored).
// Usage: npm run sweep -- ../order-numbers.txt
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { getConfig } from '../src/config.js';
import { lookupOrder } from '../src/shopify.js';
import { fetchShipment } from '../src/status-api.js';
import { parseOrderNumber } from '../src/validate.js';

const DELAY_MS = 2100; // Status API allows 30 requests/minute per key
const KNOWN_CODES = new Set([
  'ORDER_PLACED', 'PICKUP_COMPLETE', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED',
  'DELIVERY_FAILED', 'RTO_INITIATED', 'RTO_DELIVERED', 'CANCELLED',
  'RETURN_INITIATED', 'RETURN_PICKED_UP', 'RETURNED',
]);

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run sweep -- <path to order-numbers.txt>');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cfg = getConfig();
const inputs = (await readFile(file, 'utf8')).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
await mkdir('recon', { recursive: true });

const rows = [];
for (const [i, input] of inputs.entries()) {
  process.stdout.write(`\r${i + 1}/${inputs.length}`);
  const n = parseOrderNumber(input);
  if (!n) {
    rows.push({ order: input, shopify: 'INVALID FORMAT' });
    continue;
  }

  const t0 = Date.now();
  let order = null;
  let orderError = null;
  try {
    order = await lookupOrder(cfg, n);
  } catch (err) {
    orderError = err.code ?? err.message;
  }
  const t1 = Date.now();
  const status = await fetchShipment(cfg, n);
  const t2 = Date.now();

  await writeFile(`recon/${n}.json`, JSON.stringify({ order, orderError, status }, null, 2));

  const s = status.shipment;
  const items = order?.lineItems?.nodes ?? [];
  const codes = [s?.current_status, ...(s?.milestones ?? []).map((m) => m.code)].filter(Boolean);
  rows.push({
    order: n,
    shopify: orderError ?? (order ? 'found' : 'NOT FOUND'),
    cancelled: order?.cancelledAt ? 'yes' : '',
    lines: order ? items.length : '',
    noProduct: items.filter((li) => !li.product).length || '',
    noImage: items.filter((li) => !li.image).length || '',
    total: order?.totalPriceSet?.presentmentMoney?.amount ?? '',
    http: status.httpStatus ?? status.error?.code,
    flow: s?.flow ?? '',
    status: s?.current_status ?? status.error?.code ?? '',
    unknown: codes.filter((c) => !KNOWN_CODES.has(c)).join(',') || '',
    noCurrent: s && !s.milestones?.some((m) => m.state === 'current') ? 'yes' : '',
    missingTs: s ? (s.milestones ?? []).filter((m) => !m.timestamp && !['pending', 'skipped'].includes(m.state)).length || '' : '',
    history: s ? (s.history?.length ?? 'null') : '',
    tracking: s ? (s.tracking ? (s.tracking.tracking_url ? 'url' : 'no url') : 'null') : '',
    shopifyMs: t1 - t0,
    statusMs: t2 - t1,
  });

  if (i < inputs.length - 1) await sleep(DELAY_MS);
}

console.log();
console.table(rows);
await writeFile('recon/summary.json', JSON.stringify(rows, null, 2));
console.log('Raw responses saved in ./recon');
