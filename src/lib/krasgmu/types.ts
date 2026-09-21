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
  type: string;
  room: string;
  teacher: string;
};

export type KrasgmuScheduleDay = {
  date: string;
  weekday: string;
  lessons: KrasgmuScheduleLesson[];
};

export type KrasgmuGradeRow = {
  subject: string;
  grade: string;
  date: string;
  teacher: string;
};

export type KrasgmuBindStatus =
  | { bound: false }
  | {
      bound: true;
      login: string;
      boundAt: string;
      lastValidatedAt: string | null;
    };
