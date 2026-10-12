import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
import { monitorEventLoopDelay } from 'perf_hooks';
import type { AppRedis } from '@/lib/redis';
import { alertAdmin } from '@/lib/alertAdmin';
import { maskKey, newRedisCallStats, runWithRedisStats, type RedisCallStats } from '@/lib/redisStats';

// ═══════════════════════════════════════════════════════════════════════════
// Блокировка записи пользователя (user_id:{tgId}).
//
// Пользователь хранится одним JSON, и каждая запись перезаписывает его
// целиком. Без блокировки параллельные запросы теряли чужие изменения:
// студентский запрос читал объект, админ в это время подтверждал оплату,
// а студентский запрос дописывал старую копию — подтверждение пропадало.
//
// withUserLock — всё, что читает и пишет пользователя, выполняется по очереди
// (для одного tgId). Повторный вызов внутри уже заблокированного запроса
// не ждёт сам себя (AsyncLocalStorage).
// updateUser — точечное изменение: под блокировкой перечитать, изменить, записать.
// ═══════════════════════════════════════════════════════════════════════════

/** Блокировка живёт не дольше — на случай падения процесса посреди запроса. */
const LOCK_TTL_SEC = 30;
/**
 * Сколько ждать чужую блокировку, прежде чем сдаться (меньше TTL: иначе
 * ждущий мог бы войти, пока зависший держатель ещё работает).
 */
const LOCK_WAIT_MS = 20_000;
const LOCK_POLL_MS = 50;

/** Дольше — подозрительно: остальные запросы студента в это время ждут. */
const SLOW_HOLD_MS = 5_000;

const heldLocks = new AsyncLocalStorage<Set<string>>();

// Задержка цикла событий: если процесс был занят чем-то тяжёлым, долгая
// блокировка — следствие, а не причина. Гистограмма общая на процесс.
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

/**
 * Алерт о долгом удержании: какой участок держал, сколько обращений к Redis
 * было за это время, самая медленная команда и задержка процесса.
 */
function reportSlowHold(tgId: string, heldMs: number, label: string, stats: RedisCallStats): void {
  const loopMaxMs = Math.round(loopDelay.max / 1e6);
  loopDelay.reset();
  const slowest = stats.slowest
    ? `${stats.slowest.cmd} ${maskKey(stats.slowest.key)} — ${Math.round(stats.slowest.ms)} мс`
    : '—';
  const detail = [
    `tgId ${tgId}`,
    `участок: ${label}`,
    `Redis: ${stats.calls} обращений, ${Math.round(stats.totalMs)} мс суммарно`,
    `самое медленное: ${slowest}`,
    `задержка процесса (макс.): ${loopMaxMs} мс`,
  ].join('\n');
  console.warn('[userLock] блокировка удерживалась долго', heldMs, detail);
  // Отдельный счётчик на студента: иначе алерт по одному глушил остальных.
  alertAdmin(`user-lock:slow:${tgId}`, `блокировка пользователя удерживалась ${Math.round(heldMs / 1000)} с`, detail);
}

export class UserLockTimeoutError extends Error {
  constructor(tgId: string) {
    super(`user lock timeout: ${tgId}`);
    this.name = 'UserLockTimeoutError';
  }
}

export function isUserLockTimeout(e: unknown): e is UserLockTimeoutError {
  return e instanceof Error && e.name === 'UserLockTimeoutError';
}

const lockKey = (tgId: string) => `user_lock:${tgId}`;

/** Возвращает токен блокировки или null, если Redis недоступен. */
async function acquire(redis: AppRedis, tgId: string): Promise<string | null> {
  const token = randomBytes(12).toString('hex');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    let acquired: unknown;
    try {
      acquired = await redis.set(lockKey(tgId), token, { ex: LOCK_TTL_SEC, nx: true });
    } catch (e) {
      // Redis недоступен — запись всё равно не пройдёт; не блокируем деградацию.
      console.error('[userLock] не удалось взять блокировку', e);
      return null;
    }
    if (acquired !== null) return token;
    if (Date.now() >= deadline) throw new UserLockTimeoutError(tgId);
    await new Promise(r => setTimeout(r, LOCK_POLL_MS));
  }
}

async function release(redis: AppRedis, tgId: string, token: string): Promise<void> {
  try {
    // Снимаем только свою блокировку: если она истекла по TTL и её взял
    // другой запрос, чужую не трогаем.
    if (await redis.get<string>(lockKey(tgId)) === token) {
      await redis.del(lockKey(tgId));
    }
  } catch (e) {
    console.error('[userLock] не удалось снять блокировку', e);
  }
}

/**
 * Выполнить fn, пока никто другой не читает-пишет этого пользователя.
 * label — что держит блокировку (для алерта о долгом удержании).
 */
export async function withUserLock<T>(
  redis: AppRedis,
  tgId: string,
  fn: () => Promise<T>,
  label = 'unknown',
): Promise<T> {
  const id = String(tgId);
  const held = heldLocks.getStore();
  if (held?.has(id)) return fn();

  const token = await acquire(redis, id);
  const nextHeld = new Set(held ?? []);
  nextHeld.add(id);
  const stats = newRedisCallStats();
  const startedAt = Date.now();
  try {
    return await runWithRedisStats(stats, () => heldLocks.run(nextHeld, fn));
  } finally {
    if (token) await release(redis, id, token);
    const heldMs = Date.now() - startedAt;
    if (heldMs > SLOW_HOLD_MS) reportSlowHold(id, heldMs, label, stats);
  }
}

/**
 * Перечитать пользователя под блокировкой, применить transform и записать,
 * если объект изменился. transform возвращает новый объект или тот же
 * (без записи). Возвращает актуального пользователя.
 */
export async function updateUser<T = any>(
  redis: AppRedis,
  tgId: string,
  transform: (user: T | null) => T | null | Promise<T | null>,
): Promise<T | null> {
  return withUserLock(redis, tgId, async () => {
    const raw = await redis.get<unknown>(`user_id:${tgId}`);
    let fresh: T | null = null;
    if (typeof raw === 'string') {
      try { fresh = JSON.parse(raw) as T; } catch { fresh = null; }
    } else {
      fresh = (raw ?? null) as T | null;
    }
    const next = await transform(fresh);
    if (next !== null && next !== fresh) {
      await redis.set(`user_id:${tgId}`, next);
    }
    return next ?? fresh;
  }, 'updateUser');
}
