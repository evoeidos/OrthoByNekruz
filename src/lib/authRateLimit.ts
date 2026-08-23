import type { AppRedis } from '@/lib/redis';

type RedisScanDel = {
  scan: (cursor: number, opts: { match: string; count: number }) => Promise<[number | string, string[]]>;
  del:  (...keys: [string, ...string[]]) => Promise<unknown>;
};

const AUTH_PREFIXES = ['block', 'rate', 'viol', 'catalog_block', 'catalog_fail', 'catalog_open'];

/** Снимает лимиты входа и каталога для tgId (все IP). */
export async function clearAuthRateLimitsForTgId(redis: RedisScanDel, tgId: string): Promise<number> {
  const id = String(tgId).trim();
  const suffixes = [id, `demo_${id}`];
  const prefixes = AUTH_PREFIXES;
  let deleted = 0;

  for (const suffix of suffixes) {
    for (const prefix of prefixes) {
      const pattern = `${prefix}:*:${suffix}`;
      let cur = 0;
      do {
        const [nextCur, keys] = await redis.scan(cur, { match: pattern, count: 100 });
        cur = Number(nextCur);
        if (keys.length > 0) {
          await redis.del(...(keys as [string, ...string[]]));
          deleted += keys.length;
        }
      } while (cur !== 0);
    }
  }

  return deleted;
}

/** Из ключа block:*:{suffix} или catalog_block:*:{suffix} достаёт TG ID для админки. */
export function tgIdFromRateBlockKey(key: string): string | null {
  const suffix = key.split(':').pop() ?? '';
  const id = suffix.startsWith('demo_') ? suffix.slice(5) : suffix;
  return /^\d{5,12}$/.test(id) ? id : null;
}

export type CatalogRateResult = { blocked: boolean };

/** Лимит просмотра каталога из приложения (отдельно от входа по ключу). */
export async function checkCatalogBrowseLimit(
  redis: AppRedis,
  ip: string,
  tgId: string,
  outcome: 'success' | 'fail',
): Promise<CatalogRateResult> {
  const id = String(tgId).trim();
  const blockKey = `catalog_block:${ip}:${id}`;

  if (await redis.exists(blockKey)) {
    return { blocked: true };
  }

  if (outcome === 'fail') {
    const failKey = `catalog_fail:${ip}:${id}`;
    const attempts = await redis.incr(failKey);
    if (attempts === 1) await redis.expire(failKey, 3600);
    if (attempts >= 5) {
      await redis.set(blockKey, '1', { ex: 30 * 60 });
      await redis.del(failKey);
      return { blocked: true };
    }
    return { blocked: false };
  }

  await redis.del(`catalog_fail:${ip}:${id}`);
  return { blocked: false };
}
