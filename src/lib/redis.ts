import { Redis } from '@upstash/redis';
import { createNativeRedisFromEnv, type NativeRedisClient } from '@/lib/nativeRedis';

/** Общий контракт Redis для Upstash REST и Timeweb TCP (ioredis). */
export type AppRedis = {
  get<T = unknown>(key: string): Promise<T | null>;
  /** nx: записать только если ключа нет; вернёт null, если ключ уже занят. */
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  exists(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  sadd(key: string, ...members: (string | number)[]): Promise<number>;
  srem(key: string, ...members: (string | number)[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, member: string | number): Promise<number>;
  scan(cursor: number, opts: { match: string; count: number }): Promise<[number, string[]]>;
  pipeline(): {
    get(key: string): unknown;
    sismember(key: string, member: string | number): unknown;
    exec(): Promise<unknown[]>;
  };
};

function hasNativeRedisEnv(): boolean {
  return !!(process.env.REDIS_URL?.trim() || process.env.REDIS_HOST?.trim());
}

// Один клиент на процесс. Раньше каждый вызов открывал новое TCP-соединение
// (бот-вебхук — на каждый апдейт) и никогда его не закрывал: соединения
// копились до maxclients. globalThis — чтобы клиент переживал HMR в dev.
const globalForRedis = globalThis as unknown as { __appRedis?: AppRedis };

/**
 * Timeweb / обычный Redis: REDIS_URL или REDIS_HOST+REDIS_PASSWORD.
 * Upstash / Vercel KV: UPSTASH_REDIS_REST_* или KV_REST_API_*.
 * Нативный Redis предпочтительнее, если задан оба варианта.
 */
export function createRedisFromEnv(): AppRedis {
  if (!globalForRedis.__appRedis) {
    globalForRedis.__appRedis = buildRedisFromEnv();
  }
  return globalForRedis.__appRedis;
}

function buildRedisFromEnv(): AppRedis {
  if (hasNativeRedisEnv()) {
    return createNativeRedisFromEnv() as AppRedis;
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
  }) as unknown as AppRedis;
}

export type { NativeRedisClient };
