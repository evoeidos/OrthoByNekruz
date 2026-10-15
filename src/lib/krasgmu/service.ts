import type { AppRedis } from '@/lib/redis';
import {
  KrasgmuAuthError,
  deriveStudentId,
  fetchKrasgmuBinary,
  fetchKrasgmuPage,
  loginKrasgmu,
  validateSession,
} from '@/lib/krasgmu/client';
import {
  parseCycleScheduleHtml,
  parseGradesHtml,
  parseMethodichkaHtml,
  parseProfileHtml,
  parseScheduleHtml,
  parseTopicPlanHtml,
  parseUmkdListHtml,
} from '@/lib/krasgmu/parser';
import {
  getBinding,
  loadPassword,
  loadSessionCookies,
  saveBinding,
  touchValidated,
} from '@/lib/krasgmu/store';
import {
  collectLessonDates,
  enumerateCycleDates,
  matchDatesToTopics,
  matchFullDatesToTopics,
  type MatchedTopic,
} from '@/lib/krasgmu/topicMatch';
import type {
  KrasgmuCycle,
  KrasgmuGradeRow,
  KrasgmuLibraryDiscipline,
  KrasgmuMethodichka,
  KrasgmuProfile,
  KrasgmuScheduleDay,
  KrasgmuTopicPlan,
} from '@/lib/krasgmu/types';
import { findActiveCycle, krasnoyarskNow } from '@/lib/uniHelpers';
import { reserveBrowserLogin, withReloginLock } from '@/lib/krasgmu/loginGuard';
import { recordSessionDeath } from '@/lib/krasgmu/sessionStats';

// Личный кабинет живёт на page[common]=user (не page[org]=dean — та страница
// чисто информационная и не персонализируется). id — цифры из логина ('z93339' -> '93339').
// Сам журнал оценок/посещаемости подгружается на странице через AJAX (клик по году),
// а не отдаётся в HTML вкладки — бьём напрямую в этот эндпоинт с текущим годом.
const gradesPath = (login: string) =>
  `/index.php?page%5Bdean%5D=ajax_journal_year&y=${new Date().getFullYear()}&id=${deriveStudentId(login)}`;
// С валидной сессией эта же страница деканата автоматически показывает расписание
// группы студента (подтверждено вживую) — отдельный персональный URL не нужен.
const SCHEDULE_PATH = '/index.php?page%5Borg%5D=dean&cat=schedule';
// Без id сессия резолвит на самого залогиненного студента — ФИО, курс, группа и т.д.
const PROFILE_PATH = '/index.php?page%5Bcommon%5D=user';
// Фото профиля лежит по прямому пути от id студента (подтверждено вживую).
const photoPath = (login: string) => `/sys/images/user/${deriveStudentId(login)}.jpg`;
// Список УМКД студента — таблица «дисциплина → umkd_id» (несколько строк на
// дисциплину: разные семестры/когорты одной и той же рабочей программы).
const umkdListPath = (login: string) =>
  `/index.php?page%5Bcommon%5D=user&id=${deriveStudentId(login)}&cat=student&what=umkd`;
// Тематический план дисциплины — все темы семестра одной таблицей.
// tl_type: 0 — лекции, 1 — практические занятия.
const topicPlanPath = (umkdId: string, tlType: 0 | 1) =>
  `/index.php?page%5Borg%5D=dean&cat=oop&mode=umkd&umkd_id=${umkdId}&zaysim_id=0&umkd_page=7|0,1,10,5,3,4&tl_type=${tlType}`;
// Методические указания для обучающихся по конкретной теме (metod_class=1).
const methodichkaPath = (tlId: string) =>
  `/index.php?page%5Borg%5D=umkd_metod_tl&tl_id=${tlId}&metod_type=0&metod_class=1`;

export async function ensureKrasgmuSession(
  redis: AppRedis,
  tgId: string,
): Promise<{ cookies: Record<string, string>; login: string }> {
  const binding = await getBinding(redis, tgId);
  if (!binding) {
    throw new KrasgmuAuthError('Аккаунт не привязан', 'invalid_credentials');
  }

  let cookies = loadSessionCookies(binding);
  const valid = await validateSession(cookies, binding.universityLogin);
  if (valid) {
    await touchValidated(redis, tgId);
    return { cookies, login: binding.universityLogin };
  }
  if (cookies['krasgmu.auth']) {
    await recordSessionDeath(redis, binding).catch(e => console.error('[krasgmu] session stats', e));
  }

  const login = binding.universityLogin;
  return withReloginLock(
    redis,
    tgId,
    async () => {
      await reserveBrowserLogin(redis);
      const password = loadPassword(binding);
      const fresh = await loginKrasgmu(login, password);
      await saveBinding(redis, tgId, login, password, fresh);
      return { cookies: fresh, login };
    },
    async () => {
      // saveBinding обновляет boundAt — значит, параллельный запрос уже вошёл.
      const updated = await getBinding(redis, tgId);
      if (!updated || updated.boundAt === binding.boundAt) return null;
      return { cookies: loadSessionCookies(updated), login: updated.universityLogin };
    },
  );
}

export async function fetchKrasgmuSchedule(
  redis: AppRedis,
  tgId: string,
): Promise<{ login: string; schedule: KrasgmuScheduleDay[]; cycles: KrasgmuCycle[] }> {
  const { cookies, login } = await ensureKrasgmuSession(redis, tgId);
  const html = await fetchKrasgmuPage(SCHEDULE_PATH, cookies);
  return { login, schedule: parseScheduleHtml(html), cycles: parseCycleScheduleHtml(html) };
}

export async function fetchKrasgmuGrades(
  redis: AppRedis,
  tgId: string,
): Promise<{ login: string; grades: KrasgmuGradeRow[] }> {
  const { cookies, login } = await ensureKrasgmuSession(redis, tgId);
  const html = await fetchKrasgmuPage(gradesPath(login), cookies);
  return { login, grades: parseGradesHtml(html) };
}

export async function fetchKrasgmuProfile(
  redis: AppRedis,
  tgId: string,
): Promise<{ login: string; profile: KrasgmuProfile | null }> {
  const { cookies, login } = await ensureKrasgmuSession(redis, tgId);
  const html = await fetchKrasgmuPage(PROFILE_PATH, cookies);
  return { login, profile: parseProfileHtml(html) };
}

export async function fetchKrasgmuMethodichka(
  redis: AppRedis,
  tgId: string,
  tlId: string,
): Promise<{ login: string; methodichka: KrasgmuMethodichka | null }> {
  const { cookies, login } = await ensureKrasgmuSession(redis, tgId);
  const html = await fetchKrasgmuPage(methodichkaPath(tlId), cookies);
  return { login, methodichka: parseMethodichkaHtml(html) };
}

export async function fetchKrasgmuPhoto(
  redis: AppRedis,
  tgId: string,
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const { cookies, login } = await ensureKrasgmuSession(redis, tgId);
  return fetchKrasgmuBinary(photoPath(login), cookies);
}

/**
 * Сопоставляет пары в расписании с их точными темами из тематического плана УМКД:
 * дисциплина → { дата → № темы и название }. Для каждого (предмет, лекция/практика),
 * реально встречающегося в расписании, ищет umkd_id по названию дисциплины,
 * забирает тематический план и раскладывает даты по номерам тем по порядку.
 * Дисциплины без совпадения по названию или без распознанных дат — молча пропускаются.
 *
 * Отдельно — practiceTopics: то же самое для заглушек «ПРАКТИКА» (реальная
 * дисциплина которых определяется циклом, см. Цикловое расписание). Даты внутри
 * цикла не даны напрямую — перечисляем календарные дни цикла, приходящиеся на
 * дни недели, где в расписании стоит «ПРАКТИКА». Считаем только для АКТИВНОГО
 * сейчас цикла (не для всех 10+ циклов семестра) — иначе на каждый вызов ушёл бы
 * лишний запрос тематического плана на цикл.
 */
export async function fetchKrasgmuLectureTopics(
  redis: AppRedis,
  tgId: string,
): Promise<{
  login: string;
  topics: Record<string, Record<string, MatchedTopic>>;
  practiceTopics: Record<string, Record<string, MatchedTopic>>;
}> {
  const { cookies, login } = await ensureKrasgmuSession(redis, tgId);

  const [scheduleHtml, umkdListHtml] = await Promise.all([
    fetchKrasgmuPage(SCHEDULE_PATH, cookies),
    fetchKrasgmuPage(umkdListPath(login), cookies),
  ]);
  const schedule = parseScheduleHtml(scheduleHtml);
  const cycles = parseCycleScheduleHtml(scheduleHtml);
  const umkdList = parseUmkdListHtml(umkdListHtml);

  const umkdIdBySubject = new Map<string, string>();
  for (const entry of umkdList) {
    if (!umkdIdBySubject.has(entry.discipline)) umkdIdBySubject.set(entry.discipline, entry.umkdId);
  }

  const pairs = new Map<string, { subject: string; isLecture: boolean }>();
  for (const day of schedule) {
    for (const lesson of day.lessons) {
      if (!lesson.dates) continue;
      const subject = lesson.subject.trim();
      const isLecture = lesson.type === 'ЛЕКЦИЯ';
      pairs.set(`${subject}::${isLecture}`, { subject, isLecture });
    }
  }

  const topics: Record<string, Record<string, MatchedTopic>> = {};

  for (const { subject, isLecture } of pairs.values()) {
    const umkdId = umkdIdBySubject.get(subject);
    if (!umkdId) continue;
    const dates = collectLessonDates(schedule, subject, isLecture);
    if (dates.length === 0) continue;

    const planHtml = await fetchKrasgmuPage(topicPlanPath(umkdId, isLecture ? 0 : 1), cookies);
    const topicPlan = parseTopicPlanHtml(planHtml);
    if (topicPlan.length === 0) continue;

    const matched = matchDatesToTopics(dates, topicPlan);
    const bucket = topics[subject] ?? (topics[subject] = {});
    for (const [date, info] of matched) bucket[date] = info;
  }

  const practiceTopics: Record<string, Record<string, MatchedTopic>> = {};

  const practiceWeekdays = new Set<string>();
  for (const day of schedule) {
    if (day.lessons.some(l => l.subject === 'ПРАКТИКА')) practiceWeekdays.add(day.weekday);
  }

  const activeCycle = practiceWeekdays.size > 0 ? findActiveCycle(cycles, krasnoyarskNow().date) : null;
  if (activeCycle) {
    const umkdId = umkdIdBySubject.get(activeCycle.discipline);
    const cycleDates = umkdId ? enumerateCycleDates(activeCycle, practiceWeekdays) : [];
    if (umkdId && cycleDates.length > 0) {
      const planHtml = await fetchKrasgmuPage(topicPlanPath(umkdId, 1), cookies);
      const topicPlan = parseTopicPlanHtml(planHtml);
      if (topicPlan.length > 0) {
        const matched = matchFullDatesToTopics(cycleDates, topicPlan);
        const bucket = practiceTopics[activeCycle.discipline] ?? (practiceTopics[activeCycle.discipline] = {});
        for (const [date, info] of matched) bucket[date] = info;
      }
    }
  }

  return { login, topics, practiceTopics };
}

/** Список всех дисциплин студента (один запрос) — без тем, их грузит fetchKrasgmuTopicPlan по запросу. */
export async function fetchKrasgmuLibraryDisciplines(
  redis: AppRedis,
  tgId: string,
): Promise<{ login: string; disciplines: KrasgmuLibraryDiscipline[] }> {
  const { cookies, login } = await ensureKrasgmuSession(redis, tgId);

  const umkdListHtml = await fetchKrasgmuPage(umkdListPath(login), cookies);
  const umkdList = parseUmkdListHtml(umkdListHtml);

  const seen = new Set<string>();
  const disciplines: KrasgmuLibraryDiscipline[] = [];
  for (const entry of umkdList) {
    if (seen.has(entry.discipline)) continue;
    seen.add(entry.discipline);
    disciplines.push({ discipline: entry.discipline, umkdId: entry.umkdId });
  }

  return { login, disciplines };
}

/** Полный тематический план одной дисциплины (лекции + практики) — не привязан к расписанию. */
export async function fetchKrasgmuTopicPlan(
  redis: AppRedis,
  tgId: string,
  umkdId: string,
): Promise<KrasgmuTopicPlan> {
  const { cookies } = await ensureKrasgmuSession(redis, tgId);

  const [lecturesHtml, practiceHtml] = await Promise.all([
    fetchKrasgmuPage(topicPlanPath(umkdId, 0), cookies),
    fetchKrasgmuPage(topicPlanPath(umkdId, 1), cookies),
  ]);
  return {
    lectures: parseTopicPlanHtml(lecturesHtml),
    practice: parseTopicPlanHtml(practiceHtml),
  };
}
