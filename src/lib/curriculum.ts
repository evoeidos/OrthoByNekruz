// ═══════════════════════════════════════════════════════════════════════════
// src/lib/curriculum.ts
// ═══════════════════════════════════════════════════════════════════════════
//
// УЧЕБНЫЙ ПЛАН КУРСА
//
// План привязан к паре «факультет + курс» — он одинаков для всех групп курса,
// а расписание (schedule.ts) уже своё у каждой группы.
//
// План отвечает студенту на вопросы: что я изучаю в этом семестре, сколько
// часов, что сдаю (экзамен/зачёт) и есть ли материалы в приложении.
// ═══════════════════════════════════════════════════════════════════════════

import type { FacultyId } from '@/lib/groupRegistry';
import { currentAcademicYear, isValidDateKey, normalizeAcademicYear } from '@/lib/schedule';
import { getSubject } from '@/lib/subjects';

export type ControlForm = 'exam' | 'credit' | 'credit_grade' | 'coursework' | 'none';

export const CONTROL_FORM_LABELS: Record<ControlForm, string> = {
  exam:         'Экзамен',
  credit:       'Зачёт',
  credit_grade: 'Зачёт с оценкой',
  coursework:   'Курсовая',
  none:         'Без аттестации',
};

export const CONTROL_FORM_COLOR: Record<ControlForm, string> = {
  exam:         'hsl(0 75% 55%)',
  credit:       'hsl(140 61% 41%)',
  credit_grade: 'hsl(39 82% 43%)',
  coursework:   'hsl(262 58% 52%)',
  none:         'hsl(220 9% 46%)',
};

export type SemesterNumber = 1 | 2;

export interface CurriculumDiscipline {
  id: string;
  title: string;
  /** Кафедра, которая ведёт дисциплину. */
  department?: string;
  /** Связь с дисциплиной приложения — открывает вопросы/тесты/задачи. */
  subjectId?: string | null;
  hoursLecture?: number;
  hoursPractice?: number;
  hoursSelf?: number;
  /** Зачётные единицы. */
  credits?: number;
  control: ControlForm;
  /** Дата аттестации, YYYY-MM-DD — показываем обратный отсчёт. */
  controlDate?: string | null;
  note?: string;
}

export interface CurriculumSemester {
  semester: SemesterNumber;
  /** Даты начала и конца семестра — для прогресса «пройдено N%». */
  startsOn?: string | null;
  endsOn?: string | null;
  disciplines: CurriculumDiscipline[];
}

export interface CurriculumPlan {
  facultyId: FacultyId;
  course: number;
  academicYear: string;
  semesters: CurriculumSemester[];
  note?: string;
  updatedAt: string;
  updatedBy?: string;
}

// ─── Нормализация входа ────────────────────────────────────────────────────

const CONTROL_FORMS = new Set<ControlForm>([
  'exam', 'credit', 'credit_grade', 'coursework', 'none',
]);

const MAX_DISCIPLINES = 40;
const MAX_TITLE = 120;
const MAX_NOTE = 400;

function str(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function optStr(value: unknown, max: number): string | undefined {
  const s = str(value, max);
  return s || undefined;
}

function optHours(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(2000, Math.round(n));
}

function randomId(): string {
  return `d_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeDiscipline(input: unknown): CurriculumDiscipline | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const title = str(raw.title, MAX_TITLE);
  if (!title) return null;

  const controlRaw = String(raw.control ?? 'none') as ControlForm;
  const subjectId = optStr(raw.subjectId, 40) ?? null;

  return {
    id: str(raw.id, 40) || randomId(),
    title,
    department: optStr(raw.department, 120),
    subjectId: subjectId && getSubject(subjectId) ? subjectId : null,
    hoursLecture: optHours(raw.hoursLecture),
    hoursPractice: optHours(raw.hoursPractice),
    hoursSelf: optHours(raw.hoursSelf),
    credits: optHours(raw.credits),
    control: CONTROL_FORMS.has(controlRaw) ? controlRaw : 'none',
    controlDate: isValidDateKey(raw.controlDate) ? raw.controlDate : null,
    note: optStr(raw.note, MAX_NOTE),
  };
}

function normalizeSemester(input: unknown, fallback: SemesterNumber): CurriculumSemester {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const semesterNum = Number(raw.semester);
  const disciplines: CurriculumDiscipline[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw.disciplines)) {
    for (const item of raw.disciplines.slice(0, MAX_DISCIPLINES)) {
      const discipline = normalizeDiscipline(item);
      if (!discipline) continue;
      while (seen.has(discipline.id)) discipline.id = randomId();
      seen.add(discipline.id);
      disciplines.push(discipline);
    }
  }

  return {
    semester: (semesterNum === 1 || semesterNum === 2 ? semesterNum : fallback) as SemesterNumber,
    startsOn: isValidDateKey(raw.startsOn) ? raw.startsOn : null,
    endsOn: isValidDateKey(raw.endsOn) ? raw.endsOn : null,
    disciplines,
  };
}

export function normalizeCurriculumPlan(
  facultyId: FacultyId,
  course: number,
  raw: unknown,
  updatedBy?: string,
): CurriculumPlan {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const semestersRaw = Array.isArray(source.semesters) ? source.semesters : [];

  const first = semestersRaw.find(s => Number((s as Record<string, unknown>)?.semester) === 1)
    ?? semestersRaw[0];
  const second = semestersRaw.find(s => Number((s as Record<string, unknown>)?.semester) === 2)
    ?? semestersRaw[1];

  return {
    facultyId,
    course,
    academicYear: normalizeAcademicYear(source.academicYear),
    semesters: [normalizeSemester(first, 1), normalizeSemester(second, 2)],
    note: optStr(source.note, MAX_NOTE),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function createEmptyCurriculumPlan(
  facultyId: FacultyId,
  course: number,
): CurriculumPlan {
  return {
    facultyId,
    course,
    academicYear: currentAcademicYear(),
    semesters: [
      { semester: 1, startsOn: null, endsOn: null, disciplines: [] },
      { semester: 2, startsOn: null, endsOn: null, disciplines: [] },
    ],
    updatedAt: new Date().toISOString(),
  };
}

// ─── Производные данные для UI ─────────────────────────────────────────────

/** Осенний семестр — первый (сентябрь-январь), весенний — второй. */
export function currentSemesterNumber(dateKey: string): SemesterNumber {
  const month = Number(dateKey.slice(5, 7));
  return month >= 9 || month === 1 ? 1 : 2;
}

/** Семестр, идущий сейчас: сперва по датам плана, иначе по календарю. */
export function resolveActiveSemester(
  plan: CurriculumPlan | null,
  dateKey: string,
): CurriculumSemester | null {
  if (!plan) return null;
  const byDate = plan.semesters.find(
    s => s.startsOn && s.endsOn && dateKey >= s.startsOn && dateKey <= s.endsOn,
  );
  if (byDate) return byDate;
  const fallback = currentSemesterNumber(dateKey);
  return plan.semesters.find(s => s.semester === fallback) ?? plan.semesters[0] ?? null;
}

export function disciplineTotalHours(discipline: CurriculumDiscipline): number {
  return (discipline.hoursLecture ?? 0)
    + (discipline.hoursPractice ?? 0)
    + (discipline.hoursSelf ?? 0);
}

export interface SemesterSummary {
  disciplines: number;
  exams: number;
  credits: number;
  totalHours: number;
}

export function summarizeSemester(semester: CurriculumSemester | null): SemesterSummary {
  if (!semester) return { disciplines: 0, exams: 0, credits: 0, totalHours: 0 };
  return semester.disciplines.reduce<SemesterSummary>(
    (acc, discipline) => ({
      disciplines: acc.disciplines + 1,
      exams: acc.exams + (discipline.control === 'exam' ? 1 : 0),
      credits: acc.credits
        + (discipline.control === 'credit' || discipline.control === 'credit_grade' ? 1 : 0),
      totalHours: acc.totalHours + disciplineTotalHours(discipline),
    }),
    { disciplines: 0, exams: 0, credits: 0, totalHours: 0 },
  );
}

/** Прогресс семестра в процентах по датам начала и конца. */
export function semesterProgressPct(
  semester: CurriculumSemester | null,
  dateKey: string,
): number | null {
  if (!semester?.startsOn || !semester?.endsOn) return null;
  const start = Date.parse(`${semester.startsOn}T00:00:00Z`);
  const end = Date.parse(`${semester.endsOn}T00:00:00Z`);
  const now = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round(Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)));
}

/** Ближайшие аттестации — блок «Скоро сдавать». */
export function upcomingControls(
  plan: CurriculumPlan | null,
  dateKey: string,
  limit = 3,
): CurriculumDiscipline[] {
  if (!plan) return [];
  return plan.semesters
    .flatMap(s => s.disciplines)
    .filter(d => d.controlDate && d.controlDate >= dateKey)
    .sort((a, b) => String(a.controlDate).localeCompare(String(b.controlDate)))
    .slice(0, limit);
}

/** Дисциплины плана, у которых уже есть контент в приложении. */
export function planSubjectIds(plan: CurriculumPlan | null): string[] {
  if (!plan) return [];
  const set = new Set<string>();
  for (const semester of plan.semesters) {
    for (const discipline of semester.disciplines) {
      if (discipline.subjectId) set.add(discipline.subjectId);
    }
  }
  return [...set];
}
