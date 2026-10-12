import { describe, expect, it } from 'vitest';
import { clearAuthRateLimitsForRequest } from '@/lib/authRateLimit';
import { createFakeRedis } from './fakeRedis';

describe('clearAuthRateLimitsForRequest', () => {
  it('удаляет лимиты входа и каталога этого tgId с текущего IP одним DEL', async () => {
    const redis = createFakeRedis();
    const keys = [
      'block:1.2.3.4:555', 'rate:1.2.3.4:555', 'viol:1.2.3.4:555',
      'catalog_block:1.2.3.4:555', 'catalog_fail:1.2.3.4:555', 'block:1.2.3.4:demo_555',
    ];
    for (const k of keys) redis.store.set(k, 1);
    redis.store.set('block:9.9.9.9:555', 1);      // другой IP — не трогаем
    redis.store.set('block:1.2.3.4:777', 1);      // другой студент — не трогаем

    let delCalls = 0;
    const del = redis.del.bind(redis);
    redis.del = (async (...k: string[]) => { delCalls++; return del(...k); }) as typeof redis.del;

    await clearAuthRateLimitsForRequest(redis, '555', '1.2.3.4');

    expect(delCalls).toBe(1);
    for (const k of keys) expect(redis.store.has(k)).toBe(false);
    expect(redis.store.has('block:9.9.9.9:555')).toBe(true);
    expect(redis.store.has('block:1.2.3.4:777')).toBe(true);
  });
});
