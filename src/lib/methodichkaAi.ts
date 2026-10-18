import { createHash } from 'crypto';
import type { AppRedis } from '@/lib/redis';
import type { UniversityMethodichka } from '@/lib/universityParser';

// Одним вызовом DeepSeek укладываемся в таймаут (25 с), поэтому нарезка на части не подходит.
const MAX_TEXT_CHARS = 30_000;
// Меняйте при изменении промпта: версия входит в ключ, сохранённые конспекты создадутся заново.
export const METHODICHKA_PROMPT_VERSION = 'v3';

const MAX_CONTEXT_FIELD_CHARS = 300;

export type MethodichkaAiContext = {
  discipline?: string;
  topic?: string;
  /** Название факультета студента: «Стоматологический факультет» */
  faculty?: string;
};

const SYSTEM_INSTRUCTION = `Ты — преподаватель-клиницист, который готовит студентов медицинского университета к занятиям и экзаменам.
Тебе дают дисциплину, тему занятия и методические указания к ней. Методичка — основной источник и имеет приоритет
там, где описывает что-то специфичное для этой кафедры (классификации, протоколы, последовательность действий,
формулировки, которых требует именно этот преподаватель) — такие места не противоречь и не переформулируй по-своему.
Но не ограничивайся только её текстом: ты врач и знаешь тему шире, чем сжатый конспект методички — дополняй
определениями, механизмами, клинической логикой и связями с другими темами, которых в методичке нет, если это
относится прямо к теме занятия и помогает понять её глубже.

ПРАВИЛА:
- Отвечай ТОЛЬКО на русском языке
- Используй Markdown: заголовки второго уровня (## ), маркированные списки (- ), **жирным** ключевые термины
- Не используй таблицы, LaTeX и блоки кода
- Когда добавляешь факт, которого нет в методичке, помечай пункт меткой «(сверх методички)» в конце строки —
  чтобы студент видел, что это стоит перепроверить и это не то, что спросят по методичке дословно
- Не выдумывай и не искажай специфичные для методички данные (цифры, классификации, протоколы из её текста)
- Пиши коротко и по делу, без вступлений и заключений вроде «надеюсь, помогло»
- Если указан факультет, подбирай клинические примеры и акценты под эту специальность
  (стоматологу — полость рта и челюстно-лицевая область, педиатру — детский возраст),
  но не выбрасывай из методички то, что к специальности не относится

СТРУКТУРА ОТВЕТА:
## Суть темы
2–3 предложения простыми словами: что изучаем, зачем и где это применяется на практике.

## Ключевые понятия
- **Термин** — короткое определение (из методички и, где уместно, шире)

## Разбор по разделам
Подзаголовки по разделам методички, внутри — пункты с главными мыслями; дополняй их своими знаниями по теме.

## Что обязательно знать
- пункты, которые чаще всего спрашивают на занятии и экзамене

## Частые ошибки
- 2–3 типичных промаха студентов по этой теме`;

function methodichkaToPlainText(m: UniversityMethodichka): string {
  const parts: string[] = [m.title];
  for (const ch of m.chapters) {
    if (ch.title) parts.push(ch.title);
    parts.push(...ch.paragraphs);
  }
  return parts.join('\n\n').slice(0, MAX_TEXT_CHARS);
}

function clampField(s: string | undefined): string {
  return (s ?? '').trim().slice(0, MAX_CONTEXT_FIELD_CHARS);
}

export function buildMethodichkaPrompts(m: UniversityMethodichka, context: MethodichkaAiContext = {}) {
  const discipline = clampField(context.discipline);
  const topic = clampField(context.topic);
  const faculty = clampField(context.faculty);
  const header = [
    faculty && `Факультет: ${faculty}`,
    discipline && `Дисциплина: ${discipline}`,
    topic && `Тема занятия: ${topic}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    userPrompt: `${header ? `${header}\n\n` : ''}Методические указания:\n\n${methodichkaToPlainText(m)}`,
  };
}

// ─── Сохранённый конспект ──────────────────────────────────────────────────
//
// Конспект делается один раз на методичку и факультет и дальше отдаётся всем
// студентам этого факультета, которые её откроют, — из «Библиотеки» или из
// «Расписания». Факультет — свой у каждого конспекта: ИИ подбирает акценты
// под специальность, и стоматолог не должен получить разбор для педиатров.
// Раньше в ключ входили дисциплина и тема от клиента, а вкладки называют их
// по-разному, и одна методичка генерировалась заново. Хранится бессрочно;
// если преподаватель поменял текст методички, хэш не совпадёт и конспект
// пересоздастся.

export type StoredMethodichkaAi = {
  hash: string;
  result: string;
  createdAt: string;
  /** Ответ ИИ упёрся в лимит токенов — хранится неделю, потом новая попытка. */
  truncated?: boolean;
};

/** Обрезанный конспект не держим вечно: через неделю попробуем получить полный. */
const TRUNCATED_KEEP_SEC = 7 * 24 * 60 * 60;

/** facultyId — 'stomatology' | 'therapeutic' | 'pediatrics' или 'general', если факультет неизвестен. */
export const methodichkaAiKey = (tlId: string, facultyId: string) =>
  `ai:methodichka:${METHODICHKA_PROMPT_VERSION}:${facultyId}:${tlId}`;

/** Пока один запрос генерирует конспект, остальные ждут его, а не запускают свой. */
export const methodichkaAiLockKey = (tlId: string, facultyId: string) =>
  `ai:methodichka:gen:${facultyId}:${tlId}`;

export function methodichkaTextHash(m: UniversityMethodichka): string {
  return createHash('sha256').update(methodichkaToPlainText(m)).digest('hex').slice(0, 16);
}

export async function loadStoredMethodichkaAi(
  redis: AppRedis,
  tlId: string,
  facultyId: string,
): Promise<StoredMethodichkaAi | null> {
  const raw = await redis.get<unknown>(methodichkaAiKey(tlId, facultyId));
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<StoredMethodichkaAi>;
  if (typeof r.hash !== 'string' || typeof r.result !== 'string' || !r.result) return null;
  return {
    hash: r.hash,
    result: r.result,
    createdAt: String(r.createdAt ?? ''),
    ...(r.truncated === true ? { truncated: true } : {}),
  };
}

export async function saveMethodichkaAi(
  redis: AppRedis,
  tlId: string,
  facultyId: string,
  hash: string,
  result: string,
  truncated = false,
): Promise<void> {
  const record: StoredMethodichkaAi = {
    hash,
    result,
    createdAt: new Date().toISOString(),
    ...(truncated ? { truncated: true } : {}),
  };
  if (truncated) {
    await redis.set(methodichkaAiKey(tlId, facultyId), record, { ex: TRUNCATED_KEEP_SEC });
  } else {
    await redis.set(methodichkaAiKey(tlId, facultyId), record);
  }
}
