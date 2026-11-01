// Accepts "1001" and "#1001" (surrounding whitespace ignored).
// Returns the digits only, or null for anything else, before any API is called.
const ORDER_NUMBER = /^#?(\d{1,10})$/;

export function parseOrderNumber(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(ORDER_NUMBER);
  return match ? match[1] : null;
}
