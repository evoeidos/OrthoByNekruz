export type KrasgmuSessionCookies = Record<string, string>;

export type KrasgmuBindingRecord = {
  universityLogin: string;
  encryptedSession: string;
  /** Зашифрованный пароль — только для автоматического обновления сессии */
  encryptedPassword: string;
  boundAt: string;
  lastValidatedAt: string | null;
};

export type KrasgmuScheduleLesson = {
  time: string;
  subject: string;
  /** ЛЕКЦИЯ / пусто (практика или без явного типа) */
  type: string;
  room: string;
  teacher: string;
  /** Конкретные календарные даты повторения (сайт отдаёт недельный шаблон + список дат) */
  dates?: string;
};

export type KrasgmuScheduleDay = {
  date: string;
  weekday: string;
  lessons: KrasgmuScheduleLesson[];
};

export type KrasgmuGradeRow = {
  /** Название предмета + тема занятия (напр. «Стоматология — Мандибулярная анестезия») */
  subject: string;
  /** Явка / Неявка / оценка (2-5, в т.ч. дробная «4,5») / Перезачет */
  grade: string;
  date: string;
  teacher: string;
  /** ЛЕКЦИЯ / ПРАКТИЧЕСКИЕ ЗАНЯТИЯ / ПРАКТИЧЕСКИЕ УМЕНИЯ */
  kind: string;
};

export type KrasgmuProfile = {
  fullName: string;
  /** «31.05.03 Стоматология (очное, высшее образование, 5,00)» */
  specialty: string;
  course: string;
  group: string;
  enrollYear: string;
  gradebook: string;
  category: string;
  /** «Задолжник» и т.п., пусто если нет статуса */
  status: string;
};

export type KrasgmuCycle = {
  /** «1 сентября 2026» — с годом, в отличие от KrasgmuScheduleLesson.dates. */
  startDate: string;
  endDate: string;
  discipline: string;
  address: string;
};

export type KrasgmuUmkdEntry = {
  umkdId: string;
  discipline: string;
};

export type KrasgmuTopicPlanRow = {
  tlId: string;
  /** Порядковый номер темы в семестре — «по счёту» лекция/занятие. */
  seq: number;
  /** Название раздела/цикла с часами в скобках, напр. «Методы местного обезболивания [2.00]». */
  section: string;
  /** Полный текст темы занятия. */
  topic: string;
  hours: string;
};

/** Полный тематический план одной дисциплины — для библиотеки методичек (не привязан к расписанию). */
export type KrasgmuLibrarySubject = {
  discipline: string;
  lectures: KrasgmuTopicPlanRow[];
  practice: KrasgmuTopicPlanRow[];
};

export type KrasgmuMethodichkaChapter = {
  title: string;
  paragraphs: string[];
};

export type KrasgmuMethodichka = {
  /** «Тема №2. Патофизиология клетки.» */
  title: string;
  chapters: KrasgmuMethodichkaChapter[];
};

export type KrasgmuBindStatus =
  | { bound: false }
  | {
      bound: true;
      login: string;
      boundAt: string;
      lastValidatedAt: string | null;
    };
