// Prints every endpoint this middleware exposes: npm run routes
// The table itself lives in src/routes.js, so the CLI and the service can never
// disagree about what exists.
import { pathToFileURL } from 'node:url';
import { QUERY_PARAMS, ROUTES } from '../src/routes.js';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// Colour only when stdout is a terminal, so piping to a file stays clean.
const paint = (code, s) => (process.stdout.isTTY ? `${code}${s}${RESET}` : s);

export function printRoutes({ baseUrl = 'https://middleware-neon.vercel.app', params = true } = {}) {
  const authLabel = (auth) =>
    auth === 'public' ? paint(GREEN, 'public   ') : paint(YELLOW, 'x-api-key');

  console.log(`\n${paint(BOLD, 'order-tracking middleware')} ${paint(DIM, `- ${baseUrl}`)}\n`);

  for (const route of ROUTES) {
    console.log(`  ${paint(BOLD, route.method.padEnd(4))} ${paint(CYAN, route.path)}`);
    console.log(`       ${authLabel(route.auth)}  ${route.summary}`);
    console.log(`       ${paint(DIM, route.file)}\n`);
  }

  if (!params) return;

  for (const [path, rows] of Object.entries(QUERY_PARAMS)) {
    console.log(`  ${paint(BOLD, `${path} query params`)}`);
    const width = Math.max(...rows.map(([name]) => name.length));
    for (const [name, description] of rows) {
      console.log(`    ${paint(CYAN, name.padEnd(width))}  ${paint(DIM, description)}`);
    }
    console.log();
  }

  console.log(paint(DIM, '  Admin endpoints need:  -H "x-api-key: $ADMIN_API_KEY"'));
  console.log(paint(DIM, '  Full reference:        README.md\n'));
}

// Only when run directly, not when imported for the banner.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  printRoutes();
}
