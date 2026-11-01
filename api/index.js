// Vercel serverless function: GET /api  (and GET / via the vercel.json rewrite)
// The service's health check.
import { handleHealth } from '../src/health-handler.js';

export default async function handler(req, res) {
  const result = handleHealth({ method: req.method, url: req.url });

  res.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value);
  }
  res.end(result.body === null ? undefined : JSON.stringify(result.body));
}
