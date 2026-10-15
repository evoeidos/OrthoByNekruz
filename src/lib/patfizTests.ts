/**
 * Банки тестов по патофизиологии. У стоматологов свой курс кафедры, у
 * лечебного дела и педиатрии — один общий курс («3 курс лечебное дело,
 * педиатрия»), поэтому и банк у них один. Без факультета — стоматологический,
 * как было до разделения.
 */
export const PATFIZ_TESTS_STOM_FILE = 'patfiz_tests_stomatology.json';
export const PATFIZ_TESTS_THER_PED_FILE = 'patfiz_tests_therapeutic_pediatrics.json';

export function resolvePatfizTestsFile(facultyId: string | null | undefined): string {
  return facultyId === 'therapeutic' || facultyId === 'pediatrics'
    ? PATFIZ_TESTS_THER_PED_FILE
    : PATFIZ_TESTS_STOM_FILE;
}
