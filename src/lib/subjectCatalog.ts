import { SUBJECTS, getSubject } from '@/lib/subjects';

export type ModuleKind = 'questions' | 'tests' | 'tasks';

export interface SubjectModuleInfo {
  id:          ModuleKind;
  label:       string;
  description: string;
  available:   boolean;
}

export interface SubjectCatalogEntry {
  id:               string;
  label:            string;
  badge:            string;
  color:            string;
  dimColor:         string;
  borderColor:      string;
  modules:          SubjectModuleInfo[];
  hasAnyModule:     boolean;
  allModulesMissing: boolean;
}

const MODULE_META: Record<ModuleKind, { label: string; description: string }> = {
  questions: {
    label:       'Экзаменационные вопросы',
    description: 'Билеты и разборы ответов — как на экзамене, только понятнее',
  },
  tests: {
    label:       'Итоговые тесты',
    description: 'Проверка перед сессией в формате тестов',
  },
  tasks: {
    label:       'Экзаменационные задачи',
    description: 'Практические задачи для закрепления материала',
  },
};

// Список непустых JSON считает next.config.js при сборке. Здесь нельзя
// require(`../data/${f}`): модуль импортируется клиентом (через preview.ts),
// и webpack положил бы весь контент предметов в публичный бандл.
const AVAILABLE_DATA_FILES = new Set(
  (process.env.DATA_FILES_AVAILABLE || '').split(',').filter(Boolean),
);

function moduleDataAvailable(fileName: string): boolean {
  return !!fileName && AVAILABLE_DATA_FILES.has(fileName);
}

export function buildSubjectCatalog(): SubjectCatalogEntry[] {
  return SUBJECTS.map(s => {
    const modules: SubjectModuleInfo[] = (
      ['questions', 'tests', 'tasks'] as ModuleKind[]
    ).map(id => {
      const file = id === 'questions' ? s.questionsFile
        : id === 'tests' ? s.testsFile
        : s.tasksFile;
      return {
        id,
        label:       MODULE_META[id].label,
        description: MODULE_META[id].description,
        available:   moduleDataAvailable(file),
      };
    });

    const availableCount = modules.filter(m => m.available).length;

    return {
      id:                s.id,
      label:             s.label,
      badge:             s.badge,
      color:             s.color,
      dimColor:          s.dimColor,
      borderColor:       s.borderColor,
      modules,
      hasAnyModule:      availableCount > 0,
      allModulesMissing: availableCount === 0,
    };
  });
}

/** Какие табы скрыть, если JSON-файла ещё нет */
export function getNavHiddenForSubject(subjectId: string): string[] {
  const cfg = getSubject(subjectId);
  if (!cfg) return ['questions', 'tests', 'tasks'];

  const hidden: string[] = [];
  if (!moduleDataAvailable(cfg.questionsFile)) hidden.push('questions');
  if (!moduleDataAvailable(cfg.testsFile))     hidden.push('tests');
  if (!moduleDataAvailable(cfg.tasksFile))     hidden.push('tasks');
  return hidden;
}
