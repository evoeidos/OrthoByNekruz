/**
 * Фасад для парсинга данных krasgmu.ru.
 * Низкоуровневая логика — в src/lib/krasgmu/* (fetch + cheerio).
 */
import type { AppRedis } from '@/lib/redis';
import { fetchKrasgmuPage } from '@/lib/krasgmu/client';
import { parseGradesHtml, parseScheduleHtml } from '@/lib/krasgmu/parser';
import { fetchKrasgmuGrades, fetchKrasgmuSchedule } from '@/lib/krasgmu/service';
import type {
  KrasgmuGradeRow,
  KrasgmuScheduleDay,
  KrasgmuSessionCookies,
} from '@/lib/krasgmu/types';

export type { KrasgmuGradeRow as UniversityGradeRow };
export type { KrasgmuScheduleDay as UniversityScheduleDay };
export type { KrasgmuSessionCookies as UniversitySessionCookies };

const SCHEDULE_PATH = '/index.php?page%5Borg%5D=dean&cat=schedule';
const GRADES_PATH = '/index.php?page%5Borg%5D=dean&cat=progress';
const CACHE_TTL_SEC = 300;

function cacheKey(tgId: string, kind: 'schedule' | 'grades') {
  return `krasgmu_cache:${kind}:${tgId}`;
}

/** Парсинг HTML расписания (Cheerio). */
export function parseUniversityScheduleHtml(html: string): KrasgmuScheduleDay[] {
  return parseScheduleHtml(html);
}

/** Парсинг HTML оценок (Cheerio). Поддерживает table.tdata и обычные таблицы. */
export function parseUniversityGradesHtml(html: string): KrasgmuGradeRow[] {
  return parseGradesHtml(html);
}

/** Запрос страницы с сохранёнными cookies (с таймаутом через retry в client). */
export async function fetchUniversityPage(
  cookies: KrasgmuSessionCookies,
  path: string,
): Promise<string> {
  return fetchKrasgmuPage(path, cookies);
}

export async function fetchUniversitySchedule(
  redis: AppRedis,
  tgId: string,
): Promise<{ login: string; schedule: KrasgmuScheduleDay[] }> {
  const cached = await redis.get<{ login: string; schedule: KrasgmuScheduleDay[] }>(
    cacheKey(tgId, 'schedule'),
  );
  if (cached) return cached;

  const data = await fetchKrasgmuSchedule(redis, tgId);
  await redis.set(cacheKey(tgId, 'schedule'), data, { ex: CACHE_TTL_SEC });
  return data;
}

export async function fetchUniversityGrades(
  redis: AppRedis,
  tgId: string,
): Promise<{ login: string; grades: KrasgmuGradeRow[] }> {
  const cached = await redis.get<{ login: string; grades: KrasgmuGradeRow[] }>(
    cacheKey(tgId, 'grades'),
  );
  if (cached) return cached;

  const data = await fetchKrasgmuGrades(redis, tgId);
  await redis.set(cacheKey(tgId, 'grades'), data, { ex: CACHE_TTL_SEC });
  return data;
}

export { SCHEDULE_PATH, GRADES_PATH };
