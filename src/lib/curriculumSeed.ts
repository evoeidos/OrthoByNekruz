/**
 * Планы кафедр, которые едут вместе с проектом.
 *
 * План описан двумя видами файлов: сам план с лекциями и занятия по семестрам.
 * Кафедра публикует тематический план именно по семестрам, а разбор подтем
 * делает файл занятий большим — держать его целиком на курс неудобно.
 *
 * Файлы грузятся лениво, по одному: статический import всех планов (13 МБ)
 * разбирался синхронно при первом запросе к занятиям, и сервер замирал на
 * несколько секунд для всех студентов. Динамический import() даёт по чанку
 * на файл, а пауза между файлами отдаёт процесс другим запросам.
 */

type SeedSpec = { plan: string; lessons?: string[] };

const ANAT_PROGRAMS: SeedSpec[] = [
  { plan: 'anat-stomatology-1.json', lessons: ['anat-stomatology-1-sem1.json', 'anat-stomatology-1-sem2.json'] },
  { plan: 'anat-stomatology-2.json', lessons: ['anat-stomatology-2-sem3.json'] },
  { plan: 'anat-pediatrics-1.json', lessons: ['anat-pediatrics-1-sem1.json', 'anat-pediatrics-1-sem2.json'] },
  { plan: 'anat-pediatrics-2.json', lessons: ['anat-pediatrics-2-sem3.json'] },
];

// Методички КрасГМУ: scripts/build_lesson_programs.cjs
// <generated:methodichki>
const METHODICHKI_FILES: string[] = [
  'bio-stomatology-1.json',
  'bioxim-stomatology-1.json',
  'bioxim-stomatology-2.json',
  'chem-stomatology-1.json',
  'eng-stomatology-1.json',
  'fizo-stomatology-1.json',
  'fizo-stomatology-2.json',
  'gista-stomatology-1.json',
  'gista-stomatology-2.json',
  'micro-stomatology-2.json',
  'ortho-stomatology-2.json',
  'patan-stomatology-2.json',
  'patan-stomatology-3.json',
  'patfiz-stomatology-2.json',
  'patfiz-stomatology-3.json',
  'pharma-stomatology-3.json',
  'therapy-stomatology-2.json',
];
// </generated:methodichki>

const SEED_SPECS: SeedSpec[] = [
  ...ANAT_PROGRAMS,
  ...METHODICHKI_FILES.map(plan => ({ plan })),
];

async function readProgramFile(file: string): Promise<any> {
  const mod = await import(
    /* webpackInclude: /\.json$/ */
    `../data/programs/${file}`
  );
  return (mod as { default?: unknown }).default ?? mod;
}

/** Отдать процесс другим запросам между тяжёлыми шагами. */
export const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

/** Сырые планы по одному: между файлами процесс успевает обслужить других. */
export async function* readSeedPrograms(): AsyncGenerator<unknown> {
  for (const spec of SEED_SPECS) {
    const plan = await readProgramFile(spec.plan);
    if (!spec.lessons) {
      yield plan;
    } else {
      const lessons: unknown[] = [];
      for (const file of spec.lessons) {
        const part = await readProgramFile(file);
        if (Array.isArray(part)) lessons.push(...part);
      }
      yield { ...plan, lessons };
    }
    await yieldToEventLoop();
  }
}
