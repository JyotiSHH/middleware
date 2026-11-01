# order-tracking middleware

HTTP middleware that sits between a Shopify storefront and two upstream APIs, and
returns **PII-free** JSON the theme can render directly.

It exists because the browser cannot be trusted with either upstream:

- the **Shopify Admin API** needs a secret and would happily return the customer's
  name, email, phone and address alongside the order;
- the **Status API** (the carrier/shipment service) needs its own key and has a
  30 req/min budget.

So the middleware holds both credentials server-side, asks each upstream for only
the fields the UI renders, merges them, and hands back a response that contains no
personal data at all. A shopper who opens devtools sees item titles, quantities,
money and milestones — never their own address.

---

## Quick start

```bash
cp .env.example .env     # then fill in the values
npm run dev              # http://localhost:3000
npm run routes           # print every endpoint
npm test                 # 84 tests, no network required
```

**Deployed at** `https://middleware-neon.vercel.app` — every path below works
against that base URL as well as localhost:

```bash
curl "https://middleware-neon.vercel.app/api/track?order=1001"
```

Node >= 20.6 (the `--env-file` flag and `AbortSignal.timeout` are both used).
There are no dependencies — `package-lock.json` has an empty tree on purpose.

---

## The APIs

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | `/api/track?order=1001` | public | One order + live shipment, for the storefront |
| GET | `/api/orders` | `x-api-key` | All orders, newest first, cursor-paginated |
| GET | `/api/orders/1001` | `x-api-key` | Full detail for one order |

`npm run routes` prints the same table in the terminal, and `npm run dev` prints it
on startup. Both read `scripts/routes.js`, so the banner and this table cannot
drift apart.

Every response is `application/json; charset=utf-8` with `Cache-Control: no-store`
and `X-Content-Type-Options: nosniff`. Success is always `{ "ok": true, ... }` and
failure is always `{ "ok": false, "error": { code, message, retryable } }`.

---

### 1. `GET /api/track?order=1001` — public

What the theme's order-tracking section calls. **Public: any origin may read it**
(`Access-Control-Allow-Origin: *`), which is safe because the body is PII-free, but
it does mean anyone can spend the upstream quotas. See
[Rate limiting](#rate-limiting-the-open-question).

| Param | Required | Notes |
| --- | --- | --- |
| `order` | yes | `1001` or `#1001`. Digits only, max 10. |

```bash
curl "http://localhost:3000/api/track?order=1001"
```

```json
{
  "ok": true,
  "order": {
    "orderNumber": "1001",
    "name": "#1001",
    "createdAt": "2026-03-24T13:22:53Z",
    "cancelledAt": null,
    "total": { "amount": "1263.95", "currencyCode": "INR" },
    "itemCount": 1,
    "lineItems": [
      {
        "title": "The Collection Snowboard: Liquid",
        "variantTitle": null,
        "quantity": 1,
        "image": { "url": "https://cdn.shopify.com/...240x240.jpg", "alt": "Top and bottom view of a snowboard..." },
        "hasProduct": true
      }
    ],
    "hasMoreLineItems": false
  },
  "shipment": {
    "flow": "forward",
    "status": "IN_TRANSIT",
    "statusLabel": "In transit",
    "expectedDelivery": "2026-03-28T00:00:00Z",
    "deliveredAt": null,
    "tracking": { "id": "BD123", "carrier": "BlueDart", "url": "https://track.example/BD123" },
    "milestones": [
      { "code": "ORDER_PLACED", "label": "Order Placed", "state": "completed", "timestamp": "2026-03-24T13:22:53Z" },
      { "code": "IN_TRANSIT", "label": "In transit", "state": "current", "timestamp": "2026-03-25T09:00:00Z" },
      { "code": "DELIVERED", "label": "Delivered", "state": "pending", "timestamp": null }
    ],
    "history": [
      { "timestamp": "2026-03-25T09:00:00Z", "code": "IN_TRANSIT", "message": "Departed facility", "location": "Chennai" }
    ]
  },
  "shipmentError": null,
  "statusSource": "status_api"
}
```

**`shipment` and `shipmentError` are complements, never both set.** A failed status
lookup must not hide the order, so the order still returns `200` with
`shipment: null` and a reason:

```json
{
  "ok": true,
  "order": { "...": "..." },
  "shipment": null,
  "shipmentError": { "code": "NO_SHIPMENT", "message": "Order has no shipment yet", "retryable": true },
  "statusSource": "status_api"
}
```

`statusSource` is `"status_api"` normally, or `"shopify"` when the order is
cancelled — see [Conflict rules](#conflict-rules-who-wins).

---

### 2. `GET /api/orders` — admin key

All orders, newest first (`sortKey: CREATED_AT, reverse: true`).

| Param | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | 1-250 (Shopify's connection ceiling) |
| `cursor` | - | `pageInfo.endCursor` from the previous page |
| `status` | - | `open`, `closed`, `cancelled`, `any` |
| `financialStatus` | - | `paid`, `pending`, `refunded`, `partially_refunded`, `partially_paid`, `authorized`, `voided`, `expired`, `unpaid` |
| `fulfillmentStatus` | - | `fulfilled`, `unfulfilled`, `partial`, `shipped`, `unshipped` |
| `createdAtMin` | - | ISO 8601 |
| `createdAtMax` | - | ISO 8601 |

```bash
curl -H "x-api-key: $ADMIN_API_KEY" "http://localhost:3000/api/orders?limit=25&status=open"
```

```json
{
  "ok": true,
  "orders": [
    {
      "orderNumber": "1109",
      "name": "#1109",
      "createdAt": "2026-10-31T18:55:37Z",
      "cancelledAt": null,
      "total": { "amount": "0.0", "currencyCode": "INR" },
      "itemCount": 1,
      "lineItems": [
        {
          "title": "Selling Plans Ski Wax",
          "variantTitle": "Selling Plans Ski Wax",
          "quantity": 1,
          "image": { "url": "https://cdn.shopify.com/...240x240.png", "alt": "A bar of golden yellow wax" },
          "hasProduct": true
        }
      ],
      "hasMoreLineItems": false
    }
  ],
  "pageInfo": { "hasNextPage": true, "endCursor": "eyJsYXN0X2lkIjoxOTAw..." }
}
```

Each entry is the **same shape** `/api/track` returns under `order`, because both go
through `buildOrder()` in `src/merge.js`. One mapper, not two.

Two deliberate omissions:

- **No shipment data.** That would be one Status API call per order against a
  30 req/min key. Use `/api/orders/:orderNumber` when you need shipment.
- **Line items are capped at 10 per order** here, since that cost is paid for every
  order in the page. `hasMoreLineItems` flags the rest.

Filters are never passed through to Shopify raw. Each one is validated against an
allow-list (or parsed as a date) and re-serialised into Shopify's search syntax, so
a crafted `?status=open OR status:closed` cannot rewrite the query. Invalid input
returns `400 INVALID_QUERY` **before** any upstream call.

#### Fetching genuinely every order

The endpoint returns one page. Loop on the cursor:

```bash
C=""
while :; do
  R=$(curl -s -H "x-api-key: $ADMIN_API_KEY" \
      "http://localhost:3000/api/orders?limit=250&cursor=$C")
  echo "$R" | jq -c '.orders[]'
  [ "$(echo "$R" | jq -r .pageInfo.hasNextPage)" = true ] || break
  C=$(echo "$R" | jq -r .pageInfo.endCursor)
done
```

Draining inside the endpoint was rejected on purpose: on a large store it would
exceed the serverless timeout mid-response, leaving the caller with a truncated body
and no cursor to resume from.

---

### 3. `GET /api/orders/1001` — admin key

Everything on one order: the full money breakdown, fulfillments with tracking, SKUs
and per-item refund/fulfillment quantities — plus the same merged `shipment` block
`/api/track` returns.

```bash
curl -H "x-api-key: $ADMIN_API_KEY" http://localhost:3000/api/orders/1001
```

```json
{
  "ok": true,
  "order": {
    "orderNumber": "1001",
    "name": "#1001",
    "createdAt": "2026-03-24T13:22:53Z",
    "updatedAt": "2026-07-28T22:51:41Z",
    "processedAt": "2026-03-24T13:22:53Z",
    "closedAt": null,
    "cancelledAt": null,
    "cancelReason": null,
    "financialStatus": "PENDING",
    "fulfillmentStatus": "FULFILLED",
    "tags": ["COD"],
    "currencyCode": "INR",
    "itemCount": 1,
    "totals": {
      "subtotal":  { "amount": "749.95",  "currencyCode": "INR" },
      "shipping":  { "amount": "379.0",   "currencyCode": "INR" },
      "tax":       { "amount": "135.0",   "currencyCode": "INR" },
      "discounts": { "amount": "0.0",     "currencyCode": "INR" },
      "total":     { "amount": "1263.95", "currencyCode": "INR" },
      "refunded":  { "amount": "0.0",     "currencyCode": "INR" }
    },
    "shippingLine": {
      "title": "Standard",
      "code": "custom",
      "carrier": null,
      "price": { "amount": "379.0", "currencyCode": "INR" }
    },
    "fulfillments": [
      {
        "status": "SUCCESS",
        "displayStatus": "FULFILLED",
        "createdAt": "2026-07-28T22:51:41Z",
        "updatedAt": "2026-07-28T22:51:41Z",
        "deliveredAt": null,
        "estimatedDeliveryAt": null,
        "totalQuantity": 1,
        "tracking": [{ "carrier": "BlueDart", "number": "BD123", "url": "https://track.example/BD123" }]
      }
    ],
    "lineItems": [
      {
        "title": "The Collection Snowboard: Liquid",
        "variantTitle": null,
        "sku": null,
        "quantity": 1,
        "currentQuantity": 1,
        "unfulfilledQuantity": 0,
        "requiresShipping": true,
        "unitPrice":       { "amount": "749.95", "currencyCode": "INR" },
        "discountedTotal": { "amount": "749.95", "currencyCode": "INR" },
        "image": { "url": "https://cdn.shopify.com/...240x240.jpg", "alt": "..." },
        "hasProduct": true
      }
    ],
    "hasMoreLineItems": false
  },
  "shipment": { "...": "same shape as /api/track" },
  "shipmentError": null,
  "statusSource": "status_api"
}
```

Money stays a **string** throughout (`"1263.95"`, not `1263.95`) so nothing is lost
rounding through a float. `currentQuantity` is `quantity` minus anything refunded or
removed by an order edit.

Unlike `/api/orders`, this endpoint pages through **all** line items — 50 per
request, capped at 10 pages (500 items). `hasMoreLineItems` is only `true` for an
order past that cap.

---

## Authentication

`/api/track` is public. The two `/api/orders*` endpoints require a shared key:

```
x-api-key: <ADMIN_API_KEY>
```

| Rule | Why |
| --- | --- |
| Compared with `crypto.timingSafeEqual` | A plain `===` leaks the matching prefix through timing. |
| Checked **before** the order number is parsed | Otherwise 401-vs-404 tells an unauthenticated caller which order numbers exist. |
| Unset `ADMIN_API_KEY` means `500 CONFIG_ERROR` and the endpoint is disabled | Fails closed. An empty env var must never mean "let everyone in". |
| **No CORS headers at all** on admin endpoints | The key must never ship to browser JS. These are server-to-server only, and no `Access-Control-Allow-Origin` means no origin can read them. |

Generate a key with `node -e "console.log(crypto.randomUUID())"`.

---

## Errors

```json
{ "ok": false, "error": { "code": "ORDER_NOT_FOUND", "message": "No order #9999", "retryable": false } }
```

`code` is machine-readable and stable — map it to a locale string in the theme.
`message` is for developers and should never be shown to a shopper as-is.

### Request errors

| Code | HTTP | Meaning |
| --- | --- | --- |
| `INVALID_ORDER_NUMBER` | 400 | `order` is not 1-10 digits (optionally `#`-prefixed) |
| `INVALID_QUERY` | 400 | A `/api/orders` filter failed validation |
| `UNAUTHORIZED` | 401 | Missing or wrong `x-api-key` |
| `ORDER_NOT_FOUND` | 404 | No order with that exact name |
| `METHOD_NOT_ALLOWED` | 405 | Anything but `GET` (response carries `Allow: GET`) |

### Upstream and server errors

| Code | HTTP | `retryable` | Meaning |
| --- | --- | --- | --- |
| `CONFIG_ERROR` | 500 | no | A required env var is missing |
| `INTERNAL_ERROR` | 500 | yes | Unexpected crash; details stay in the logs |
| `ORDER_LOOKUP_FAILED` | 502 | yes | Shopify unreachable, or returned an error |
| `ORDER_LOOKUP_TIMEOUT` | 504 | yes | Shopify exceeded `SHOPIFY_TIMEOUT_MS` |

### `shipmentError` codes

These never fail the request — the order still returns `200`.

| Code | `retryable` | Meaning |
| --- | --- | --- |
| `NO_SHIPMENT` | yes | Status API 404: no shipment created yet |
| `STATUS_RATE_LIMITED` | yes | Status API 429. Carries `retryAfter` in seconds when sent. |
| `STATUS_TIMEOUT` | yes | Exceeded `STATUS_TIMEOUT_MS` |
| `STATUS_UNAVAILABLE` | yes | 5xx, a network failure, or an empty body |
| `STATUS_CONFIG_ERROR` | no | 401/403: **our** key is wrong. Retrying cannot fix it. |

---

## Configuration

All via environment variables (`.env` locally, project settings on Vercel).

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SHOP_DOMAIN` | yes | - | `your-store.myshopify.com`. Scheme and trailing slash are stripped. |
| `SHOPIFY_CLIENT_ID` | yes | - | Custom app, client credentials grant |
| `SHOPIFY_CLIENT_SECRET` | yes | - | |
| `SHOPIFY_API_VERSION` | no | `2026-10` | Pin to a stable version |
| `STATUS_API_BASE` | yes | - | Trailing slash stripped |
| `STATUS_API_KEY` | yes | - | Sent as `x-api-key` upstream |
| `ADMIN_API_KEY` | no | - | Required *by* `/api/orders*`; unset disables them |
| `SHOPIFY_TIMEOUT_MS` | no | `5000` | |
| `STATUS_TIMEOUT_MS` | no | `7000` | |

A missing required variable is reported once as `CONFIG_ERROR` with the variable
**names** logged — never the values. There is no `ALLOWED_ORIGINS`: `/api/track` is
public, and the admin endpoints are key-protected rather than origin-protected.

The Shopify app needs `read_orders` only. Do not grant `read_customers` — nothing
here uses it, and not having it means a bug cannot leak customer data.

---

## How it is built

```
api/                        thin platform adapters (Vercel file routes)
  track.js                  ->  /api/track
  orders/index.js           ->  /api/orders
  orders/[order].js         ->  /api/orders/:orderNumber
src/
  handler.js                core: /api/track
  order-list-handler.js     core: /api/orders
  order-details-handler.js  core: /api/orders/:orderNumber
  order-list.js             query-string validation for the list endpoint
  validate.js               order-number validation
  auth.js                   timing-safe admin key check
  config.js                 env -> config object, with a fail-fast check
  cors.js                   CORS headers for the public endpoint
  errors.js                 AppError: code + HTTP status + retryable
  shopify.js                Admin GraphQL client: token cache, retry, backoff
  status-api.js             Status API client (never throws)
  merge.js                  upstream JSON -> the public order/shipment shape
  order-details.js          upstream JSON -> the full order shape
scripts/
  routes.js                 the route table; npm run routes, and the dev banner
  sweep.js                  recon: run every test order through both upstreams
test/                       node:test, no network, no fixtures on disk
dev-server.js               local server mirroring the Vercel routes
```

**Adapters are deliberately dumb.** Each `api/*.js` file does nothing but pass
`{ method, url, apiKey }` into a handler core and write `{ status, headers, body }`
back out. The cores are plain functions with no knowledge of Node's `req`/`res`, so
the whole surface is testable without a socket, and moving off Vercel means
rewriting three thin files.

**Dependencies are injectable.** Each core takes a `deps` object
(`{ getConfig, lookupOrder, fetchShipment, ... }`) defaulting to the real modules.
Tests pass fakes and assert on call counts — which is how "no upstream call was
made" is proven rather than assumed.

### Upstream clients

`src/shopify.js` holds everything the Admin API demands:

- **Token caching.** The client-credentials token is cached in module scope — which
  survives between requests while a serverless instance stays warm — and refreshed
  5 minutes before expiry. Parallel requests share one in-flight token promise, so a
  cold start with concurrent traffic fetches one token, not one per request.
- **Retry.** Up to 3 attempts. A `401` forces a token refresh and retries; `429` and
  `5xx` back off (honouring `Retry-After`).
- **Cost-aware throttling.** On a `THROTTLED` error it reads
  `extensions.cost.throttleStatus` and waits exactly long enough for the leaky
  bucket to refill the points this query needs, instead of guessing.

`src/status-api.js` **never throws**. It returns `{ shipment, error, httpStatus }`,
because a shipment lookup failing must never take the order summary down with it.

### Conflict rules: who wins

The two upstreams can disagree. The rules are fixed, not per-caller:

1. **Shopify owns the order lifecycle.** If Shopify says the order is cancelled, the
   response shows cancelled no matter what the Status API thinks — and the Status
   API is not even called. `statusSource` becomes `"shopify"`.
2. A cancelled order shows **no tracking, no expected date and no later
   milestones**; they would be actively misleading. Just `ORDER_PLACED` then
   `CANCELLED`.
3. **The Status API owns shipment movement** for every non-cancelled order.
4. **Exact order-name match only.** Shopify's search matches loosely, so
   `name:#1001` can return `#10011`. Anything but an exact `name` match is treated
   as not found.

### Why everything is a whitelist

`merge.js` and `order-details.js` pick every field **by name**. Nothing is spread or
passed through. Consequences:

- A new field either upstream starts returning — including a new customer field — is
  dropped, not forwarded. Privacy does not depend on remembering to update a
  blocklist.
- Bad data degrades instead of breaking the page: an unparseable timestamp becomes
  `null` (so the UI shows "Date unavailable", never "Invalid Date"), an unknown
  milestone `state` becomes `pending`, and an unknown fulfillment status becomes
  `null`.
- Only `http(s)` URLs survive, so a `javascript:` tracking URL cannot reach the DOM.
- `variantTitle: "Default Title"` — Shopify's placeholder for single-variant
  products — becomes `null` so the theme does not render it.
- A missing label is humanised from the code: `HELD_AT_CUSTOMS` becomes
  "Held at customs".

The PII guarantee is enforced two ways: the GraphQL queries never *request*
`customer`, `email`, `phone`, `shippingAddress`, `billingAddress` or `note` (so PII
never reaches this process), and a test asserts those values cannot appear in a
built response even when the upstream sends them anyway.

> `note` is excluded on purpose. It looks harmless, but shoppers routinely type
> phone numbers and addresses into order notes.

---

## Test orders

The Status API mock has **no shipment for orders 1001-1009** — which are exactly the
numbers you reach for first. `/api/track?order=1001` correctly returns the order with
`shipmentError: NO_SHIPMENT`; that is not a bug. Use `1010` or above when you want
shipment data.

Scanned across the store's 109 orders (#1001-#1109): 91 have a shipment, 14 return
404, 4 return 5xx.

| Delivery status | Orders |
| --- | --- |
| `ORDER_PLACED` | 1017, 1033, 1049, 1077, 1103, 1109 |
| `PICKUP_COMPLETE` | 1053, 1057, 1061, 1073, 1092, 1093, 1108 |
| `IN_TRANSIT` | 1010, 1011, 1013, 1046, 1047, 1048, 1056, 1058, 1062, 1065, 1068, 1090, 1096, 1098, 1100, 1101, 1105, 1106 |
| `OUT_FOR_DELIVERY` | 1023, 1036, 1088, 1089, 1091, 1107 |
| `DELIVERED` | 1012, 1020, 1021, 1022, 1024, 1040, 1042, 1045, 1050, 1054, 1067, 1069, 1070, 1079, 1080, 1084, 1085, 1095, 1099 |
| `DELIVERY_FAILED` | 1015, 1039, 1055, 1104 |
| `HELD_AT_CUSTOMS` | 1030, 1052, 1094 |
| `CANCELLED` | 1014, 1016, 1043, 1082, 1102 |
| `RTO_INITIATED` | 1026, 1072, 1076, 1097 |
| `RTO_DELIVERED` | 1032, 1035, 1083 |
| `RETURN_INITIATED` | 1019, 1051, 1063, 1071, 1087 |
| `RETURN_PICKED_UP` | 1060, 1066, 1086 |
| `RETURNED` | 1018, 1027, 1031, 1074 |

Edge cases worth wiring into UI work:

| Case | Orders | What the response looks like |
| --- | --- | --- |
| No shipment yet | 1001-1009, 1028, 1037, 1041, 1044, 1059 | `shipment: null`, `shipmentError.code: NO_SHIPMENT` |
| Upstream 500 | 1029, 1064, 1081 | `shipmentError.code: STATUS_UNAVAILABLE` |
| Upstream 503 / slow | 1034 | `STATUS_UNAVAILABLE`, or `STATUS_TIMEOUT` when it exceeds the timeout |
| Return flow (`flow: "return"`) | 1018, 1019, 1027, 1031, 1051, 1060, 1063, 1066, 1071, 1074, 1086, 1087 | |
| Very long `status_label` | 1025, 1075 | A label that must wrap or truncate in the UI |
| Cancelled in Shopify | 1043, 1065, 1082, 1102, 1105 | `statusSource: "shopify"`, tracking suppressed |

Note that 1065 and 1105 are cancelled in Shopify while the Status API still reports
`IN_TRANSIT` — these are the orders that exercise the
[conflict rule](#conflict-rules-who-wins).

---

## Testing

```bash
npm test          # 84 tests
npm test -- --watch
```

`node:test` only, no test framework. Nothing touches the network: upstream calls are
either injected fakes or `t.mock.method(globalThis, 'fetch', ...)`.

What the suite deliberately covers:

- **Auth**: wrong keys, prefix keys, a key of the same length, unset key.
- **"No upstream call was made"**, asserted via call counters, for every rejection
  path — a bad key or a bad order number must not spend quota.
- **Injection**: filters cannot smuggle extra Shopify search syntax.
- **PII**: a built response cannot contain customer fields even when the fixture has
  them.
- **Degradation**: malformed timestamps, unknown enums, missing money, `null` nodes.
- **Pagination**: multi-page line-item fetches, and stopping at the page cap.

`npm run sweep -- ../order-numbers.txt` is the recon script: it runs real order
numbers through both upstreams and prints a table of which edge cases each one
exercises (unknown status codes, missing timestamps, items without a product). Raw
responses land in `./recon`, which is gitignored.

---

## Deploying

Vercel zero-config: `api/**.js` become serverless functions automatically. Set the
env vars in project settings and push. `dev-server.js` and `scripts/` are not part
of the deployed surface.

Live at `https://middleware-neon.vercel.app`. Because `.env` is gitignored and never
deployed, each variable in the [Configuration](#configuration) table has to be set
in Vercel project settings separately — including `ADMIN_API_KEY`, without which the
two `/api/orders*` routes answer `500 CONFIG_ERROR` instead of serving.

A quick way to tell whether the deployed instance is configured, without needing the
key: `curl -s https://middleware-neon.vercel.app/api/orders` should answer `401
UNAUTHORIZED`. A `500 CONFIG_ERROR` means `ADMIN_API_KEY` is missing in Vercel.

Nothing in the code is Vercel-specific beyond the three files in `api/`. The cores
are plain `(req) => response` functions, so Cloudflare Workers or a long-running
Node server need only a different adapter.

### Rate limiting: the open question

`/api/track` is public, so any site can call it and spend the Shopify and Status API
budgets. Right now the only backstops are Shopify's cost-based limiter and the
Status API's own 30 req/min key — there is **no per-IP limit in this middleware**.

Before relying on this in production, add one at the edge (Vercel WAF, Cloudflare)
or in `handleTrack`. A per-IP token bucket keyed on the order number would also
blunt order-number enumeration, which is currently rate-limited only by how fast the
upstreams answer.
