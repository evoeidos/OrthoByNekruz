import { Redis } from '@upstash/redis';
import { createNativeRedisFromEnv, type NativeRedisClient } from '@/lib/nativeRedis';

export type AppRedis = Redis | NativeRedisClient;

function hasNativeRedisEnv(): boolean {
  return !!(process.env.REDIS_URL?.trim() || process.env.REDIS_HOST?.trim());
}

function hasUpstashRestEnv(): boolean {
  const url =
    process.env.UPSTASH_REDIS_REST_URL
    || process.env.KV_REST_API_URL
    || '';
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN
    || process.env.KV_REST_API_TOKEN
    || '';
  return !!(url && token);
}

/**
 * Timeweb / обычный Redis: REDIS_URL или REDIS_HOST+REDIS_PASSWORD.
 * Upstash / Vercel KV: UPSTASH_REDIS_REST_* или KV_REST_API_*.
 * Нативный Redis предпочтительнее, если задан оба варианта.
 */
export function createRedisFromEnv(): AppRedis {
  if (hasNativeRedisEnv()) {
    return createNativeRedisFromEnv();
  }

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
      'Redis env missing: set REDIS_URL (or REDIS_HOST + REDIS_PASSWORD), '
      + 'or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN '
      + '(or KV_REST_API_URL + KV_REST_API_TOKEN)',
    );
  }

  return new Redis({
    url,
    token,
    enableAutoPipelining: false,
  });
}
