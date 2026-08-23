/** Redis недоступен (лимит Upstash и т.п.) — не разлогинивать, отдавать кэш. */
export function isRedisUnavailableError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    msg.includes('max daily request limit')
    || msg.includes('max request limit')
    || msg.includes('rate limit')
    || msg.includes('rate-limited')
    || msg.includes('rate limited')
    || msg.includes('quota')
    || msg.includes('limit exceeded')
    || msg.includes('temporarily rate')
  );
}
