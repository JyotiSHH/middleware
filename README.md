# order-tracking middleware

A small API that sits between a Shopify store and two other services. It collects
order and delivery data, strips out anything personal, and returns clean JSON that
the storefront can show directly.

## Why it exists

The order tracking page needs two things:

1. **Order data** from the **Shopify Admin API** (what was bought, how much it cost).
2. **Delivery data** from the **Status API** (where the parcel is right now).

The browser cannot call either one:

- Shopify needs a secret password. It also sends back the customer's name, email,
  phone and address, which we do not want on the page.
- The Status API needs its own key, and only allows 30 requests per minute.

So this service keeps both keys on the server. It asks each service for only the
fields the page shows, joins the two answers together, and sends back a result with
**no personal data in it at all**. If a shopper opens their browser dev tools, they
see product names, quantities, prices and delivery steps. They never see an address.

---

## Quick start

```bash
cp .env.example .env     # then fill in the values
npm run dev              # http://localhost:3000
npm run routes           # list every endpoint
npm test                 # 84 tests, no internet needed
```

It is already running here:

```bash
curl "https://middleware-neon.vercel.app/api/track?order=1010"
```

You need Node 20.6 or newer. There are no packages to install.

---

## The endpoints

| Method | Path | Who can call it | What you get |
| --- | --- | --- | --- |
| GET | `/` (and `/api`) | anyone | Health check |
| GET | `/api/track?order=1001` | anyone | One order plus its delivery status |
| GET | `/api/orders` | needs a key | A list of all orders |
| GET | `/api/orders/1001` | needs a key | Everything about one order |

`npm run routes` prints this same list in your terminal. It reads `src/routes.js`,
so the terminal list and this table always match.

Every reply is JSON. When things work you get `{ "ok": true, ... }`. When they do
not you get `{ "ok": false, "error": { code, message, retryable } }`. Nothing is
cached.

---

### 1. `GET /` — health check

Call this to check the service is alive. Anyone can call it, and it does not talk to
Shopify or the Status API, so you can check it as often as you like.

```bash
curl https://middleware-neon.vercel.app/
```

```json
{
  "ok": true,
  "status": "ok",
  "service": "order-tracking-middleware",
  "version": "1.0.0",
  "uptimeSeconds": 2,
  "timestamp": "2026-11-01T18:02:11.427Z",
  "checks": { "config": { "ok": true, "adminApiKey": true } }
}
```

If a setting is missing you get **503** and a list of which ones:

```json
{
  "ok": false,
  "status": "unhealthy",
  "checks": { "config": { "ok": false, "missing": ["STATUS_API_KEY"] } }
}
```

It only ever lists the **names** of missing settings, never their values.

---

### 2. `GET /api/track?order=1001` — for the storefront

This is the one the storefront page calls. **Anyone can call it from any website**
(`Access-Control-Allow-Origin: *`). That is safe because the reply has no personal
data in it. But it does mean strangers can use up our Shopify and Status API
allowance. See [What still needs doing](#what-still-needs-doing).

| Setting | Required? | Notes |
| --- | --- | --- |
| `order` | yes | `1001` or `#1001`. Numbers only, up to 10 digits. |

```bash
curl "https://middleware-neon.vercel.app/api/track?order=1010"
```

```json
{
  "ok": true,
  "order": {
    "orderNumber": "1010",
    "name": "#1010",
    "createdAt": "2026-03-24T13:22:53Z",
    "cancelledAt": null,
    "total": { "amount": "1263.95", "currencyCode": "INR" },
    "itemCount": 1,
    "lineItems": [
      {
        "title": "The Collection Snowboard: Liquid",
        "variantTitle": null,
        "quantity": 1,
        "image": { "url": "https://cdn.shopify.com/...240x240.jpg", "alt": "A snowboard" },
        "hasProduct": true
      }
    ],
    "hasMoreLineItems": false
  },
  "shipment": {
    "flow": "forward",
    "status": "IN_TRANSIT",
    "statusLabel": "In transit",
    "expectedDelivery": "2026-10-28",
    "deliveredAt": null,
    "tracking": { "id": "BD123", "carrier": "Bluedart", "url": "https://track.example/BD123" },
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

**You get either `shipment` or `shipmentError`, never both.** If the delivery lookup
fails we still send the order back with a `200`, because a broken delivery lookup
should not hide the order:

```json
{
  "ok": true,
  "order": { "...": "..." },
  "shipment": null,
  "shipmentError": { "code": "NO_SHIPMENT", "message": "Order has no shipment yet", "retryable": true },
  "statusSource": "status_api"
}
```

`statusSource` is normally `"status_api"`. It becomes `"shopify"` when the order was
cancelled — see [When the two services disagree](#when-the-two-services-disagree).

---

### 3. `GET /api/orders` — list all orders

Needs a key. Newest orders come first.

| Setting | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | Between 1 and 250 |
| `cursor` | - | Use `pageInfo.endCursor` from the page before |
| `status` | - | `open`, `closed`, `cancelled`, `any` |
| `financialStatus` | - | `paid`, `pending`, `refunded`, `partially_refunded`, `partially_paid`, `authorized`, `voided`, `expired`, `unpaid` |
| `fulfillmentStatus` | - | `fulfilled`, `unfulfilled`, `partial`, `shipped`, `unshipped` |
| `createdAtMin` | - | A date, like `2026-01-01` |
| `createdAtMax` | - | A date |

```bash
curl -H "x-api-key: $ADMIN_API_KEY" \
  "https://middleware-neon.vercel.app/api/orders?limit=25&status=open"
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
          "image": { "url": "https://cdn.shopify.com/...240x240.png", "alt": "A bar of wax" },
          "hasProduct": true
        }
      ],
      "hasMoreLineItems": false
    }
  ],
  "pageInfo": { "hasNextPage": true, "endCursor": "eyJsYXN0X2lkIjoxOTAw..." }
}
```

Each order here has the **same shape** as the `order` part of `/api/track`. Both use
the same code (`buildOrder()` in `src/merge.js`), so there is only one place to
change if the shape needs to change.

Two things this endpoint leaves out on purpose:

- **No delivery status.** That would mean one Status API call per order, and that API
  only allows 30 per minute. Use `/api/orders/1001` when you need delivery status.
- **Only 10 items per order.** A list of 25 orders would otherwise pull hundreds of
  items. `hasMoreLineItems` tells you when an order has more.

Filters are checked against a fixed list of allowed values before they are used. So
something like `?status=open OR status:closed` cannot sneak extra search terms into
the Shopify query. A bad filter returns `400 INVALID_QUERY` and no call is made.

#### Getting every single order

One call gives you one page. Keep going until `hasNextPage` is false:

```bash
C=""
while :; do
  R=$(curl -s -H "x-api-key: $ADMIN_API_KEY" \
      "https://middleware-neon.vercel.app/api/orders?limit=250&cursor=$C")
  echo "$R" | jq -c '.orders[]'
  [ "$(echo "$R" | jq -r .pageInfo.hasNextPage)" = true ] || break
  C=$(echo "$R" | jq -r .pageInfo.endCursor)
done
```

The endpoint does not fetch every page for you. On a big store that would take too
long and the request would time out halfway, leaving you with a broken reply and no
way to carry on.

---

### 4. `GET /api/orders/1001` — one order in full

Needs a key. Gives you the full price breakdown, every delivery attempt, product
codes, and how many items were refunded — plus the same delivery status that
`/api/track` returns.

```bash
curl -H "x-api-key: $ADMIN_API_KEY" https://middleware-neon.vercel.app/api/orders/1001
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
        "image": { "url": "https://cdn.shopify.com/...240x240.jpg", "alt": "A snowboard" },
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

Prices are always **text**, like `"1263.95"`, not numbers. Numbers can lose the last
penny when a computer rounds them, text cannot.

`quantity` is what was ordered. `currentQuantity` is what is left after refunds or
changes to the order.

This endpoint fetches **all** the items on the order, 50 at a time, up to 500 in
total. `hasMoreLineItems` is only true for an order bigger than that.

---

## The key for admin endpoints

`/` and `/api/track` are open to anyone. The two `/api/orders` endpoints need a key
in a header:

```
x-api-key: <ADMIN_API_KEY>
```

Make one like this: `node -e "console.log(crypto.randomUUID())"`

Four rules, and why each one is there:

| Rule | Reason |
| --- | --- |
| The key is compared using `crypto.timingSafeEqual` | A normal `===` check finishes faster when the first letters are wrong. Someone could time the replies and guess the key letter by letter. |
| The key is checked **before** the order number is read | Otherwise a `401` for a bad key and a `404` for a missing order would tell a stranger which order numbers are real. |
| If `ADMIN_API_KEY` is not set, these endpoints turn off and return `500` | An empty setting must never mean "let everybody in". |
| These endpoints send **no CORS headers** | The key must never be put in website code, where anyone could read it. These are for server-to-server calls only. |

---

## Errors

Every error looks the same:

```json
{ "ok": false, "error": { "code": "ORDER_NOT_FOUND", "message": "No order #9999", "retryable": false } }
```

Use `code` in your own code. It never changes, so you can match on it and show your
own message. `message` is for developers, so do not show it to a shopper.
`retryable` tells you whether trying again might help.

### When the request is wrong

| Code | HTTP | Meaning |
| --- | --- | --- |
| `INVALID_ORDER_NUMBER` | 400 | `order` was not 1 to 10 digits |
| `INVALID_QUERY` | 400 | A filter on `/api/orders` was not valid |
| `UNAUTHORIZED` | 401 | The `x-api-key` header is missing or wrong |
| `ORDER_NOT_FOUND` | 404 | No order with that exact number |
| `METHOD_NOT_ALLOWED` | 405 | You used something other than `GET` |

### When something breaks on our side

| Code | HTTP | Retryable | Meaning |
| --- | --- | --- | --- |
| `CONFIG_ERROR` | 500 | no | A required setting is missing |
| `INTERNAL_ERROR` | 500 | yes | Something unexpected broke. Details stay in the logs. |
| `ORDER_LOOKUP_FAILED` | 502 | yes | Could not reach Shopify, or Shopify sent an error |
| `ORDER_LOOKUP_TIMEOUT` | 504 | yes | Shopify was too slow |

### Delivery status problems (`shipmentError`)

These never break the request. You still get the order and a `200`.

| Code | Retryable | Meaning |
| --- | --- | --- |
| `NO_SHIPMENT` | yes | The parcel has not been created yet. **Very common — see [Orders you can test with](#orders-you-can-test-with).** |
| `STATUS_RATE_LIMITED` | yes | Too many requests. Sometimes includes `retryAfter` in seconds. |
| `STATUS_TIMEOUT` | yes | The Status API was too slow |
| `STATUS_UNAVAILABLE` | yes | The Status API is down, or sent back nothing |
| `STATUS_CONFIG_ERROR` | no | **Our** key is wrong. Trying again will not help. |

> **Note for the storefront page:** do not show the same message for all of these.
> `NO_SHIPMENT` means the parcel has not shipped yet, so "try again in a moment" is
> wrong and misleading. Only `STATUS_TIMEOUT`, `STATUS_UNAVAILABLE` and
> `STATUS_RATE_LIMITED` should suggest trying again.

---

## Settings

All settings are environment variables. Use `.env` on your machine, and the project
settings page on Vercel.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SHOP_DOMAIN` | yes | - | Like `your-store.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | yes | - | From your custom Shopify app |
| `SHOPIFY_CLIENT_SECRET` | yes | - | |
| `SHOPIFY_API_VERSION` | no | `2026-10` | |
| `STATUS_API_BASE` | yes | - | The Status API address |
| `STATUS_API_KEY` | yes | - | The Status API key |
| `ADMIN_API_KEY` | no | - | Needed for the `/api/orders` endpoints. Leave it empty to turn them off. |
| `SHOPIFY_TIMEOUT_MS` | no | `5000` | How long to wait for Shopify |
| `STATUS_TIMEOUT_MS` | no | `7000` | How long to wait for the Status API |

If a required setting is missing, the log says which **names** are missing. It never
logs the values.

The Shopify app only needs `read_orders` permission. **Do not give it
`read_customers`.** Nothing here uses it, and without it even a bug could not leak
customer details.

---

## Orders you can test with

The Status API has **no delivery data for orders 1001 to 1009**. Those are the first
numbers most people try, so it can look like the service is broken when it is not.
`/api/track?order=1001` correctly returns the order with
`shipmentError: NO_SHIPMENT`.

**Use 1010 or higher to see delivery data.**

Out of the 109 orders in the store (#1001 to #1109): 91 have delivery data, 14 have
none, and 4 give an error.

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

Useful ones for testing the page design:

| What you want to test | Orders | What comes back |
| --- | --- | --- |
| No delivery data yet | 1001-1009, 1028, 1037, 1041, 1044, 1059 | `shipment: null` and `NO_SHIPMENT` |
| The Status API is broken | 1029, 1064, 1081 | `STATUS_UNAVAILABLE` |
| The Status API is slow or down | 1034 | `STATUS_UNAVAILABLE` or `STATUS_TIMEOUT` |
| A return instead of a delivery | 1018, 1019, 1027, 1031, 1051, 1060, 1063, 1066, 1071, 1074, 1086, 1087 | `flow: "return"` |
| A very long status label | 1025, 1075 | Text that has to wrap or be cut short |
| Cancelled in Shopify | 1043, 1065, 1082, 1102, 1105 | `statusSource: "shopify"`, no tracking shown |

Orders 1065 and 1105 are interesting: Shopify says they are cancelled, but the Status
API still says `IN_TRANSIT`. They are the ones that test the rule below.

---

## When the two services disagree

Shopify and the Status API can tell us different things. The rules are always the
same:

1. **Shopify decides whether an order is cancelled.** If Shopify says cancelled, the
   answer says cancelled, whatever the Status API thinks. We do not even call the
   Status API. `statusSource` becomes `"shopify"`.
2. **A cancelled order shows no tracking, no delivery date and no later steps.** They
   would only mislead the shopper. It shows just "Order Placed" then "Cancelled".
3. **The Status API decides where the parcel is**, for every order that is not
   cancelled.
4. **The order number has to match exactly.** Shopify's search is fuzzy, so searching
   for `#1001` can also return `#10011`. Anything that is not an exact match counts
   as not found.

---

## How the code is arranged

```
api/                        thin wrappers for Vercel
  index.js                  ->  /     health check
  track.js                  ->  /api/track
  orders/index.js           ->  /api/orders
  orders/[order].js         ->  /api/orders/:orderNumber
src/
  health-handler.js         the health check
  handler.js                /api/track
  order-list-handler.js     /api/orders
  order-details-handler.js  /api/orders/:orderNumber
  order-list.js             checks the filters on /api/orders
  routes.js                 service name, version, endpoint list
  validate.js               checks order numbers
  auth.js                   checks the admin key
  config.js                 reads the settings
  cors.js                   CORS headers for the public endpoint
  errors.js                 one error type for everything
  shopify.js                talks to Shopify
  status-api.js             talks to the Status API
  merge.js                  turns replies into the public shape
  order-details.js          turns replies into the full order shape
scripts/
  routes.js                 prints the endpoint list
  sweep.js                  tries every test order and prints a table
test/                       tests, no internet needed
dev-server.js               runs it on your machine
vercel.json                 one line: make / go to /api
```

**The files in `api/` do almost nothing.** Each one just passes
`{ method, url, apiKey }` to the real code in `src/`, then writes the reply back out.
The code in `src/` knows nothing about Vercel or web servers. That means two things:
it can be tested without starting a server, and moving to a different host only means
rewriting four small files.

**Every handler can be given fake helpers.** Each one takes a `deps` object that
defaults to the real Shopify and Status API code. Tests pass in fakes and count how
many times each was called. That is how we **prove** no API call was made when a
request was rejected, instead of just hoping.

### Talking to Shopify

`src/shopify.js` deals with everything Shopify demands:

- **It reuses the password.** Shopify gives us a temporary token. We keep it in
  memory and reuse it until 5 minutes before it expires. If several requests arrive
  at once, they share one token request instead of asking for one each.
- **It retries.** Up to 3 tries. If Shopify says the token is bad, we get a new one
  and try again. If Shopify is busy or broken, we wait and try again.
- **It waits the right amount.** Shopify limits us by query cost, not by request
  count. When we hit the limit, Shopify tells us how fast our budget refills, so we
  wait exactly long enough instead of guessing.

### Talking to the Status API

`src/status-api.js` **never throws an error**. It always returns a result object.
This is on purpose: if the delivery lookup fails, the shopper should still see their
order.

### Why we copy fields one by one

`merge.js` and `order-details.js` list every field they want **by name**. Nothing is
copied in bulk. This gives us:

- **Privacy that does not depend on remembering.** If Shopify adds a new field
  tomorrow, even a personal one, it is simply not copied. We never have to maintain a
  list of things to block.
- **A page that does not break on bad data.** A broken date becomes `null`, so the
  page can say "Date unavailable" instead of "Invalid Date". An unknown delivery step
  becomes `pending`. An unknown status becomes `null`.
- **Safe links.** Only `http` and `https` links are kept, so a dangerous
  `javascript:` link can never reach the page.
- **Tidier text.** Shopify uses "Default Title" for products with no options, and we
  turn that into `null` so the page does not print it. A missing label is built from
  the code, so `HELD_AT_CUSTOMS` becomes "Held at customs".

Personal data is kept out in two ways. First, we never **ask** for `customer`,
`email`, `phone`, `shippingAddress`, `billingAddress` or `note`, so it never reaches
this service at all. Second, a test checks that those values cannot appear in a reply
even if Shopify sends them anyway.

> `note` is left out on purpose. It looks harmless, but shoppers often type their
> phone number or address into the order note.

---

## Tests

```bash
npm test
npm test -- --watch
```

84 tests, using Node's own test runner. No test library, and nothing touches the
internet.

The tests check, on purpose:

- **The key.** Wrong keys, keys that are only partly right, keys of the right length,
  and no key at all.
- **That no API call happened** when a request was rejected. A bad key or a bad order
  number must not use up our allowance.
- **That filters cannot be abused** to add extra Shopify search terms.
- **That personal data cannot get through**, even when the fake Shopify reply
  contains it.
- **That bad data does not crash anything**: broken dates, unknown values, missing
  prices, empty entries.
- **That paging works**, including stopping at the limit.

There is also a recon script:

```bash
npm run sweep -- ../order-numbers.txt
```

It runs real order numbers through both services and prints a table of what each one
returns. Full replies are saved in `./recon`, which git ignores.

---

## Deploying

Vercel needs no setup. Every file in `api/` becomes its own function. Add the
settings in the project settings page and push.

It is live at `https://middleware-neon.vercel.app`.

`.env` is never uploaded, so **every setting has to be added in Vercel separately**,
including `ADMIN_API_KEY`. Without it the `/api/orders` endpoints return
`500 CONFIG_ERROR`.

To check a deployment is set up correctly without needing the key:

```bash
curl -s https://middleware-neon.vercel.app/api/orders
```

A `401 UNAUTHORIZED` means it is fine. A `500 CONFIG_ERROR` means `ADMIN_API_KEY` is
missing in Vercel.

Only the four files in `api/` know anything about Vercel. Everything in `src/` is
plain code, so moving to Cloudflare Workers or a normal Node server just needs four
new wrapper files.

---

## What still needs doing

**There is no rate limit.** `/api/track` is open to the whole internet, so anyone can
call it over and over and use up our Shopify and Status API allowance. The only
things slowing them down today are Shopify's own cost limit and the Status API's
30-per-minute key.

Order numbers also run in order (1001, 1002, 1003...), so someone could walk through
them one by one.

Before trusting this in production, add a limit per IP address. Either at the edge
(Vercel WAF or Cloudflare) or in `handleTrack` itself.
