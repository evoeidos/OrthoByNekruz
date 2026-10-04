/**
 * Фасад для парсинга данных krasgmu.ru.
 * Низкоуровневая логика — в src/lib/krasgmu/* (fetch + cheerio).
 */
import type { AppRedis } from '@/lib/redis';
import { fetchKrasgmuPage } from '@/lib/krasgmu/client';
import { parseGradesHtml, parseProfileHtml, parseScheduleHtml } from '@/lib/krasgmu/parser';
import {
  fetchKrasgmuGrades,
  fetchKrasgmuLectureTopics,
  fetchKrasgmuLibraryDisciplines,
  fetchKrasgmuMethodichka,
  fetchKrasgmuProfile,
  fetchKrasgmuSchedule,
  fetchKrasgmuTopicPlan,
} from '@/lib/krasgmu/service';
import type { MatchedTopic } from '@/lib/krasgmu/topicMatch';
import type {
  KrasgmuCycle,
  KrasgmuGradeRow,
  KrasgmuLibraryDiscipline,
  KrasgmuMethodichka,
  KrasgmuProfile,
  KrasgmuScheduleDay,
  KrasgmuSessionCookies,
  KrasgmuTopicPlan,
} from '@/lib/krasgmu/types';

export type { KrasgmuGradeRow as UniversityGradeRow };
export type { KrasgmuScheduleDay as UniversityScheduleDay };
export type { KrasgmuSessionCookies as UniversitySessionCookies };
export type { KrasgmuProfile as UniversityProfile };
export type { MatchedTopic as UniversityMatchedTopic };
export type { KrasgmuCycle as UniversityCycle };
export type { KrasgmuMethodichka as UniversityMethodichka };
export type { KrasgmuLibraryDiscipline as UniversityLibraryDiscipline };
export type { KrasgmuTopicPlan as UniversityTopicPlan };

const SCHEDULE_PATH = '/index.php?page%5Borg%5D=dean&cat=schedule';
const GRADES_PATH = '/index.php?page%5Borg%5D=dean&cat=progress';
const CACHE_TTL_SEC = 60 * 60;
// Методичка — общий для всех студентов справочный материал по теме, не меняется день ото дня.
const METHODICHKA_TTL_SEC = 60 * 60 * 24 * 7;
const SCHEDULE_TTL_SEC = 60 * 60 * 24 * 7;
// Каталог тем (без текста методичек) стабилен в рамках семестра — не гонять десятки запросов к сайту универа на каждое открытие.
const LIBRARY_TTL_SEC = 60 * 60 * 24 * 7;

function cacheKey(tgId: string, kind: 'schedule' | 'grades' | 'profile' | 'topics' | 'library') {
  return `krasgmu_cache:${kind}:${tgId}`;
}

function methodichkaCacheKey(tlId: string) {
  return `krasgmu_cache:methodichka:${tlId}`;
}

/**
 * Сбрасывает кэш расписания/оценок/профиля/тем конкретного пользователя — иначе
 * после привязки другого аккаунта krasgmu.ru (или отвязки) старые данные могут
 * ещё до 5 минут отдаваться из кэша, будто это данные нового аккаунта.
 */
export async function clearUniversityCache(redis: AppRedis, tgId: string): Promise<void> {
  await redis.del(
    cacheKey(tgId, 'schedule'),
    cacheKey(tgId, 'grades'),
    cacheKey(tgId, 'profile'),
    cacheKey(tgId, 'topics'),
    cacheKey(tgId, 'library'),
  );
}

/** Парсинг HTML расписания (Cheerio). */
export function parseUniversityScheduleHtml(html: string): KrasgmuScheduleDay[] {
  return parseScheduleHtml(html);
}

/** Парсинг HTML оценок (Cheerio). Поддерживает table.tdata и обычные таблицы. */
export function parseUniversityGradesHtml(html: string): KrasgmuGradeRow[] {
  return parseGradesHtml(html);
}

/** Парсинг персональных данных студента (ФИО, курс, группа, статус). */
export function parseUniversityProfileHtml(html: string): KrasgmuProfile | null {
  return parseProfileHtml(html);
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
): Promise<{ login: string; schedule: KrasgmuScheduleDay[]; cycles: KrasgmuCycle[] }> {
  const cached = await redis.get<{ login: string; schedule: KrasgmuScheduleDay[]; cycles?: KrasgmuCycle[] }>(
    cacheKey(tgId, 'schedule'),
  );
  // cycles?? [] — на случай, если в кэше ещё лежит запись старого формата (до появления циклов).
  if (cached) return { ...cached, cycles: cached.cycles ?? [] };

  const data = await fetchKrasgmuSchedule(redis, tgId);
  await redis.set(cacheKey(tgId, 'schedule'), data, { ex: SCHEDULE_TTL_SEC });
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

export async function fetchUniversityProfile(
  redis: AppRedis,
  tgId: string,
): Promise<{ login: string; profile: KrasgmuProfile | null }> {
  const cached = await redis.get<{ login: string; profile: KrasgmuProfile | null }>(
    cacheKey(tgId, 'profile'),
  );
  if (cached) return cached;

  const data = await fetchKrasgmuProfile(redis, tgId);
  await redis.set(cacheKey(tgId, 'profile'), data, { ex: CACHE_TTL_SEC });
  return data;
}

/** Темы лекций/практик по датам, сшитые с тематическим планом УМКД. Дороже
 * остальных вызовов (доп. запросы на список УМКД и планы по дисциплинам) —
 * кэшируется так же, как расписание/оценки/профиль. */
export async function fetchUniversityLectureTopics(
  redis: AppRedis,
  tgId: string,
): Promise<{
  login: string;
  topics: Record<string, Record<string, MatchedTopic>>;
  practiceTopics: Record<string, Record<string, MatchedTopic>>;
}> {
  const cached = await redis.get<{
    login: string;
    topics: Record<string, Record<string, MatchedTopic>>;
    practiceTopics?: Record<string, Record<string, MatchedTopic>>;
  }>(cacheKey(tgId, 'topics'));
  // practiceTopics ?? {} — на случай записи старого формата в кэше (до появления практики по циклам).
  if (cached) return { ...cached, practiceTopics: cached.practiceTopics ?? {} };

  const data = await fetchKrasgmuLectureTopics(redis, tgId);
  await redis.set(cacheKey(tgId, 'topics'), data, { ex: CACHE_TTL_SEC });
  return data;
}

/** Список дисциплин студента для библиотеки методичек (без тем). */
export async function fetchUniversityLibrary(
  redis: AppRedis,
  tgId: string,
): Promise<{ login: string; disciplines: KrasgmuLibraryDiscipline[] }> {
  const cached = await redis.get<{ login: string; disciplines: KrasgmuLibraryDiscipline[] }>(
    cacheKey(tgId, 'library'),
  );
  if (cached) return cached;

  const data = await fetchKrasgmuLibraryDisciplines(redis, tgId);
  await redis.set(cacheKey(tgId, 'library'), data, { ex: LIBRARY_TTL_SEC });
  return data;
}

/** Тематический план УМКД — общий для всех студентов по umkd_id, кэшируется глобально на неделю. */
export async function fetchUniversityTopicPlan(
  redis: AppRedis,
  tgId: string,
  umkdId: string,
): Promise<KrasgmuTopicPlan> {
  const key = `krasgmu_cache:topicplan:${umkdId}`;
  const cached = await redis.get<KrasgmuTopicPlan>(key);
  if (cached) return cached;

  const data = await fetchKrasgmuTopicPlan(redis, tgId, umkdId);
  if (data.lectures.length + data.practice.length > 0) {
    await redis.set(key, data, { ex: LIBRARY_TTL_SEC });
  }
  return data;
}

/** Методичка по теме — общий для всех студентов справочный материал, кэшируется по tl_id (не по студенту), на неделю. */
export async function fetchUniversityMethodichka(
  redis: AppRedis,
  tgId: string,
  tlId: string,
): Promise<{ login: string; methodichka: KrasgmuMethodichka | null }> {
  const cached = await redis.get<{ login: string; methodichka: KrasgmuMethodichka | null }>(
    methodichkaCacheKey(tlId),
  );
  if (cached) return cached;

  const data = await fetchKrasgmuMethodichka(redis, tgId, tlId);
  if (data.methodichka) await redis.set(methodichkaCacheKey(tlId), data, { ex: METHODICHKA_TTL_SEC });
  return data;
}

export { SCHEDULE_PATH, GRADES_PATH };
