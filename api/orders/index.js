// Vercel serverless function: GET /api/orders
// Requires the ADMIN_API_KEY in an x-api-key header.
import { handleOrderList } from '../../src/order-list-handler.js';

export default async function handler(req, res) {
  const result = await handleOrderList({
    method: req.method,
    url: req.url,
    apiKey: req.headers['x-api-key'],
  });

  res.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value);
  }
  res.end(result.body === null ? undefined : JSON.stringify(result.body));
}
