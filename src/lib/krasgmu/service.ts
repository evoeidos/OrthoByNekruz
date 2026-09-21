import type { AppRedis } from '@/lib/redis';
import {
  KrasgmuAuthError,
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

const SCHEDULE_PATH = '/index.php?page%5Borg%5D=dean&cat=schedule';
const GRADES_PATH = '/index.php?page%5Borg%5D=dean&cat=progress';

export async function ensureKrasgmuSession(
  redis: AppRedis,
  tgId: string,
): Promise<{ cookies: Record<string, string>; login: string }> {
  const binding = await getBinding(redis, tgId);
  if (!binding) {
    throw new KrasgmuAuthError('Аккаунт не привязан', 'invalid_credentials');
  }

  let cookies = loadSessionCookies(binding);
  const valid = await validateSession(cookies);
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
  const html = await fetchKrasgmuPage(GRADES_PATH, cookies);
  return { login, grades: parseGradesHtml(html) };
}
