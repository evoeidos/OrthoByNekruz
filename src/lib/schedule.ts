// ═══════════════════════════════════════════════════════════════════════════
// src/lib/schedule.ts
// ═══════════════════════════════════════════════════════════════════════════
//
// РАСПИСАНИЕ ГРУППЫ + ЛИЧНЫЙ СЛОЙ СТУДЕНТА
//
// Модель:
//   1. Шаблон недели (lessons)      — постоянная сетка «пн, 2 пара, чётная неделя».
//   2. Правки на дату (overrides)   — отмена / замена / разовое занятие.
//   3. Личный слой (personal)       — заметки, отметки, скрытые пары подгруппы,
//                                     свои занятия (отработки, секции).
//
// Календарь считаем в часовом поясе Красноярска (UTC+7) — вуз один,
// серверное время может быть любым.
// ═══════════════════════════════════════════════════════════════════════════

import type { FacultyId } from '@/lib/groupRegistry';

/** Смещение Красноярска от UTC в минутах. Перехода на летнее время нет. */
export const KRSK_UTC_OFFSET_MIN = 7 * 60;

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** Чередование недель: каждую / нечётная (числитель) / чётная (знаменатель). */
export type WeekParity = 'every' | 'odd' | 'even';
export type ConcreteParity = 'odd' | 'even';

export type LessonKind =
  | 'lecture'
  | 'practice'
  | 'seminar'
  | 'lab'
  | 'exam'
  | 'credit'
  | 'consultation'
  | 'other';

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
  7: 'Воскресенье',
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 7: 'Вс',
};

export const LESSON_KIND_LABELS: Record<LessonKind, string> = {
  lecture:      'Лекция',
  practice:     'Практика',
  seminar:      'Семинар',
  lab:          'Лабораторная',
  exam:         'Экзамен',
  credit:       'Зачёт',
  consultation: 'Консультация',
  other:        'Занятие',
};

/** Короткая метка для плотных списков. */
export const LESSON_KIND_SHORT: Record<LessonKind, string> = {
  lecture: 'Лек', practice: 'Практ', seminar: 'Сем', lab: 'Лаб',
  exam: 'Экз', credit: 'Зач', consultation: 'Конс', other: '—',
};

export const LESSON_KIND_COLOR: Record<LessonKind, string> = {
  lecture:      'hsl(210 80% 55%)',
  practice:     'hsl(140 61% 41%)',
  seminar:      'hsl(262 58% 52%)',
  lab:          'hsl(39 82% 43%)',
  exam:         'hsl(0 75% 55%)',
  credit:       'hsl(330 65% 55%)',
  consultation: 'hsl(175 70% 42%)',
  other:        'hsl(220 9% 46%)',
};

export const PARITY_LABELS: Record<WeekParity, string> = {
  every: 'Каждую неделю',
  odd:   'Нечётная неделя',
  even:  'Чётная неделя',
};

// ─── Время пар ─────────────────────────────────────────────────────────────

export interface PairTime {
  pair: number;
  /** HH:MM */
  start: string;
  /** HH:MM */
  end: string;
}

/** Сетка звонков по умолчанию. Админ может переопределить для группы. */
export const DEFAULT_PAIR_TIMES: PairTime[] = [
  { pair: 1, start: '08:30', end: '10:05' },
  { pair: 2, start: '10:15', end: '11:50' },
  { pair: 3, start: '12:20', end: '13:55' },
  { pair: 4, start: '14:05', end: '15:40' },
  { pair: 5, start: '15:50', end: '17:25' },
  { pair: 6, start: '17:35', end: '19:10' },
  { pair: 7, start: '19:20', end: '20:55' },
];

export const MAX_PAIR = 8;

export function resolvePairTime(pair: number, times?: PairTime[] | null): PairTime {
  const list = times && times.length ? times : DEFAULT_PAIR_TIMES;
  return list.find(t => t.pair === pair) ?? { pair, start: '', end: '' };
}

// ─── Занятие в шаблоне недели ──────────────────────────────────────────────

export interface ScheduleLesson {
  id: string;
  weekday: Weekday;
  pair: number;
  weekParity: WeekParity;
  title: string;
  /** Связь с дисциплиной приложения — кнопка «Открыть материалы». */
  subjectId?: string | null;
  kind: LessonKind;
  teacher?: string;
  room?: string;
  building?: string;
  /** Подгруппа: 1, 2 или null (вся группа). */
  subgroup?: 1 | 2 | null;
  note?: string;
  /** Период действия строки расписания, YYYY-MM-DD. */
  startsOn?: string | null;
  endsOn?: string | null;
}

/** Правка на конкретную дату. */
export interface ScheduleOverride {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  kind: 'cancel' | 'add' | 'replace';
  /** Для cancel/replace — какое занятие шаблона затрагиваем. */
  lessonId?: string | null;
  /** Для add/replace — что показать вместо него. */
  lesson?: Omit<ScheduleLesson, 'weekday' | 'weekParity'> | null;
  note?: string;
}

export interface GroupSchedule {
  facultyId: FacultyId;
  /** Полный код группы: 208с */
  studyGroup: string;
  course: number;
  /** Учебный год: 2026/2027 */
  academicYear: string;
  /**
   * Понедельник недели, которая считается НЕЧЁТНОЙ (числитель).
   * От неё считается чередование. YYYY-MM-DD.
   */
  weekAnchorMonday: string;
  pairTimes?: PairTime[] | null;
  lessons: ScheduleLesson[];
  overrides: ScheduleOverride[];
  note?: string;
  updatedAt: string;
  updatedBy?: string;
}

// ─── Личный слой студента ──────────────────────────────────────────────────

/** Занятие, добавленное самим студентом (отработка, кружок, секция). */
export interface PersonalLesson extends ScheduleLesson {
  /** Разовое занятие на дату вместо еженедельной сетки. */
  onDate?: string | null;
}

export interface PersonalSchedule {
  /** Подгруппа студента — скрывает пары чужой подгруппы. */
  subgroup: 1 | 2 | null;
  /** occurrenceKey → заметка. */
  notes: Record<string, string>;
  /** occurrenceKey, отмеченные как выполненные (подготовился / сдал). */
  done: string[];
  /** occurrenceKey или lessonId, скрытые студентом. */
  hidden: string[];
  extras: PersonalLesson[];
  updatedAt: string;
}

export function emptyPersonalSchedule(): PersonalSchedule {
  return {
    subgroup: null,
    notes: {},
    done: [],
    hidden: [],
    extras: [],
    updatedAt: new Date(0).toISOString(),
  };
}

// ─── Даты в поясе Красноярска ──────────────────────────────────────────────

/** YYYY-MM-DD текущей даты по Красноярску. */
export function krskDateKey(nowMs = Date.now()): string {
  return new Date(nowMs + KRSK_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** HH:MM текущего времени по Красноярску. */
export function krskTimeKey(nowMs = Date.now()): string {
  return new Date(nowMs + KRSK_UTC_OFFSET_MIN * 60_000).toISOString().slice(11, 16);
}

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t);
}

/** Полдень UTC выбранной даты — безопасно для арифметики без часовых поясов. */
function dateKeyToUtcMs(dateKey: string): number {
  return Date.parse(`${dateKey}T12:00:00Z`);
}

export function addDays(dateKey: string, days: number): string {
  return new Date(dateKeyToUtcMs(dateKey) + days * 86_400_000).toISOString().slice(0, 10);
}

export function diffDays(fromKey: string, toKey: string): number {
  return Math.round((dateKeyToUtcMs(toKey) - dateKeyToUtcMs(fromKey)) / 86_400_000);
}

/** 1 = понедельник … 7 = воскресенье. */
export function weekdayOf(dateKey: string): Weekday {
  const jsDay = new Date(dateKeyToUtcMs(dateKey)).getUTCDay();
  return (jsDay === 0 ? 7 : jsDay) as Weekday;
}

export function mondayOf(dateKey: string): string {
  return addDays(dateKey, 1 - weekdayOf(dateKey));
}

export function weekDates(mondayKey: string, days = 7): string[] {
  return Array.from({ length: days }, (_, i) => addDays(mondayKey, i));
}

/** Чётность недели относительно опорного понедельника расписания. */
export function parityOf(dateKey: string, anchorMonday: string): ConcreteParity {
  const monday = mondayOf(dateKey);
  const weeks = Math.floor(diffDays(mondayOf(anchorMonday), monday) / 7);
  // Остаток от отрицательных значений в JS отрицательный — нормализуем.
  return ((weeks % 2) + 2) % 2 === 0 ? 'odd' : 'even';
}

export function formatDateHuman(dateKey: string): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const d = new Date(dateKeyToUtcMs(dateKey));
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

// ─── Развёртка шаблона в занятия конкретных дат ────────────────────────────

export interface ScheduleOccurrence {
  /** `${date}#${lessonId}` — стабильный ключ для заметок и отметок. */
  key: string;
  date: string;
  weekday: Weekday;
  parity: ConcreteParity;
  pair: number;
  start: string;
  end: string;
  lesson: ScheduleLesson;
  source: 'template' | 'override' | 'personal';
  cancelled: boolean;
  /** Пояснение к отмене или переносу. */
  changeNote?: string;
  /** Занятие заменено правкой на эту дату. */
  replaced: boolean;
}

export function occurrenceKey(date: string, lessonId: string): string {
  return `${date}#${lessonId}`;
}

function lessonActiveOn(lesson: ScheduleLesson, dateKey: string): boolean {
  if (lesson.startsOn && dateKey < lesson.startsOn) return false;
  if (lesson.endsOn && dateKey > lesson.endsOn) return false;
  return true;
}

function matchesParity(lesson: ScheduleLesson, parity: ConcreteParity): boolean {
  return lesson.weekParity === 'every' || lesson.weekParity === parity;
}

export interface ResolveOptions {
  /** Пары чужой подгруппы не показываем. */
  subgroup?: 1 | 2 | null;
  /** Скрытые студентом occurrenceKey / lessonId. */
  hidden?: string[];
  /** Личные занятия студента. */
  extras?: PersonalLesson[];
  /** Показывать отменённые занятия зачёркнутыми (по умолчанию да). */
  includeCancelled?: boolean;
}

function toOccurrence(
  lesson: ScheduleLesson,
  dateKey: string,
  parity: ConcreteParity,
  pairTimes: PairTime[] | null | undefined,
  source: ScheduleOccurrence['source'],
): ScheduleOccurrence {
  const time = resolvePairTime(lesson.pair, pairTimes);
  return {
    key: occurrenceKey(dateKey, lesson.id),
    date: dateKey,
    weekday: weekdayOf(dateKey),
    parity,
    pair: lesson.pair,
    start: time.start,
    end: time.end,
    lesson,
    source,
    cancelled: false,
    replaced: false,
  };
}

/** Занятия одной даты: шаблон + правки + личные занятия, отсортированы по паре. */
export function resolveDayOccurrences(
  schedule: GroupSchedule | null,
  dateKey: string,
  opts: ResolveOptions = {},
): ScheduleOccurrence[] {
  const includeCancelled = opts.includeCancelled !== false;
  const hidden = new Set(opts.hidden ?? []);
  const parity = schedule ? parityOf(dateKey, schedule.weekAnchorMonday) : 'odd';
  const pairTimes = schedule?.pairTimes;
  const weekday = weekdayOf(dateKey);

  const dayOverrides = (schedule?.overrides ?? []).filter(o => o.date === dateKey);
  const cancelledIds = new Set(
    dayOverrides.filter(o => o.kind === 'cancel' && o.lessonId).map(o => String(o.lessonId)),
  );
  const replacedIds = new Set(
    dayOverrides.filter(o => o.kind === 'replace' && o.lessonId).map(o => String(o.lessonId)),
  );

  const out: ScheduleOccurrence[] = [];

  for (const lesson of schedule?.lessons ?? []) {
    if (lesson.weekday !== weekday) continue;
    if (!matchesParity(lesson, parity)) continue;
    if (!lessonActiveOn(lesson, dateKey)) continue;
    if (hidden.has(lesson.id) || hidden.has(occurrenceKey(dateKey, lesson.id))) continue;
    if (!matchesSubgroup(lesson.subgroup, opts.subgroup)) continue;

    const isCancelled = cancelledIds.has(lesson.id);
    const isReplaced = replacedIds.has(lesson.id);
    if (isReplaced) continue;
    if (isCancelled && !includeCancelled) continue;

    const occ = toOccurrence(lesson, dateKey, parity, pairTimes, 'template');
    occ.cancelled = isCancelled;
    occ.changeNote = dayOverrides.find(o => o.lessonId === lesson.id)?.note;
    out.push(occ);
  }

  for (const override of dayOverrides) {
    if (override.kind === 'cancel' || !override.lesson) continue;
    const base: ScheduleLesson = {
      ...override.lesson,
      weekday,
      weekParity: 'every',
    };
    if (hidden.has(base.id) || hidden.has(occurrenceKey(dateKey, base.id))) continue;
    if (!matchesSubgroup(base.subgroup, opts.subgroup)) continue;

    const occ = toOccurrence(base, dateKey, parity, pairTimes, 'override');
    occ.replaced = override.kind === 'replace';
    occ.changeNote = override.note;
    out.push(occ);
  }

  for (const extra of opts.extras ?? []) {
    const onDate = extra.onDate ?? null;
    if (onDate) {
      if (onDate !== dateKey) continue;
    } else {
      if (extra.weekday !== weekday) continue;
      if (!matchesParity(extra, parity)) continue;
      if (!lessonActiveOn(extra, dateKey)) continue;
    }
    if (hidden.has(extra.id) || hidden.has(occurrenceKey(dateKey, extra.id))) continue;
    out.push(toOccurrence(extra, dateKey, parity, pairTimes, 'personal'));
  }

  return out.sort((a, b) => a.pair - b.pair || a.lesson.title.localeCompare(b.lesson.title, 'ru'));
}

function matchesSubgroup(
  lessonSubgroup: 1 | 2 | null | undefined,
  studentSubgroup: 1 | 2 | null | undefined,
): boolean {
  if (!lessonSubgroup) return true;
  if (!studentSubgroup) return true;
  return lessonSubgroup === studentSubgroup;
}

export interface ScheduleDay {
  date: string;
  weekday: Weekday;
  parity: ConcreteParity;
  occurrences: ScheduleOccurrence[];
}

export function resolveRange(
  schedule: GroupSchedule | null,
  fromKey: string,
  toKey: string,
  opts: ResolveOptions = {},
): ScheduleDay[] {
  const days: ScheduleDay[] = [];
  const total = Math.min(diffDays(fromKey, toKey), 62);
  for (let i = 0; i <= total; i++) {
    const date = addDays(fromKey, i);
    days.push({
      date,
      weekday: weekdayOf(date),
      parity: schedule ? parityOf(date, schedule.weekAnchorMonday) : 'odd',
      occurrences: resolveDayOccurrences(schedule, date, opts),
    });
  }
  return days;
}

/** Ближайшее занятие начиная с текущего момента по Красноярску. */
export function findNextOccurrence(
  days: ScheduleDay[],
  nowMs = Date.now(),
): ScheduleOccurrence | null {
  const today = krskDateKey(nowMs);
  const now = krskTimeKey(nowMs);
  for (const day of days) {
    if (day.date < today) continue;
    for (const occ of day.occurrences) {
      if (occ.cancelled) continue;
      if (day.date === today && occ.end && occ.end <= now) continue;
      return occ;
    }
  }
  return null;
}

// ─── Валидация и нормализация (вход из админки / API) ──────────────────────

const LESSON_KINDS = new Set<LessonKind>([
  'lecture', 'practice', 'seminar', 'lab', 'exam', 'credit', 'consultation', 'other',
]);

const MAX_LESSONS = 300;
const MAX_OVERRIDES = 400;
const MAX_EXTRAS = 60;
const MAX_TITLE = 120;
const MAX_NOTE = 400;

function str(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function optStr(value: unknown, max: number): string | undefined {
  const s = str(value, max);
  return s || undefined;
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeWeekday(value: unknown): Weekday {
  const n = Number(value);
  return (Number.isFinite(n) && n >= 1 && n <= 7 ? n : 1) as Weekday;
}

export function normalizePair(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_PAIR, Math.max(1, Math.round(n)));
}

export function normalizeParity(value: unknown): WeekParity {
  const v = String(value ?? 'every');
  return v === 'odd' || v === 'even' ? v : 'every';
}

function normalizeSubgroup(value: unknown): 1 | 2 | null {
  const n = Number(value);
  return n === 1 || n === 2 ? (n as 1 | 2) : null;
}

export function normalizeLesson(input: unknown, idPrefix = 'l'): ScheduleLesson | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const title = str(raw.title, MAX_TITLE);
  if (!title) return null;

  const kindRaw = String(raw.kind ?? 'practice') as LessonKind;
  return {
    id: str(raw.id, 40) || randomId(idPrefix),
    weekday: normalizeWeekday(raw.weekday),
    pair: normalizePair(raw.pair),
    weekParity: normalizeParity(raw.weekParity),
    title,
    subjectId: optStr(raw.subjectId, 40) ?? null,
    kind: LESSON_KINDS.has(kindRaw) ? kindRaw : 'practice',
    teacher: optStr(raw.teacher, 80),
    room: optStr(raw.room, 40),
    building: optStr(raw.building, 60),
    subgroup: normalizeSubgroup(raw.subgroup),
    note: optStr(raw.note, MAX_NOTE),
    startsOn: isValidDateKey(raw.startsOn) ? raw.startsOn : null,
    endsOn: isValidDateKey(raw.endsOn) ? raw.endsOn : null,
  };
}

export function normalizePersonalLesson(input: unknown): PersonalLesson | null {
  const base = normalizeLesson(input, 'my');
  if (!base) return null;
  const raw = input as Record<string, unknown>;
  return { ...base, onDate: isValidDateKey(raw.onDate) ? raw.onDate : null };
}

export function normalizeOverride(input: unknown): ScheduleOverride | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (!isValidDateKey(raw.date)) return null;

  const kind = String(raw.kind ?? '');
  if (kind !== 'cancel' && kind !== 'add' && kind !== 'replace') return null;

  const lessonId = optStr(raw.lessonId, 40) ?? null;
  if ((kind === 'cancel' || kind === 'replace') && !lessonId) return null;

  let lesson: ScheduleOverride['lesson'] = null;
  if (kind === 'add' || kind === 'replace') {
    const normalized = normalizeLesson(raw.lesson, 'ov');
    if (!normalized) return null;
    const { weekday: _weekday, weekParity: _weekParity, ...rest } = normalized;
    lesson = rest;
  }

  return {
    id: str(raw.id, 40) || randomId('ov'),
    date: raw.date,
    kind,
    lessonId,
    lesson,
    note: optStr(raw.note, MAX_NOTE),
  };
}

function normalizePairTimes(input: unknown): PairTime[] | null {
  if (!Array.isArray(input)) return null;
  const out: PairTime[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const pair = normalizePair(raw.pair);
    const start = str(raw.start, 5);
    const end = str(raw.end, 5);
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) continue;
    if (out.some(t => t.pair === pair)) continue;
    out.push({ pair, start, end });
  }
  return out.length ? out.sort((a, b) => a.pair - b.pair) : null;
}

/** Учебный год вида 2026/2027; по умолчанию — текущий (сентябрь — граница). */
export function currentAcademicYear(nowMs = Date.now()): string {
  const d = new Date(nowMs + KRSK_UTC_OFFSET_MIN * 60_000);
  const year = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 8 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

export function normalizeAcademicYear(value: unknown): string {
  const v = str(value, 9);
  return /^\d{4}\/\d{4}$/.test(v) ? v : currentAcademicYear();
}

export interface NormalizeScheduleInput {
  facultyId: FacultyId;
  studyGroup: string;
  course: number;
  raw: unknown;
  updatedBy?: string;
  previous?: GroupSchedule | null;
}

export function normalizeGroupSchedule(input: NormalizeScheduleInput): GroupSchedule {
  const raw = (input.raw && typeof input.raw === 'object' ? input.raw : {}) as Record<string, unknown>;

  const lessons: ScheduleLesson[] = [];
  const seenLessonIds = new Set<string>();
  if (Array.isArray(raw.lessons)) {
    for (const item of raw.lessons.slice(0, MAX_LESSONS)) {
      const lesson = normalizeLesson(item);
      if (!lesson) continue;
      while (seenLessonIds.has(lesson.id)) lesson.id = randomId('l');
      seenLessonIds.add(lesson.id);
      lessons.push(lesson);
    }
  }

  const overrides: ScheduleOverride[] = [];
  if (Array.isArray(raw.overrides)) {
    for (const item of raw.overrides.slice(0, MAX_OVERRIDES)) {
      const override = normalizeOverride(item);
      if (override) overrides.push(override);
    }
  }

  const anchor = isValidDateKey(raw.weekAnchorMonday)
    ? mondayOf(raw.weekAnchorMonday)
    : (input.previous?.weekAnchorMonday ?? mondayOf(krskDateKey()));

  return {
    facultyId: input.facultyId,
    studyGroup: input.studyGroup,
    course: input.course,
    academicYear: normalizeAcademicYear(raw.academicYear ?? input.previous?.academicYear),
    weekAnchorMonday: anchor,
    pairTimes: normalizePairTimes(raw.pairTimes),
    lessons: lessons.sort((a, b) => a.weekday - b.weekday || a.pair - b.pair),
    overrides: overrides.sort((a, b) => a.date.localeCompare(b.date)),
    note: optStr(raw.note, MAX_NOTE),
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy,
  };
}

export function normalizePersonalSchedule(input: unknown): PersonalSchedule {
  const base = emptyPersonalSchedule();
  if (!input || typeof input !== 'object') return base;
  const raw = input as Record<string, unknown>;

  const notes: Record<string, string> = {};
  if (raw.notes && typeof raw.notes === 'object') {
    for (const [key, value] of Object.entries(raw.notes as Record<string, unknown>)) {
      const note = str(value, MAX_NOTE);
      if (note) notes[str(key, 60)] = note;
    }
  }

  const extras: PersonalLesson[] = [];
  if (Array.isArray(raw.extras)) {
    for (const item of raw.extras.slice(0, MAX_EXTRAS)) {
      const lesson = normalizePersonalLesson(item);
      if (lesson) extras.push(lesson);
    }
  }

  return {
    subgroup: normalizeSubgroup(raw.subgroup),
    notes,
    done: Array.isArray(raw.done) ? raw.done.map(v => str(v, 60)).filter(Boolean).slice(0, 2000) : [],
    hidden: Array.isArray(raw.hidden) ? raw.hidden.map(v => str(v, 60)).filter(Boolean).slice(0, 500) : [],
    extras,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
  };
}

/** Пустое расписание — используется, когда админ ещё не заполнил группу. */
export function createEmptyGroupSchedule(
  facultyId: FacultyId,
  studyGroup: string,
  course: number,
): GroupSchedule {
  return {
    facultyId,
    studyGroup,
    course,
    academicYear: currentAcademicYear(),
    weekAnchorMonday: mondayOf(krskDateKey()),
    pairTimes: null,
    lessons: [],
    overrides: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Уникальные дисциплины расписания — для связи с учебным планом и статистикой. */
export function scheduleSubjectIds(schedule: GroupSchedule | null): string[] {
  if (!schedule) return [];
  const set = new Set<string>();
  for (const lesson of schedule.lessons) {
    if (lesson.subjectId) set.add(lesson.subjectId);
  }
  for (const override of schedule.overrides) {
    if (override.lesson?.subjectId) set.add(override.lesson.subjectId);
  }
  return [...set];
}

/** Сколько пар в неделю по шаблону — для карточки группы в админке. */
export function weeklyLessonCount(schedule: GroupSchedule | null): number {
  if (!schedule) return 0;
  return schedule.lessons.reduce(
    (sum, lesson) => sum + (lesson.weekParity === 'every' ? 2 : 1),
    0,
  ) / 2;
}
