// ═══════════════════════════════════════════════════════════════════════════
// /api/admin-schedule — управление учебными планами и расписаниями групп
// ═══════════════════════════════════════════════════════════════════════════
//
// Действия:
//   overview        — сводка: какие группы заполнены, где планы курсов
//   get_group       — расписание одной группы
//   save_group      — сохранить расписание группы
//   delete_group    — удалить расписание группы
//   copy_group      — скопировать расписание в другие группы (масштаб на весь курс)
//   get_curriculum  — учебный план факультета и курса
//   save_curriculum — сохранить учебный план
// ═══════════════════════════════════════════════════════════════════════════

import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { isRedisUnavailableError } from '@/lib/redisDegraded';
import { verifyInitDataUser } from '@/lib/verifyInitData';
import { SUBJECTS } from '@/lib/subjects';
import { FACULTY_SHORT_LABEL } from '@/lib/facultyCodes';
import { normalizeStudyGroup, buildStudyGroupFromDigits } from '@/lib/studyGroup';
import {
  buildFacultyGroupTree,
  listOfficialGroupsByCourse,
  parseCourseFromGroupDigits,
  type FacultyId,
} from '@/lib/groupRegistry';
import {
  createEmptyGroupSchedule,
  normalizeGroupSchedule,
  weeklyLessonCount,
  type GroupSchedule,
} from '@/lib/schedule';
import {
  createEmptyCurriculumPlan,
  normalizeCurriculumPlan,
  summarizeSemester,
} from '@/lib/curriculum';
import {
  deleteGroupSchedule,
  listScheduledGroups,
  loadCurriculumPlan,
  loadGroupSchedule,
  saveCurriculumPlan,
  saveGroupSchedule,
} from '@/lib/scheduleStore';

const redis = createRedisFromEnv();
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '978243325';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

const VALID_FACULTIES = new Set<FacultyId>(['stomatology', 'therapeutic', 'pediatrics']);
const MAX_COPY_TARGETS = 60;

function verifyAdmin(initData: string, secret: string): boolean {
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return false;
  if (!BOT_TOKEN) return false;
  const tgUser = verifyInitDataUser(initData, BOT_TOKEN);
  if (!tgUser || String(tgUser.id) !== ADMIN_TG_ID) return false;
  return true;
}

function readFaculty(value: unknown): FacultyId | null {
  const id = String(value || '').trim() as FacultyId;
  return VALID_FACULTIES.has(id) ? id : null;
}

function readCourse(value: unknown, fallback = 1): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 6 ? Math.round(n) : fallback;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const { initData, secret, action } = body;
  if (!initData || !secret || !verifyAdmin(String(initData), String(secret))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    switch (String(action)) {
      case 'overview':        return await handleOverview(res);
      case 'get_group':       return await handleGetGroup(res, body);
      case 'save_group':      return await handleSaveGroup(res, body);
      case 'delete_group':    return await handleDeleteGroup(res, body);
      case 'copy_group':      return await handleCopyGroup(res, body);
      case 'get_curriculum':  return await handleGetCurriculum(res, body);
      case 'save_curriculum': return await handleSaveCurriculum(res, body);
      default:                return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    console.error('[admin-schedule]', e);
    if (isRedisUnavailableError(e)) {
      return res.status(503).json({ error: 'Redis недоступен', degraded: true });
    }
    return res.status(500).json({ error: 'Server error' });
  }
}

async function handleOverview(res: NextApiResponse) {
  const groups = await listScheduledGroups(redis);

  const filled = await Promise.all(groups.map(async ({ facultyId, studyGroup }) => {
    const schedule = await loadGroupSchedule(redis, facultyId, studyGroup);
    if (!schedule) return null;
    return {
      facultyId,
      studyGroup,
      course: schedule.course,
      academicYear: schedule.academicYear,
      lessonCount: schedule.lessons.length,
      weeklyPairs: weeklyLessonCount(schedule),
      overrideCount: schedule.overrides.length,
      updatedAt: schedule.updatedAt,
    };
  }));

  const plans: {
    facultyId: FacultyId;
    course: number;
    academicYear: string;
    disciplines: number;
    updatedAt: string;
  }[] = [];

  for (const faculty of buildFacultyGroupTree()) {
    for (const { course } of faculty.courses) {
      const plan = await loadCurriculumPlan(redis, faculty.facultyId, course);
      if (!plan) continue;
      plans.push({
        facultyId: faculty.facultyId,
        course,
        academicYear: plan.academicYear,
        disciplines: plan.semesters.reduce((sum, s) => sum + s.disciplines.length, 0),
        updatedAt: plan.updatedAt,
      });
    }
  }

  return res.status(200).json({
    ok: true,
    groups: filled.filter(Boolean),
    plans,
    faculties: buildFacultyGroupTree().map(f => ({
      facultyId: f.facultyId,
      label: FACULTY_SHORT_LABEL[f.facultyId] ?? f.label,
      maxCourse: f.maxCourse,
      courses: f.courses.map(c => ({
        course: c.course,
        groups: c.groups.map(g => g.studyGroup),
      })),
    })),
    subjects: SUBJECTS.map(s => ({ id: s.id, label: s.label, color: s.color })),
  });
}

async function handleGetGroup(res: NextApiResponse, body: Record<string, unknown>) {
  const facultyId = readFaculty(body.facultyId);
  const studyGroup = normalizeStudyGroup(String(body.studyGroup || ''));
  if (!facultyId || !studyGroup) {
    return res.status(400).json({ error: 'Укажи факультет и группу.' });
  }

  const course = parseCourseFromGroupDigits(studyGroup) ?? 1;
  const schedule = await loadGroupSchedule(redis, facultyId, studyGroup)
    ?? createEmptyGroupSchedule(facultyId, studyGroup, course);

  return res.status(200).json({ ok: true, schedule, exists: schedule.lessons.length > 0 });
}

async function handleSaveGroup(res: NextApiResponse, body: Record<string, unknown>) {
  const facultyId = readFaculty(body.facultyId);
  const studyGroup = normalizeStudyGroup(String(body.studyGroup || ''));
  if (!facultyId || !studyGroup) {
    return res.status(400).json({ error: 'Укажи факультет и группу.' });
  }

  const course = parseCourseFromGroupDigits(studyGroup)
    ?? readCourse(body.course);
  const previous = await loadGroupSchedule(redis, facultyId, studyGroup);

  const schedule = normalizeGroupSchedule({
    facultyId,
    studyGroup,
    course,
    raw: body.schedule,
    updatedBy: ADMIN_TG_ID,
    previous,
  });

  await saveGroupSchedule(redis, schedule);
  return res.status(200).json({ ok: true, schedule });
}

async function handleDeleteGroup(res: NextApiResponse, body: Record<string, unknown>) {
  const facultyId = readFaculty(body.facultyId);
  const studyGroup = normalizeStudyGroup(String(body.studyGroup || ''));
  if (!facultyId || !studyGroup) {
    return res.status(400).json({ error: 'Укажи факультет и группу.' });
  }
  await deleteGroupSchedule(redis, facultyId, studyGroup);
  return res.status(200).json({ ok: true });
}

/** Одно расписание → много групп: заполнение курса за один шаг. */
async function handleCopyGroup(res: NextApiResponse, body: Record<string, unknown>) {
  const facultyId = readFaculty(body.facultyId);
  const source = normalizeStudyGroup(String(body.studyGroup || ''));
  if (!facultyId || !source) {
    return res.status(400).json({ error: 'Укажи факультет и группу-источник.' });
  }

  const schedule = await loadGroupSchedule(redis, facultyId, source);
  if (!schedule) {
    return res.status(404).json({ error: 'У группы-источника нет расписания.' });
  }

  const targets = resolveCopyTargets(body, facultyId).filter(g => g !== source);
  if (!targets.length) {
    return res.status(400).json({ error: 'Не выбраны группы для копирования.' });
  }

  let copied = 0;
  for (const target of targets.slice(0, MAX_COPY_TARGETS)) {
    const course = parseCourseFromGroupDigits(target) ?? schedule.course;
    const clone: GroupSchedule = {
      ...schedule,
      studyGroup: target,
      course,
      // Разовые правки — свойство конкретной группы, их не тиражируем.
      overrides: [],
      updatedAt: new Date().toISOString(),
      updatedBy: ADMIN_TG_ID,
    };
    await saveGroupSchedule(redis, clone);
    copied++;
  }

  return res.status(200).json({ ok: true, copied });
}

function resolveCopyTargets(body: Record<string, unknown>, facultyId: FacultyId): string[] {
  const explicit = body.targets;
  if (Array.isArray(explicit) && explicit.length) {
    const seen = new Set<string>();
    for (const raw of explicit) {
      const group = normalizeStudyGroup(String(raw));
      if (group) seen.add(group);
    }
    return [...seen];
  }

  const course = Number(body.targetCourse);
  if (Number.isFinite(course)) {
    return listOfficialGroupsByCourse(facultyId, course).map(g => g.studyGroup);
  }

  const from = Number(body.fromDigits);
  const to = Number(body.toDigits);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];

  const out: string[] = [];
  for (let n = from; n <= to && out.length < MAX_COPY_TARGETS; n++) {
    const built = buildStudyGroupFromDigits(String(n), facultyId);
    if (built) out.push(normalizeStudyGroup(built));
  }
  return out;
}

async function handleGetCurriculum(res: NextApiResponse, body: Record<string, unknown>) {
  const facultyId = readFaculty(body.facultyId);
  if (!facultyId) return res.status(400).json({ error: 'Укажи факультет.' });

  const course = readCourse(body.course);
  const plan = await loadCurriculumPlan(redis, facultyId, course)
    ?? createEmptyCurriculumPlan(facultyId, course);

  return res.status(200).json({
    ok: true,
    plan,
    summaries: plan.semesters.map(s => ({
      semester: s.semester,
      ...summarizeSemester(s),
    })),
  });
}

async function handleSaveCurriculum(res: NextApiResponse, body: Record<string, unknown>) {
  const facultyId = readFaculty(body.facultyId);
  if (!facultyId) return res.status(400).json({ error: 'Укажи факультет.' });

  const course = readCourse(body.course);
  const plan = normalizeCurriculumPlan(facultyId, course, body.plan, ADMIN_TG_ID);
  await saveCurriculumPlan(redis, plan);

  return res.status(200).json({ ok: true, plan });
}
