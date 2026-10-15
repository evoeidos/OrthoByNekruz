// ═══════════════════════════════════════════════════════════════════════════
// src/lib/subjects.ts
// ═══════════════════════════════════════════════════════════════════════════
//
// ЦЕНТРАЛЬНАЯ КОНФИГУРАЦИЯ ДИСЦИПЛИН
//
// КАК ДОБАВИТЬ НОВЫЙ ПРЕДМЕТ:
//   1. Положи 3-4 JSON-файла в src/data/ с именами из конфига:
//        bio_questions.json, bio_tasks.json, bio_tests.json
//        (опционально bio_glossary.json)
//   2. Раскомментируй (или добавь) объект в массив SUBJECTS ниже
//   3. Всё. Админка покажет кнопку выдачи доступа автоматически,
//      шапка табов показывает APP_BRAND_NAME (КрасГМУ).
//
// ═══════════════════════════════════════════════════════════════════════════

import { BIO_QUESTIONS_PED_FILE, BIO_QUESTIONS_THERAPEUTIC_FILE } from '@/lib/bioQuestions';
import { BIO_TASKS_PED_FILE, BIO_TASKS_STOM_FILE, BIO_TASKS_THERAPEUTIC_FILE, resolveBioFacultyId } from '@/lib/bioTasks';
import { CHEM_TASKS_FILE, resolveChemFacultyId } from '@/lib/chemTasks';
import { HYG_TESTS_PED_FILE, HYG_TESTS_STOM_FILE, HYG_TESTS_THERAPEUTIC_FILE } from '@/lib/hygTests';

/** Название университета в шапке всех дисциплин */
export const APP_BRAND_NAME = 'КрасГМУ';

// ─── Тип конфигурации одной дисциплины ─────────────────────────────────────
export interface SubjectConfig {
  /** Уникальный ID дисциплины. Используется в URL, Redis, localStorage. */
  id: string;

  /** Полное название (показывается в UI на карточке выбора и под лого) */
  label: string;

  /** Короткое название для бейджей в админке */
  shortLabel: string;

  /** Подзаголовок на карточке выбора */
  sub: string;

  /** Бейдж курса (например, "2 курс") */
  badge: string;

  // ── Дизайн ──────────────────────────────────────────────────────────────
  /** Основной цвет (CSS-переменная или прямой hsl/hex). */
  color: string;
  /** Цвет фона карточки */
  dimColor: string;
  /** Цвет границы */
  borderColor: string;
  /** Какую иконку показывать ('perfect' = идеальный зуб, 'normal' = обычный) */
  iconVariant: 'perfect' | 'normal';

  // ── Файлы данных (пути относительно src/data/) ─────────────────────────
  /** Имя файла с вопросами */
  questionsFile: string;
  /** Имя файла с задачами */
  tasksFile: string;
  /** Имя файла с тестами */
  testsFile: string;
  /** Имя файла с глоссарием (опционально — может отсутствовать) */
  glossaryFile: string;

  // ── Ключи localStorage ──────────────────────────────────────────────────
  /** Префикс для всех localStorage-ключей этой дисциплины. Для ortho="ortho"
   *  но используется только в новых дисциплинах — у ortho ключи без префикса
   *  для обратной совместимости. */
  lsPrefix: string;

  // ── Доступ ──────────────────────────────────────────────────────────────
  /** Доступна ли дисциплина бесплатно после активации ключа? */
  freeWithKey: boolean;

  /** Доступна ли в демо-режиме? Только основная дисциплина — true. */
  availableInDemo: boolean;

  /** Цикл режимов в «Вопросах»: список → флэшкарты → В/Н */
  questionGameModes?: boolean;
}

// ─── Список всех дисциплин ─────────────────────────────────────────────────
export const SUBJECTS: SubjectConfig[] = [
  // ═════════════════════════ ОРТОПЕДИЯ (основная) ═════════════════════════
  {
    id:             'ortho',
    label:          'Ортопедия',
    shortLabel:     'ortho',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '2 курс',
    color:          'hsl(140 61% 41%)',
    dimColor:       'hsl(140 61% 41% / 0.12)',
    borderColor:    'hsl(140 61% 41% / 0.28)',
    iconVariant:    'perfect',
    questionsFile:  'questions.json',
    tasksFile:      'tasks.json',
    testsFile:      'tests.json',
    glossaryFile:   'glossary.json',
    lsPrefix:       'ortho',
    freeWithKey:    false,
    availableInDemo: true,
    questionGameModes: true,
  },

  // ═════════════════════════ МИКРОБИОЛОГИЯ ════════════════════════════════
  {
    id:             'micro',
    label:          'Микробиология',
    shortLabel:     'micro',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '2 курс',
    color:          'hsl(39 82% 43%)',
    dimColor:       'hsl(39 82% 43% / 0.12)',
    borderColor:    'hsl(39 82% 43% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'micro_questions.json',
    tasksFile:      'micro_tasks.json',
    testsFile:      'micro_tests.json',
    glossaryFile:   'micro_glossary.json',
    lsPrefix:       'micro',
    freeWithKey:    false,
    availableInDemo: false,
  },

  // ═════════════════════════ ФАРМАКОЛОГИЯ ══════════════════════════════════
  {
    id:             'pharma',
    label:          'Фармакология',
    shortLabel:     'pharma',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '3 курс',
    color:          'hsl(262 58% 52%)',
    dimColor:       'hsl(262 58% 52% / 0.12)',
    borderColor:    'hsl(262 58% 52% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'pharma_questions.json',
    tasksFile:      'pharma_tasks.json',
    testsFile:      'pharma_tests.json',
    glossaryFile:   'pharma_glossary.json',
    lsPrefix:       'pharma',
    freeWithKey:    false,
    availableInDemo: false,
    questionGameModes: true,
  },

  // ═════════════════════════ БИОЛОГИЯ ═════════════════════════════════════
  {
    id:             'bio',
    label:          'Биология',
    shortLabel:     'bio',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '1 курс',
    color:          'hsl(142 70% 45%)',
    dimColor:       'hsl(142 70% 45% / 0.12)',
    borderColor:    'hsl(142 70% 45% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'bio_questions_stomatology.json',
    tasksFile:      'bio_tasks.json',
    testsFile:      'bio_tests.json',
    glossaryFile:   'bio_glossary.json',
    lsPrefix:       'bio',
    freeWithKey:    false,
    availableInDemo: false,
    questionGameModes: true,
  },

  // ═════════════════════════ ФИЗИОЛОГИЯ ═══════════════════════════════════
  {
    id:             'fizo',
    label:          'Физиология',
    shortLabel:     'fizo',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '2 курс',
    color:          'hsl(210 80% 55%)',
    dimColor:       'hsl(210 80% 55% / 0.12)',
    borderColor:    'hsl(210 80% 55% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'fizo_questions.json',
    tasksFile:      'fizo_tasks.json',
    testsFile:      'fizo_tests.json',
    glossaryFile:   'fizo_glossary.json',
    lsPrefix:       'fizo',
    freeWithKey:    false,
    availableInDemo: false,
  },

  // ═════════════════════════ ГИСТОЛОГИЯ ═══════════════════════════════════
  {
    id:             'gista',
    label:          'Гистология',
    shortLabel:     'gista',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '2 курс',
    color:          'hsl(280 65% 55%)',
    dimColor:       'hsl(280 65% 55% / 0.12)',
    borderColor:    'hsl(280 65% 55% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'gista_questions.json',
    tasksFile:      'gista_tasks.json',
    testsFile:      'gista_tests.json',
    glossaryFile:   'gista_glossary.json',
    lsPrefix:       'gista',
    freeWithKey:    false,
    availableInDemo: false,
  },

  // ═════════════════════════ БИОХИМИЯ ═════════════════════════════════════
  {
    id:             'bioxim',
    label:          'Биохимия',
    shortLabel:     'bioxim',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '2 курс',
    color:          'hsl(25 90% 55%)',
    dimColor:       'hsl(25 90% 55% / 0.12)',
    borderColor:    'hsl(25 90% 55% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'bioxim_questions.json',
    tasksFile:      'bioxim_tasks.json',
    testsFile:      'bioxim_tests.json',
    glossaryFile:   'bioxim_glossary.json',
    lsPrefix:       'bioxim',
    freeWithKey:    false,
    availableInDemo: false,
  },

  // ═════════════════════════ АНАТОМИЯ ═════════════════════════════════════
  {
    id:             'anat',
    label:          'Анатомия',
    shortLabel:     'anat',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '1–2 курс',
    color:          'hsl(0 75% 55%)',
    dimColor:       'hsl(0 75% 55% / 0.12)',
    borderColor:    'hsl(0 75% 55% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'anat_questions.json',
    tasksFile:      'anat_tasks.json',
    testsFile:      'anat_tests.json',
    glossaryFile:   'anat_glossary.json',
    lsPrefix:       'anat',
    freeWithKey:    false,
    availableInDemo: false,
  },

  // ════════════════════ ТЕРАПЕВТИЧЕСКАЯ СТОМАТОЛОГИЯ ═════════════════════
  {
    id:             'therapy',
    label:          'Терапевтическая стоматология',
    shortLabel:     'therapy',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '3 курс',
    color:          'hsl(175 70% 42%)',
    dimColor:       'hsl(175 70% 42% / 0.12)',
    borderColor:    'hsl(175 70% 42% / 0.28)',
    iconVariant:    'perfect',
    questionsFile:  'therapy_questions.json',
    tasksFile:      'therapy_tasks.json',
    testsFile:      'therapy_tests.json',
    glossaryFile:   'therapy_glossary.json',
    lsPrefix:       'therapy',
    freeWithKey:    false,
    availableInDemo: false,
  },

  // ═════════════════════ ПАТОЛОГИЧЕСКАЯ АНАТОМИЯ ═════════════════════════
  {
    id:             'patan',
    label:          'Патологическая анатомия',
    shortLabel:     'patan',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '3 курс',
    color:          'hsl(330 65% 55%)',
    dimColor:       'hsl(330 65% 55% / 0.12)',
    borderColor:    'hsl(330 65% 55% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'patan_questions.json',
    tasksFile:      'patan_tasks.json',
    testsFile:      'patan_tests.json',
    glossaryFile:   'patan_glossary.json',
    lsPrefix:       'patan',
    freeWithKey:    false,
    availableInDemo: false,
  },

  // ═════════════════════ ПАТОЛОГИЧЕСКАЯ ФИЗИОЛОГИЯ ════════════════════════
  {
    id:             'patfiz',
    label:          'Патологическая физиология',
    shortLabel:     'patfiz',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '3 курс',
    color:          'hsl(50 90% 50%)',
    dimColor:       'hsl(50 90% 50% / 0.12)',
    borderColor:    'hsl(50 90% 50% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'patfiz_questions.json',
    tasksFile:      'patfiz_tasks.json',
    testsFile:      'patfiz_tests.json',
    glossaryFile:   'patfiz_glossary.json',
    lsPrefix:       'patfiz',
    freeWithKey:    false,
    availableInDemo: false,
  },

  // ═════════════════════════ ХИМИЯ ════════════════════════════════════════
  {
    id:             'chem',
    label:          'Химия',
    shortLabel:     'chem',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '1 курс',
    color:          'hsl(199 89% 48%)',
    dimColor:       'hsl(199 89% 48% / 0.12)',
    borderColor:    'hsl(199 89% 48% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'chem_questions.json',
    tasksFile:      'chem_tasks.json',
    testsFile:      'chem_tests.json',
    glossaryFile:   'chem_glossary.json',
    lsPrefix:       'chem',
    freeWithKey:    false,
    availableInDemo: false,
    questionGameModes: true,
  },

  // ═════════════════════════ ГИГИЕНА ══════════════════════════════════════
  // Тесты — по факультету студента (src/lib/hygTests.ts), здесь файл по умолчанию.
  {
    id:             'hyg',
    label:          'Гигиена',
    shortLabel:     'hyg',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '2–3 курс',
    color:          'hsl(88 55% 42%)',
    dimColor:       'hsl(88 55% 42% / 0.12)',
    borderColor:    'hsl(88 55% 42% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'hyg_questions.json',
    tasksFile:      'hyg_tasks.json',
    testsFile:      HYG_TESTS_STOM_FILE,
    glossaryFile:   'hyg_glossary.json',
    lsPrefix:       'hyg',
    freeWithKey:    false,
    availableInDemo: false,
  },

// ═════════════════════ Английский для педиатров 1 курс ════════════════════════
  {
    id:             'eng',
    label:          'Английский язык',
    shortLabel:     'eng',
    sub:            'Вопросы · Тесты · Задачи',
    badge:          '1 курс',
    color:          'hsl(56, 72%, 56%)',
    dimColor:       'hsl(50 90% 50% / 0.12)',
    borderColor:    'hsl(50 90% 50% / 0.28)',
    iconVariant:    'normal',
    questionsFile:  'eng_questions.json',
    tasksFile:      'eng_tasks.json',
    testsFile:      'eng_tests.json',
    glossaryFile:   'eng_glossary.json',
    lsPrefix:       'eng',
    freeWithKey:    false,
    availableInDemo: false,
  }
];

// ─── Тип ID любой дисциплины ───────────────────────────────────────────────
export type SubjectId = string;

// ─── Хелперы ───────────────────────────────────────────────────────────────

/** Получить конфиг дисциплины по ID. Возвращает undefined если не найдена. */
export function getSubject(id: string): SubjectConfig | undefined {
  return SUBJECTS.find(s => s.id === id);
}

/** Флэшкарты и В/Н в разделе «Вопросы». */
export function subjectHasQuestionGameModes(id: string): boolean {
  return getSubject(id)?.questionGameModes === true;
}

/** Получить конфиг или выбросить ошибку (для критических мест) */
export function getSubjectOrThrow(id: string): SubjectConfig {
  const s = getSubject(id);
  if (!s) throw new Error(`Unknown subject: ${id}`);
  return s;
}

/** Список всех ID дисциплин */
export function getAllSubjectIds(): string[] {
  return SUBJECTS.map(s => s.id);
}

/** ID основной/первой дисциплины (для дефолтов и демо) */
export function getDefaultSubjectId(): string {
  return SUBJECTS[0]?.id || 'ortho';
}

/** Дисциплина для демо-режима */
export function getDemoSubjectId(): string {
  const demoSubject = SUBJECTS.find(s => s.availableInDemo);
  return demoSubject?.id || getDefaultSubjectId();
}

/** Бренд в шапке табов — единый для всех дисциплин. */
export function getBrandName(_id?: string): string {
  return APP_BRAND_NAME;
}

/** Префикс localStorage. Для ortho возвращает '' (ключи без префикса —
 *  обратная совместимость). Для остальных — `${id}_`. */
export function getLsPrefix(id: string): string {
  if (id === 'ortho') return '';
  return `${getSubject(id)?.lsPrefix || id}_`;
}

// ─── Работа с правами пользователя ────────────────────────────────────────

export interface UserSubjects {
  [subjectId: string]: boolean;
}

/** Legacy: добавить поле subjects, если его ещё нет (без лишней ортопедии). */
export function migrateUserSubjects(user: any): any {
  if (!user) return user;
  if (user.subjects && typeof user.subjects === 'object') return user;

  const subjects: UserSubjects = {};
  for (const s of SUBJECTS) subjects[s.id] = false;

  const key = String(user.activatedKey || '').trim();
  if (/^\d{8}$/.test(key)) subjects.ortho = true;
  if (user.micro === true) subjects.micro = true;

  return { ...user, subjects, _migrated_subjects: true };
}

const BIO_SUBJECT_ID = 'bio';

/** Есть bio и открыт тест, но задачи ещё скрыты — можно подарить. */
export function userEligibleForBioTasksGift(user: any): boolean {
  if (!user) return false;
  const migrated = migrateUserSubjects(user);
  if (!getUserAvailableSubjects(migrated).includes(BIO_SUBJECT_ID)) return false;
  const hidden = new Set<string>((migrated.navHidden?.[BIO_SUBJECT_ID] as string[]) || []);
  if (hidden.has('tests')) return false;
  if (!hidden.has('tasks')) return false;
  return true;
}

/** Открыть раздел «Задачи» по биологии (тест уже был доступен). */
export function applyBioTasksGift(user: any): any | null {
  if (!userEligibleForBioTasksGift(user)) return null;
  const hidden = new Set<string>((user.navHidden?.[BIO_SUBJECT_ID] as string[]) || []);
  hidden.delete('tasks');
  const navHidden: Record<string, string[]> = { ...(user.navHidden || {}) };
  if (hidden.size === 0) delete navHidden[BIO_SUBJECT_ID];
  else navHidden[BIO_SUBJECT_ID] = [...hidden];
  return { ...user, navHidden };
}

/** Стоматологи с доступом к bio видят задачи из PDF без ручной выдачи админом. */
export function ensureStomatologyBioTasksVisible(user: any): any | null {
  if (!user) return null;
  const facultyId = resolveBioFacultyId(user);
  if (facultyId && facultyId !== 'stomatology') return null;

  const migrated = migrateUserSubjects(user);
  if (!getUserAvailableSubjects(migrated).includes(BIO_SUBJECT_ID)) return null;

  const hidden = new Set<string>((user.navHidden?.[BIO_SUBJECT_ID] as string[]) || []);
  if (!hidden.has('tasks')) return null;

  hidden.delete('tasks');
  const navHidden: Record<string, string[]> = { ...(user.navHidden || {}) };
  if (hidden.size === 0) delete navHidden[BIO_SUBJECT_ID];
  else navHidden[BIO_SUBJECT_ID] = [...hidden];
  return { ...user, navHidden };
}

/** Педиатры и лечебники с доступом к bio видят раздел «Задачи». */
export function ensurePedTherBioTasksVisible(user: any): any | null {
  if (!user) return null;
  const facultyId = resolveBioFacultyId(user);
  if (facultyId !== 'pediatrics' && facultyId !== 'therapeutic') return null;

  const migrated = migrateUserSubjects(user);
  if (!getUserAvailableSubjects(migrated).includes(BIO_SUBJECT_ID)) return null;

  const hidden = new Set<string>((user.navHidden?.[BIO_SUBJECT_ID] as string[]) || []);
  if (!hidden.has('tasks')) return null;

  hidden.delete('tasks');
  const navHidden: Record<string, string[]> = { ...(user.navHidden || {}) };
  if (hidden.size === 0) delete navHidden[BIO_SUBJECT_ID];
  else navHidden[BIO_SUBJECT_ID] = [...hidden];
  return { ...user, navHidden };
}

const CHEM_SUBJECT_ID = 'chem';

/** Педиатры и лечебники с доступом к химии видят раздел «Задачи». */
export function ensurePedTherChemTasksVisible(user: any): any | null {
  if (!user) return null;
  const facultyId = resolveChemFacultyId(user);
  if (facultyId !== 'pediatrics' && facultyId !== 'therapeutic') return null;

  const migrated = migrateUserSubjects(user);
  if (!getUserAvailableSubjects(migrated).includes(CHEM_SUBJECT_ID)) return null;

  const hidden = new Set<string>((user.navHidden?.[CHEM_SUBJECT_ID] as string[]) || []);
  if (!hidden.has('tasks')) return null;

  hidden.delete('tasks');
  const navHidden: Record<string, string[]> = { ...(user.navHidden || {}) };
  if (hidden.size === 0) delete navHidden[CHEM_SUBJECT_ID];
  else navHidden[CHEM_SUBJECT_ID] = [...hidden];
  return { ...user, navHidden };
}

/** Получить список ID открытых дисциплин у пользователя. */
export function getUserAvailableSubjects(user: any): string[] {
  if (!user) return [];

  if (user.subjects && typeof user.subjects === 'object') {
    return SUBJECTS
      .filter(s => user.subjects[s.id] === true)
      .map(s => s.id);
  }

  // Legacy: старый формат до поля subjects
  const result: string[] = [];
  const key = String(user.activatedKey || '').trim();
  if (/^\d{8}$/.test(key)) result.push('ortho');
  if (user.micro === true) result.push('micro');
  return result;
}

/** Создать дефолтный объект subjects для нового пользователя.
 *  Подход А: пустой пропуск — всё закрыто, админ откроет нужное. */
export function createDefaultSubjects(): UserSubjects {
  const result: UserSubjects = {};
  for (const s of SUBJECTS) {
    result[s.id] = s.freeWithKey;
  }
  return result;
}

/** Создать subjects для триала/демо-пользователя. */
export function createDemoSubjects(): UserSubjects {
  const result: UserSubjects = {};
  for (const s of SUBJECTS) {
    result[s.id] = s.availableInDemo;
  }
  return result;
}

/** Список всех имён JSON-файлов из конфига — для whitelist'а в API. */
export function getAllDataFileNames(): string[] {
  const names = new Set<string>();
  for (const s of SUBJECTS) {
    names.add(s.questionsFile);
    names.add(s.tasksFile);
    names.add(s.testsFile);
    names.add(s.glossaryFile);
  }
  names.add(BIO_QUESTIONS_PED_FILE);
  names.add(BIO_QUESTIONS_THERAPEUTIC_FILE);
  names.add(BIO_TASKS_STOM_FILE);
  names.add(BIO_TASKS_PED_FILE);
  names.add(BIO_TASKS_THERAPEUTIC_FILE);
  names.add(CHEM_TASKS_FILE);
  names.add(HYG_TESTS_PED_FILE);
  names.add(HYG_TESTS_THERAPEUTIC_FILE);
  return [...names];
}
