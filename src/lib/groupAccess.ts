/**
 * Бесплатный доступ по факультету + группе (правила в Redis, админка).
 */
import type { AppRedis } from '@/lib/redis';
import { SUBJECTS, getSubject, createDefaultSubjects, migrateUserSubjects, getUserAvailableSubjects } from '@/lib/subjects';
import {
  buildNavHiddenForConfirmedPurchase,
  healExamNavHidden,
} from '@/lib/preview';
import { applyGroupGrantPreviewSideEffects } from '@/lib/previewStateMachine';
import type { PreviewModule } from '@/lib/previewModules';
import { normalizePreviewModules } from '@/lib/previewModules';
import {
  type FacultyId,
  buildFacultyGroupTree,
  getGroupRegistryEntry,
  parseCourseFromGroupDigits,
} from '@/lib/groupRegistry';
import { buildGroupCatalogTree, type GroupCatalogOverlay } from '@/lib/groupCatalog';
import { normalizeStudyGroup } from '@/lib/studyGroup';
import {
  ensureStomatologyBioTasksVisible,
  ensurePedTherBioTasksVisible,
  ensurePedTherChemTasksVisible,
} from '@/lib/subjects';

export const GROUP_ACCESS_RULES_KEY = 'group_access_rules';

export type GroupAccessDurationKind = 'unlimited' | 'hours' | 'days' | 'exam_day';

export type GroupAccessModule = PreviewModule | 'exam' | 'materials';

export interface GroupAccessRule {
  id: string;
  facultyId: FacultyId;
  /** Полный код: 208с */
  studyGroup: string;
  subjectId: string;
  enabled: boolean;
  modules: GroupAccessModule[];
  durationKind: GroupAccessDurationKind;
  /** Часы или дни для hours/days */
  durationValue?: number;
  /** YYYY-MM-DD для exam_day */
  examDate?: string;
  note?: string;
  /** Если true — вкладка «Занятия» скрыта для этой группы/предмета */
  lessonsRestricted?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupGrantRecord {
  ruleId: string;
  grantedAt: string;
  expiresAt: string | null;
  modules: GroupAccessModule[];
}

const ALL_MODULES: GroupAccessModule[] = ['questions', 'tests', 'tasks', 'exam', 'materials'];
const DEFAULT_MODULES: GroupAccessModule[] = ['questions', 'tests', 'tasks'];

export function defaultGroupAccessModules(): GroupAccessModule[] {
  return [...DEFAULT_MODULES];
}

/** Вопросы, тесты, задачи, проверка и материалы — весь контент предмета. */
export function allContentGroupAccessModules(): GroupAccessModule[] {
  return [...ALL_MODULES];
}

export function buildRuleId(
  facultyId: FacultyId,
  studyGroup: string,
  subjectId: string,
): string {
  return `${facultyId}:${normalizeStudyGroup(studyGroup)}:${subjectId}`;
}

export function computeRuleExpiresAt(
  rule: Pick<GroupAccessRule, 'durationKind' | 'durationValue' | 'examDate'>,
  fromMs = Date.now(),
): string | null {
  if (rule.durationKind === 'unlimited') return null;
  const from = new Date(fromMs);
  if (rule.durationKind === 'hours') {
    const h = Math.max(1, Number(rule.durationValue) || 24);
    return new Date(fromMs + h * 60 * 60 * 1000).toISOString();
  }
  if (rule.durationKind === 'days') {
    const d = Math.max(1, Number(rule.durationValue) || 1);
    return new Date(fromMs + d * 24 * 60 * 60 * 1000).toISOString();
  }
  if (rule.durationKind === 'exam_day' && rule.examDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rule.examDate.trim());
    if (!m) return null;
    // Конец дня экзамена по Красноярску (UTC+7) ≈ 16:59 UTC
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 16, 59, 59)).toISOString();
  }
  return null;
}

export function isGrantActive(expiresAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t > nowMs;
}

export function isRuleCurrentlyActive(rule: GroupAccessRule, nowMs = Date.now()): boolean {
  if (!rule.enabled) return false;
  if (!getSubject(rule.subjectId)) return false;
  if (rule.durationKind === 'exam_day') {
    const exp = computeRuleExpiresAt(rule, nowMs);
    return isGrantActive(exp, nowMs);
  }
  return true;
}

export async function loadGroupAccessRules(redis: AppRedis): Promise<GroupAccessRule[]> {
  const raw = await redis.get(GROUP_ACCESS_RULES_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isGroupAccessRule);
}

export async function saveGroupAccessRules(redis: AppRedis, rules: GroupAccessRule[]): Promise<void> {
  await redis.set(GROUP_ACCESS_RULES_KEY, rules);
}

function isGroupAccessRule(v: unknown): v is GroupAccessRule {
  if (!v || typeof v !== 'object') return false;
  const r = v as GroupAccessRule;
  return !!r.id && !!r.facultyId && !!r.studyGroup && !!r.subjectId;
}

export function normalizeModules(input: unknown): GroupAccessModule[] {
  if (!Array.isArray(input)) return defaultGroupAccessModules();
  const allowed = new Set(ALL_MODULES);
  const out = input
    .map(m => String(m))
    .filter((m): m is GroupAccessModule => allowed.has(m as GroupAccessModule));
  return out.length ? out : defaultGroupAccessModules();
}

export function rulesForUser(
  user: any,
  rules: GroupAccessRule[],
  nowMs = Date.now(),
): GroupAccessRule[] {
  const facultyId = String(user?.facultyId || '').trim() as FacultyId;
  const studyGroup = normalizeStudyGroup(String(user?.studyGroup || ''));
  if (!facultyId || !studyGroup) return [];

  return rules.filter(rule => {
    if (rule.facultyId !== facultyId) return false;
    if (normalizeStudyGroup(rule.studyGroup) !== studyGroup) return false;
    if (!rule.enabled) return false;
    if (!getSubject(rule.subjectId)) return false;
    if (rule.durationKind === 'exam_day') {
      const exp = computeRuleExpiresAt(rule, nowMs);
      if (!isGrantActive(exp, nowMs)) return false;
    }
    return true;
  });
}

function userHasFullActivationKey(user: any): boolean {
  return /^\d{8}$/.test(String(user?.activatedKey || '').trim());
}

/** Доступ, который нельзя снимать групповым правилом. */
export function isSubjectProtectedFromGroupRevoke(user: any, subjectId: string): boolean {
  if (user?.paid === true) return true;
  if (userHasFullActivationKey(user)) return true;
  const grants = user?.groupGrants?.[subjectId];
  if (Array.isArray(grants) && grants.length > 0) return false;
  return user?.subjects?.[subjectId] === true;
}

export function getActiveGroupGrantedSubjectIds(user: any, nowMs = Date.now()): string[] {
  if (!user?.groupGrants || typeof user.groupGrants !== 'object') return [];
  const out: string[] = [];
  for (const { id } of SUBJECTS) {
    const grants = (user.groupGrants as Record<string, GroupGrantRecord[]>)[id];
    if (!Array.isArray(grants) || grants.length === 0) continue;
    if (mergeModulesForSubject(grants, nowMs).length === 0) continue;
    if (user.subjects?.[id] !== true) continue;
    out.push(id);
  }
  return out;
}

export function orderGroupGrantedSubjectIds(ids: string[]): string[] {
  const set = new Set(ids);
  return SUBJECTS.map(s => s.id).filter(id => set.has(id));
}

export function applyGroupAccessHintFlags(
  user: any,
  grantedSubjectIds: string[],
): { user: any; changed: boolean } {
  if (grantedSubjectIds.length === 0) return { user, changed: false };
  if (user?.groupAccessHintSeenAt) return { user, changed: false };
  const existing = Array.isArray(user?.groupAccessPendingHint)
    ? (user.groupAccessPendingHint as string[])
    : [];
  const merged = orderGroupGrantedSubjectIds([...new Set([...existing, ...grantedSubjectIds])]);
  if (merged.length === existing.length && merged.every((id, i) => existing[i] === id)) {
    return { user, changed: false };
  }
  return {
    user: { ...user, groupAccessPendingHint: merged },
    changed: true,
  };
}

/** Доступ только через групповые правила (без оплаты / ключа). */
export function isGroupOnlySubjectAccess(user: any, availableSubjectIds: string[]): boolean {
  const grantIds = getActiveGroupGrantedSubjectIds(user);
  if (grantIds.length === 0 || availableSubjectIds.length === 0) return false;
  if (user?.paid === true || user?.previewConfirmedAt || user?.previewStatus === 'confirmed') {
    return false;
  }
  return availableSubjectIds.every(id => grantIds.includes(id));
}

export function buildGroupAccessClientPayload(user: any) {
  const grantIds = getActiveGroupGrantedSubjectIds(user);
  const pendingRaw = Array.isArray(user?.groupAccessPendingHint)
    ? (user.groupAccessPendingHint as string[])
    : [];
  const pending = orderGroupGrantedSubjectIds(pendingRaw.filter(id => grantIds.includes(id)));
  const showHint = pending.length > 0 && !user?.groupAccessHintSeenAt;
  const available = getUserAvailableSubjects(user);
  return {
    groupGrantedSubjects: grantIds,
    groupOnlyAccess: isGroupOnlySubjectAccess(user, available),
    showGroupAccessHint: showHint,
    groupAccessHintSubjects: showHint ? pending : [],
  };
}

export function dismissGroupAccessHint(user: any): { user: any; changed: boolean } {
  if (!user?.groupAccessPendingHint && user?.groupAccessHintSeenAt) {
    return { user, changed: false };
  }
  const next = { ...user };
  delete next.groupAccessPendingHint;
  next.groupAccessHintSeenAt = new Date().toISOString();
  return { user: next, changed: true };
}

function mergeModulesForSubject(grants: GroupGrantRecord[], nowMs = Date.now()): GroupAccessModule[] {
  const set = new Set<GroupAccessModule>();
  for (const g of grants) {
    if (!isGrantActive(g.expiresAt, nowMs)) continue;
    for (const m of g.modules) set.add(m);
  }
  return [...set];
}

function buildNavHiddenForModules(subjectId: string, modules: GroupAccessModule[]): string[] {
  const previewMods = normalizePreviewModules(modules);
  const hidden = new Set(buildNavHiddenForConfirmedPurchase(subjectId, previewMods));
  for (const tab of ALL_MODULES) {
    if (!modules.includes(tab)) hidden.add(tab);
  }
  return [...hidden];
}

function applyFacultyHeals(user: any): any {
  let u = user;
  const stom = ensureStomatologyBioTasksVisible(u);
  if (stom) u = stom;
  const ped = ensurePedTherBioTasksVisible(u);
  if (ped) u = ped;
  const chem = ensurePedTherChemTasksVisible(u);
  if (chem) u = chem;
  return healExamNavHidden(u);
}

export function applyGroupAccessToUser(
  user: any,
  rules: GroupAccessRule[],
  nowMs = Date.now(),
): { user: any; changed: boolean; grantedSubjects: string[] } {
  if (!user || user.blocked === true) {
    return { user, changed: false, grantedSubjects: [] };
  }

  const matched = rulesForUser(user, rules, nowMs);
  // Субъекты у которых занятия явно ограничены правилом
  const lessonsRestrictedSids = new Set(
    matched.filter(r => r.lessonsRestricted === true).map(r => r.subjectId),
  );
  const next: Record<string, unknown> = { ...migrateUserSubjects(user) };
  const groupGrants: Record<string, GroupGrantRecord[]> = {
    ...(next.groupGrants as Record<string, GroupGrantRecord[]> || {}),
  };
  const subjects = {
    ...(next.subjects as Record<string, boolean> || createDefaultSubjects()),
  };
  const navHidden: Record<string, string[]> = {
    ...(next.navHidden as Record<string, string[]> || {}),
  };

  let changed = false;
  const grantedSubjects: string[] = [];
  const nowIso = new Date(nowMs).toISOString();

  for (const rule of matched) {
    const sid = rule.subjectId;
    const mods = normalizeModules(rule.modules);
    const list = [...(groupGrants[sid] || [])];
    const idx = list.findIndex(g => g.ruleId === rule.id);
    const grantStart = idx >= 0 ? (Date.parse(list[idx].grantedAt) || nowMs) : nowMs;
    const exp = computeRuleExpiresAt(rule, grantStart);
    const rec: GroupGrantRecord = {
      ruleId: rule.id,
      grantedAt: idx >= 0 ? list[idx].grantedAt : nowIso,
      expiresAt: exp,
      modules: mods,
    };
    if (idx >= 0) list[idx] = rec;
    else list.push(rec);
    groupGrants[sid] = list;
  }

  // Удалить истёкшие записи и записи правил, которые закрыли (или удалили)
  const matchedIds = new Set(matched.map(r => r.id));
  for (const sid of Object.keys(groupGrants)) {
    const before = groupGrants[sid].length;
    groupGrants[sid] = groupGrants[sid].filter(
      g => matchedIds.has(g.ruleId) && isGrantActive(g.expiresAt, nowMs),
    );
    if (groupGrants[sid].length !== before) changed = true;
    if (groupGrants[sid].length === 0) delete groupGrants[sid];
  }

  // Снять доступ по истёкшим групповым правилам
  for (const sid of SUBJECTS.map(s => s.id)) {
    const active = mergeModulesForSubject(groupGrants[sid] || []);
    if (active.length > 0) {
      if (subjects[sid] !== true) changed = true;
      subjects[sid] = true;
      const hiddenBase = buildNavHiddenForModules(sid, active);
      const hidden = (lessonsRestrictedSids.has(sid) && !hiddenBase.includes('lessons'))
        ? [...hiddenBase, 'lessons']
        : hiddenBase;
      if (hidden.length === 0) delete navHidden[sid];
      else navHidden[sid] = hidden;
      grantedSubjects.push(sid);
      continue;
    }
    if (groupGrants[sid]?.length) continue;
    const hadGroupGrant = !!(user.groupGrants?.[sid]?.length);
    if (hadGroupGrant && subjects[sid] === true && !isSubjectProtectedFromGroupRevoke(user, sid)) {
      subjects[sid] = false;
      delete navHidden[sid];
      changed = true;
    }
  }

  for (const sid of grantedSubjects) {
    const active = mergeModulesForSubject(groupGrants[sid] || []);
    if (active.length === 0) continue;
    if (subjects[sid] !== true) changed = true;
    subjects[sid] = true;
    const hiddenBase = buildNavHiddenForModules(sid, active);
    const hidden = (lessonsRestrictedSids.has(sid) && !hiddenBase.includes('lessons'))
      ? [...hiddenBase, 'lessons']
      : hiddenBase;
    if (hidden.length === 0) delete navHidden[sid];
    else navHidden[sid] = hidden;
    if (!next[`${sid}_grantedAt`]) {
      next[`${sid}_grantedAt`] = nowIso;
      changed = true;
    }
  }

  if (grantedSubjects.length > 0) {
    if (applyGroupGrantPreviewSideEffects(next, user, grantedSubjects)) {
      changed = true;
    }
  }

  next.subjects = subjects;
  next.navHidden = navHidden;
  next.groupGrants = groupGrants;
  next._migrated_subjects = true;

  const healed = applyFacultyHeals(next);
  let finalUser = healed;
  let finalChanged = changed || healed !== user;

  const previouslyGranted = getActiveGroupGrantedSubjectIds(user, nowMs);
  const newlyGranted = grantedSubjects.filter(id => !previouslyGranted.includes(id));

  if (Array.isArray(finalUser.groupAccessPendingHint)) {
    const filtered = orderGroupGrantedSubjectIds(
      (finalUser.groupAccessPendingHint as string[]).filter(id => grantedSubjects.includes(id)),
    );
    const prevPending = finalUser.groupAccessPendingHint as string[];
    if (filtered.length !== prevPending.length || !filtered.every((id, i) => prevPending[i] === id)) {
      finalUser = filtered.length > 0
        ? { ...finalUser, groupAccessPendingHint: filtered }
        : (() => {
          const u = { ...finalUser };
          delete u.groupAccessPendingHint;
          return u;
        })();
      finalChanged = true;
    }
  }

  if (newlyGranted.length > 0) {
    const hint = applyGroupAccessHintFlags(finalUser, newlyGranted);
    if (hint.changed) {
      finalUser = hint.user;
      finalChanged = true;
    }
  }

  return {
    user: finalUser,
    changed: finalChanged,
    grantedSubjects,
  };
}

export function upsertGroupAccessRule(
  rules: GroupAccessRule[],
  patch: {
    facultyId: FacultyId;
    studyGroup: string;
    subjectId: string;
    enabled: boolean;
    modules?: GroupAccessModule[];
    durationKind?: GroupAccessDurationKind;
    durationValue?: number;
    examDate?: string;
    note?: string;
    lessonsRestricted?: boolean;
  },
): GroupAccessRule[] {
  const studyGroup = normalizeStudyGroup(patch.studyGroup);
  const id = buildRuleId(patch.facultyId, studyGroup, patch.subjectId);
  const now = new Date().toISOString();
  const idx = rules.findIndex(r => r.id === id);
  const prev = idx >= 0 ? rules[idx] : null;
  const next: GroupAccessRule = {
    id,
    facultyId: patch.facultyId,
    studyGroup,
    subjectId: patch.subjectId,
    enabled: patch.enabled,
    modules: normalizeModules(patch.modules ?? prev?.modules),
    durationKind: patch.durationKind ?? prev?.durationKind ?? 'unlimited',
    durationValue: patch.durationValue ?? prev?.durationValue,
    examDate: patch.examDate ?? prev?.examDate,
    note: patch.note ?? prev?.note,
    lessonsRestricted: patch.lessonsRestricted ?? prev?.lessonsRestricted ?? false,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  if (idx >= 0) {
    const copy = [...rules];
    copy[idx] = next;
    return copy;
  }
  return [...rules, next];
}

/** Массовое обновление правил без копирования массива на каждый патч. */
export function upsertManyGroupAccessRules(
  rules: GroupAccessRule[],
  patches: Array<Parameters<typeof upsertGroupAccessRule>[1]>,
): GroupAccessRule[] {
  const byId = new Map(rules.map(r => [r.id, r]));
  const now = new Date().toISOString();
  for (const patch of patches) {
    const studyGroup = normalizeStudyGroup(patch.studyGroup);
    if (!studyGroup || !patch.facultyId || !patch.subjectId) continue;
    const id = buildRuleId(patch.facultyId, studyGroup, patch.subjectId);
    const prev = byId.get(id) ?? null;
    byId.set(id, {
      id,
      facultyId: patch.facultyId,
      studyGroup,
      subjectId: patch.subjectId,
      enabled: patch.enabled,
      modules: normalizeModules(patch.modules ?? prev?.modules),
      durationKind: patch.durationKind ?? prev?.durationKind ?? 'unlimited',
      durationValue: patch.durationValue ?? prev?.durationValue,
      examDate: patch.examDate ?? prev?.examDate,
      note: patch.note ?? prev?.note,
      lessonsRestricted: patch.lessonsRestricted ?? prev?.lessonsRestricted ?? false,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    });
  }
  return [...byId.values()];
}

export function getAdminGroupAccessTree(
  rules: GroupAccessRule[],
  overlay?: GroupCatalogOverlay,
) {
  const tree = overlay ? buildGroupCatalogTree(overlay) : buildFacultyGroupTree();
  return tree.map(fac => ({
    ...fac,
    courses: fac.courses.map(c => ({
      ...c,
      groups: c.groups.map(g => ({
        ...g,
        subjects: SUBJECTS.map(s => {
          const rule = rules.find(
            r => r.facultyId === fac.facultyId
              && normalizeStudyGroup(r.studyGroup) === g.studyGroup
              && r.subjectId === s.id,
          );
          const active = rule ? isRuleCurrentlyActive(rule) : false;
          return {
            id: s.id,
            label: s.label,
            shortLabel: s.shortLabel,
            color: s.color,
            enabled: rule?.enabled === true,
            active,
            modules: rule?.modules ?? defaultGroupAccessModules(),
            durationKind: rule?.durationKind ?? 'unlimited',
            durationValue: rule?.durationValue ?? null,
            examDate: rule?.examDate ?? null,
            note: rule?.note ?? null,
            expiresAt: rule ? computeRuleExpiresAt(rule) : null,
            lessonsRestricted: rule?.lessonsRestricted ?? false,
          };
        }),
      })),
    })),
  }));
}

export function matchUserToRule(user: any, rule: GroupAccessRule): boolean {
  const facultyId = String(user?.facultyId || '').trim();
  const studyGroup = normalizeStudyGroup(String(user?.studyGroup || ''));
  return facultyId === rule.facultyId
    && studyGroup === normalizeStudyGroup(rule.studyGroup);
}

export function parseGroupDigits(studyGroup: string): string {
  const g = normalizeStudyGroup(studyGroup);
  const m = g.match(/^([0-9]+)/);
  return m ? m[1] : g;
}

export function groupMatchesSelection(
  studyGroup: string,
  facultyId: FacultyId,
  fromDigits: number,
  toDigits: number,
): boolean {
  const digits = Number(parseGroupDigits(studyGroup));
  if (!Number.isFinite(digits)) return false;
  const entry = getGroupRegistryEntry(studyGroup, facultyId);
  if (!entry) return digits >= fromDigits && digits <= toDigits;
  const n = Number(entry.digits);
  return n >= fromDigits && n <= toDigits;
}

export { parseCourseFromGroupDigits, buildFacultyGroupTree };
