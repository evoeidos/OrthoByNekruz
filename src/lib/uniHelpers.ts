import type {
  UniversityCycle,
  UniversityGradeRow,
  UniversityMatchedTopic,
  UniversityProfile,
  UniversityScheduleDay,
} from '@/lib/universityParser';

export type UniData = {
  checking: boolean;
  bound: boolean;
  loading: boolean;
  schedule: UniversityScheduleDay[];
  /** Цикловое расписание (практика/производственная практика по датам семестра) — заглушки «ПРАКТИКА» в schedule резолвятся через это. */
  cycles: UniversityCycle[];
  grades: UniversityGradeRow[];
  profile: UniversityProfile | null;
  /** Темы лекций из УМКД, сшитые по датам: дисциплина → дата (без года) → тема. Догружается отдельно и позже остального. */
  topics: Record<string, Record<string, UniversityMatchedTopic>>;
  /** Темы практики (по активному циклу) — дисциплина → дата «D month YYYY» (с годом) → тема. */
  practiceTopics: Record<string, Record<string, UniversityMatchedTopic>>;
};

export const EMPTY_UNI: UniData = {
  checking: true, bound: false, loading: false, schedule: [], cycles: [], grades: [], profile: null,
  topics: {}, practiceTopics: {},
};

/** Идентификация текущего пользователя для запросов к /api/auth/university/*. */
export function getTelegramAuth() {
  const telegram_id = localStorage.getItem('user_tg_id') || '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initData = (window as any).Telegram?.WebApp?.initData || '';
  return { telegram_id, initData };
}

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

/** Дата Пн–Сб недели (по Красноярску), сдвинутой на weekOffset недель. month — 0-based, свой для каждого дня (неделя может пересекать границу месяца). */
export function currentWeekDays(weekOffset = 0) {
  const { date, weekdayIdx } = krasnoyarskNow();
  const dow = (weekdayIdx + 6) % 7; // 0 = Пн
  return [1, 2, 3, 4, 5, 6].map((wd, i) => {
    const d = new Date(date.getTime() + (i - dow + weekOffset * 7) * 86400000);
    return { weekday: WEEKDAYS_RU[wd], short: WEEKDAYS_SHORT[wd], num: d.getUTCDate(), month: d.getUTCMonth(), date: d };
  });
}

/** «1 сентября 2026» → Date (UTC-полночь), либо null при нераспознанном формате. */
export function parseRuFullDate(s: string): Date | null {
  const m = s.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS_GEN.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  return new Date(Date.UTC(+m[3], month, +m[1]));
}

/** Цикл (практика/производственная практика), в диапазон дат которого попадает заданный день. */
export function findActiveCycle(cycles: UniversityCycle[], date: Date): UniversityCycle | null {
  const t = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  for (const c of cycles) {
    const start = parseRuFullDate(c.startDate);
    const end = parseRuFullDate(c.endDate);
    if (start && end && t >= start.getTime() && t <= end.getTime()) return c;
  }
  return null;
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
 * Из списка дат («17 ноября», «8 сентября, 22 сентября, ...») находит и
 * возвращает исходную строку, чьи день+месяц совпадают с заданными —
 * ей же проиндексирована карта тем УМКД (dateMatch в UniData.topics).
 */
export function findMatchingDateEntry(
  dates: string | undefined,
  target: { day: number; month: number },
): string | null {
  if (!dates) return null;
  for (const raw of dates.split(',').map(d => d.trim())) {
    const m = raw.match(/(\d{1,2})\s+([а-яё]+)/i);
    if (m && +m[1] === target.day && MONTHS_GEN.indexOf(m[2].toLowerCase()) === target.month) return raw;
  }
  return null;
}

/**
 * Несколько пар в одном слоте (чётная/нечётная неделя) отличаются датами
 * конкретных занятий. true, если среди дат есть сегодняшняя, либо дат нет
 * вовсе (тогда сузить выбор нечем — считаем совпадением).
 */
export function datesIncludeToday(dates: string | undefined, today: { day: number; month: number }): boolean {
  return dates === undefined || findMatchingDateEntry(dates, today) !== null;
}

export function numericGrade(g: string): number | null {
  const n = parseFloat(g.replace(',', '.'));
  return Number.isFinite(n) && n >= 2 && n <= 5 ? n : null;
}

/** Оценка (в т.ч. дробная) → 5/4/3/2 по тем же порогам, что и цвет: «4,5» считается пятёркой. */
export function gradeBucket(n: number): 5 | 4 | 3 | 2 {
  if (n >= 4.5) return 5;
  if (n >= 3.5) return 4;
  if (n >= 2.5) return 3;
  return 2;
}

/** bg/fg — плашка с цифрой, solid — заливка шкал и кольца. */
export function gradeColors(n: number) {
  switch (gradeBucket(n)) {
    case 5: return { bg: 'var(--c-primary-soft)', fg: 'var(--c-primary-strong)', solid: 'var(--c-primary)' };
    case 4: return { bg: 'var(--c-info-soft)', fg: 'var(--c-info)', solid: 'var(--c-info)' };
    case 3: return { bg: 'var(--c-amber-soft)', fg: 'var(--c-amber)', solid: 'var(--c-amber)' };
    default: return { bg: 'var(--c-danger-soft)', fg: 'var(--c-danger)', solid: 'var(--c-danger)' };
  }
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
