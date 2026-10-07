import { createHash } from 'crypto';
import type { UniversityMethodichka } from '@/lib/universityParser';

// Одним вызовом DeepSeek укладываемся в таймаут (25 с), поэтому нарезка на части не подходит.
const MAX_TEXT_CHARS = 30_000;
// Меняйте при изменении промпта: версия входит в ключ кэша, старые конспекты перестанут отдаваться.
export const METHODICHKA_PROMPT_VERSION = 'v2';

const MAX_CONTEXT_FIELD_CHARS = 300;

export type MethodichkaAiContext = { discipline?: string; topic?: string };

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
  const header = [discipline && `Дисциплина: ${discipline}`, topic && `Тема занятия: ${topic}`]
    .filter(Boolean)
    .join('\n');

  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    userPrompt: `${header ? `${header}\n\n` : ''}Методические указания:\n\n${methodichkaToPlainText(m)}`,
  };
}

// Хэш текста + контекста в ключе: если преподаватель поправил методичку или
// пришёл другой заголовок темы/дисциплины, конспект пересоздаётся заново.
export function methodichkaCacheKey(tlId: string, m: UniversityMethodichka, context: MethodichkaAiContext = {}): string {
  const raw = `${methodichkaToPlainText(m)}\n${clampField(context.discipline)}\n${clampField(context.topic)}`;
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return `ai:methodichka:${METHODICHKA_PROMPT_VERSION}:${tlId}:${hash}`;
}
