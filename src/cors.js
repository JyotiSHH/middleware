// /api/track is a public endpoint: any origin may read it.
// That is safe for the response body (merge.js whitelists PII-free fields only),
// but it does mean any site can spend our Shopify / Status API quota, so rate
// limiting is the guard here, not the origin.

// No credentials are involved (no cookies, no auth header), so the wildcard is
// valid: browsers reject '*' only for credentialed requests.
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
