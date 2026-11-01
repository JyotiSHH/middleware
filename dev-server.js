// Local server for development: npm run dev
// Routes mirror the Vercel file layout; the banner comes from scripts/routes.js,
// so this file never carries its own copy of the endpoint list.
import http from 'node:http';
import trackHandler from './api/track.js';
import orderListHandler from './api/orders/index.js';
import orderDetailsHandler from './api/orders/[order].js';
import { printRoutes } from './scripts/routes.js';

const PORT = Number(process.env.PORT) || 3000;

// Mirrors the Vercel file routes: an exact path and one dynamic segment.
const route = (pathname) => {
  if (pathname === '/api/track') return trackHandler;
  if (pathname === '/api/orders') return orderListHandler;
  if (/^\/api\/orders\/[^/]+$/.test(pathname)) return orderDetailsHandler;
  return null;
};

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const handler = route(pathname);
    if (!handler) {
      res.statusCode = 404;
      return res.end();
    }
    return handler(req, res);
  })
  .listen(PORT, () => printRoutes({ baseUrl: `http://localhost:${PORT}`, params: false }));
