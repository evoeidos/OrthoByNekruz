import type {
  UniversityCycle,
  UniversityGradeRow,
  UniversityMatchedTopic,
  UniversityMethodichka,
  UniversityProfile,
  UniversityScheduleDay,
} from '@/lib/universityParser';
import { getTelegramAuth } from '@/lib/uniHelpers';

/**
 * Локальная копия данных КрасГМУ (профиль, фото, расписание, оценки, темы) в браузере.
 * При открытии приложения показываем её сразу, а свежие данные с сервера
 * подменяют её незаметно, когда придут. Ключ привязан к telegram_id, чтобы
 * на общем устройстве не показать чужой кабинет.
 */

const PREFIX = 'uni_cache_v1:';
const PHOTO_PREFIX = 'uni_photo_v1:';

export type UniCache = {
  login: string;
  schedule: UniversityScheduleDay[];
  cycles: UniversityCycle[];
  grades: UniversityGradeRow[];
  profile: UniversityProfile | null;
  topics: Record<string, Record<string, UniversityMatchedTopic>>;
  practiceTopics: Record<string, Record<string, UniversityMatchedTopic>>;
  savedAt: number;
};

export function readUniCache(tgId: string): UniCache | null {
  if (!tgId || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PREFIX + tgId);
    return raw ? (JSON.parse(raw) as UniCache) : null;
  } catch {
    return null;
  }
}

export function writeUniCache(tgId: string, patch: Partial<Omit<UniCache, 'savedAt'>>): void {
  if (!tgId || typeof window === 'undefined') return;
  try {
    const prev = readUniCache(tgId);
    const next: UniCache = {
      login: '', schedule: [], cycles: [], grades: [], profile: null, topics: {}, practiceTopics: {},
      ...prev,
      ...patch,
      savedAt: Date.now(),
    };
    localStorage.setItem(PREFIX + tgId, JSON.stringify(next));
  } catch {
    // переполнение хранилища / приватный режим — кэш необязателен
  }
}

export function readUniPhoto(tgId: string): string | null {
  if (!tgId || typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(PHOTO_PREFIX + tgId);
  } catch {
    return null;
  }
}

export function writeUniPhoto(tgId: string, dataUrl: string): void {
  if (!tgId) return;
  try {
    localStorage.setItem(PHOTO_PREFIX + tgId, dataUrl);
  } catch {
    // фото слишком большое для localStorage — просто не кэшируем
  }
}

/** Удалить кэш одного пользователя (tgId) или всех (без аргумента — при выходе). */
export function clearUniCache(tgId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    void clearUniIdb(tgId);
    if (tgId) {
      localStorage.removeItem(PREFIX + tgId);
      localStorage.removeItem(PHOTO_PREFIX + tgId);
      return;
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(PREFIX) || k.startsWith(PHOTO_PREFIX))) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ── Библиотека и методички: IndexedDB (методички большие, localStorage их не вместит) ──

const IDB_NAME = 'uni_cache';
const IDB_STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // кэш необязателен
  }
}

/** Удалить записи IndexedDB пользователя (tgId) или все (без аргумента). */
export async function clearUniIdb(tgId?: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      if (tgId) store.delete(IDBKeyRange.bound(`${tgId}:`, `${tgId}:￿`));
      else store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

/**
 * Сначала отдаёт сохранённую копию (если есть), затем тихо обновляет её из сети.
 * Ошибку сети показывает, только если показать нечего.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<{ value: T } | { error: string }>,
  apply: (state: T | { error: string }) => void,
): Promise<void> {
  const { telegram_id } = getTelegramAuth();
  const fullKey = telegram_id ? `${telegram_id}:${key}` : '';
  const cached = fullKey ? await idbGet<T>(fullKey) : undefined;
  if (cached !== undefined) apply(cached);
  let res: { value: T } | { error: string };
  try {
    res = await fetcher();
  } catch (e) {
    res = { error: e instanceof Error ? e.message : 'Сетевая ошибка' };
  }
  if ('value' in res) {
    apply(res.value);
    if (fullKey) void idbSet(fullKey, res.value);
  } else if (cached === undefined) {
    apply(res);
  }
}

export async function postUniData(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const { telegram_id, initData } = getTelegramAuth();
  const r = await fetch('/api/auth/university/data', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegram_id, initData, ...body }),
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

/** Методичка темы: из кэша сразу, затем свежая с сервера. */
export function loadMethodichka(
  tlId: string,
  apply: (state: UniversityMethodichka | { error: string }) => void,
): Promise<void> {
  return cachedFetch<UniversityMethodichka>(`meth:${tlId}`, async () => {
    const { ok, status, data } = await postUniData({ action: 'methodichka', tlId });
    if (!ok) return { error: `${data.error || 'Ошибка сервера'} (HTTP ${status}${data.code ? `, ${data.code}` : ''})` };
    if (!data.methodichka) return { error: 'У этой темы нет методических указаний для обучающихся на сайте (либо не удалось распознать страницу).' };
    return { value: data.methodichka as UniversityMethodichka };
  }, apply);
}
