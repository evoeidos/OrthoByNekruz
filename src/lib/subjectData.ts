// ════════════════════════════════════════════════════════════════════════════
//  Загрузка данных предмета с кэшированием на клиенте.
//
//  Стратегия: данные хранятся в Cache API браузера с TTL 24 часа.
//  Пока кэш свежий — ни одного запроса к серверу. Раз в сутки (или при
//  новом деплое) данные обновляются автоматически.
//
//  При новом деплое BUILD_ID меняется → имя кэша меняется → старый кэш
//  удаляется и данные сразу подтягиваются с сервера у всех студентов.
// ════════════════════════════════════════════════════════════════════════════

import { readStoredFacultyId } from '@/lib/facultyCodes';
import { bioFacultyHasTasks } from '@/lib/bioTasks';
import { chemFacultyHasTasks } from '@/lib/chemTasks';

let onSubjectDataUnavailable: (() => void) | null = null;

/** Регистрирует колбэк при 503 / сбое Redis на subject-data. */
export function setOnSubjectDataUnavailable(fn: (() => void) | null) {
  onSubjectDataUnavailable = fn;
}

const BUILD_ID     = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
const CACHE_NAME   = `subject-data-${BUILD_ID}`;
const CACHE_PREFIX = 'subject-data-';

// dev: 5 минут (данные часто меняются при разработке)
// prod: 24 часа — раз в сутки проверяем сервер
const TTL_MS = BUILD_ID === 'dev' ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;

// Проверка cache-version отключена — каждый вызов бил Redis (лимит Upstash).
// Инвалидация идёт через BUILD_ID при деплое и admin-cache-bust после него.
async function checkAndBustCache(): Promise<void> { /* noop */ }

/** tickets — экзаменационные билеты, собираются на сервере (src/lib/examTickets.ts). */
export type SubjectDataType = 'questions' | 'tasks' | 'tests' | 'glossary' | 'tickets';

type Cached = { ts: number; data: unknown[] };

let _purged = false;
async function purgeOldCaches(): Promise<void> {
  if (_purged || typeof caches === 'undefined') return;
  _purged = true;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map(k => caches.delete(k)),
    );
  } catch { /* не критично */ }
}

function cacheKey(subject: string, type: SubjectDataType): string {
  // Билеты биологии и химии собираются из вопросов/задач своего факультета.
  if ((subject === 'bio' || subject === 'chem') && type === 'tickets') {
    const faculty = readStoredFacultyId() || (subject === 'bio' ? 'stomatology' : 'pediatrics');
    return `https://cache.local/subject-data/${subject}/${type}/${faculty}`;
  }
  if (subject === 'bio' && type === 'questions') {
    const faculty = readStoredFacultyId() || 'stomatology';
    return `https://cache.local/subject-data/${subject}/${type}/${faculty}`;
  }
  if (subject === 'bio' && type === 'tasks') {
    const faculty = readStoredFacultyId() || 'stomatology';
    return `https://cache.local/subject-data/${subject}/${type}/${faculty}`;
  }
  if ((subject === 'bioxim' || subject === 'hyg') && type === 'tests') {
    const faculty = readStoredFacultyId() || 'stomatology';
    return `https://cache.local/subject-data/${subject}/${type}/${faculty}`;
  }
  if (subject === 'chem' && type === 'tasks') {
    const faculty = readStoredFacultyId() || 'pediatrics';
    return `https://cache.local/subject-data/${subject}/${type}/${faculty}`;
  }
  return `https://cache.local/subject-data/${subject}/${type}`;
}

/** null = сервер недоступен / Redis — использовать устаревший кэш */
async function fetchFromServer(subject: string, type: SubjectDataType): Promise<unknown[] | null> {
  const tgId    = localStorage.getItem('user_tg_id') || '';
  const initDat = (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) || '';
  try {
    const r = await fetch('/api/subject-data', {
      method:  'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ subject, type, telegramId: tgId, initData: initDat }),
    });
    if (r.status === 503) {
      onSubjectDataUnavailable?.();
      return null;
    }
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.data) ? j.data : [];
  } catch {
    return null;
  }
}

async function readCacheEntry(key: string, ignoreTtl = false): Promise<unknown[] | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(CACHE_NAME);
    const hit   = await cache.match(key);
    if (!hit) return null;
    const cached = (await hit.json()) as Cached;
    if (!cached?.data || !Array.isArray(cached.data)) return null;
    if (!ignoreTtl && Date.now() - cached.ts >= TTL_MS) return null;
    return cached.data;
  } catch {
    return null;
  }
}

/**
 * Возвращает данные предмета.
 * - Если кэш свежий (< 24ч) → отдаёт сразу, без запроса к серверу.
 * - Если кэш устарел или отсутствует → загружает с сервера и кэширует.
 * - При новом деплое кэш инвалидируется автоматически через BUILD_ID.
 */
export type LoadSubjectDataOptions = {
  /** Сбросить кэш и загрузить с сервера (воронка оплаты). */
  bustCache?: boolean;
};

export async function loadSubjectData(
  subject: string,
  type: SubjectDataType,
  options?: LoadSubjectDataOptions,
): Promise<unknown[]> {
  void purgeOldCaches();
  await checkAndBustCache();

  const key = cacheKey(subject, type);

  if (options?.bustCache) {
    await bustSubjectModuleCache(subject, [type]);
  }

  // 1. Свежий кэш (< TTL)
  if (!options?.bustCache) {
    const fresh = await readCacheEntry(key, false);
    if (fresh) return fresh;
  }

  // 2. Загружаем с сервера
  const fetched = await fetchFromServer(subject, type);
  let data: unknown[] = fetched ?? [];

  // 3. Redis/сеть недоступны — устаревший кэш лучше пустого экрана
  if (fetched === null) {
    const stale = await readCacheEntry(key, true);
    if (stale?.length) return stale;
  }

  // 4. Кэшируем на 24 часа
  try {
    if (typeof caches !== 'undefined' && data.length) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(key, new Response(JSON.stringify({ ts: Date.now(), data } as Cached)));
    }
  } catch { /* не критично */ }

  return data;
}

/** Сброс кэша разделов предмета (после отказа админа — не показывать старые JSON). */
export async function bustSubjectModuleCache(
  subject: string,
  types: SubjectDataType[],
): Promise<void> {
  if (typeof caches === 'undefined' || types.length === 0) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    // Билеты собраны из вопросов и задач — сбрасываем их вместе с ними.
    const all = types.some(t => t === 'questions' || t === 'tasks')
      ? [...new Set<SubjectDataType>([...types, 'tickets'])]
      : types;
    await Promise.all(all.map(t => cache.delete(cacheKey(subject, t))));
  } catch { /* не критично */ }
}
