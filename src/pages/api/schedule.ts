// ═══════════════════════════════════════════════════════════════════════════
// /api/schedule — раздел «Занятия» для студента
// ═══════════════════════════════════════════════════════════════════════════
//
// Доступ к расписанию и учебному плану НЕ требует купленных предметов:
// это бесплатная точка входа для всего университета. Проверяем только личность
// (Telegram initData или веб-сессия) и что пользователь не заблокирован.
// ═══════════════════════════════════════════════════════════════════════════

import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { isRedisUnavailableError } from '@/lib/redisDegraded';
import { resolveRequestIdentity } from '@/lib/resolveIdentity';
import { normalizeStudyGroup, buildStudyGroupFromDigits } from '@/lib/studyGroup';
import {
  parseCourseFromGroupDigits,
  type FacultyId,
} from '@/lib/groupRegistry';
import { FACULTY_SHORT_LABEL } from '@/lib/facultyCodes';
import { SUBJECTS, getSubject } from '@/lib/subjects';
import { registerUserId } from '@/lib/userIndex';
import {
  addDays,
  isValidDateKey,
  krskDateKey,
  mondayOf,
  normalizePersonalLesson,
  parityOf,
  resolveRange,
  weekDates,
  DEFAULT_PAIR_TIMES,
  type GroupSchedule,
  type PersonalSchedule,
} from '@/lib/schedule';
import {
  resolveActiveSemester,
  summarizeSemester,
  upcomingControls,
  type CurriculumPlan,
} from '@/lib/curriculum';
import {
  loadCurriculumPlan,
  loadGroupSchedule,
  loadPersonalSchedule,
  savePersonalSchedule,
} from '@/lib/scheduleStore';

const redis = createRedisFromEnv();

const VALID_FACULTIES = new Set<FacultyId>(['stomatology', 'therapeutic', 'pediatrics']);
const MAX_RANGE_DAYS = 28;
const MAX_NOTE_LENGTH = 400;
const MAX_EXTRAS = 60;

type UserRecord = Record<string, unknown>;

async function loadUser(tgId: string): Promise<UserRecord | null> {
  const raw = await redis.get<UserRecord>(`user_id:${tgId}`);
  return raw && typeof raw === 'object' ? raw : null;
}

function subjectMeta(subjectIds: string[]) {
  return subjectIds
    .map(id => getSubject(id))
    .filter((s): s is NonNullable<ReturnType<typeof getSubject>> => !!s)
    .map(s => ({ id: s.id, label: s.label, color: s.color, badge: s.badge }));
}

/** Факультет и группа, которые смотрит студент: свои либо явно запрошенные. */
function resolveViewTarget(
  user: UserRecord | null,
  body: Record<string, unknown>,
): { facultyId: FacultyId | null; studyGroup: string; isOwnGroup: boolean } {
  const ownFaculty = String(user?.facultyId || '').trim() as FacultyId;
  const ownGroup = normalizeStudyGroup(String(user?.studyGroup || ''));

  const askedFaculty = String(body.viewFacultyId || '').trim() as FacultyId;
  const askedGroup = normalizeStudyGroup(String(body.viewStudyGroup || ''));

  if (askedFaculty && askedGroup && VALID_FACULTIES.has(askedFaculty)) {
    return {
      facultyId: askedFaculty,
      studyGroup: askedGroup,
      isOwnGroup: askedFaculty === ownFaculty && askedGroup === ownGroup,
    };
  }

  return {
    facultyId: VALID_FACULTIES.has(ownFaculty) ? ownFaculty : null,
    studyGroup: ownGroup,
    isOwnGroup: true,
  };
}

function buildGroupPayload(schedule: GroupSchedule | null, todayKey: string) {
  if (!schedule) return null;
  return {
    academicYear: schedule.academicYear,
    weekAnchorMonday: schedule.weekAnchorMonday,
    pairTimes: schedule.pairTimes ?? DEFAULT_PAIR_TIMES,
    note: schedule.note ?? null,
    updatedAt: schedule.updatedAt,
    currentParity: parityOf(todayKey, schedule.weekAnchorMonday),
    lessonCount: schedule.lessons.length,
  };
}

function buildPlanPayload(plan: CurriculumPlan | null, todayKey: string) {
  if (!plan) return null;
  const active = resolveActiveSemester(plan, todayKey);
  return {
    academicYear: plan.academicYear,
    note: plan.note ?? null,
    updatedAt: plan.updatedAt,
    activeSemester: active?.semester ?? null,
    semesters: plan.semesters,
    summary: summarizeSemester(active),
    upcoming: upcomingControls(plan, todayKey),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const identity = await resolveRequestIdentity(redis, req, {
      telegramId: body.telegramId,
      initData: body.initData,
      requireTelegram: true,
    });
    if (!identity.ok) {
      return res.status(identity.status).json({ error: identity.error, code: identity.code });
    }

    const tgId = identity.tgId;
    const user = await loadUser(tgId);
    if (user?.blocked === true) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const mode = String(body.mode || 'get');

    if (mode === 'get') return handleGet(res, tgId, user, body);
    if (mode === 'set_study_group') return handleSetStudyGroup(res, tgId, user, body);

    const personal = await loadPersonalSchedule(redis, tgId);
    const updated = applyPersonalMutation(mode, personal, body);
    if (!updated) return res.status(400).json({ error: 'Unknown mode' });
    if ('error' in updated) return res.status(400).json({ error: updated.error });

    await savePersonalSchedule(redis, tgId, updated.personal);
    return res.status(200).json({ ok: true, personal: updated.personal });
  } catch (err) {
    console.error('[schedule] error:', err);
    if (isRedisUnavailableError(err)) {
      return res.status(503).json({ error: 'Сервис временно недоступен', degraded: true });
    }
    return res.status(500).json({ error: 'Server error' });
  }
}

async function handleGet(
  res: NextApiResponse,
  tgId: string,
  user: UserRecord | null,
  body: Record<string, unknown>,
) {
  const todayKey = krskDateKey();
  const target = resolveViewTarget(user, body);

  if (!target.facultyId) {
    return res.status(200).json({
      ok: true,
      needsFaculty: true,
      today: todayKey,
      faculties: [...VALID_FACULTIES].map(id => ({ id, label: FACULTY_SHORT_LABEL[id] ?? id })),
    });
  }

  if (!target.studyGroup) {
    return res.status(200).json({
      ok: true,
      needsStudyGroup: true,
      today: todayKey,
      facultyId: target.facultyId,
      facultyLabel: FACULTY_SHORT_LABEL[target.facultyId] ?? target.facultyId,
    });
  }

  const course = parseCourseFromGroupDigits(target.studyGroup) ?? 1;
  const fromRaw = isValidDateKey(body.from) ? (body.from as string) : todayKey;
  const anchorMonday = mondayOf(fromRaw);
  const rangeDays = Math.min(
    MAX_RANGE_DAYS,
    Math.max(7, Number(body.days) || 7),
  );

  const [schedule, plan, personal] = await Promise.all([
    loadGroupSchedule(redis, target.facultyId, target.studyGroup),
    loadCurriculumPlan(redis, target.facultyId, course),
    loadPersonalSchedule(redis, tgId),
  ]);

  const effectivePersonal: PersonalSchedule = target.isOwnGroup
    ? personal
    : { ...personal, extras: [], hidden: [] };

  const days = resolveRange(
    schedule,
    anchorMonday,
    addDays(anchorMonday, rangeDays - 1),
    {
      subgroup: effectivePersonal.subgroup,
      hidden: effectivePersonal.hidden,
      extras: effectivePersonal.extras,
    },
  );

  const subjectIds = new Set<string>();
  for (const day of days) {
    for (const occ of day.occurrences) {
      if (occ.lesson.subjectId) subjectIds.add(occ.lesson.subjectId);
    }
  }
  for (const semester of plan?.semesters ?? []) {
    for (const discipline of semester.disciplines) {
      if (discipline.subjectId) subjectIds.add(discipline.subjectId);
    }
  }

  return res.status(200).json({
    ok: true,
    today: todayKey,
    weekStart: anchorMonday,
    weekDates: weekDates(anchorMonday, rangeDays),
    facultyId: target.facultyId,
    facultyLabel: FACULTY_SHORT_LABEL[target.facultyId] ?? target.facultyId,
    studyGroup: target.studyGroup,
    course,
    isOwnGroup: target.isOwnGroup,
    hasSchedule: !!schedule,
    group: buildGroupPayload(schedule, todayKey),
    days,
    plan: buildPlanPayload(plan, todayKey),
    personal: target.isOwnGroup ? personal : null,
    subjects: subjectMeta([...subjectIds]),
    allSubjects: SUBJECTS.map(s => ({ id: s.id, label: s.label, color: s.color })),
  });
}

/** Студент без группы задаёт её прямо из «Занятий» — без прохождения оплаты. */
async function handleSetStudyGroup(
  res: NextApiResponse,
  tgId: string,
  user: UserRecord | null,
  body: Record<string, unknown>,
) {
  if (!user) return res.status(404).json({ error: 'Профиль не найден' });

  const facultyId = String(user.facultyId || '').trim();
  if (!VALID_FACULTIES.has(facultyId as FacultyId)) {
    return res.status(400).json({ error: 'Сначала выбери факультет.' });
  }

  const built = buildStudyGroupFromDigits(String(body.studyGroup ?? ''), facultyId);
  if (!built) {
    return res.status(400).json({ error: 'Номер группы — 2–4 цифры, например 208.' });
  }

  const studyGroup = normalizeStudyGroup(built);
  await redis.set(`user_id:${tgId}`, { ...user, studyGroup });
  await registerUserId(redis, tgId);

  return res.status(200).json({ ok: true, studyGroup });
}

type MutationResult =
  | { personal: PersonalSchedule }
  | { error: string }
  | null;

function applyPersonalMutation(
  mode: string,
  personal: PersonalSchedule,
  body: Record<string, unknown>,
): MutationResult {
  const next: PersonalSchedule = {
    ...personal,
    notes: { ...personal.notes },
    done: [...personal.done],
    hidden: [...personal.hidden],
    extras: [...personal.extras],
  };

  if (mode === 'set_subgroup') {
    const value = Number(body.subgroup);
    next.subgroup = value === 1 || value === 2 ? (value as 1 | 2) : null;
    return { personal: next };
  }

  if (mode === 'set_note') {
    const key = String(body.key || '').trim().slice(0, 60);
    if (!key.includes('#')) return { error: 'Некорректное занятие' };
    const note = String(body.note ?? '').trim().slice(0, MAX_NOTE_LENGTH);
    if (note) next.notes[key] = note;
    else delete next.notes[key];
    return { personal: next };
  }

  if (mode === 'toggle_done') {
    const key = String(body.key || '').trim().slice(0, 60);
    if (!key.includes('#')) return { error: 'Некорректное занятие' };
    const shouldBeDone = body.done === undefined ? !next.done.includes(key) : body.done === true;
    next.done = shouldBeDone
      ? [...new Set([...next.done, key])].slice(-2000)
      : next.done.filter(k => k !== key);
    return { personal: next };
  }

  if (mode === 'set_hidden') {
    const key = String(body.key || '').trim().slice(0, 60);
    if (!key) return { error: 'Некорректное занятие' };
    const shouldHide = body.hidden === undefined ? !next.hidden.includes(key) : body.hidden === true;
    next.hidden = shouldHide
      ? [...new Set([...next.hidden, key])].slice(-500)
      : next.hidden.filter(k => k !== key);
    return { personal: next };
  }

  if (mode === 'add_extra') {
    if (next.extras.length >= MAX_EXTRAS) {
      return { error: 'Слишком много своих занятий — удали лишние.' };
    }
    const lesson = normalizePersonalLesson(body.lesson);
    if (!lesson) return { error: 'Укажи название занятия.' };
    next.extras = [...next.extras.filter(e => e.id !== lesson.id), lesson];
    return { personal: next };
  }

  if (mode === 'remove_extra') {
    const id = String(body.id || '').trim().slice(0, 40);
    if (!id) return { error: 'Некорректное занятие' };
    next.extras = next.extras.filter(e => e.id !== id);
    return { personal: next };
  }

  if (mode === 'clear_day_notes') {
    const date = String(body.date || '');
    if (!isValidDateKey(date)) return { error: 'Некорректная дата' };
    for (const key of Object.keys(next.notes)) {
      if (key.startsWith(`${date}#`)) delete next.notes[key];
    }
    next.done = next.done.filter(k => !k.startsWith(`${date}#`));
    return { personal: next };
  }

  return null;
}
