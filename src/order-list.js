// Query-string parsing for GET /api/orders.
// Every filter is validated against an allow-list or a date parse, then
// re-serialised into Shopify's search syntax. Nothing from the caller is
// interpolated raw, so a crafted ?status= can't rewrite the search.
import { AppError } from './errors.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 250; // Shopify's connection ceiling

const STATUS = { open: 'status:open', closed: 'status:closed', cancelled: 'status:cancelled', any: null };

const FINANCIAL_STATUS = new Set([
  'paid', 'pending', 'refunded', 'partially_refunded', 'partially_paid',
  'authorized', 'voided', 'expired', 'unpaid',
]);

const FULFILLMENT_STATUS = new Set(['fulfilled', 'unfulfilled', 'partial', 'unshipped', 'shipped']);

const bad = (message) => new AppError('INVALID_QUERY', 400, message);

function parseLimit(raw) {
  if (raw === null) return DEFAULT_LIMIT;
  if (!/^\d{1,9}$/.test(raw)) throw bad('limit must be a whole number');
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_LIMIT) throw bad(`limit must be between 1 and ${MAX_LIMIT}`);
  return limit;
}

// Shopify wants an unquoted ISO timestamp in the search term.
function parseDate(raw, name) {
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw bad(`${name} must be an ISO 8601 date`);
  return new Date(ms).toISOString();
}

function parseEnum(raw, allowed, name) {
  const value = raw.toLowerCase();
  if (!allowed.has(value)) throw bad(`${name} must be one of: ${[...allowed].join(', ')}`);
  return value;
}

export function parseListParams(searchParams) {
  const get = (key) => {
    const value = searchParams.get(key);
    return value === null || value.trim() === '' ? null : value.trim();
  };

  const limit = parseLimit(get('limit'));
  const cursor = get('cursor');
  const terms = [];

  const status = get('status');
  if (status !== null) {
    const term = STATUS[parseEnum(status, new Set(Object.keys(STATUS)), 'status')];
    if (term) terms.push(term);
  }

  const financialStatus = get('financialStatus');
  if (financialStatus !== null) {
    terms.push(`financial_status:${parseEnum(financialStatus, FINANCIAL_STATUS, 'financialStatus')}`);
  }

  const fulfillmentStatus = get('fulfillmentStatus');
  if (fulfillmentStatus !== null) {
    terms.push(`fulfillment_status:${parseEnum(fulfillmentStatus, FULFILLMENT_STATUS, 'fulfillmentStatus')}`);
  }

  const createdAtMin = get('createdAtMin');
  if (createdAtMin !== null) terms.push(`created_at:>=${parseDate(createdAtMin, 'createdAtMin')}`);

  const createdAtMax = get('createdAtMax');
  if (createdAtMax !== null) terms.push(`created_at:<=${parseDate(createdAtMax, 'createdAtMax')}`);

  return { limit, cursor, query: terms.length > 0 ? terms.join(' AND ') : null };
}
