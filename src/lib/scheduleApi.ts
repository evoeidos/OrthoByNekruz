import type { CurriculumDiscipline, CurriculumSemester, SemesterSummary } from '@/lib/curriculum';
import type {
  ConcreteParity,
  PairTime,
  PersonalLesson,
  PersonalSchedule,
  ScheduleDay,
} from '@/lib/schedule';

export interface ScheduleSubjectMeta {
  id: string;
  label: string;
  color: string;
  badge?: string;
}

export interface ScheduleGroupMeta {
  academicYear: string;
  weekAnchorMonday: string;
  pairTimes: PairTime[];
  note: string | null;
  updatedAt: string;
  currentParity: ConcreteParity;
  lessonCount: number;
}

export interface SchedulePlanPayload {
  academicYear: string;
  note: string | null;
  updatedAt: string;
  activeSemester: 1 | 2 | null;
  semesters: CurriculumSemester[];
  summary: SemesterSummary;
  upcoming: CurriculumDiscipline[];
}

export interface ScheduleResponse {
  ok: true;
  today: string;
  needsFaculty?: boolean;
  needsStudyGroup?: boolean;
  faculties?: { id: string; label: string }[];
  facultyId?: string;
  facultyLabel?: string;
  studyGroup?: string;
  course?: number;
  isOwnGroup?: boolean;
  hasSchedule?: boolean;
  weekStart?: string;
  weekDates?: string[];
  group?: ScheduleGroupMeta | null;
  days?: ScheduleDay[];
  plan?: SchedulePlanPayload | null;
  personal?: PersonalSchedule | null;
  subjects?: ScheduleSubjectMeta[];
  allSubjects?: { id: string; label: string; color: string }[];
}

function authBody(extra: Record<string, unknown>) {
  const tgId = typeof window === 'undefined' ? null : localStorage.getItem('user_tg_id');
  const initData = typeof window === 'undefined'
    ? ''
    : (window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData || '';
  return { telegramId: tgId, initData, ...extra };
}

async function post<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/schedule', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(authBody(payload)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Не удалось загрузить расписание');
  }
  return data as T;
}

export interface FetchScheduleParams {
  /** Понедельник недели, которую показываем. */
  from?: string;
  days?: number;
  /** Просмотр чужой группы — режим «только чтение». */
  viewFacultyId?: string;
  viewStudyGroup?: string;
}

export function fetchSchedule(params: FetchScheduleParams = {}): Promise<ScheduleResponse> {
  return post<ScheduleResponse>({ mode: 'get', ...params });
}

type PersonalResponse = { ok: true; personal: PersonalSchedule };

export function setScheduleSubgroup(subgroup: 1 | 2 | null): Promise<PersonalResponse> {
  return post<PersonalResponse>({ mode: 'set_subgroup', subgroup });
}

export function setLessonNote(key: string, note: string): Promise<PersonalResponse> {
  return post<PersonalResponse>({ mode: 'set_note', key, note });
}

export function toggleLessonDone(key: string, done?: boolean): Promise<PersonalResponse> {
  return post<PersonalResponse>({ mode: 'toggle_done', key, done });
}

export function setLessonHidden(key: string, hidden?: boolean): Promise<PersonalResponse> {
  return post<PersonalResponse>({ mode: 'set_hidden', key, hidden });
}

export function addPersonalLesson(lesson: Partial<PersonalLesson>): Promise<PersonalResponse> {
  return post<PersonalResponse>({ mode: 'add_extra', lesson });
}

export function removePersonalLesson(id: string): Promise<PersonalResponse> {
  return post<PersonalResponse>({ mode: 'remove_extra', id });
}

export function saveStudyGroupFromSchedule(digits: string): Promise<{ ok: true; studyGroup: string }> {
  return post<{ ok: true; studyGroup: string }>({ mode: 'set_study_group', studyGroup: digits });
}
