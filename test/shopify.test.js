import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { lookupOrder, lookupOrderDetails, resetTokenCache } from '../src/shopify.js';
import { cfg } from './helpers.js';

const isTokenCall = (url) => String(url).endsWith('/admin/oauth/access_token');
const tokenResponse = () => Response.json({ access_token: 'tok', expires_in: 86399 });
const ordersResponse = (nodes) => Response.json({ data: { orders: { nodes } } });

beforeEach(() => resetTokenCache());

test('reuses the access token instead of fetching one per lookup', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) =>
    isTokenCall(url) ? tokenResponse() : ordersResponse([{ name: '#1001' }]),
  );
  await lookupOrder(cfg, '1001');
  await lookupOrder(cfg, '1001');
  const tokenCalls = fetchMock.mock.calls.filter((c) => isTokenCall(c.arguments[0]));
  assert.equal(tokenCalls.length, 1);
});

test('queries by order name and requires an exact match', async (t) => {
  let sentQuery;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (isTokenCall(url)) return tokenResponse();
    sentQuery = JSON.parse(opts.body).variables.query;
    return ordersResponse([{ name: '#10011' }]);
  });
  assert.equal(await lookupOrder(cfg, '1001'), null);
  assert.equal(sentQuery, 'name:#1001');
});

test('backs off and retries when THROTTLED', async (t) => {
  let graphqlCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (isTokenCall(url)) return tokenResponse();
    graphqlCalls++;
    if (graphqlCalls === 1) {
      return Response.json({
        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
        extensions: { cost: { requestedQueryCost: 60, throttleStatus: { currentlyAvailable: 50, restoreRate: 1000 } } },
      });
    }
    return ordersResponse([{ name: '#1001' }]);
  });
  const order = await lookupOrder(cfg, '1001');
  assert.equal(order.name, '#1001');
  assert.equal(graphqlCalls, 2);
});

test('refreshes the token once on 401', async (t) => {
  let tokenCalls = 0;
  let graphqlCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (isTokenCall(url)) {
      tokenCalls++;
      return tokenResponse();
    }
    graphqlCalls++;
    return graphqlCalls === 1 ? new Response('', { status: 401 }) : ordersResponse([{ name: '#1001' }]);
  });
  await lookupOrder(cfg, '1001');
  assert.equal(tokenCalls, 2);
});

test('token failure becomes ORDER_LOOKUP_FAILED', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 400 }));
  await assert.rejects(lookupOrder(cfg, '1001'), { code: 'ORDER_LOOKUP_FAILED' });
});

// ---------- lookupOrderDetails ----------

const detailsResponse = (nodes) => Response.json({ data: { orders: { nodes } } });
const pageResponse = (lineItems) => Response.json({ data: { order: { lineItems } } });

const detailOrder = (lineItems) => ({ id: 'gid://shopify/Order/1', name: '#1001', lineItems });

test('lookupOrderDetails requires an exact name match', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) =>
    isTokenCall(url) ? tokenResponse() : detailsResponse([detailOrder({ pageInfo: {}, nodes: [] })]),
  );
  assert.equal(await lookupOrderDetails(cfg, '1002'), null);
});

test('follows line-item pagination and returns every item', async (t) => {
  let graphqlCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (isTokenCall(url)) return tokenResponse();
    graphqlCalls++;
    const { variables } = JSON.parse(opts.body);
    if (graphqlCalls === 1) {
      return detailsResponse([
        detailOrder({ pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [{ title: 'a' }] }),
      ]);
    }
    assert.equal(variables.id, 'gid://shopify/Order/1');
    assert.equal(variables.after, graphqlCalls === 2 ? 'c1' : 'c2');
    return pageResponse({
      pageInfo: { hasNextPage: graphqlCalls === 2, endCursor: 'c2' },
      nodes: [{ title: graphqlCalls === 2 ? 'b' : 'c' }],
    });
  });

  const order = await lookupOrderDetails(cfg, '1001');
  assert.deepEqual(order.lineItems.nodes.map((n) => n.title), ['a', 'b', 'c']);
  assert.equal(order.lineItems.pageInfo.hasNextPage, false);
  assert.equal(graphqlCalls, 3);
});

test('stops paging after the cap and reports hasNextPage', async (t) => {
  let graphqlCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (isTokenCall(url)) return tokenResponse();
    graphqlCalls++;
    const lineItems = { pageInfo: { hasNextPage: true, endCursor: `c${graphqlCalls}` }, nodes: [{ title: 'x' }] };
    return graphqlCalls === 1 ? detailsResponse([detailOrder(lineItems)]) : pageResponse(lineItems);
  });

  const order = await lookupOrderDetails(cfg, '1001');
  assert.equal(graphqlCalls, 10); // MAX_LINE_ITEM_PAGES
  assert.equal(order.lineItems.nodes.length, 10);
  assert.equal(order.lineItems.pageInfo.hasNextPage, true);
});
