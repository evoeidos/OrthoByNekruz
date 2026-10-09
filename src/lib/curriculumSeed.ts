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

// <generated:imports>
import m_bio_stomatology_1 from '@/data/programs/bio-stomatology-1.json';
import m_bioxim_stomatology_1 from '@/data/programs/bioxim-stomatology-1.json';
import m_bioxim_stomatology_2 from '@/data/programs/bioxim-stomatology-2.json';
import m_chem_stomatology_1 from '@/data/programs/chem-stomatology-1.json';
import m_eng_stomatology_1 from '@/data/programs/eng-stomatology-1.json';
import m_fizo_stomatology_1 from '@/data/programs/fizo-stomatology-1.json';
import m_fizo_stomatology_2 from '@/data/programs/fizo-stomatology-2.json';
import m_gista_stomatology_1 from '@/data/programs/gista-stomatology-1.json';
import m_gista_stomatology_2 from '@/data/programs/gista-stomatology-2.json';
import m_micro_stomatology_2 from '@/data/programs/micro-stomatology-2.json';
import m_ortho_stomatology_2 from '@/data/programs/ortho-stomatology-2.json';
import m_patan_stomatology_2 from '@/data/programs/patan-stomatology-2.json';
import m_patan_stomatology_3 from '@/data/programs/patan-stomatology-3.json';
import m_patfiz_stomatology_2 from '@/data/programs/patfiz-stomatology-2.json';
import m_patfiz_stomatology_3 from '@/data/programs/patfiz-stomatology-3.json';
import m_pharma_stomatology_3 from '@/data/programs/pharma-stomatology-3.json';
import m_therapy_stomatology_2 from '@/data/programs/therapy-stomatology-2.json';
// </generated:imports>

// Методички КрасГМУ: scripts/build_lesson_programs.cjs
// <generated:methodichki>
const METHODICHKI_PROGRAMS: unknown[] = [
  m_bio_stomatology_1,
  m_bioxim_stomatology_1,
  m_bioxim_stomatology_2,
  m_chem_stomatology_1,
  m_eng_stomatology_1,
  m_fizo_stomatology_1,
  m_fizo_stomatology_2,
  m_gista_stomatology_1,
  m_gista_stomatology_2,
  m_micro_stomatology_2,
  m_ortho_stomatology_2,
  m_patan_stomatology_2,
  m_patan_stomatology_3,
  m_patfiz_stomatology_2,
  m_patfiz_stomatology_3,
  m_pharma_stomatology_3,
  m_therapy_stomatology_2,
];
// </generated:methodichki>

const SEED_FILES: unknown[] = [
  { ...anatStomatology1, lessons: [...anatStomatology1Sem1, ...anatStomatology1Sem2] },
  { ...anatStomatology2, lessons: [...anatStomatology2Sem3] },
  { ...anatPediatrics1, lessons: [...anatPediatrics1Sem1, ...anatPediatrics1Sem2] },
  { ...anatPediatrics2, lessons: [...anatPediatrics2Sem3] },
  ...METHODICHKI_PROGRAMS,
];

export function listSeedPrograms(): unknown[] {
  return SEED_FILES;
}
