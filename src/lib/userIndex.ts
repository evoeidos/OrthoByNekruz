import type { AppRedis } from '@/lib/redis';

export const ALL_USER_IDS_KEY = 'all_user_ids';

export async function registerUserId(redis: AppRedis, tgId: string): Promise<void> {
  await redis.sadd(ALL_USER_IDS_KEY, String(tgId));
}

export async function removeUserId(redis: AppRedis, tgId: string): Promise<void> {
  await redis.srem(ALL_USER_IDS_KEY, String(tgId));
}

/** Список ID пользователей. При пустом индексе — одноразовая миграция из user_id:* */
export async function getAllUserIds(redis: AppRedis): Promise<string[]> {
  const fromSet = await redis.smembers(ALL_USER_IDS_KEY);
  if (fromSet && fromSet.length > 0) {
    return fromSet.map(String);
  }

  const ids: string[] = [];
  let cursor = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: 'user_id:*', count: 100 });
    cursor = Number(nextCursor);
    for (const key of keys as string[]) {
      ids.push(key.replace('user_id:', ''));
    }
  } while (cursor !== 0);

  if (ids.length > 0) {
    await redis.sadd(ALL_USER_IDS_KEY, ...(ids as [string, ...string[]]));
  }
  return ids;
}
