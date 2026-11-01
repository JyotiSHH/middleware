// Vercel serverless function: GET /api/track?order=1001
import { handleTrack } from '../src/handler.js';

export default async function handler(req, res) {
  const result = await handleTrack({
    method: req.method,
    url: req.url,
  });

  res.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value);
  }
  res.end(result.body === null ? undefined : JSON.stringify(result.body));
}
