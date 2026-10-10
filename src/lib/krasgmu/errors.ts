export class KrasgmuAuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_credentials'
      | 'form_changed'
      | 'network'
      | 'browser_unavailable'
      | 'rate_limited',
  ) {
    super(message);
    this.name = 'KrasgmuAuthError';
  }
}

export function isKrasgmuAuthError(e: unknown): e is KrasgmuAuthError {
  return e instanceof KrasgmuAuthError
    || (e instanceof Error && e.name === 'KrasgmuAuthError');
}
