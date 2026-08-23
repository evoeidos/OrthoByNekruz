/** Группа: студент вводит только цифры, буква факультета дописывается на сервере. */

/** Суффикс по facultyId (из кода канала) */
export const FACULTY_GROUP_SUFFIX: Record<string, string> = {
  stomatology: 'с',
  therapeutic: 'л',
  pediatrics:  'п',
};

export const STUDY_GROUP_DIGITS_PLACEHOLDER = '108';

export function getFacultyGroupSuffix(facultyId: string | null | undefined): string | null {
  if (!facultyId) return null;
  return FACULTY_GROUP_SUFFIX[facultyId] ?? null;
}

export function isValidStudyGroupDigits(digits: string): boolean {
  const d = digits.replace(/\D/g, '');
  return /^[0-9]{2,4}$/.test(d);
}

/** Собрать группу для Redis и админки: 108 + stomatology → 108с */
export function buildStudyGroupFromDigits(
  digits: string,
  facultyId: string | null | undefined,
): string | null {
  const d = digits.replace(/\D/g, '');
  if (!isValidStudyGroupDigits(d)) return null;
  const suffix = getFacultyGroupSuffix(facultyId);
  if (!suffix) return null;
  return `${d}${suffix}`;
}

export function normalizeStudyGroup(raw: string): string {
  const g = raw.trim().replace(/\s+/g, '').toLowerCase();
  if (!g) return g;
  const m = g.match(/^([0-9]{2,4})(.*)$/);
  if (!m) return g;
  const num = m[1];
  let tail = m[2];
  if (tail === 'c') tail = 'с';
  if (tail === 'l') tail = 'л';
  if (tail === 'p') tail = 'п';
  return `${num}${tail}`;
}

/** 208с → stomatology. Обратная операция к buildStudyGroupFromDigits. */
export function facultyFromStudyGroup(raw: string): string | null {
  const suffix = normalizeStudyGroup(raw).slice(-1);
  if (!suffix) return null;
  const found = Object.entries(FACULTY_GROUP_SUFFIX).find(([, s]) => s === suffix);
  return found ? found[0] : null;
}

export function isValidStudyGroup(raw: string): boolean {
  const g = normalizeStudyGroup(raw);
  if (!g || g.length < 3 || g.length > 6) return false;
  return /^[0-9]{2,4}[слп]$/u.test(g);
}
