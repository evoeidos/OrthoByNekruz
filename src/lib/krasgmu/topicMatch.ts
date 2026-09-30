import { MONTHS_GEN, WEEKDAYS_RU, parseRuFullDate } from '@/lib/uniHelpers';
import type { KrasgmuCycle, KrasgmuScheduleDay, KrasgmuTopicPlanRow } from '@/lib/krasgmu/types';

export type MatchedTopic = {
  tlId: string;
  seq: number;
  topic: string;
  section: string;
  hours: string;
};

/** «8 сентября» → сортируемый ключ месяц*100+день (в пределах одного семестра год не пересекается). */
function ruDateKey(s: string): number | null {
  const m = s.match(/(\d{1,2})\s+([а-яё]+)/i);
  if (!m) return null;
  const month = MONTHS_GEN.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  return month * 100 + (+m[1]);
}

function zipTopics(sortedRawDates: string[], topicPlan: KrasgmuTopicPlanRow[]): Map<string, MatchedTopic> {
  const sortedTopics = [...topicPlan].sort((a, b) => a.seq - b.seq);
  const map = new Map<string, MatchedTopic>();
  sortedRawDates.forEach((raw, i) => {
    const t = sortedTopics[i];
    if (t) map.set(raw, { tlId: t.tlId, seq: t.seq, topic: t.topic, section: t.section, hours: t.hours });
  });
  return map;
}

/**
 * Собирает все конкретные даты занятий по предмету+типу за семестр — из поля
 * lesson.dates всех подходящих строк расписания (обычно один еженедельный слот,
 * но бывает и несколько).
 */
export function collectLessonDates(
  schedule: KrasgmuScheduleDay[],
  subject: string,
  isLecture: boolean,
): string[] {
  const dates: string[] = [];
  for (const day of schedule) {
    for (const lesson of day.lessons) {
      if (lesson.subject.trim() !== subject.trim()) continue;
      if ((lesson.type === 'ЛЕКЦИЯ') !== isLecture) continue;
      if (!lesson.dates) continue;
      dates.push(...lesson.dates.split(',').map(d => d.trim()).filter(Boolean));
    }
  }
  return dates;
}

/**
 * Сопоставляет хронологически отсортированные даты занятий с тематическим планом:
 * i-я по времени дата занятия = i-я по № темы строка плана. Возвращает карту
 * «дата → тема» для точечного поиска при отрисовке конкретного дня расписания.
 */
export function matchDatesToTopics(
  dates: string[],
  topicPlan: KrasgmuTopicPlanRow[],
): Map<string, MatchedTopic> {
  const sorted = [...new Set(dates)]
    .map(raw => ({ raw, key: ruDateKey(raw) }))
    .filter((d): d is { raw: string; key: number } => d.key !== null)
    .sort((a, b) => a.key - b.key)
    .map(d => d.raw);
  return zipTopics(sorted, topicPlan);
}

/**
 * Перечисляет календарные даты внутри диапазона цикла (циклового расписания),
 * приходящиеся на заданные дни недели («Понедельник» и т.п.) — те дни, когда в
 * обычном недельном расписании стоит заглушка «ПРАКТИКА». Формат каждой даты —
 * «D month YYYY» (с годом — в отличие от lesson.dates, цикл может пересекать
 * границу года).
 */
export function enumerateCycleDates(cycle: KrasgmuCycle, weekdays: Set<string>): string[] {
  const start = parseRuFullDate(cycle.startDate);
  const end = parseRuFullDate(cycle.endDate);
  if (!start || !end) return [];

  const dates: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (weekdays.has(WEEKDAYS_RU[d.getUTCDay()])) {
      dates.push(`${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`);
    }
  }
  return dates;
}

/** Как matchDatesToTopics, но для дат с годом (enumerateCycleDates) — сортировка по реальной хронологии. */
export function matchFullDatesToTopics(
  dates: string[],
  topicPlan: KrasgmuTopicPlanRow[],
): Map<string, MatchedTopic> {
  const sorted = [...new Set(dates)]
    .map(raw => ({ raw, date: parseRuFullDate(raw) }))
    .filter((d): d is { raw: string; date: Date } => d.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(d => d.raw);
  return zipTopics(sorted, topicPlan);
}
