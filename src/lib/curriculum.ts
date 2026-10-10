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
import type { LessonKind } from '@/lib/curriculumLabels';

export { LESSON_KIND_LABELS, type LessonKind } from '@/lib/curriculumLabels';

/**
 * Подтема занятия — один пункт из перечня, который кафедра даёт под темой.
 * Каждая раскрывается отдельно, поэтому текст пишется самодостаточным: разбор
 * подтемы и латинские названия структур, которые в ней разбирают.
 */
export interface LessonSection {
  id: string;
  title: string;
  text: string;
  terms?: string[];
  /** Схемы и препараты подтемы — зум как в режиме чтения вопросов */
  images?: string[];
  /** Интерактивный атлас: клик по латыни показывает точку на снимке */
  atlas?: string;
}

/** Блок аннотации методички: абзац, пункт списка или таблица. */
export type AnnotationBlock =
  | { type: 'p' | 'li'; text: string }
  | { type: 'table'; rows: string[][] };

/** Тестовое задание из методички. Правильные ответы на сайте не отмечены. */
export interface LessonTest {
  question: string;
  options: string[];
}

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
  /** Подтемы из плана кафедры с разбором каждой */
  sections?: LessonSection[];
  /** Термины занятия — если подтем нет; иначе термины лежат в подтемах */
  terms?: string[];
  /** Аннотация методички кафедры: что разбирают на занятии */
  annotation?: AnnotationBlock[];
  /** Ссылки на изображения к аннотации */
  images?: string[];
  /** Вопросы по теме занятия из методички */
  questions?: string[];
  /** Тестовые задания из методички — для самопроверки */
  tests?: LessonTest[];
  /** Только в ответе API: у занятия есть аннотация/вопросы/тесты, текст грузится отдельно */
  hasContent?: boolean;
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

function normalizeAnnotation(raw: unknown): AnnotationBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AnnotationBlock[] = [];
  for (const item of raw.slice(0, 400)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (r.type === 'table') {
      const rows = Array.isArray(r.rows)
        ? r.rows
          .filter(Array.isArray)
          .map(row => (row as unknown[]).map(c => String(c ?? '').trim()))
          .filter(row => row.some(Boolean))
        : [];
      if (rows.length) out.push({ type: 'table', rows });
      continue;
    }
    const text = String(r.text ?? '').trim();
    if (text) out.push({ type: r.type === 'li' ? 'li' : 'p', text });
  }
  return out.length ? out : undefined;
}

function normalizeTests(raw: unknown): LessonTest[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LessonTest[] = [];
  for (const item of raw.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const question = String(r.question ?? '').trim();
    const options = normalizeStringList(r.options, 12) ?? [];
    if (question && options.length >= 2) out.push({ question, options });
  }
  return out.length ? out : undefined;
}

function normalizeSections(raw: unknown): LessonSection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LessonSection[] = [];
  raw.slice(0, 32).forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const r = item as Record<string, unknown>;
    const title = String(r.title ?? '').trim();
    const text = String(r.text ?? '').trim();
    if (!title || !text) return;
    const images = normalizeStringList(
      typeof r.images === 'string' || typeof r.image === 'string'
        ? [r.images ?? r.image]
        : r.images ?? r.image,
      12,
    );
    const atlas = String(r.atlas ?? '').trim();
    out.push({
      id: String(r.id ?? '').trim() || `s${i + 1}`,
      title,
      text,
      terms: normalizeStringList(r.terms, 40),
      images,
      atlas: atlas || undefined,
    });
  });
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
    sections: normalizeSections(r.sections),
    annotation: normalizeAnnotation(r.annotation),
    images: normalizeStringList(r.images, 24),
    questions: normalizeStringList(r.questions, 200),
    tests: normalizeTests(r.tests),
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

let seedProgramsCache: Program[] | null = null;

/** Планы из файлов проекта, помеченные builtIn. Файлы не меняются между деплоями — считаем один раз. */
function seedPrograms(): Program[] {
  if (seedProgramsCache) return seedProgramsCache;
  const out: Program[] = [];
  for (const raw of listSeedPrograms()) {
    const program = normalizeProgram(raw);
    if (program) out.push({ ...program, builtIn: true });
  }
  seedProgramsCache = out;
  return out;
}

function seedProgramById(programId: string): Program | null {
  return seedPrograms().find(p => p.id === programId) ?? null;
}

function mergeSectionImages(stored: LessonSection, seed?: LessonSection): LessonSection {
  if (!seed) return stored;
  return {
    ...stored,
    images: stored.images?.length ? stored.images : seed.images,
    atlas: stored.atlas || seed.atlas,
  };
}

function mergeLessonFromSeed(stored: Lesson, seed?: Lesson): Lesson {
  if (!seed) return stored;
  const seedSections = new Map((seed.sections ?? []).map(s => [s.id, s]));
  const sections = stored.sections?.length
    ? stored.sections.map(s => mergeSectionImages(s, seedSections.get(s.id)))
    : seed.sections;
  return {
    ...stored,
    sections,
    annotation: stored.annotation ?? seed.annotation,
    images: stored.images ?? seed.images,
    questions: stored.questions ?? seed.questions,
    tests: stored.tests ?? seed.tests,
  };
}

/**
 * Копия в Redis перекрывает файлы проекта. Недостающие занятия и новые
 * картинки из seed добираем, чтобы тема 1 со схемами не вытесняла остальные.
 */
function hydrateFromSeed(stored: Program): Program {
  const seed = seedProgramById(stored.id);
  if (!seed) return stored;

  const seedById = new Map(seed.lessons.map(l => [l.id, l]));
  const storedIds = new Set(stored.lessons.map(l => l.id));
  const merged = [
    ...stored.lessons.map(l => mergeLessonFromSeed(l, seedById.get(l.id))),
    ...seed.lessons.filter(l => !storedIds.has(l.id)),
  ].sort((a, b) => {
    const an = a.planNumber ?? a.order;
    const bn = b.planNumber ?? b.order;
    return an - bn;
  });

  return {
    ...stored,
    lessons: merged.length > 0 ? merged : seed.lessons,
    lectures: stored.lectures.length > 0 ? stored.lectures : seed.lectures,
  };
}

export async function loadProgram(redis: AppRedis, programId: string): Promise<Program | null> {
  const suppressed = await loadSuppressedIds(redis);
  if (suppressed.has(programId)) return null;

  const stored = normalizeProgram(await redis.get(programKey(programId)));
  if (stored) return { ...hydrateFromSeed(stored), builtIn: false };
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
    if (stored) byId.set(id, { ...hydrateFromSeed(stored), builtIn: false });
  }

  return [...byId.values()]
    .filter(p => !suppressed.has(p.id) || seedProgramById(p.id) != null)
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
