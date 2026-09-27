import type { AppRedis } from '@/lib/redis';
import {
  KrasgmuAuthError,
  deriveStudentId,
  fetchKrasgmuPage,
  loginKrasgmu,
  validateSession,
} from '@/lib/krasgmu/client';
import { parseGradesHtml, parseScheduleHtml } from '@/lib/krasgmu/parser';
import {
  getBinding,
  loadPassword,
  loadSessionCookies,
  saveBinding,
  touchValidated,
} from '@/lib/krasgmu/store';
import type { KrasgmuGradeRow, KrasgmuScheduleDay } from '@/lib/krasgmu/types';

// Личный кабинет живёт на page[common]=user (не page[org]=dean — та страница
// чисто информационная и не персонализируется). id — цифры из логина ('z93339' -> '93339').
// Сам журнал оценок/посещаемости подгружается на странице через AJAX (клик по году),
// а не отдаётся в HTML вкладки — бьём напрямую в этот эндпоинт с текущим годом.
const gradesPath = (login: string) =>
  `/index.php?page%5Bdean%5D=ajax_journal_year&y=${new Date().getFullYear()}&id=${deriveStudentId(login)}`;
// С валидной сессией эта же страница деканата автоматически показывает расписание
// группы студента (подтверждено вживую) — отдельный персональный URL не нужен.
const SCHEDULE_PATH = '/index.php?page%5Borg%5D=dean&cat=schedule';

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

  const password = loadPassword(binding);
  cookies = await loginKrasgmu(binding.universityLogin, password);
  await saveBinding(redis, tgId, binding.universityLogin, password, cookies);
  return { cookies, login: binding.universityLogin };
}

export async function fetchKrasgmuSchedule(
  redis: AppRedis,
  tgId: string,
): Promise<{ login: string; schedule: KrasgmuScheduleDay[] }> {
  const { cookies, login } = await ensureKrasgmuSession(redis, tgId);
  const html = await fetchKrasgmuPage(SCHEDULE_PATH, cookies);
  return { login, schedule: parseScheduleHtml(html) };
}

export async function fetchKrasgmuGrades(
  redis: AppRedis,
  tgId: string,
): Promise<{ login: string; grades: KrasgmuGradeRow[] }> {
  const { cookies, login } = await ensureKrasgmuSession(redis, tgId);
  const html = await fetchKrasgmuPage(gradesPath(login), cookies);
  return { login, grades: parseGradesHtml(html) };
}
