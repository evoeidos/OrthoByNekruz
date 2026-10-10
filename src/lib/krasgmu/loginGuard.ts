import type { AppRedis } from '@/lib/redis';
import { KrasgmuAuthError } from '@/lib/krasgmu/errors';

// Каждый вход на krasgmu.ru — сессия удалённого браузера Browserless.
// Бесплатный тариф: 1000 units в месяц, при исчерпании запросы отклоняются,
// и расписание/оценки/методички пропадают у всех до сброса квоты.

/** Попыток привязки на пользователя в час — защита от перебора паролей через нас. */
const BIND_ATTEMPTS_PER_HOUR = 5;

/**
 * Входов через браузер в сутки на весь сервис — потолок расхода квоты:
 * 30 × 30 дней укладывается в 1000 units. При переходе на платный тариф поднять.
 */
const BROWSER_LOGINS_PER_DAY = 30;

/** Сколько ждать, пока параллельный запрос того же студента обновит сессию. */
const RELOGIN_LOCK_SEC = 60;
const RELOGIN_WAIT_MS = 25_000;
const RELOGIN_POLL_MS = 1_000;

async function bump(redis: AppRedis, key: string, windowSec: number): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return count;
}

/** Ручная привязка аккаунта: не больше BIND_ATTEMPTS_PER_HOUR попыток в час. */
export async function checkBindRateLimit(redis: AppRedis, tgId: string): Promise<void> {
  const count = await bump(redis, `krasgmu_bind_rate:${tgId}`, 60 * 60);
  if (count > BIND_ATTEMPTS_PER_HOUR) {
    throw new KrasgmuAuthError(
      'Слишком много попыток входа. Попробуйте через час.',
      'rate_limited',
    );
  }
}

/** Резервирует один вход через браузер из суточного лимита сервиса. */
export async function reserveBrowserLogin(redis: AppRedis): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const count = await bump(redis, `krasgmu_browser_logins:${day}`, 2 * 24 * 60 * 60);
  if (count > BROWSER_LOGINS_PER_DAY) {
    console.error('[krasgmu] суточный лимит входов через браузер исчерпан', count);
    throw new KrasgmuAuthError(
      'Сервис входа в КрасГМУ перегружен. Попробуйте завтра.',
      'rate_limited',
    );
  }
}

/**
 * Перелогин одного студента выполняется одним запросом. Остальные параллельные
 * запросы (расписание, оценки, профиль открываются разом) ждут, пока он
 * закончит, и берут уже обновлённую сессию — иначе каждый запускал бы свой
 * браузер и тратил квоту.
 *
 * relogin — выполняет вход и сохраняет сессию; reload — перечитывает сессию,
 * сохранённую другим запросом.
 */
export async function withReloginLock<T>(
  redis: AppRedis,
  tgId: string,
  relogin: () => Promise<T>,
  reload: () => Promise<T | null>,
): Promise<T> {
  const lockKey = `krasgmu_relogin_lock:${tgId}`;
  const acquired = await redis.set(lockKey, '1', { ex: RELOGIN_LOCK_SEC, nx: true });
  if (acquired !== null) {
    try {
      return await relogin();
    } finally {
      await redis.del(lockKey).catch(() => 0);
    }
  }

  const deadline = Date.now() + RELOGIN_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, RELOGIN_POLL_MS));
    if (!(await redis.exists(lockKey))) {
      const fresh = await reload();
      if (fresh !== null) return fresh;
      break;
    }
  }
  throw new KrasgmuAuthError('Обновляем вход в КрасГМУ — повторите через минуту.', 'network');
}
