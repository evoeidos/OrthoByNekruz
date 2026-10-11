import type { AppRedis } from '@/lib/redis';

/**
 * Redis в памяти для тестов: подмножество AppRedis, которое используют
 * userLock и логика пользователей. Каждая операция — с небольшой задержкой,
 * чтобы параллельные запросы реально перемешивались, как по сети.
 */
export function createFakeRedis(opts: { failLockSet?: boolean } = {}) {
  const store = new Map<string, unknown>();
  const tick = () => new Promise(r => setTimeout(r, 2));
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  const redis = {
    store,
    async get<T = unknown>(key: string): Promise<T | null> {
      await tick();
      return store.has(key) ? clone(store.get(key) as T) : null;
    },
    async set(key: string, value: unknown, o: { ex?: number; nx?: boolean } = {}) {
      await tick();
      if (opts.failLockSet && key.startsWith('user_lock:')) throw new Error('redis down');
      if (o.nx && store.has(key)) return null;
      store.set(key, clone(value));
      return 'OK';
    },
    async del(...keys: string[]) {
      await tick();
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
    async exists(key: string) {
      await tick();
      return store.has(key) ? 1 : 0;
    },
    async incr(key: string) {
      await tick();
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    async expire() { return 1; },
  };
  return redis as typeof redis & AppRedis;
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
