import type { AppRedis } from '@/lib/redis';

export const ALL_USER_IDS_KEY = 'all_user_ids';

/** Как часто сверять индекс с реальными ключами user_id:* (на процесс). */
const RECONCILE_EVERY_MS = 10 * 60 * 1000;
let lastReconcileAt = 0;

export async function registerUserId(redis: AppRedis, tgId: string): Promise<void> {
  await redis.sadd(ALL_USER_IDS_KEY, String(tgId));
}

export async function removeUserId(redis: AppRedis, tgId: string): Promise<void> {
  await redis.srem(ALL_USER_IDS_KEY, String(tgId));
}

async function scanUserIds(redis: AppRedis): Promise<string[]> {
  const ids: string[] = [];
  let cursor = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: 'user_id:*', count: 1000 });
    cursor = Number(nextCursor);
    for (const key of keys as string[]) {
      ids.push(key.slice('user_id:'.length));
    }
  } while (cursor !== 0);
  return ids;
}

/**
 * Список ID пользователей из индекса all_user_ids. Раз в 10 минут индекс
 * сверяется с ключами user_id:*: запись, созданная в обход registerUserId,
 * всё равно попадёт в админку, а удалённая — пропадёт из индекса.
 */
export async function getAllUserIds(redis: AppRedis): Promise<string[]> {
  const indexed = (await redis.smembers(ALL_USER_IDS_KEY) ?? []).map(String);
  const now = Date.now();
  if (indexed.length > 0 && now - lastReconcileAt < RECONCILE_EVERY_MS) {
    return indexed;
  }
  lastReconcileAt = now;

  const actual = await scanUserIds(redis);
  const actualSet = new Set(actual);
  const indexedSet = new Set(indexed);
  const missing = actual.filter(id => !indexedSet.has(id));
  const dangling = indexed.filter(id => !actualSet.has(id));
  if (missing.length > 0) {
    await redis.sadd(ALL_USER_IDS_KEY, ...(missing as [string, ...string[]]));
  }
  if (dangling.length > 0) {
    await redis.srem(ALL_USER_IDS_KEY, ...(dangling as [string, ...string[]]));
  }
  return actual;
}
