/**
 * Правки состава групп из админки поверх официальных диапазонов groupRegistry.
 *
 * Диапазоны в коде — только заготовка (101–148 и т.п.). Реальный набор групп
 * задаёт админ: лишние скрывает, отсутствующие добавляет. Всё, что показывает
 * сетку групп (доступ по предметам, программы кафедр), читает список отсюда,
 * чтобы состав курса был везде одинаковым.
 */
import type { AppRedis } from '@/lib/redis';
import {
  FACULTY_GROUP_CATALOG,
  type FacultyId,
  type GroupRegistryEntry,
  buildStudyGroupCode,
  listOfficialGroups,
  parseCourseFromGroupDigits,
} from '@/lib/groupRegistry';
import { normalizeStudyGroup } from '@/lib/studyGroup';

export const GROUP_CATALOG_OVERLAY_KEY = 'group_catalog_overlay';

export interface CustomGroupEntry {
  facultyId: FacultyId;
  /** Только цифры: 217 */
  digits: string;
  course: number;
  international?: boolean;
  note?: string;
  createdAt: string;
}

export interface GroupCatalogOverlay {
  added: CustomGroupEntry[];
  /** Полные коды скрытых групп: 205с */
  hidden: string[];
  updatedAt: string | null;
}

export const EMPTY_GROUP_CATALOG_OVERLAY: GroupCatalogOverlay = {
  added: [],
  hidden: [],
  updatedAt: null,
};

const FACULTY_IDS = new Set<FacultyId>(['stomatology', 'therapeutic', 'pediatrics']);

function isFacultyId(v: unknown): v is FacultyId {
  return typeof v === 'string' && FACULTY_IDS.has(v as FacultyId);
}

function normalizeCustomEntry(raw: unknown): CustomGroupEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isFacultyId(r.facultyId)) return null;
  const digits = String(r.digits ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const course = Number(r.course) || parseCourseFromGroupDigits(digits);
  if (!course) return null;
  return {
    facultyId: r.facultyId,
    digits,
    course,
    international: r.international === true,
    note: r.note ? String(r.note) : undefined,
    createdAt: r.createdAt ? String(r.createdAt) : new Date().toISOString(),
  };
}

export function normalizeGroupCatalogOverlay(raw: unknown): GroupCatalogOverlay {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_GROUP_CATALOG_OVERLAY };
  const r = raw as Record<string, unknown>;

  const added: CustomGroupEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(r.added)) {
    for (const item of r.added) {
      const entry = normalizeCustomEntry(item);
      if (!entry) continue;
      const code = buildStudyGroupCode(entry.digits, entry.facultyId);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      added.push(entry);
    }
  }

  const hidden = Array.isArray(r.hidden)
    ? [...new Set(r.hidden.map(g => normalizeStudyGroup(String(g))).filter(Boolean))]
    : [];

  return {
    added,
    hidden,
    updatedAt: r.updatedAt ? String(r.updatedAt) : null,
  };
}

export async function loadGroupCatalogOverlay(redis: AppRedis): Promise<GroupCatalogOverlay> {
  const raw = await redis.get(GROUP_CATALOG_OVERLAY_KEY);
  return normalizeGroupCatalogOverlay(raw);
}

export async function saveGroupCatalogOverlay(
  redis: AppRedis,
  overlay: GroupCatalogOverlay,
): Promise<void> {
  await redis.set(GROUP_CATALOG_OVERLAY_KEY, {
    ...overlay,
    updatedAt: new Date().toISOString(),
  });
}

/** Добавить группу, которой нет в официальных диапазонах. */
export function addCustomGroup(
  overlay: GroupCatalogOverlay,
  input: {
    facultyId: FacultyId;
    digits: string;
    international?: boolean;
    note?: string;
  },
): { overlay: GroupCatalogOverlay; studyGroup: string } | null {
  const digits = input.digits.replace(/\D/g, '');
  const course = parseCourseFromGroupDigits(digits);
  const studyGroup = buildStudyGroupCode(digits, input.facultyId);
  if (!digits || !course || !studyGroup) return null;

  // Группа могла быть просто скрыта — тогда достаточно вернуть её обратно.
  const hidden = overlay.hidden.filter(g => g !== studyGroup);
  const isOfficial = listOfficialGroups(input.facultyId).some(g => g.studyGroup === studyGroup);
  const alreadyAdded = overlay.added.some(
    g => g.facultyId === input.facultyId && g.digits === digits,
  );

  const added = isOfficial || alreadyAdded
    ? overlay.added
    : [
      ...overlay.added,
      {
        facultyId: input.facultyId,
        digits,
        course,
        international: input.international === true,
        note: input.note,
        createdAt: new Date().toISOString(),
      },
    ];

  return { overlay: { ...overlay, added, hidden }, studyGroup };
}

/** Убрать группу из сетки: свою — удалить, официальную — скрыть. */
export function removeGroupFromCatalog(
  overlay: GroupCatalogOverlay,
  facultyId: FacultyId,
  studyGroupRaw: string,
): GroupCatalogOverlay {
  const studyGroup = normalizeStudyGroup(studyGroupRaw);
  if (!studyGroup) return overlay;

  const added = overlay.added.filter(
    g => !(g.facultyId === facultyId && buildStudyGroupCode(g.digits, g.facultyId) === studyGroup),
  );
  const wasCustom = added.length !== overlay.added.length;
  const hidden = wasCustom
    ? overlay.hidden
    : [...new Set([...overlay.hidden, studyGroup])];

  return { ...overlay, added, hidden };
}

/** Вернуть скрытую официальную группу. */
export function restoreHiddenGroup(
  overlay: GroupCatalogOverlay,
  studyGroupRaw: string,
): GroupCatalogOverlay {
  const studyGroup = normalizeStudyGroup(studyGroupRaw);
  return { ...overlay, hidden: overlay.hidden.filter(g => g !== studyGroup) };
}

function compareByDigits(a: GroupRegistryEntry, b: GroupRegistryEntry): number {
  const na = Number(a.digits);
  const nb = Number(b.digits);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.studyGroup.localeCompare(b.studyGroup, 'ru');
}

/** Итоговый состав групп факультета: официальные минус скрытые плюс добавленные. */
export function listGroupsForFaculty(
  facultyId: FacultyId,
  overlay: GroupCatalogOverlay,
): GroupRegistryEntry[] {
  const hidden = new Set(overlay.hidden);
  const out = listOfficialGroups(facultyId).filter(g => !hidden.has(g.studyGroup));
  const seen = new Set(out.map(g => g.studyGroup));

  for (const custom of overlay.added) {
    if (custom.facultyId !== facultyId) continue;
    const studyGroup = buildStudyGroupCode(custom.digits, custom.facultyId);
    if (!studyGroup || seen.has(studyGroup)) continue;
    seen.add(studyGroup);
    out.push({
      digits: custom.digits,
      studyGroup,
      facultyId,
      course: custom.course,
      international: custom.international,
      note: custom.note,
    });
  }

  return out.sort(compareByDigits);
}

export interface GroupCatalogFacultyNode {
  facultyId: FacultyId;
  label: string;
  maxCourse: number;
  courses: Array<{ course: number; groups: GroupRegistryEntry[] }>;
}

/** Дерево факультет → курс → группы с учётом правок админа. */
export function buildGroupCatalogTree(overlay: GroupCatalogOverlay): GroupCatalogFacultyNode[] {
  return FACULTY_GROUP_CATALOG.map(cat => {
    const groups = listGroupsForFaculty(cat.facultyId, overlay);
    const byCourse = new Map<number, GroupRegistryEntry[]>();
    for (const g of groups) {
      const list = byCourse.get(g.course);
      if (list) list.push(g);
      else byCourse.set(g.course, [g]);
    }
    const maxCourse = Math.max(cat.maxCourse, ...[...byCourse.keys()], 1);
    return {
      facultyId: cat.facultyId,
      label: cat.label,
      maxCourse,
      courses: Array.from({ length: maxCourse }, (_, i) => i + 1).map(course => ({
        course,
        groups: byCourse.get(course) ?? [],
      })),
    };
  });
}

/** Скрытые официальные группы факультета — для кнопки «вернуть». */
export function listHiddenGroups(
  facultyId: FacultyId,
  overlay: GroupCatalogOverlay,
): GroupRegistryEntry[] {
  const hidden = new Set(overlay.hidden);
  return listOfficialGroups(facultyId)
    .filter(g => hidden.has(g.studyGroup))
    .sort(compareByDigits);
}
