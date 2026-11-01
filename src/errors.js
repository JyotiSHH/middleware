// One error type for everything the middleware rejects on purpose.
// `code` is machine-readable; the theme maps it to a locale string.
// `message` is for developers only and is never shown to shoppers as-is.

const RETRYABLE_CODES = new Set(['ORDER_LOOKUP_FAILED', 'ORDER_LOOKUP_TIMEOUT', 'INTERNAL_ERROR']);

export class AppError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: RETRYABLE_CODES.has(this.code) };
  }
}
