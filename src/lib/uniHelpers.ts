import type { UniversityGradeRow, UniversityProfile, UniversityScheduleDay } from '@/lib/universityParser';

export type UniData = {
  checking: boolean;
  bound: boolean;
  loading: boolean;
  schedule: UniversityScheduleDay[];
  grades: UniversityGradeRow[];
  profile: UniversityProfile | null;
};

export const EMPTY_UNI: UniData = {
  checking: true, bound: false, loading: false, schedule: [], grades: [], profile: null,
};

// Индекс совпадает с getDay() (0 — воскресенье)
export const WEEKDAYS_RU = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const KRSK_OFFSET_MS = 7 * 3600_000; // Красноярск: UTC+7, без перехода на летнее время

/** Текущее время в Красноярске. Поля Date читать через getUTC*. */
export function krasnoyarskNow() {
  const k = new Date(Date.now() + KRSK_OFFSET_MS);
  return {
    date: k,
    weekdayIdx: k.getUTCDay(),
    weekday: WEEKDAYS_RU[k.getUTCDay()],
    minutes: k.getUTCHours() * 60 + k.getUTCMinutes(),
  };
}

/** Дата Пн–Сб текущей недели (по Красноярску). */
export function currentWeekDays() {
  const { date, weekdayIdx } = krasnoyarskNow();
  const dow = (weekdayIdx + 6) % 7; // 0 = Пн
  return [1, 2, 3, 4, 5, 6].map((wd, i) => {
    const d = new Date(date.getTime() + (i - dow) * 86400000);
    return { weekday: WEEKDAYS_RU[wd], short: WEEKDAYS_SHORT[wd], num: d.getUTCDate() };
  });
}

/** «08:00 / 09:30», «08.00-09.30» и т.п. → минуты начала и конца. */
export function parseTimeRange(s: string): [number, number] | null {
  const m = [...s.matchAll(/(\d{1,2})[:.](\d{2})/g)];
  if (m.length < 2) return null;
  return [+m[0][1] * 60 + +m[0][2], +m[1][1] * 60 + +m[1][2]];
}

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * Несколько пар в одном слоте (чётная/нечётная неделя) отличаются датами
 * конкретных занятий — «17 ноября», «8 сентября, 22 сентября, ...».
 * true, если список дат содержит сегодняшнее число+месяц, либо дат нет вовсе
 * (тогда сузить выбор нечем — считаем совпадением).
 */
export function datesIncludeToday(dates: string | undefined, today: { day: number; month: number }): boolean {
  if (!dates) return true;
  const re = /(\d{1,2})\s+([а-яё]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dates))) {
    if (+m[1] === today.day && MONTHS_GEN.indexOf(m[2].toLowerCase()) === today.month) return true;
  }
  return false;
}

export function numericGrade(g: string): number | null {
  const n = parseFloat(g.replace(',', '.'));
  return Number.isFinite(n) && n >= 2 && n <= 5 ? n : null;
}

export function gradeColors(n: number) {
  if (n >= 4.5) return { bg: 'var(--c-primary-soft)', fg: 'var(--c-primary-strong)' };
  if (n >= 3.5) return { bg: 'var(--c-info-soft)', fg: 'var(--c-info)' };
  if (n >= 2.5) return { bg: 'var(--c-amber-soft)', fg: 'var(--c-amber)' };
  return { bg: 'var(--c-danger-soft)', fg: 'var(--c-danger)' };
}

export function subjectBase(s: string): string {
  return s.split(' — ')[0].trim();
}

export function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export function fmtAvg(n: number | null): string {
  return n === null ? '—' : n.toFixed(1).replace('.', ',');
}

export function attendancePct(grades: UniversityGradeRow[]): number | null {
  const yes = grades.filter(g => g.grade === 'Явка' || numericGrade(g.grade) !== null).length;
  const no = grades.filter(g => g.grade === 'Неявка').length;
  return yes + no ? Math.round((yes / (yes + no)) * 100) : null;
}
