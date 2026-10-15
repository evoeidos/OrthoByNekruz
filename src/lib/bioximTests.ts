/**
 * Банки тестов по биохимии. У педиатров своё издание сборника кафедры:
 * те же темы плюс вопросы о детском возрасте (галактоземия, фенилкетонурия,
 * новорождённые). Остальные факультеты — общий банк (издание для лечебного
 * дела). Оба собираются scripts/build_bioxim_tests.py.
 */
export const BIOXIM_TESTS_FILE = 'bioxim_tests.json';
export const BIOXIM_TESTS_PED_FILE = 'bioxim_tests_pediatrics.json';

export function resolveBioximTestsFile(facultyId: string | null | undefined): string {
  return facultyId === 'pediatrics' ? BIOXIM_TESTS_PED_FILE : BIOXIM_TESTS_FILE;
}
