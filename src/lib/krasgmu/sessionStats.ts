import type { AppRedis } from '@/lib/redis';
import type { KrasgmuBindingRecord } from '@/lib/krasgmu/types';

// Замер срока жизни сессии krasgmu.ru: от него зависит, сколько входов через
// Browserless тратится на студента. Каждая истёкшая сессия — отдельный ключ с TTL,
// без списков (их нет в AppRedis) и без гонок между параллельными запросами.

const KEY_PREFIX = 'krasgmu_session_death:';
const KEEP_SEC = 30 * 24 * 60 * 60;

export type KrasgmuSessionDeath = {
  at: string;
  /** Сессия точно была жива столько минут после входа (последняя удачная проверка). */
  aliveMin: number;
  /** И точно умерла не позже, чем через столько минут после входа. */
  deadByMin: number;
  /** Минут без запросов перед тем, как сессию нашли мёртвой. */
  idleMin: number;
};

export type KrasgmuSessionStats = {
  count: number;
  /** Самая долгая подтверждённая жизнь — сессия живёт минимум столько. */
  maxAliveMin: number | null;
  /** Самая ранняя найденная смерть — при абсолютном сроке он не больше этого. */
  minDeadByMin: number | null;
  /** Самый короткий простой перед смертью — при таймауте по бездействию он не больше этого. */
  minIdleMin: number | null;
  recent: KrasgmuSessionDeath[];
};

const minutesBetween = (from: string, to: number) =>
  Math.max(0, Math.round((to - new Date(from).getTime()) / 60_000));

export async function recordSessionDeath(
  redis: AppRedis,
  binding: KrasgmuBindingRecord,
): Promise<void> {
  const now = Date.now();
  const lastAlive = binding.lastValidatedAt ?? binding.boundAt;
  const event: KrasgmuSessionDeath = {
    at: new Date(now).toISOString(),
    aliveMin: minutesBetween(binding.boundAt, new Date(lastAlive).getTime()),
    deadByMin: minutesBetween(binding.boundAt, now),
    idleMin: minutesBetween(lastAlive, now),
  };
  console.log('[krasgmu] session expired', event);
  const id = `${now}:${Math.random().toString(36).slice(2, 8)}`;
  await redis.set(`${KEY_PREFIX}${id}`, event, { ex: KEEP_SEC });
}

export async function getSessionStats(redis: AppRedis): Promise<KrasgmuSessionStats> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [next, batch] = await redis.scan(cursor, { match: `${KEY_PREFIX}*`, count: 200 });
    keys.push(...batch);
    cursor = Number(next);
  } while (cursor !== 0);

  const events = (await Promise.all(keys.map(k => redis.get<KrasgmuSessionDeath>(k))))
    .filter((e): e is KrasgmuSessionDeath => e !== null)
    .sort((a, b) => b.at.localeCompare(a.at));

  const pick = (f: (e: KrasgmuSessionDeath) => number, agg: (...n: number[]) => number) =>
    events.length ? agg(...events.map(f)) : null;

  return {
    count: events.length,
    maxAliveMin: pick(e => e.aliveMin, Math.max),
    minDeadByMin: pick(e => e.deadByMin, Math.min),
    minIdleMin: pick(e => e.idleMin, Math.min),
    recent: events.slice(0, 30),
  };
}
