import { MONTHS_GEN } from '@/lib/uniHelpers';
import type { KrasgmuScheduleDay, KrasgmuTopicPlanRow } from '@/lib/krasgmu/types';

export type MatchedTopic = {
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
  const sortedDates = [...new Set(dates)]
    .map(raw => ({ raw, key: ruDateKey(raw) }))
    .filter((d): d is { raw: string; key: number } => d.key !== null)
    .sort((a, b) => a.key - b.key);

  const sortedTopics = [...topicPlan].sort((a, b) => a.seq - b.seq);

  const map = new Map<string, MatchedTopic>();
  sortedDates.forEach((d, i) => {
    const t = sortedTopics[i];
    if (t) map.set(d.raw, { seq: t.seq, topic: t.topic, section: t.section, hours: t.hours });
  });
  return map;
}
