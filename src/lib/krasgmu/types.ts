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

export type KrasgmuBindStatus =
  | { bound: false }
  | {
      bound: true;
      login: string;
      boundAt: string;
      lastValidatedAt: string | null;
    };
