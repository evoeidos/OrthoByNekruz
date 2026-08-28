// ═══════════════════════════════════════════════════════════════════════════
// src/lib/aiRateLimit.ts
// ═══════════════════════════════════════════════════════════════════════════
//
// ЛИМИТЫ НА ВЫЗОВЫ ИИ — ЗАЩИТА ОТ РАСКРУТКИ СЧЁТА ЗА API.
//
// Проверка доступа (verifyApiStudyUser) отвечает на вопрос «имеет ли право»,
// но не «сколько раз». Без лимита один оплативший студент может крутить
// эндпоинт в цикле и нагенерировать счёт у Timeweb / Groq / Gemini.
//
// Два окна: короткое (антиспам) и суточное (потолок стоимости).
//
// ═══════════════════════════════════════════════════════════════════════════

import type { AppRedis } from '@/lib/redis';

/** Не больше N запросов в минуту — от долбёжки кнопкой. */
const PER_MINUTE_LIMIT = 8;
const MINUTE_WINDOW_SEC = 60;

/** Суточный потолок на пользователя — ограничивает стоимость. */
const PER_DAY_LIMIT = 120;
const DAY_WINDOW_SEC = 24 * 60 * 60;

export type AiRateLimitResult =
  | { allowed: true }
  | { allowed: false; error: string; retryAfterSec: number };

/**
 * Счётчик со скользящим окном на INCR + EXPIRE.
 * EXPIRE ставим только при первом инкременте, иначе окно никогда не закроется.
 */
async function bumpCounter(
  redis: AppRedis,
  key: string,
  windowSec: number,
): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSec);
  }
  return count;
}

/** Лимиты не должны ронять запрос: при ошибке Redis пропускаем. */
export async function checkAiRateLimit(
  redis: AppRedis,
  tgId: string,
): Promise<AiRateLimitResult> {
  try {
    const minuteCount = await bumpCounter(redis, `ai_rate:min:${tgId}`, MINUTE_WINDOW_SEC);
    if (minuteCount > PER_MINUTE_LIMIT) {
      return {
        allowed: false,
        error: 'Слишком часто. Подожди минуту и попробуй снова.',
        retryAfterSec: MINUTE_WINDOW_SEC,
      };
    }

    const dayCount = await bumpCounter(redis, `ai_rate:day:${tgId}`, DAY_WINDOW_SEC);
    if (dayCount > PER_DAY_LIMIT) {
      return {
        allowed: false,
        error: 'Дневной лимит запросов к ИИ исчерпан. Возвращайся завтра.',
        retryAfterSec: DAY_WINDOW_SEC,
      };
    }

    return { allowed: true };
  } catch (e) {
    console.error('[aiRateLimit] пропускаем из-за ошибки Redis', e);
    return { allowed: true };
  }
}
