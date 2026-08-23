/**
 * Программа кафедры: занятия по плану, контрольные и коллоквиумы.
 *
 * Программа одна на факультет + курс + предмет — у всех групп курса план
 * совпадает. Группе программа только присваивается, поэтому «расписание
 * группы» — это набор предметов, а не отдельный список занятий на каждую
 * группу. Дат нет: занятия идут по порядку, дата появится, когда будет
 * настоящее расписание вуза.
 */
import type { AppRedis } from '@/lib/redis';
import type { FacultyId } from '@/lib/groupRegistry';
import { getSubject } from '@/lib/subjects';
import { normalizeStudyGroup } from '@/lib/studyGroup';
import { listSeedPrograms } from '@/lib/curriculumSeed';

export const CURRICULUM_INDEX_KEY = 'curriculum:index';
export const CURRICULUM_SUPPRESSED_KEY = 'curriculum:suppressed';
export const GROUP_PROGRAMS_KEY = 'curriculum:group_programs';

export function programKey(programId: string): string {
  return `curriculum:program:${programId}`;
}

export function buildProgramId(
  facultyId: FacultyId,
  course: number,
  subjectId: string,
): string {
  return `${facultyId}:${course}:${subjectId}`;
}

/** Тип пункта плана. Контрольная и коллоквиум закрывают несколько занятий. */
export type LessonKind = 'lesson' | 'control' | 'colloquium';

export const LESSON_KIND_LABELS: Record<LessonKind, string> = {
  lesson:     'Занятие',
  control:    'Контрольная',
  colloquium: 'Коллоквиум',
};

export interface Lesson {
  id: string;
  /** Позиция в плане курса, начиная с 1 */
  order: number;
  /**
   * Номер темы в плане кафедры. Кафедра нумерует темы сквозь всю дисциплину
   * (1–45), поэтому на 2 курсе занятие №1 может быть темой №31 — студенты и
   * методички ссылаются именно на этот номер.
   */
  planNumber?: number;
  /** Семестр по плану кафедры */
  semester?: number;
  kind: LessonKind;
  /** Тема как в плане кафедры */
  title: string;
  /** Понятное объяснение темы для студента */
  summary?: string;
  /** Что нужно уметь к паре — короткие пункты */
  objectives?: string[];
  /** Термины занятия для карточек и «верно/неверно» */
  terms?: string[];
  /** Для контрольной и коллоквиума: номера занятий, которые входят в блок */
  covers?: number[];
  hours?: number;
  note?: string;
}

/** Лекция из тематического плана лекций — фон к практическим занятиям. */
export interface Lecture {
  id: string;
  order: number;
  planNumber?: number;
  semester?: number;
  title: string;
  summary?: string;
  hours?: number;
}

export interface Program {
  id: string;
  facultyId: FacultyId;
  course: number;
  subjectId: string;
  /** Название плана: «Анатомия, 2 курс, педиатрия» */
  title: string;
  /** Откуда взят план — файл или приказ кафедры */
  sourceDoc?: string;
  lessons: Lesson[];
  lectures: Lecture[];
  /** План пришёл из файла в проекте и ещё не менялся в админке */
  builtIn?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProgramSummary {
  id: string;
  facultyId: FacultyId;
  course: number;
  subjectId: string;
  subjectLabel: string;
  title: string;
  sourceDoc?: string;
  lessonCount: number;
  controlCount: number;
  lectureCount: number;
  builtIn: boolean;
  updatedAt: string;
}

const LESSON_KINDS = new Set<LessonKind>(['lesson', 'control', 'colloquium']);

function normalizeStringList(raw: unknown, limit = 40): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, limit);
  return out.length ? out : undefined;
}

function normalizeCovers(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = [...new Set(
    raw.map(v => Number(v)).filter(n => Number.isInteger(n) && n > 0),
  )].sort((a, b) => a - b);
  return out.length ? out : undefined;
}

export function normalizeLesson(raw: unknown, fallbackOrder: number): Lesson | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = String(r.title ?? '').trim();
  if (!title) return null;

  const kind = LESSON_KINDS.has(r.kind as LessonKind) ? (r.kind as LessonKind) : 'lesson';
  const order = Number.isInteger(Number(r.order)) && Number(r.order) > 0
    ? Number(r.order)
    : fallbackOrder;
  const hours = Number(r.hours);
  const planNumber = Number(r.planNumber);
  const semester = Number(r.semester);

  return {
    id: String(r.id ?? '').trim() || `l${order}`,
    order,
    planNumber: Number.isInteger(planNumber) && planNumber > 0 ? planNumber : undefined,
    semester: Number.isInteger(semester) && semester > 0 ? semester : undefined,
    kind,
    title,
    summary: r.summary ? String(r.summary).trim() : undefined,
    objectives: normalizeStringList(r.objectives),
    terms: normalizeStringList(r.terms, 80),
    covers: kind === 'lesson' ? undefined : normalizeCovers(r.covers),
    hours: Number.isFinite(hours) && hours > 0 ? hours : undefined,
    note: r.note ? String(r.note).trim() : undefined,
  };
}

/** Пересчёт номеров по фактическому порядку в массиве. */
export function renumberLessons(lessons: Lesson[]): Lesson[] {
  return lessons.map((l, i) => ({ ...l, order: i + 1 }));
}

export function normalizeLessons(raw: unknown): Lesson[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw
    .map((item, i) => normalizeLesson(item, i + 1))
    .filter((l): l is Lesson => l !== null)
    .sort((a, b) => a.order - b.order);

  const seenIds = new Set<string>();
  return renumberLessons(parsed).map(l => {
    let id = l.id;
    while (seenIds.has(id)) id = `${id}_`;
    seenIds.add(id);
    return { ...l, id };
  });
}

function normalizeLecture(raw: unknown, fallbackOrder: number): Lecture | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = String(r.title ?? '').trim();
  if (!title) return null;

  const order = Number.isInteger(Number(r.order)) && Number(r.order) > 0
    ? Number(r.order)
    : fallbackOrder;
  const planNumber = Number(r.planNumber);
  const semester = Number(r.semester);
  const hours = Number(r.hours);

  return {
    id: String(r.id ?? '').trim() || `lec${order}`,
    order,
    planNumber: Number.isInteger(planNumber) && planNumber > 0 ? planNumber : undefined,
    semester: Number.isInteger(semester) && semester > 0 ? semester : undefined,
    title,
    summary: r.summary ? String(r.summary).trim() : undefined,
    hours: Number.isFinite(hours) && hours > 0 ? hours : undefined,
  };
}

export function normalizeLectures(raw: unknown): Lecture[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i) => normalizeLecture(item, i + 1))
    .filter((l): l is Lecture => l !== null)
    .sort((a, b) => a.order - b.order)
    .map((l, i) => ({ ...l, order: i + 1 }));
}

export function normalizeProgram(raw: unknown): Program | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const facultyId = String(r.facultyId ?? '').trim() as FacultyId;
  const subjectId = String(r.subjectId ?? '').trim();
  const course = Number(r.course);
  if (!facultyId || !subjectId || !Number.isInteger(course) || course < 1) return null;

  const now = new Date().toISOString();
  return {
    id: String(r.id ?? '').trim() || buildProgramId(facultyId, course, subjectId),
    facultyId,
    course,
    subjectId,
    title: String(r.title ?? '').trim() || defaultProgramTitle(facultyId, course, subjectId),
    sourceDoc: r.sourceDoc ? String(r.sourceDoc).trim() : undefined,
    lessons: normalizeLessons(r.lessons),
    lectures: normalizeLectures(r.lectures),
    builtIn: r.builtIn === true,
    createdAt: r.createdAt ? String(r.createdAt) : now,
    updatedAt: r.updatedAt ? String(r.updatedAt) : now,
  };
}

const FACULTY_TITLE: Record<string, string> = {
  stomatology: 'стоматология',
  therapeutic: 'лечебное дело',
  pediatrics:  'педиатрия',
};

export function defaultProgramTitle(
  facultyId: FacultyId,
  course: number,
  subjectId: string,
): string {
  const subject = getSubject(subjectId)?.label ?? subjectId;
  const faculty = FACULTY_TITLE[facultyId] ?? facultyId;
  return `${subject}, ${course} курс, ${faculty}`;
}

export function summarizeProgram(program: Program): ProgramSummary {
  return {
    id: program.id,
    facultyId: program.facultyId,
    course: program.course,
    subjectId: program.subjectId,
    subjectLabel: getSubject(program.subjectId)?.label ?? program.subjectId,
    title: program.title,
    sourceDoc: program.sourceDoc,
    lessonCount: program.lessons.filter(l => l.kind === 'lesson').length,
    controlCount: program.lessons.filter(l => l.kind !== 'lesson').length,
    lectureCount: program.lectures.length,
    builtIn: program.builtIn === true,
    updatedAt: program.updatedAt,
  };
}

// ─── Хранение ──────────────────────────────────────────────────────────────

export async function listProgramIds(redis: AppRedis): Promise<string[]> {
  const raw = await redis.get(CURRICULUM_INDEX_KEY);
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(v => String(v)).filter(Boolean))];
}

async function loadSuppressedIds(redis: AppRedis): Promise<Set<string>> {
  const raw = await redis.get(CURRICULUM_SUPPRESSED_KEY);
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map(v => String(v)).filter(Boolean));
}

/** Планы из файлов проекта, помеченные builtIn. */
function seedPrograms(): Program[] {
  const out: Program[] = [];
  for (const raw of listSeedPrograms()) {
    const program = normalizeProgram(raw);
    if (program) out.push({ ...program, builtIn: true });
  }
  return out;
}

function seedProgramById(programId: string): Program | null {
  return seedPrograms().find(p => p.id === programId) ?? null;
}

export async function loadProgram(redis: AppRedis, programId: string): Promise<Program | null> {
  const suppressed = await loadSuppressedIds(redis);
  if (suppressed.has(programId)) return null;

  const stored = normalizeProgram(await redis.get(programKey(programId)));
  if (stored) return { ...stored, builtIn: false };
  return seedProgramById(programId);
}

export async function loadAllPrograms(redis: AppRedis): Promise<Program[]> {
  const [ids, suppressed] = await Promise.all([
    listProgramIds(redis),
    loadSuppressedIds(redis),
  ]);

  const byId = new Map<string, Program>();
  for (const program of seedPrograms()) {
    byId.set(program.id, program);
  }
  for (const id of ids) {
    const stored = normalizeProgram(await redis.get(programKey(id)));
    if (stored) byId.set(id, { ...stored, builtIn: false });
  }

  return [...byId.values()]
    .filter(p => !suppressed.has(p.id))
    .sort((a, b) => {
      if (a.course !== b.course) return a.course - b.course;
      return a.title.localeCompare(b.title, 'ru');
    });
}

export async function saveProgram(redis: AppRedis, program: Program): Promise<Program> {
  const next: Program = {
    ...program,
    lessons: renumberLessons(program.lessons),
    builtIn: false,
    updatedAt: new Date().toISOString(),
  };
  await redis.set(programKey(next.id), next);

  const ids = await listProgramIds(redis);
  if (!ids.includes(next.id)) {
    await redis.set(CURRICULUM_INDEX_KEY, [...ids, next.id]);
  }

  const suppressed = await loadSuppressedIds(redis);
  if (suppressed.delete(next.id)) {
    await redis.set(CURRICULUM_SUPPRESSED_KEY, [...suppressed]);
  }
  return next;
}

export async function deleteProgram(redis: AppRedis, programId: string): Promise<void> {
  await redis.del(programKey(programId));
  const ids = await listProgramIds(redis);
  await redis.set(CURRICULUM_INDEX_KEY, ids.filter(id => id !== programId));

  // План из файла проекта иначе вернулся бы после удаления.
  if (seedProgramById(programId)) {
    const suppressed = await loadSuppressedIds(redis);
    suppressed.add(programId);
    await redis.set(CURRICULUM_SUPPRESSED_KEY, [...suppressed]);
  }

  const assignments = await loadGroupPrograms(redis);
  let changed = false;
  const next: Record<string, string[]> = {};
  for (const [group, programIds] of Object.entries(assignments)) {
    const kept = programIds.filter(id => id !== programId);
    if (kept.length !== programIds.length) changed = true;
    if (kept.length) next[group] = kept;
  }
  if (changed) await saveGroupPrograms(redis, next);
}

// ─── Привязка программ к группам ───────────────────────────────────────────

export type GroupProgramMap = Record<string, string[]>;

export async function loadGroupPrograms(redis: AppRedis): Promise<GroupProgramMap> {
  const raw = await redis.get(GROUP_PROGRAMS_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: GroupProgramMap = {};
  for (const [group, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeStudyGroup(group);
    if (!key || !Array.isArray(value)) continue;
    const ids = [...new Set(value.map(v => String(v)).filter(Boolean))];
    if (ids.length) out[key] = ids;
  }
  return out;
}

export async function saveGroupPrograms(redis: AppRedis, map: GroupProgramMap): Promise<void> {
  await redis.set(GROUP_PROGRAMS_KEY, map);
}

export function setGroupProgram(
  map: GroupProgramMap,
  studyGroupRaw: string,
  programId: string,
  enabled: boolean,
): GroupProgramMap {
  const studyGroup = normalizeStudyGroup(studyGroupRaw);
  if (!studyGroup || !programId) return map;

  const current = map[studyGroup] ?? [];
  const next = enabled
    ? [...new Set([...current, programId])]
    : current.filter(id => id !== programId);

  const out = { ...map };
  if (next.length) out[studyGroup] = next;
  else delete out[studyGroup];
  return out;
}

/** Программы одной группы. */
export function programsForGroup(
  map: GroupProgramMap,
  studyGroupRaw: string,
  programs: Program[],
): Program[] {
  const ids = new Set(map[normalizeStudyGroup(studyGroupRaw)] ?? []);
  return programs.filter(p => ids.has(p.id));
}

/** Сколько групп используют программу — для админки. */
export function countGroupsPerProgram(map: GroupProgramMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ids of Object.values(map)) {
    for (const id of ids) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}
