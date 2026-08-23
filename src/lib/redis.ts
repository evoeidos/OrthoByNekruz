import { Redis } from '@upstash/redis';

/**
 * Upstash / Vercel KV: на Vercel часто KV_REST_API_*,
 * Redis.fromEnv() ждёт UPSTASH_REDIS_REST_*.
 * На Timeweb нужны оба варианта, иначе /api/auth падает с 500.
 */
export function createRedisFromEnv(): Redis {
  const url =
    process.env.UPSTASH_REDIS_REST_URL
    || process.env.KV_REST_API_URL
    || '';
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN
    || process.env.KV_REST_API_TOKEN
    || '';

  if (!url || !token) {
    throw new Error(
      'Redis env missing: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN '
      + '(or KV_REST_API_URL + KV_REST_API_TOKEN)',
    );
  }

  return new Redis({
    url,
    token,
    // Auto-pipelining ломается с непонятной ошибкой ("res.map is not a
    // function"), если Upstash вернул объект с ошибкой вместо массива
    // (например при рейт-лимите базы). Без него ошибки Upstash приходят
    // как читаемый UpstashError, который отлавливает isRedisUnavailableError().
    enableAutoPipelining: false,
  });
}
