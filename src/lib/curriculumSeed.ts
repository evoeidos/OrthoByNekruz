/**
 * Планы кафедр, которые едут вместе с проектом.
 *
 * План описан двумя видами файлов: сам план с лекциями и занятия по семестрам.
 * Кафедра публикует тематический план именно по семестрам, а разбор подтем
 * делает файл занятий большим — держать его целиком на курс неудобно.
 */
import anatStomatology1 from '@/data/programs/anat-stomatology-1.json';
import anatStomatology1Sem1 from '@/data/programs/anat-stomatology-1-sem1.json';
import anatStomatology1Sem2 from '@/data/programs/anat-stomatology-1-sem2.json';
import anatStomatology2 from '@/data/programs/anat-stomatology-2.json';
import anatStomatology2Sem3 from '@/data/programs/anat-stomatology-2-sem3.json';
import anatPediatrics1 from '@/data/programs/anat-pediatrics-1.json';
import anatPediatrics1Sem1 from '@/data/programs/anat-pediatrics-1-sem1.json';
import anatPediatrics1Sem2 from '@/data/programs/anat-pediatrics-1-sem2.json';
import anatPediatrics2 from '@/data/programs/anat-pediatrics-2.json';
import anatPediatrics2Sem3 from '@/data/programs/anat-pediatrics-2-sem3.json';

const SEED_FILES: unknown[] = [
  { ...anatStomatology1, lessons: [...anatStomatology1Sem1, ...anatStomatology1Sem2] },
  { ...anatStomatology2, lessons: [...anatStomatology2Sem3] },
  { ...anatPediatrics1, lessons: [...anatPediatrics1Sem1, ...anatPediatrics1Sem2] },
  { ...anatPediatrics2, lessons: [...anatPediatrics2Sem3] },
];

export function listSeedPrograms(): unknown[] {
  return SEED_FILES;
}
