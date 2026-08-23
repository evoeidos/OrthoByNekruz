// ═══════════════════════════════════════════════════════════════════════════
// src/lib/scheduleStore.ts
// ═══════════════════════════════════════════════════════════════════════════
//
// Ключи Redis для раздела «Занятия»:
//   curriculum:{facultyId}:{course}      — учебный план курса
//   schedule:{facultyId}:{studyGroup}    — расписание группы
//   schedule_groups                      — индекс заполненных групп (для админки)
//   schedule_personal:{tgId}             — личный слой студента
// ═══════════════════════════════════════════════════════════════════════════

import type { AppRedis } from '@/lib/redis';
import type { FacultyId } from '@/lib/groupRegistry';
import { normalizeStudyGroup } from '@/lib/studyGroup';
import {
  emptyPersonalSchedule,
  normalizePersonalSchedule,
  type GroupSchedule,
  type PersonalSchedule,
} from '@/lib/schedule';
import { normalizeCurriculumPlan, type CurriculumPlan } from '@/lib/curriculum';

export const SCHEDULE_GROUPS_INDEX_KEY = 'schedule_groups';

export function curriculumKey(facultyId: string, course: number): string {
  return `curriculum:${facultyId}:${course}`;
}

export function groupScheduleKey(facultyId: string, studyGroup: string): string {
  return `schedule:${facultyId}:${normalizeStudyGroup(studyGroup)}`;
}

export function personalScheduleKey(tgId: string): string {
  return `schedule_personal:${tgId}`;
}

/** Значение в индексе групп: `stomatology:208с`. */
export function groupIndexMember(facultyId: string, studyGroup: string): string {
  return `${facultyId}:${normalizeStudyGroup(studyGroup)}`;
}

export function parseGroupIndexMember(
  member: string,
): { facultyId: FacultyId; studyGroup: string } | null {
  const idx = member.indexOf(':');
  if (idx <= 0) return null;
  const facultyId = member.slice(0, idx) as FacultyId;
  const studyGroup = normalizeStudyGroup(member.slice(idx + 1));
  if (!facultyId || !studyGroup) return null;
  return { facultyId, studyGroup };
}

// ─── Учебный план ──────────────────────────────────────────────────────────

export async function loadCurriculumPlan(
  redis: AppRedis,
  facultyId: string,
  course: number,
): Promise<CurriculumPlan | null> {
  const raw = await redis.get(curriculumKey(facultyId, course));
  if (!raw || typeof raw !== 'object') return null;
  const plan = normalizeCurriculumPlan(facultyId as FacultyId, course, raw);
  // Нормализация проставляет свежий updatedAt — возвращаем исходную метку.
  const savedAt = (raw as Record<string, unknown>).updatedAt;
  if (typeof savedAt === 'string') plan.updatedAt = savedAt;
  return plan;
}

export async function saveCurriculumPlan(
  redis: AppRedis,
  plan: CurriculumPlan,
): Promise<void> {
  await redis.set(curriculumKey(plan.facultyId, plan.course), plan);
}

export async function deleteCurriculumPlan(
  redis: AppRedis,
  facultyId: string,
  course: number,
): Promise<void> {
  await redis.del(curriculumKey(facultyId, course));
}

// ─── Расписание группы ─────────────────────────────────────────────────────

export async function loadGroupSchedule(
  redis: AppRedis,
  facultyId: string,
  studyGroup: string,
): Promise<GroupSchedule | null> {
  const raw = await redis.get<GroupSchedule>(groupScheduleKey(facultyId, studyGroup));
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lessons)) return null;
  return raw;
}

export async function saveGroupSchedule(
  redis: AppRedis,
  schedule: GroupSchedule,
): Promise<void> {
  await redis.set(groupScheduleKey(schedule.facultyId, schedule.studyGroup), schedule);
  await redis.sadd(
    SCHEDULE_GROUPS_INDEX_KEY,
    groupIndexMember(schedule.facultyId, schedule.studyGroup),
  );
}

export async function deleteGroupSchedule(
  redis: AppRedis,
  facultyId: string,
  studyGroup: string,
): Promise<void> {
  await redis.del(groupScheduleKey(facultyId, studyGroup));
  await redis.srem(SCHEDULE_GROUPS_INDEX_KEY, groupIndexMember(facultyId, studyGroup));
}

export async function listScheduledGroups(
  redis: AppRedis,
): Promise<{ facultyId: FacultyId; studyGroup: string }[]> {
  const members = await redis.smembers(SCHEDULE_GROUPS_INDEX_KEY);
  if (!Array.isArray(members)) return [];
  return members
    .map(m => parseGroupIndexMember(String(m)))
    .filter((v): v is { facultyId: FacultyId; studyGroup: string } => v !== null)
    .sort((a, b) => a.facultyId.localeCompare(b.facultyId)
      || a.studyGroup.localeCompare(b.studyGroup, 'ru', { numeric: true }));
}

// ─── Личный слой студента ──────────────────────────────────────────────────

export async function loadPersonalSchedule(
  redis: AppRedis,
  tgId: string,
): Promise<PersonalSchedule> {
  const raw = await redis.get(personalScheduleKey(tgId));
  if (!raw) return emptyPersonalSchedule();
  return normalizePersonalSchedule(raw);
}

export async function savePersonalSchedule(
  redis: AppRedis,
  tgId: string,
  personal: PersonalSchedule,
): Promise<void> {
  await redis.set(personalScheduleKey(tgId), {
    ...personal,
    updatedAt: new Date().toISOString(),
  });
}
