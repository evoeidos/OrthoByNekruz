/** Тесты по гигиене: у кафедры отдельный сборник для каждой специальности. */
export const HYG_TESTS_STOM_FILE = 'hyg_tests_stomatology.json';
export const HYG_TESTS_PED_FILE = 'hyg_tests_pediatrics.json';
export const HYG_TESTS_THERAPEUTIC_FILE = 'hyg_tests_therapeutic.json';

export function resolveHygTestsFile(facultyId: string | null | undefined): string {
  if (facultyId === 'pediatrics') return HYG_TESTS_PED_FILE;
  if (facultyId === 'therapeutic') return HYG_TESTS_THERAPEUTIC_FILE;
  return HYG_TESTS_STOM_FILE;
}
