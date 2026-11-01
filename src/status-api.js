// Status API client. It never throws: a failed status lookup should not hide
// the order summary, so it returns { shipment, error, httpStatus } instead.

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

const failure = (code, message, { retryable, httpStatus = null, retryAfter = null }) => ({
  shipment: null,
  httpStatus,
  error: { code, message, retryable, ...(retryAfter !== null && { retryAfter }) },
});

export async function fetchShipment(cfg, orderNumber) {
  const url = `${cfg.statusApiBase}/v1/shipments/${encodeURIComponent(orderNumber)}`;

  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': cfg.statusApiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(cfg.statusTimeoutMs),
    });
    const httpStatus = res.status;

    if (res.ok) {
      return { shipment: await res.json(), error: null, httpStatus };
    }

    switch (httpStatus) {
      case 404:
        return failure('NO_SHIPMENT', 'Order has no shipment yet', { retryable: true, httpStatus });
      case 429:
        return failure('STATUS_RATE_LIMITED', 'Status API rate limit reached', {
          retryable: true,
          httpStatus,
          retryAfter: parseRetryAfter(res.headers.get('retry-after')),
        });
      case 401:
      case 403:
        // Our key is wrong: the shopper can't fix this by retrying.
        console.error(`[status-api] key rejected (HTTP ${httpStatus}); check STATUS_API_KEY`);
        return failure('STATUS_CONFIG_ERROR', 'Status API rejected our credentials', {
          retryable: false,
          httpStatus,
        });
      default: // 500, 503 and anything unexpected
        return failure('STATUS_UNAVAILABLE', 'Status API is unavailable', { retryable: true, httpStatus });
    }
  } catch (err) {
    // The timeout signal also covers reading the body, so a slow body lands here too.
    if (err?.name === 'TimeoutError') {
      return failure('STATUS_TIMEOUT', 'Status API did not respond in time', { retryable: true });
    }
    console.error('[status-api] request failed:', err?.message);
    return failure('STATUS_UNAVAILABLE', 'Could not reach the Status API', { retryable: true });
  }
}
