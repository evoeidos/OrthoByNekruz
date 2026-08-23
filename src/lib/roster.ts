/**
 * Списки групп из деканата — только для админки.
 *
 * Студенту список не показываем: там номер зачётки и категория оплаты.
 * В приложении список нужен админу, чтобы видеть реальный размер группы
 * и сравнивать с числом аккаунтов (аккаунтов больше, чем студентов в
 * списке — вероятно, доступ раздали друзьям).
 */
import type { AppRedis } from '@/lib/redis';
import type { FacultyId } from '@/lib/groupRegistry';
import { buildStudyGroupCode, parseCourseFromGroupDigits } from '@/lib/groupRegistry';
import { normalizeStudyGroup } from '@/lib/studyGroup';

export const ROSTER_INDEX_KEY = 'roster:index';

export function rosterKey(studyGroup: string): string {
  return `roster:${normalizeStudyGroup(studyGroup)}`;
}

export interface RosterStudent {
  /** Номер по списку деканата */
  n: number;
  fio: string;
  /** Номер зачётки: 25-с51 */
  record?: string;
  /** Категория оплаты — только для админки */
  funding?: string;
}

export interface RosterGroup {
  studyGroup: string;
  facultyId: FacultyId;
  course: number;
  /** Строка специальности из шапки списка */
  specialty?: string;
  students: RosterStudent[];
  updatedAt: string;
}

export interface RosterParseResult {
  /** Номер группы из шапки, если он там был */
  digitsFromHeader: string | null;
  specialty: string | null;
  students: RosterStudent[];
  /** Строки, которые не удалось разобрать */
  skipped: string[];
}

const HEADER_RE = /^\s*группа\s+([0-9]+)\s*(?:,\s*(.+))?$/iu;
const TABLE_HEADER_RE = /^\s*(?:№|N)\s*[\s.]*(?:ф\.?\s*и\.?\s*о\.?)/iu;
const PAGE_MARK_RE = /^\s*-{2,}\s*\d+\s+of\s+\d+\s*-{2,}\s*$/iu;
const RECORD_TAIL_RE = /\s+(\d{2}\s*-\s*[^\s]+)\s*$/u;
const FUNDING_TAIL_RE = /\s+(внебюджет|бюджет(?:\s*-\s*целевое)?|целевое(?:\s+обучение)?|контракт|платно)\s*$/iu;
const NUMBERED_RE = /^\s*(\d{1,3})[.)]?\s+(.+?)\s*$/u;

function cleanSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Разбор текста, скопированного из списка деканата. */
export function parseRosterText(text: string): RosterParseResult {
  const result: RosterParseResult = {
    digitsFromHeader: null,
    specialty: null,
    students: [],
    skipped: [],
  };

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = cleanSpaces(rawLine);
    if (!line) continue;
    if (PAGE_MARK_RE.test(line) || TABLE_HEADER_RE.test(line)) continue;

    const header = HEADER_RE.exec(line);
    if (header) {
      result.digitsFromHeader = header[1];
      if (header[2]) result.specialty = cleanSpaces(header[2]);
      continue;
    }

    const numbered = NUMBERED_RE.exec(line);
    if (!numbered) {
      result.skipped.push(line);
      continue;
    }

    const n = Number(numbered[1]);
    let rest = numbered[2];

    let record: string | undefined;
    const recordMatch = RECORD_TAIL_RE.exec(rest);
    if (recordMatch) {
      record = recordMatch[1].replace(/\s+/g, '');
      rest = rest.slice(0, recordMatch.index);
    }

    let funding: string | undefined;
    const fundingMatch = FUNDING_TAIL_RE.exec(rest);
    if (fundingMatch) {
      funding = cleanSpaces(fundingMatch[1]);
      rest = rest.slice(0, fundingMatch.index);
    }

    // «Оруджов Тургай -» — прочерк вместо отчества
    const fio = cleanSpaces(rest).replace(/\s+-\s*$/u, '');
    if (!fio) {
      result.skipped.push(line);
      continue;
    }

    result.students.push({ n, fio, record, funding });
  }

  return result;
}

/** «Аноркулов Диёрбек Баходурович» → «Аноркулов Д. Б.» */
export function shortFio(fio: string): string {
  const parts = cleanSpaces(fio).split(' ').filter(Boolean);
  if (parts.length <= 1) return fio;
  const initials = parts.slice(1).map(p => `${p[0].toUpperCase()}.`).join(' ');
  return `${parts[0]} ${initials}`;
}

export function normalizeRosterGroup(raw: unknown): RosterGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const studyGroup = normalizeStudyGroup(String(r.studyGroup ?? ''));
  const facultyId = String(r.facultyId ?? '').trim() as FacultyId;
  if (!studyGroup || !facultyId) return null;

  const students: RosterStudent[] = Array.isArray(r.students)
    ? r.students
      .map((item, i): RosterStudent | null => {
        if (!item || typeof item !== 'object') return null;
        const s = item as Record<string, unknown>;
        const fio = cleanSpaces(String(s.fio ?? ''));
        if (!fio) return null;
        const n = Number(s.n);
        return {
          n: Number.isInteger(n) && n > 0 ? n : i + 1,
          fio,
          record: s.record ? String(s.record) : undefined,
          funding: s.funding ? String(s.funding) : undefined,
        };
      })
      .filter((s): s is RosterStudent => s !== null)
    : [];

  const course = Number(r.course) || parseCourseFromGroupDigits(studyGroup) || 1;

  return {
    studyGroup,
    facultyId,
    course,
    specialty: r.specialty ? String(r.specialty) : undefined,
    students: students.sort((a, b) => a.n - b.n),
    updatedAt: r.updatedAt ? String(r.updatedAt) : new Date().toISOString(),
  };
}

export function buildRosterGroup(input: {
  facultyId: FacultyId;
  digits: string;
  parsed: RosterParseResult;
}): RosterGroup | null {
  const digits = (input.digits || input.parsed.digitsFromHeader || '').replace(/\D/g, '');
  const studyGroup = buildStudyGroupCode(digits, input.facultyId);
  const course = parseCourseFromGroupDigits(digits);
  if (!studyGroup || !course) return null;

  return {
    studyGroup,
    facultyId: input.facultyId,
    course,
    specialty: input.parsed.specialty ?? undefined,
    students: input.parsed.students,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Хранение ──────────────────────────────────────────────────────────────

export async function listRosterGroups(redis: AppRedis): Promise<string[]> {
  const raw = await redis.smembers(ROSTER_INDEX_KEY);
  return (raw ?? []).map(String).filter(Boolean).sort();
}

export async function loadRoster(
  redis: AppRedis,
  studyGroup: string,
): Promise<RosterGroup | null> {
  const raw = await redis.get(rosterKey(studyGroup));
  return normalizeRosterGroup(raw);
}

export async function saveRoster(redis: AppRedis, roster: RosterGroup): Promise<void> {
  await redis.set(rosterKey(roster.studyGroup), roster);
  await redis.sadd(ROSTER_INDEX_KEY, roster.studyGroup);
}

export async function deleteRoster(redis: AppRedis, studyGroup: string): Promise<void> {
  const key = normalizeStudyGroup(studyGroup);
  await redis.del(rosterKey(key));
  await redis.srem(ROSTER_INDEX_KEY, key);
}

export interface RosterOverview {
  studyGroup: string;
  facultyId: FacultyId;
  course: number;
  listed: number;
  updatedAt: string;
}

export async function loadRosterOverview(redis: AppRedis): Promise<RosterOverview[]> {
  const groups = await listRosterGroups(redis);
  const out: RosterOverview[] = [];
  for (const studyGroup of groups) {
    const roster = await loadRoster(redis, studyGroup);
    if (!roster) continue;
    out.push({
      studyGroup: roster.studyGroup,
      facultyId: roster.facultyId,
      course: roster.course,
      listed: roster.students.length,
      updatedAt: roster.updatedAt,
    });
  }
  return out;
}
