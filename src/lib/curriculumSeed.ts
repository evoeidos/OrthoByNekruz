/**
 * Планы кафедр, набранные в проекте файлами.
 *
 * Такой план виден сразу после деплоя, без заполнения админки. Как только
 * админ сохраняет план из интерфейса, копия уходит в Redis и дальше главной
 * становится она — файл остаётся историей исходного документа кафедры.
 */
import anatStomatology1 from '@/data/programs/anat-stomatology-1.json';
import anatStomatology2 from '@/data/programs/anat-stomatology-2.json';

const SEED_FILES: unknown[] = [
  anatStomatology1,
  anatStomatology2,
];

export function listSeedPrograms(): unknown[] {
  return SEED_FILES;
}
