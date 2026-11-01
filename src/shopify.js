import { AppError } from './errors.js';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 2000;

// Only the fields the UI needs. No customer, email, phone or address fields are
// requested, so PII never even reaches the middleware.
const ORDER_QUERY = `
  query OrderByName($query: String!) {
    orders(first: 3, query: $query) {
      nodes {
        name
        createdAt
        cancelledAt
        subtotalLineItemsQuantity
        totalPriceSet { presentmentMoney { amount currencyCode } }
        lineItems(first: 30) {
          pageInfo { hasNextPage }
          nodes {
            title
            variantTitle
            quantity
            image { url(transform: { maxWidth: 240, maxHeight: 240 }) altText }
            product { id }
          }
        }
      }
    }
  }
`;

// ---------- access token (client credentials grant) ----------

// Module scope survives between requests while the serverless instance is warm,
// so we reuse one token until it is close to expiring.
let tokenCache = null; // { token, expiresAt }
let tokenRequest = null; // shared promise so parallel requests fetch only one token

export function resetTokenCache() {
  tokenCache = null;
  tokenRequest = null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function upstreamError(err) {
  if (err?.name === 'TimeoutError') {
    return new AppError('ORDER_LOOKUP_TIMEOUT', 504, 'Shopify did not respond in time');
  }
  console.error('[shopify] network error:', err?.message);
  return new AppError('ORDER_LOOKUP_FAILED', 502, 'Could not reach Shopify');
}

async function requestToken(cfg) {
  let res;
  try {
    res = await fetch(`https://${cfg.shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.shopifyClientId,
        client_secret: cfg.shopifyClientSecret,
      }),
      signal: AbortSignal.timeout(cfg.shopifyTimeoutMs),
    });
  } catch (err) {
    throw upstreamError(err);
  }

  const data = res.ok ? await res.json().catch(() => null) : null;
  if (!data?.access_token) {
    console.error(`[shopify] token request failed (HTTP ${res.status})`);
    throw new AppError('ORDER_LOOKUP_FAILED', 502, 'Could not authenticate with Shopify');
  }

  const ttlMs = (Number(data.expires_in) || 86400) * 1000;
  return { token: data.access_token, expiresAt: Date.now() + ttlMs - TOKEN_REFRESH_BUFFER_MS };
}

export async function getAccessToken(cfg, { forceRefresh = false } = {}) {
  if (!forceRefresh && tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  if (!tokenRequest) {
    tokenRequest = requestToken(cfg)
      .then((fresh) => {
        tokenCache = fresh;
        return fresh.token;
      })
      .finally(() => {
        tokenRequest = null;
      });
  }
  return tokenRequest;
}

// ---------- GraphQL with retry / throttle backoff ----------

function backoffMs(attempt, retryAfterHeader) {
  const retryAfter = Number(retryAfterHeader);
  if (retryAfter > 0) return Math.min(MAX_BACKOFF_MS, retryAfter * 1000);
  return Math.min(MAX_BACKOFF_MS, 250 * 2 ** attempt);
}

const isThrottled = (body) =>
  Array.isArray(body?.errors) && body.errors.some((e) => e?.extensions?.code === 'THROTTLED');

// Shopify's cost-based limit: wait just long enough for the bucket to refill
// enough points for this query, based on the restore rate it reports.
function throttleWaitMs(body, attempt) {
  const cost = body?.extensions?.cost;
  const status = cost?.throttleStatus;
  if (status?.restoreRate > 0) {
    const deficit = (cost.requestedQueryCost ?? 0) - status.currentlyAvailable;
    if (deficit > 0) {
      return Math.min(MAX_BACKOFF_MS, Math.ceil((deficit / status.restoreRate) * 1000));
    }
  }
  return backoffMs(attempt);
}

async function shopifyGraphql(cfg, query, variables) {
  const url = `https://${cfg.shopDomain}/admin/api/${cfg.shopifyApiVersion}/graphql.json`;
  let forceRefresh = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const token = await getAccessToken(cfg, { forceRefresh });
    forceRefresh = false;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(cfg.shopifyTimeoutMs),
      });
    } catch (err) {
      throw upstreamError(err);
    }

    const canRetry = attempt < MAX_ATTEMPTS;

    // Token revoked or expired early: get a new one and try again.
    if (res.status === 401 && canRetry) {
      forceRefresh = true;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && canRetry) {
      await sleep(backoffMs(attempt, res.headers.get('retry-after')));
      continue;
    }
    if (!res.ok) {
      console.error(`[shopify] GraphQL request failed (HTTP ${res.status})`);
      throw new AppError('ORDER_LOOKUP_FAILED', 502, 'Shopify request failed');
    }

    const body = await res.json();
    if (isThrottled(body) && canRetry) {
      await sleep(throttleWaitMs(body, attempt));
      continue;
    }
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      console.error('[shopify] GraphQL errors:', body.errors.map((e) => e?.message));
      throw new AppError('ORDER_LOOKUP_FAILED', 502, 'Shopify returned an error');
    }
    return body.data;
  }

  throw new AppError('ORDER_LOOKUP_FAILED', 502, 'Shopify request kept failing');
}

// ---------- public ----------

// Looks the order up by its name (#1001), never by GID. Search can match loosely,
// so we only accept an exact name match.
export async function lookupOrder(cfg, orderNumber) {
  const name = `#${orderNumber}`;
  const data = await shopifyGraphql(cfg, ORDER_QUERY, { query: `name:${name}` });
  const nodes = data?.orders?.nodes ?? [];
  return nodes.find((order) => order?.name === name) ?? null;
}

// ---------- full order details (admin endpoint) ----------

// Deliberately omits customer, email, phone, shippingAddress, billingAddress and
// `note` (shoppers put phone numbers in notes), so this stays PII-free like the
// shopper endpoint even though it returns far more of the order.
const LINE_ITEM_FIELDS = `
  title
  variantTitle
  sku
  quantity
  currentQuantity
  unfulfilledQuantity
  requiresShipping
  originalUnitPriceSet { presentmentMoney { amount currencyCode } }
  discountedTotalSet { presentmentMoney { amount currencyCode } }
  image { url(transform: { maxWidth: 240, maxHeight: 240 }) altText }
  product { id }
`;

const ORDER_DETAILS_QUERY = `
  query OrderDetailsByName($query: String!, $lineItems: Int!) {
    orders(first: 3, query: $query) {
      nodes {
        id
        name
        createdAt
        updatedAt
        processedAt
        closedAt
        cancelledAt
        cancelReason
        displayFinancialStatus
        displayFulfillmentStatus
        tags
        subtotalLineItemsQuantity
        currencyCode
        subtotalPriceSet { presentmentMoney { amount currencyCode } }
        totalShippingPriceSet { presentmentMoney { amount currencyCode } }
        totalTaxSet { presentmentMoney { amount currencyCode } }
        totalDiscountsSet { presentmentMoney { amount currencyCode } }
        totalPriceSet { presentmentMoney { amount currencyCode } }
        totalRefundedSet { presentmentMoney { amount currencyCode } }
        shippingLine {
          title
          code
          carrierIdentifier
          originalPriceSet { presentmentMoney { amount currencyCode } }
        }
        fulfillments(first: 20) {
          status
          displayStatus
          createdAt
          updatedAt
          deliveredAt
          estimatedDeliveryAt
          totalQuantity
          trackingInfo(first: 10) { company number url }
        }
        lineItems(first: $lineItems) {
          pageInfo { hasNextPage endCursor }
          nodes { ${LINE_ITEM_FIELDS} }
        }
      }
    }
  }
`;

const LINE_ITEMS_PAGE_QUERY = `
  query OrderLineItems($id: ID!, $lineItems: Int!, $after: String!) {
    order(id: $id) {
      lineItems(first: $lineItems, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${LINE_ITEM_FIELDS} }
      }
    }
  }
`;

const LINE_ITEMS_PER_PAGE = 50;
const MAX_LINE_ITEM_PAGES = 10; // 500 items; past that we stop and say so

// Same exact-name rule as lookupOrder, but returns the whole order and follows
// line-item pagination so callers get every item, not just the first page.
export async function lookupOrderDetails(cfg, orderNumber) {
  const name = `#${orderNumber}`;
  const data = await shopifyGraphql(cfg, ORDER_DETAILS_QUERY, {
    query: `name:${name}`,
    lineItems: LINE_ITEMS_PER_PAGE,
  });
  const order = (data?.orders?.nodes ?? []).find((node) => node?.name === name);
  if (!order) return null;

  const nodes = [...(order.lineItems?.nodes ?? [])];
  let pageInfo = order.lineItems?.pageInfo ?? {};
  let pages = 1;

  while (pageInfo.hasNextPage && pageInfo.endCursor && pages < MAX_LINE_ITEM_PAGES) {
    const page = await shopifyGraphql(cfg, LINE_ITEMS_PAGE_QUERY, {
      id: order.id,
      lineItems: LINE_ITEMS_PER_PAGE,
      after: pageInfo.endCursor,
    });
    const next = page?.order?.lineItems;
    if (!next) break;
    nodes.push(...(next.nodes ?? []));
    pageInfo = next.pageInfo ?? {};
    pages++;
  }

  return { ...order, lineItems: { pageInfo, nodes } };
}

// ---------- order list (admin endpoint) ----------

// Summary per order, same PII-free field set buildOrder() already maps for
// /api/track. Line items are capped tighter than the single-order query because
// this cost is paid once per order in the page.
const ORDER_LIST_QUERY = `
  query OrderList($first: Int!, $after: String, $query: String, $lineItems: Int!) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        createdAt
        cancelledAt
        subtotalLineItemsQuantity
        totalPriceSet { presentmentMoney { amount currencyCode } }
        lineItems(first: $lineItems) {
          pageInfo { hasNextPage }
          nodes {
            title
            variantTitle
            quantity
            image { url(transform: { maxWidth: 240, maxHeight: 240 }) altText }
            product { id }
          }
        }
      }
    }
  }
`;

const LIST_LINE_ITEMS = 10; // per order; hasMoreLineItems flags the rest

// One page of orders, newest first. `query` is built from validated filters by
// the caller, never passed through from the raw query string.
export async function listOrders(cfg, { limit, cursor = null, query = null }) {
  const data = await shopifyGraphql(cfg, ORDER_LIST_QUERY, {
    first: limit,
    after: cursor,
    query,
    lineItems: LIST_LINE_ITEMS,
  });
  return {
    nodes: data?.orders?.nodes ?? [],
    pageInfo: data?.orders?.pageInfo ?? { hasNextPage: false, endCursor: null },
  };
}
