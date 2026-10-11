import type {
  UniversityCycle,
  UniversityGradeRow,
  UniversityMatchedTopic,
  UniversityProfile,
  UniversityScheduleDay,
} from '@/lib/universityParser';

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
