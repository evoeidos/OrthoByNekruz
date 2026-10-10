/**
 * Подписи видов занятий — отдельно от curriculum.ts, потому что тот через
 * curriculumSeed импортирует все планы кафедр (JSON). Импорт значения из
 * curriculum в клиентском компоненте кладёт их в публичный бандл.
 */

export type LessonKind = 'lesson' | 'control' | 'colloquium';

export const LESSON_KIND_LABELS: Record<LessonKind, string> = {
  lesson:     'Занятие',
  control:    'Контрольная',
  colloquium: 'Коллоквиум',
};
